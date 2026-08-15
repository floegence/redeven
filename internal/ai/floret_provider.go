package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	flconfig "github.com/floegence/floret/v4/config"
	flprovider "github.com/floegence/floret/v4/provider"
	flruntime "github.com/floegence/floret/v4/runtime"
	fltools "github.com/floegence/floret/v4/tools"
	"github.com/floegence/redeven/internal/config"
)

type floretProviderAdapter struct {
	base     ModelGateway
	identity flprovider.Identity

	providerType string
	modelName    string
	webSearch    string

	controls                   ProviderControls
	budgets                    TurnBudgets
	disabledCoreControlTools   map[string]struct{}
	continuationSupported      bool
	attachmentResolver         func(context.Context, flprovider.Attachment) (ContentPart, error)
	requestAttachmentResolver  func(context.Context, flprovider.Request, flprovider.Attachment) (ContentPart, error)
	supportsImageInput         bool
	supportsFileInput          bool
	supportsAttachmentToolRead bool
	admitRequest               func(context.Context, flprovider.Request) (context.Context, func(), error)
}

type floretProviderAdapterOption func(*floretProviderAdapter)

type preparedFloretModelRequest struct {
	mu              sync.Mutex
	adapter         *floretProviderAdapter
	providerRequest flprovider.Request
	request         ModelGatewayRequest
	estimate        flprovider.TokenEstimate
	fingerprint     string
	streamed        bool
	closed          bool
}

func newFloretProviderAdapter(base ModelGateway, providerType string, modelName string, controls ProviderControls, budgets TurnBudgets, webSearch string, options ...floretProviderAdapterOption) *floretProviderAdapter {
	adapter := &floretProviderAdapter{
		base:         base,
		providerType: strings.ToLower(strings.TrimSpace(providerType)),
		modelName:    strings.TrimSpace(modelName),
		webSearch:    strings.TrimSpace(webSearch),
		controls:     controls,
		budgets:      budgets,
	}
	for _, option := range options {
		if option != nil {
			option(adapter)
		}
	}
	adapter.continuationSupported = adapter.stateCompatibilityRoute() == "openai-responses"
	return adapter
}

func (p *floretProviderAdapter) Identity() flprovider.Identity {
	if p == nil {
		return flprovider.Identity{}
	}
	return p.identity
}

func (p *floretProviderAdapter) Capabilities() flprovider.Capabilities {
	if p == nil {
		return flprovider.Capabilities{}
	}
	return floretModelGatewayCapabilities(p.controls.ReasoningCapability)
}

func withFloretAttachmentResolver(resolver func(context.Context, flruntime.MessageAttachment) (ContentPart, error), supportsImageInput bool, supportsFileInput bool) floretProviderAdapterOption {
	return func(adapter *floretProviderAdapter) {
		if adapter == nil {
			return
		}
		if resolver != nil {
			adapter.attachmentResolver = func(ctx context.Context, attachment flprovider.Attachment) (ContentPart, error) {
				return resolver(ctx, runtimeAttachmentFromProvider(attachment))
			}
		}
		adapter.supportsImageInput = supportsImageInput
		adapter.supportsFileInput = supportsFileInput
	}
}

func withFloretAttachmentToolRead(enabled bool) floretProviderAdapterOption {
	return func(adapter *floretProviderAdapter) {
		if adapter != nil {
			adapter.supportsAttachmentToolRead = enabled
		}
	}
}

func withFloretRequestAdmission(admit func(context.Context, flprovider.Request) (context.Context, func(), error)) floretProviderAdapterOption {
	return func(adapter *floretProviderAdapter) {
		if adapter != nil && admit != nil {
			adapter.admitRequest = admit
		}
	}
}

func (p *floretProviderAdapter) Stream(ctx context.Context, req flprovider.Request) (<-chan flprovider.Event, error) {
	if p == nil || p.base == nil {
		return nil, errors.New("nil floret provider adapter")
	}
	turnReq, err := p.turnRequest(ctx, req)
	if err != nil {
		out := make(chan flprovider.Event, 1)
		out <- flprovider.Event{Type: flprovider.EventError, Err: err, Reason: err.Error()}
		close(out)
		return out, nil
	}
	return p.streamPreparedTurn(ctx, req, turnReq), nil
}

