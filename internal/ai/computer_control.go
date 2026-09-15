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
	gate     chan struct{}
	mu       sync.Mutex
	threadID string
	turnID   string
	runID    string
	user     bool
}

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

func (r *ComputerUseRuntime) acquireComputerControl(ctx context.Context, call TargetToolCall) (*computerTargetControl, func(), error) {
	control := r.controlForTarget(call.TargetID)
	select {
	case <-ctx.Done():
		return nil, nil, ctx.Err()
	case control.gate <- struct{}{}:
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
	if (!call.liveFrame || call.controlReturn || call.userInput) && call.ThreadID != "" {
		control.threadID, control.turnID, control.runID = call.ThreadID, call.TurnID, call.RunID
		if call.controlReturn || call.userInput {
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
	r.mu.RLock()
	controls := make([]*computerTargetControl, 0, len(r.controls))
	for _, control := range r.controls {
		controls = append(controls, control)
	}
	r.mu.RUnlock()
	for _, control := range controls {
		control.mu.Lock()
		if control.threadID == threadID && control.runID == runID {
			control.threadID, control.turnID, control.runID, control.user = "", "", "", false
		}
		control.mu.Unlock()
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
