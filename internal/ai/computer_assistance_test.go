package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/floret/v7/observation"
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
