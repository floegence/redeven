package ai

import (
	"encoding/json"
	"strings"
)

const (
	interactionContractSourceModel         = "model"
	interactionContractSourceDeterministic = "deterministic_fallback"
)

type interactionContract struct {
	Enabled                       bool    `json:"enabled"`
	Reason                        string  `json:"reason,omitempty"`
	SingleQuestionPerTurn         bool    `json:"single_question_per_turn,omitempty"`
	MustUseStructuredAskUser      bool    `json:"must_use_structured_ask_user,omitempty"`
	FixedChoicesRequired          bool    `json:"fixed_choices_required,omitempty"`
	OpenTextFallbackRequired      bool    `json:"open_text_fallback_required,omitempty"`
	IndirectQuestionsOnly         bool    `json:"indirect_questions_only,omitempty"`
	DisallowDirectTargetAttribute bool    `json:"disallow_direct_target_attribute,omitempty"`
	MustNotFinalizeWithQuestion   bool    `json:"must_not_finalize_with_new_question,omitempty"`
	Confidence                    float64 `json:"confidence,omitempty"`
	Source                        string  `json:"source,omitempty"`
}

func normalizeInteractionContract(contract interactionContract) interactionContract {
	out := contract
	out.Reason = normalizeIntentReason(out.Reason)
	switch strings.TrimSpace(out.Source) {
	case interactionContractSourceModel:
		out.Source = interactionContractSourceModel
	default:
		out.Source = interactionContractSourceDeterministic
	}
	if out.Confidence < 0 {
		out.Confidence = 0
	}
	if out.Confidence > 1 {
		out.Confidence = 1
	}
	if !out.Enabled {
		out.Reason = ""
		out.SingleQuestionPerTurn = false
		out.MustUseStructuredAskUser = false
		out.FixedChoicesRequired = false
		out.OpenTextFallbackRequired = false
		out.IndirectQuestionsOnly = false
		out.DisallowDirectTargetAttribute = false
		out.MustNotFinalizeWithQuestion = false
		return out
	}
	out.MustUseStructuredAskUser = true
	if out.OpenTextFallbackRequired {
		out.FixedChoicesRequired = true
	}
	if out.IndirectQuestionsOnly {
		out.DisallowDirectTargetAttribute = true
	}
	out.MustNotFinalizeWithQuestion = true
	return out
}

func interactionContractFromAny(value any) interactionContract {
	if value == nil {
		return normalizeInteractionContract(interactionContract{Source: interactionContractSourceDeterministic})
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return normalizeInteractionContract(interactionContract{Source: interactionContractSourceDeterministic})
	}
	var contract interactionContract
	if err := json.Unmarshal(raw, &contract); err != nil {
		return normalizeInteractionContract(interactionContract{Source: interactionContractSourceDeterministic})
	}
	return normalizeInteractionContract(contract)
}

func mergeInteractionContractSeed(contract interactionContract, seed interactionContract) interactionContract {
	normalized := normalizeInteractionContract(contract)
	normalizedSeed := normalizeInteractionContract(seed)
	if !normalizedSeed.Enabled {
		return normalized
	}
	if !normalized.Enabled {
		return normalizedSeed
	}
	normalized.Enabled = true
	normalized.SingleQuestionPerTurn = normalized.SingleQuestionPerTurn || normalizedSeed.SingleQuestionPerTurn
	normalized.FixedChoicesRequired = normalized.FixedChoicesRequired || normalizedSeed.FixedChoicesRequired
	normalized.OpenTextFallbackRequired = normalized.OpenTextFallbackRequired || normalizedSeed.OpenTextFallbackRequired
	normalized.IndirectQuestionsOnly = normalized.IndirectQuestionsOnly || normalizedSeed.IndirectQuestionsOnly
	if strings.TrimSpace(normalized.Reason) == "" {
		normalized.Reason = normalizedSeed.Reason
	}
	if normalized.Confidence < normalizedSeed.Confidence {
		normalized.Confidence = normalizedSeed.Confidence
	}
	if strings.TrimSpace(normalized.Source) == "" {
		normalized.Source = normalizedSeed.Source
	}
	return normalizeInteractionContract(normalized)
}

func (contract interactionContract) eventPayload() map[string]any {
	normalized := normalizeInteractionContract(contract)
	return map[string]any{
		"enabled":                             normalized.Enabled,
		"reason":                              normalized.Reason,
		"source":                              normalized.Source,
		"confidence":                          normalized.Confidence,
		"single_question_per_turn":            normalized.SingleQuestionPerTurn,
		"must_use_structured_ask_user":        normalized.MustUseStructuredAskUser,
		"fixed_choices_required":              normalized.FixedChoicesRequired,
		"open_text_fallback_required":         normalized.OpenTextFallbackRequired,
		"indirect_questions_only":             normalized.IndirectQuestionsOnly,
		"disallow_direct_target_attribute":    normalized.DisallowDirectTargetAttribute,
		"must_not_finalize_with_new_question": normalized.MustNotFinalizeWithQuestion,
	}
}

