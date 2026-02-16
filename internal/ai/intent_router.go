package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/redeven-agent/internal/config"
)

const (
	RunIntentSocial   = "social"
	RunIntentCreative = "creative"
	RunIntentTask     = "task"

	RunIntentSourceModel         = "model"
	RunIntentSourceDeterministic = "deterministic_fallback"
	runPolicyClassifierMarker    = "RUN_POLICY_CLASSIFIER_V1"

	RunObjectiveModeReplace  = "replace"
	RunObjectiveModeContinue = "continue"
)

type runPolicyDecision struct {
	Intent           string
	Reason           string
	Source           string
	ObjectiveMode    string
	Complexity       string
	TodoPolicy       string
	MinimumTodoItems int
	Confidence       float64
}

func normalizeRunIntent(raw string) string {
	v := strings.ToLower(strings.TrimSpace(raw))
	switch v {
	case RunIntentSocial:
		return RunIntentSocial
	case RunIntentCreative:
		return RunIntentCreative
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

type modelRunPolicyClassifier func() (runPolicyDecision, error)

func classifyRunPolicy(userInput string, attachments []RunAttachmentIn, openGoal string, classifyByModel modelRunPolicyClassifier) runPolicyDecision {
	if len(attachments) > 0 {
		return runPolicyDecision{
			Intent:           RunIntentTask,
			Reason:           "attachments_present",
			Source:           RunIntentSourceDeterministic,
			ObjectiveMode:    RunObjectiveModeReplace,
			Complexity:       TaskComplexityStandard,
			TodoPolicy:       TodoPolicyRecommended,
			MinimumTodoItems: 0,
			Confidence:       1,
		}
	}

	if classifyByModel != nil {
		decision, err := classifyByModel()
		if err == nil {
			return normalizeModelRunPolicyDecision(decision)
		}
	}

	return runPolicyDecision{
		Intent:           RunIntentTask,
		Reason:           "model_classifier_failed",
		Source:           RunIntentSourceDeterministic,
		ObjectiveMode:    RunObjectiveModeReplace,
		Complexity:       TaskComplexityStandard,
		TodoPolicy:       TodoPolicyRecommended,
		MinimumTodoItems: 0,
		Confidence:       0,
	}
}

func normalizeModelRunPolicyDecision(decision runPolicyDecision) runPolicyDecision {
	normalized := runPolicyDecision{
		Intent:        normalizeRunIntent(decision.Intent),
		Reason:        normalizeIntentReason(decision.Reason),
		Source:        RunIntentSourceModel,
		ObjectiveMode: normalizeObjectiveMode(decision.ObjectiveMode),
		Complexity:    normalizeTaskComplexity(decision.Complexity),
		TodoPolicy:    normalizeTodoPolicy(decision.TodoPolicy),
		Confidence:    decision.Confidence,
	}

	if strings.TrimSpace(normalized.Reason) == "" {
		normalized.Reason = "model_classifier"
	}
	if normalized.Confidence < 0 {
		normalized.Confidence = 0
	}
	if normalized.Confidence > 1 {
		normalized.Confidence = 1
	}

	if normalized.Intent == RunIntentSocial || normalized.Intent == RunIntentCreative {
		normalized.ObjectiveMode = RunObjectiveModeReplace
		normalized.Complexity = TaskComplexitySimple
		normalized.TodoPolicy = TodoPolicyNone
		normalized.MinimumTodoItems = 0
		return normalized
	}

	normalized.MinimumTodoItems = normalizeMinimumTodoItems(normalized.TodoPolicy, decision.MinimumTodoItems)
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

func buildRunPolicyClassifierMessages(userInput string, openGoal string) []Message {
	system := strings.Join([]string{
		runPolicyClassifierMarker,
		"You classify run policy for an on-device coding assistant.",
		"Return exactly one JSON object with keys: intent, reason, objective_mode, complexity, todo_policy, minimum_todo_items, confidence.",
		"intent must be one of: social, creative, task.",
		"reason must be a short snake_case phrase.",
		"objective_mode must be one of: replace, continue.",
		"Use objective_mode=continue only when there is an existing open goal and user message clearly continues it.",
		"If there is no existing open goal, objective_mode must be replace.",
		"complexity must be one of: simple, standard, complex.",
		"todo_policy must be one of: none, recommended, required.",
		"minimum_todo_items must be an integer. Use 0 unless todo_policy=required.",
		"When todo_policy=required, minimum_todo_items must be >=3.",
		"For intent social or creative, always output complexity=simple, todo_policy=none, minimum_todo_items=0.",
		"confidence must be a float between 0 and 1.",
		"social means greetings, thanks, casual chat, or no actionable request.",
		"creative means story/poem/copywriting/roleplay style generation that should not execute tools.",
		"task means any actionable request about code, files, shell commands, debugging, analysis, planning, or implementation.",
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

func parseModelRunPolicyDecision(raw string) (runPolicyDecision, error) {
	candidate := strings.TrimSpace(raw)
	if candidate == "" {
		return runPolicyDecision{}, errors.New("empty model policy response")
	}

	if strings.HasPrefix(candidate, "```") {
		candidate = strings.TrimPrefix(candidate, "```json")
		candidate = strings.TrimPrefix(candidate, "```JSON")
		candidate = strings.TrimPrefix(candidate, "```")
		candidate = strings.TrimSuffix(candidate, "```")
		candidate = strings.TrimSpace(candidate)
	}

	type modelRunPolicyPayload struct {
		Intent           string  `json:"intent"`
		Reason           string  `json:"reason"`
		ObjectiveMode    string  `json:"objective_mode"`
		Complexity       string  `json:"complexity"`
		TodoPolicy       string  `json:"todo_policy"`
		MinimumTodoItems int     `json:"minimum_todo_items"`
		Confidence       float64 `json:"confidence"`
	}

	parse := func(text string) (modelRunPolicyPayload, error) {
		var payload modelRunPolicyPayload
		if err := json.Unmarshal([]byte(text), &payload); err != nil {
			return modelRunPolicyPayload{}, err
		}
		return payload, nil
	}

	payload, err := parse(candidate)
	if err != nil {
		embedded := extractFirstJSONObject(candidate)
		if embedded == "" {
			return runPolicyDecision{}, fmt.Errorf("invalid model policy response: %w", err)
		}
		payload, err = parse(embedded)
		if err != nil {
			return runPolicyDecision{}, fmt.Errorf("invalid model policy JSON payload: %w", err)
		}
	}

	intent := strings.ToLower(strings.TrimSpace(payload.Intent))
	switch intent {
	case RunIntentSocial, RunIntentCreative, RunIntentTask:
	default:
		return runPolicyDecision{}, fmt.Errorf("invalid model intent: %q", payload.Intent)
	}

	decision := runPolicyDecision{
		Intent:           intent,
		Reason:           payload.Reason,
		ObjectiveMode:    payload.ObjectiveMode,
		Complexity:       payload.Complexity,
		TodoPolicy:       payload.TodoPolicy,
		MinimumTodoItems: payload.MinimumTodoItems,
		Confidence:       payload.Confidence,
	}
	return normalizeModelRunPolicyDecision(decision), nil
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
				return strings.TrimSpace(string(runes[start : i+1]))
			}
		}
	}
	return ""
}
