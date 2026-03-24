package ai

import (
	"strings"
	"testing"
)

func testAskUserSignal(question string) askUserSignal {
	return askUserSignal{
		Questions: []RequestUserInputQuestion{{
			ID:               "question_1",
			Header:           question,
			Question:         question,
			ResponseMode:     requestUserInputResponseModeWrite,
			WriteLabel:       "Your answer",
			WritePlaceholder: "Type your answer",
		}},
	}
}

func TestEvaluateAskUserGate(t *testing.T) {
	t.Parallel()

	if pass, reason := evaluateAskUserGate(askUserSignal{}, runtimeState{}, TaskComplexitySimple); pass || reason != "empty_question" {
		t.Fatalf("empty question => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateAskUserGate(testAskUserSignal("Should I proceed?"), runtimeState{}, TaskComplexitySimple); pass || reason != "missing_reason_code" {
		t.Fatalf("missing reason_code => pass=%v reason=%q", pass, reason)
	}

	signal := testAskUserSignal("Should I proceed?")
	signal.ReasonCode = AskUserReasonUserDecisionRequired
	if pass, reason := evaluateAskUserGate(signal, runtimeState{}, TaskComplexitySimple); pass || reason != "missing_required_from_user" {
		t.Fatalf("missing required_from_user => pass=%v reason=%q", pass, reason)
	}

	signal = testAskUserSignal("I need a permission decision.")
	signal.ReasonCode = AskUserReasonPermissionBlocked
	signal.RequiredFromUser = []string{"Approve elevated execution."}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{}, TaskComplexitySimple); pass || reason != "missing_evidence_refs" {
		t.Fatalf("missing evidence refs => pass=%v reason=%q", pass, reason)
	}

	signal = testAskUserSignal("I need a permission decision.")
	signal.ReasonCode = AskUserReasonPermissionBlocked
	signal.RequiredFromUser = []string{"Approve elevated execution."}
	signal.EvidenceRefs = []string{"tool_missing"}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{ToolCallLedger: map[string]string{"tool_1": "failed"}}, TaskComplexitySimple); pass || reason != "unresolved_evidence_refs" {
		t.Fatalf("unresolved evidence refs => pass=%v reason=%q", pass, reason)
	}

	signal = testAskUserSignal("I need a permission decision.")
	signal.ReasonCode = AskUserReasonPermissionBlocked
	signal.RequiredFromUser = []string{"Approve elevated execution."}
	signal.EvidenceRefs = []string{"tool_1"}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{ToolCallLedger: map[string]string{"tool_1": "completed"}}, TaskComplexitySimple); pass || reason != "permission_reason_without_blocked_evidence" {
		t.Fatalf("permission reason without blocked evidence => pass=%v reason=%q", pass, reason)
	}

	signal = testAskUserSignal("I need permission to continue with a privileged command.")
	signal.ReasonCode = AskUserReasonPermissionBlocked
	signal.RequiredFromUser = []string{"Approve elevated execution."}
	signal.EvidenceRefs = []string{"tool:tool_perm"}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{
		ToolCallLedger: map[string]string{"tool_perm": "failed"},
	}, TaskComplexityStandard); !pass || reason != "ok" {
		t.Fatalf("valid signal => pass=%v reason=%q", pass, reason)
	}

	signal = askUserSignal{
		Questions: []RequestUserInputQuestion{{
			ID:               "question_1",
			Header:           "Direction",
			Question:         "Pick a direction.",
			ResponseMode:     requestUserInputResponseModeWrite,
			WriteLabel:       "Custom path",
			WritePlaceholder: "Describe the custom path",
		}},
		ReasonCode:       AskUserReasonUserDecisionRequired,
		RequiredFromUser: []string{"Pick canary-first or full rollout."},
	}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{}, TaskComplexityStandard); !pass || reason != "ok" {
		t.Fatalf("explicit write response mode => pass=%v reason=%q", pass, reason)
	}

	signal = askUserSignal{
		Questions: []RequestUserInputQuestion{{
			ID:       "question_1",
			Header:   "Direction",
			Question: "Pick a direction.",
			Choices: []RequestUserInputChoice{{
				ChoiceID: "canary",
				Label:    "Canary first",
				Kind:     requestUserInputChoiceKindSelect,
			}, {
				ChoiceID: "full",
				Label:    "Full rollout",
				Kind:     requestUserInputChoiceKindSelect,
			}},
		}},
		ReasonCode:       AskUserReasonUserDecisionRequired,
		RequiredFromUser: []string{"Pick canary-first or full rollout."},
	}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{}, TaskComplexityStandard); pass || reason != askUserGateReasonMissingChoicesExhaustive {
		t.Fatalf("fixed choices without choices_exhaustive => pass=%v reason=%q", pass, reason)
	}

	signal = askUserSignal{
		Questions: []RequestUserInputQuestion{{
			ID:                "question_1",
			Header:            "Direction",
			Question:          "Pick a direction.",
			ResponseMode:      requestUserInputResponseModeSelect,
			ChoicesExhaustive: testBoolPtr(true),
			Choices: []RequestUserInputChoice{{
				ChoiceID: "canary",
				Label:    "Canary first",
				Kind:     requestUserInputChoiceKindSelect,
			}, {
				ChoiceID: "full",
				Label:    "Full rollout",
				Kind:     requestUserInputChoiceKindSelect,
			}},
		}},
		ReasonCode:       AskUserReasonUserDecisionRequired,
		RequiredFromUser: []string{"Pick canary-first or full rollout."},
	}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{}, TaskComplexityStandard); !pass || reason != "ok" {
		t.Fatalf("explicit select response mode => pass=%v reason=%q", pass, reason)
	}

	signal = askUserSignal{
		Questions: []RequestUserInputQuestion{{
			ID:                "question_1",
			Header:            "Direction",
			Question:          "Pick a direction.",
			ResponseMode:      requestUserInputResponseModeSelectText,
			ChoicesExhaustive: testBoolPtr(false),
			WriteLabel:        "None of the above",
			WritePlaceholder:  "Describe the custom path",
			Choices: []RequestUserInputChoice{{
				ChoiceID: "canary",
				Label:    "Canary first",
				Kind:     requestUserInputChoiceKindSelect,
			}, {
				ChoiceID: "full",
				Label:    "Full rollout",
				Kind:     requestUserInputChoiceKindSelect,
			}},
		}},
		ReasonCode:       AskUserReasonUserDecisionRequired,
		RequiredFromUser: []string{"Pick canary-first or full rollout."},
	}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{}, TaskComplexityStandard); !pass || reason != "ok" {
		t.Fatalf("explicit select_or_write response mode => pass=%v reason=%q", pass, reason)
	}

	signal = askUserSignal{
		Questions: []RequestUserInputQuestion{{
			ID:                "question_1",
			Header:            "Direction",
			Question:          "Pick a direction.",
			ResponseMode:      requestUserInputResponseModeSelect,
			ChoicesExhaustive: testBoolPtr(false),
			Choices: []RequestUserInputChoice{{
				ChoiceID: "canary",
				Label:    "Canary first",
				Kind:     requestUserInputChoiceKindSelect,
			}},
		}},
		ReasonCode:       AskUserReasonUserDecisionRequired,
		RequiredFromUser: []string{"Pick canary-first or full rollout."},
	}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{}, TaskComplexityStandard); pass || reason != askUserGateReasonInconsistentChoiceContract {
		t.Fatalf("select with non-exhaustive choices => pass=%v reason=%q", pass, reason)
	}

	signal = askUserSignal{
		Questions: []RequestUserInputQuestion{{
			ID:                "question_1",
			Header:            "Direction",
			Question:          "Pick a direction.",
			ResponseMode:      requestUserInputResponseModeSelectText,
			ChoicesExhaustive: testBoolPtr(true),
			Choices: []RequestUserInputChoice{{
				ChoiceID: "canary",
				Label:    "Canary first",
				Kind:     requestUserInputChoiceKindSelect,
			}},
		}},
		ReasonCode:       AskUserReasonUserDecisionRequired,
		RequiredFromUser: []string{"Pick canary-first or full rollout."},
	}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{}, TaskComplexityStandard); pass || reason != askUserGateReasonInconsistentChoiceContract {
		t.Fatalf("select_or_write with exhaustive choices => pass=%v reason=%q", pass, reason)
	}

	signal = askUserSignal{
		Questions: []RequestUserInputQuestion{{
			ID:           "question_1",
			Header:       "Direction",
			Question:     "Pick a direction.",
			ResponseMode: requestUserInputResponseModeSelect,
		}},
		ReasonCode:       AskUserReasonUserDecisionRequired,
		RequiredFromUser: []string{"Pick canary-first or full rollout."},
	}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{}, TaskComplexityStandard); pass || reason != askUserGateReasonMissingChoices {
		t.Fatalf("select response mode without fixed choices => pass=%v reason=%q", pass, reason)
	}

	signal = testAskUserSignal("I need your decision on deployment order.")
	signal.ReasonCode = AskUserReasonUserDecisionRequired
	signal.RequiredFromUser = []string{"Pick canary-first or full rollout."}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{
		TodoPolicy:       TodoPolicyRequired,
		MinimumTodoItems: 3,
	}, TaskComplexityStandard); pass || reason != todoRequirementMissingPolicyRequired {
		t.Fatalf("required todo policy without snapshot => pass=%v reason=%q", pass, reason)
	}

	signal = testAskUserSignal("I need your decision on deployment order.")
	signal.ReasonCode = AskUserReasonUserDecisionRequired
	signal.RequiredFromUser = []string{"Pick canary-first or full rollout."}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{
		TodoTrackingEnabled: true,
		TodoOpenCount:       2,
	}, TaskComplexityStandard); pass || reason != "pending_todos_without_blocker" {
		t.Fatalf("pending todos without blocker => pass=%v reason=%q", pass, reason)
	}

	signal = testAskUserSignal("Need approval for a privileged command.")
	signal.ReasonCode = AskUserReasonPermissionBlocked
	signal.RequiredFromUser = []string{"Approve elevated execution."}
	signal.EvidenceRefs = []string{"tool_1"}
	if pass, reason := evaluateAskUserGate(signal, runtimeState{
		ToolCallLedger:      map[string]string{"tool_1": "failed"},
		TodoTrackingEnabled: true,
		TodoOpenCount:       1,
		BlockedActionFacts:  []string{"terminal.exec: permission denied"},
	}, TaskComplexityComplex); !pass || reason != "ok" {
		t.Fatalf("pending todos with blocker => pass=%v reason=%q", pass, reason)
	}
}