func (p *floretProviderAdapter) Prepare(ctx context.Context, req flprovider.Request) (flprovider.PreparedRequest, error) {
	if p == nil || p.base == nil {
		return nil, errors.New("nil floret provider adapter")
	}
	turnReq, err := p.turnRequest(ctx, req)
	if err != nil {
		return nil, err
	}
	payload, err := json.Marshal(turnReq)
	if err != nil {
		return nil, fmt.Errorf("marshal prepared model request: %w", err)
	}
	var frozen ModelGatewayRequest
	if err := json.Unmarshal(payload, &frozen); err != nil {
		return nil, fmt.Errorf("freeze prepared model request: %w", err)
	}
	estimate, err := conservativeRenderedGatewayRequestEstimate(payload, frozen)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(payload)
	return &preparedFloretModelRequest{
		adapter: p, providerRequest: req, request: frozen, estimate: estimate, fingerprint: fmt.Sprintf("sha256:%x", digest[:]),
	}, nil
}

func conservativeRenderedGatewayRequestEstimate(payload []byte, req ModelGatewayRequest) (flprovider.TokenEstimate, error) {
	if len(payload) == 0 {
		return flprovider.TokenEstimate{}, errors.New("prepared model request payload is empty")
	}
	messages, err := json.Marshal(req.Messages)
	if err != nil {
		return flprovider.TokenEstimate{}, fmt.Errorf("marshal prepared model gateway messages: %w", err)
	}
	tools, err := json.Marshal(req.Tools)
	if err != nil {
		return flprovider.TokenEstimate{}, fmt.Errorf("marshal prepared model gateway tools: %w", err)
	}
	total := int64(len(payload))
	messageTokens := int64(len(messages))
	toolTokens := int64(len(tools))
	prefixTokens := total - messageTokens - toolTokens
	if prefixTokens < 0 {
		prefixTokens = total
		messageTokens = 0
		toolTokens = 0
	}
	return flprovider.TokenEstimate{
		PrefixTokens: prefixTokens, MessageTokens: messageTokens, ToolDefinitionTokens: toolTokens,
		EstimatedInputTokens: total, Source: "redeven_gateway_rendered_json_utf8_bytes_v1",
		Method: string(flconfig.EstimateMethodProviderRenderedPayload), Confidence: "conservative",
		Coverage: "complete_request",
	}, nil
}

