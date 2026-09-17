package ai

import (
	"context"
	"errors"
	"sync"
)

// A target lease owns the external resource, not the Floret turn lifecycle.
// The canonical terminal view releases it. Each target serializes observations,
// actions and handback so screenshots cannot race a different thread's input.
type computerTargetControl struct {
	gate              chan struct{}
	mu                sync.Mutex
	threadID          string
	turnID            string
	runID             string
	user              bool
	requiredOrigin    string
	requiredApp       string
	requireForeground bool
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
	if !call.passiveCapture && (call.userInput || call.controlReturn) {
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
	if call.liveFrame && !call.controlReturn && !call.userInput && control.threadID == "" {
		unlock()
		return nil, nil, computerTargetFailure(call, "TARGET_NOT_ALLOWED")
	}
	if control.threadID != "" && (control.threadID != call.ThreadID || ((!call.liveFrame || call.controlReturn || call.userInput) && control.runID != "" && control.runID != call.RunID)) {
		unlock()
		return nil, nil, computerTargetFailure(call, "TARGET_NOT_ALLOWED")
	}
	if control.user && !call.controlReturn && !call.userInput {
		unlock()
		return nil, nil, computerTargetFailure(call, "TAKEOVER_REQUIRED")
	}
	if (!call.liveFrame || call.controlReturn) && call.ThreadID != "" {
		control.threadID, control.turnID, control.runID = call.ThreadID, call.TurnID, call.RunID
		if call.controlReturn {
			control.user = true
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
		if control.threadID == threadID && control.turnID == turnID && !control.user {
			control.runID = runID
		}
		control.mu.Unlock()
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
			control.threadID, control.turnID, control.runID, control.user = "", "", "", false
			control.requiredOrigin, control.requiredApp, control.requireForeground = "", "", false
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
		if control.threadID == call.ThreadID && control.runID == call.RunID && !control.user {
			control.threadID, control.turnID, control.runID = "", "", ""
		}
		control.mu.Unlock()
	}
}
