package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	flprovider "github.com/floegence/floret/provider"
	flsession "github.com/floegence/floret/session"
)

type floretProviderAdapter struct {
	base Provider

	providerType string
	modelName    string
	mode         string
	webSearch    string

	controls              ProviderControls
	budgets               TurnBudgets
	resumeHistory         []flsession.Message
	initialProviderState  *flprovider.State
	recordSources         func([]SourceRef)
	continuationSupported bool
}

func newFloretProviderAdapter(base Provider, providerType string, modelName string, mode string, controls ProviderControls, budgets TurnBudgets, webSearch string, resumeHistory []flsession.Message, initialState *flprovider.State, recordSources func([]SourceRef)) *floretProviderAdapter {
	return &floretProviderAdapter{
		base:                  base,
		providerType:          strings.ToLower(strings.TrimSpace(providerType)),
		modelName:             strings.TrimSpace(modelName),
		mode:                  strings.TrimSpace(mode),
		webSearch:             strings.TrimSpace(webSearch),
		controls:              controls,
		budgets:               budgets,
		resumeHistory:         flsession.CloneMessages(resumeHistory),
		initialProviderState:  flprovider.CloneState(initialState),
		recordSources:         recordSources,
		continuationSupported: isOpenAIResponsesProviderContinuationEnabled(providerType),
	}
}

func (p *floretProviderAdapter) Stream(ctx context.Context, req flprovider.Request) (<-chan flprovider.StreamEvent, error) {
	if p == nil || p.base == nil {
		return nil, errors.New("nil floret provider adapter")
	}
	out := make(chan flprovider.StreamEvent, 32)
	go func() {
		defer close(out)

		turnReq := p.turnRequest(req)
		var streamedText strings.Builder
		var streamedReasoning strings.Builder
		result, err := p.base.StreamTurn(ctx, turnReq, func(ev StreamEvent) {
			switch ev.Type {
			case StreamEventTextDelta:
				if ev.Text == "" {
					return
				}
				streamedText.WriteString(ev.Text)
				sendFloretProviderEvent(ctx, out, flprovider.StreamEvent{Type: flprovider.Delta, Text: ev.Text})
			case StreamEventThinkingDelta:
				if ev.Text == "" {
					return
				}
				streamedReasoning.WriteString(ev.Text)
				sendFloretProviderEvent(ctx, out, flprovider.StreamEvent{Type: flprovider.Reasoning, Text: ev.Text})
			}
		})
		if err != nil {
			sendFloretProviderEvent(ctx, out, flprovider.StreamEvent{Type: flprovider.Error, Err: err, Reason: err.Error()})
			return
		}
		if strings.TrimSpace(streamedText.String()) == "" && strings.TrimSpace(result.Text) != "" {
			sendFloretProviderEvent(ctx, out, flprovider.StreamEvent{Type: flprovider.Delta, Text: result.Text})
		}
		if strings.TrimSpace(streamedReasoning.String()) == "" && strings.TrimSpace(result.Reasoning) != "" {
			sendFloretProviderEvent(ctx, out, flprovider.StreamEvent{Type: flprovider.Reasoning, Text: result.Reasoning})
		}
		if len(result.Sources) > 0 && p.recordSources != nil {
			p.recordSources(append([]SourceRef(nil), result.Sources...))
		}
		if len(result.ToolCalls) > 0 {
			sendFloretProviderEvent(ctx, out, flprovider.StreamEvent{Type: flprovider.ToolCalls, ToolCalls: floretToolCallsFromFlower(result.ToolCalls)})
		}
		usage := floretUsageFromFlower(result.Usage)
		if usage.InputTokens > 0 || usage.OutputTokens > 0 || usage.ReasoningTokens > 0 {
			sendFloretProviderEvent(ctx, out, flprovider.StreamEvent{Type: flprovider.UsageEvent, Usage: usage})
		}
		terminal := flprovider.StreamEvent{
			Type:          flprovider.Done,
			Reason:        normalizeReplyFinishReason(result.FinishReason),
			ResponseState: flowerProviderStateToFloret(result.ProviderState),
		}
		if terminal.Reason == "length" {
			terminal.Type = flprovider.Truncated
		}
		sendFloretProviderEvent(ctx, out, terminal)
	}()
	return out, nil
}

func (p *floretProviderAdapter) turnRequest(req flprovider.Request) TurnRequest {
	controls := p.controls
	previous := flprovider.CloneState(req.PreviousState)
	if p.shouldUsePreviousState(previous, req.Step) {
		controls.PreviousResponseID = strings.TrimSpace(previous.ID)
	} else {
		controls.PreviousResponseID = ""
	}

	messages := floretMessagesToFlower(req.Messages)
	if strings.TrimSpace(controls.PreviousResponseID) != "" && len(p.resumeHistory) > 0 {
		messages = floretMessagesToFlower(replaceFloretProviderHistoryWithResume(req.Messages, p.resumeHistory))
	}

	budgets := p.budgets
	if req.MaxOutputTokens > 0 {
		budgets.MaxOutputToken = int(req.MaxOutputTokens)
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = p.modelName
	}
	return TurnRequest{
		Model:            model,
		Messages:         messages,
		Tools:            flowerToolsFromFloret(req.Tools),
		Budgets:          budgets,
		ModeFlags:        ModeFlags{Mode: p.mode},
		ProviderControls: controls,
		WebSearchMode:    p.webSearch,
	}
}

