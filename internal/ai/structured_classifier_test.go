package ai

import "testing"

func TestStructuredClassifierResultPayload_PrefersToolPayload(t *testing.T) {
	t.Parallel()

	got := structuredClassifierResultPayload(TurnResult{
		Text:      `{"intent":"social"}`,
		Reasoning: `{"intent":"creative","reason":"wrong"}`,
		ToolCalls: []ToolCall{{
			Name: structuredClassifierRunPolicyToolName,
			Args: map[string]any{
				"intent":             "task",
				"reason":             "actionable_request_detected",
				"objective_mode":     "replace",
				"complexity":         "standard",
				"todo_policy":        "recommended",
				"minimum_todo_items": 0,
				"confidence":         0.91,
				"interaction_contract": map[string]any{
					"enabled":                     true,
					"reason":                      "guided_interaction_requested",
					"single_question_per_turn":    true,
					"fixed_choices_required":      true,
					"open_text_fallback_required": true,
					"indirect_questions_only":     false,
					"confidence":                  0.83,
				},
			},
		}},
	}, structuredClassifierRunPolicyToolName)
	want := `{"complexity":"standard","confidence":0.91,"intent":"task","interaction_contract":{"confidence":0.83,"enabled":true,"fixed_choices_required":true,"indirect_questions_only":false,"open_text_fallback_required":true,"reason":"guided_interaction_requested","single_question_per_turn":true},"minimum_todo_items":0,"objective_mode":"replace","reason":"actionable_request_detected","todo_policy":"recommended"}`
	if got != want {
		t.Fatalf("structuredClassifierResultPayload=%q, want %q", got, want)
	}
}
