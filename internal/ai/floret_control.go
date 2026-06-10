package ai

import (
	"encoding/json"
	"errors"
	"strings"

	flengine "github.com/floegence/floret/engine"
	flprovider "github.com/floegence/floret/provider"
)

type floretControlProjector struct {
	run        *run
	state      *floretToolRuntimeState
	complexity string
	mode       string
}

func newFloretControlSpec(r *run, state *floretToolRuntimeState, activeTools []ToolDef, complexity string, mode string) flengine.ControlSpec {
	projector := floretControlProjector{
		run:        r,
		state:      state,
		complexity: normalizeTaskComplexity(complexity),
		mode:       strings.TrimSpace(mode),
	}
	return flengine.ControlSpec{
		Definitions: floretControlDefinitionsFromTools(activeTools),
		Project:     projector.Project,
	}
}

func (p floretControlProjector) Project(call flprovider.ToolCall) (flengine.ControlSignal, bool, error) {
	flowerCall, err := flowerToolCallFromFloret(call)
	if err != nil {
		return flengine.ControlSignal{}, true, err
	}
	switch strings.TrimSpace(flowerCall.Name) {
	case "task_complete":
		return p.projectTaskComplete(flowerCall), true, nil
	case "ask_user":
		signal, err := p.projectAskUser(flowerCall)
		return signal, true, err
	case "exit_plan_mode":
		signal, err := p.projectExitPlanMode(flowerCall)
		return signal, true, err
	default:
		return flengine.ControlSignal{}, false, nil
	}
}

func (p floretControlProjector) projectTaskComplete(call ToolCall) flengine.ControlSignal {
	resultText := extractSignalText(call, "result")
	evidenceRefs := extractSignalStringList(call, "evidence_refs")
	payload := cloneAnyMap(call.Args)
	payload["result"] = resultText
	if len(evidenceRefs) > 0 {
		payload["evidence_refs"] = evidenceRefs
	}
	return flengine.ControlSignal{
		Disposition: flengine.ControlTerminal,
		Name:        "task_complete",
		CallID:      strings.TrimSpace(call.ID),
		Payload:     payload,
		OutputText:  resultText,
	}
}

func (p floretControlProjector) projectAskUser(call ToolCall) (flengine.ControlSignal, error) {
	questions, questionContractError := extractModelSignalRequestUserInputQuestions(call, "questions")
	signal := askUserSignal{
		Questions:        questions,
		ReasonCode:       extractSignalText(call, "reason_code"),
		RequiredFromUser: extractSignalStringList(call, "required_from_user"),
		EvidenceRefs:     extractSignalStringList(call, "evidence_refs"),
		ContractError:    questionContractError,
	}
	signal = normalizeAskUserSignal(signal)
	if signal.Question == "" && len(signal.Questions) > 0 {
		signal.Question = strings.TrimSpace(signal.Questions[0].Question)
	}
	if signal.Question == "" {
		signal.Question = "I need clarification to continue safely."
	}
	state := runtimeState{}
	if p.state != nil {
		state = p.state.snapshot()
	}
	pass, reason := evaluateAskUserGate(signal, state, p.complexity)
	if !pass && reason == "pending_todos_without_blocker" && state.TodoTrackingEnabled && state.TodoOpenCount > 0 {
		pass = true
		reason = "ok_waiting_todo_closeout"
	}
	if p.run != nil {
		p.run.persistRunEvent("ask_user.attempt", RealtimeStreamKindLifecycle, map[string]any{
			"source":                       "model_signal",
			"gate_passed":                  pass,
			"gate_reason":                  reason,
			"question_len":                 len([]rune(strings.TrimSpace(signal.Question))),
			"questions_count":              len(signal.Questions),
			"choices_count":                requestUserInputQuestionChoiceCount(signal.Questions),
			"reason_code":                  signal.ReasonCode,
			"required_inputs_count":        len(signal.RequiredFromUser),
			"evidence_refs_count":          len(signal.EvidenceRefs),
			"validation_mode":              "deterministic_contract_state",
			"complexity":                   p.complexity,
			"todo_tracking":                state.TodoTrackingEnabled,
			"todo_open_count":              state.TodoOpenCount,
			"interaction_contract_enabled": normalizeInteractionContract(state.InteractionContract).Enabled,
		})
	}
	if !pass {
		return flengine.ControlSignal{
			Disposition: flengine.ControlContinue,
			Name:        "ask_user",
			CallID:      strings.TrimSpace(call.ID),
			Payload: map[string]any{
				"rejected":    true,
				"gate_reason": reason,
				"source":      "model_signal",
			},
			OutputText: askUserRejectionText(reason),
		}, nil
	}
	payload := map[string]any{
		"source":             "model_signal",
		"questions":          signal.Questions,
		"question":           signal.Question,
		"reason_code":        signal.ReasonCode,
		"required_from_user": append([]string(nil), signal.RequiredFromUser...),
		"evidence_refs":      append([]string(nil), signal.EvidenceRefs...),
	}
	return flengine.ControlSignal{
		Disposition: flengine.ControlWaiting,
		Name:        "ask_user",
		CallID:      strings.TrimSpace(call.ID),
		Payload:     payload,
		OutputText:  signal.Question,
	}, nil
}

