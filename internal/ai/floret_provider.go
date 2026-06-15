package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
)

type floretProviderAdapter struct {
	base Provider

	providerType string
	modelName    string
	mode         string
	webSearch    string

	controls              ProviderControls
	budgets               TurnBudgets
	resumeHistory         []flruntime.TranscriptMessage
	streamRun             *run
	currentStateMu        sync.Mutex
	currentState          *flruntime.ModelState
	recordSources         func([]SourceRef)
	continuationSupported bool
}

func (p *floretProviderAdapter) bindStreamRun(r *run) {
	if p == nil {
		return
	}
	p.streamRun = r
}

func newFloretProviderAdapter(base Provider, providerType string, modelName string, mode string, controls ProviderControls, budgets TurnBudgets, webSearch string, resumeHistory []flruntime.TranscriptMessage, recordSources func([]SourceRef)) *floretProviderAdapter {
	return &floretProviderAdapter{
		base:                  base,
		providerType:          strings.ToLower(strings.TrimSpace(providerType)),
		modelName:             strings.TrimSpace(modelName),
		mode:                  strings.TrimSpace(mode),
		webSearch:             strings.TrimSpace(webSearch),
		controls:              controls,
		budgets:               budgets,
		resumeHistory:         cloneFloretTranscriptMessages(resumeHistory),
		recordSources:         recordSources,
		continuationSupported: isOpenAIResponsesProviderContinuationEnabled(providerType),
	}
}

func (p *floretProviderAdapter) StreamModel(ctx context.Context, req flruntime.ModelRequest) (<-chan flruntime.ModelEvent, error) {
	if p == nil || p.base == nil {
		return nil, errors.New("nil floret provider adapter")
	}
	out := make(chan flruntime.ModelEvent, 32)
	go func() {
		defer close(out)

		turnReq, err := p.turnRequest(req)
		if err != nil {
			sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventError, Err: err, Reason: err.Error()})
			return
		}
		var streamedText strings.Builder
		var streamedReasoning strings.Builder
		onEvent := func(ev StreamEvent) {
			switch ev.Type {
			case StreamEventTextDelta:
				if ev.Text == "" {
					return
				}
				streamedText.WriteString(ev.Text)
				p.emitTextDelta(ev.Text)
				sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventDelta, Text: ev.Text})
			case StreamEventThinkingDelta:
				if ev.Text == "" {
					return
				}
				streamedReasoning.WriteString(ev.Text)
				p.emitReasoningDelta(ev.Text)
				sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventReasoning, Text: ev.Text})
			}
		}
		result, err := p.base.StreamTurn(ctx, turnReq, onEvent)
		if err != nil && p.canReplayWithoutPreviousResponseID(req, turnReq, streamedText.String(), streamedReasoning.String(), err) {
			replayReq := req
			replayReq.PreviousState = nil
			turnReq, err = p.turnRequest(replayReq)
			if err != nil {
				sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventError, Err: err, Reason: err.Error()})
				return
			}
			streamedText.Reset()
			streamedReasoning.Reset()
			result, err = p.base.StreamTurn(ctx, turnReq, onEvent)
		}
		if err != nil {
			sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventError, Err: err, Reason: err.Error()})
			return
		}
		if strings.TrimSpace(streamedText.String()) == "" && strings.TrimSpace(result.Text) != "" {
			p.emitTextDelta(result.Text)
			sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventDelta, Text: result.Text})
		}
		if strings.TrimSpace(streamedReasoning.String()) == "" && strings.TrimSpace(result.Reasoning) != "" {
			p.emitReasoningDelta(result.Reasoning)
			sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventReasoning, Text: result.Reasoning})
		}
		if len(result.Sources) > 0 && p.recordSources != nil {
			p.recordSources(append([]SourceRef(nil), result.Sources...))
		}
		if len(result.ToolCalls) > 0 {
			toolCalls, err := floretToolCallsFromFlower(result.ToolCalls)
			if err != nil {
				sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventError, Err: err, Reason: err.Error()})
				return
			}
			sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventToolCalls, ToolCalls: toolCalls})
		}
		usage := floretUsageFromFlower(result.Usage)
		if usage.InputTokens > 0 || usage.OutputTokens > 0 || usage.ReasoningTokens > 0 {
			sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventUsage, Usage: usage})
		}
		terminal := flruntime.ModelEvent{
			Type:          flruntime.ModelEventDone,
			Reason:        normalizeReplyFinishReason(result.FinishReason),
			ResponseState: flowerProviderStateToFloret(result.ProviderState),
		}
		p.setCurrentProviderState(terminal.ResponseState)
		if terminal.Reason == "length" {
			terminal.Type = flruntime.ModelEventTruncated
		}
		sendFloretProviderEvent(ctx, out, terminal)
	}()
	return out, nil
}

