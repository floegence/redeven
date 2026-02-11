package main

import "testing"

func TestEvaluateReplay_FallbackMessageFails(t *testing.T) {
	t.Parallel()
	reasons := evaluateReplay("I have reached the current automatic loop limit. Reply with one concrete next step.", 8)
	if len(reasons) == 0 {
		t.Fatalf("expected failure reasons")
	}
}

func TestEvaluateReplay_NormalConclusionPasses(t *testing.T) {
	t.Parallel()
	reasons := evaluateReplay("Findings: project structure clear. Evidence: /workspace/README.md. Conclusion: ready.", 3)
	if len(reasons) != 0 {
		t.Fatalf("unexpected reasons: %v", reasons)
	}
}
