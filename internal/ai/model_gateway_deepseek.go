package ai

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	flidentity "github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	fltools "github.com/floegence/floret/v7/tools"
)

// DeepSeek wire rendering, stream parsing, and opaque history are owned by
// Floret. This adapter only maps Flower's product-neutral model DTOs.
type deepSeekProvider struct {
	baseURL, apiKey string
	strictTools     bool
	client          *http.Client
}

func (p *deepSeekProvider) StreamTurn(ctx context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var result ModelGatewayResult
	if req.ProviderControls.PreviousResponseID != "" {
		return result, errors.New("DeepSeek Responses requires full history, not previous_response_id")
	}
	aliases, err := newOpenAIProviderToolAliases(req.Tools)
	if err != nil {
		return result, err
	}
	gateway, err := flprovider.NewDeepSeek(flprovider.DeepSeekOptions{Model: req.Model, BaseURL: p.baseURL, APIKey: p.apiKey, StateCompatibilityKey: "deepseek-responses-v1:" + p.baseURL + ":" + req.Model, HTTPClient: p.client, Temperature: req.ProviderControls.Temperature, TopP: req.ProviderControls.TopP, ResponseFormat: req.ProviderControls.ResponseFormat})
	if err != nil {
		return result, err
	}
	request := flprovider.Request{RunID: req.RunID, PromptScopeID: req.PromptScopeID, Reasoning: req.ProviderControls.ReasoningSelection, MaxOutputTokens: int64(req.Budgets.MaxOutputToken)}
	if request.RunID == "" {
		request.RunID = flidentity.RunID("provider-" + rand.Text())
	}
	if request.PromptScopeID == "" {
		request.PromptScopeID = flidentity.PromptScopeID(request.RunID)
	}
	if request.MaxOutputTokens <= 0 {
		request.MaxOutputTokens = modelGatewayDefaultMaxOutputTokens
	}
	if state := req.PreviousState; state != nil {
		request.PreviousState = &flprovider.State{Kind: state.Kind, ID: state.ID, Attributes: cloneStringMap(state.Attributes)}
	}
	for _, message := range req.Messages {
		mapped := flprovider.Message{Role: flprovider.MessageRole(message.Role)}
		for _, part := range message.Content {
			switch part.Type {
			case "text", "attachment_manifest":
				mapped.Text += part.Text
			case "reasoning":
				mapped.Reasoning += part.Text
			case "tool_call":
				args := part.ArgsJSON
				if args == "" {
					args = string(part.JSON)
				}
				mapped.ToolCalls = append(mapped.ToolCalls, flprovider.ToolCall{ID: part.ToolCallID, Name: providerHistoryToolWireName(contentPartToolName(part), aliases), Args: args})
			case "tool_result":
				if mapped.ToolResult != nil {
					return result, errors.New("DeepSeek message has multiple tool results")
				}
				mapped.ToolResult = &flprovider.ToolResult{CallID: part.ToolCallID, ToolName: part.ToolName, Text: part.Text}
			default:
				return result, fmt.Errorf("unsupported DeepSeek content part %q", part.Type)
			}
		}
		request.Messages = append(request.Messages, mapped)
	}
	for _, tool := range req.Tools {
		var schema map[string]any
		if len(tool.InputSchema) == 0 {
			schema = map[string]any{"type": "object", "properties": map[string]any{}}
		} else if err := json.Unmarshal(tool.InputSchema, &schema); err != nil {
			return result, fmt.Errorf("DeepSeek tool %s schema: %w", tool.Name, err)
		}
		request.Tools = append(request.Tools, fltools.ToolDefinition{Name: aliases.wireName(tool.Name), Description: tool.Description, InputSchema: schema, Strict: p.strictTools})
	}
	switch req.WebSearchMode {
	case "", providerWebSearchModeDisabled:
	case providerWebSearchModeDeepSeekNative:
		request.HostedTools = []flprovider.HostedToolDefinition{{Name: "web_search", Type: "web_search"}}
	default:
		return result, fmt.Errorf("unsupported DeepSeek web search mode %q", req.WebSearchMode)
	}
	stream, err := gateway.Stream(ctx, request)
	if err != nil {
		return result, err
	}
	var text, reasoning strings.Builder
	terminal := false
	for event := range stream {
		if event.Err != nil {
			return result, event.Err
		}
		switch event.Type {
		case flprovider.EventDelta:
			text.WriteString(event.Text)
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventTextDelta, Text: event.Text})
		case flprovider.EventReasoning:
			reasoning.WriteString(event.Text)
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventThinkingDelta, Text: event.Text})
		case flprovider.EventToolCallStart, flprovider.EventToolCallDelta, flprovider.EventToolCallEnd:
			if call := event.ToolCallStream; call != nil {
				kind := StreamEventToolCallStart
				if event.Type == flprovider.EventToolCallDelta {
					kind = StreamEventToolCallDelta
				}
				if event.Type == flprovider.EventToolCallEnd {
					kind = StreamEventToolCallEnd
				}
				emitProviderEvent(onEvent, StreamEvent{Type: kind, ToolCall: &PartialToolCall{ID: call.ID, Name: canonicalProviderToolName(call.Name, aliases)}})
			}
		case flprovider.EventHostedToolCall, flprovider.EventHostedToolResult:
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventHostedTool, HostedToolEvent: &event})
		case flprovider.EventToolCalls:
			for _, call := range event.ToolCalls {
				var args map[string]any
				if err := json.Unmarshal([]byte(call.Args), &args); err != nil || args == nil {
					return result, errors.New("DeepSeek returned non-object tool arguments")
				}
				result.ToolCalls = append(result.ToolCalls, ToolCall{ID: call.ID, Name: canonicalProviderToolName(call.Name, aliases), Args: args})
			}
		case flprovider.EventSources:
			for _, source := range event.Sources {
				result.Sources = append(result.Sources, SourceRef{Title: source.Title, URL: source.URL})
			}
		case flprovider.EventUsage:
			u := event.Usage
			result.Usage = TurnUsage{InputTokens: u.InputTokens, OutputTokens: u.OutputTokens, ReasoningTokens: u.ReasoningTokens, CacheReadTokens: u.CacheReadTokens, CacheWriteTokens: u.CacheWriteTokens}
		case flprovider.EventDone, flprovider.EventTruncated:
			terminal = true
			result.FinishReason = event.Reason
			if event.Type == flprovider.EventTruncated {
				result.FinishReason = "length"
			}
			if state := event.ResponseState; state != nil {
				result.ProviderState = &ModelGatewayState{Kind: state.Kind, ID: state.ID, Attributes: cloneStringMap(state.Attributes)}
			}
		}
	}
	if !terminal {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		return result, errors.New("DeepSeek gateway closed without terminal event")
	}
	result.Text = text.String()
	result.Reasoning = reasoning.String()
	return result, validateModelGatewayResult(result)
}