func (p *floretProviderAdapter) canReplayWithoutPreviousResponseID(req flruntime.ModelRequest, turnReq TurnRequest, streamedText string, streamedReasoning string, err error) bool {
	if p == nil || !p.continuationSupported {
		return false
	}
	if strings.TrimSpace(turnReq.ProviderControls.PreviousResponseID) == "" {
		return false
	}
	if !p.shouldUsePreviousState(cloneFloretModelState(req.PreviousState), req.Step) {
		return false
	}
	if strings.TrimSpace(streamedText) != "" || strings.TrimSpace(streamedReasoning) != "" {
		return false
	}
	return isOpenAIContinuationRejection(err)
}

func (p *floretProviderAdapter) emitTextDelta(text string) {
	if p == nil || p.streamRun == nil || text == "" {
		return
	}
	_ = p.streamRun.appendTextDelta(text)
}

func (p *floretProviderAdapter) emitReasoningDelta(text string) {
	if p == nil || p.streamRun == nil || text == "" {
		return
	}
	p.streamRun.touchActivity()
	_ = p.streamRun.appendThinkingDelta(text)
	p.streamRun.persistRunEvent("thinking.delta", RealtimeStreamKindLifecycle, map[string]any{
		"delta": truncateRunes(text, 2000),
	})
}

func (p *floretProviderAdapter) setCurrentProviderState(state *flruntime.ModelState) {
	if p == nil {
		return
	}
	if state == nil {
		return
	}
	p.currentStateMu.Lock()
	defer p.currentStateMu.Unlock()
	p.currentState = cloneFloretModelState(state)
}

func (p *floretProviderAdapter) currentProviderState() *flruntime.ModelState {
	if p == nil {
		return nil
	}
	p.currentStateMu.Lock()
	defer p.currentStateMu.Unlock()
	return cloneFloretModelState(p.currentState)
}

func (p *floretProviderAdapter) turnRequest(req flruntime.ModelRequest) (TurnRequest, error) {
	controls := p.controls
	previous := cloneFloretModelState(req.PreviousState)
	if p.shouldUsePreviousState(previous, req.Step) {
		controls.PreviousResponseID = strings.TrimSpace(previous.ID)
	} else {
		controls.PreviousResponseID = ""
	}
	if req.DisableReasoning {
		controls.DisableReasoning = true
		controls.ThinkingBudgetTokens = 0
	}

	messages, err := floretMessagesToFlower(req.Messages)
	if err != nil {
		return TurnRequest{}, err
	}
	if strings.TrimSpace(controls.PreviousResponseID) != "" && len(p.resumeHistory) > 0 {
		messages, err = floretMessagesToFlower(replaceFloretProviderHistoryWithResume(req.Messages, p.resumeHistory))
		if err != nil {
			return TurnRequest{}, err
		}
	}
	tools, err := flowerToolsFromFloret(req.Tools)
	if err != nil {
		return TurnRequest{}, err
	}

	budgets := p.budgets
	if req.MaxOutputTokens > 0 {
		budgets.MaxOutputToken = int(req.MaxOutputTokens)
	}
	return TurnRequest{
		Model:            p.modelName,
		Messages:         messages,
		Tools:            tools,
		Budgets:          budgets,
		ModeFlags:        ModeFlags{Mode: p.mode},
		ProviderControls: controls,
		WebSearchMode:    p.webSearch,
	}, nil
}

func (p *floretProviderAdapter) shouldUsePreviousState(state *flruntime.ModelState, step int) bool {
	if p == nil || !p.continuationSupported || state == nil {
		return false
	}
	if strings.TrimSpace(state.Kind) != providerContinuationKindOpenAIResponses || strings.TrimSpace(state.ID) == "" {
		return false
	}
	// Redeven's existing OpenAI Responses continuation contract only resumes
	// the first provider request of a user turn. Later Floret steps already have
	// explicit tool history in the local transcript.
	return step <= 1
}