func (p floretControlProjector) projectExitPlanMode(call ToolCall) (flengine.ControlSignal, error) {
	if p.run == nil {
		return flengine.ControlSignal{}, errors.New("exit_plan_mode requires run projection")
	}
	args := ExitPlanModeArgs{
		Summary:        extractSignalText(call, "summary"),
		AllowedPrompts: extractExitPlanPromptRefs(call.Args["allowed_prompts"]),
	}
	result, err := p.run.toolExitPlanMode(strings.TrimSpace(call.ID), args)
	if err != nil {
		return flengine.ControlSignal{
			Disposition: flengine.ControlContinue,
			Name:        "exit_plan_mode",
			CallID:      strings.TrimSpace(call.ID),
			Payload:     map[string]any{"error": err.Error()},
			OutputText:  "exit_plan_mode failed. Regenerate a concise reason and call exit_plan_mode again if act mode is still required.",
		}, nil
	}
	payload := map[string]any{
		"source":         "exit_plan_mode",
		"summary":        result.Summary,
		"args":           args,
		"waiting_prompt": result.WaitingPrompt,
	}
	return flengine.ControlSignal{
		Disposition: flengine.ControlWaiting,
		Name:        "exit_plan_mode",
		CallID:      strings.TrimSpace(call.ID),
		Payload:     payload,
		OutputText:  buildExitPlanModeQuestion(args.Summary),
	}, nil
}

func flowerToolCallFromFloret(call flprovider.ToolCall) (ToolCall, error) {
	args := map[string]any{}
	if raw := strings.TrimSpace(call.Args); raw != "" {
		if err := json.Unmarshal([]byte(raw), &args); err != nil {
			return ToolCall{}, err
		}
	}
	if args == nil {
		args = map[string]any{}
	}
	return ToolCall{
		ID:   strings.TrimSpace(call.ID),
		Name: strings.TrimSpace(call.Name),
		Args: args,
	}, nil
}

func askUserRejectionText(reason string) string {
	reason = strings.TrimSpace(reason)
	switch reason {
	case "missing_reason_code":
		return "ask_user was rejected because reason_code is missing or invalid. Regenerate ask_user with a valid structured reason."
	case "missing_required_from_user":
		return "ask_user was rejected because required_from_user is empty. Specify exactly what information is needed from the user."
	case askUserGateReasonMissingChoices:
		return "ask_user was rejected because a choice-based question had no fixed choices. Use response_mode=\"select\" only for exhaustive fixed choices, response_mode=\"write\" for direct input, or response_mode=\"select_or_write\" for non-exhaustive fixed choices plus a typed fallback."
	case askUserGateReasonMissingChoicesExhaustive:
		return "ask_user was rejected because a choice-based question omitted choices_exhaustive. Declare whether the fixed options are exhaustive."
	case askUserGateReasonInconsistentChoiceContract:
		return "ask_user was rejected because response_mode and choices_exhaustive disagree. Keep fixed-choice semantics consistent."
	case askUserGateReasonInteractionShapeMismatch:
		return "ask_user was rejected because it violated the user's requested interaction shape. Preserve explicit fixed-option and structured-input requirements."
	case askUserGateReasonLegacyContractShape:
		return "ask_user was rejected because it used the retired options/is_other/detail_input contract. Regenerate with canonical questions[].choices[], response_mode, and choices_exhaustive fields."
	case "missing_evidence_refs":
		return "ask_user was rejected because evidence_refs is empty for an evidence-backed reason. Provide concrete evidence refs from tool calls."
	case "unresolved_evidence_refs":
		return "ask_user was rejected because evidence_refs do not match known tool-call records. Use valid tool IDs as evidence refs."
	case "permission_reason_without_blocked_evidence":
		return "ask_user was rejected because reason_code=permission_blocked requires blocked tool evidence."
	case "pending_todos_without_blocker":
		return "ask_user was rejected because todos are still open. Continue execution, or update write_todos to mark blockers before asking the user."
	case todoRequirementMissingPolicyRequired:
		return "ask_user was rejected because the run policy requires todo tracking, but no todo snapshot exists. Call write_todos first, then continue execution."
	case todoRequirementInsufficientPolicyRequired:
		return "ask_user was rejected because the current todo plan is smaller than the required minimum. Expand write_todos first, then continue execution."
	default:
		return "ask_user was rejected by contract gate. Continue autonomously with available tools and call task_complete when done."
	}
}

func extractExitPlanPromptRefs(value any) []ExitPlanPromptRef {
	items, ok := value.([]any)
	if !ok {
		if typed, ok := value.([]ExitPlanPromptRef); ok {
			return append([]ExitPlanPromptRef(nil), typed...)
		}
		return nil
	}
	out := make([]ExitPlanPromptRef, 0, len(items))
	for _, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		ref := ExitPlanPromptRef{
			Tool:   strings.TrimSpace(anyToString(m["tool"])),
			Prompt: strings.TrimSpace(anyToString(m["prompt"])),
		}
		if ref.Tool == "" && ref.Prompt == "" {
			continue
		}
		out = append(out, ref)
	}
	return out
}
