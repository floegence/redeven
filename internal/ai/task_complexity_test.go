package ai

import "testing"

func TestClassifyTaskComplexity(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		userInput  string
		attach     []RunAttachmentIn
		openGoal   string
		wantLevel  string
		wantReason string
	}{
		{
			name:      "simple_short_question",
			userInput: "Explain what this function does.",
			wantLevel: TaskComplexitySimple,
		},
		{
			name:      "standard_analysis_request",
			userInput: "Analyze the repository structure first, then provide an implementation plan.",
			wantLevel: TaskComplexityStandard,
		},
		{
			name:      "complex_multi_signal_request",
			userInput: "Provide a comprehensive deep-dive of this repository, then deliver a phased refactor plan, execution steps, verification strategy, and a final report.",
			attach: []RunAttachmentIn{
				{Name: "spec.md", MimeType: "text/markdown", URL: "file:///tmp/spec.md"},
			},
			openGoal:   "refactor the agent loop",
			wantLevel:  TaskComplexityComplex,
			wantReason: "attachments_present",
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := classifyTaskComplexity(tc.userInput, tc.attach, tc.openGoal)
			if got.Level != tc.wantLevel {
				t.Fatalf("classifyTaskComplexity level=%q, want %q (reasons=%v)", got.Level, tc.wantLevel, got.Reasons)
			}
			if tc.wantReason != "" {
				found := false
				for _, reason := range got.Reasons {
					if reason == tc.wantReason {
						found = true
						break
					}
				}
				if !found {
					t.Fatalf("expected reason %q in %v", tc.wantReason, got.Reasons)
				}
			}
		})
	}
}

func TestMaybeEscalateTaskComplexity(t *testing.T) {
	t.Parallel()

	if got := maybeEscalateTaskComplexity(TaskComplexitySimple, runtimeState{}, []ToolCall{{Name: "terminal.exec"}, {Name: "apply_patch"}}, 1); got != TaskComplexityStandard {
		t.Fatalf("simple should escalate to standard, got %q", got)
	}

	state := runtimeState{
		TodoTrackingEnabled:  true,
		TodoOpenCount:        2,
		CompletedActionFacts: []string{"terminal.exec: inspected"},
		BlockedActionFacts:   []string{"apply_patch: conflict"},
	}
	if got := maybeEscalateTaskComplexity(TaskComplexityStandard, state, []ToolCall{{Name: "write_todos"}}, 2); got != TaskComplexityComplex {
		t.Fatalf("standard should escalate to complex, got %q", got)
	}
}
