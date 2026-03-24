package ai

import "testing"

func TestStructuredClassifierResultPayload_PrefersToolPayload(t *testing.T) {
	t.Parallel()

	got := structuredClassifierResultPayload(TurnResult{
		Text:      `{"allow":false}`,
		Reasoning: `{"allow":false,"reason":"wrong"}`,
		ToolCalls: []ToolCall{{
			Name: structuredClassifierAskUserPolicyToolName,
			Args: map[string]any{
				"allow":      true,
				"reason":     "policy_allowed_by_model",
				"confidence": 0.91,
			},
		}},
	}, structuredClassifierAskUserPolicyToolName)
	want := `{"allow":true,"confidence":0.91,"reason":"policy_allowed_by_model"}`
	if got != want {
		t.Fatalf("structuredClassifierResultPayload=%q, want %q", got, want)
	}
}
