package ai

import (
	"strings"
	"testing"

	"github.com/floegence/redeven-agent/internal/config"
)

func TestClassifyRunPolicy_UsesModelDecision(t *testing.T) {
	t.Parallel()

	got := classifyRunPolicy("hello", nil, "", false, func() (runPolicyDecision, error) {
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

	got := classifyRunPolicy("please analyze this repository architecture", nil, "", false, func() (runPolicyDecision, error) {
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

func TestClassifyRunPolicy_ModelControlsContinuationObjectiveMode(t *testing.T) {
	t.Parallel()

	got := classifyRunPolicy("continue", nil, "fix startup failure", false, func() (runPolicyDecision, error) {
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

	got := classifyRunPolicy("take a look at this", []RunAttachmentIn{{URL: "file:///tmp/a.txt"}}, "", false, nil)
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

func TestBuildRunPolicyClassifierMessages_GuidedStructuredInteractionsAreTask(t *testing.T) {
	t.Parallel()

	msgs := buildRunPolicyClassifierMessages("请你和我一问一答猜我的岁数，每个问题都提供几个选项", "", false)
	if len(msgs) != 2 {
		t.Fatalf("message count=%d, want 2", len(msgs))
	}
	system := msgs[0].Content[0].Text
	if !strings.Contains(system, "guided structured interaction") {
		t.Fatalf("system prompt missing guided structured interaction guidance: %q", system)
	}
	if !strings.Contains(system, structuredClassifierRunPolicyToolName) {
		t.Fatalf("system prompt missing classifier tool name: %q", system)
	}
	if !strings.Contains(system, "questionnaires, interviews, quizzes, guessing games, decision trees, and multi-step option-driven conversations") {
		t.Fatalf("system prompt missing structured interaction examples: %q", system)
	}
	if !strings.Contains(system, "casual freeform chat") {
		t.Fatalf("system prompt missing narrowed social guidance: %q", system)
	}
	if !strings.Contains(system, "interaction_contract") {
		t.Fatalf("system prompt missing interaction_contract contract: %q", system)
	}
	if !strings.Contains(system, "open_text_fallback_required") {
		t.Fatalf("system prompt missing open fallback guidance: %q", system)
	}
	if !strings.Contains(system, "indirect_questions_only") {
		t.Fatalf("system prompt missing indirect-question guidance: %q", system)
	}
}

func TestClassifyRunPolicy_StructuredResponseForcesContinuation(t *testing.T) {
	t.Parallel()

	got := classifyRunPolicy("Streaming apps", nil, "Run a guided music-preference questionnaire", true, func() (runPolicyDecision, error) {
		return runPolicyDecision{
			Intent:           RunIntentSocial,
			Reason:           "small_talk_detected_by_model",
			Source:           RunIntentSourceModel,
			ObjectiveMode:    RunObjectiveModeReplace,
			Complexity:       TaskComplexitySimple,
			TodoPolicy:       TodoPolicyNone,
			MinimumTodoItems: 0,
			Confidence:       0.82,
		}, nil
	})
	if got.Intent != RunIntentTask {
		t.Fatalf("intent=%q, want %q", got.Intent, RunIntentTask)
	}
	if got.ObjectiveMode != RunObjectiveModeContinue {
		t.Fatalf("objective_mode=%q, want %q", got.ObjectiveMode, RunObjectiveModeContinue)
	}
	if got.Reason != "structured_response_continuation" {
		t.Fatalf("reason=%q, want structured_response_continuation", got.Reason)
	}
	if got.Source != RunIntentSourceDeterministic {
		t.Fatalf("source=%q, want %q", got.Source, RunIntentSourceDeterministic)
	}
}

func TestClassifyRunPolicy_StructuredResponseContinuationSkipsModelClassifier(t *testing.T) {
	t.Parallel()

	called := false
	got := classifyRunPolicy("Streaming apps", nil, "Run a guided music-preference questionnaire", true, func() (runPolicyDecision, error) {
		called = true
		return runPolicyDecision{}, nil
	})
	if called {
		t.Fatalf("model classifier should be skipped for structured response continuations")
	}
	if got.ObjectiveMode != RunObjectiveModeContinue {
		t.Fatalf("objective_mode=%q, want %q", got.ObjectiveMode, RunObjectiveModeContinue)
	}
}

func TestParseModelRunPolicyDecision_CodeFenceJSON(t *testing.T) {
	t.Parallel()

	got, err := parseModelRunPolicyDecision("```json\n{\"intent\":\"task\",\"reason\":\"needs_multi_step_execution\",\"objective_mode\":\"replace\",\"complexity\":\"complex\",\"todo_policy\":\"required\",\"minimum_todo_items\":4,\"confidence\":0.91,\"interaction_contract\":{\"enabled\":true,\"reason\":\"guided_interaction_requested\",\"single_question_per_turn\":true,\"fixed_choices_required\":true,\"open_text_fallback_required\":true,\"indirect_questions_only\":true,\"confidence\":0.87}}\n```")
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
	if !got.InteractionContract.Enabled {
		t.Fatalf("interaction contract should be enabled")
	}
	if !got.InteractionContract.MustUseStructuredAskUser {
		t.Fatalf("must_use_structured_ask_user=false, want true")
	}
	if !got.InteractionContract.OpenTextFallbackRequired {
		t.Fatalf("open_text_fallback_required=false, want true")
	}
	if !got.InteractionContract.DisallowDirectTargetAttribute {
		t.Fatalf("disallow_direct_target_attribute=false, want true")
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
