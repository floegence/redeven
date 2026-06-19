package ai

import (
	"strings"
	"testing"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestFloretControlProjector_ModelAskUserWaits(t *testing.T) {
	t.Parallel()

	projector := floretControlProjector{}
	signal, handled, err := projector.Project(fltools.ToolCall{
		ID:   "call_ask_user",
		Name: "ask_user",
		Args: `{
			"questions":[{
				"id":"branch",
				"header":"Branch",
				"question":"Which branch should I inspect?",
				"is_secret":false,
				"response_mode":"write",
				"write_label":"Branch",
				"write_placeholder":"Type a branch"
			}],
			"reason_code":"missing_external_input",
			"required_from_user":["Name the branch to inspect."],
			"evidence_refs":["message:latest"]
		}`,
	})
	if err != nil {
		t.Fatalf("Project: %v", err)
	}
	if !handled {
		t.Fatalf("ask_user should be handled")
	}
	if signal.Disposition != flruntime.SignalWaiting {
		t.Fatalf("disposition=%q, want waiting", signal.Disposition)
	}
	if signal.Name != "ask_user" {
		t.Fatalf("signal name=%q, want ask_user", signal.Name)
	}
	if got := strings.TrimSpace(signal.OutputText); got != "Which branch should I inspect?" {
		t.Fatalf("output_text=%q, want question", got)
	}
	if got := strings.TrimSpace(anyToString(signal.Payload["source"])); got != "model_signal" {
		t.Fatalf("source=%q, want model_signal", got)
	}
	if signal.Activity == nil {
		t.Fatal("activity is nil")
	}
	spec := aitools.MustPresentationSpec("ask_user")
	if signal.Activity.Renderer != observation.ActivityRenderer(spec.Renderer) {
		t.Fatalf("activity renderer=%q, want registry renderer %q", signal.Activity.Renderer, spec.Renderer)
	}
	if signal.Activity.Label != spec.ResultLabelFallback {
		t.Fatalf("activity label=%q, want registry fallback %q", signal.Activity.Label, spec.ResultLabelFallback)
	}
	if got := strings.TrimSpace(anyToString(signal.Activity.Payload["reason_code"])); got != AskUserReasonMissingExternalInput {
		t.Fatalf("activity reason_code=%q, want %q", got, AskUserReasonMissingExternalInput)
	}
	if got := strings.TrimSpace(anyToString(signal.Activity.Payload["question"])); got != "Which branch should I inspect?" {
		t.Fatalf("activity question=%q, want normalized first question", got)
	}
	if _, ok := signal.Activity.Payload["source"]; ok {
		t.Fatalf("activity payload must be projected from registry fields only: %#v", signal.Activity.Payload)
	}
}

func TestFloretControlProjector_TaskCompleteActivityUsesPresentationSpec(t *testing.T) {
	t.Parallel()

	projector := floretControlProjector{}
	signal, handled, err := projector.Project(fltools.ToolCall{
		ID:   "call_task_complete",
		Name: "task_complete",
		Args: `{
			"result":"Done",
			"evidence_refs":["tool:terminal.exec"],
			"remaining_risks":["No remote CI run"],
			"next_actions":["Review output"]
		}`,
	})
	if err != nil {
		t.Fatalf("Project: %v", err)
	}
	if !handled {
		t.Fatalf("task_complete should be handled")
	}
	if signal.Disposition != flruntime.SignalTerminal {
		t.Fatalf("disposition=%q, want terminal", signal.Disposition)
	}
	if signal.Activity == nil {
		t.Fatal("activity is nil")
	}
	spec := aitools.MustPresentationSpec("task_complete")
	if signal.Activity.Renderer != observation.ActivityRenderer(spec.Renderer) {
		t.Fatalf("activity renderer=%q, want registry renderer %q", signal.Activity.Renderer, spec.Renderer)
	}
	if signal.Activity.Label != spec.ResultLabelFallback {
		t.Fatalf("activity label=%q, want registry fallback %q", signal.Activity.Label, spec.ResultLabelFallback)
	}
	if signal.Activity.Payload["result"] != "Done" {
		t.Fatalf("activity payload=%#v, want result", signal.Activity.Payload)
	}
	if _, ok := signal.Activity.Payload["output"]; ok {
		t.Fatalf("activity payload must be projected from registry fields only: %#v", signal.Activity.Payload)
	}
	if risks := toAnySlice(signal.Activity.Payload["remaining_risks"]); len(risks) != 1 || risks[0] != "No remote CI run" {
		t.Fatalf("remaining_risks=%#v, want projected risk", signal.Activity.Payload["remaining_risks"])
	}
}

func TestFloretControlSignalActivityUsesPresentationSpecFields(t *testing.T) {
	t.Parallel()

	activity := floretActivityForControlSignal("exit_plan_mode", map[string]any{
		"source":  "exit_plan_mode",
		"summary": "Need approval before editing.",
		"allowed_prompts": []ExitPlanPromptRef{{
			Tool:   "apply_patch",
			Prompt: "Allow file edits",
		}},
		"waiting_prompt": &RequestUserInputPrompt{PromptID: "prompt_1"},
	}, "Review the plan before edits.")
	if activity == nil {
		t.Fatal("activity is nil")
	}
	spec := aitools.MustPresentationSpec("exit_plan_mode")
	if activity.Renderer != observation.ActivityRenderer(spec.Renderer) {
		t.Fatalf("activity renderer=%q, want registry renderer %q", activity.Renderer, spec.Renderer)
	}
	if activity.Label != spec.ResultLabelFallback {
		t.Fatalf("activity label=%q, want registry fallback %q", activity.Label, spec.ResultLabelFallback)
	}
	if activity.Description != "Review the plan before edits." {
		t.Fatalf("activity description=%q, want prompt question", activity.Description)
	}
	if activity.Payload["summary"] != "Need approval before editing." {
		t.Fatalf("payload=%#v, want summary", activity.Payload)
	}
	if prompts := toAnySlice(activity.Payload["allowed_prompts"]); len(prompts) != 1 {
		t.Fatalf("allowed_prompts=%#v, want one prompt", activity.Payload["allowed_prompts"])
	}
	if _, ok := activity.Payload["waiting_prompt"]; ok {
		t.Fatalf("activity payload must be projected from registry fields only: %#v", activity.Payload)
	}
}

func TestFloretControlProjector_InvalidAskUserFailsWithoutContinueSignal(t *testing.T) {
	t.Parallel()

	projector := floretControlProjector{}
	signal, handled, err := projector.Project(fltools.ToolCall{
		ID:   "call_bad_ask_user",
		Name: "ask_user",
		Args: `{
			"questions":[{
				"id":"branch",
				"header":"Branch",
				"question":"Which branch should I inspect?",
				"is_secret":false,
				"response_mode":"write"
			}],
			"required_from_user":["Name the branch to inspect."]
		}`,
	})
	if err == nil {
		t.Fatalf("Project should reject invalid ask_user")
	}
	if !handled {
		t.Fatalf("invalid ask_user should still be handled")
	}
	if signal.Disposition == flruntime.SignalContinue {
		t.Fatalf("invalid ask_user must not become a continue signal")
	}
	if !strings.Contains(err.Error(), "invalid ask_user control signal") {
		t.Fatalf("error=%q, want invalid ask_user control signal", err)
	}
}

func TestFloretControlProjector_ExitPlanModeFailureDoesNotContinue(t *testing.T) {
	t.Parallel()

	projector := floretControlProjector{}
	signal, handled, err := projector.Project(fltools.ToolCall{
		ID:   "call_exit_plan",
		Name: "exit_plan_mode",
		Args: `{"summary":"Need to edit files."}`,
	})
	if err == nil {
		t.Fatalf("Project should reject exit_plan_mode without run projection")
	}
	if !handled {
		t.Fatalf("exit_plan_mode should be handled")
	}
	if signal.Disposition == flruntime.SignalContinue {
		t.Fatalf("exit_plan_mode failure must not become a continue signal")
	}
}
