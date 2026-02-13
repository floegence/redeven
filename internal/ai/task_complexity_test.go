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
			userInput: "请先分析项目结构，然后给我一个实施计划。",
			wantLevel: TaskComplexityStandard,
		},
		{
			name:      "complex_multi_signal_request",
			userInput: "请对这个仓库做全面深入分析，并且分阶段给出重构计划、执行步骤和验证方案，最终输出完整结论。",
			attach: []RunAttachmentIn{
				{Name: "spec.md", MimeType: "text/markdown", URL: "file:///tmp/spec.md"},
			},
			openGoal:   "重构 agent loop",
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
				t.Fatalf("classifyTaskComplexity level=%q, want %q (score=%d, reasons=%v)", got.Level, tc.wantLevel, got.Score, got.Reasons)
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