func (p *floretProviderAdapter) streamPreparedTurn(ctx context.Context, providerReq flprovider.Request, turnReq ModelGatewayRequest) <-chan flprovider.Event {
	out := make(chan flprovider.Event, 32)
	go func() {
		defer close(out)
		var err error
		requestContext := ctx
		releaseRequest := func() {}
		if p.admitRequest != nil {
			requestContext, releaseRequest, err = p.admitRequest(ctx, providerReq)
			if err != nil {
				sendFloretProviderEvent(ctx, out, flprovider.Event{Type: flprovider.EventError, Err: err, Reason: err.Error()})
				return
			}
		}
		defer releaseRequest()
		var streamedText strings.Builder
		var streamedReasoning strings.Builder
		onEvent := func(ev StreamEvent) {
			if p.isDisabledCoreControlTool(streamEventToolName(ev)) {
				return
			}
			switch ev.Type {
			case StreamEventTextDelta:
				if ev.Text == "" {
					return
				}
				streamedText.WriteString(ev.Text)
				sendFloretProviderEvent(ctx, out, flprovider.Event{Type: flprovider.EventDelta, Text: ev.Text})
			case StreamEventThinkingDelta:
				if ev.Text == "" {
					return
				}
				streamedReasoning.WriteString(ev.Text)
				sendFloretProviderEvent(ctx, out, flprovider.Event{Type: flprovider.EventReasoning, Text: ev.Text})
			case StreamEventToolCallStart:
				if stream := floretToolCallStreamFromFlower(ev.ToolCall); stream != nil {
					sendFloretProviderEvent(ctx, out, flprovider.Event{Type: flprovider.EventToolCallStart, ToolCallStream: stream})
				}
			case StreamEventToolCallDelta:
				if stream := floretToolCallStreamFromFlower(ev.ToolCall); stream != nil {
					sendFloretProviderEvent(ctx, out, flprovider.Event{Type: flprovider.EventToolCallDelta, ToolCallStream: stream})
				}
			case StreamEventToolCallEnd:
				if stream := floretToolCallStreamFromFlower(ev.ToolCall); stream != nil {
					sendFloretProviderEvent(ctx, out, flprovider.Event{Type: flprovider.EventToolCallEnd, ToolCallStream: stream})
				}
			}
		}
		result, err := p.base.StreamTurn(requestContext, turnReq, onEvent)
		if err != nil {
			sendFloretProviderEvent(ctx, out, flprovider.Event{Type: flprovider.EventError, Err: err, Reason: err.Error()})
			return
		}
		if strings.TrimSpace(streamedText.String()) == "" && strings.TrimSpace(result.Text) != "" {
			sendFloretProviderEvent(ctx, out, flprovider.Event{Type: flprovider.EventDelta, Text: result.Text})
		}
		if strings.TrimSpace(streamedReasoning.String()) == "" && strings.TrimSpace(result.Reasoning) != "" {
			sendFloretProviderEvent(ctx, out, flprovider.Event{Type: flprovider.EventReasoning, Text: result.Reasoning})
		}
		if len(result.Sources) > 0 {
			sendFloretProviderEvent(ctx, out, flprovider.Event{Type: flprovider.EventSources, Sources: flowerSourcesToFloret(result.Sources)})
		}
		if len(result.ToolCalls) > 0 {
			if toolName := p.firstDisabledCoreControlToolCall(result.ToolCalls); toolName != "" {
				err := fmt.Errorf("Floret core control tool %q is disabled for this run", toolName)
				sendFloretProviderEvent(ctx, out, flprovider.Event{Type: flprovider.EventError, Err: err, Reason: err.Error()})
				return
			}
			toolCalls, err := floretToolCallsFromFlower(result.ToolCalls)
			if err != nil {
				sendFloretProviderEvent(ctx, out, flprovider.Event{Type: flprovider.EventError, Err: err, Reason: err.Error()})
				return
			}
			sendFloretProviderEvent(ctx, out, flprovider.Event{Type: flprovider.EventToolCalls, ToolCalls: toolCalls})
		}
		usage := floretUsageFromFlower(result.Usage)
		if usage.InputTokens > 0 || usage.OutputTokens > 0 || usage.ReasoningTokens > 0 {
			sendFloretProviderEvent(ctx, out, flprovider.Event{Type: flprovider.EventUsage, Usage: usage})
		}
		responseState, err := flowerProviderStateToFloret(result.ProviderState)
		if err != nil {
			sendFloretProviderEvent(ctx, out, flprovider.Event{Type: flprovider.EventError, Err: err, Reason: err.Error()})
			return
		}
		terminal := flprovider.Event{
			Type:          flprovider.EventDone,
			Reason:        normalizeReplyFinishReason(result.FinishReason),
			ResponseState: responseState,
		}
		if terminal.Reason == "length" {
			terminal.Type = flprovider.EventTruncated
		}
		sendFloretProviderEvent(ctx, out, terminal)
	}()
	return out
}

func (p *preparedFloretModelRequest) Stream(ctx context.Context) (<-chan flprovider.Event, error) {
	if p == nil {
		return nil, errors.New("nil prepared model request")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil, errors.New("prepared model request is closed")
	}
	if p.streamed {
		return nil, errors.New("prepared model request was already streamed")
	}
	if p.adapter == nil {
		return nil, errors.New("prepared model request adapter is unavailable")
	}
	p.streamed = true
	return p.adapter.streamPreparedTurn(ctx, p.providerRequest, p.request), nil
}

func (p *preparedFloretModelRequest) TokenEstimate() flprovider.TokenEstimate {
	if p == nil {
		return flprovider.TokenEstimate{}
	}
	return p.estimate
}

func (p *preparedFloretModelRequest) RenderedPayloadFingerprint() string {
	if p == nil {
		return ""
	}
	return p.fingerprint
}

func (p *preparedFloretModelRequest) Close() error {
	if p == nil {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil
	}
	p.closed = true
	p.adapter = nil
	p.providerRequest = flprovider.Request{}
	p.request = ModelGatewayRequest{}
	return nil
}

