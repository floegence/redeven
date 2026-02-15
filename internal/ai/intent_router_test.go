package ai

import (
	"testing"

	"github.com/floegence/redeven-agent/internal/config"
)

func TestClassifyRunIntent_UsesModelDecision(t *testing.T) {
	t.Parallel()

	got := classifyRunIntent("hello", nil, "", func() (intentDecision, error) {
		return intentDecision{
			Intent:        RunIntentSocial,
			Reason:        "small_talk_detected_by_model",
			Source:        RunIntentSourceModel,
			ObjectiveMode: RunObjectiveModeReplace,
		}, nil
	})
	if got.Intent != RunIntentSocial {
		t.Fatalf("intent=%q, want %q", got.Intent, RunIntentSocial)
	}
	if got.Source != RunIntentSourceModel {
		t.Fatalf("source=%q, want %q", got.Source, RunIntentSourceModel)
	}
	if got.ObjectiveMode != RunObjectiveModeReplace {
		t.Fatalf("objective_mode=%q, want %q", got.ObjectiveMode, RunObjectiveModeReplace)
	}
}

func TestClassifyRunIntent_CreativeRequestUsesDeterministicCreativePath(t *testing.T) {
	t.Parallel()

	got := classifyRunIntent("请你用 markdown 写一篇长篇童话故事", nil, "", func() (intentDecision, error) {
		t.Fatalf("classifier should not be called for deterministic creative request")
		return intentDecision{}, nil
	})
	if got.Intent != RunIntentCreative {
		t.Fatalf("intent=%q, want %q", got.Intent, RunIntentCreative)
	}
	if got.Source != RunIntentSourceDeterministic {
		t.Fatalf("source=%q, want %q", got.Source, RunIntentSourceDeterministic)
	}
	if got.Reason != "creative_request_detected" {
		t.Fatalf("reason=%q, want creative_request_detected", got.Reason)
	}
	if got.ObjectiveMode != RunObjectiveModeReplace {
		t.Fatalf("objective_mode=%q, want %q", got.ObjectiveMode, RunObjectiveModeReplace)
	}
}

func TestClassifyRunIntent_ModelFailureFallsBackToTask(t *testing.T) {
	t.Parallel()

	got := classifyRunIntent("please analyze this repository architecture", nil, "", func() (intentDecision, error) {
		return intentDecision{}, assertErr{}
	})
	if got.Intent != RunIntentTask {
		t.Fatalf("intent=%q, want %q", got.Intent, RunIntentTask)
	}
	if got.Source != RunIntentSourceDeterministic {
		t.Fatalf("source=%q, want %q", got.Source, RunIntentSourceDeterministic)
	}
	if got.Reason != "model_classifier_failed" {
		t.Fatalf("reason=%q, want model_classifier_failed", got.Reason)
	}
}

func TestClassifyRunIntent_ModelControlsContinuationObjectiveMode(t *testing.T) {
	t.Parallel()

	got := classifyRunIntent("continue", nil, "fix startup failure", func() (intentDecision, error) {
		return intentDecision{
			Intent:        RunIntentTask,
			Reason:        "follow_up_to_open_goal",
			ObjectiveMode: RunObjectiveModeContinue,
		}, nil
	})
	if got.Intent != RunIntentTask {
		t.Fatalf("intent=%q, want %q", got.Intent, RunIntentTask)
	}
	if got.Source != RunIntentSourceModel {
		t.Fatalf("source=%q, want %q", got.Source, RunIntentSourceModel)
	}
	if got.ObjectiveMode != RunObjectiveModeContinue {
		t.Fatalf("objective_mode=%q, want %q", got.ObjectiveMode, RunObjectiveModeContinue)
	}
}

func TestClassifyRunIntent_TaskByAttachment(t *testing.T) {
	t.Parallel()

	got := classifyRunIntent("take a look at this", []RunAttachmentIn{{URL: "file:///tmp/a.txt"}}, "", nil)
	if got.Intent != RunIntentTask {
		t.Fatalf("intent=%q, want %q", got.Intent, RunIntentTask)
	}
	if got.Source != RunIntentSourceDeterministic {
		t.Fatalf("source=%q, want %q", got.Source, RunIntentSourceDeterministic)
	}
}

func TestParseModelIntentDecision_CodeFenceJSON(t *testing.T) {
	t.Parallel()

	got, err := parseModelIntentDecision("```json\n{\"intent\":\"social\",\"reason\":\"casual_chat\",\"objective_mode\":\"replace\"}\n```")
	if err != nil {
		t.Fatalf("parseModelIntentDecision: %v", err)
	}
	if got.Intent != RunIntentSocial {
		t.Fatalf("intent=%q, want %q", got.Intent, RunIntentSocial)
	}
	if got.Source != RunIntentSourceModel {
		t.Fatalf("source=%q, want %q", got.Source, RunIntentSourceModel)
	}
	if got.ObjectiveMode != RunObjectiveModeReplace {
		t.Fatalf("objective_mode=%q, want %q", got.ObjectiveMode, RunObjectiveModeReplace)
	}
}

func TestParseModelIntentDecision_Creative(t *testing.T) {
	t.Parallel()

	got, err := parseModelIntentDecision(`{"intent":"creative","reason":"story_generation_requested","objective_mode":"replace"}`)
	if err != nil {
		t.Fatalf("parseModelIntentDecision: %v", err)
	}
	if got.Intent != RunIntentCreative {
		t.Fatalf("intent=%q, want %q", got.Intent, RunIntentCreative)
	}
	if got.Source != RunIntentSourceModel {
		t.Fatalf("source=%q, want %q", got.Source, RunIntentSourceModel)
	}
	if got.ObjectiveMode != RunObjectiveModeReplace {
		t.Fatalf("objective_mode=%q, want %q", got.ObjectiveMode, RunObjectiveModeReplace)
	}
}

func TestNormalizeRunMode(t *testing.T) {
	t.Parallel()

	if got := normalizeRunMode("act", config.AIModePlan); got != config.AIModeAct {
		t.Fatalf("normalizeRunMode act=%q, want %q", got, config.AIModeAct)
	}
	if got := normalizeRunMode("plan", config.AIModeAct); got != config.AIModePlan {
		t.Fatalf("normalizeRunMode plan=%q, want %q", got, config.AIModePlan)
	}
	if got := normalizeRunMode("", config.AIModePlan); got != config.AIModePlan {
		t.Fatalf("normalizeRunMode empty fallback plan=%q, want %q", got, config.AIModePlan)
	}
	if got := normalizeRunMode("oops", config.AIModeAct); got != config.AIModeAct {
		t.Fatalf("normalizeRunMode invalid fallback act=%q, want %q", got, config.AIModeAct)
	}
}

type assertErr struct{}

func (assertErr) Error() string { return "assert error" }
