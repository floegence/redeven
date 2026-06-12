package ai

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
)

const (
	requestUserInputActionSetMode          = "set_mode"
	requestUserInputChoiceKindSelect       = "select"
	requestUserInputResponseModeSelect     = "select"
	requestUserInputResponseModeWrite      = "write"
	requestUserInputResponseModeSelectText = "select_or_write"
)

const (
	askUserGateReasonMissingChoices             = "missing_choices"
	askUserGateReasonMissingChoicesExhaustive   = "missing_choices_exhaustive"
	askUserGateReasonInconsistentChoiceContract = "inconsistent_choice_contract"
	askUserGateReasonInteractionShapeMismatch   = "interaction_shape_mismatch"
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

func requestUserInputQuestionFromRecord(record map[string]any) (RequestUserInputQuestion, bool) {
	return strictRequestUserInputQuestionFromRecord(record)
}

func requestUserInputQuestionFromModelRecord(record map[string]any) (RequestUserInputQuestion, string, bool) {
	question, ok := strictRequestUserInputQuestionFromRecord(record)
	if !ok {
		return RequestUserInputQuestion{}, askUserGateReasonInteractionShapeMismatch, false
	}
	return question, "", true
}

func validateRequestUserInputQuestionsContract(questions []RequestUserInputQuestion) string {
	if len(questions) == 0 {
		return askUserGateReasonMissingChoices
	}
	for _, question := range questions {
		responseMode := normalizeRequestUserInputResponseMode(question.ResponseMode)
		fixedChoices := requestUserInputSelectChoices(normalizeRequestUserInputChoices(question.Choices))
		if requestUserInputResponseModeRequiresChoices(responseMode) && len(fixedChoices) == 0 {
			return askUserGateReasonMissingChoices
		}
		if len(fixedChoices) == 0 {
			continue
		}
		if question.ChoicesExhaustive == nil {
			return askUserGateReasonMissingChoicesExhaustive
		}
		switch responseMode {
		case requestUserInputResponseModeSelect:
			if !*question.ChoicesExhaustive {
				return askUserGateReasonInconsistentChoiceContract
			}
		case requestUserInputResponseModeSelectText:
			if *question.ChoicesExhaustive {
				return askUserGateReasonInconsistentChoiceContract
			}
		default:
			return askUserGateReasonInconsistentChoiceContract
		}
	}
	return ""
}

func strictRequestUserInputChoice(choice RequestUserInputChoice) (RequestUserInputChoice, bool) {
	choiceID := truncateRunes(strings.TrimSpace(choice.ChoiceID), 64)
	label := truncateRunes(strings.TrimSpace(choice.Label), 200)
	kind := normalizeRequestUserInputChoiceKind(choice.Kind)
	if choiceID == "" || label == "" || kind == "" {
		return RequestUserInputChoice{}, false
	}
	return RequestUserInputChoice{
		ChoiceID:         choiceID,
		Label:            label,
		Description:      truncateRunes(strings.TrimSpace(choice.Description), 240),
		Kind:             kind,
		InputPlaceholder: truncateRunes(strings.TrimSpace(choice.InputPlaceholder), 160),
		Actions:          normalizeRequestUserInputActions(choice.Actions),
	}, true
}

func strictRequestUserInputChoicesFromAny(value any) ([]RequestUserInputChoice, bool) {
	items := toAnySlice(value)
	if len(items) == 0 {
		return nil, true
	}
	choices := make([]RequestUserInputChoice, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok || record == nil {
			return nil, false
		}
		actionsRaw := toAnySlice(record["actions"])
		actions := make([]RequestUserInputAction, 0, len(actionsRaw))
		for _, actionItem := range actionsRaw {
			actionRecord, ok := actionItem.(map[string]any)
			if !ok || actionRecord == nil {
				return nil, false
			}
			action, ok := normalizeRequestUserInputAction(RequestUserInputAction{
				Type: anyToString(actionRecord["type"]),
				Mode: anyToString(actionRecord["mode"]),
			})
			if !ok {
				return nil, false
			}
			actions = append(actions, action)
		}
		choice, ok := strictRequestUserInputChoice(RequestUserInputChoice{
			ChoiceID:         anyToString(record["choice_id"]),
			Label:            anyToString(record["label"]),
			Description:      anyToString(record["description"]),
			Kind:             anyToString(record["kind"]),
			InputPlaceholder: anyToString(record["input_placeholder"]),
			Actions:          actions,
		})
		if !ok {
			return nil, false
		}
		choices = append(choices, choice)
	}
	return choices, true
}

func strictRequestUserInputQuestion(question RequestUserInputQuestion) (RequestUserInputQuestion, bool) {
	id := truncateRunes(strings.TrimSpace(question.ID), 80)
	header := truncateRunes(strings.TrimSpace(question.Header), 120)
	text := truncateRunes(strings.TrimSpace(question.Question), 400)
	responseMode := normalizeRequestUserInputResponseMode(question.ResponseMode)
	if id == "" || header == "" || text == "" || responseMode == "" {
		return RequestUserInputQuestion{}, false
	}

	choices := make([]RequestUserInputChoice, 0, len(question.Choices))
	seenChoiceIDs := map[string]struct{}{}
	seenLabels := map[string]struct{}{}
	for _, rawChoice := range question.Choices {
		choice, ok := strictRequestUserInputChoice(rawChoice)
		if !ok {
			return RequestUserInputQuestion{}, false
		}
		choiceKey := strings.ToLower(choice.ChoiceID)
		labelKey := strings.ToLower(choice.Label)
		if _, ok := seenChoiceIDs[choiceKey]; ok {
			return RequestUserInputQuestion{}, false
		}
		if _, ok := seenLabels[labelKey]; ok {
			return RequestUserInputQuestion{}, false
		}
		seenChoiceIDs[choiceKey] = struct{}{}
		seenLabels[labelKey] = struct{}{}
		choices = append(choices, choice)
	}

	if requestUserInputResponseModeRequiresChoices(responseMode) && len(requestUserInputSelectChoices(choices)) == 0 {
		return RequestUserInputQuestion{}, false
	}
	if len(choices) > 0 && question.ChoicesExhaustive == nil {
		return RequestUserInputQuestion{}, false
	}
	if question.ChoicesExhaustive != nil {
		switch responseMode {
		case requestUserInputResponseModeSelect:
			if !*question.ChoicesExhaustive {
				return RequestUserInputQuestion{}, false
			}
		case requestUserInputResponseModeSelectText:
			if *question.ChoicesExhaustive {
				return RequestUserInputQuestion{}, false
			}
		}
	}

	out := RequestUserInputQuestion{
		ID:                id,
		Header:            header,
		Question:          text,
		IsSecret:          question.IsSecret,
		ResponseMode:      responseMode,
		ChoicesExhaustive: cloneBoolPtr(question.ChoicesExhaustive),
		WriteLabel:        truncateRunes(strings.TrimSpace(question.WriteLabel), 200),
		WritePlaceholder:  truncateRunes(strings.TrimSpace(question.WritePlaceholder), 160),
	}
	if requestUserInputResponseModeRequiresChoices(responseMode) {
		out.Choices = requestUserInputSelectChoices(choices)
	} else if responseMode == requestUserInputResponseModeWrite && len(choices) > 0 {
		return RequestUserInputQuestion{}, false
	}
	return out, true
}

func strictRequestUserInputQuestionFromRecord(record map[string]any) (RequestUserInputQuestion, bool) {
	if record == nil {
		return RequestUserInputQuestion{}, false
	}
	if _, ok := record["is_secret"]; !ok {
		return RequestUserInputQuestion{}, false
	}
	if _, ok := record["response_mode"]; !ok {
		return RequestUserInputQuestion{}, false
	}
	choices, ok := strictRequestUserInputChoicesFromAny(record["choices"])
	if !ok {
		return RequestUserInputQuestion{}, false
	}
	var choicesExhaustive *bool
	if raw, ok := record["choices_exhaustive"]; ok {
		value := anyToBool(raw)
		choicesExhaustive = &value
	}
	return strictRequestUserInputQuestion(RequestUserInputQuestion{
		ID:                anyToString(record["id"]),
		Header:            anyToString(record["header"]),
		Question:          anyToString(record["question"]),
		IsSecret:          anyToBool(record["is_secret"]),
		ResponseMode:      anyToString(record["response_mode"]),
		ChoicesExhaustive: choicesExhaustive,
		WriteLabel:        anyToString(record["write_label"]),
		WritePlaceholder:  anyToString(record["write_placeholder"]),
		Choices:           choices,
	})
}

func strictRequestUserInputPrompt(prompt *RequestUserInputPrompt) *RequestUserInputPrompt {
	if prompt == nil {
		return nil
	}
	out := *prompt
	out.PromptID = strings.TrimSpace(out.PromptID)
	out.MessageID = strings.TrimSpace(out.MessageID)
	out.ToolID = strings.TrimSpace(out.ToolID)
	out.ToolName = strings.TrimSpace(out.ToolName)
	if out.PromptID == "" || out.MessageID == "" || out.ToolID == "" || out.ToolName == "" {
		return nil
	}
	out.ReasonCode = normalizeAskUserReasonCode(out.ReasonCode)
	out.RequiredFromUser = normalizeRequestUserInputStringList(out.RequiredFromUser, 8, 200)
	out.EvidenceRefs = normalizeRequestUserInputStringList(out.EvidenceRefs, 12, 120)
	out.Questions = make([]RequestUserInputQuestion, 0, len(prompt.Questions))
	seenIDs := map[string]struct{}{}
	for _, question := range prompt.Questions {
		next, ok := strictRequestUserInputQuestion(question)
		if !ok {
			return nil
		}
		key := strings.ToLower(next.ID)
		if _, ok := seenIDs[key]; ok {
			return nil
		}
		seenIDs[key] = struct{}{}
		out.Questions = append(out.Questions, next)
	}
	if len(out.Questions) == 0 {
		return nil
	}
	out.ContainsSecret = requestUserInputPromptContainsSecret(out)
	out.PublicSummary = formatRequestUserInputAssistantSummary(out)
	return &out
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
	var payload struct {
		PromptID         string           `json:"prompt_id"`
		MessageID        string           `json:"message_id"`
		ToolID           string           `json:"tool_id"`
		ToolName         string           `json:"tool_name"`
		ReasonCode       string           `json:"reason_code"`
		RequiredFromUser []string         `json:"required_from_user"`
		EvidenceRefs     []string         `json:"evidence_refs"`
		Questions        []map[string]any `json:"questions"`
		PublicSummary    string           `json:"public_summary"`
		ContainsSecret   bool             `json:"contains_secret"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil
	}
	questions := make([]RequestUserInputQuestion, 0, len(payload.Questions))
	for _, item := range payload.Questions {
		question, ok := strictRequestUserInputQuestionFromRecord(item)
		if !ok {
			return nil
		}
		questions = append(questions, question)
	}
	return strictRequestUserInputPrompt(&RequestUserInputPrompt{
		PromptID:         payload.PromptID,
		MessageID:        payload.MessageID,
		ToolID:           payload.ToolID,
		ToolName:         payload.ToolName,
		ReasonCode:       payload.ReasonCode,
		RequiredFromUser: payload.RequiredFromUser,
		EvidenceRefs:     payload.EvidenceRefs,
		Questions:        questions,
		PublicSummary:    payload.PublicSummary,
		ContainsSecret:   payload.ContainsSecret,
	})
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

func normalizeRequestUserInputAnswer(answer RequestUserInputAnswer) RequestUserInputAnswer {
	return RequestUserInputAnswer{
		ChoiceID: truncateRunes(strings.TrimSpace(answer.ChoiceID), 64),
		Text:     truncateRunes(strings.TrimSpace(answer.Text), 2000),
	}
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
		if normalized.ChoiceID == "" && normalized.Text == "" {
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

func requestUserInputChoiceByID(question *RequestUserInputQuestion, choiceID string) (*RequestUserInputChoice, bool) {
	if question == nil {
		return nil, false
	}
	choiceID = strings.TrimSpace(choiceID)
	if choiceID == "" {
		return nil, false
	}
	for i := range question.Choices {
		if strings.TrimSpace(question.Choices[i].ChoiceID) == choiceID {
			choice := question.Choices[i]
			return &choice, true
		}
	}
	return nil, false
}

func normalizeRequestUserInputAnswerForQuestion(question *RequestUserInputQuestion, answer RequestUserInputAnswer) RequestUserInputAnswer {
	answer = normalizeRequestUserInputAnswer(answer)
	if question == nil {
		return answer
	}
	switch normalizeRequestUserInputResponseMode(question.ResponseMode) {
	case requestUserInputResponseModeWrite:
		answer.ChoiceID = ""
		return answer
	case requestUserInputResponseModeSelectText:
		if choice, ok := requestUserInputChoiceByID(question, answer.ChoiceID); ok && choice != nil {
			answer.ChoiceID = choice.ChoiceID
			return answer
		}
		if answer.Text != "" {
			answer.ChoiceID = ""
		}
		return answer
	default:
		if choice, ok := requestUserInputChoiceByID(question, answer.ChoiceID); ok && choice != nil {
			answer.ChoiceID = choice.ChoiceID
			answer.Text = ""
		}
		return answer
	}
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
	normalizedAnswers := make(map[string]RequestUserInputAnswer, len(prompt.Questions))
	for _, question := range prompt.Questions {
		answer, exists := response.Answers[question.ID]
		if !exists {
			return nil, ErrWaitingPromptChanged
		}
		answer = normalizeRequestUserInputAnswerForQuestion(&question, answer)
		switch normalizeRequestUserInputResponseMode(question.ResponseMode) {
		case requestUserInputResponseModeWrite:
			if answer.Text == "" {
				return nil, ErrWaitingPromptChanged
			}
			answer.ChoiceID = ""
		case requestUserInputResponseModeSelectText:
			if answer.ChoiceID != "" {
				if answer.Text != "" {
					return nil, ErrWaitingPromptChanged
				}
				if _, ok := requestUserInputChoiceByID(&question, answer.ChoiceID); !ok {
					return nil, ErrWaitingPromptChanged
				}
			} else if answer.Text == "" {
				return nil, ErrWaitingPromptChanged
			}
		default:
			if answer.Text != "" {
				return nil, ErrWaitingPromptChanged
			}
			if _, ok := requestUserInputChoiceByID(&question, answer.ChoiceID); !ok {
				return nil, ErrWaitingPromptChanged
			}
		}
		normalizedAnswers[question.ID] = answer
	}
	return &RequestUserInputResponse{
		PromptID: response.PromptID,
		Answers:  normalizedAnswers,
	}, nil
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
		choice, ok := requestUserInputChoiceByID(&question, answer.ChoiceID)
		if ok && choice != nil {
			resolved.SelectedChoiceID = choice.ChoiceID
			resolved.SelectedChoiceLabel = choice.Label
		}
		if question.IsSecret {
			record.ContainsSecret = true
			resolved.ContainsSecret = true
			if answer.Text != "" {
				secrets = append(secrets, RequestUserInputSecretAnswer{
					QuestionID: question.ID,
					Text:       answer.Text,
				})
			}
			secretLabel := resolved.SelectedChoiceLabel
			resolved.PublicSummary = formatQuestionPublicSummary(question, secretLabel, "", true)
		} else {
			resolved.Text = answer.Text
			resolved.PublicSummary = formatQuestionPublicSummary(question, resolved.SelectedChoiceLabel, resolved.Text, false)
		}
		record.Responses = append(record.Responses, resolved)
		if summary := strings.TrimSpace(resolved.PublicSummary); summary != "" {
			summaries = append(summaries, summary)
		}
	}
	record.PublicSummary = truncateRunes(strings.Join(summaries, " "), 600)
	return record, secrets, nil
}

func formatQuestionPublicSummary(question RequestUserInputQuestion, selectedChoiceLabel string, text string, containsSecret bool) string {
	label := strings.TrimSpace(selectedChoiceLabel)
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
	values := make([]string, 0, 2)
	if label != "" {
		values = append(values, label)
	}
	if text = strings.TrimSpace(text); text != "" {
		values = append(values, text)
	}
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
