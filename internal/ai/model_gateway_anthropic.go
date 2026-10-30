package ai

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	flidentity "github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	fltools "github.com/floegence/floret/v7/tools"
)

// Floret owns the Messages wire protocol, cache hints and native history.
// Flower supplies already authorized content and product model controls.
type anthropicProvider struct {
	baseURL, apiKey string
	client          *http.Client
}

func (p *anthropicProvider) StreamTurn(ctx context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	prepared, err := p.prepareTurn(ctx, req)
	if err != nil {
		return ModelGatewayResult{}, err
	}
	defer prepared.Close()
	return prepared.StreamTurn(ctx, onEvent)
}

func (p *anthropicProvider) prepareTurn(ctx context.Context, req ModelGatewayRequest) (preparedModelGatewayTurn, error) {
	if p == nil {
		return nil, errors.New("nil Anthropic provider")
	}
	req, err := prepareModelGatewayImages(ctx, req)
	if err != nil {
		return nil, err
	}
	if err = validateGatewayAttachmentParts(req.Messages, "anthropic"); err != nil {
		return nil, err
	}
	selection, capability, err := providerReasoningSelection(req.ProviderControls)
	if err != nil {
		return nil, err
	}
	capabilities := floretModelGatewayCapabilities(capability)
	capabilities.AttachmentPayload = flprovider.AttachmentDescriptors
	contents := map[string]flprovider.AnthropicAttachment{}
	request := flprovider.Request{ThreadID: req.ThreadID, TurnID: req.TurnID, TraceID: req.TraceID, LogicalRequestID: req.LogicalRequestID, AttemptID: req.AttemptID, AttemptEpoch: req.AttemptEpoch, Step: req.Step, RunID: req.RunID, PromptScopeID: req.PromptScopeID, ReusePolicy: req.ReusePolicy, Reasoning: selection, MaxOutputTokens: int64(req.Budgets.MaxOutputToken)}
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
		request.PreviousState = &flprovider.State{ReusePolicy: state.ReusePolicy, Kind: state.Kind, ID: state.ID, Attributes: cloneStringMap(state.Attributes)}
	}
	for _, message := range req.Messages {
		mapped := flprovider.Message{Role: flprovider.MessageRole(message.Role), Attribution: cloneMessageAttribution(message.Attribution)}
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
				mapped.ToolCalls = append(mapped.ToolCalls, flprovider.ToolCall{ID: contentPartCallID(part), Name: contentPartToolName(part), Args: args})
			case "tool_result":
				if mapped.ToolResult != nil {
					return nil, errors.New("Anthropic message has multiple tool results")
				}
				mapped.ToolResult = &flprovider.ToolResult{CallID: contentPartCallID(part), ToolName: part.ToolName, Text: contentPartToolResultText(part)}
			case "image", "file":
				content := flprovider.AnthropicAttachment{Kind: part.Type, MIMEType: part.MimeType}
				if part.Type == "file" {
					content.Kind = "document"
				}
				if encoded, ok := extractDataURLBase64(part.FileURI); ok {
					content.Data, err = base64.StdEncoding.DecodeString(encoded)
					if err != nil {
						return nil, err
					}
				} else {
					content.URL = part.FileURI
				}
				ref := fmt.Sprintf("prepared-attachment:%d", len(contents))
				contents[ref] = content
				mapped.Attachments = append(mapped.Attachments, flprovider.Attachment{ResourceRef: ref, Name: part.Text, MIMEType: part.MimeType, SizeBytes: int64(len(content.Data))})
			default:
				return nil, fmt.Errorf("unsupported Anthropic content part %q", part.Type)
			}
		}
		if mapped.ToolResult != nil {
			mapped.ToolResult.Text += mapped.Text
			mapped.Text = ""
			mapped.ToolResult.Attachments = mapped.Attachments
			mapped.Attachments = nil
		}
		request.Messages = append(request.Messages, mapped)
	}
	for _, tool := range req.Tools {
		var schema map[string]any
		if len(tool.InputSchema) == 0 {
			schema = map[string]any{"type": "object", "properties": map[string]any{}}
		} else if err = json.Unmarshal(tool.InputSchema, &schema); err != nil {
			return nil, err
		}
		request.Tools = append(request.Tools, fltools.ToolDefinition{Name: tool.Name, Description: tool.Description, InputSchema: schema, Strict: true, Annotations: map[string]any{"source": tool.Source, "namespace": tool.Namespace, "canonical_name": tool.Name}})
	}
	gateway, err := flprovider.NewAnthropic(flprovider.AnthropicOptions{Provider: "anthropic", Model: strings.TrimSpace(req.Model), BaseURL: p.baseURL, APIKey: p.apiKey, StateCompatibilityKey: "anthropic-messages-v1:" + p.baseURL + ":" + req.Model, HTTPClient: p.client, Capabilities: capabilities, Temperature: req.ProviderControls.Temperature, TopP: req.ProviderControls.TopP, MaxRequestBytes: flowerModelRequestMaxBytes, ResolveAttachment: func(ctx context.Context, a flprovider.Attachment) (flprovider.AnthropicAttachment, error) {
		if err := ctx.Err(); err != nil {
			return flprovider.AnthropicAttachment{}, err
		}
		content, ok := contents[a.ResourceRef]
		if !ok {
			return flprovider.AnthropicAttachment{}, errors.New("Anthropic attachment has no authorized prepared content")
		}
		return content, nil
	}})
	if err != nil {
		return nil, err
	}
	prepared, err := gateway.(flprovider.RequestPreparer).Prepare(ctx, request)
	if err != nil {
		return nil, err
	}
	return &floretPreparedTurn{PreparedRequest: prepared, providerName: "anthropic"}, nil
}
