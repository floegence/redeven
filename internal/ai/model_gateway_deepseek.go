package ai

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
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

// DeepSeek wire rendering, stream parsing, and opaque history are owned by
// Floret. This adapter only maps Flower's product-neutral model DTOs.
type deepSeekProvider struct {
	imageFiles      *flprovider.DeepSeekImageFiles
	baseURL, apiKey string
	strictTools     bool
	client          *http.Client
}

func (p *deepSeekProvider) StreamTurn(ctx context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	prepared, err := p.prepareTurn(ctx, req)
	if err != nil {
		return ModelGatewayResult{}, err
	}
	defer prepared.Close()
	return prepared.StreamTurn(ctx, onEvent)
}

func (p *deepSeekProvider) prepareTurn(ctx context.Context, req ModelGatewayRequest) (preparedModelGatewayTurn, error) {
	preparedImages, imageErr := prepareModelGatewayImages(ctx, req)
	if imageErr != nil {
		return nil, imageErr
	}
	req = preparedImages

	var hosted []flprovider.HostedToolDefinition
	if req.WebSearchMode != "" && req.WebSearchMode != providerWebSearchModeDisabled {
		cap, ok := flprovider.DeepSeekModelCapabilities(req.Model)
		if !ok || cap.HostedWebSearchWireShape == "" || req.WebSearchMode != cap.HostedWebSearchWireShape {
			return nil, fmt.Errorf("unsupported DeepSeek hosted search mode %q for %q", req.WebSearchMode, req.Model)
		}
		hosted = []flprovider.HostedToolDefinition{{Name: "web_search", Type: "web_search", ReplaySafe: true, Options: map[string]any{"wire_shape": req.WebSearchMode}}}
	}
	aliases, err := newOpenAIProviderToolAliases(req.Tools)
	if err != nil {
		return nil, err
	}
	images := map[string][]byte{}
	resolveImage := func(ctx context.Context, attachment flprovider.Attachment) ([]byte, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		data, ok := images[attachment.ResourceRef]
		if !ok {
			return nil, errors.New("DeepSeek image has no authorized prepared content")
		}
		return data, nil
	}
	requestLimit := int64(flowerModelRequestMaxBytes)
	if officialDeepSeekEndpoint(p.baseURL) {
		requestLimit = 48 << 20
	}
	gateway, err := flprovider.NewDeepSeek(flprovider.DeepSeekOptions{ImageFiles: p.imageFiles, MaxRequestBytes: requestLimit, Model: req.Model, BaseURL: p.baseURL, APIKey: p.apiKey, StateCompatibilityKey: "deepseek-responses-v1:" + p.baseURL + ":" + req.Model, HTTPClient: p.client, ResolveAttachment: resolveImage, Temperature: req.ProviderControls.Temperature, TopP: req.ProviderControls.TopP, ResponseFormat: req.ProviderControls.ResponseFormat})
	if err != nil {
		return nil, err
	}
	request := flprovider.Request{HostedTools: hosted, ReusePolicy: req.ReusePolicy, RunID: req.RunID, PromptScopeID: req.PromptScopeID, Reasoning: req.ProviderControls.ReasoningSelection, MaxOutputTokens: int64(req.Budgets.MaxOutputToken)}
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
			case "image":
				prefix := "data:" + part.MimeType + ";base64,"
				if !strings.HasPrefix(part.FileURI, prefix) {
					return nil, errors.New("DeepSeek image requires prepared inline bytes matching its MIME type")
				}
				data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(part.FileURI, prefix))
				if err != nil || len(data) == 0 {
					return nil, errors.New("DeepSeek image has invalid inline content")
				}
				ref := fmt.Sprintf("prepared-image:%x", sha256.Sum256(data))
				images[ref] = data
				mapped.Attachments = append(mapped.Attachments, flprovider.Attachment{ResourceRef: ref, Name: "image", MIMEType: part.MimeType, SizeBytes: int64(len(data))})
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
					return nil, errors.New("DeepSeek message has multiple tool results")
				}
				mapped.ToolResult = &flprovider.ToolResult{CallID: part.ToolCallID, ToolName: part.ToolName, Text: part.Text}
			default:
				return nil, fmt.Errorf("unsupported DeepSeek content part %q", part.Type)
			}
		}
		if mapped.ToolResult != nil {
			mapped.ToolResult.Attachments = mapped.Attachments
			mapped.Attachments = nil
		}
		request.Messages = append(request.Messages, mapped)
	}
	for _, tool := range req.Tools {
		var schema map[string]any
		if len(tool.InputSchema) == 0 {
			schema = map[string]any{"type": "object", "properties": map[string]any{}}
		} else if err := json.Unmarshal(tool.InputSchema, &schema); err != nil {
			return nil, fmt.Errorf("DeepSeek tool %s schema: %w", tool.Name, err)
		}
		request.Tools = append(request.Tools, fltools.ToolDefinition{Name: aliases.wireName(tool.Name), Description: tool.Description, InputSchema: schema, Strict: p.strictTools, Annotations: map[string]any{"source": tool.Source, "namespace": tool.Namespace, "canonical_name": tool.Name}})
	}
	preparer, ok := gateway.(flprovider.RequestPreparer)
	if !ok {
		return nil, errors.New("DeepSeek transport cannot prepare its request")
	}
	prepared, err := preparer.Prepare(ctx, request)
	if err != nil {
		return nil, err
	}
	return &floretPreparedTurn{PreparedRequest: prepared, aliases: aliases, providerName: "deepseek"}, nil
}
