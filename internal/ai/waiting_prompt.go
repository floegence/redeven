package ai

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/config"
)

const (
	requestUserInputActionSetMode = "set_mode"
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
	switch action.Type {
	case requestUserInputActionSetMode:
		action.Mode = normalizeRunMode(action.Mode, config.AIModeAct)
		return action, true
	default:
		return RequestUserInputAction{}, false
	}
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
		key := action.Type + ":" + strings.ToLower(strings.TrimSpace(action.Mode))
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

func normalizeRequestUserInputOptions(options []RequestUserInputOption) []RequestUserInputOption {
	if len(options) == 0 {
		return nil
	}
	out := make([]RequestUserInputOption, 0, len(options))
	seenOption := map[string]struct{}{}
	seenLabel := map[string]struct{}{}
	for idx, option := range options {
		label := truncateRunes(strings.TrimSpace(option.Label), 200)
		if label == "" {
			continue
		}
		optionID := truncateRunes(strings.TrimSpace(option.OptionID), 64)
		if optionID == "" {
			optionID = fmt.Sprintf("option_%d", idx+1)
		}
		optionKey := strings.ToLower(optionID)
		labelKey := strings.ToLower(label)
		if _, exists := seenOption[optionKey]; exists {
			continue
		}
		if _, exists := seenLabel[labelKey]; exists {
			continue
		}
		seenOption[optionKey] = struct{}{}
		seenLabel[labelKey] = struct{}{}
		out = append(out, RequestUserInputOption{
			OptionID:    optionID,
			Label:       label,
			Description: truncateRunes(strings.TrimSpace(option.Description), 240),
			Actions:     normalizeRequestUserInputActions(option.Actions),
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

func requestUserInputOptionsFromLabels(labels []string) []RequestUserInputOption {
	if len(labels) == 0 {
		return nil
	}
	options := make([]RequestUserInputOption, 0, len(labels))
	for idx, label := range labels {
		label = strings.TrimSpace(label)
		if label == "" {
			continue
		}
		options = append(options, RequestUserInputOption{
			OptionID: fmt.Sprintf("option_%d", idx+1),
			Label:    label,
		})
	}
	return normalizeRequestUserInputOptions(options)
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
		header := truncateRunes(strings.TrimSpace(question.Header), 120)
		text := truncateRunes(strings.TrimSpace(question.Question), 400)
		if header == "" && text == "" {
			continue
		}
		if header == "" {
			header = text
		}
		if text == "" {
			text = header
		}
		out = append(out, RequestUserInputQuestion{
			ID:       id,
			Header:   header,
			Question: text,
			IsOther:  question.IsOther,
			IsSecret: question.IsSecret,
			Options:  normalizeRequestUserInputOptions(question.Options),
		})
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
	out.PromptID = strings.TrimSpace(out.PromptID)
	if out.PromptID == "" {
		out.PromptID = buildRequestUserInputPromptID(out.MessageID, out.ToolID)
	}
	if out.PromptID == "" || out.MessageID == "" || out.ToolID == "" {
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

func marshalRequestUserInputPrompt(prompt *RequestUserInputPrompt) string {
	normalized := normalizeRequestUserInputPrompt(prompt)
	if normalized == nil {
		return ""
	}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}

func parseRequestUserInputPromptJSON(raw string) *RequestUserInputPrompt {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var prompt RequestUserInputPrompt
	if err := json.Unmarshal([]byte(raw), &prompt); err != nil {
		return nil
	}
	return normalizeRequestUserInputPrompt(&prompt)
}

func requestUserInputPromptFromThreadRecord(t *threadstore.Thread, effectiveRunStatus string) *RequestUserInputPrompt {
	if t == nil {
		return nil
	}
	if NormalizeRunState(effectiveRunStatus) != RunStateWaitingUser {
		return nil
	}
	return parseRequestUserInputPromptJSON(t.WaitingUserInputJSON)
}

func requestUserInputPromptFromMessageJSON(raw string) *RequestUserInputPrompt {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var payload struct {
		ID     string            `json:"id"`
		Role   string            `json:"role"`
		Blocks []json.RawMessage `json:"blocks"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil
	}
	messageID := strings.TrimSpace(payload.ID)
	if messageID == "" {
		return nil
	}
	role := strings.TrimSpace(strings.ToLower(payload.Role))
	if role != "" && role != "assistant" {
		return nil
	}
	var fallbackPrompt *RequestUserInputPrompt
	for i := len(payload.Blocks) - 1; i >= 0; i-- {
		var block map[string]any
		if err := json.Unmarshal(payload.Blocks[i], &block); err != nil {
			continue
		}
		prompt, waitingUser := extractAskUserPromptSnapshot(block, messageID)
		if prompt == nil {
			continue
		}
		if waitingUser {
			return prompt
		}
		if fallbackPrompt == nil {
			fallbackPrompt = prompt
		}
	}
	return fallbackPrompt
}

func requestUserInputPromptFromMessages(messages []threadstore.Message, effectiveRunStatus string) *RequestUserInputPrompt {
	if NormalizeRunState(effectiveRunStatus) != RunStateWaitingUser {
		return nil
	}
	for i := len(messages) - 1; i >= 0; i-- {
		msg := messages[i]
		if !strings.EqualFold(strings.TrimSpace(msg.Role), "assistant") {
			continue
		}
		if prompt := requestUserInputPromptFromMessageJSON(msg.MessageJSON); prompt != nil {
			return prompt
		}
	}
	return nil
}

func normalizeRequestUserInputAnswer(answer RequestUserInputAnswer) RequestUserInputAnswer {
	out := RequestUserInputAnswer{
		SelectedOptionID: truncateRunes(strings.TrimSpace(answer.SelectedOptionID), 64),
		Answers:          normalizeRequestUserInputStringList(answer.Answers, 8, 2000),
	}
	return out
}

func normalizeRequestUserInputResponse(raw *RequestUserInputResponse) *RequestUserInputResponse {
	if raw == nil {
		return nil
	}
	promptID := strings.TrimSpace(raw.PromptID)
	if promptID == "" {
		return nil
	}
	answers := make(map[string]RequestUserInputAnswer, len(raw.Answers))
	keys := make([]string, 0, len(raw.Answers))
	for questionID, answer := range raw.Answers {
		questionID = truncateRunes(strings.TrimSpace(questionID), 80)
		if questionID == "" {
			continue
		}
		normalized := normalizeRequestUserInputAnswer(answer)
		if normalized.SelectedOptionID == "" && len(normalized.Answers) == 0 {
			continue
		}
		answers[questionID] = normalized
		keys = append(keys, questionID)
	}
	if len(answers) == 0 {
		return nil
	}
	sort.Strings(keys)
	out := &RequestUserInputResponse{
		PromptID: promptID,
		Answers:  make(map[string]RequestUserInputAnswer, len(keys)),
	}
	for _, key := range keys {
		out.Answers[key] = answers[key]
	}
	return out
}

func requestUserInputOptionByID(question *RequestUserInputQuestion, optionID string) (*RequestUserInputOption, bool) {
	if question == nil {
		return nil, false
	}
	optionID = strings.TrimSpace(optionID)
	if optionID == "" {
		return nil, false
	}
	for i := range question.Options {
		if strings.TrimSpace(question.Options[i].OptionID) == optionID {
			option := question.Options[i]
			return &option, true
		}
	}
	return nil, false
}

func validateRequestUserInputResponse(prompt *RequestUserInputPrompt, response *RequestUserInputResponse) (*RequestUserInputResponse, error) {
	prompt = normalizeRequestUserInputPrompt(prompt)
	response = normalizeRequestUserInputResponse(response)
	if prompt == nil || response == nil {
		return nil, ErrWaitingPromptChanged
	}
	if strings.TrimSpace(prompt.PromptID) != strings.TrimSpace(response.PromptID) {
		return nil, ErrWaitingPromptChanged
	}
	for _, question := range prompt.Questions {
		answer, exists := response.Answers[question.ID]
		if !exists {
			return nil, ErrWaitingPromptChanged
		}
		if answer.SelectedOptionID != "" {
			if _, ok := requestUserInputOptionByID(&question, answer.SelectedOptionID); !ok {
				return nil, ErrWaitingPromptChanged
			}
		}
		if !question.IsOther && len(answer.Answers) == 0 && answer.SelectedOptionID == "" {
			return nil, ErrWaitingPromptChanged
		}
		if question.IsOther && len(answer.Answers) == 0 && answer.SelectedOptionID == "" {
			return nil, ErrWaitingPromptChanged
		}
	}
	return response, nil
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

func buildRequestUserInputResponseRecord(prompt RequestUserInputPrompt, response RequestUserInputResponse, responseMessageID string) (RequestUserInputResponseRecord, []RequestUserInputSecretAnswer, error) {
	promptPtr := normalizeRequestUserInputPrompt(&prompt)
	responsePtr, err := validateRequestUserInputResponse(promptPtr, &response)
	if err != nil {
		return RequestUserInputResponseRecord{}, nil, err
	}
	prompt = *promptPtr
	response = *responsePtr

	record := RequestUserInputResponseRecord{
		PromptID:          prompt.PromptID,
		ToolID:            prompt.ToolID,
		ReasonCode:        prompt.ReasonCode,
		ResponseMessageID: strings.TrimSpace(responseMessageID),
	}
	secrets := make([]RequestUserInputSecretAnswer, 0, len(prompt.Questions))
	summaries := make([]string, 0, len(prompt.Questions))
	for _, question := range prompt.Questions {
		answer := response.Answers[question.ID]
		resolved := RequestUserInputResolvedQuestion{
			QuestionID: question.ID,
			Header:     question.Header,
			Question:   question.Question,
		}
		if option, ok := requestUserInputOptionByID(&question, answer.SelectedOptionID); ok {
			resolved.SelectedOptionID = option.OptionID
			resolved.SelectedOptionLabel = option.Label
		}
		if question.IsSecret {
			record.ContainsSecret = true
			resolved.ContainsSecret = true
			if len(answer.Answers) > 0 {
				secrets = append(secrets, RequestUserInputSecretAnswer{
					QuestionID: question.ID,
					Answers:    append([]string(nil), answer.Answers...),
				})
			}
			if resolved.SelectedOptionLabel != "" {
				resolved.PublicSummary = formatQuestionPublicSummary(question, resolved.SelectedOptionLabel, nil, true)
			} else {
				resolved.PublicSummary = formatQuestionPublicSummary(question, "", nil, true)
			}
		} else {
			resolved.Answers = append([]string(nil), answer.Answers...)
			resolved.PublicSummary = formatQuestionPublicSummary(question, resolved.SelectedOptionLabel, resolved.Answers, false)
		}
		record.Responses = append(record.Responses, resolved)
		if summary := strings.TrimSpace(resolved.PublicSummary); summary != "" {
			summaries = append(summaries, summary)
		}
	}
	record.PublicSummary = truncateRunes(strings.Join(summaries, " "), 600)
	return record, secrets, nil
}

func formatQuestionPublicSummary(question RequestUserInputQuestion, selectedOptionLabel string, answers []string, containsSecret bool) string {
	label := strings.TrimSpace(selectedOptionLabel)
	header := strings.TrimSpace(question.Header)
	if header == "" {
		header = strings.TrimSpace(question.Question)
	}
	if containsSecret {
		if label != "" {
			return truncateRunes(header+": "+label+".", 240)
		}
		return truncateRunes(header+": secret provided.", 240)
	}
	values := make([]string, 0, 1+len(answers))
	if label != "" {
		values = append(values, label)
	}
	values = append(values, answers...)
	if len(values) == 0 {
		return truncateRunes(header+": answered.", 240)
	}
	return truncateRunes(header+": "+strings.Join(values, "; ")+".", 240)
}

func minInt(a int, b int) int {
	if a <= b {
		return a
	}
	return b
}
