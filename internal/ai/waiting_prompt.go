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
	requestUserInputActionSetMode          = "set_mode"
	requestUserInputChoiceKindSelect       = "select"
	requestUserInputChoiceKindWrite        = "write"
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
	case requestUserInputChoiceKindWrite:
		return requestUserInputChoiceKindWrite
	default:
		return ""
	}
}

func normalizeLegacyRequestUserInputDetailInputMode(mode string) string {
	switch strings.TrimSpace(strings.ToLower(mode)) {
	case "optional", "required":
		return requestUserInputChoiceKindWrite
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

func defaultRequestUserInputWriteChoiceLabel(header string, question string) string {
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

func requestUserInputLegacyFallbackWriteChoice(header string, question string) RequestUserInputChoice {
	return RequestUserInputChoice{
		ChoiceID:         "write",
		Label:            defaultRequestUserInputWriteChoiceLabel(header, question),
		Kind:             requestUserInputChoiceKindWrite,
		InputPlaceholder: requestUserInputDefaultWritePlaceholder(requestUserInputResponseModeWrite),
	}
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
	return defaultRequestUserInputWriteChoiceLabel(header, question)
}

func requestUserInputDefaultWritePlaceholder(mode string) string {
	if normalizeRequestUserInputResponseMode(mode) == requestUserInputResponseModeSelectText {
		return "Type another answer"
	}
	return "Type your answer"
}

func requestUserInputFirstWriteChoice(choices []RequestUserInputChoice) (*RequestUserInputChoice, bool) {
	for i := range choices {
		if normalizeRequestUserInputChoiceKind(choices[i].Kind) != requestUserInputChoiceKindWrite {
			continue
		}
		choice := choices[i]
		return &choice, true
	}
	return nil, false
}

func requestUserInputSelectChoices(choices []RequestUserInputChoice) []RequestUserInputChoice {
	if len(choices) == 0 {
		return nil
	}
	out := make([]RequestUserInputChoice, 0, len(choices))
	for _, choice := range choices {
		if normalizeRequestUserInputChoiceKind(choice.Kind) == requestUserInputChoiceKindWrite {
			continue
		}
		choice.Kind = requestUserInputChoiceKindSelect
		choice.InputPlaceholder = ""
		out = append(out, choice)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func deriveRequestUserInputResponseMode(explicitMode string, choicesExhaustive *bool, fixedChoices []RequestUserInputChoice, hasWriteChoice bool) string {
	if len(fixedChoices) > 0 && choicesExhaustive != nil {
		if *choicesExhaustive {
			return requestUserInputResponseModeSelect
		}
		return requestUserInputResponseModeSelectText
	}
	if mode := normalizeRequestUserInputResponseMode(explicitMode); mode != "" {
		return mode
	}
	if hasWriteChoice {
		if len(fixedChoices) > 0 {
			return requestUserInputResponseModeSelectText
		}
		return requestUserInputResponseModeWrite
	}
	if len(fixedChoices) == 0 {
		return requestUserInputResponseModeWrite
	}
	return requestUserInputResponseModeSelect
}

func deriveRequestUserInputChoicesExhaustive(explicit *bool, responseMode string, fixedChoices []RequestUserInputChoice, hasWriteChoice bool) *bool {
	if len(fixedChoices) == 0 {
		return nil
	}
	if explicit != nil {
		return cloneBoolPtr(explicit)
	}
	switch normalizeRequestUserInputResponseMode(responseMode) {
	case requestUserInputResponseModeSelect:
		value := true
		return &value
	case requestUserInputResponseModeSelectText:
		value := false
		return &value
	}
	if hasWriteChoice {
		value := false
		return &value
	}
	return nil
}

func buildCanonicalRequestUserInputQuestion(question RequestUserInputQuestion, legacyChoicesExhaustive *bool) (RequestUserInputQuestion, bool) {
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
	writeChoice, hasWriteChoice := requestUserInputFirstWriteChoice(normalizedChoices)
	choicesExhaustive := cloneBoolPtr(question.ChoicesExhaustive)
	if choicesExhaustive == nil {
		choicesExhaustive = cloneBoolPtr(legacyChoicesExhaustive)
	}
	responseMode := deriveRequestUserInputResponseMode(question.ResponseMode, choicesExhaustive, fixedChoices, hasWriteChoice)
	choicesExhaustive = deriveRequestUserInputChoicesExhaustive(choicesExhaustive, responseMode, fixedChoices, hasWriteChoice)

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
		if writeLabel == "" && hasWriteChoice && writeChoice != nil {
			writeLabel = truncateRunes(strings.TrimSpace(writeChoice.Label), 200)
		}
		if writePlaceholder == "" && hasWriteChoice && writeChoice != nil {
			writePlaceholder = truncateRunes(strings.TrimSpace(writeChoice.InputPlaceholder), 160)
		}
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
	if record == nil {
		return RequestUserInputQuestion{}, false
	}
	id := strings.TrimSpace(anyToString(record["id"]))
	header := strings.TrimSpace(anyToString(record["header"]))
	question := strings.TrimSpace(anyToString(record["question"]))
	if id == "" && header == "" && question == "" {
		return RequestUserInputQuestion{}, false
	}
	choices := parseRequestUserInputChoicesAny(record["choices"])
	if len(choices) == 0 {
		choices = parseLegacyRequestUserInputChoices(record["options"], anyToBool(record["is_other"]), header, question)
	}
	if len(choices) == 0 {
		choices = normalizeRequestUserInputChoices([]RequestUserInputChoice{
			requestUserInputLegacyFallbackWriteChoice(header, question),
		})
	}
	var choicesExhaustive *bool
	if raw, ok := record["choices_exhaustive"]; ok {
		value := anyToBool(raw)
		choicesExhaustive = &value
	}
	return buildCanonicalRequestUserInputQuestion(RequestUserInputQuestion{
		ID:                id,
		Header:            header,
		Question:          question,
		IsSecret:          anyToBool(record["is_secret"]),
		ResponseMode:      anyToString(record["response_mode"]),
		ChoicesExhaustive: choicesExhaustive,
		WriteLabel:        anyToString(record["write_label"]),
		WritePlaceholder:  anyToString(record["write_placeholder"]),
		Choices:           choices,
	}, choicesExhaustive)
}

func parseRequestUserInputChoicesAny(value any) []RequestUserInputChoice {
	items := toAnySlice(value)
	if len(items) == 0 {
		return nil
	}
	choices := make([]RequestUserInputChoice, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok || record == nil {
			continue
		}
		actionsRaw, _ := record["actions"].([]any)
		actions := make([]RequestUserInputAction, 0, len(actionsRaw))
		for _, actionItem := range actionsRaw {
			actionRecord, ok := actionItem.(map[string]any)
			if !ok || actionRecord == nil {
				continue
			}
			actions = append(actions, RequestUserInputAction{
				Type: anyToString(actionRecord["type"]),
				Mode: anyToString(actionRecord["mode"]),
			})
		}
		choices = append(choices, RequestUserInputChoice{
			ChoiceID:         anyToString(record["choice_id"]),
			Label:            anyToString(record["label"]),
			Description:      anyToString(record["description"]),
			Kind:             anyToString(record["kind"]),
			InputPlaceholder: anyToString(record["input_placeholder"]),
			Actions:          actions,
		})
	}
	return normalizeRequestUserInputChoices(choices)
}

func parseLegacyRequestUserInputChoices(value any, allowOther bool, header string, question string) []RequestUserInputChoice {
	items := toAnySlice(value)
	choices := make([]RequestUserInputChoice, 0, len(items)+1)
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok || record == nil {
			continue
		}
		actionsRaw, _ := record["actions"].([]any)
		actions := make([]RequestUserInputAction, 0, len(actionsRaw))
		for _, actionItem := range actionsRaw {
			actionRecord, ok := actionItem.(map[string]any)
			if !ok || actionRecord == nil {
				continue
			}
			actions = append(actions, RequestUserInputAction{
				Type: anyToString(actionRecord["type"]),
				Mode: anyToString(actionRecord["mode"]),
			})
		}
		kind := requestUserInputChoiceKindSelect
		if normalizeLegacyRequestUserInputDetailInputMode(anyToString(record["detail_input_mode"])) == requestUserInputChoiceKindWrite {
			kind = requestUserInputChoiceKindWrite
		}
		choices = append(choices, RequestUserInputChoice{
			ChoiceID:         anyToString(record["option_id"]),
			Label:            anyToString(record["label"]),
			Description:      anyToString(record["description"]),
			Kind:             kind,
			InputPlaceholder: anyToString(record["detail_input_placeholder"]),
			Actions:          actions,
		})
	}
	if allowOther {
		choices = append(choices, RequestUserInputChoice{
			ChoiceID:         "other",
			Label:            "None of the above",
			Description:      "Type another answer.",
			Kind:             requestUserInputChoiceKindWrite,
			InputPlaceholder: "Type another answer",
		})
	}
	if len(choices) == 0 {
		choices = append(choices, requestUserInputLegacyFallbackWriteChoice(header, question))
	}
	return normalizeRequestUserInputChoices(choices)
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
			kind = requestUserInputChoiceKindSelect
		}
		label := truncateRunes(strings.TrimSpace(choice.Label), 200)
		if label == "" {
			if kind == requestUserInputChoiceKindWrite {
				label = "Other"
			} else {
				continue
			}
		}
		choiceID := truncateRunes(strings.TrimSpace(choice.ChoiceID), 64)
		if choiceID == "" {
			prefix := "choice"
			if kind == requestUserInputChoiceKindWrite {
				prefix = "write"
			}
			choiceID = fmt.Sprintf("%s_%d", prefix, idx+1)
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
			ChoiceID:         choiceID,
			Label:            label,
			Description:      truncateRunes(strings.TrimSpace(choice.Description), 240),
			Kind:             kind,
			InputPlaceholder: truncateRunes(strings.TrimSpace(choice.InputPlaceholder), 160),
			Actions:          normalizeRequestUserInputActions(choice.Actions),
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

func requestUserInputChoicesFromLabels(labels []string) []RequestUserInputChoice {
	if len(labels) == 0 {
		return nil
	}
	choices := make([]RequestUserInputChoice, 0, len(labels))
	for idx, label := range labels {
		label = strings.TrimSpace(label)
		if label == "" {
			continue
		}
		choices = append(choices, RequestUserInputChoice{
			ChoiceID: fmt.Sprintf("choice_%d", idx+1),
			Label:    label,
			Kind:     requestUserInputChoiceKindSelect,
		})
	}
	return normalizeRequestUserInputChoices(choices)
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
		}, nil)
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
	out.InteractionContract = normalizeInteractionContract(out.InteractionContract)
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
		PromptID            string              `json:"prompt_id"`
		MessageID           string              `json:"message_id"`
		ToolID              string              `json:"tool_id"`
		ReasonCode          string              `json:"reason_code"`
		RequiredFromUser    []string            `json:"required_from_user"`
		EvidenceRefs        []string            `json:"evidence_refs"`
		InteractionContract interactionContract `json:"interaction_contract"`
		Questions           []map[string]any    `json:"questions"`
		PublicSummary       string              `json:"public_summary"`
		ContainsSecret      bool                `json:"contains_secret"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil
	}
	questions := make([]RequestUserInputQuestion, 0, len(payload.Questions))
	for _, item := range payload.Questions {
		question, ok := requestUserInputQuestionFromRecord(item)
		if !ok {
			continue
		}
		questions = append(questions, question)
	}
	return normalizeRequestUserInputPrompt(&RequestUserInputPrompt{
		PromptID:            payload.PromptID,
		MessageID:           payload.MessageID,
		ToolID:              payload.ToolID,
		ReasonCode:          payload.ReasonCode,
		RequiredFromUser:    payload.RequiredFromUser,
		EvidenceRefs:        payload.EvidenceRefs,
		InteractionContract: payload.InteractionContract,
		Questions:           questions,
		PublicSummary:       payload.PublicSummary,
		ContainsSecret:      payload.ContainsSecret,
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
			if choice != nil && choice.Kind == requestUserInputChoiceKindWrite {
				secretLabel = ""
			}
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
