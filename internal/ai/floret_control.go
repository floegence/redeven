package ai

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

type floretControlProjector struct {
	run        *run
	state      *floretToolRuntimeState
	complexity string
}

func newFloretControlSpec(r *run, state *floretToolRuntimeState, activeTools []ToolDef, complexity string) (flruntime.TurnSignalSpec, error) {
	projector := floretControlProjector{
		run:        r,
		state:      state,
		complexity: normalizeTaskComplexity(complexity),
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
		core, _, err := flruntime.ProjectCoreControlSignal(call)
		if err != nil {
			return flruntime.TurnSignal{}, true, err
		}
		return p.projectTaskComplete(flowerCall, core), true, nil
	case "ask_user":
		core, _, err := flruntime.ProjectCoreControlSignal(call)
		if err != nil {
			return flruntime.TurnSignal{}, true, err
		}
		signal, err := p.projectAskUser(flowerCall, core)
		return signal, true, err
	default:
		return flruntime.TurnSignal{}, false, nil
	}
}

func (p floretControlProjector) projectTaskComplete(call ToolCall, core flruntime.TurnSignal) flruntime.TurnSignal {
	resultText := firstNonEmptyString(core.OutputText, extractSignalText(call, "result"), extractSignalText(call, "output"))
	evidenceRefs := extractSignalStringList(call, "evidence_refs")
	payload := cloneAnyMap(call.Args)
	payload["result"] = resultText
	if _, ok := payload["output"]; !ok && resultText != "" {
		payload["output"] = resultText
	}
	if len(evidenceRefs) > 0 {
		payload["evidence_refs"] = evidenceRefs
	}
	return flruntime.TurnSignal{
		Disposition: flruntime.SignalTerminal,
		Name:        "task_complete",
		CallID:      strings.TrimSpace(call.ID),
		Payload:     payload,
		Activity:    floretActivityForControlSignal("task_complete", payload, ""),
		OutputText:  resultText,
	}
}

func (p floretControlProjector) projectAskUser(call ToolCall, _ flruntime.TurnSignal) (flruntime.TurnSignal, error) {
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
	reason := validateAskUserSignal(signal)
	pass := reason == ""
	if p.run != nil {
		p.run.recordRunDiagnostic("ask_user.attempt", RealtimeStreamKindLifecycle, map[string]any{
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
		Activity:    floretActivityForControlSignal("ask_user", payload, signal.Question),
		OutputText:  signal.Question,
	}, nil
}

func floretActivityForControlSignal(toolName string, payload map[string]any, description string) *observation.ActivityPresentation {
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return nil
	}
	spec, hasSpec := aitools.PresentationSpec(toolName)
	renderer := activityRendererFromSpec(spec, hasSpec)
	activityPayload := activityPayloadFromFieldList(spec.ResultPayloadFields, payload)
	activityPayload = activityPayloadWithSpecOperation(activityPayload, spec, hasSpec)
	activityPayload, _ = contractSafePayloadMap(activityPayload, 0)
	activity := &observation.ActivityPresentation{
		Label:       activityResultLabel(toolName, spec, hasSpec, renderer, activityPayload),
		Description: activityPresentationDescription(description),
		Renderer:    renderer,
		Chips:       activityChipsFromSpec(spec, activityPayload),
		Payload:     activityPayload,
	}
	return contractSafeActivityPresentation(activity)
}

func flowerToolCallFromFloret(call fltools.ToolCall) (ToolCall, error) {
	if strings.TrimSpace(call.ID) == "" || strings.TrimSpace(call.Name) == "" {
		return ToolCall{}, errors.New("Floret tool call requires id and name")
	}
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
