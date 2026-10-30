package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	flprovider "github.com/floegence/floret/v7/provider"
)

// floretPreparedTurn maps public provider events without interpreting native state.
type floretPreparedTurn struct {
	flprovider.PreparedRequest
	aliases      providerToolAliases
	providerName string
}

func (p *floretPreparedTurn) StreamTurn(ctx context.Context, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var result ModelGatewayResult
	aliases := p.aliases
	stream, err := p.Stream(ctx)
	if err != nil {
		return result, providerRequestFailure(err, nil, p.providerName)
	}
	var text, reasoning strings.Builder
	terminal := false
	argumentFragments := map[string]string{}
	for event := range stream {
		if event.Err != nil {
			return result, providerRequestFailure(event.Err, nil, p.providerName)
		}
		switch event.Type {
		case flprovider.EventTransport:
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventTransport, Transport: event.Transport})
		case flprovider.EventDelta:
			text.WriteString(event.Text)
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventTextDelta, Text: event.Text, OutputPart: event.OutputPart})
		case flprovider.EventReasoning:
			reasoning.WriteString(event.Text)
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventThinkingDelta, Text: event.Text, OutputPart: event.OutputPart})
		case flprovider.EventToolCallStart, flprovider.EventToolCallDelta, flprovider.EventToolCallEnd:
			if call := event.ToolCallStream; call != nil {
				kind := StreamEventToolCallStart
				if event.Type == flprovider.EventToolCallDelta {
					kind = StreamEventToolCallDelta
				}
				if event.Type == flprovider.EventToolCallEnd {
					kind = StreamEventToolCallEnd
				}
				partial := &PartialToolCall{ID: call.ID, Name: canonicalProviderToolName(call.Name, aliases)}
				if event.Type == flprovider.EventToolCallDelta {
					argumentFragments[call.ID] += event.Text
				}
				if event.Type == flprovider.EventToolCallEnd {
					_ = json.Unmarshal([]byte(argumentFragments[call.ID]), &partial.Arguments)
					delete(argumentFragments, call.ID)
				}
				emitProviderEvent(onEvent, StreamEvent{Type: kind, Text: event.Text, OutputPart: event.OutputPart, ToolCall: partial})
			}
		case flprovider.EventHostedToolCall, flprovider.EventHostedToolResult:
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventHostedTool, HostedToolEvent: &event})
		case flprovider.EventToolCalls:
			for _, call := range event.ToolCalls {
				var args map[string]any
				if err := json.Unmarshal([]byte(call.Args), &args); err != nil || args == nil {
					return result, errors.New("Floret returned non-object tool arguments")
				}
				result.ToolCalls = append(result.ToolCalls, ToolCall{ID: call.ID, Name: canonicalProviderToolName(call.Name, aliases), Args: args})
			}
		case flprovider.EventSources:
			for _, source := range event.Sources {
				result.Sources = append(result.Sources, SourceRef{Title: source.Title, URL: source.URL, StartIndex: source.StartIndex, EndIndex: source.EndIndex})
			}
		case flprovider.EventUsage:
			u := event.Usage
			result.Measurement = event.Usage.Measurement
			result.Usage = TurnUsage{InputTokensReported: u.InputTokensReported, OutputTokensReported: u.OutputTokensReported, InputTokenScope: u.InputTokenScope, TotalTokens: u.TotalTokens, TotalTokensReported: u.TotalTokensReported, OutputIncludesReasoning: u.OutputIncludesReasoning, Available: u.Available, InputTokens: u.InputTokens, OutputTokens: u.OutputTokens, ReasoningTokens: u.ReasoningTokens, CacheReadTokens: u.CacheReadTokens, CacheWriteTokens: u.CacheWriteTokens}
		case flprovider.EventEmpty:
			terminal = true
			result.FinishReason = "unknown"
		case flprovider.EventDone, flprovider.EventTruncated:
			result.ResponseID = event.ResponseID
			terminal = true
			result.FinishReason = event.Reason
			switch event.Reason {
			case "end_turn", "stop_sequence":
				result.FinishReason = "stop"
			case "tool_use":
				result.FinishReason = "tool_calls"
			case "max_tokens":
				result.FinishReason = "length"
			case "refusal":
				result.FinishReason = "content_filter"
			}
			if event.Type == flprovider.EventTruncated {
				result.FinishReason = "length"
			}
			if state := event.ResponseState; state != nil {
				result.ProviderState = &ModelGatewayState{ReusePolicy: state.ReusePolicy, Kind: state.Kind, ID: state.ID, Attributes: cloneStringMap(state.Attributes)}
			}
		}
	}
	if !terminal {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		return result, flprovider.WithRetryAdvice(errors.New("Floret gateway closed without terminal event"), flprovider.RetryAdvice{Category: flprovider.RetryStreamInterrupted})
	}
	result.Text = text.String()
	result.Reasoning = reasoning.String()
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventUsage, Usage: partialUsageFromTurnUsage(result.Usage)})
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventFinishReason, FinishHint: result.FinishReason})
	return result, validateModelGatewayResult(result)
}

func (p *floretPreparedTurn) replay(ctx context.Context, next flprovider.Request) (preparedModelGatewayTurn, error) {
	replayer, ok := p.PreparedRequest.(flprovider.PreparedRequestReplay)
	if !ok {
		return nil, errors.New("Floret request does not support frozen replay")
	}
	prepared, err := replayer.PrepareRetry(ctx, next)
	if err != nil {
		return nil, err
	}
	return &floretPreparedTurn{PreparedRequest: prepared, aliases: p.aliases, providerName: p.providerName}, nil
}

func (p *floretPreparedTurn) withMaxOutputTokens(ctx context.Context, limit int64) (preparedModelGatewayTurn, error) {
	limiter, ok := p.PreparedRequest.(flprovider.PreparedRequestOutputLimiter)
	if !ok {
		return nil, errors.New("Floret transport lacks frozen output control")
	}
	prepared, err := limiter.WithMaxOutputTokens(ctx, limit)
	if err != nil {
		return nil, err
	}
	return &floretPreparedTurn{PreparedRequest: prepared, aliases: p.aliases, providerName: p.providerName}, nil
}

func (p *floretPreparedTurn) InputMeasurementPrefix() flprovider.MeasurementPrefix {
	if m, ok := p.PreparedRequest.(flprovider.PreparedRequestMeasurement); ok {
		return m.InputMeasurementPrefix()
	}
	return flprovider.MeasurementPrefix{}
}
func (p *floretPreparedTurn) MeasurementSuffix(prefix flprovider.MeasurementPrefix) ([]byte, bool) {
	if m, ok := p.PreparedRequest.(flprovider.PreparedRequestMeasurement); ok {
		return m.MeasurementSuffix(prefix)
	}
	return nil, false
}
