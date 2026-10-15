package ai

import (
	"errors"
	"slices"
	"strings"

	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
)

// Blocked operations report facts. Only the Agent may request input in a later
// ask_user call; an unsuccessful capture never becomes a successful question.
func computerBlockedExecution(call TargetToolCall, target TargetDescriptor, safety InteractionSafetyDecision, observed ...TargetToolResult) (toolExecutionOutput, error) {
	safety.ActionID, safety.Level = call.ToolCallID, "takeover"
	safety.SafeToCapture, safety.SafeToSendToModel = false, false
	result := TargetToolResult{TargetID: target.ID, TargetName: target.DisplayName, ExecutionLocation: target.Locality, Safety: &safety,
		Result: map[string]any{"action_executed": false, "code": "TAKEOVER_REQUIRED"}}
	if len(observed) == 1 {
		if payload, ok := observed[0].Result.(map[string]any); ok {
			for _, key := range []string{"action_executed", "completed_actions", "operations", "observation_stage"} {
				if value, exists := payload[key]; exists {
					result.Result.(map[string]any)[key] = value
				}
			}
		}
		if observed[0].ExecutionLocation != "" {
			result.ExecutionLocation = observed[0].ExecutionLocation
		}
	}
	return toolExecutionOutput{TargetID: target.ID, Payload: targetToolResultPayload(result, target.ID, target)},
		&targetToolPolicyError{code: "interaction_takeover_required", tool: call.ToolName, target: target.ID, safety: &safety}
}

func computerAssistanceKind(safety InteractionSafetyDecision) string {
	switch {
	case safety.RequiredOrigin != "" || safety.RequiredApp != "" || slices.Contains(safety.ReasonCodes, "foreground_permission"):
		return "access"
	case slices.Contains(safety.ReasonCodes, "captcha"):
		return "captcha"
	case slices.Contains(safety.ReasonCodes, "otp"):
		return "verification"
	case slices.Contains(safety.ReasonCodes, "login"):
		return "login"
	case slices.Contains(safety.ReasonCodes, "secret_input"):
		return "private_input"
	case slices.Contains(safety.ReasonCodes, "prompt_injection"):
		return "untrusted_content"
	case slices.Contains(safety.ReasonCodes, "user_control"):
		return "paused"
	default:
		return "inspection"
	}
}

func computerRecoveryAllowsTool(toolName string) bool {
	switch strings.TrimSpace(toolName) {
	case "computer.targets", "computer.select_target", "computer.observe", "computer.screenshot":
		return true
	default:
		return false
	}
}

// This is the only computer input provenance resolver. Evidence is an exact tool
// call ID in this Turn, never a title, question, URL or authorization credential.
// Released tool-origin input uses its canonical ToolCallID through this same path.
type computerInputEvidence struct {
	kind     string
	call     TargetToolCall
	activity *observation.ActivityItem
}

func resolveComputerInputEvidence(view flruntime.ThreadView, interaction flruntime.ThreadInteraction) *computerInputEvidence {
	if interaction.Kind != flruntime.ThreadInteractionInput || interaction.Input == nil {
		return nil
	}
	refs := interaction.Input.EvidenceRefs
	legacy := strings.HasPrefix(interaction.ID, "tool-input:")
	if legacy {
		refs = []string{interaction.ToolCallID}
	}
	var found *computerInputEvidence
	foundIndex := -1
	for _, ref := range refs {
		matched := false
		for index, item := range view.Items {
			activity := item.Activity
			if item.TurnID != interaction.TurnID || activity == nil || activity.ToolID != ref || !isComputerUseTool(activity.ToolName) || activity.Presentation == nil {
				continue
			}
			if legacy && item.RunID != interaction.RunID {
				continue
			}
			matched = true
			if found != nil {
				return nil
			}
			evidence := &computerInputEvidence{activity: activity, call: TargetToolCall{ThreadID: view.ThreadID.String(), TurnID: interaction.TurnID.String(), RunID: interaction.RunID.String(), ToolCallID: ref}}
			for _, chip := range activity.Presentation.Chips {
				if chip.Kind != "computer_assistance" {
					continue
				}
				switch chip.Value {
				case "access", "captcha", "verification", "login", "private_input", "untrusted_content", "paused", "connection", "installation":
					evidence.kind = chip.Value
				case "inspection":
					if legacy {
						evidence.kind = chip.Value
					}
				}
			}
			if evidence.kind == "" {
				continue
			}
			for _, target := range activity.Presentation.TargetRefs {
				if target.Kind == "computer_control" && target.ResourceRef != "" {
					if evidence.call.TargetID != "" {
						return nil
					}
					evidence.call.TargetID = target.ResourceRef
				}
			}
			if evidence.kind != "connection" && evidence.kind != "installation" && evidence.call.TargetID == "" {
				return nil
			}
			found, foundIndex = evidence, index
		}
		if !matched {
			return nil
		}
	}
	if found == nil {
		return nil
	}
	// Later facts for this target supersede the cited blocking observation.
	for _, item := range view.Items[foundIndex+1:] {
		if item.TurnID != interaction.TurnID || item.Activity == nil || item.Activity.Presentation == nil || !isComputerUseTool(item.Activity.ToolName) {
			continue
		}
		for _, ref := range item.Activity.Presentation.TargetRefs {
			if ref.Kind == "computer_target" && ref.ResourceRef == found.call.TargetID && found.call.TargetID != "" {
				return nil
			}
		}
	}
	return found
}

func computerControlCall(view flruntime.ThreadView, interaction flruntime.ThreadInteraction) (TargetToolCall, bool, error) {
	evidence := resolveComputerInputEvidence(view, interaction)
	if evidence == nil || evidence.kind == "connection" || evidence.kind == "installation" {
		return TargetToolCall{}, false, nil
	}
	if evidence.call.TargetID == "" {
		return TargetToolCall{}, true, errors.New("computer control target is unavailable")
	}
	return evidence.call, true, nil
}

func computerAssistanceFromEvidence(view flruntime.ThreadView, interaction flruntime.ThreadInteraction) *ComputerInputAssistance {
	evidence := resolveComputerInputEvidence(view, interaction)
	if evidence == nil {
		return nil
	}
	return &ComputerInputAssistance{Kind: evidence.kind, TargetID: evidence.call.TargetID, ToolCallID: evidence.call.ToolCallID}
}
