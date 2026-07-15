package ai

import "testing"

func TestNormalizeSubagentTaskName(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		raw       string
		fallback  string
		agentType string
		want      string
	}{
		{name: "canonical", raw: "Safety Review", agentType: "reviewer", want: "Safety Review"},
		{name: "snake case initialisms", raw: "ai_oss_projects", agentType: "explore", want: "AI OSS Projects"},
		{name: "kebab case", raw: "api-contract-review", agentType: "reviewer", want: "API Contract Review"},
		{name: "camel case", raw: "runtimeSafetyReview", agentType: "reviewer", want: "Runtime Safety Review"},
		{name: "punctuation", raw: "  UI / runtime: review!  ", agentType: "reviewer", want: "UI Runtime Review"},
		{name: "five word limit", raw: "review the public API contract implementation details", agentType: "reviewer", want: "Review The Public API Contract"},
		{name: "fallback source", fallback: "inspect current CPU usage safely", agentType: "explore", want: "Inspect Current CPU Usage Safely"},
		{name: "non english explore fallback", fallback: "检查当前运行状态", agentType: "explore", want: "Research Task"},
		{name: "non english worker fallback", fallback: "实现界面重构", agentType: "worker", want: "Implementation Task"},
		{name: "non english reviewer fallback", fallback: "检查安全边界", agentType: "reviewer", want: "Review Task"},
		{name: "long first word", raw: "supercalifragilisticexpialidocioussupercalifragilistic review", agentType: "reviewer", want: "Supercalifragilisticexpialidocioussupercalifragi"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := normalizeSubagentTaskName(test.raw, test.fallback, test.agentType); got != test.want {
				t.Fatalf("normalizeSubagentTaskName(%q, %q, %q)=%q, want %q", test.raw, test.fallback, test.agentType, got, test.want)
			}
		})
	}
}

func TestResolveSubagentTaskNameUsesLegacyTitleBeforeDescription(t *testing.T) {
	t.Parallel()

	got := resolveSubagentTaskName("", "ai_industry_news", "Collect current AI industry news.", "", "", subagentAgentTypeExplore)
	if got != "AI Industry News" {
		t.Fatalf("resolveSubagentTaskName()=%q, want %q", got, "AI Industry News")
	}
}
