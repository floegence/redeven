package ai

import (
	"context"
	"errors"
	"slices"
	"strings"

	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/session"
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
			if completed, ok := payload["completed_actions"].([]string); ok && len(completed) <= 50 {
				result.Result.(map[string]any)["completed_actions"] = append([]string(nil), completed...)
				result.Result.(map[string]any)["operations"] = len(completed)
			}
			if executed, ok := payload["action_executed"].(bool); ok {
				result.Result.(map[string]any)["action_executed"] = executed
			}
		}
		if observed[0].ExecutionLocation != "" {
			result.ExecutionLocation = observed[0].ExecutionLocation
		}
	}
	summary := "Flower needs you to complete a step in the browser or application."
	prompt := "Complete sign-in or verification outside the conversation. Never enter passwords or verification codes here. Return control when you are ready."
	if slices.Contains(safety.ReasonCodes, "target_permission") {
		summary = "A new browser tab needs your selection."
		prompt = "Open Computer connections, connect and select the new tab, then review its site access before returning control. Flower will not switch tabs automatically."
	} else if safety.RequiredOrigin != "" || safety.RequiredApp != "" || slices.Contains(safety.ReasonCodes, "foreground_permission") {
		summary = "Flower needs access to the selected target before continuing."
		prompt = "Open Computer connections, review and save the requested task access, then return control. Completed actions will not be replayed."
	} else if slices.Contains(safety.ReasonCodes, "user_control") {
		summary = "Flower's computer actions are paused."
		prompt = "Continue using the target for as long as you need. Return control explicitly when Flower may continue."
	}
	return targetToolExecution{TargetID: target.ID, Payload: targetToolResultPayload(result, target.ID), inputRequired: &fltools.InputRequest{
		Summary:   summary,
		Questions: []fltools.InputQuestion{{ID: "computer_control", Prompt: prompt, Kind: "select", Options: []string{"Return control to Flower"}}},
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

func (s *Service) respondComputerControl(ctx context.Context, meta *session.Meta, view flruntime.ThreadView, interaction flruntime.ThreadInteraction, answers map[string]string, respond func() (flruntime.ThreadView, error)) (flruntime.ThreadView, error) {
	call, computer, err := computerControlCall(view, interaction)
	if err != nil {
		return flruntime.ThreadView{}, err
	}
	if !computer {
		return respond()
	}
	if len(answers) != 1 || answers["computer_control"] != "Return control to Flower" {
		return flruntime.ThreadView{}, errors.New("invalid computer control acknowledgement")
	}
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return flruntime.ThreadView{}, &TargetStartupError{Code: "TARGET_NOT_READY", Reason: "control_return_unavailable"}
	}
	call.ToolName, call.Arguments, call.liveFrame, call.controlReturn = "computer.screenshot", nil, true, true
	control, unlock, err := host.acquireComputerControl(ctx, call)
	if err != nil {
		return flruntime.ThreadView{}, err
	}
	defer unlock()
	if _, err := s.pendingComputerControl(ctx, meta, string(view.ThreadID), interaction.ID); err != nil {
		return flruntime.ThreadView{}, err
	}
	if _, err := host.executeComputerToolLocked(ctx, call, control); err != nil {
		return flruntime.ThreadView{}, err
	}
	// Keep the gate until Respond commits. A queued private input must recheck
	// canonical authority after this point instead of reclaiming the target.
	result, err := respond()
	if err != nil {
		control.mu.Lock()
		if control.threadID == call.ThreadID && control.runID == call.RunID {
			control.user = true
		}
		control.mu.Unlock()
	}
	return result, err
}

func (r *ComputerUseRuntime) ReobserveComputerTarget(ctx context.Context, call TargetToolCall) error {
	call.ToolName, call.Arguments, call.liveFrame, call.controlReturn = "computer.screenshot", nil, true, true
	_, err := r.ExecuteTargetTool(ctx, call)
	return err
}