var _ flprovider.Gateway = (*floretProviderAdapter)(nil)
var _ flprovider.RequestPreparer = (*floretProviderAdapter)(nil)
var _ flprovider.PreparedRequest = (*preparedFloretModelRequest)(nil)

func floretToolCallStreamFromFlower(call *PartialToolCall) *flprovider.ToolCallStream {
	if call == nil {
		return nil
	}
	id := strings.TrimSpace(call.ID)
	name := strings.TrimSpace(call.Name)
	if id == "" || name == "" {
		return nil
	}
	return &flprovider.ToolCallStream{
		ID:   id,
		Name: name,
	}
}

func flowerSourcesToFloret(in []SourceRef) []flprovider.Source {
	out := make([]flprovider.Source, 0, len(in))
	for _, src := range in {
		if strings.TrimSpace(src.Title) == "" && strings.TrimSpace(src.URL) == "" {
			continue
		}
		out = append(out, flprovider.Source{
			Title: strings.TrimSpace(src.Title),
			URL:   strings.TrimSpace(src.URL),
		})
	}
	return out
}

func (p *floretProviderAdapter) turnRequest(ctx context.Context, req flprovider.Request) (ModelGatewayRequest, error) {
	controls := p.controls
	previous := cloneFloretModelState(req.PreviousState)
	previousResponseID, err := p.previousResponseID(previous)
	if err != nil {
		return ModelGatewayRequest{}, err
	}
	controls.PreviousResponseID = previousResponseID
	// Floret request-level reasoning is authoritative, including an explicit
	// zero selection used by short requests such as automatic titles.
	controls.ReasoningSelection = config.NormalizeAIReasoningSelection(req.Reasoning)

	resolver := p.attachmentResolver
	if p.requestAttachmentResolver != nil {
		resolver = func(ctx context.Context, attachment flprovider.Attachment) (ContentPart, error) {
			return p.requestAttachmentResolver(ctx, req, attachment)
		}
	}
	messages, err := p.floretMessagesToFlowerWithResolver(ctx, req.Messages, resolver)
	if err != nil {
		return ModelGatewayRequest{}, err
	}
	tools, err := flowerToolsFromFloret(req.Tools)
	if err != nil {
		return ModelGatewayRequest{}, err
	}
	tools = p.filterDisabledCoreControlTools(tools)

	budgets := p.budgets
	if req.MaxOutputTokens > 0 {
		budgets.MaxOutputToken = int(req.MaxOutputTokens)
	}
	return ModelGatewayRequest{
		Model:            p.modelName,
		Messages:         messages,
		Tools:            tools,
		Budgets:          budgets,
		ProviderControls: controls,
		WebSearchMode:    p.webSearch,
	}, nil
}

func streamEventToolName(ev StreamEvent) string {
	if ev.ToolCall == nil {
		return ""
	}
	return strings.TrimSpace(ev.ToolCall.Name)
}

func (p *floretProviderAdapter) isDisabledCoreControlTool(name string) bool {
	if p == nil || len(p.disabledCoreControlTools) == 0 {
		return false
	}
	_, ok := p.disabledCoreControlTools[strings.TrimSpace(name)]
	return ok
}

func (p *floretProviderAdapter) filterDisabledCoreControlTools(in []ToolDef) []ToolDef {
	if p == nil || len(p.disabledCoreControlTools) == 0 || len(in) == 0 {
		return in
	}
	out := make([]ToolDef, 0, len(in))
	for _, def := range in {
		if p.isDisabledCoreControlTool(def.Name) {
			continue
		}
		out = append(out, def)
	}
	return out
}

func (p *floretProviderAdapter) firstDisabledCoreControlToolCall(calls []ToolCall) string {
	if p == nil || len(p.disabledCoreControlTools) == 0 {
		return ""
	}
	for _, call := range calls {
		if name := strings.TrimSpace(call.Name); p.isDisabledCoreControlTool(name) {
			return name
		}
	}
	return ""
}

