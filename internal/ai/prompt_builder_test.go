package ai

import (
	"strings"
	"testing"
)

func TestPromptStaticPrefixCache_ReusesRenderedPrefix(t *testing.T) {
	t.Parallel()

	cache := newPromptStaticPrefixCache()
	key := cachedPromptPrefixKey{
		Profile:              runPromptProfileMainInteractive,
		Mode:                 "act",
		AllowUserInteraction: true,
	}

	builds := 0
	first := cache.getOrBuild(key, func() string {
		builds++
		return "static-alpha"
	})
	second := cache.getOrBuild(key, func() string {
		builds++
		return "static-beta"
	})

	if first != "static-alpha" || second != "static-alpha" {
		t.Fatalf("cache returned unexpected values: first=%q second=%q", first, second)
	}
	if builds != 1 {
		t.Fatalf("cache build count=%d, want 1", builds)
	}
}

func TestPromptDocumentRender_DoesNotCacheDynamicSections(t *testing.T) {
	t.Parallel()

	cache := newPromptStaticPrefixCache()
	key := cachedPromptPrefixKey{
		Profile:                        runPromptProfileMainInteractive,
		Mode:                           "act",
		AllowUserInteraction:           true,
		SupportsAskUserQuestionBatches: true,
	}

	doc1 := promptDocument{
		StaticSections: []promptSection{
			newPromptSection("identity", "# Identity", "static-prefix"),
		},
		DynamicSections: []promptSection{
			newPromptSection("runtime", "## Current Context", "- Objective: alpha"),
		},
	}
	doc2 := promptDocument{
		StaticSections: []promptSection{
			newPromptSection("identity", "# Identity", "static-prefix"),
		},
		DynamicSections: []promptSection{
			newPromptSection("runtime", "## Current Context", "- Objective: beta"),
		},
	}

	out1 := doc1.render(cache, key)
	out2 := doc2.render(cache, key)

	if !strings.Contains(out1, "- Objective: alpha") {
		t.Fatalf("first render missing alpha objective: %q", out1)
	}
	if !strings.Contains(out2, "- Objective: beta") {
		t.Fatalf("second render missing beta objective: %q", out2)
	}
	if strings.Contains(out2, "- Objective: alpha") {
		t.Fatalf("second render should not reuse cached dynamic objective: %q", out2)
	}
}

func TestBuildPromptRuntimeContextSection_IncludesPromptProfileAndTodoFacts(t *testing.T) {
	t.Parallel()

	section := buildPromptRuntimeContextSection(promptRuntimeSnapshot{
		WorkingDir:          "/tmp/work",
		LocalTime:           promptLocalTimeContext{CurrentDate: "2026-04-04", Timezone: "Asia/Shanghai"},
		RoundIndex:          1,
		IsFirstRound:        false,
		Mode:                "act",
		Objective:           "Ship the fix",
		TaskComplexity:      TaskComplexityComplex,
		PromptProfile:       runPromptProfileSubagentAutonomous,
		ExecutionContract:   RunExecutionContractAgenticLoop,
		CompletionContract:  completionContractExplicitOnly,
		TodoPolicy:          TodoPolicyRequired,
		RequiredTodoMinimum: 3,
		TodoStatus: promptTodoStatus{
			TrackingEnabled:  true,
			OpenCount:        2,
			InProgressCount:  1,
			SnapshotVersion:  7,
			LastUpdatedRound: 4,
		},
		RecentErrors:       []string{"terminal.exec failed"},
		AvailableToolNames: "terminal.exec, task_complete",
		AvailableSkills: []SkillMeta{
			{Name: "repo-inspector"},
		},
		InteractionContract: interactionContract{
			Enabled:                  true,
			SingleQuestionPerTurn:    true,
			FixedChoicesRequired:     true,
			OpenTextFallbackRequired: true,
		},
		AllowUserInteraction: false,
	}).render()

	for _, want := range []string{
		"- Current date: 2026-04-04",
		"- Timezone: Asia/Shanghai",
		"- Prompt profile: subagent_autonomous",
		"- Required todo minimum: 3",
		"- Interaction contract: enabled",
		"- Available skills: repo-inspector",
		"suggested parent actions",
	} {
		if !strings.Contains(section, want) {
			t.Fatalf("runtime context missing %q: %q", want, section)
		}
	}
}

func TestBuildPromptMandatoryRulesSection_UsesRuntimeDateContextForRelativeDates(t *testing.T) {
	t.Parallel()

	section := buildPromptMandatoryRulesSection(promptRuntimeSnapshot{}).render()
	want := "resolve them against the current date and timezone in runtime context"
	if !strings.Contains(section, want) {
		t.Fatalf("mandatory rules missing relative-date guidance %q: %q", want, section)
	}
}
