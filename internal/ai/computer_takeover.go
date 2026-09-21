package ai

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
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
	slog.Info("computer assistance requested", "thread_id", call.ThreadID, "target_id", target.ID, "reason", computerAssistanceKind(safety))
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
	summary, prompt := computerAssistanceInstructions(safety)
	result.ActionSummary = summary
	return targetToolExecution{TargetID: target.ID, Payload: targetToolResultPayload(result, target.ID, target), inputRequired: &fltools.InputRequest{
		Summary:   summary,
		Questions: []fltools.InputQuestion{{ID: "computer_control", Prompt: prompt, Kind: "select", Options: []string{"Return control to Flower"}}},
	}}
}

func computerInstallExecution() targetToolExecution {
	return targetToolExecution{Payload: map[string]any{"browser_installation_required": true}, inputRequired: &fltools.InputRequest{
		Summary:   "Install the built-in browser?",
		Questions: []fltools.InputQuestion{{ID: "browser_install", Kind: "select", Prompt: "The built-in browser is not installed. Review the download size and choose environment download or automatic download and upload through Desktop. Nothing downloads until you confirm. You can disable this browser to continue without it and stop future installation requests.", Options: []string{"Continue with installed browser", "Continue without built-in browser"}}},
	}}
}
func computerInstallInteraction(view flruntime.ThreadView, interaction flruntime.ThreadInteraction) bool {
	if interaction.Input == nil || len(interaction.Input.Questions) != 1 || interaction.Input.Questions[0].ID != "browser_install" {
		return false
	}
	for _, item := range view.Items {
		activity := item.Activity
		if item.TurnID != interaction.TurnID || item.RunID != interaction.RunID || activity == nil || activity.ToolID != interaction.ToolCallID || activity.Presentation == nil {
			continue
		}
		for _, ref := range activity.Presentation.TargetRefs {
			if ref.Kind == "computer_browser_install" && ref.ResourceRef == "managed" {
				return true
			}
		}
	}
	return false
}

func computerConnectionExecution() targetToolExecution {
	return targetToolExecution{Payload: map[string]any{"browser_source": "system", "connection_required": true}, inputRequired: &fltools.InputRequest{
		Summary:   "Connect your system browser",
		Questions: []fltools.InputQuestion{{ID: "browser_connection", Kind: "select", Prompt: "Chrome is not currently connected. Open Connect Chrome in Flower to reconnect or set up the extension. An installed extension does not need reinstalling. Flower resumes automatically after the connection is verified and creates its own task tab. Safari browser automation is not supported by this connection. No managed browser or desktop automation will be substituted.", Options: []string{"Continue with connected browser"}}},
	}}
}

func computerConnectionInteraction(view flruntime.ThreadView, interaction flruntime.ThreadInteraction) bool {
	if interaction.Input == nil || len(interaction.Input.Questions) != 1 || interaction.Input.Questions[0].ID != "browser_connection" {
		return false
	}
	for _, item := range view.Items {
		activity := item.Activity
		if item.TurnID != interaction.TurnID || item.RunID != interaction.RunID || activity == nil || activity.ToolID != interaction.ToolCallID || activity.ToolName != "computer.targets" || activity.Presentation == nil {
			continue
		}
		for _, ref := range activity.Presentation.TargetRefs {
			if ref.Kind == "computer_browser_source" && ref.ResourceRef == "system" {
				return true
			}
		}
	}
	return false
}

// These closed display facts describe a completed tool's blocking condition.
// They neither grant access nor introduce another interaction lifecycle.
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

func computerAssistanceInstructions(safety InteractionSafetyDecision) (string, string) {
	switch computerAssistanceKind(safety) {
	case "access":
		requested := []string{}
		if safety.RequiredOrigin != "" {
			requested = append(requested, safety.RequiredOrigin)
		}
		if safety.RequiredApp != "" {
			requested = append(requested, safety.RequiredApp)
		}
		if slices.Contains(safety.ReasonCodes, "foreground_permission") {
			requested = append(requested, "temporary desktop use")
		}
		return "Allow access to continue", "Review the requested access for this task: " + strings.Join(requested, ", ") + ". Choose Allow and continue. You do not need to operate the browser."
	case "captcha":
		return "Complete the CAPTCHA", "Open the selected page and complete its human verification challenge. Then choose Done, continue. Flower will inspect the page again before resuming."
	case "verification":
		return "Enter the verification code on the page", "Open the selected page and enter the one-time verification code there. Do not send the code in the conversation. Then choose Done, continue."
	case "login":
		return "Sign in on the selected page", "Open the selected page and complete sign-in there. Passwords and verification codes stay out of the conversation. Then choose Done, continue."
	case "private_input":
		return "Complete the private input on the page", "Open the selected page and finish the password or verification field there. Do not send private values in the conversation. Then choose Done, continue."
	case "untrusted_content":
		return "Review unexpected page instructions", "The page contains instructions directed at the agent. Open the page and leave or dismiss that content before continuing; it cannot authorize changes to your task."
	case "paused":
		return "Browser or desktop actions are paused", "Finish your changes on the selected page or application, then choose Done, continue when Flower may resume."
	default:
		return "Flower could not safely inspect this page", "Open the selected page to check its current state. A sign-in or verification requirement has not been confirmed. Once the page is ready, choose Done, continue to check it again."
	}
}

// Re-observation is a host control command, never replay of the paused model
// action. Canonical tool provenance selects the target even if current changed.
func computerControlCall(view flruntime.ThreadView, interaction flruntime.ThreadInteraction) (TargetToolCall, bool, error) {
	if computerConnectionInteraction(view, interaction) || computerInstallInteraction(view, interaction) {
		return TargetToolCall{}, false, nil
	}
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
	if computerInstallInteraction(view, interaction) {
		host, err := s.browserInstaller(meta)
		if err != nil {
			return flruntime.ThreadView{}, err
		}
		state := host.browserInstallation.Snapshot()
		answer := answers["browser_install"]
		if len(answers) != 1 || (answer != "Continue with installed browser" && answer != "Continue without built-in browser") {
			return flruntime.ThreadView{}, errors.New("invalid browser installation acknowledgement")
		}
		if answer == "Continue with installed browser" {
			if _, err := host.requireManagedBrowser(); err != nil {
				return flruntime.ThreadView{}, err
			}
		} else if state.Enabled {
			return flruntime.ThreadView{}, errors.New("disable the built-in browser before continuing without it")
		}
		return respond()
	}
	if computerConnectionInteraction(view, interaction) {
		if err := requireRWX(meta); err != nil {
			return flruntime.ThreadView{}, err
		}
		if len(answers) != 1 || answers["browser_connection"] != "Continue with connected browser" {
			return flruntime.ThreadView{}, errors.New("invalid browser connection acknowledgement")
		}
		host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
		if !ok {
			return flruntime.ThreadView{}, errors.New("computer runtime is unavailable")
		}
		inventory, err := host.ComputerTargets(ctx, TargetToolCall{ThreadID: string(view.ThreadID), ToolName: "computer.targets", Arguments: json.RawMessage(`{"browser_source":"system"}`)}, s.ToolTargetPolicy())
		if err != nil {
			return flruntime.ThreadView{}, err
		}
		if inventory.ConnectionRequired {
			return flruntime.ThreadView{}, &targetToolPolicyError{code: "target_connection_required"}
		}
		return respond()
	}
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
			control.pauseForUser()
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
