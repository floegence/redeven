package ai

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"unicode/utf8"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

// ComputerUserInput is an authenticated host command, never a model tool.
// Text is forwarded once to the target and must not be logged or persisted.
type ComputerUserInput struct {
	ObserverID     string  `json:"observer_id"`
	ViewerRevision uint64  `json:"viewer_revision"`
	ThreadID       string  `json:"thread_id"`
	InteractionID  string  `json:"interaction_id"`
	Action         string  `json:"action"`
	X              float64 `json:"x,omitempty"`
	Y              float64 `json:"y,omitempty"`
	Text           string  `json:"text,omitempty"`
	Key            string  `json:"key,omitempty"`
	DeltaX         float64 `json:"delta_x,omitempty"`
	DeltaY         float64 `json:"delta_y,omitempty"`
}

// Resolve authority from Floret each time, including after waiting for the target.
func (s *Service) pendingComputerControl(ctx context.Context, meta *session.Meta, threadID, interactionID string) (TargetToolCall, error) {
	if err := requireRWX(meta); err != nil {
		return TargetToolCall{}, err
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return TargetToolCall{}, err
	}
	typed, err := s.typedFloretRuntime()
	if err != nil {
		return TargetToolCall{}, err
	}
	view, err := typed.View(ctx, identity.ThreadID(threadID))
	if err != nil {
		return TargetToolCall{}, err
	}
	var pending *flruntime.ThreadInteraction
	for _, interaction := range view.Interactions {
		if interaction.ID == interactionID && !interaction.Resolved && interaction.Kind == flruntime.ThreadInteractionInput {
			pending = &interaction
			break
		}
	}
	if pending == nil {
		return TargetToolCall{}, ErrWaitingPromptChanged
	}
	call, computer, err := computerControlCall(view, *pending)
	if err != nil {
		return TargetToolCall{}, err
	}
	if !computer {
		return TargetToolCall{}, ErrWaitingPromptChanged
	}
	return call, nil
}

func (s *Service) InputComputerControl(ctx context.Context, meta *session.Meta, request ComputerUserInput) error {
	call, err := s.pendingComputerControl(ctx, meta, request.ThreadID, request.InteractionID)
	if err != nil {
		return err
	}
	args := map[string]any{}
	switch request.Action {
	case "click":
		if request.X < 0 || request.Y < 0 || math.IsInf(request.X, 0) || math.IsInf(request.Y, 0) || math.IsNaN(request.X) || math.IsNaN(request.Y) {
			return errors.New("invalid control coordinates")
		}
		call.ToolName = "computer.click"
		args["x"], args["y"] = request.X, request.Y
	case "type":
		if !utf8.ValidString(request.Text) || len(request.Text) > 20000 {
			return errors.New("invalid control input")
		}
		call.ToolName = "computer.type"
		args["text"] = request.Text
	case "key":
		if !utf8.ValidString(request.Key) || len(request.Key) == 0 || len(request.Key) > 80 {
			return errors.New("invalid control key")
		}
		call.ToolName = "computer.key"
		args["key"] = request.Key
	case "scroll":
		if math.IsInf(request.DeltaX, 0) || math.IsInf(request.DeltaY, 0) || math.IsNaN(request.DeltaX) || math.IsNaN(request.DeltaY) || math.Abs(request.DeltaX) > 10000 || math.Abs(request.DeltaY) > 10000 {
			return errors.New("invalid control scroll")
		}
		call.ToolName = "computer.scroll"
		args["delta_x"], args["delta_y"] = request.DeltaX, request.DeltaY
	default:
		return errors.New("unsupported computer control input")
	}
	call.Arguments, _ = json.Marshal(args)
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return &TargetStartupError{Code: "TARGET_NOT_READY", Reason: "user_control_unavailable"}
	}
	call.userInput, call.liveFrame = true, true
	control, unlock, err := host.acquireComputerControl(ctx, call)
	if err != nil {
		return err
	}
	defer unlock()
	if _, err := s.pendingComputerControl(ctx, meta, request.ThreadID, request.InteractionID); err != nil {
		return err
	}
	if err := s.requirePrivateComputerViewer(meta, request.ObserverID, request.ViewerRevision, request.ThreadID, request.InteractionID); err != nil {
		return err
	}
	control.mu.Lock()
	control.threadID, control.turnID, control.runID, control.user = call.ThreadID, call.TurnID, call.RunID, true
	control.mu.Unlock()
	_, err = host.executeComputerUserInputLocked(ctx, call)
	return err
}

func (r *ComputerUseRuntime) executeComputerUserInputLocked(ctx context.Context, call TargetToolCall) ([]byte, error) {
	r.mu.RLock()
	executor := r.executors[call.TargetID]
	r.mu.RUnlock()
	input, ok := executor.(interface {
		ExecuteComputerUserInput(context.Context, TargetToolCall) ([]byte, error)
	})
	if !ok {
		return nil, &TargetStartupError{Code: "TARGET_NOT_READY", Reason: "user_control_unavailable"}
	}
	body, err := input.ExecuteComputerUserInput(ctx, call)
	if err != nil {
		return nil, err
	}
	if call.ToolName == "computer.screenshot" {
		if err := validateComputerPixels(body); err != nil {
			return nil, computerTargetFailure(call, "FRAME_UNAVAILABLE")
		}
	} else if len(body) != 0 {
		return nil, errors.New("unexpected private input media")
	}
	return body, nil
}
