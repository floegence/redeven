package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const interactionContractClassifierMarker = "INTERACTION_CONTRACT_CLASSIFIER_V1"

type modelInteractionContractClassifier func() (interactionContract, error)

func classifyInteractionContract(intent string, activeObjective string, userInput string, seed interactionContract, classifyByModel modelInteractionContractClassifier) interactionContract {
	if normalizeRunIntent(intent) != RunIntentTask {
		return normalizeInteractionContract(interactionContract{Source: interactionContractSourceDeterministic})
	}
	activeObjective = strings.TrimSpace(activeObjective)
	userInput = strings.TrimSpace(userInput)
	if activeObjective == "" && userInput == "" {
		return normalizeInteractionContract(interactionContract{Source: interactionContractSourceDeterministic})
	}
	if classifyByModel != nil {
		contract, err := classifyByModel()
		if err == nil {
			return mergeInteractionContractSeed(contract, seed)
		}
	}
	normalizedSeed := normalizeInteractionContract(seed)
	if normalizedSeed.Enabled {
		return normalizedSeed
	}
	return normalizeInteractionContract(interactionContract{Source: interactionContractSourceDeterministic})
}

func buildInteractionContractClassifierMessages(objectiveMode string, activeObjective string, userInput string) []Message {
	objectiveMode = normalizeObjectiveMode(objectiveMode)
	activeObjective = strings.TrimSpace(activeObjective)
	if activeObjective == "" {
		activeObjective = "(none)"
	}
	userInput = strings.TrimSpace(userInput)
	if userInput == "" {
		userInput = "(none)"
	}
	system := strings.Join([]string{
		interactionContractClassifierMarker,
		"You classify whether the active objective requires a durable guided interaction contract for an on-device assistant.",
		fmt.Sprintf("Call tool `%s` exactly once with the final interaction contract classification.", structuredClassifierInteractionContractToolName),
		"If tool calls are unavailable, return exactly one JSON object with keys: enabled, reason, single_question_per_turn, fixed_choices_required, open_text_fallback_required, indirect_questions_only, confidence.",
		"enabled must be true or false.",
		"reason must be a short snake_case phrase.",
		"single_question_per_turn must be true only when the user explicitly requests one question at a time.",
		"fixed_choices_required must be true when the user explicitly requests answer choices, buttons, or clickable options.",
		"Also set fixed_choices_required=true for guided questionnaires, quizzes, guessing games, or hidden-target inference turns where the assistant should narrow hypotheses through comparable answer options instead of a pure free-text reply.",
		"When the assistant asks about the user's real-world situation, preference, habit, background, or proxy signal to infer a hidden attribute, fixed choices should normally remain enabled together with a typed fallback.",
		"open_text_fallback_required must be true when fixed choices need a typed fallback beyond the listed options.",
		"Set open_text_fallback_required=true when the user explicitly asks for an open fallback such as Other / None of the above / custom answer.",
		"Also set open_text_fallback_required=true for open-world guided questions about the user's real-world state, preference, habit, background, or hidden attribute unless the listed options are genuinely exhaustive by construction.",
		"When fixed choices describe the user's real situation as evidence for a hidden attribute, the option list is normally non-exhaustive and must keep a typed fallback.",
		"indirect_questions_only must be true only when the user explicitly requests indirect, proxy-based, or non-leading questioning.",
		"confidence must be a float between 0 and 1.",
		"Classify the contract for the active objective after objective_mode has been applied.",
		"If objective_mode=continue, preserve durable interaction-shape requirements from the existing objective even when the latest user reply is only a short answer.",
		"If no durable guided interaction contract is required, set enabled=false and all flags false with confidence=0.",
		"Do not include markdown or extra text.",
	}, "\n")
	user := strings.Join([]string{
		"Objective mode:",
		objectiveMode,
		"",
		"Active objective:",
		activeObjective,
		"",
		"Latest user message:",
		userInput,
	}, "\n")
	return []Message{
		{Role: "system", Content: []ContentPart{{Type: "text", Text: system}}},
		{Role: "user", Content: []ContentPart{{Type: "text", Text: user}}},
	}
}

func interactionContractClassifierToolDef() ToolDef {
	return structuredClassifierToolDef(structuredClassifierInteractionContractToolName, "Emit the structured interaction contract classification.", map[string]any{
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
				"type":        "boolean",
				"description": "True when fixed choices must keep a typed fallback because the option set is not exhaustive, including open-world guided questions about the user's real situation or a hidden attribute.",
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
	})
}

func parseInteractionContractDecision(raw string) (interactionContract, error) {
	candidate := strings.TrimSpace(raw)
	if candidate == "" {
		return interactionContract{}, errors.New("empty interaction contract response")
	}
	if strings.HasPrefix(candidate, "```") {
		candidate = strings.TrimPrefix(candidate, "```json")
		candidate = strings.TrimPrefix(candidate, "```JSON")
		candidate = strings.TrimPrefix(candidate, "```")
		candidate = strings.TrimSuffix(candidate, "```")
		candidate = strings.TrimSpace(candidate)
	}
	type payload struct {
		Enabled                  *bool   `json:"enabled"`
		Reason                   string  `json:"reason"`
		SingleQuestionPerTurn    bool    `json:"single_question_per_turn"`
		FixedChoicesRequired     bool    `json:"fixed_choices_required"`
		OpenTextFallbackRequired bool    `json:"open_text_fallback_required"`
		IndirectQuestionsOnly    bool    `json:"indirect_questions_only"`
		Confidence               float64 `json:"confidence"`
	}
	parse := func(text string) (payload, error) {
		var out payload
		if err := json.Unmarshal([]byte(text), &out); err != nil {
			return payload{}, err
		}
		return out, nil
	}
	parsed, err := parse(candidate)
	if err != nil {
		embedded := extractFirstJSONObject(candidate)
		if embedded == "" {
			return interactionContract{}, fmt.Errorf("invalid interaction contract response: %w", err)
		}
		parsed, err = parse(embedded)
		if err != nil {
			return interactionContract{}, fmt.Errorf("invalid interaction contract payload: %w", err)
		}
	}
	if parsed.Enabled == nil {
		return interactionContract{}, errors.New("missing interaction contract enabled")
	}
	return normalizeInteractionContract(interactionContract{
		Enabled:                  *parsed.Enabled,
		Reason:                   parsed.Reason,
		SingleQuestionPerTurn:    parsed.SingleQuestionPerTurn,
		FixedChoicesRequired:     parsed.FixedChoicesRequired,
		OpenTextFallbackRequired: parsed.OpenTextFallbackRequired,
		IndirectQuestionsOnly:    parsed.IndirectQuestionsOnly,
		Confidence:               parsed.Confidence,
		Source:                   interactionContractSourceModel,
	}), nil
}