func sendFloretProviderEvent(ctx context.Context, out chan<- flruntime.ModelEvent, ev flruntime.ModelEvent) {
	select {
	case <-ctx.Done():
	case out <- ev:
	}
}

func replaceFloretProviderHistoryWithResume(messages []flruntime.ModelMessage, resume []flruntime.TranscriptMessage) []flruntime.ModelMessage {
	out := make([]flruntime.ModelMessage, 0, 1+len(resume))
	for _, msg := range messages {
		if strings.EqualFold(strings.TrimSpace(msg.Role), "system") && strings.TrimSpace(msg.Content) != "" {
			out = append(out, msg)
			break
		}
	}
	for _, msg := range resume {
		out = append(out, flruntime.ModelMessage{
			Role:       strings.TrimSpace(msg.Role),
			Content:    strings.TrimSpace(msg.Content),
			Reasoning:  strings.TrimSpace(msg.Reasoning),
			ToolCallID: strings.TrimSpace(msg.ToolCallID),
			ToolName:   strings.TrimSpace(msg.ToolName),
			ToolArgs:   strings.TrimSpace(msg.ToolArgs),
		})
	}
	return out
}

func floretMessagesToFlower(messages []flruntime.ModelMessage) ([]Message, error) {
	messages = projectFloretControlMessagesForProvider(messages)
	out := make([]Message, 0, len(messages))
	for i := 0; i < len(messages); i++ {
		msg := messages[i]
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		switch role {
		case "system":
			role = "system"
		case "user":
			role = "user"
		case "assistant":
			role = "assistant"
		case "tool":
			role = "tool"
		default:
			return nil, fmt.Errorf("Floret model message %d has unsupported Floret model message role %q", i, msg.Role)
		}
		if role == "tool" {
			out = append(out, Message{Role: "tool", Content: []ContentPart{{
				Type:       "tool_result",
				ToolCallID: strings.TrimSpace(msg.ToolCallID),
				ToolName:   strings.TrimSpace(msg.ToolName),
				Text:       strings.TrimSpace(msg.Content),
			}}})
			continue
		}
		if role == "assistant" && strings.TrimSpace(msg.ToolCallID) != "" {
			parts, next, err := floretAssistantToolCallParts(messages, i)
			if err != nil {
				return nil, err
			}
			out = append(out, Message{Role: "assistant", Content: parts})
			i = next - 1
			continue
		}
		parts := make([]ContentPart, 0, 2)
		if strings.TrimSpace(msg.Content) != "" {
			parts = append(parts, ContentPart{Type: "text", Text: msg.Content})
		}
		if role == "assistant" && strings.TrimSpace(msg.Reasoning) != "" {
			parts = append(parts, ContentPart{Type: "reasoning", Text: msg.Reasoning})
		}
		if len(parts) == 0 {
			continue
		}
		out = append(out, Message{Role: role, Content: parts})
	}
	if err := validateFloretProviderToolResultSequence(out); err != nil {
		return nil, err
	}
	return out, nil
}

func projectFloretControlMessagesForProvider(messages []flruntime.ModelMessage) []flruntime.ModelMessage {
	out := make([]flruntime.ModelMessage, 0, len(messages))
	for _, msg := range messages {
		if !isFlowerControlTool(msg.ToolName) {
			out = append(out, msg)
			continue
		}
		switch strings.ToLower(strings.TrimSpace(msg.Role)) {
		case "assistant":
			out = append(out, flruntime.ModelMessage{
				Role:    "assistant",
				Content: providerSafeFloretControlMessageText(msg),
			})
		case "tool":
			out = append(out, flruntime.ModelMessage{
				Role:    "assistant",
				Content: providerSafeFloretControlResultText(msg),
			})
		default:
			out = append(out, msg)
		}
	}
	return out
}

