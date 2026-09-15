package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"unicode/utf8"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

// ComputerUserInput is an authenticated host command, never a model tool.
// Text is forwarded once to the target and must not be logged or persisted.
type ComputerUserInput struct {
	ThreadID      string  `json:"thread_id"`
	InteractionID string  `json:"interaction_id"`
	Action        string  `json:"action"`
	X             float64 `json:"x,omitempty"`
	Y             float64 `json:"y,omitempty"`
	Text          string  `json:"text,omitempty"`
	Key           string  `json:"key,omitempty"`
	DeltaX        float64 `json:"delta_x,omitempty"`
	DeltaY        float64 `json:"delta_y,omitempty"`
}

func (s *Service) InputComputerControl(ctx context.Context, meta *session.Meta, request ComputerUserInput) ([]byte, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, request.ThreadID); err != nil {
		return nil, err
	}
	typed, err := s.typedFloretRuntime()
	if err != nil {
		return nil, err
	}
	view, err := typed.View(ctx, identity.ThreadID(request.ThreadID))
	if err != nil {
		return nil, err
	}
	var pending *flruntime.ThreadInteraction
	for _, interaction := range view.Interactions {
		if interaction.ID == request.InteractionID && !interaction.Resolved && interaction.Kind == flruntime.ThreadInteractionInput {
			pending = &interaction
			break
		}
	}
	if pending == nil {
		return nil, ErrWaitingPromptChanged
	}
	call, computer, err := computerControlCall(view, *pending)
	if err != nil {
		return nil, err
	}
	if !computer {
		return nil, ErrWaitingPromptChanged
	}
	args := map[string]any{}
	switch request.Action {
	case "observe":
		call.ToolName = "computer.screenshot"
	case "click":
		if request.X < 0 || request.Y < 0 || math.IsInf(request.X, 0) || math.IsInf(request.Y, 0) || math.IsNaN(request.X) || math.IsNaN(request.Y) {
			return nil, errors.New("invalid control coordinates")
		}
		call.ToolName = "computer.click"
		args["x"], args["y"] = request.X, request.Y
	case "type":
		if !utf8.ValidString(request.Text) || len(request.Text) > 20000 {
			return nil, errors.New("invalid control input")
		}
		call.ToolName = "computer.type"
		args["text"] = request.Text
	case "key":
		if !utf8.ValidString(request.Key) || len(request.Key) == 0 || len(request.Key) > 80 {
			return nil, errors.New("invalid control key")
		}
		call.ToolName = "computer.key"
		args["key"] = request.Key
	case "scroll":
		if math.IsInf(request.DeltaX, 0) || math.IsInf(request.DeltaY, 0) || math.IsNaN(request.DeltaX) || math.IsNaN(request.DeltaY) || math.Abs(request.DeltaX) > 10000 || math.Abs(request.DeltaY) > 10000 {
			return nil, errors.New("invalid control scroll")
		}
		call.ToolName = "computer.scroll"
		args["delta_x"], args["delta_y"] = request.DeltaX, request.DeltaY
	default:
		return nil, errors.New("unsupported computer control input")
	}
	call.Arguments, _ = json.Marshal(args)
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return nil, &TargetStartupError{Code: "TARGET_NOT_READY", Reason: "user_control_unavailable"}
	}
	return host.inputComputerControl(ctx, call)
}

func (r *ComputerUseRuntime) inputComputerControl(ctx context.Context, call TargetToolCall) ([]byte, error) {
	call.userInput, call.liveFrame = true, true
	_, unlock, err := r.acquireComputerControl(ctx, call)
	if err != nil {
		return nil, err
	}
	defer unlock()
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
	hash := fmt.Sprintf("%x", sha256.Sum256(body))
	attachment := TargetToolAttachment{ResourceRef: "computer://" + call.TargetID + "/" + hash, SHA256: hash, MIMEType: "image/png", SizeBytes: int64(len(body))}
	if err := validateComputerFrame(attachment, body); err != nil {
		return nil, computerTargetFailure(call, "FRAME_UNAVAILABLE")
	}
	return body, nil
}
