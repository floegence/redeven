package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/floret/v7/observation"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestComputerBlockingFactsDoNotCreateQuestionsOrSuccess(t *testing.T) {
	for _, reason := range []string{"captcha", "otp", "login", "secret_input", "user_control", "target_focus_changed", "input_monitor_unavailable"} {
		t.Run(reason, func(t *testing.T) {
			safety := InteractionSafetyDecision{ReasonCodes: []string{reason}}
			execution, failure := computerBlockedExecution(TargetToolCall{ToolCallID: "inspect"}, TargetDescriptor{ID: "browser-main"}, safety,
				TargetToolResult{Result: map[string]any{"action_executed": true, "completed_actions": []string{"click"}}})
			if !takeoverResult(TargetToolResult{}, failure) {
				t.Fatal("blocking result reported success")
			}
			data := execution.Payload.(map[string]any)
			if data["safety"].(*InteractionSafetyDecision).ReasonCodes[0] != reason {
				t.Fatal("pause reason lost at model boundary")
			}
			if data["action_executed"] != true || len(data["completed_actions"].([]string)) != 1 {
				t.Fatal("completed effect lost")
			}
			presentation, err := floretActivityForToolResult(nil, ToolResult{ToolID: "inspect", ToolName: "computer.observe", Status: toolResultStatusError, Data: execution.Payload})
			if err != nil {
				t.Fatal(err)
			}
			public := publicActivityItem(observation.ActivityItem{ItemID: "step", ToolID: "inspect", ToolName: "computer.observe", Kind: observation.ActivityKindTool, Status: observation.ActivityStatusError, Presentation: presentation})
			if public.Presentation == nil {
				t.Fatal("facts lost")
			}
			found := false
			for _, chip := range public.Presentation.Chips {
				if chip.Kind == "computer_assistance" && chip.Value == computerAssistanceKind(safety) {
					found = true
				}
			}
			if !found {
				t.Fatalf("reason lost: %+v", public.Presentation)
			}
		})
	}
}

func TestDesktopSetupAssistanceRequiresConfirmedUndispatchedPrivateTarget(t *testing.T) {
	for _, variant := range []string{"confirmed", "executed", "unknown", "other-target", "other-kind", "success", "uncertain", "no-error", "other-error"} {
		t.Run(variant, func(t *testing.T) {
			data := map[string]any{"desktop_setup_required": true, "action_executed": false, "target_id": "xvfb-main", "target_kind": "xvfb.desktop"}
			result := ToolResult{ToolID: "blocked", ToolName: "computer.exec", Status: toolResultStatusError, Data: data, Error: &aitools.ToolError{Code: aitools.ErrorCodeTargetSetupRequired}}
			switch variant {
			case "executed":
				data["action_executed"] = true
			case "unknown":
				delete(data, "action_executed")
			case "other-target":
				data["target_id"] = "other"
			case "other-kind":
				data["target_kind"] = "browser.managed"
			case "success":
				result.Status = toolResultStatusSuccess
				result.Error = nil
			case "uncertain":
				result.effectUncertain = true
			case "no-error":
				result.Error = nil
			case "other-error":
				result.Error = &aitools.ToolError{Code: aitools.ErrorCodeUnknown}
			}
			presentation, err := floretActivityForToolResult(nil, result)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, chip := range presentation.Chips {
				found = found || chip.Kind == "computer_assistance" && chip.Value == "desktop_setup"
			}
			if found != (variant == "confirmed") {
				t.Fatalf("setup assistance = %t", found)
			}
			encoded, err := floretToolResultFromFlower(nil, result)
			if err != nil || encoded.InputRequired != nil {
				t.Fatalf("failure invented a question: %+v %v", encoded.InputRequired, err)
			}
			if variant == "confirmed" && (!strings.Contains(encoded.Text, `"desktop_setup_required":true`) || !strings.Contains(encoded.Text, `"action_executed":false`)) {
				t.Fatalf("model-visible facts lost: %s", encoded.Text)
			}
		})
	}
}

func TestDesktopSetupFailurePreservesEvidenceWithoutDispatch(t *testing.T) {
	host, executor, store, _ := computerBindingFixture(t)
	executor.readinessErr = &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "window_manager_missing"}
	if err := host.registry.Register(TargetDescriptor{ID: "xvfb-main", Kind: "xvfb.desktop", State: "stopped"}); err != nil {
		t.Fatal(err)
	}
	host.executors["xvfb-main"] = executor
	r := &run{threadID: "thread-first", targetResolver: host, targetToolExecutor: host}
	bindTargetTestRun(t, r)
	result, err := r.execTargetTool(computerAuthorizedTestContext(t, r, "blocked", "computer.exec"), "blocked", "computer.exec", map[string]any{"target": "xvfb-main", "code": "await ui.click(1,1)"})
	if err == nil {
		t.Fatal("missing desktop reported success")
	}
	output, ok := result.(toolExecutionOutput)
	if !ok {
		t.Fatalf("missing execution facts: %#v", result)
	}
	data, ok := output.Payload.(map[string]any)
	if !ok || data["desktop_setup_required"] != true || data["action_executed"] != false || data["target_id"] != "xvfb-main" {
		t.Fatalf("wrong readiness facts: %#v", output.Payload)
	}
	if len(executor.calls) != 0 {
		t.Fatal("input dispatched before desktop readiness")
	}
	bound, err := store.GetComputerTarget(t.Context(), "thread-first")
	if err != nil || bound != "" {
		t.Fatalf("readiness failure changed selection: %q %v", bound, err)
	}
}

func TestComputerAssistanceUsesObservedControlsNotWords(t *testing.T) {
	for _, url := range []string{"https://example.test/docs/login", "https://example.test/search?q=captcha"} {
		decision, err := (defaultInteractionSafetyGate{}).AssessInteraction(context.Background(), TargetToolCall{
			ToolName: "computer.type", Arguments: json.RawMessage(`{"text":"password manager comparison"}`),
		}, TargetDescriptor{ID: "browser-main", Ready: true, CurrentURL: url})
		if err != nil || decision.Level != "routine" {
			t.Fatalf("ordinary page/text requested manual input: %+v %v", decision, err)
		}
	}
}

func TestComputerControlErrorDetailsDescribeOnlyConfirmedSafeFacts(t *testing.T) {
	safety := &InteractionSafetyDecision{ReasonCodes: []string{"captcha"}}
	err := &targetToolPolicyError{code: "interaction_takeover_required", safety: safety}
	details := ComputerControlErrorDetails(err)
	if details["computer_assistance"].(map[string]any)["kind"] != "captcha" {
		t.Fatalf("new blocker lost: %v", details)
	}
	safety.RequiredOrigin = "https://user:secret@example.test/private?token=secret"
	safety.RequiredApp = "/private/path"
	body, marshalErr := json.Marshal(ComputerControlErrorDetails(err))
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	if strings.Contains(string(body), "secret") || strings.Contains(string(body), "/private") {
		t.Fatalf("private details exposed: %s", body)
	}
}
