package ai

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"sync"
)

// A target lease owns the external resource, not the Floret turn lifecycle.
// The canonical terminal view releases it. Each target serializes observations,
// actions and handback so screenshots cannot race a different thread's input.
type computerTargetControl struct {
	gate                 chan struct{}
	mu                   sync.Mutex
	threadID             string
	turnID               string
	runID                string
	pause                *InteractionSafetyDecision
	recheckInteractionID string
	browser              *browserTargetLease
}

// The Runtime owns the barrier. Helpers report observations, not a second
// independently advancing control mode. Callers hold control.mu.
func (control *computerTargetControl) pauseForUser() {
	if control.pause == nil {
		control.pause = &InteractionSafetyDecision{Level: "takeover", ReasonCodes: []string{"user_control"}}
	}
}

func (control *computerTargetControl) pauseError(call TargetToolCall) error {
	if control.pause == nil {
		return nil
	}
	safety := *control.pause
	safety.ReasonCodes = slices.Clone(safety.ReasonCodes)
	return &targetToolPolicyError{code: "interaction_takeover_required", tool: call.ToolName, target: call.TargetID, safety: &safety}
}

func (control *computerTargetControl) permitsRecoveryContinuation(call TargetToolCall) bool {
	allowedTool := call.recoveryObservation && (call.ToolName == "computer.observe" || call.ToolName == "computer.screenshot") ||
		call.recoverySelection && (call.ToolName == "computer.targets" || call.ToolName == "computer.select_target")
	return control.pause != nil && allowedTool && call.interactionID != "" &&
		control.threadID == call.ThreadID && control.turnID == call.TurnID && control.runID == call.RunID &&
		control.recheckInteractionID == call.interactionID
}

func (control *computerTargetControl) recordPause(call TargetToolCall, result TargetToolResult, err error) {
	control.mu.Lock()
	defer control.mu.Unlock()
	if control.threadID != call.ThreadID || (!call.liveFrame && control.runID != call.RunID) {
		return
	}
	safety := computerPauseSafety(result, err)
	control.pause = &safety
	source := "tool"
	if call.liveFrame {
		source = "viewer"
	}
	slog.Info("computer safety paused", "thread_id", call.ThreadID, "target_id", call.TargetID, "source", source, "reason", computerAssistanceKind(safety))
}

func computerPauseSafety(result TargetToolResult, err error) InteractionSafetyDecision {
	safety := result.Safety
	var failure *targetToolPolicyError
	if safety == nil && errors.As(err, &failure) {
		safety = failure.safety
	}
	if safety == nil {
		return InteractionSafetyDecision{Level: "takeover", ReasonCodes: []string{"unknown"}}
	}
	copy := *safety
	copy.ReasonCodes = slices.Clone(safety.ReasonCodes)
	return copy
}

type computerProgressKey struct{}

func (r *ComputerUseRuntime) controlForTarget(targetID string) *computerTargetControl {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.controls == nil {
		r.controls = make(map[string]*computerTargetControl)
	}
	control := r.controls[targetID]
	if control == nil {
		control = &computerTargetControl{gate: make(chan struct{}, 1)}
		r.controls[targetID] = control
	}
	return control
}

var errComputerCaptureBusy = errors.New("computer capture is busy")

func (r *ComputerUseRuntime) acquireComputerControl(ctx context.Context, call TargetToolCall) (*computerTargetControl, func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	// A recovered pending interaction may be the first browser operation after
	// restart. Prepare its Runtime-owned profile before acquiring the target gate.
	// Passive samples never launch resources or wait on connection ownership.
	if !call.passiveCapture && (call.userInput || call.recoveryObservation) {
		if _, err := r.prepareInitialManagedTarget(ctx, TargetDescriptor{ID: call.TargetID}); err != nil {
			return nil, nil, err
		}
	}
	control := r.controlForTarget(call.TargetID)
	if call.passiveCapture {
		select {
		case control.gate <- struct{}{}:
		default:
			return nil, nil, errComputerCaptureBusy
		}
	} else {
		select {
		case <-ctx.Done():
			return nil, nil, ctx.Err()
		case control.gate <- struct{}{}:
		}
	}
	unlock := func() { <-control.gate }
	if err := ctx.Err(); err != nil {
		unlock()
		return nil, nil, err
	}
	r.mu.RLock()
	closed := r.closed
	r.mu.RUnlock()
	if closed {
		unlock()
		return nil, nil, &TargetStartupError{Code: "TARGET_NOT_READY", Reason: "runtime_closed"}
	}
	control.mu.Lock()
	defer control.mu.Unlock()
	if control.browser != nil && call.recoveryObservation && control.threadID == call.ThreadID && control.runID == call.RunID && control.recheckInteractionID != "" {
		lease := control.browser
		lease.revoke()
		control.mu.Unlock()
		err := lease.drain(ctx)
		control.mu.Lock()
		if err != nil {
			unlock()
			return nil, nil, err
		}
		if control.browser == lease {
			control.browser = nil
		}
	}
	if control.browser != nil {
		unlock()
		return nil, nil, computerTargetFailure(call, "TARGET_IN_USE")
	}
	if call.liveFrame && !call.recoveryObservation && !call.userInput && control.threadID == "" {
		unlock()
		return nil, nil, computerTargetFailure(call, "TARGET_NOT_ALLOWED")
	}
	if control.threadID != "" && (control.threadID != call.ThreadID || ((!call.liveFrame || call.recoveryObservation || call.userInput) && control.runID != "" && control.runID != call.RunID)) {
		unlock()
		return nil, nil, computerTargetFailure(call, "TARGET_IN_USE")
	}
	if control.pause != nil && !call.recoveryObservation && !call.recoverySelection && !call.userInput {
		if call.interactionID != "" && control.threadID == call.ThreadID && control.turnID == call.TurnID && control.runID == call.RunID && control.recheckInteractionID == call.interactionID {
			unlock()
			return nil, nil, &targetToolPolicyError{code: "recovery_observation_required", tool: call.ToolName, target: call.TargetID}
		}
		unlock()
		return nil, nil, control.pauseError(call)
	}
	if (!call.liveFrame || call.recoveryObservation) && call.ThreadID != "" && !call.bindSelection {
		control.threadID, control.turnID, control.runID = call.ThreadID, call.TurnID, call.RunID
		if call.recoveryObservation {
			control.pauseForUser()
		}
	}
	return control, unlock, nil
}

