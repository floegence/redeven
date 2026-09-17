package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/floret/v7/observation"
)

func TestComputerAssistanceExplainsTheRequiredStep(t *testing.T) {
	for _, tc := range []struct {
		name   string
		safety InteractionSafetyDecision
		want   string
	}{
		{"site", InteractionSafetyDecision{RequiredOrigin: "https://www.google.com", ReasonCodes: []string{"site_permission"}}, "https://www.google.com"},
		{"captcha", InteractionSafetyDecision{ReasonCodes: []string{"captcha"}}, "CAPTCHA"},
		{"otp", InteractionSafetyDecision{ReasonCodes: []string{"otp", "secret_input"}}, "verification code"},
		{"login", InteractionSafetyDecision{ReasonCodes: []string{"login", "secret_input"}}, "Sign in"},
		{"unknown", InteractionSafetyDecision{ReasonCodes: []string{"unknown"}}, "could not safely inspect"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := computerTakeoverExecution(TargetToolCall{ToolCallID: "step"}, TargetDescriptor{ID: "browser-main", DisplayName: "Task browser"}, tc.safety)
			prompt := result.inputRequired.Summary + " " + result.inputRequired.Questions[0].Prompt
			if !strings.Contains(prompt, tc.want) {
				t.Fatalf("missing specific guidance %q: %s", tc.want, prompt)
			}
			if tc.name == "site" && strings.Contains(prompt, "return control") {
				t.Fatal("site permission requires a fictitious handoff")
			}
		})
	}
}

func TestComputerAssistanceSurvivesCanonicalActivityProjection(t *testing.T) {
	for _, reason := range []string{"captcha", "otp", "login", "secret_input", "target_permission", "unknown"} {
		t.Run(reason, func(t *testing.T) {
			safety := InteractionSafetyDecision{ReasonCodes: []string{reason}}
			execution := computerTakeoverExecution(TargetToolCall{ToolCallID: "inspect"}, TargetDescriptor{ID: "browser-main"}, safety)
			presentation, err := floretActivityForToolResult(nil, ToolResult{ToolID: "inspect", ToolName: "computer.observe", Status: toolResultStatusSuccess, Data: execution.Payload, inputRequired: execution.inputRequired})
			if err != nil {
				t.Fatal(err)
			}
			public := publicActivityItem(observation.ActivityItem{ItemID: "step", ToolID: "inspect", ToolName: "computer.observe", Kind: observation.ActivityKindTool, Status: observation.ActivityStatusSuccess, Presentation: presentation})
			if public.Presentation == nil || public.Presentation.Label != execution.inputRequired.Summary {
				t.Fatal("required step disappeared from public activity")
			}
			found := false
			for _, chip := range public.Presentation.Chips {
				if chip.Kind == "computer_assistance" && chip.Value == computerAssistanceKind(safety) {
					found = true
				}
			}
			if !found {
				t.Fatalf("reason lost across canonical projection: %+v", public.Presentation)
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
