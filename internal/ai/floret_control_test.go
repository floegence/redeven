package ai

import (
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/v4/runtime"
	fltools "github.com/floegence/floret/v4/tools"
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
	if signal.Activity.Renderer != fltools.ActivityRenderer(spec.Renderer) {
		t.Fatalf("activity renderer=%q, want registry renderer %q", signal.Activity.Renderer, spec.Renderer)
	}
	if signal.Activity.Label != spec.ResultLabelFallback {
		t.Fatalf("activity label=%q, want registry fallback %q", signal.Activity.Label, spec.ResultLabelFallback)
	}
	activityPayload, ok := signal.Activity.Payload.(fltools.QuestionActivityPayload)
	if !ok || len(activityPayload.Questions) != 1 || activityPayload.Questions[0].Question != "Which branch should I inspect?" {
		t.Fatalf("activity payload=%#v, want normalized question", signal.Activity.Payload)
	}
}

func TestFloretControlProjector_ModelAskUserWaitsWithoutEvidence(t *testing.T) {
	t.Parallel()

	projector := floretControlProjector{}
	signal, handled, err := projector.Project(fltools.ToolCall{
		ID:   "call_ask_user_without_evidence",
		Name: "ask_user",
		Args: `{
			"questions":[{
				"id":"direction",
				"header":"Direction",
				"question":"Which direction should I take?",
				"is_secret":false,
				"response_mode":"write"
			}],
			"reason_code":"user_decision_required",
			"required_from_user":["Choose the next direction."],
			"evidence_refs":[]
		}`,
	})
	if err != nil {
		t.Fatalf("Project: %v", err)
	}
	if !handled {
		t.Fatal("ask_user should be handled")
	}
	if signal.Disposition != flruntime.SignalWaiting {
		t.Fatalf("disposition=%q, want waiting", signal.Disposition)
	}
	if refs, ok := signal.Payload["evidence_refs"].([]string); !ok || len(refs) != 0 {
		t.Fatalf("evidence_refs=%#v, want an empty list", signal.Payload["evidence_refs"])
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
	if signal.Activity.Renderer != fltools.ActivityRenderer(spec.Renderer) {
		t.Fatalf("activity renderer=%q, want registry renderer %q", signal.Activity.Renderer, spec.Renderer)
	}
	if signal.Activity.Label != spec.ResultLabelFallback {
		t.Fatalf("activity label=%q, want registry fallback %q", signal.Activity.Label, spec.ResultLabelFallback)
	}
	activityPayload, ok := signal.Activity.Payload.(fltools.CompletionActivityPayload)
	if !ok || activityPayload.Summary != "Done" {
		t.Fatalf("activity payload=%#v, want result", signal.Activity.Payload)
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
				"response_mode":"select"
			}],
			"reason_code":"user_decision_required",
			"required_from_user":["Name the branch to inspect."],
			"evidence_refs":[]
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

func TestFloretControlProjector_UnknownControlSignalIsNotHandled(t *testing.T) {
	t.Parallel()

	projector := floretControlProjector{}
	signal, handled, err := projector.Project(fltools.ToolCall{
		ID:   "call_unknown_control",
		Name: "legacy_unknown_signal",
		Args: `{"summary":"Need to edit files."}`,
	})
	if err != nil {
		t.Fatalf("Project: %v", err)
	}
	if handled {
		t.Fatalf("unknown control signal must not be handled")
	}
	if signal.Name != "" || signal.Disposition != "" {
		t.Fatalf("signal=%#v, want zero signal", signal)
	}
}
