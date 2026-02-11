package main

import "testing"

func TestDetectPhasePingPong(t *testing.T) {
	t.Parallel()
	flow := []string{
		"completion:needs_synthesis_after_tool_calls",
		"task:analysis_requires_more_evidence",
		"completion:needs_synthesis_after_tool_calls",
		"task:analysis_requires_more_evidence",
		"completion:needs_synthesis_after_tool_calls",
		"task:analysis_requires_more_evidence",
	}
	if !detectPhasePingPong(flow) {
		t.Fatalf("expected ping-pong detection")
	}
}

func TestEvaluateGate_RejectWhenRecommendedFails(t *testing.T) {
	t.Parallel()
	variants := []evalVariant{
		{ID: "v_a", PromptProfile: "p1", LoopProfile: "l1"},
		{ID: "v_b", PromptProfile: "p2", LoopProfile: "l2"},
	}
	metrics := map[string]variantMetrics{
		"v_a": {
			VariantID:           "v_a",
			PassRate:            0.9,
			LoopSafetyRate:      0.98,
			RecoverySuccessRate: 0.92,
			FallbackFreeRate:    0.99,
			AverageAccuracy:     90,
			AverageOverall:      88,
		},
		"v_b": {
			VariantID:           "v_b",
			PassRate:            0.6,
			LoopSafetyRate:      0.7,
			RecoverySuccessRate: 0.5,
			FallbackFreeRate:    0.6,
			AverageAccuracy:     50,
			AverageOverall:      92,
		},
	}
	baselines := benchmarkBaselines{Sources: map[string]benchmarkMetrics{
		"codex": {
			PassRate:            0.85,
			LoopSafetyRate:      0.95,
			RecoverySuccessRate: 0.85,
			FallbackFreeRate:    0.95,
			AverageAccuracy:     80,
		},
	}}
	thresholds := gateThresholds{
		MinPassRate:         0.8,
		MinLoopSafetyRate:   0.9,
		MinFallbackFreeRate: 0.9,
		MinAverageAccuracy:  75,
	}
	report := evaluateGate(variants, metrics, baselines, thresholds, evalVariant{ID: "v_b"})
	if report.Status != "reject" {
		t.Fatalf("status=%s, want reject", report.Status)
	}
}

func TestAssessTaskOutcome_FallbackFails(t *testing.T) {
	t.Parallel()
	task := evalTask{
		ID:              "t1",
		RequireEvidence: true,
		MustContain:     []string{"结论|conclusion"},
		Forbidden:       []string{"No response"},
		HardFailEvents:  []string{"turn.loop.exhausted"},
	}
	result := taskResult{
		Task:          task,
		WorkspacePath: "/workspace",
		FinalText:     "I have reached the current automatic loop limit. Reply with one concrete next step.",
		Turns: []turnMetrics{{
			LoopExhausted: true,
		}},
	}
	outcome := assessTaskOutcome(task, result)
	if outcome.Passed {
		t.Fatalf("expected failure outcome")
	}
	if outcome.LoopSafe {
		t.Fatalf("expected loop unsafe outcome")
	}
}
