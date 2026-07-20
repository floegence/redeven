package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	"github.com/floegence/redeven/internal/config"
)

type floretProviderAdapter struct {
	base ModelGateway

	providerType string
	modelName    string
	webSearch    string

	controls                  ProviderControls
	budgets                   TurnBudgets
	disabledCoreControlTools  map[string]struct{}
	continuationSupported     bool
	attachmentResolver        func(context.Context, flruntime.MessageAttachment) (ContentPart, error)
	requestAttachmentResolver func(context.Context, flruntime.ModelRequest, flruntime.MessageAttachment) (ContentPart, error)
	supportsImageInput        bool
	supportsFileInput         bool
	beforeRequest             func() error
}

type floretProviderAdapterOption func(*floretProviderAdapter)

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

func withDisabledFloretCoreControlTools(names ...string) floretProviderAdapterOption {
	return func(adapter *floretProviderAdapter) {
		if adapter == nil {
			return
		}
		if adapter.disabledCoreControlTools == nil {
			adapter.disabledCoreControlTools = map[string]struct{}{}
		}
		for _, name := range names {
			name = strings.TrimSpace(name)
			if name != "" {
				adapter.disabledCoreControlTools[name] = struct{}{}
			}
		}
	}
}

func withFloretAttachmentResolver(resolver func(context.Context, flruntime.MessageAttachment) (ContentPart, error), supportsImageInput bool, supportsFileInput bool) floretProviderAdapterOption {
	return func(adapter *floretProviderAdapter) {
		if adapter == nil {
			return
		}
		adapter.attachmentResolver = resolver
		adapter.supportsImageInput = supportsImageInput
		adapter.supportsFileInput = supportsFileInput
	}
}

func withFloretRequestAttachmentResolver(resolver func(context.Context, flruntime.ModelRequest, flruntime.MessageAttachment) (ContentPart, error), supportsImageInput bool, supportsFileInput bool) floretProviderAdapterOption {
	return func(adapter *floretProviderAdapter) {
		if adapter == nil {
			return
		}
		adapter.requestAttachmentResolver = resolver
		adapter.supportsImageInput = supportsImageInput
		adapter.supportsFileInput = supportsFileInput
	}
}

func withFloretBeforeRequest(check func() error) floretProviderAdapterOption {
	return func(adapter *floretProviderAdapter) {
		if adapter != nil {
			adapter.beforeRequest = check
		}
	}
}

func (p *floretProviderAdapter) StreamModel(ctx context.Context, req flruntime.ModelRequest) (<-chan flruntime.ModelEvent, error) {
	if p == nil || p.base == nil {
		return nil, errors.New("nil floret provider adapter")
	}
	out := make(chan flruntime.ModelEvent, 32)
	go func() {
		defer close(out)

		turnReq, err := p.turnRequest(ctx, req)
		if err != nil {
			sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventError, Err: err, Reason: err.Error()})
			return
		}
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
				sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventDelta, Text: ev.Text})
			case StreamEventThinkingDelta:
				if ev.Text == "" {
					return
				}
				streamedReasoning.WriteString(ev.Text)
				sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventReasoning, Text: ev.Text})
			case StreamEventToolCallStart:
				if stream := floretToolCallStreamFromFlower(ev.ToolCall); stream != nil {
					sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventToolCallStart, ToolCallStream: stream})
				}
			case StreamEventToolCallDelta:
				if stream := floretToolCallStreamFromFlower(ev.ToolCall); stream != nil {
					sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventToolCallDelta, ToolCallStream: stream})
				}
			case StreamEventToolCallEnd:
				if stream := floretToolCallStreamFromFlower(ev.ToolCall); stream != nil {
					sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventToolCallEnd, ToolCallStream: stream})
				}
			}
		}
		result, err := p.base.StreamTurn(ctx, turnReq, onEvent)
		if err != nil {
			sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventError, Err: err, Reason: err.Error()})
			return
		}
		if strings.TrimSpace(streamedText.String()) == "" && strings.TrimSpace(result.Text) != "" {
			sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventDelta, Text: result.Text})
		}
		if strings.TrimSpace(streamedReasoning.String()) == "" && strings.TrimSpace(result.Reasoning) != "" {
			sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventReasoning, Text: result.Reasoning})
		}
		if len(result.Sources) > 0 {
			sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventSources, Sources: flowerSourcesToFloret(result.Sources)})
		}
		if len(result.ToolCalls) > 0 {
			if toolName := p.firstDisabledCoreControlToolCall(result.ToolCalls); toolName != "" {
				err := fmt.Errorf("Floret core control tool %q is disabled for this run", toolName)
				sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventError, Err: err, Reason: err.Error()})
				return
			}
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
		responseState, err := flowerProviderStateToFloret(result.ProviderState)
		if err != nil {
			sendFloretProviderEvent(ctx, out, flruntime.ModelEvent{Type: flruntime.ModelEventError, Err: err, Reason: err.Error()})
			return
		}
		terminal := flruntime.ModelEvent{
			Type:          flruntime.ModelEventDone,
			Reason:        normalizeReplyFinishReason(result.FinishReason),
			ResponseState: responseState,
		}
		if terminal.Reason == "length" {
			terminal.Type = flruntime.ModelEventTruncated
		}
		sendFloretProviderEvent(ctx, out, terminal)
	}()
	return out, nil
}