func (p *floretProviderAdapter) shouldUsePreviousState(state *flprovider.State, step int) bool {
	if p == nil || !p.continuationSupported || state == nil {
		return false
	}
	if strings.TrimSpace(state.Kind) != providerContinuationKindOpenAIResponses || strings.TrimSpace(state.ID) == "" {
		return false
	}
	// Redeven's existing OpenAI Responses continuation contract only resumes
	// the first provider request of a user turn. Later Floret steps already have
	// explicit tool history in the local transcript.
	return step <= 1 && p.initialProviderState != nil && strings.TrimSpace(p.initialProviderState.ID) == strings.TrimSpace(state.ID)
}

func sendFloretProviderEvent(ctx context.Context, out chan<- flprovider.StreamEvent, ev flprovider.StreamEvent) {
	select {
	case <-ctx.Done():
	case out <- ev:
	}
}

func replaceFloretProviderHistoryWithResume(messages []flsession.Message, resume []flsession.Message) []flsession.Message {
	out := make([]flsession.Message, 0, 1+len(resume))
	for _, msg := range messages {
		if msg.Role == flsession.System && strings.TrimSpace(msg.Content) != "" {
			out = append(out, msg)
			break
		}
	}
	out = append(out, flsession.CloneMessages(resume)...)
	return out
}

func floretMessagesToFlower(messages []flsession.Message) []Message {
	out := make([]Message, 0, len(messages))
	for _, msg := range messages {
		role := string(msg.Role)
		switch msg.Role {
		case flsession.System:
			role = "system"
		case flsession.User:
			role = "user"
		case flsession.Assistant:
			role = "assistant"
		case flsession.Tool:
			role = "tool"
		}
		if msg.Role == flsession.Tool {
			out = append(out, Message{Role: "tool", Content: []ContentPart{{
				Type:       "tool_result",
				ToolCallID: strings.TrimSpace(msg.ToolCallID),
				ToolName:   strings.TrimSpace(msg.ToolName),
				Text:       strings.TrimSpace(msg.Content),
			}}})
			continue
		}
		if msg.Role == flsession.Assistant && strings.TrimSpace(msg.ToolCallID) != "" {
			parts := make([]ContentPart, 0, 2)
			if strings.TrimSpace(msg.Reasoning) != "" {
				parts = append(parts, ContentPart{Type: "reasoning", Text: msg.Reasoning})
			}
			args := strings.TrimSpace(msg.ToolArgs)
			if args == "" || !json.Valid([]byte(args)) {
				args = "{}"
			}
			parts = append(parts, ContentPart{
				Type:       "tool_call",
				ToolCallID: strings.TrimSpace(msg.ToolCallID),
				ToolName:   strings.TrimSpace(msg.ToolName),
				ArgsJSON:   args,
				JSON:       []byte(args),
			})
			out = append(out, Message{Role: "assistant", Content: parts})
			continue
		}
		parts := make([]ContentPart, 0, 2)
		if strings.TrimSpace(msg.Content) != "" {
			parts = append(parts, ContentPart{Type: "text", Text: msg.Content})
		}
		if msg.Role == flsession.Assistant && strings.TrimSpace(msg.Reasoning) != "" {
			parts = append(parts, ContentPart{Type: "reasoning", Text: msg.Reasoning})
		}
		if len(parts) == 0 {
			continue
		}
		out = append(out, Message{Role: role, Content: parts})
	}
	return out
}

func floretToolCallsFromFlower(calls []ToolCall) []flprovider.ToolCall {
	out := make([]flprovider.ToolCall, 0, len(calls))
	for _, call := range calls {
		name := strings.TrimSpace(call.Name)
		if name == "" {
			continue
		}
		raw := "{}"
		if call.Args != nil {
			if b, err := json.Marshal(call.Args); err == nil && json.Valid(b) {
				raw = string(b)
			}
		}
		out = append(out, flprovider.ToolCall{ID: strings.TrimSpace(call.ID), Name: name, Args: raw})
	}
	return out
}

func flowerToolsFromFloret(defs []flprovider.ToolDefinition) []ToolDef {
	out := make([]ToolDef, 0, len(defs))
	for _, def := range defs {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		raw := json.RawMessage(`{"type":"object","additionalProperties":true}`)
		if def.InputSchema != nil {
			if b, err := json.Marshal(def.InputSchema); err == nil && json.Valid(b) {
				raw = b
			}
		}
		out = append(out, ToolDef{
			Name:        name,
			Description: strings.TrimSpace(def.Description),
			InputSchema: raw,
		})
	}
	return out
}

func flowerProviderStateToFloret(state *TurnProviderState) *flprovider.State {
	if state == nil {
		return nil
	}
	kind := strings.TrimSpace(state.ContinuationKind)
	id := strings.TrimSpace(state.ContinuationID)
	if kind == "" || id == "" {
		return nil
	}
	return &flprovider.State{Kind: kind, ID: id}
}

func floretProviderStateToFlower(state *flprovider.State) *TurnProviderState {
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

func floretUsageFromFlower(usage TurnUsage) flprovider.Usage {
	out := flprovider.Usage{
		InputTokens:     usage.InputTokens,
		OutputTokens:    usage.OutputTokens,
		ReasoningTokens: usage.ReasoningTokens,
	}
	return out.Normalized()
}

func flowerUsageFromFloret(usage flprovider.Usage) TurnUsage {
	usage = usage.Normalized()
	return TurnUsage{
		InputTokens:     usage.InputTokens,
		OutputTokens:    usage.OutputTokens,
		ReasoningTokens: usage.ReasoningTokens,
	}
}
