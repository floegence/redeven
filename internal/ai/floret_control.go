package ai

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
)

type floretControlProjector struct {
	run        *run
	state      *floretToolRuntimeState
	complexity string
	mode       string
}

func newFloretControlSpec(r *run, state *floretToolRuntimeState, activeTools []ToolDef, complexity string, mode string) (flruntime.TurnSignalSpec, error) {
	projector := floretControlProjector{
		run:        r,
		state:      state,
		complexity: normalizeTaskComplexity(complexity),
		mode:       strings.TrimSpace(mode),
	}
	definitions, err := floretControlDefinitionsFromTools(activeTools)
	if err != nil {
		return flruntime.TurnSignalSpec{}, err
	}
	return flruntime.TurnSignalSpec{
		Definitions: definitions,
		Project:     projector.Project,
	}, nil
}

func (p floretControlProjector) Project(call fltools.ToolCall) (flruntime.TurnSignal, bool, error) {
	flowerCall, err := flowerToolCallFromFloret(call)
	if err != nil {
		return flruntime.TurnSignal{}, true, err
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
		return flruntime.TurnSignal{}, false, nil
	}
}

func (p floretControlProjector) projectTaskComplete(call ToolCall) flruntime.TurnSignal {
	resultText := extractSignalText(call, "result")
	evidenceRefs := extractSignalStringList(call, "evidence_refs")
	payload := cloneAnyMap(call.Args)
	payload["result"] = resultText
	if len(evidenceRefs) > 0 {
		payload["evidence_refs"] = evidenceRefs
	}
	return flruntime.TurnSignal{
		Disposition: flruntime.SignalTerminal,
		Name:        "task_complete",
		CallID:      strings.TrimSpace(call.ID),
		Payload:     payload,
		Activity: &observation.ActivityPresentation{
			Label:    "task_complete",
			Renderer: observation.ActivityRendererCompletion,
			Payload:  floretCompletionPayload(call.Args, resultText, evidenceRefs),
		},
		OutputText: resultText,
	}
}

func (p floretControlProjector) projectAskUser(call ToolCall) (flruntime.TurnSignal, error) {
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
	reason := validateAskUserSignal(signal)
	pass := reason == ""
	if p.run != nil {
		p.run.persistRunEvent("ask_user.attempt", RealtimeStreamKindLifecycle, map[string]any{
			"source":                "model_signal",
			"gate_passed":           pass,
			"gate_reason":           reason,
			"contract_error":        signal.ContractError,
			"question_len":          len([]rune(strings.TrimSpace(signal.Question))),
			"questions_count":       len(signal.Questions),
			"choices_count":         requestUserInputQuestionChoiceCount(signal.Questions),
			"reason_code":           signal.ReasonCode,
			"required_inputs_count": len(signal.RequiredFromUser),
			"evidence_refs_count":   len(signal.EvidenceRefs),
			"validation_mode":       "canonical_control_signal",
			"complexity":            p.complexity,
		})
	}
	if !pass {
		return flruntime.TurnSignal{}, errors.New(askUserValidationError(reason, signal.ContractError))
	}
	payload := map[string]any{
		"source":             "model_signal",
		"questions":          signal.Questions,
		"question":           signal.Question,
		"tool_name":          "ask_user",
		"reason_code":        signal.ReasonCode,
		"required_from_user": append([]string(nil), signal.RequiredFromUser...),
		"evidence_refs":      append([]string(nil), signal.EvidenceRefs...),
	}
	return flruntime.TurnSignal{
		Disposition: flruntime.SignalWaiting,
		Name:        "ask_user",
		CallID:      strings.TrimSpace(call.ID),
		Payload:     payload,
		Activity: &observation.ActivityPresentation{
			Label:       "Waiting for user input",
			Description: signal.Question,
			Renderer:    observation.ActivityRendererQuestion,
			Payload:     floretQuestionPayload(signal),
		},
		OutputText: signal.Question,
	}, nil
}

func (p floretControlProjector) projectExitPlanMode(call ToolCall) (flruntime.TurnSignal, error) {
	if p.run == nil {
		return flruntime.TurnSignal{}, errors.New("exit_plan_mode requires run projection")
	}
	args := ExitPlanModeArgs{
		Summary:        extractSignalText(call, "summary"),
		AllowedPrompts: extractExitPlanPromptRefs(call.Args["allowed_prompts"]),
	}
	result, err := p.run.toolExitPlanMode(strings.TrimSpace(call.ID), args)
	if err != nil {
		return flruntime.TurnSignal{}, err
	}
	payload := map[string]any{
		"source":         "exit_plan_mode",
		"summary":        result.Summary,
		"args":           args,
		"waiting_prompt": result.WaitingPrompt,
	}
	return flruntime.TurnSignal{
		Disposition: flruntime.SignalWaiting,
		Name:        "exit_plan_mode",
		CallID:      strings.TrimSpace(call.ID),
		Payload:     payload,
		Activity: &observation.ActivityPresentation{
			Label:       "Exit plan mode",
			Description: buildExitPlanModeQuestion(args.Summary),
			Renderer:    observation.ActivityRendererQuestion,
			Payload: map[string]any{
				"summary":         strings.TrimSpace(args.Summary),
				"allowed_prompts": args.AllowedPrompts,
			},
		},
		OutputText: buildExitPlanModeQuestion(args.Summary),
	}, nil
}

func floretCompletionPayload(args map[string]any, resultText string, evidenceRefs []string) map[string]any {
	payload := map[string]any{
		"result": strings.TrimSpace(resultText),
	}
	if len(evidenceRefs) > 0 {
		payload["evidence_refs"] = append([]string(nil), evidenceRefs...)
	}
	if risks := extractStringSlice(args["remaining_risks"]); len(risks) > 0 {
		payload["remaining_risks"] = risks
	}
	if next := extractStringSlice(args["next_actions"]); len(next) > 0 {
		payload["next_actions"] = next
	}
	return payload
}

func floretQuestionPayload(signal askUserSignal) map[string]any {
	return map[string]any{
		"reason_code":        strings.TrimSpace(signal.ReasonCode),
		"required_from_user": append([]string(nil), signal.RequiredFromUser...),
		"evidence_refs":      append([]string(nil), signal.EvidenceRefs...),
		"questions":          normalizeRequestUserInputQuestions(signal.Questions),
	}
}

func flowerToolCallFromFloret(call fltools.ToolCall) (ToolCall, error) {
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

func askUserValidationError(reason string, contractError string) string {
	reason = strings.TrimSpace(reason)
	contractError = strings.TrimSpace(contractError)
	prefix := "invalid ask_user control signal: "
	switch reason {
	case "missing_reason_code":
		return prefix + "reason_code is missing or invalid"
	case "missing_required_from_user":
		return prefix + "required_from_user is empty"
	case askUserGateReasonMissingChoices:
		return prefix + "questions are missing or a choice-based question has no fixed choices"
	case askUserGateReasonMissingChoicesExhaustive:
		return prefix + "a choice-based question omitted choices_exhaustive"
	case askUserGateReasonInconsistentChoiceContract:
		return prefix + "response_mode and choices_exhaustive disagree"
	case "missing_evidence_refs":
		return prefix + "evidence_refs is empty"
	default:
		if contractError != "" {
			return prefix + contractError
		}
		if reason != "" {
			return prefix + reason
		}
		return prefix + "validation failed"
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