func floretToolCallStreamFromFlower(call *PartialToolCall) *flruntime.ModelToolCallStream {
	if call == nil {
		return nil
	}
	id := strings.TrimSpace(call.ID)
	name := strings.TrimSpace(call.Name)
	if id == "" || name == "" {
		return nil
	}
	return &flruntime.ModelToolCallStream{
		ID:   id,
		Name: name,
	}
}

func flowerSourcesToFloret(in []SourceRef) []flruntime.SourceRef {
	out := make([]flruntime.SourceRef, 0, len(in))
	for _, src := range in {
		if strings.TrimSpace(src.Title) == "" && strings.TrimSpace(src.URL) == "" {
			continue
		}
		out = append(out, flruntime.SourceRef{
			Title: strings.TrimSpace(src.Title),
			URL:   strings.TrimSpace(src.URL),
		})
	}
	return out
}

func (p *floretProviderAdapter) turnRequest(ctx context.Context, req flruntime.ModelRequest) (ModelGatewayRequest, error) {
	if p.beforeRequest != nil {
		if err := p.beforeRequest(); err != nil {
			return ModelGatewayRequest{}, err
		}
	}
	controls := p.controls
	previous := cloneFloretModelState(req.PreviousState)
	previousResponseID, err := p.previousResponseID(previous)
	if err != nil {
		return ModelGatewayRequest{}, err
	}
	controls.PreviousResponseID = previousResponseID
	if reasoning := config.NormalizeAIReasoningSelection(req.Reasoning); !reasoning.IsZero() {
		controls.ReasoningSelection = reasoning
	}

	resolver := p.attachmentResolver
	if p.requestAttachmentResolver != nil {
		resolver = func(ctx context.Context, attachment flruntime.MessageAttachment) (ContentPart, error) {
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

func (p *floretProviderAdapter) previousResponseID(state *flruntime.ModelState) (string, error) {
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

func sendFloretProviderEvent(ctx context.Context, out chan<- flruntime.ModelEvent, ev flruntime.ModelEvent) {
	select {
	case <-ctx.Done():
	case out <- ev:
	}
}

func (p *floretProviderAdapter) floretMessagesToFlower(ctx context.Context, messages []flruntime.ModelMessage) ([]Message, error) {
	return p.floretMessagesToFlowerWithResolver(ctx, messages, p.attachmentResolver)
}

func (p *floretProviderAdapter) floretMessagesToFlowerWithResolver(ctx context.Context, messages []flruntime.ModelMessage, resolver func(context.Context, flruntime.MessageAttachment) (ContentPart, error)) ([]Message, error) {
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
			if err := p.validateResolvedAttachment(part); err != nil {
				return nil, err
			}
			parts = append(parts, part)
		}
		if msg.Reasoning != "" {
			parts = append(parts, ContentPart{Type: "reasoning", Text: msg.Reasoning})
		}
		for _, call := range msg.ToolCalls {
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

func floretToolCallsFromFlower(calls []ToolCall) ([]fltools.ToolCall, error) {
	out := make([]fltools.ToolCall, 0, len(calls))
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
		out = append(out, fltools.ToolCall{ID: id, Name: name, Args: string(b)})
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

func flowerProviderStateToFloret(state *ModelGatewayState) (*flruntime.ModelState, error) {
	if state == nil {
		return nil, nil
	}
	kind := strings.TrimSpace(state.Kind)
	id := strings.TrimSpace(state.ID)
	if kind == "" || id == "" {
		return nil, errors.New("Flower provider state requires kind and id")
	}
	return &flruntime.ModelState{Kind: kind, ID: id, Attributes: cloneStringMap(state.Attributes)}, nil
}

func floretProviderStateToFlower(state *flruntime.ModelState) *ModelGatewayState {
	if state == nil {
		return nil
	}
	kind := strings.TrimSpace(state.Kind)
	id := strings.TrimSpace(state.ID)
	if kind == "" || id == "" {
		return nil
	}
	return &ModelGatewayState{Kind: kind, ID: id, Attributes: cloneStringMap(state.Attributes)}
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

func normalizeFloretUsage(usage flruntime.ProviderUsage) flruntime.ProviderUsage {
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
