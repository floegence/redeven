package ai

import (
	"context"
	"errors"
	"strings"

	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
)

// A safety pause is a completed observation followed by canonical user input,
// not a failed action that the model should retry. External control remains
// host-owned; Floret owns the durable waiting interaction and continuation.
func computerTakeoverExecution(call TargetToolCall, target TargetDescriptor, safety InteractionSafetyDecision, observed ...TargetToolResult) targetToolExecution {
	safety.ActionID = call.ToolCallID
	safety.Level = "takeover"
	safety.SafeToCapture, safety.SafeToSendToModel = false, false
	result := TargetToolResult{TargetID: target.ID, TargetName: target.DisplayName, ExecutionLocation: target.Locality, Safety: &safety,
		ActionSummary: "Waiting for you to complete the external step", Result: map[string]any{"action_executed": false, "code": "TAKEOVER_REQUIRED"}}
	if len(observed) == 1 {
		// Preserve whether the effect already happened; a safety observation after
		// navigation must never invite replay of that navigation.
		if payload, ok := observed[0].Result.(map[string]any); ok {
			if executed, ok := payload["action_executed"].(bool); ok {
				result.Result.(map[string]any)["action_executed"] = executed
			}
		}
		if observed[0].ExecutionLocation != "" {
			result.ExecutionLocation = observed[0].ExecutionLocation
		}
	}
	return targetToolExecution{TargetID: target.ID, Payload: targetToolResultPayload(result, target.ID), inputRequired: &fltools.InputRequest{
		Summary:   "Flower needs you to complete a step in the browser or application.",
		Questions: []fltools.InputQuestion{{ID: "computer_control", Prompt: "Complete sign-in or verification outside the conversation. Never enter passwords or verification codes here. Return control when you are ready.", Kind: "select", Options: []string{"Return control to Flower"}}},
	}}
}

// Re-observation is a host control command, never replay of the paused model
// action. Canonical tool provenance selects the target even if current changed.
func computerControlCall(view flruntime.ThreadView, interaction flruntime.ThreadInteraction) (TargetToolCall, bool, error) {
	for _, item := range view.Items {
		activity := item.Activity
		if item.TurnID != interaction.TurnID || item.RunID != interaction.RunID || activity == nil || activity.ToolID != interaction.ToolCallID || !isComputerUseTool(activity.ToolName) {
			continue
		}
		if activity.Presentation != nil {
			for _, ref := range activity.Presentation.TargetRefs {
				if ref.Kind == "computer_control" && ref.ResourceRef != "" {
					return TargetToolCall{ThreadID: string(view.ThreadID), TurnID: string(interaction.TurnID), RunID: string(interaction.RunID), ToolCallID: interaction.ToolCallID, TargetID: ref.ResourceRef}, true, nil
				}
			}
		}
		return TargetToolCall{}, true, errors.New("computer control target is unavailable")
	}
	if strings.HasPrefix(interaction.ID, "tool-input:") && interaction.Input != nil {
		for _, question := range interaction.Input.Questions {
			if question.ID == "computer_control" {
				return TargetToolCall{}, true, errors.New("computer control provenance is unavailable")
			}
		}
	}
	return TargetToolCall{}, false, nil
}

func (s *Service) reobserveComputerControlReturn(ctx context.Context, view flruntime.ThreadView, interaction flruntime.ThreadInteraction, answers map[string]string) error {
	call, computer, err := computerControlCall(view, interaction)
	if err != nil || !computer {
		return err
	}
	if len(answers) != 1 || answers["computer_control"] != "Return control to Flower" {
		return errors.New("invalid computer control acknowledgement")
	}
	host, ok := s.targetToolExecutor.(interface {
		ReobserveComputerTarget(context.Context, TargetToolCall) error
	})
	if !ok {
		return &TargetStartupError{Code: "TARGET_NOT_READY", Reason: "control_return_unavailable"}
	}
	return host.ReobserveComputerTarget(ctx, call)
}

func (r *ComputerUseRuntime) ReobserveComputerTarget(ctx context.Context, call TargetToolCall) error {
	call.ToolName, call.Arguments, call.liveFrame, call.controlReturn = "computer.screenshot", nil, true, true
	_, err := r.ExecuteTargetTool(ctx, call)
	return err
}
