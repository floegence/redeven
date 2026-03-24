package ai

import "strings"

const (
	AskUserReasonUserDecisionRequired = "user_decision_required"
	AskUserReasonPermissionBlocked    = "permission_blocked"
	AskUserReasonMissingExternalInput = "missing_external_input"
	AskUserReasonConflictingWork      = "conflicting_constraints"
	AskUserReasonSafetyConfirmation   = "safety_confirmation"
)

type askUserSignal struct {
	Questions        []RequestUserInputQuestion
	Question         string
	ReasonCode       string
	RequiredFromUser []string
	EvidenceRefs     []string
}

func normalizeAskUserSignal(signal askUserSignal) askUserSignal {
	questions := normalizeRequestUserInputQuestions(signal.Questions)
	normalized := askUserSignal{
		Questions:        questions,
		ReasonCode:       normalizeAskUserReasonCode(signal.ReasonCode),
		RequiredFromUser: normalizeAskUserStringList(signal.RequiredFromUser, 8, 200),
		EvidenceRefs:     normalizeAskUserStringList(signal.EvidenceRefs, 12, 120),
	}
	if len(normalized.Questions) > 0 {
		normalized.Question = strings.TrimSpace(normalized.Questions[0].Question)
	}
	return normalized
}

func normalizeAskUserReasonCode(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case AskUserReasonUserDecisionRequired:
		return AskUserReasonUserDecisionRequired
	case AskUserReasonPermissionBlocked:
		return AskUserReasonPermissionBlocked
	case AskUserReasonMissingExternalInput:
		return AskUserReasonMissingExternalInput
	case AskUserReasonConflictingWork:
		return AskUserReasonConflictingWork
	case AskUserReasonSafetyConfirmation:
		return AskUserReasonSafetyConfirmation
	default:
		return ""
	}
}

func normalizeAskUserStringList(items []string, maxItems int, maxLen int) []string {
	if len(items) == 0 || maxItems <= 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(items))
	out := make([]string, 0, len(items))
	for _, item := range items {
		text := truncateRunes(strings.TrimSpace(item), maxLen)
		if text == "" {
			continue
		}
		key := strings.ToLower(text)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, text)
		if len(out) >= maxItems {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func defaultGuardAskUserSignal(question string, options []string, source string, evidenceRefs ...string) askUserSignal {
	signal := askUserSignal{
		Questions: normalizeRequestUserInputQuestions([]RequestUserInputQuestion{{
			ID:       "question_1",
			Header:   strings.TrimSpace(question),
			Question: strings.TrimSpace(question),
			Choices:  requestUserInputChoicesFromLabels(options),
		}}),
	}
	switch strings.TrimSpace(source) {
	case "tool_mistake_loop", "guard_doom_loop":
		signal.ReasonCode = AskUserReasonConflictingWork
		signal.RequiredFromUser = []string{"Provide missing context or choose the next direction so execution can avoid repeating failed tool paths."}
	case "completion_empty_result_repeated", "missing_explicit_completion":
		signal.ReasonCode = AskUserReasonUserDecisionRequired
		signal.RequiredFromUser = []string{"Confirm whether the current result should be treated as final."}
	case "complex_task_missing_todos":
		signal.ReasonCode = AskUserReasonUserDecisionRequired
		signal.RequiredFromUser = []string{"Confirm the key goals to continue with a valid todo plan."}
	default:
		signal.ReasonCode = AskUserReasonMissingExternalInput
		signal.RequiredFromUser = []string{"Provide clarification so execution can continue safely."}
	}
	signal.EvidenceRefs = normalizeUniqueNonEmptyList(evidenceRefs)
	return normalizeAskUserSignal(signal)
}

func askUserReasonRequiresEvidence(reasonCode string) bool {
	switch normalizeAskUserReasonCode(reasonCode) {
	case AskUserReasonPermissionBlocked, AskUserReasonConflictingWork:
		return true
	default:
		return false
	}
}
