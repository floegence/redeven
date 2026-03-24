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
	Intent              string
	Reason              string
	Source              string
	ObjectiveMode       string
	Complexity          string
	TodoPolicy          string
	MinimumTodoItems    int
	Confidence          float64
	InteractionContract interactionContract
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

func classifyRunPolicy(userInput string, attachments []RunAttachmentIn, openGoal string, structuredResponse bool, classifyByModel modelRunPolicyClassifier) runPolicyDecision {
	structuredResponse = structuredResponse && strings.TrimSpace(openGoal) != ""
	if structuredResponse {
		return structuredResponseContinuationRunPolicyDecision()
	}
	if len(attachments) > 0 {
		return enforceStructuredResponseContinuation(runPolicyDecision{
			Intent:           RunIntentTask,
			Reason:           "attachments_present",
			Source:           RunIntentSourceDeterministic,
			ObjectiveMode:    RunObjectiveModeReplace,
			Complexity:       TaskComplexityStandard,
			TodoPolicy:       TodoPolicyRecommended,
			MinimumTodoItems: 0,
			Confidence:       1,
			InteractionContract: interactionContract{
				Source: interactionContractSourceDeterministic,
			},
		}, structuredResponse)
	}

	if classifyByModel != nil {
		decision, err := classifyByModel()
		if err == nil {
			return enforceStructuredResponseContinuation(normalizeModelRunPolicyDecision(decision), structuredResponse)
		}
	}

	return enforceStructuredResponseContinuation(runPolicyDecision{
		Intent:           RunIntentTask,
		Reason:           "model_classifier_failed",
		Source:           RunIntentSourceDeterministic,
		ObjectiveMode:    RunObjectiveModeReplace,
		Complexity:       TaskComplexityStandard,
		TodoPolicy:       TodoPolicyRecommended,
		MinimumTodoItems: 0,
		Confidence:       0,
		InteractionContract: interactionContract{
			Source: interactionContractSourceDeterministic,
		},
	}, structuredResponse)
}

func structuredResponseContinuationRunPolicyDecision() runPolicyDecision {
	return runPolicyDecision{
		Intent:           RunIntentTask,
		Reason:           "structured_response_continuation",
		Source:           RunIntentSourceDeterministic,
		ObjectiveMode:    RunObjectiveModeContinue,
		Complexity:       TaskComplexityStandard,
		TodoPolicy:       TodoPolicyRecommended,
		MinimumTodoItems: 0,
		Confidence:       1,
		InteractionContract: interactionContract{
			Source: interactionContractSourceDeterministic,
		},
	}
}

func normalizeModelRunPolicyDecision(decision runPolicyDecision) runPolicyDecision {
	normalized := runPolicyDecision{
		Intent:              normalizeRunIntent(decision.Intent),
		Reason:              normalizeIntentReason(decision.Reason),
		Source:              RunIntentSourceModel,
		ObjectiveMode:       normalizeObjectiveMode(decision.ObjectiveMode),
		Complexity:          normalizeTaskComplexity(decision.Complexity),
		TodoPolicy:          normalizeTodoPolicy(decision.TodoPolicy),
		Confidence:          decision.Confidence,
		InteractionContract: normalizeInteractionContract(decision.InteractionContract),
	}
	normalized.InteractionContract.Source = interactionContractSourceModel

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
		normalized.InteractionContract = normalizeInteractionContract(interactionContract{Source: interactionContractSourceModel})
		return normalized
	}

	normalized.MinimumTodoItems = normalizeMinimumTodoItems(normalized.TodoPolicy, decision.MinimumTodoItems)
	return normalized
}