// Floret starts a fresh run when canonical input resumes within the same turn.
// Bind existing resource leases at that canonical boundary, even if the resumed
// model returns only text. This neither claims a target nor returns user control.
func (r *ComputerUseRuntime) continueComputerControl(threadID, turnID, runID string) {
	if threadID == "" || turnID == "" || runID == "" {
		return
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, control := range r.controls {
		control.mu.Lock()
		if control.threadID == threadID && control.turnID == turnID && control.pause == nil {
			control.runID = runID
		}
		control.mu.Unlock()
	}
}

// Only a resolved canonical interaction can authorize a fresh safety observation.
// The pause remains until that observation succeeds; ordinary continuation cannot clear it.
func (r *ComputerUseRuntime) resumeComputerControl(call TargetToolCall, runID string) {
	if call.ThreadID == "" || call.TurnID == "" || call.RunID == "" || call.TargetID == "" || call.interactionID == "" || runID == "" {
		return
	}
	control := r.controlForTarget(call.TargetID)
	control.mu.Lock()
	defer control.mu.Unlock()
	if control.threadID != "" && (control.threadID != call.ThreadID || control.turnID != call.TurnID || control.runID != call.RunID) {
		return
	}
	control.threadID, control.turnID, control.runID = call.ThreadID, call.TurnID, runID
	control.pauseForUser()
	control.recheckInteractionID = call.interactionID
	if control.browser != nil {
		control.browser.revoke()
	}
}

func (r *ComputerUseRuntime) releaseComputerControl(threadID, runID string) {
	released := false
	r.mu.RLock()
	for targetID, control := range r.controls {
		control.mu.Lock()
		if control.threadID == threadID && control.runID == runID {
			// Retire observation with its resource owner. Normal completion must
			// not race the next capture into a spurious viewer failure.
			for _, sampler := range r.liveFrames {
				if sampler.request.ThreadID == threadID && sampler.request.TargetID == targetID {
					sampler.cancel()
				}
			}
			control.threadID, control.turnID, control.runID, control.pause = "", "", "", nil
			control.recheckInteractionID = ""
			released = true
		}
		control.mu.Unlock()
	}
	r.mu.RUnlock()
	if released {
		r.releaseScripts(func(key computerScriptKey) bool { return key.thread == threadID })
	}
}

func takeoverResult(result TargetToolResult, err error) bool {
	if result.Safety != nil && result.Safety.Level == "takeover" {
		return true
	}
	var failure *targetToolPolicyError
	return errors.As(err, &failure) && failure.code == "interaction_takeover_required"
}

func (r *ComputerUseRuntime) releasePreviousComputerTarget(call TargetToolCall) {
	if call.liveFrame || call.ThreadID == "" {
		return
	}
	r.releaseScripts(func(key computerScriptKey) bool { return key.thread == call.ThreadID && key.target != call.TargetID })
	r.mu.RLock()
	controls := make([]*computerTargetControl, 0, len(r.controls))
	for id, control := range r.controls {
		if id != call.TargetID {
			controls = append(controls, control)
		}
	}
	r.mu.RUnlock()
	for _, control := range controls {
		control.mu.Lock()
		if control.threadID == call.ThreadID && control.runID == call.RunID && control.pause == nil {
			control.threadID, control.turnID, control.runID = "", "", ""
		}
		control.mu.Unlock()
	}
}
