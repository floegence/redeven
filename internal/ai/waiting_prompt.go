package ai

import (
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/config"
)

const (
	requestUserInputChoiceKindSelect       = "select"
	requestUserInputResponseModeSelect     = "select"
	requestUserInputResponseModeWrite      = "write"
	requestUserInputResponseModeSelectText = "select_or_write"
)

func buildRequestUserInputPromptID(messageID string, toolID string) string {
	messageID = strings.TrimSpace(messageID)
	toolID = strings.TrimSpace(toolID)
	if messageID == "" || toolID == "" {
		return ""
	}
	return "rui_" + messageID + "_" + toolID
}

func normalizeRequestUserInputAction(action RequestUserInputAction) (RequestUserInputAction, bool) {
	action.Type = strings.TrimSpace(strings.ToLower(action.Type))
	if action.Type == "" || action.Type != "open_subagent" {
		return RequestUserInputAction{}, false
	}
	return action, true
}

func normalizeRequestUserInputChoiceKind(kind string) string {
	switch strings.TrimSpace(strings.ToLower(kind)) {
	case requestUserInputChoiceKindSelect:
		return requestUserInputChoiceKindSelect
	default:
		return ""
	}
}

func cloneBoolPtr(value *bool) *bool {
	if value == nil {
		return nil
	}
	out := *value
	return &out
}

func defaultRequestUserInputWriteLabel(header string, question string) string {
	header = strings.TrimSpace(header)
	if header != "" {
		return header
	}
	question = strings.TrimSpace(question)
	if question != "" {
		return question
	}
	return "Your answer"
}

func normalizeRequestUserInputResponseMode(mode string) string {
	switch strings.TrimSpace(strings.ToLower(mode)) {
	case requestUserInputResponseModeSelect:
		return requestUserInputResponseModeSelect
	case requestUserInputResponseModeWrite:
		return requestUserInputResponseModeWrite
	case requestUserInputResponseModeSelectText:
		return requestUserInputResponseModeSelectText
	default:
		return ""
	}
}

func requestUserInputResponseModeAllowsText(mode string) bool {
	switch normalizeRequestUserInputResponseMode(mode) {
	case requestUserInputResponseModeWrite, requestUserInputResponseModeSelectText:
		return true
	default:
		return false
	}
}

func requestUserInputResponseModeRequiresChoices(mode string) bool {
	switch normalizeRequestUserInputResponseMode(mode) {
	case requestUserInputResponseModeSelect, requestUserInputResponseModeSelectText:
		return true
	default:
		return false
	}
}

func requestUserInputDefaultWriteLabel(mode string, header string, question string) string {
	if normalizeRequestUserInputResponseMode(mode) == requestUserInputResponseModeSelectText {
		return "None of the above"
	}
	return defaultRequestUserInputWriteLabel(header, question)
}

func requestUserInputDefaultWritePlaceholder(mode string) string {
	if normalizeRequestUserInputResponseMode(mode) == requestUserInputResponseModeSelectText {
		return "Type another answer"
	}
	return "Type your answer"
}

