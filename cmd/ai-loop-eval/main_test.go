package main

import "testing"

func TestSummarizeVariants_PenalizesStage1OnlyVariant(t *testing.T) {
	t.Parallel()

	vPromoted := evalVariant{ID: "v_promoted", PromptProfile: "p1", LoopProfile: "l1"}
	vScreenOnly := evalVariant{ID: "v_screen_only", PromptProfile: "p2", LoopProfile: "l2"}

	results := []taskResult{
		{Variant: vPromoted, Task: evalTask{ID: "openclaw_brief"}, Score: scoreBreakdown{Overall: 70}},
		{Variant: vPromoted, Task: evalTask{ID: "openclaw_deep"}, Score: scoreBreakdown{Overall: 50}},
		{Variant: vScreenOnly, Task: evalTask{ID: "openclaw_brief"}, Score: scoreBreakdown{Overall: 78}},
	}

	stage1 := map[string]float64{
		vPromoted.ID:   70,
		vScreenOnly.ID: 78,
	}
	stage2 := map[string]float64{
		vPromoted.ID: 50,
	}

	summaries := summarizeVariants([]evalVariant{vPromoted, vScreenOnly}, results, stage1, stage2)
	if len(summaries) != 2 {
		t.Fatalf("len(summaries)=%d, want 2", len(summaries))
	}

	byID := map[string]variantSummary{}
	for _, s := range summaries {
		byID[s.Variant.ID] = s
	}

	promoted := byID[vPromoted.ID]
	screenOnly := byID[vScreenOnly.ID]

	if promoted.Stage2Avg <= 0 {
		t.Fatalf("promoted Stage2Avg=%.2f, want > 0", promoted.Stage2Avg)
	}
	if screenOnly.Stage2Avg != 0 {
		t.Fatalf("screen-only Stage2Avg=%.2f, want 0", screenOnly.Stage2Avg)
	}
	if promoted.FinalOverall <= screenOnly.FinalOverall {
		t.Fatalf("promoted final=%.2f, screen-only final=%.2f, want promoted > screen-only", promoted.FinalOverall, screenOnly.FinalOverall)
	}
}

func TestMatchesRequirement_WithAlternatives(t *testing.T) {
	t.Parallel()

	if !matchesRequirement("the project has clear structure", "目录|structure|module") {
		t.Fatalf("expected matchesRequirement to match alternative token")
	}
	if matchesRequirement("short text", "风险|risk") {
		t.Fatalf("expected matchesRequirement to fail when no alternative matches")
	}
}