func TestEvaluateGuardAskUserGate(t *testing.T) {
	t.Parallel()

	if pass, reason := evaluateGuardAskUserGate("tool_mistake_loop", runtimeState{
		ToolCallLedger: map[string]string{"tool_1": "failed"},
	}, TaskComplexityStandard); pass || reason != "missing_evidence_refs" {
		t.Fatalf("tool_mistake_loop without evidence => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateGuardAskUserGate("tool_mistake_loop", runtimeState{
		ToolCallLedger:      map[string]string{"tool_1": "failed"},
		BlockedEvidenceRefs: []string{"tool:tool_1"},
	}, TaskComplexityStandard); !pass || reason != "ok" {
		t.Fatalf("tool_mistake_loop with evidence => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateGuardAskUserGate("missing_explicit_completion", runtimeState{
		TodoTrackingEnabled: true,
		TodoOpenCount:       2,
	}, TaskComplexityStandard); pass || reason != "pending_todos_without_blocker" {
		t.Fatalf("pending todos without blocker => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateGuardAskUserGate("missing_explicit_completion", runtimeState{
		TodoTrackingEnabled: true,
		TodoOpenCount:       1,
		BlockedActionFacts:  []string{"tool failed due to permission"},
	}, TaskComplexityStandard); !pass || reason != "ok" {
		t.Fatalf("pending todos with blocker => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateGuardAskUserGate("complex_task_missing_todos", runtimeState{}, TaskComplexityComplex); !pass || reason != "ok" {
		t.Fatalf("complex_task_missing_todos must be allowed => pass=%v reason=%q", pass, reason)
	}

	if pass, reason := evaluateGuardAskUserGate("missing_explicit_completion", runtimeState{
		TodoPolicy:       TodoPolicyRequired,
		MinimumTodoItems: 3,
	}, TaskComplexityStandard); pass || reason != todoRequirementMissingPolicyRequired {
		t.Fatalf("required todo policy guard without snapshot => pass=%v reason=%q", pass, reason)
	}
}

func TestBuildLayeredSystemPrompt_AskUserCoversStructuredInteractionTurns(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{
		AgentHomeDir: t.TempDir(),
		WorkingDir:   t.TempDir(),
		Shell:        "bash",
	})
	prompt := r.buildLayeredSystemPrompt(
		"Run a guided questionnaire",
		"act",
		TaskComplexityStandard,
		0,
		4,
		true,
		[]ToolDef{{Name: "ask_user"}},
		runtimeState{},
		"",
		runCapabilityContract{
			AllowUserInteraction:           true,
			SupportsAskUserQuestionBatches: true,
		},
	)
	if !strings.Contains(prompt, "Allowed ask_user cases include true external blockers and guided interaction turns") {
		t.Fatalf("prompt missing generalized ask_user guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "prefer ask_user over freeform markdown option lists") {
		t.Fatalf("prompt missing structured-interaction ask_user preference: %q", prompt)
	}
	if !strings.Contains(prompt, "do NOT first emit a separate markdown questionnaire") {
		t.Fatalf("prompt missing no-duplicate-markdown-before-ask_user rule: %q", prompt)
	}
	if !strings.Contains(prompt, "Preserve explicit interaction-shape constraints from the user") {
		t.Fatalf("prompt missing interaction-shape preservation rule: %q", prompt)
	}
	if !strings.Contains(prompt, "preserve that constraint in both `question` and `choices[]`") {
		t.Fatalf("prompt missing indirect-interaction preservation rule: %q", prompt)
	}
	if !strings.Contains(prompt, "Do NOT directly name, bucket, or reveal the target attribute") {
		t.Fatalf("prompt missing no-direct-target-attribute rule: %q", prompt)
	}
	if !strings.Contains(prompt, "every question must include id, header, question, is_secret, and response_mode") {
		t.Fatalf("prompt missing response_mode contract: %q", prompt)
	}
	if !strings.Contains(prompt, "Any question with fixed choices MUST also declare `choices_exhaustive`") {
		t.Fatalf("prompt missing choices_exhaustive contract: %q", prompt)
	}
	if !strings.Contains(prompt, "Use `response_mode:\"select\"` only when fixed choices are genuinely exhaustive by construction") {
		t.Fatalf("prompt missing exhaustive select semantics: %q", prompt)
	}
	if !strings.Contains(prompt, "Use `response_mode:\"select_or_write\"` when fixed choices are not exhaustive") {
		t.Fatalf("prompt missing non-exhaustive select_or_write semantics: %q", prompt)
	}
	if !strings.Contains(prompt, "If the user explicitly asks for answer choices, fixed options, buttons, or clickable options, do NOT downgrade the question into pure `response_mode:\"write\"`") {
		t.Fatalf("prompt missing no-downgrade-to-write rule: %q", prompt)
	}
	if !strings.Contains(prompt, "`choices[]` contains fixed options only") {
		t.Fatalf("prompt missing fixed-choice-only rule: %q", prompt)
	}
	if !strings.Contains(prompt, `None of the above: ___`) {
		t.Fatalf("prompt missing standardized typed fallback guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "If the user explicitly asks for an `Other` or `None of the above` path, you MUST represent it via `response_mode:\"select_or_write\"` with `choices_exhaustive:false`") {
		t.Fatalf("prompt missing explicit requested fallback rule: %q", prompt)
	}
	if !strings.Contains(prompt, "Do NOT use ask_user to delegate commands, file inspection, log gathering, screenshots, or web research") {
		t.Fatalf("prompt missing collectable-work rejection: %q", prompt)
	}
}
