package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const (
	AskUserReasonUserDecisionRequired = "user_decision_required"
	AskUserReasonPermissionBlocked    = "permission_blocked"
	AskUserReasonMissingExternalInput = "missing_external_input"
	AskUserReasonConflictingWork      = "conflicting_constraints"
	AskUserReasonSafetyConfirmation   = "safety_confirmation"

	askUserPolicyClassifierMarker = "ASK_USER_POLICY_CLASSIFIER_V1"
	askUserPolicySourceModel      = "model"
	askUserPolicySourceFallback   = "deterministic_fallback"
)

type askUserSignal struct {
	Question         string
	Options          []string
	ReasonCode       string
	RequiredFromUser []string
	EvidenceRefs     []string
}

type askUserPolicyDecision struct {
	Allow      bool
	Reason     string
	Confidence float64
	Source     string
}

func normalizeAskUserSignal(signal askUserSignal) askUserSignal {
	normalized := askUserSignal{
		Question:         strings.TrimSpace(signal.Question),
		Options:          normalizeAskUserOptions(signal.Options),
		ReasonCode:       normalizeAskUserReasonCode(signal.ReasonCode),
		RequiredFromUser: normalizeAskUserStringList(signal.RequiredFromUser, 8, 200),
		EvidenceRefs:     normalizeAskUserStringList(signal.EvidenceRefs, 12, 120),
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

func buildAskUserPolicyClassifierMessages(objective string, signal askUserSignal, state runtimeState) []Message {
	normalizedSignal := normalizeAskUserSignal(signal)
	payload := map[string]any{
		"question":           normalizedSignal.Question,
		"options":            normalizedSignal.Options,
		"reason_code":        normalizedSignal.ReasonCode,
		"required_from_user": normalizedSignal.RequiredFromUser,
		"evidence_refs":      normalizedSignal.EvidenceRefs,
	}
	payloadJSON := "{}"
	if b, err := json.Marshal(payload); err == nil {
		payloadJSON = string(b)
	}
	objective = strings.TrimSpace(objective)
	if objective == "" {
		objective = "(none)"
	}
	completedFacts := strings.Join(state.CompletedActionFacts, "\n- ")
	if strings.TrimSpace(completedFacts) == "" {
		completedFacts = "(none)"
	} else {
		completedFacts = "- " + completedFacts
	}
	blockedFacts := strings.Join(state.BlockedActionFacts, "\n- ")
	if strings.TrimSpace(blockedFacts) == "" {
		blockedFacts = "(none)"
	} else {
		blockedFacts = "- " + blockedFacts
	}
	system := strings.Join([]string{
		askUserPolicyClassifierMarker,
		"You classify whether an ask_user signal is policy-allowed for an on-device autonomous assistant.",
		"Return exactly one JSON object with keys: allow, reason, confidence.",
		"allow must be true or false.",
		"reason must be a short snake_case phrase.",
		"confidence must be a float between 0 and 1.",
		"Reject (allow=false) if the ask_user request delegates collectable work to the user that available tools can do directly.",
		"Collectable work includes running commands, gathering logs/output/screenshots/files, and fetching web content when tools can do it.",
		"Allow (allow=true) for true external blockers: user decisions, unavailable credentials, policy approvals, conflicting constraints, or safety confirmations.",
		"Use runtime facts and the structured ask_user payload. Do not include markdown or extra text.",
	}, "\n")
	user := strings.Join([]string{
		"Objective:",
		objective,
		"",
		"Structured ask_user payload:",
		payloadJSON,
		"",
		"Completed facts:",
		completedFacts,
		"",
		"Blocked facts:",
		blockedFacts,
	}, "\n")
	return []Message{
		{Role: "system", Content: []ContentPart{{Type: "text", Text: system}}},
		{Role: "user", Content: []ContentPart{{Type: "text", Text: user}}},
	}
}

func parseAskUserPolicyDecision(raw string) (askUserPolicyDecision, error) {
	candidate := strings.TrimSpace(raw)
	if candidate == "" {
		return askUserPolicyDecision{}, errors.New("empty ask_user policy response")
	}
	if strings.HasPrefix(candidate, "```") {
		candidate = strings.TrimPrefix(candidate, "```json")
		candidate = strings.TrimPrefix(candidate, "```JSON")
		candidate = strings.TrimPrefix(candidate, "```")
		candidate = strings.TrimSuffix(candidate, "```")
		candidate = strings.TrimSpace(candidate)
	}
	type payload struct {
		Allow      *bool   `json:"allow"`
		Reason     string  `json:"reason"`
		Confidence float64 `json:"confidence"`
	}
	parse := func(text string) (payload, error) {
		var p payload
		if err := json.Unmarshal([]byte(text), &p); err != nil {
			return payload{}, err
		}
		return p, nil
	}
	parsed, err := parse(candidate)
	if err != nil {
		embedded := extractFirstJSONObject(candidate)
		if embedded == "" {
			return askUserPolicyDecision{}, fmt.Errorf("invalid ask_user policy response: %w", err)
		}
		parsed, err = parse(embedded)
		if err != nil {
			return askUserPolicyDecision{}, fmt.Errorf("invalid ask_user policy payload: %w", err)
		}
	}
	if parsed.Allow == nil {
		return askUserPolicyDecision{}, errors.New("missing ask_user policy allow")
	}
	reason := normalizeIntentReason(parsed.Reason)
	if reason == "" {
		if *parsed.Allow {
			reason = "policy_allowed_by_model"
		} else {
			reason = "policy_rejected_by_model"
		}
	}
	confidence := parsed.Confidence
	if confidence < 0 {
		confidence = 0
	}
	if confidence > 1 {
		confidence = 1
	}
	return askUserPolicyDecision{
		Allow:      *parsed.Allow,
		Reason:     reason,
		Confidence: confidence,
		Source:     askUserPolicySourceModel,
	}, nil
}

func fallbackAskUserPolicyDecision(reason string) askUserPolicyDecision {
	reason = normalizeIntentReason(reason)
	if reason == "" {
		reason = "policy_classifier_failed"
	}
	return askUserPolicyDecision{
		Allow:      false,
		Reason:     reason,
		Confidence: 0,
		Source:     askUserPolicySourceFallback,
	}
}

func defaultGuardAskUserSignal(question string, options []string, source string) askUserSignal {
	signal := askUserSignal{
		Question: question,
		Options:  options,
	}
	switch strings.TrimSpace(source) {
	case "tool_mistake_loop", "guard_doom_loop":
		signal.ReasonCode = AskUserReasonConflictingWork
		signal.RequiredFromUser = []string{"Clarify the exact objective and constraints."}
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