func enforceStructuredResponseContinuation(decision runPolicyDecision, active bool) runPolicyDecision {
	if !active {
		return decision
	}
	decision.Intent = RunIntentTask
	decision.ObjectiveMode = RunObjectiveModeContinue
	decision.Reason = "structured_response_continuation"
	return decision
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

func buildRunPolicyClassifierMessages(userInput string, openGoal string, structuredResponse bool) []Message {
	inputOrigin := "plain_user_message"
	if structuredResponse {
		inputOrigin = "structured_waiting_prompt_response"
	}
	system := strings.Join([]string{
		runPolicyClassifierMarker,
		"You classify run policy for an on-device coding assistant.",
		fmt.Sprintf("Call tool `%s` exactly once with the final run policy classification.", structuredClassifierRunPolicyToolName),
		"If tool calls are unavailable, return exactly one JSON object with keys: intent, reason, objective_mode, complexity, todo_policy, minimum_todo_items, confidence, interaction_contract.",
		"intent must be one of: social, creative, task.",
		"reason must be a short snake_case phrase.",
		"objective_mode must be one of: replace, continue.",
		"Use objective_mode=continue only when there is an existing open goal and user message clearly continues it.",
		"If there is no existing open goal, objective_mode must be replace.",
		"When input_origin=structured_waiting_prompt_response and there is an existing open goal, this turn continues that open goal. Use intent=task and objective_mode=continue unless the reply explicitly replaces the objective.",
		"complexity must be one of: simple, standard, complex.",
		"todo_policy must be one of: none, recommended, required.",
		"minimum_todo_items must be an integer. Use 0 unless todo_policy=required.",
		"When todo_policy=required, minimum_todo_items must be >=3.",
		"For intent social or creative, always output complexity=simple, todo_policy=none, minimum_todo_items=0.",
		"confidence must be a float between 0 and 1.",
		"interaction_contract must be an object with keys: enabled, reason, single_question_per_turn, fixed_choices_required, open_text_fallback_required, indirect_questions_only, confidence.",
		"interaction_contract.reason must be a short snake_case phrase.",
		"interaction_contract.enabled must be true only when the active objective requires a durable guided interaction shape to be preserved across turns.",
		"When objective_mode=continue, classify the interaction contract for the existing open goal as it continues with the new user message.",
		"When objective_mode=replace, classify the interaction contract from the new user message rather than preserving the previous open goal's contract.",
		"When no guided interaction contract is required, set interaction_contract.enabled=false and all other interaction_contract flags false with confidence=0.",
		"social means greetings, thanks, casual freeform chat, or no actionable request.",
		"If the user wants a guided structured interaction with explicit answer choices or typed input, that is not social.",
		"If the user explicitly requests several answer choices or clickable options, set interaction_contract.fixed_choices_required=true.",
		"If the user explicitly requests an open fallback such as Other or None of the above, set interaction_contract.open_text_fallback_required=true.",
		"If the user explicitly requests one question at a time, set interaction_contract.single_question_per_turn=true.",
		"If the user explicitly requests indirect, proxy-based, or non-leading questioning, set interaction_contract.indirect_questions_only=true.",
		"creative means story/poem/copywriting/roleplay style generation that should not execute tools.",
		"task means any actionable request about code, files, shell commands, debugging, analysis, planning, or implementation.",
		"task also includes guided structured interactions that should continue through the task runtime, such as questionnaires, interviews, quizzes, guessing games, decision trees, and multi-step option-driven conversations.",
		"Do not include markdown or extra text.",
	}, "\n")

	openGoalText := strings.TrimSpace(openGoal)
	if openGoalText == "" {
		openGoalText = "(none)"
	}
	user := strings.Join([]string{
		"Return JSON only: output exactly one JSON object.",
		"",
		"Input origin:",
		inputOrigin,
		"",
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

func runPolicyClassifierToolDef() ToolDef {
	return structuredClassifierToolDef(structuredClassifierRunPolicyToolName, "Emit the structured run policy classification.", map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"intent": map[string]any{
				"type": "string",
				"enum": []string{RunIntentSocial, RunIntentCreative, RunIntentTask},
			},
			"reason": map[string]any{
				"type":        "string",
				"description": "Short snake_case phrase.",
			},
			"objective_mode": map[string]any{
				"type": "string",
				"enum": []string{RunObjectiveModeReplace, RunObjectiveModeContinue},
			},
			"complexity": map[string]any{
				"type": "string",
				"enum": []string{TaskComplexitySimple, TaskComplexityStandard, TaskComplexityComplex},
			},
			"todo_policy": map[string]any{
				"type": "string",
				"enum": []string{TodoPolicyNone, TodoPolicyRecommended, TodoPolicyRequired},
			},
			"minimum_todo_items": map[string]any{
				"type":    "integer",
				"minimum": 0,
			},
			"confidence": map[string]any{
				"type":    "number",
				"minimum": 0,
				"maximum": 1,
			},
			"interaction_contract": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"properties": map[string]any{
					"enabled": map[string]any{
						"type": "boolean",
					},
					"reason": map[string]any{
						"type":        "string",
						"description": "Short snake_case phrase.",
					},
					"single_question_per_turn": map[string]any{
						"type": "boolean",
					},
					"fixed_choices_required": map[string]any{
						"type": "boolean",
					},
					"open_text_fallback_required": map[string]any{
						"type": "boolean",
					},
					"indirect_questions_only": map[string]any{
						"type": "boolean",
					},
					"confidence": map[string]any{
						"type":    "number",
						"minimum": 0,
						"maximum": 1,
					},
				},
				"required": []string{
					"enabled",
					"reason",
					"single_question_per_turn",
					"fixed_choices_required",
					"open_text_fallback_required",
					"indirect_questions_only",
					"confidence",
				},
			},
		},
		"required": []string{
			"intent",
			"reason",
			"objective_mode",
			"complexity",
			"todo_policy",
			"minimum_todo_items",
			"confidence",
			"interaction_contract",
		},
	})
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
		Intent              string              `json:"intent"`
		Reason              string              `json:"reason"`
		ObjectiveMode       string              `json:"objective_mode"`
		Complexity          string              `json:"complexity"`
		TodoPolicy          string              `json:"todo_policy"`
		MinimumTodoItems    int                 `json:"minimum_todo_items"`
		Confidence          float64             `json:"confidence"`
		InteractionContract interactionContract `json:"interaction_contract"`
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
		Intent:              intent,
		Reason:              payload.Reason,
		ObjectiveMode:       payload.ObjectiveMode,
		Complexity:          payload.Complexity,
		TodoPolicy:          payload.TodoPolicy,
		MinimumTodoItems:    payload.MinimumTodoItems,
		Confidence:          payload.Confidence,
		InteractionContract: payload.InteractionContract,
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