func providerSafeFloretControlMessageText(msg flruntime.ModelMessage) string {
	name := strings.TrimSpace(msg.ToolName)
	if name == "" {
		name = "control"
	}
	switch name {
	case "ask_user":
		return "Agent requested structured user input."
	case "exit_plan_mode":
		return "Agent requested a plan-to-act mode transition."
	case "task_complete":
		return "Agent emitted a task completion signal."
	default:
		return fmt.Sprintf("Agent control signal %q was emitted.", name)
	}
}

func providerSafeFloretControlResultText(msg flruntime.ModelMessage) string {
	name := strings.TrimSpace(msg.ToolName)
	if name == "" {
		name = "control"
	}
	content := strings.TrimSpace(msg.Content)
	if content == "" {
		return fmt.Sprintf("Host processed control signal %q.", name)
	}
	return fmt.Sprintf("Host processed control signal %q: %s", name, content)
}

func validateFloretProviderToolResultSequence(messages []Message) error {
	pending := map[string]struct{}{}
	pendingOrder := make([]string, 0, 2)
	for idx, msg := range messages {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		assistantCallIDs := toolCallIDsFromAssistantMessage(msg)
		if len(pending) > 0 {
			if role != "tool" {
				return fmt.Errorf("Floret provider history has unresolved tool call %q before %s message at index %d", pendingOrder[0], role, idx)
			}
			toolResultIDs := toolResultIDsFromMessage(msg)
			if len(toolResultIDs) == 0 {
				return fmt.Errorf("Floret provider history has empty tool result message at index %d", idx)
			}
			for _, id := range toolResultIDs {
				if _, ok := pending[id]; !ok {
					return fmt.Errorf("Floret provider history has tool result %q without a pending assistant tool call at index %d", id, idx)
				}
				delete(pending, id)
				pendingOrder = removeStringOnce(pendingOrder, id)
			}
			continue
		}
		if role == "tool" {
			toolResultIDs := toolResultIDsFromMessage(msg)
			if len(toolResultIDs) == 0 {
				return fmt.Errorf("Floret provider history has empty tool result message at index %d", idx)
			}
			return fmt.Errorf("Floret provider history has tool result %q without a preceding assistant tool call at index %d", toolResultIDs[0], idx)
		}
		for _, id := range assistantCallIDs {
			if _, ok := pending[id]; ok {
				continue
			}
			pending[id] = struct{}{}
			pendingOrder = append(pendingOrder, id)
		}
	}
	if len(pendingOrder) > 0 {
		return fmt.Errorf("Floret provider history has unresolved assistant tool call %q", pendingOrder[0])
	}
	return nil
}

