package ai

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/config"
)

const (
	waitingPromptActionSetMode = "set_mode"
)

func buildWaitingPromptID(messageID string, toolID string) string {
	messageID = strings.TrimSpace(messageID)
	toolID = strings.TrimSpace(toolID)
	if messageID == "" || toolID == "" {
		return ""
	}
	return "wp_" + messageID + "_" + toolID
}

func normalizeWaitingPromptAction(action WaitingPromptAction) (WaitingPromptAction, bool) {
	action.Type = strings.TrimSpace(strings.ToLower(action.Type))
	switch action.Type {
	case waitingPromptActionSetMode:
		action.Mode = normalizeRunMode(action.Mode, config.AIModeAct)
		return action, true
	default:
		return WaitingPromptAction{}, false
	}
}

func normalizeWaitingPromptChoices(choices []WaitingPromptChoice) []WaitingPromptChoice {
	if len(choices) == 0 {
		return nil
	}
	out := make([]WaitingPromptChoice, 0, len(choices))
	seenChoiceID := make(map[string]struct{}, len(choices))
	seenLabel := make(map[string]struct{}, len(choices))
	for idx, choice := range choices {
		label := truncateRunes(strings.TrimSpace(choice.Label), 200)
		if label == "" {
			continue
		}
		choiceID := truncateRunes(strings.TrimSpace(choice.ChoiceID), 64)
		if choiceID == "" {
			choiceID = fmt.Sprintf("choice_%d", idx+1)
		}
		choiceKey := strings.ToLower(choiceID)
		if _, ok := seenChoiceID[choiceKey]; ok {
			continue
		}
		labelKey := strings.ToLower(label)
		if _, ok := seenLabel[labelKey]; ok {
			continue
		}
		seenChoiceID[choiceKey] = struct{}{}
		seenLabel[labelKey] = struct{}{}
		normalizedActions := make([]WaitingPromptAction, 0, len(choice.Actions))
		seenAction := map[string]struct{}{}
		for _, rawAction := range choice.Actions {
			action, ok := normalizeWaitingPromptAction(rawAction)
			if !ok {
				continue
			}
			actionKey := action.Type + ":" + strings.ToLower(strings.TrimSpace(action.Mode))
			if _, exists := seenAction[actionKey]; exists {
				continue
			}
			seenAction[actionKey] = struct{}{}
			normalizedActions = append(normalizedActions, action)
			if len(normalizedActions) >= 4 {
				break
			}
		}
		out = append(out, WaitingPromptChoice{
			ChoiceID: choiceID,
			Label:    label,
			Actions:  normalizedActions,
		})
		if len(out) >= 4 {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func waitingPromptChoicesFromOptions(options []string) []WaitingPromptChoice {
	if len(options) == 0 {
		return nil
	}
	choices := make([]WaitingPromptChoice, 0, len(options))
	for idx, option := range options {
		option = truncateRunes(strings.TrimSpace(option), 200)
		if option == "" {
			continue
		}
		choices = append(choices, WaitingPromptChoice{
			ChoiceID: fmt.Sprintf("choice_%d", idx+1),
			Label:    option,
		})
	}
	return normalizeWaitingPromptChoices(choices)
}

func readWaitingPromptStringField(raw map[string]any, keys ...string) string {
	if raw == nil {
		return ""
	}
	for _, key := range keys {
		if key == "" {
			continue
		}
		value, ok := raw[key]
		if !ok {
			continue
		}
		if text, ok := value.(string); ok {
			text = strings.TrimSpace(text)
			if text != "" {
				return text
			}
		}
	}
	return ""
}

func parseWaitingPromptActionsAny(raw any) []WaitingPromptAction {
	items, ok := raw.([]any)
	if !ok || len(items) == 0 {
		return nil
	}
	actions := make([]WaitingPromptAction, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok || record == nil {
			continue
		}
		actions = append(actions, WaitingPromptAction{
			Type: readWaitingPromptStringField(record, "type"),
			Mode: readWaitingPromptStringField(record, "mode"),
		})
	}
	return actions
}

func parseWaitingPromptChoicesAny(raw any) []WaitingPromptChoice {
	switch v := raw.(type) {
	case nil:
		return nil
	case []WaitingPromptChoice:
		return normalizeWaitingPromptChoices(v)
	case []any:
		choices := make([]WaitingPromptChoice, 0, len(v))
		for _, item := range v {
			record, ok := item.(map[string]any)
			if !ok || record == nil {
				continue
			}
			choices = append(choices, WaitingPromptChoice{
				ChoiceID: readWaitingPromptStringField(record, "choice_id", "choiceId"),
				Label:    readWaitingPromptStringField(record, "label"),
				Actions:  parseWaitingPromptActionsAny(record["actions"]),
			})
		}
		return normalizeWaitingPromptChoices(choices)
	default:
		return nil
	}
}

func waitingPromptChoiceByID(choices []WaitingPromptChoice, choiceID string) (*WaitingPromptChoice, bool) {
	choiceID = strings.TrimSpace(choiceID)
	if choiceID == "" {
		return nil, false
	}
	normalizedChoices := normalizeWaitingPromptChoices(choices)
	for i := range normalizedChoices {
		if strings.TrimSpace(normalizedChoices[i].ChoiceID) == choiceID {
			choice := normalizedChoices[i]
			return &choice, true
		}
	}
	return nil, false
}

func marshalWaitingPromptChoices(choices []WaitingPromptChoice) string {
	normalized := normalizeWaitingPromptChoices(choices)
	if len(normalized) == 0 {
		return ""
	}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}

func parseWaitingPromptChoicesJSON(raw string) []WaitingPromptChoice {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var choices []WaitingPromptChoice
	if err := json.Unmarshal([]byte(raw), &choices); err != nil {
		return nil
	}
	return normalizeWaitingPromptChoices(choices)
}

func normalizeWaitingPromptResponse(raw *WaitingPromptResponse) *WaitingPromptResponse {
	if raw == nil {
		return nil
	}
	promptID := strings.TrimSpace(raw.PromptID)
	choiceID := strings.TrimSpace(raw.ChoiceID)
	if promptID == "" {
		return nil
	}
	return &WaitingPromptResponse{
		PromptID: promptID,
		ChoiceID: choiceID,
	}
}

func normalizeWaitingPrompt(promptID string, messageID string, toolID string, choices ...[]WaitingPromptChoice) *WaitingPrompt {
	messageID = strings.TrimSpace(messageID)
	toolID = strings.TrimSpace(toolID)
	promptID = strings.TrimSpace(promptID)
	if promptID == "" {
		promptID = buildWaitingPromptID(messageID, toolID)
	}
	if promptID == "" || messageID == "" || toolID == "" {
		return nil
	}
	var normalizedChoices []WaitingPromptChoice
	if len(choices) > 0 {
		normalizedChoices = normalizeWaitingPromptChoices(choices[0])
	}
	return &WaitingPrompt{
		PromptID:  promptID,
		MessageID: messageID,
		ToolID:    toolID,
		Choices:   normalizedChoices,
	}
}

func waitingPromptFromThreadRecord(t *threadstore.Thread, effectiveRunStatus string) *WaitingPrompt {
	if t == nil {
		return nil
	}
	if NormalizeRunState(effectiveRunStatus) != RunStateWaitingUser {
		return nil
	}
	return normalizeWaitingPrompt(
		t.WaitingPromptID,
		t.WaitingMessageID,
		t.WaitingToolID,
		parseWaitingPromptChoicesJSON(t.WaitingChoicesJSON),
	)
}