func (p *floretProviderAdapter) previousResponseID(state *flprovider.State) (string, error) {
	if state == nil {
		return "", nil
	}
	if p == nil || !p.continuationSupported {
		return "", errors.New("Floret provided continuation state to a gateway without continuation support")
	}
	if strings.TrimSpace(state.Kind) != providerContinuationKindOpenAIResponses || strings.TrimSpace(state.ID) == "" {
		return "", errors.New("Floret provided invalid OpenAI Responses continuation state")
	}
	return strings.TrimSpace(state.ID), nil
}

func (p *floretProviderAdapter) stateCompatibilityRoute() string {
	if p == nil {
		return ""
	}
	if p.providerType == "openai" {
		return "openai-responses"
	}
	switch p.providerType {
	case "anthropic":
		return "anthropic-messages"
	case DesktopModelSourceProviderType:
		return "desktop-model-source"
	case "openai_compatible", "openrouter", "xai", "groq", "ollama", "chatglm", "deepseek", "qwen":
		if p.webSearch == providerWebSearchModeOpenAIResponsesBuiltin ||
			p.webSearch == providerWebSearchModeQwenResponsesWebSearch ||
			(p.providerType == "openai_compatible" && p.webSearch == providerWebSearchModeExternalBrave) {
			return "openai-responses"
		}
		return "openai-chat-completions"
	default:
		return "openai-chat-completions"
	}
}

func sendFloretProviderEvent(ctx context.Context, out chan<- flprovider.Event, ev flprovider.Event) {
	select {
	case <-ctx.Done():
	case out <- ev:
	}
}

func (p *floretProviderAdapter) floretMessagesToFlowerWithResolver(ctx context.Context, messages []flprovider.Message, resolver func(context.Context, flprovider.Attachment) (ContentPart, error)) ([]Message, error) {
	out := make([]Message, 0, len(messages))
	for i, msg := range messages {
		if err := msg.Validate(); err != nil {
			return nil, fmt.Errorf("invalid Floret model message %d: %w", i, err)
		}
		parts := make([]ContentPart, 0, 2+len(msg.Attachments)+len(msg.ToolCalls))
		if msg.Text != "" {
			parts = append(parts, ContentPart{Type: "text", Text: msg.Text})
		}
		for attachmentIndex, attachment := range msg.Attachments {
			if p == nil || resolver == nil {
				return nil, fmt.Errorf("Floret model message %d attachment %d has no host resolver", i, attachmentIndex)
			}
			part, err := resolver(ctx, attachment)
			if err != nil {
				return nil, fmt.Errorf("resolve Floret model message %d attachment %d: %w", i, attachmentIndex, err)
			}
			if strings.EqualFold(strings.TrimSpace(part.Type), "attachment_manifest") {
				if strings.TrimSpace(part.Text) == "" {
					return nil, errors.New("attachment resolver returned an empty attachment manifest")
				}
				parts = append(parts, ContentPart{Type: "text", Text: part.Text})
				continue
			}
			if err := p.validateResolvedAttachment(part); err != nil {
				return nil, err
			}
			parts = append(parts, part)
		}
		if msg.Reasoning != "" {
			parts = append(parts, ContentPart{Type: "reasoning", Text: msg.Reasoning})
		}
		for _, call := range msg.ToolCalls {
			if !json.Valid([]byte(call.Args)) {
				return nil, fmt.Errorf("Floret model message %d tool %q has invalid JSON args", i, call.Name)
			}
			parts = append(parts, ContentPart{
				Type:       "tool_call",
				ToolCallID: call.ID,
				ToolName:   call.Name,
				ArgsJSON:   call.Args,
				JSON:       []byte(call.Args),
			})
		}
		if msg.ToolResult != nil {
			parts = append(parts, ContentPart{
				Type:       "tool_result",
				ToolCallID: msg.ToolResult.CallID,
				ToolName:   msg.ToolResult.ToolName,
				Text:       msg.ToolResult.Text,
			})
		}
		out = append(out, Message{Role: string(msg.Role), Content: parts})
	}
	return out, nil
}