func toolResultIDsFromMessage(msg Message) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(msg.Content))
	for _, part := range msg.Content {
		if strings.ToLower(strings.TrimSpace(part.Type)) != "tool_result" {
			continue
		}
		id := toolCallIDFromPart(part)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func removeStringOnce(values []string, target string) []string {
	for idx, value := range values {
		if value != target {
			continue
		}
		out := append([]string(nil), values[:idx]...)
		out = append(out, values[idx+1:]...)
		return out
	}
	return values
}

func floretAssistantToolCallParts(messages []flruntime.ModelMessage, start int) ([]ContentPart, int, error) {
	parts := make([]ContentPart, 0, 3)
	reasoningSet := make(map[string]struct{}, 1)
	for i := start; i < len(messages); i++ {
		msg := messages[i]
		if strings.ToLower(strings.TrimSpace(msg.Role)) != "assistant" || strings.TrimSpace(msg.ToolCallID) == "" {
			return parts, i, nil
		}
		if reasoning := strings.TrimSpace(msg.Reasoning); reasoning != "" {
			if _, ok := reasoningSet[reasoning]; !ok {
				parts = append(parts, ContentPart{Type: "reasoning", Text: reasoning})
				reasoningSet[reasoning] = struct{}{}
			}
		}
		args := strings.TrimSpace(msg.ToolArgs)
		if args == "" {
			args = "{}"
		}
		if !json.Valid([]byte(args)) {
			return nil, i, fmt.Errorf("invalid Floret assistant tool args for %s", strings.TrimSpace(msg.ToolName))
		}
		parts = append(parts, ContentPart{
			Type:       "tool_call",
			ToolCallID: strings.TrimSpace(msg.ToolCallID),
			ToolName:   strings.TrimSpace(msg.ToolName),
			ArgsJSON:   args,
			JSON:       []byte(args),
		})
	}
	return parts, len(messages), nil
}

func floretToolCallsFromFlower(calls []ToolCall) ([]fltools.ToolCall, error) {
	out := make([]fltools.ToolCall, 0, len(calls))
	for _, call := range calls {
		name := strings.TrimSpace(call.Name)
		if name == "" {
			continue
		}
		raw := "{}"
		if call.Args != nil {
			b, err := json.Marshal(call.Args)
			if err != nil || !json.Valid(b) {
				return nil, fmt.Errorf("invalid Flower tool args for %s", name)
			}
			raw = string(b)
		}
		out = append(out, fltools.ToolCall{ID: strings.TrimSpace(call.ID), Name: name, Args: raw})
	}
	return out, nil
}

func flowerToolsFromFloret(defs []fltools.ToolDefinition) ([]ToolDef, error) {
	out := make([]ToolDef, 0, len(defs))
	for _, def := range defs {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		raw := json.RawMessage(`{"type":"object","additionalProperties":true}`)
		if def.InputSchema != nil {
			b, err := json.Marshal(def.InputSchema)
			if err != nil || !json.Valid(b) {
				return nil, fmt.Errorf("invalid Floret tool schema for %s", name)
			}
			raw = b
		}
		out = append(out, ToolDef{
			Name:        name,
			Description: strings.TrimSpace(def.Description),
			InputSchema: raw,
		})
	}
	return out, nil
}

func flowerProviderStateToFloret(state *TurnProviderState) *flruntime.ModelState {
	if state == nil {
		return nil
	}
	kind := strings.TrimSpace(state.ContinuationKind)
	id := strings.TrimSpace(state.ContinuationID)
	if kind == "" || id == "" {
		return nil
	}
	return &flruntime.ModelState{Kind: kind, ID: id}
}

func floretProviderStateToFlower(state *flruntime.ModelState) *TurnProviderState {
	if state == nil {
		return nil
	}
	kind := strings.TrimSpace(state.Kind)
	id := strings.TrimSpace(state.ID)
	if kind == "" || id == "" {
		return nil
	}
	return &TurnProviderState{ContinuationKind: kind, ContinuationID: id}
}

func floretUsageFromFlower(usage TurnUsage) flruntime.ProviderUsage {
	out := flruntime.ProviderUsage{
		InputTokens:     usage.InputTokens,
		OutputTokens:    usage.OutputTokens,
		ReasoningTokens: usage.ReasoningTokens,
	}
	return normalizeFloretUsage(out)
}

func flowerUsageFromFloret(usage flruntime.ProviderUsage) TurnUsage {
	usage = normalizeFloretUsage(usage)
	return TurnUsage{
		InputTokens:     usage.InputTokens,
		OutputTokens:    usage.OutputTokens,
		ReasoningTokens: usage.ReasoningTokens,
	}
}

func cloneFloretTranscriptMessages(messages []flruntime.TranscriptMessage) []flruntime.TranscriptMessage {
	if len(messages) == 0 {
		return nil
	}
	out := make([]flruntime.TranscriptMessage, len(messages))
	copy(out, messages)
	return out
}

func cloneFloretModelState(state *flruntime.ModelState) *flruntime.ModelState {
	if state == nil {
		return nil
	}
	out := &flruntime.ModelState{
		Kind: strings.TrimSpace(state.Kind),
		ID:   strings.TrimSpace(state.ID),
	}
	if len(state.Attributes) > 0 {
		out.Attributes = make(map[string]string, len(state.Attributes))
		for key, value := range state.Attributes {
			out.Attributes[key] = value
		}
	}
	return out
}

func normalizeFloretUsage(usage flruntime.ProviderUsage) flruntime.ProviderUsage {
	if usage.TotalTokens <= 0 {
		usage.TotalTokens = usage.InputTokens + usage.OutputTokens + usage.ReasoningTokens + usage.CacheReadTokens + usage.CacheWriteTokens
	}
	if usage.Source == "" && usage.TotalTokens > 0 {
		usage.Source = "native"
	}
	if usage.TotalTokens > 0 || usage.InputTokens > 0 || usage.OutputTokens > 0 || usage.ReasoningTokens > 0 {
		usage.Available = true
	}
	return usage
}
