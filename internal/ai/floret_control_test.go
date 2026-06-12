package ai

import (
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
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