func requestUserInputSelectChoices(choices []RequestUserInputChoice) []RequestUserInputChoice {
	if len(choices) == 0 {
		return nil
	}
	out := make([]RequestUserInputChoice, 0, len(choices))
	for _, choice := range choices {
		if normalizeRequestUserInputChoiceKind(choice.Kind) != requestUserInputChoiceKindSelect {
			continue
		}
		choice.Kind = requestUserInputChoiceKindSelect
		out = append(out, choice)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func buildCanonicalRequestUserInputQuestion(question RequestUserInputQuestion) (RequestUserInputQuestion, bool) {
	id := truncateRunes(strings.TrimSpace(question.ID), 80)
	header := truncateRunes(strings.TrimSpace(question.Header), 120)
	text := truncateRunes(strings.TrimSpace(question.Question), 400)
	if header == "" && text == "" {
		return RequestUserInputQuestion{}, false
	}
	if header == "" {
		header = text
	}
	if text == "" {
		text = header
	}

	normalizedChoices := normalizeRequestUserInputChoices(question.Choices)
	fixedChoices := requestUserInputSelectChoices(normalizedChoices)
	responseMode := normalizeRequestUserInputResponseMode(question.ResponseMode)
	if responseMode == "" {
		return RequestUserInputQuestion{}, false
	}
	if responseMode == requestUserInputResponseModeWrite && len(normalizedChoices) > 0 {
		return RequestUserInputQuestion{}, false
	}
	if requestUserInputResponseModeRequiresChoices(responseMode) && len(fixedChoices) == 0 {
		return RequestUserInputQuestion{}, false
	}
	choicesExhaustive := cloneBoolPtr(question.ChoicesExhaustive)
	if len(fixedChoices) > 0 {
		if choicesExhaustive == nil {
			return RequestUserInputQuestion{}, false
		}
		switch responseMode {
		case requestUserInputResponseModeSelect:
			if !*choicesExhaustive {
				return RequestUserInputQuestion{}, false
			}
		case requestUserInputResponseModeSelectText:
			if *choicesExhaustive {
				return RequestUserInputQuestion{}, false
			}
		default:
			return RequestUserInputQuestion{}, false
		}
	} else {
		choicesExhaustive = nil
	}

	out := RequestUserInputQuestion{
		ID:                id,
		Header:            header,
		Question:          text,
		IsSecret:          question.IsSecret,
		ResponseMode:      responseMode,
		ChoicesExhaustive: choicesExhaustive,
	}

	if requestUserInputResponseModeRequiresChoices(responseMode) {
		out.Choices = fixedChoices
	}
	if requestUserInputResponseModeAllowsText(responseMode) {
		writeLabel := truncateRunes(strings.TrimSpace(question.WriteLabel), 200)
		writePlaceholder := truncateRunes(strings.TrimSpace(question.WritePlaceholder), 160)
		if writeLabel == "" {
			writeLabel = requestUserInputDefaultWriteLabel(responseMode, header, text)
		}
		if writePlaceholder == "" {
			writePlaceholder = requestUserInputDefaultWritePlaceholder(responseMode)
		}
		out.WriteLabel = writeLabel
		out.WritePlaceholder = writePlaceholder
	}

	return out, true
}

func normalizeRequestUserInputActions(actions []RequestUserInputAction) []RequestUserInputAction {
	if len(actions) == 0 {
		return nil
	}
	out := make([]RequestUserInputAction, 0, len(actions))
	seen := map[string]struct{}{}
	for _, rawAction := range actions {
		action, ok := normalizeRequestUserInputAction(rawAction)
		if !ok {
			continue
		}
		key := action.Type
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, action)
		if len(out) >= 4 {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func normalizeRequestUserInputChoices(choices []RequestUserInputChoice) []RequestUserInputChoice {
	if len(choices) == 0 {
		return nil
	}
	out := make([]RequestUserInputChoice, 0, len(choices))
	seenChoice := map[string]struct{}{}
	seenLabel := map[string]struct{}{}
	for idx, choice := range choices {
		kind := normalizeRequestUserInputChoiceKind(choice.Kind)
		if kind == "" {
			continue
		}
		label := truncateRunes(strings.TrimSpace(choice.Label), 200)
		if label == "" {
			continue
		}
		choiceID := truncateRunes(strings.TrimSpace(choice.ChoiceID), 64)
		if choiceID == "" {
			choiceID = fmt.Sprintf("choice_%d", idx+1)
		}
		choiceKey := strings.ToLower(choiceID)
		labelKey := strings.ToLower(label)
		if _, exists := seenChoice[choiceKey]; exists {
			continue
		}
		if _, exists := seenLabel[labelKey]; exists {
			continue
		}
		seenChoice[choiceKey] = struct{}{}
		seenLabel[labelKey] = struct{}{}
		out = append(out, RequestUserInputChoice{
			ChoiceID:    choiceID,
			Label:       label,
			Description: truncateRunes(strings.TrimSpace(choice.Description), 240),
			Kind:        kind,
			Actions:     normalizeRequestUserInputActions(choice.Actions),
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

func normalizeRequestUserInputQuestions(questions []RequestUserInputQuestion) []RequestUserInputQuestion {
	if len(questions) == 0 {
		return nil
	}
	out := make([]RequestUserInputQuestion, 0, len(questions))
	seenID := map[string]struct{}{}
	for idx, question := range questions {
		id := truncateRunes(strings.TrimSpace(question.ID), 80)
		if id == "" {
			id = fmt.Sprintf("question_%d", idx+1)
		}
		idKey := strings.ToLower(id)
		if _, exists := seenID[idKey]; exists {
			continue
		}
		seenID[idKey] = struct{}{}
		canonical, ok := buildCanonicalRequestUserInputQuestion(RequestUserInputQuestion{
			ID:                id,
			Header:            question.Header,
			Question:          question.Question,
			IsSecret:          question.IsSecret,
			ResponseMode:      question.ResponseMode,
			ChoicesExhaustive: question.ChoicesExhaustive,
			WriteLabel:        question.WriteLabel,
			WritePlaceholder:  question.WritePlaceholder,
			Choices:           question.Choices,
		})
		if !ok {
			continue
		}
		out = append(out, canonical)
		if len(out) >= 5 {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func normalizeRequestUserInputStringList(items []string, maxItems int, maxLen int) []string {
	if len(items) == 0 || maxItems <= 0 {
		return nil
	}
	out := make([]string, 0, len(items))
	seen := map[string]struct{}{}
	for _, item := range items {
		text := truncateRunes(strings.TrimSpace(item), maxLen)
		if text == "" {
			continue
		}
		key := strings.ToLower(text)
		if _, exists := seen[key]; exists {
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

func normalizeRequestUserInputPrompt(prompt *RequestUserInputPrompt) *RequestUserInputPrompt {
	if prompt == nil {
		return nil
	}
	out := *prompt
	out.MessageID = strings.TrimSpace(out.MessageID)
	out.ToolID = strings.TrimSpace(out.ToolID)
	out.ToolName = strings.TrimSpace(out.ToolName)
	out.PromptID = strings.TrimSpace(out.PromptID)
	out.ReasoningSelection = config.NormalizeAIReasoningSelection(out.ReasoningSelection)
	if out.PromptID == "" {
		out.PromptID = buildRequestUserInputPromptID(out.MessageID, out.ToolID)
	}
	if out.PromptID == "" || out.MessageID == "" || out.ToolID == "" || out.ToolName == "" {
		return nil
	}
	out.ReasonCode = normalizeAskUserReasonCode(out.ReasonCode)
	out.RequiredFromUser = normalizeRequestUserInputStringList(out.RequiredFromUser, 8, 200)
	out.EvidenceRefs = normalizeRequestUserInputStringList(out.EvidenceRefs, 12, 120)
	out.Questions = normalizeRequestUserInputQuestions(out.Questions)
	if len(out.Questions) == 0 {
		return nil
	}
	out.ContainsSecret = requestUserInputPromptContainsSecret(out)
	out.PublicSummary = formatRequestUserInputAssistantSummary(out)
	return &out
}

func requestUserInputPromptContainsSecret(prompt RequestUserInputPrompt) bool {
	for _, question := range prompt.Questions {
		if question.IsSecret {
			return true
		}
	}
	return false
}

func formatRequestUserInputAssistantSummary(prompt RequestUserInputPrompt) string {
	questions := normalizeRequestUserInputQuestions(prompt.Questions)
	if len(questions) == 0 {
		return ""
	}
	if len(questions) == 1 {
		return truncateRunes(strings.TrimSpace(questions[0].Question), 240)
	}
	items := make([]string, 0, minInt(len(questions), 3))
	for i, question := range questions {
		if i >= 3 {
			break
		}
		item := strings.TrimSpace(question.Question)
		header := strings.TrimSpace(question.Header)
		if header != "" && !strings.EqualFold(header, item) {
			item = header + ": " + item
		}
		if item != "" {
			items = append(items, item)
		}
	}
	if len(items) == 0 {
		return ""
	}
	return truncateRunes(fmt.Sprintf("Input requested (%d questions): %s", len(prompt.Questions), strings.Join(items, "; ")), 240)
}

func minInt(a int, b int) int {
	if a <= b {
		return a
	}
	return b
}
