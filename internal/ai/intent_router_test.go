package ai

import (
	"testing"

	"github.com/floegence/redeven-agent/internal/config"
)

func TestClassifyRunPolicy_UsesModelDecision(t *testing.T) {
	t.Parallel()

	got := classifyRunPolicy("hello", nil, "", func() (runPolicyDecision, error) {
		return runPolicyDecision{
			Intent:           RunIntentSocial,
			Reason:           "small_talk_detected_by_model",
			Source:           RunIntentSourceModel,
			ObjectiveMode:    RunObjectiveModeReplace,
			Complexity:       TaskComplexitySimple,
			TodoPolicy:       TodoPolicyNone,
			MinimumTodoItems: 0,
			Confidence:       0.95,
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
	if got.TodoPolicy != TodoPolicyNone {
		t.Fatalf("todo_policy=%q, want %q", got.TodoPolicy, TodoPolicyNone)
	}
}

func TestClassifyRunPolicy_ModelFailureFallsBackToTask(t *testing.T) {
	t.Parallel()

	got := classifyRunPolicy("please analyze this repository architecture", nil, "", func() (runPolicyDecision, error) {
		return runPolicyDecision{}, assertErr{}
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
	if got.TodoPolicy != TodoPolicyRecommended {
		t.Fatalf("todo_policy=%q, want %q", got.TodoPolicy, TodoPolicyRecommended)
	}
}

func TestClassifyRunPolicy_ModelRetrySucceeds(t *testing.T) {
	t.Parallel()

	calls := 0
	got := classifyRunPolicy("你是谁", nil, "", func() (runPolicyDecision, error) {
		calls++
		if calls == 1 {
			return runPolicyDecision{}, assertErr{}
		}
		return runPolicyDecision{
			Intent:           RunIntentSocial,
			Reason:           "greeting_asking_identity",
			ObjectiveMode:    RunObjectiveModeReplace,
			Complexity:       TaskComplexitySimple,
			TodoPolicy:       TodoPolicyNone,
			MinimumTodoItems: 0,
			Confidence:       0.9,
		}, nil
	})
	if calls != 2 {
		t.Fatalf("classify calls=%d, want 2", calls)
	}
	if got.Intent != RunIntentSocial {
		t.Fatalf("intent=%q, want %q", got.Intent, RunIntentSocial)
	}
	if got.Source != RunIntentSourceModel {
		t.Fatalf("source=%q, want %q", got.Source, RunIntentSourceModel)
	}
}

func TestClassifyRunPolicy_ModelControlsContinuationObjectiveMode(t *testing.T) {
	t.Parallel()

	got := classifyRunPolicy("continue", nil, "fix startup failure", func() (runPolicyDecision, error) {
		return runPolicyDecision{
			Intent:           RunIntentTask,
			Reason:           "follow_up_to_open_goal",
			ObjectiveMode:    RunObjectiveModeContinue,
			Complexity:       TaskComplexityStandard,
			TodoPolicy:       TodoPolicyRecommended,
			MinimumTodoItems: 0,
			Confidence:       0.88,
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

func TestClassifyRunPolicy_TaskByAttachment(t *testing.T) {
	t.Parallel()

	got := classifyRunPolicy("take a look at this", []RunAttachmentIn{{URL: "file:///tmp/a.txt"}}, "", nil)
	if got.Intent != RunIntentTask {
		t.Fatalf("intent=%q, want %q", got.Intent, RunIntentTask)
	}
	if got.Source != RunIntentSourceDeterministic {
		t.Fatalf("source=%q, want %q", got.Source, RunIntentSourceDeterministic)
	}
	if got.Complexity != TaskComplexityStandard {
		t.Fatalf("complexity=%q, want %q", got.Complexity, TaskComplexityStandard)
	}
	if got.TodoPolicy != TodoPolicyRecommended {
		t.Fatalf("todo_policy=%q, want %q", got.TodoPolicy, TodoPolicyRecommended)
	}
}

func TestParseModelRunPolicyDecision_CodeFenceJSON(t *testing.T) {
	t.Parallel()

	got, err := parseModelRunPolicyDecision("```json\n{\"intent\":\"task\",\"reason\":\"needs_multi_step_execution\",\"objective_mode\":\"replace\",\"complexity\":\"complex\",\"todo_policy\":\"required\",\"minimum_todo_items\":4,\"confidence\":0.91}\n```")
	if err != nil {
		t.Fatalf("parseModelRunPolicyDecision: %v", err)
	}
	if got.Intent != RunIntentTask {
		t.Fatalf("intent=%q, want %q", got.Intent, RunIntentTask)
	}
	if got.Source != RunIntentSourceModel {
		t.Fatalf("source=%q, want %q", got.Source, RunIntentSourceModel)
	}
	if got.Complexity != TaskComplexityComplex {
		t.Fatalf("complexity=%q, want %q", got.Complexity, TaskComplexityComplex)
	}
	if got.TodoPolicy != TodoPolicyRequired {
		t.Fatalf("todo_policy=%q, want %q", got.TodoPolicy, TodoPolicyRequired)
	}
	if got.MinimumTodoItems != 4 {
		t.Fatalf("minimum_todo_items=%d, want 4", got.MinimumTodoItems)
	}
}

func TestParseModelRunPolicyDecision_NonTaskForcesTodoNone(t *testing.T) {
	t.Parallel()

	got, err := parseModelRunPolicyDecision(`{"intent":"creative","reason":"story_generation_requested","objective_mode":"replace","complexity":"complex","todo_policy":"required","minimum_todo_items":8,"confidence":0.99}`)
	if err != nil {
		t.Fatalf("parseModelRunPolicyDecision: %v", err)
	}
	if got.Intent != RunIntentCreative {
		t.Fatalf("intent=%q, want %q", got.Intent, RunIntentCreative)
	}
	if got.Complexity != TaskComplexitySimple {
		t.Fatalf("complexity=%q, want %q", got.Complexity, TaskComplexitySimple)
	}
	if got.TodoPolicy != TodoPolicyNone {
		t.Fatalf("todo_policy=%q, want %q", got.TodoPolicy, TodoPolicyNone)
	}
	if got.MinimumTodoItems != 0 {
		t.Fatalf("minimum_todo_items=%d, want 0", got.MinimumTodoItems)
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