func interactionContractPromptLines(contract interactionContract) []string {
	normalized := normalizeInteractionContract(contract)
	if !normalized.Enabled {
		return nil
	}
	lines := []string{
		"",
		"# Active Interaction Contract",
		"- A user-requested guided interaction contract is active for the current objective. Preserve it across turns until the objective changes.",
	}
	if normalized.MustUseStructuredAskUser {
		lines = append(lines, "- Use structured `ask_user` for waiting-user turns. Do not replace it with a plain markdown question or a duplicated freeform questionnaire.")
	}
	if normalized.SingleQuestionPerTurn {
		lines = append(lines, "- Ask exactly one question per turn.")
	}
	if normalized.FixedChoicesRequired {
		lines = append(lines, "- Keep fixed answer choices. Do not downgrade this interaction into a pure free-text question.")
	}
	if normalized.OpenTextFallbackRequired {
		lines = append(lines, "- Keep an open typed fallback together with the fixed choices: use `response_mode:\"select_or_write\"` with `choices_exhaustive:false` so the UI preserves `None of the above: ___`.")
	}
	if normalized.IndirectQuestionsOnly {
		lines = append(lines, "- Ask indirect or proxy questions only. Do not directly ask for the hidden target attribute.")
	}
	if normalized.DisallowDirectTargetAttribute {
		lines = append(lines, "- Do not directly name, bucket, or reveal the hidden target attribute in the question text or fixed choices.")
	}
	if normalized.MustNotFinalizeWithQuestion {
		lines = append(lines, "- Do not end with `task_complete` while still asking the user a new question or confirmation. If you still need a user reply, use `ask_user` and end in `waiting_user`.")
	}
	return lines
}

func interactionContractRuntimeLines(contract interactionContract) []string {
	normalized := normalizeInteractionContract(contract)
	if !normalized.Enabled {
		return []string{"- Interaction contract: disabled"}
	}
	return []string{
		"- Interaction contract: enabled",
		"- Interaction contract reason: " + normalized.Reason,
		"- Interaction contract source: " + normalized.Source,
		"- Interaction contract single-question turns: " + boolString(normalized.SingleQuestionPerTurn),
		"- Interaction contract fixed choices required: " + boolString(normalized.FixedChoicesRequired),
		"- Interaction contract typed fallback required: " + boolString(normalized.OpenTextFallbackRequired),
		"- Interaction contract indirect questions only: " + boolString(normalized.IndirectQuestionsOnly),
		"- Interaction contract hide target attribute: " + boolString(normalized.DisallowDirectTargetAttribute),
	}
}

func validateAskUserInteractionContract(contract interactionContract, questions []RequestUserInputQuestion) string {
	normalized := normalizeInteractionContract(contract)
	if !normalized.Enabled {
		return ""
	}
	canonical := normalizeRequestUserInputQuestions(questions)
	if normalized.SingleQuestionPerTurn && len(canonical) != 1 {
		return askUserGateReasonInteractionShapeMismatch
	}
	for _, question := range canonical {
		fixedChoices := requestUserInputSelectChoices(normalizeRequestUserInputChoices(question.Choices))
		if normalized.FixedChoicesRequired && len(fixedChoices) == 0 {
			return askUserGateReasonInteractionShapeMismatch
		}
		if !normalized.OpenTextFallbackRequired {
			continue
		}
		if len(fixedChoices) == 0 {
			return askUserGateReasonInteractionShapeMismatch
		}
		if normalizeRequestUserInputResponseMode(question.ResponseMode) != requestUserInputResponseModeSelectText {
			return askUserGateReasonInteractionShapeMismatch
		}
		if question.ChoicesExhaustive == nil || *question.ChoicesExhaustive {
			return askUserGateReasonInteractionShapeMismatch
		}
	}
	return ""
}

func completionResultRequestsUserInput(resultText string, contract interactionContract) bool {
	normalized := normalizeInteractionContract(contract)
	if !normalized.MustNotFinalizeWithQuestion {
		return false
	}
	last := strings.TrimSpace(lastNonEmptyLine(resultText))
	if last == "" {
		return false
	}
	return strings.HasSuffix(last, "?") || strings.HasSuffix(last, "？")
}

func lastNonEmptyLine(text string) string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line != "" {
			return line
		}
	}
	return ""
}

func boolString(v bool) string {
	if v {
		return "true"
	}
	return "false"
}