func (p *floretProviderAdapter) validateResolvedAttachment(part ContentPart) error {
	modelName := ""
	if p != nil {
		modelName = p.modelName
	}
	switch strings.ToLower(strings.TrimSpace(part.Type)) {
	case "image":
		if p == nil || !p.supportsImageInput {
			return fmt.Errorf("model %q does not support image input", modelName)
		}
	case "file":
		if p == nil || !p.supportsFileInput {
			return fmt.Errorf("model %q does not support file input", modelName)
		}
	default:
		return fmt.Errorf("attachment resolver returned unsupported content type %q", part.Type)
	}
	if strings.TrimSpace(part.FileURI) == "" || strings.TrimSpace(part.MimeType) == "" {
		return errors.New("attachment resolver returned incomplete provider content")
	}
	return p.validateResolvedAttachmentForProvider(part)
}

func floretToolCallsFromFlower(calls []ToolCall) ([]flprovider.ToolCall, error) {
	out := make([]flprovider.ToolCall, 0, len(calls))
	for _, call := range calls {
		id := strings.TrimSpace(call.ID)
		name := strings.TrimSpace(call.Name)
		if id == "" || name == "" || call.Args == nil {
			return nil, errors.New("Flower tool call requires id, name, and args")
		}
		b, err := json.Marshal(call.Args)
		if err != nil || !json.Valid(b) {
			return nil, fmt.Errorf("invalid Flower tool args for %s", name)
		}
		out = append(out, flprovider.ToolCall{ID: id, Name: name, Args: string(b)})
	}
	return out, nil
}

func flowerToolsFromFloret(defs []fltools.ToolDefinition) ([]ToolDef, error) {
	out := make([]ToolDef, 0, len(defs))
	for _, def := range defs {
		name := strings.TrimSpace(def.Name)
		if name == "" || def.InputSchema == nil {
			return nil, errors.New("Floret tool definition requires name and input schema")
		}
		b, err := json.Marshal(def.InputSchema)
		if err != nil || !json.Valid(b) {
			return nil, fmt.Errorf("invalid Floret tool schema for %s", name)
		}
		out = append(out, ToolDef{
			Name:        name,
			Description: strings.TrimSpace(def.Description),
			InputSchema: b,
		})
	}
	return out, nil
}

func flowerProviderStateToFloret(state *ModelGatewayState) (*flprovider.State, error) {
	if state == nil {
		return nil, nil
	}
	kind := strings.TrimSpace(state.Kind)
	id := strings.TrimSpace(state.ID)
	if kind == "" || id == "" {
		return nil, errors.New("Flower provider state requires kind and id")
	}
	return &flprovider.State{Kind: kind, ID: id, Attributes: cloneStringMap(state.Attributes)}, nil
}

func floretUsageFromFlower(usage TurnUsage) flprovider.Usage {
	out := flprovider.Usage{
		InputTokens:     usage.InputTokens,
		OutputTokens:    usage.OutputTokens,
		ReasoningTokens: usage.ReasoningTokens,
	}
	return normalizeFloretUsage(out)
}

func cloneFloretModelState(state *flprovider.State) *flprovider.State {
	if state == nil {
		return nil
	}
	out := &flprovider.State{
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

func cloneStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func runtimeAttachmentFromProvider(attachment flprovider.Attachment) flruntime.MessageAttachment {
	out := flruntime.MessageAttachment{
		ResourceRef: attachment.ResourceRef,
		Name:        attachment.Name,
		MIMEType:    attachment.MIMEType,
		SizeBytes:   attachment.SizeBytes,
	}
	if attachment.TextStats != nil {
		out.TextStats = &flruntime.MessageAttachmentTextStats{
			UnicodeCodePointCount: attachment.TextStats.UnicodeCodePointCount,
			LogicalLineCount:      attachment.TextStats.LogicalLineCount,
		}
	}
	return out
}

func normalizeFloretUsage(usage flprovider.Usage) flprovider.Usage {
	if usage.TotalTokens <= 0 {
		usage.TotalTokens = usage.InputTokens + usage.OutputTokens + usage.ReasoningTokens + usage.CacheReadTokens + usage.CacheWriteTokens
	}
	if usage.Source == "" && usage.TotalTokens > 0 {
		usage.Source = "model_gateway"
	}
	if usage.TotalTokens > 0 || usage.InputTokens > 0 || usage.OutputTokens > 0 || usage.ReasoningTokens > 0 {
		usage.Available = true
	}
	return usage
}
