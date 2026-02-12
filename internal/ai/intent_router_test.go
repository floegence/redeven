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
			Confidence:    0.92,
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
			Confidence:    0.88,
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

	got, err := parseModelIntentDecision("```json\n{\"intent\":\"social\",\"confidence\":0.85,\"reason\":\"casual_chat\"}\n```")
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
