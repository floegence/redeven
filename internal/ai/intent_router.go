package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/redeven-agent/internal/config"
)

const (
	RunIntentSocial = "social"
	RunIntentTask   = "task"

	RunIntentSourceModel         = "model"
	RunIntentSourceDeterministic = "deterministic_fallback"
	intentClassifierPromptMarker = "INTENT_CLASSIFIER_V1"

	RunObjectiveModeReplace  = "replace"
	RunObjectiveModeContinue = "continue"
)

type intentDecision struct {
	Intent        string
	Reason        string
	Source        string
	ObjectiveMode string
}

func normalizeRunIntent(raw string) string {
	v := strings.ToLower(strings.TrimSpace(raw))
	switch v {
	case RunIntentSocial:
		return RunIntentSocial
	default:
		return RunIntentTask
	}
}

func normalizeRunMode(raw string, fallback string) string {
	v := strings.ToLower(strings.TrimSpace(raw))
	switch v {
	case config.AIModeAct, config.AIModePlan:
		return v
	}
	f := strings.ToLower(strings.TrimSpace(fallback))
	if f == config.AIModePlan {
		return config.AIModePlan
	}
	return config.AIModeAct
}

type modelIntentClassifier func() (intentDecision, error)

func classifyRunIntent(userInput string, attachments []RunAttachmentIn, openGoal string, classifyByModel modelIntentClassifier) intentDecision {
	if len(attachments) > 0 {
		return intentDecision{
			Intent:        RunIntentTask,
			Reason:        "attachments_present",
			Source:        RunIntentSourceDeterministic,
			ObjectiveMode: RunObjectiveModeReplace,
		}
	}
	if classifyByModel != nil {
		decision, err := classifyByModel()
		if err == nil {
			return normalizeModelIntentDecision(decision)
		}
	}
	return intentDecision{
		Intent:        RunIntentTask,
		Reason:        "model_classifier_failed",
		Source:        RunIntentSourceDeterministic,
		ObjectiveMode: RunObjectiveModeReplace,
	}
}

func normalizeModelIntentDecision(decision intentDecision) intentDecision {
	normalized := intentDecision{
		Intent:        normalizeRunIntent(decision.Intent),
		Reason:        normalizeIntentReason(decision.Reason),
		Source:        RunIntentSourceModel,
		ObjectiveMode: normalizeObjectiveMode(decision.ObjectiveMode),
	}
	if strings.TrimSpace(normalized.Reason) == "" {
		normalized.Reason = "model_classifier"
	}
	if normalized.Intent == RunIntentSocial {
		normalized.ObjectiveMode = RunObjectiveModeReplace
	}
	return normalized
}

func normalizeObjectiveMode(mode string) string {
	v := strings.ToLower(strings.TrimSpace(mode))
	switch v {
	case RunObjectiveModeContinue:
		return RunObjectiveModeContinue
	default:
		return RunObjectiveModeReplace
	}
}

func normalizeIntentReason(reason string) string {
	trimmed := strings.TrimSpace(reason)
	if trimmed == "" {
		return ""
	}
	parts := strings.Fields(trimmed)
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, "_")
}

func buildIntentClassifierMessages(userInput string, openGoal string) []Message {
	system := strings.Join([]string{
		intentClassifierPromptMarker,
		"You classify whether a user message is social chat or a task request for a coding agent.",
		"Return exactly one JSON object with keys: intent, reason, objective_mode.",
		"intent must be one of: social, task.",
		"Choose the intent category directly, based on the category definitions below.",
		"reason must be a short snake_case phrase that explains why this category was selected.",
		"objective_mode must be one of: replace, continue.",
		"Use objective_mode=continue only when there is an existing open goal and user message clearly continues it.",
		"If there is no existing open goal, objective_mode must be replace.",
		"social means greetings, thanks, casual chat, or no actionable request.",
		"task means any actionable request about code, files, shell commands, debugging, or analysis.",
		"Do not include markdown or extra text.",
	}, "\n")
	openGoalText := strings.TrimSpace(openGoal)
	if openGoalText == "" {
		openGoalText = "(none)"
	}
	user := strings.Join([]string{
		"Current open goal:",
		openGoalText,
		"",
		"User message:",
		strings.TrimSpace(userInput),
	}, "\n")
	return []Message{
		{Role: "system", Content: []ContentPart{{Type: "text", Text: system}}},
		{Role: "user", Content: []ContentPart{{Type: "text", Text: user}}},
	}
}

func parseModelIntentDecision(raw string) (intentDecision, error) {
	candidate := strings.TrimSpace(raw)
	if candidate == "" {
		return intentDecision{}, errors.New("empty model intent response")
	}

	// Common model outputs may wrap JSON in markdown code fences.
	if strings.HasPrefix(candidate, "```") {
		candidate = strings.TrimPrefix(candidate, "```json")
		candidate = strings.TrimPrefix(candidate, "```JSON")
		candidate = strings.TrimPrefix(candidate, "```")
		candidate = strings.TrimSuffix(candidate, "```")
		candidate = strings.TrimSpace(candidate)
	}

	type modelIntentPayload struct {
		Intent        string `json:"intent"`
		Reason        string `json:"reason"`
		ObjectiveMode string `json:"objective_mode"`
	}
	parse := func(text string) (modelIntentPayload, error) {
		var payload modelIntentPayload
		if err := json.Unmarshal([]byte(text), &payload); err != nil {
			return modelIntentPayload{}, err
		}
		return payload, nil
	}

	payload, err := parse(candidate)
	if err != nil {
		embedded := extractFirstJSONObject(candidate)
		if embedded == "" {
			return intentDecision{}, fmt.Errorf("invalid model intent response: %w", err)
		}
		payload, err = parse(embedded)
		if err != nil {
			return intentDecision{}, fmt.Errorf("invalid model intent JSON payload: %w", err)
		}
	}

	intent := strings.ToLower(strings.TrimSpace(payload.Intent))
	switch intent {
	case RunIntentSocial, RunIntentTask:
	default:
		return intentDecision{}, fmt.Errorf("invalid model intent: %q", payload.Intent)
	}

	return normalizeModelIntentDecision(intentDecision{
		Intent:        intent,
		Reason:        payload.Reason,
		ObjectiveMode: payload.ObjectiveMode,
	}), nil
}

func extractFirstJSONObject(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return ""
	}
	runes := []rune(text)
	start := -1
	depth := 0
	quote := rune(0)
	escaped := false

	for i, r := range runes {
		if escaped {
			escaped = false
			continue
		}
		if quote != 0 {
			if r == '\\' {
				escaped = true
				continue
			}
			if r == quote {
				quote = 0
			}
			continue
		}

		if r == '"' || r == '\'' {
			quote = r
			continue
		}
		if r == '{' {
			if depth == 0 {
				start = i
			}
			depth++
			continue
		}
		if r == '}' {
			if depth == 0 {
				continue
			}
			depth--
			if depth == 0 && start >= 0 {
				return string(runes[start : i+1])
			}
		}
	}
	return ""
}
