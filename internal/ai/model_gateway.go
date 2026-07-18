package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	aoption "github.com/anthropics/anthropic-sdk-go/option"
	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/config"
	openai "github.com/openai/openai-go"
	ooption "github.com/openai/openai-go/option"
	"github.com/openai/openai-go/packages/param"
	oresponses "github.com/openai/openai-go/responses"
	oshared "github.com/openai/openai-go/shared"
)

const (
	modelGatewayDefaultMaxOutputTokens      = 4096
	modelGatewayDefaultContextWindowTokens  = 128000
	providerContinuationKindOpenAIResponses = "openai_responses"
	modelGatewayHardMaxToolCalls            = 200
)

const (
	providerWebSearchModeDisabled               = "disabled"
	providerWebSearchModeOpenAIResponsesBuiltin = "openai_responses_builtin"
	providerWebSearchModeKimiBuiltin            = "kimi_builtin"
	providerWebSearchModeGLMWebSearchTool       = "glm_web_search_tool"
	providerWebSearchModeDeepSeekNative         = "deepseek_native"
	providerWebSearchModeQwenResponsesWebSearch = "qwen_responses_web_search"
	providerWebSearchModeExternalBrave          = "external_brave"
)

func mergeAnyFields(base map[string]any, next map[string]any) map[string]any {
	if len(next) == 0 {
		return base
	}
	out := make(map[string]any, len(base)+len(next))
	for key, value := range base {
		out[key] = value
	}
	for key, value := range next {
		out[key] = value
	}
	return out
}

func reasoningEffortWireValue(level config.AIReasoningLevel) string {
	level = config.NormalizeAIReasoningSelection(config.AIReasoningSelection{Level: level}).Level
	if level == config.AIReasoningLevelOff {
		return "none"
	}
	return string(level)
}

func providerReasoningSelection(controls ProviderControls) (config.AIReasoningSelection, config.AIReasoningCapability, error) {
	selection := config.NormalizeAIReasoningSelection(controls.ReasoningSelection)
	capability := controls.ReasoningCapability.Normalize()
	if selection.IsZero() || selection.Level == config.AIReasoningLevelDefault && selection.BudgetTokens == 0 {
		return config.AIReasoningSelection{}, capability, nil
	}
	if err := config.ValidateAIReasoningSelection(capability, selection); err != nil {
		return config.AIReasoningSelection{}, capability, err
	}
	return selection, capability, nil
}

type providerWebSearchCapability struct {
	Mode         string
	Reason       string
	RegisterTool bool
}

func resolveProviderWebSearchCapability(provider config.AIProvider, modelName string) providerWebSearchCapability {
	providerType := strings.ToLower(strings.TrimSpace(provider.Type))
	modelName = strings.TrimSpace(modelName)
	capability := providerWebSearchCapability{
		Mode:   providerWebSearchModeDisabled,
		Reason: "unsupported_provider",
	}
	switch providerType {
	case "openai":
		if shouldUseStrictOpenAIToolSchema(providerType, provider.BaseURL) {
			capability.Mode = providerWebSearchModeOpenAIResponsesBuiltin
			capability.Reason = "official_openai"
			return capability
		}
		capability.Reason = "openai_not_official_endpoint"
		return capability
	case "moonshot":
		if modelName == "kimi-k2.6" {
			capability.Mode = providerWebSearchModeKimiBuiltin
			capability.Reason = "curated_moonshot_model"
			return capability
		}
		capability.Reason = "unsupported_moonshot_model"
		return capability
	case "chatglm":
		if modelName == "glm-5.1" {
			capability.Mode = providerWebSearchModeGLMWebSearchTool
			capability.Reason = "curated_glm_model"
			return capability
		}
		capability.Reason = "unsupported_glm_model"
		return capability
	case "deepseek":
		switch modelName {
		case "deepseek-v4-pro", "deepseek-v4-flash":
			capability.Mode = providerWebSearchModeDeepSeekNative
			capability.Reason = "curated_deepseek_model"
			return capability
		default:
			capability.Reason = "unsupported_deepseek_model"
			return capability
		}
	case "qwen":
		switch modelName {
		case "qwen3.6-plus", "qwen3.6-plus-2026-04-02", "qwen3.6-flash", "qwen3.6-flash-2026-04-16":
			capability.Mode = providerWebSearchModeQwenResponsesWebSearch
			capability.Reason = "curated_qwen_model"
			return capability
		default:
			capability.Reason = "unsupported_qwen_model"
			return capability
		}
	case "openai_compatible":
		mode := ""
		if provider.WebSearch != nil {
			mode = strings.ToLower(strings.TrimSpace(provider.WebSearch.Mode))
		}
		switch mode {
		case config.AIProviderWebSearchModeOpenAIBuiltin:
			capability.Mode = providerWebSearchModeOpenAIResponsesBuiltin
			capability.Reason = "openai_compatible_configured_builtin"
			return capability
		case config.AIProviderWebSearchModeBrave:
			capability.Mode = providerWebSearchModeExternalBrave
			capability.Reason = "openai_compatible_configured_brave"
			capability.RegisterTool = true
			return capability
		default:
			capability.Reason = "openai_compatible_disabled"
			return capability
		}
	default:
		return capability
	}
}

type openAIProvider struct {
	client           openai.Client
	strictToolSchema bool
	forceChat        bool
	parallelTools    parallelToolCallsWireMode
}

type parallelToolCallsWireMode string

const (
	parallelToolCallsWireOmit   parallelToolCallsWireMode = "omit"
	parallelToolCallsWireEnable parallelToolCallsWireMode = "enable"
)

func applyResponsesParallelToolCalls(params *oresponses.ResponseNewParams, mode parallelToolCallsWireMode) {
	if params != nil && mode == parallelToolCallsWireEnable {
		params.ParallelToolCalls = openai.Bool(true)
	}
}

func applyChatParallelToolCalls(params *openai.ChatCompletionNewParams, mode parallelToolCallsWireMode) {
	if params != nil && mode == parallelToolCallsWireEnable {
		params.ParallelToolCalls = openai.Bool(true)
	}
}

func (p *openAIProvider) StreamTurn(ctx context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	if p == nil {
		return ModelGatewayResult{}, errors.New("nil provider")
	}
	if strings.TrimSpace(req.Model) == "" {
		return ModelGatewayResult{}, errors.New("missing model")
	}
	useChat := p.forceChat && !requiresOpenAIResponsesRoute(req)
	route := "openai-responses"
	if useChat {
		route = "openai-chat"
	}
	if err := validateGatewayAttachmentParts(req.Messages, route); err != nil {
		return ModelGatewayResult{}, err
	}
	if useChat {
		return p.streamChatTurn(ctx, req, onEvent)
	}

	params := oresponses.ResponseNewParams{
		Model:           oshared.ResponsesModel(strings.TrimSpace(req.Model)),
		MaxOutputTokens: openai.Int(modelGatewayDefaultMaxOutputTokens),
	}
	applyResponsesParallelToolCalls(&params, p.parallelTools)
	if req.Budgets.MaxOutputToken > 0 {
		params.MaxOutputTokens = openai.Int(int64(req.Budgets.MaxOutputToken))
	}
	if req.ProviderControls.Temperature != nil {
		params.Temperature = openai.Float(*req.ProviderControls.Temperature)
	}
	if req.ProviderControls.TopP != nil {
		params.TopP = openai.Float(*req.ProviderControls.TopP)
	}
	if previousResponseID := strings.TrimSpace(req.ProviderControls.PreviousResponseID); previousResponseID != "" {
		params.PreviousResponseID = openai.String(previousResponseID)
	}
	switch strings.ToLower(strings.TrimSpace(req.ProviderControls.ResponseFormat)) {
	case "":
		// default: text
	case "text":
		txt := oshared.NewResponseFormatTextParam()
		params.Text = oresponses.ResponseTextConfigParam{
			Format: oresponses.ResponseFormatTextConfigUnionParam{OfText: &txt},
		}
	case "json_object":
		obj := oshared.NewResponseFormatJSONObjectParam()
		params.Text = oresponses.ResponseTextConfigParam{
			Format: oresponses.ResponseFormatTextConfigUnionParam{OfJSONObject: &obj},
		}
	default:
		// json_schema requires an explicit schema. Avoid implicit downgrade here and let upper layers drive structured output.
	}

	inputItems, instructions := buildOpenAIInput(req.Messages)
	if len(inputItems) == 0 {
		inputItems = append(inputItems, oresponses.ResponseInputItemParamOfMessage("Continue.", oresponses.EasyInputMessageRoleUser))
	}
	params.Input = oresponses.ResponseNewParamsInputUnion{OfInputItemList: inputItems}
	if strings.TrimSpace(instructions) != "" {
		params.Instructions = openai.String(strings.TrimSpace(instructions))
	}
	tools, aliasToReal := buildOpenAITools(req.Tools, p.strictToolSchema)
	if err := applyResponsesReasoning(&params, req.ProviderControls); err != nil {
		return ModelGatewayResult{}, err
	}
	decorateResponsesParams(&params, req.WebSearchMode, &tools)
	if len(tools) > 0 {
		params.Tools = tools
	}

	stream := p.client.Responses.NewStreaming(ctx, params)
	var textBuf strings.Builder
	var completed oresponses.Response
	gotCompleted := false

	type partialCall struct {
		ItemID      string
		CallID      string
		Name        string
		OutputIndex int64

		Started bool
		Ended   bool
		ArgsRaw strings.Builder
		Args    map[string]any
	}
	partials := map[string]*partialCall{} // item_id -> partial

	emitStart := func(pc *partialCall) {
		if pc == nil || pc.Started {
			return
		}
		pc.Started = true
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallStart, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.CallID), Name: canonicalProviderToolName(pc.Name, aliasToReal)}})
	}
	emitDelta := func(pc *partialCall) {
		if pc == nil {
			return
		}
		if strings.TrimSpace(pc.Name) == "" || strings.TrimSpace(pc.CallID) == "" {
			return
		}
		emitStart(pc)
		raw := strings.TrimSpace(pc.ArgsRaw.String())
		var args map[string]any
		if raw != "" {
			_ = json.Unmarshal([]byte(raw), &args) // Streaming deltas may be incomplete; ignore parse failures.
		}
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallDelta, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.CallID), Name: canonicalProviderToolName(pc.Name, aliasToReal), ArgumentsJSON: raw, Arguments: cloneAnyMap(args)}})
	}
	emitEnd := func(pc *partialCall, rawArgs string) {
		if pc == nil || pc.Ended {
			return
		}
		pc.Ended = true
		rawArgs = strings.TrimSpace(rawArgs)
		args := map[string]any{}
		if rawArgs != "" {
			_ = json.Unmarshal([]byte(rawArgs), &args)
		}
		pc.Args = args
		emitStart(pc)
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallEnd, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.CallID), Name: canonicalProviderToolName(pc.Name, aliasToReal), Arguments: cloneAnyMap(args)}})
	}

	getPartial := func(itemID string) *partialCall {
		itemID = strings.TrimSpace(itemID)
		if itemID == "" {
			return nil
		}
		if pc := partials[itemID]; pc != nil {
			return pc
		}
		pc := &partialCall{ItemID: itemID, CallID: itemID, OutputIndex: -1}
		partials[itemID] = pc
		return pc
	}

	for stream.Next() {
		event := stream.Current()
		switch strings.TrimSpace(event.Type) {
		case "response.output_text.delta":
			delta := event.Delta.OfString
			if delta == "" {
				continue
			}
			textBuf.WriteString(delta)
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventTextDelta, Text: delta})

		case "response.output_item.added":
			item := event.Item
			if strings.TrimSpace(item.Type) != "function_call" {
				continue
			}
			pc := getPartial(item.ID)
			if pc == nil {
				continue
			}
			if pc.OutputIndex < 0 {
				pc.OutputIndex = event.OutputIndex
			}
			if cid := strings.TrimSpace(item.CallID); cid != "" {
				pc.CallID = cid
			}
			name := canonicalProviderToolName(item.Name, aliasToReal)
			if name != "" {
				pc.Name = name
			}
			emitStart(pc)
			if raw := strings.TrimSpace(item.Arguments); raw != "" {
				pc.ArgsRaw.WriteString(raw)
				emitDelta(pc)
			}

		case "response.function_call_arguments.delta":
			pc := getPartial(event.ItemID)
			if pc == nil {
				continue
			}
			delta := event.Delta.OfString
			if delta == "" {
				continue
			}
			pc.ArgsRaw.WriteString(delta)
			emitDelta(pc)

		case "response.function_call_arguments.done":
			pc := getPartial(event.ItemID)
			if pc == nil {
				continue
			}
			raw := strings.TrimSpace(event.Arguments)
			if raw != "" {
				pc.ArgsRaw.Reset()
				pc.ArgsRaw.WriteString(raw)
			}
			emitEnd(pc, pc.ArgsRaw.String())

		case "response.output_item.done":
			item := event.Item
			if strings.TrimSpace(item.Type) != "function_call" {
				continue
			}
			pc := getPartial(item.ID)
			if pc == nil {
				continue
			}
			if cid := strings.TrimSpace(item.CallID); cid != "" {
				pc.CallID = cid
			}
			name := canonicalProviderToolName(item.Name, aliasToReal)
			if name != "" {
				pc.Name = name
			}
			if raw := strings.TrimSpace(item.Arguments); raw != "" && strings.TrimSpace(pc.ArgsRaw.String()) == "" {
				pc.ArgsRaw.WriteString(raw)
			}
			emitEnd(pc, pc.ArgsRaw.String())

		case "response.completed":
			completed = event.Response
			gotCompleted = true
		}
	}
	if err := stream.Err(); err != nil {
		return ModelGatewayResult{}, err
	}
	// Some OpenAI-compatible endpoints omit `response.completed` even when they have already
	// streamed usable text or tool call deltas. Treat missing completion as a soft-failure
	// and continue best-effort when we have enough information to proceed.
	hasToolCall := false
	for _, pc := range partials {
		if pc == nil || !pc.Ended {
			continue
		}
		if strings.TrimSpace(pc.CallID) == "" || strings.TrimSpace(pc.Name) == "" {
			continue
		}
		hasToolCall = true
		break
	}
	if !gotCompleted && strings.TrimSpace(textBuf.String()) == "" && !hasToolCall {
		return ModelGatewayResult{}, errors.New("missing response.completed event")
	}

	result := ModelGatewayResult{
		FinishReason:    "unknown",
		Text:            strings.TrimSpace(textBuf.String()),
		RawProviderDiag: map[string]any{},
	}
	if gotCompleted {
		result.FinishReason = mapOpenAIStatus(completed.Status)
		result.Sources = extractOpenAIURLSources(completed)
		result.Usage = TurnUsage{
			InputTokens:     completed.Usage.InputTokens,
			OutputTokens:    completed.Usage.OutputTokens,
			ReasoningTokens: completed.Usage.OutputTokensDetails.ReasoningTokens,
		}
		if rid := strings.TrimSpace(completed.ID); rid != "" {
			result.RawProviderDiag["response_id"] = rid
			result.ProviderState = &ModelGatewayState{
				Kind: providerContinuationKindOpenAIResponses,
				ID:   rid,
			}
		}
	} else {
		result.RawProviderDiag["missing_response_completed"] = true
	}

	type orderedToolCall struct {
		OutputIndex int64
		Call        ToolCall
	}
	seen := map[string]struct{}{}

	ordered := make([]orderedToolCall, 0, len(partials))
	for _, pc := range partials {
		if pc == nil || !pc.Ended {
			continue
		}
		id := strings.TrimSpace(pc.CallID)
		if id == "" {
			continue
		}
		seen[id] = struct{}{}
		ordered = append(ordered, orderedToolCall{
			OutputIndex: pc.OutputIndex,
			Call:        ToolCall{ID: id, Name: canonicalProviderToolName(pc.Name, aliasToReal), Args: cloneAnyMap(pc.Args)},
		})
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		ai := ordered[i].OutputIndex
		aj := ordered[j].OutputIndex
		if ai < 0 && aj >= 0 {
			return false
		}
		if aj < 0 && ai >= 0 {
			return true
		}
		if ai == aj {
			return ordered[i].Call.ID < ordered[j].Call.ID
		}
		return ai < aj
	})
	for _, it := range ordered {
		result.ToolCalls = append(result.ToolCalls, it.Call)
	}

	// Fallback: if stream events miss tool calls, recover them from completed.output.
	if gotCompleted {
		for _, item := range completed.Output {
			if strings.TrimSpace(item.Type) != "function_call" {
				continue
			}
			callID := strings.TrimSpace(item.CallID)
			if callID == "" {
				callID = strings.TrimSpace(item.ID)
			}
			if callID == "" {
				callID = fmt.Sprintf("openai_call_%d", len(result.ToolCalls)+1)
			}
			if _, ok := seen[callID]; ok {
				continue
			}
			toolName := canonicalProviderToolName(item.Name, aliasToReal)
			rawArgs := strings.TrimSpace(item.Arguments)
			args := map[string]any{}
			if rawArgs != "" {
				_ = json.Unmarshal([]byte(rawArgs), &args)
			}
			call := ToolCall{ID: callID, Name: toolName, Args: args}
			result.ToolCalls = append(result.ToolCalls, call)
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallStart, ToolCall: &PartialToolCall{ID: call.ID, Name: call.Name}})
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallDelta, ToolCall: &PartialToolCall{ID: call.ID, Name: call.Name, ArgumentsJSON: rawArgs, Arguments: cloneAnyMap(call.Args)}})
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallEnd, ToolCall: &PartialToolCall{ID: call.ID, Name: call.Name, Arguments: cloneAnyMap(call.Args)}})
		}
	}
	if len(result.ToolCalls) > 0 {
		result.FinishReason = "tool_calls"
	}
	if result.Text == "" {
		if gotCompleted {
			result.Text = strings.TrimSpace(extractOpenAIResponseText(completed))
		}
	}
	if result.FinishReason == "unknown" && result.Text != "" {
		result.FinishReason = "stop"
	}
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventUsage, Usage: &PartialUsage{InputTokens: result.Usage.InputTokens, OutputTokens: result.Usage.OutputTokens, ReasoningTokens: result.Usage.ReasoningTokens}})
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventFinishReason, FinishHint: result.FinishReason})
	return result, nil
}

func requiresOpenAIResponsesRoute(req ModelGatewayRequest) bool {
	switch strings.TrimSpace(req.WebSearchMode) {
	case providerWebSearchModeOpenAIResponsesBuiltin, providerWebSearchModeQwenResponsesWebSearch:
		return true
	}
	for _, tool := range req.Tools {
		if strings.TrimSpace(tool.Name) == "web.search" {
			return true
		}
	}
	return false
}

func (p *openAIProvider) streamChatTurn(ctx context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	if p == nil {
		return ModelGatewayResult{}, errors.New("nil provider")
	}
	if strings.TrimSpace(req.Model) == "" {
		return ModelGatewayResult{}, errors.New("missing model")
	}

	messages := buildOpenAIChatMessages(req.Messages)
	if len(messages) == 0 {
		messages = append(messages, openai.UserMessage("Continue."))
	}

	params := openai.ChatCompletionNewParams{
		Model:         oshared.ChatModel(strings.TrimSpace(req.Model)),
		Messages:      messages,
		StreamOptions: openai.ChatCompletionStreamOptionsParam{IncludeUsage: openai.Bool(true)},
	}
	applyChatParallelToolCalls(&params, p.parallelTools)
	if req.Budgets.MaxOutputToken > 0 {
		params.MaxTokens = openai.Int(int64(req.Budgets.MaxOutputToken))
	}
	if req.ProviderControls.Temperature != nil {
		params.Temperature = openai.Float(*req.ProviderControls.Temperature)
	}
	if req.ProviderControls.TopP != nil {
		params.TopP = openai.Float(*req.ProviderControls.TopP)
	}
	switch strings.ToLower(strings.TrimSpace(req.ProviderControls.ResponseFormat)) {
	case "":
	case "text":
		txt := oshared.NewResponseFormatTextParam()
		params.ResponseFormat = openai.ChatCompletionNewParamsResponseFormatUnion{OfText: &txt}
	case "json_object":
		obj := oshared.NewResponseFormatJSONObjectParam()
		params.ResponseFormat = openai.ChatCompletionNewParamsResponseFormatUnion{OfJSONObject: &obj}
	}

	tools, aliasToReal := buildOpenAIChatTools(req.Tools, p.strictToolSchema)
	if err := applyChatReasoning(&params, req.ProviderControls); err != nil {
		return ModelGatewayResult{}, err
	}
	decorateChatCompletionParams(&params, req.WebSearchMode, &tools)
	if len(tools) > 0 {
		params.Tools = tools
	}

	stream := p.client.Chat.Completions.NewStreaming(ctx, params)
	var textBuf strings.Builder
	result := ModelGatewayResult{
		FinishReason:    "unknown",
		RawProviderDiag: map[string]any{},
	}
	type partialCall struct {
		Index   int64
		CallID  string
		Name    string
		Started bool
		Ended   bool
		ArgsRaw strings.Builder
		Args    map[string]any
	}
	partials := map[int64]*partialCall{}
	order := make([]int64, 0, 2)
	getPartial := func(index int64) *partialCall {
		if pc := partials[index]; pc != nil {
			return pc
		}
		pc := &partialCall{Index: index}
		partials[index] = pc
		order = append(order, index)
		return pc
	}
	ensureCallID := func(pc *partialCall) string {
		if pc == nil {
			return ""
		}
		if strings.TrimSpace(pc.CallID) == "" {
			pc.CallID = fmt.Sprintf("chat_call_%d", pc.Index+1)
		}
		return strings.TrimSpace(pc.CallID)
	}
	emitStart := func(pc *partialCall) {
		if pc == nil || pc.Started {
			return
		}
		callID := ensureCallID(pc)
		name := canonicalProviderToolName(pc.Name, aliasToReal)
		if callID == "" || name == "" {
			return
		}
		pc.Started = true
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallStart, ToolCall: &PartialToolCall{ID: callID, Name: name}})
	}
	emitDelta := func(pc *partialCall) {
		if pc == nil {
			return
		}
		callID := ensureCallID(pc)
		name := canonicalProviderToolName(pc.Name, aliasToReal)
		if callID == "" || name == "" {
			return
		}
		raw := strings.TrimSpace(pc.ArgsRaw.String())
		args := map[string]any{}
		if raw != "" {
			_ = json.Unmarshal([]byte(raw), &args)
		}
		emitStart(pc)
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallDelta, ToolCall: &PartialToolCall{ID: callID, Name: name, ArgumentsJSON: raw, Arguments: cloneAnyMap(args)}})
	}
	emitEnd := func(pc *partialCall) {
		if pc == nil || pc.Ended {
			return
		}
		callID := ensureCallID(pc)
		name := canonicalProviderToolName(pc.Name, aliasToReal)
		if callID == "" || name == "" {
			return
		}
		raw := strings.TrimSpace(pc.ArgsRaw.String())
		args := map[string]any{}
		if raw != "" {
			_ = json.Unmarshal([]byte(raw), &args)
		}
		pc.Args = args
		pc.Ended = true
		emitStart(pc)
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallEnd, ToolCall: &PartialToolCall{ID: callID, Name: name, Arguments: cloneAnyMap(args)}})
	}

	for stream.Next() {
		chunk := stream.Current()
		if rid := strings.TrimSpace(chunk.ID); rid != "" {
			result.RawProviderDiag["response_id"] = rid
		}
		if chunk.Usage.PromptTokens > 0 || chunk.Usage.CompletionTokens > 0 || chunk.Usage.CompletionTokensDetails.ReasoningTokens > 0 {
			result.Usage = TurnUsage{
				InputTokens:     chunk.Usage.PromptTokens,
				OutputTokens:    chunk.Usage.CompletionTokens,
				ReasoningTokens: chunk.Usage.CompletionTokensDetails.ReasoningTokens,
			}
		}
		for _, choice := range chunk.Choices {
			if finish := mapOpenAIChatFinishReason(choice.FinishReason); finish != "unknown" {
				result.FinishReason = finish
			}
			delta := choice.Delta
			if delta.Content != "" {
				textBuf.WriteString(delta.Content)
				emitProviderEvent(onEvent, StreamEvent{Type: StreamEventTextDelta, Text: delta.Content})
			}
			for _, tc := range delta.ToolCalls {
				pc := getPartial(tc.Index)
				if id := strings.TrimSpace(tc.ID); id != "" {
					pc.CallID = id
				}
				name := canonicalProviderToolName(tc.Function.Name, aliasToReal)
				if name != "" {
					pc.Name = name
				}
				if argsDelta := tc.Function.Arguments; argsDelta != "" {
					pc.ArgsRaw.WriteString(argsDelta)
					emitDelta(pc)
					continue
				}
				emitStart(pc)
			}
		}
	}
	if err := stream.Err(); err != nil {
		return ModelGatewayResult{}, err
	}

	sort.SliceStable(order, func(i, j int) bool { return order[i] < order[j] })
	for _, idx := range order {
		pc := partials[idx]
		if pc == nil {
			continue
		}
		emitEnd(pc)
		if !pc.Ended {
			continue
		}
		result.ToolCalls = append(result.ToolCalls, ToolCall{ID: ensureCallID(pc), Name: canonicalProviderToolName(pc.Name, aliasToReal), Args: cloneAnyMap(pc.Args)})
	}
	result.Text = strings.TrimSpace(textBuf.String())
	if len(result.ToolCalls) > 0 {
		result.FinishReason = "tool_calls"
	}
	if result.FinishReason == "unknown" && result.Text != "" {
		result.FinishReason = "stop"
	}
	if result.Text == "" && len(result.ToolCalls) == 0 {
		return ModelGatewayResult{}, errors.New("missing streamed response")
	}
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventUsage, Usage: &PartialUsage{
		InputTokens:     result.Usage.InputTokens,
		OutputTokens:    result.Usage.OutputTokens,
		ReasoningTokens: result.Usage.ReasoningTokens,
	}})
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventFinishReason, FinishHint: result.FinishReason})
	return result, nil
}

type moonshotProvider struct {
	client           openai.Client
	strictToolSchema bool
}

func (p *moonshotProvider) StreamTurn(ctx context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	if p == nil {
		return ModelGatewayResult{}, errors.New("nil provider")
	}
	if strings.TrimSpace(req.Model) == "" {
		return ModelGatewayResult{}, errors.New("missing model")
	}

	messages := buildOpenAIChatMessages(req.Messages)
	if len(messages) == 0 {
		messages = append(messages, openai.UserMessage("Continue."))
	}

	params := openai.ChatCompletionNewParams{
		Model:         oshared.ChatModel(strings.TrimSpace(req.Model)),
		Messages:      messages,
		StreamOptions: openai.ChatCompletionStreamOptionsParam{IncludeUsage: openai.Bool(true)},
	}
	if req.Budgets.MaxOutputToken > 0 {
		params.MaxTokens = openai.Int(int64(req.Budgets.MaxOutputToken))
	}
	if req.ProviderControls.Temperature != nil {
		params.Temperature = openai.Float(*req.ProviderControls.Temperature)
	}
	if req.ProviderControls.TopP != nil {
		params.TopP = openai.Float(*req.ProviderControls.TopP)
	}
	switch strings.ToLower(strings.TrimSpace(req.ProviderControls.ResponseFormat)) {
	case "":
		// default behavior
	case "text":
		txt := oshared.NewResponseFormatTextParam()
		params.ResponseFormat = openai.ChatCompletionNewParamsResponseFormatUnion{OfText: &txt}
	case "json_object":
		obj := oshared.NewResponseFormatJSONObjectParam()
		params.ResponseFormat = openai.ChatCompletionNewParamsResponseFormatUnion{OfJSONObject: &obj}
	default:
		// json_schema requires an explicit schema; leave unset and let upper layers decide.
	}

	tools, aliasToReal := buildOpenAIChatTools(req.Tools, p.strictToolSchema)
	if err := applyChatReasoning(&params, req.ProviderControls); err != nil {
		return ModelGatewayResult{}, err
	}
	decorateChatCompletionParams(&params, req.WebSearchMode, &tools)
	if len(tools) > 0 {
		params.Tools = tools
	}

	stream := p.client.Chat.Completions.NewStreaming(ctx, params)
	var textBuf strings.Builder
	var reasoningBuf strings.Builder
	result := ModelGatewayResult{
		FinishReason:    "unknown",
		RawProviderDiag: map[string]any{},
	}

	type partialCall struct {
		Index   int64
		CallID  string
		Name    string
		Started bool
		Ended   bool
		ArgsRaw strings.Builder
		Args    map[string]any
	}

	partials := map[int64]*partialCall{}
	order := make([]int64, 0, 2)
	getPartial := func(index int64) *partialCall {
		if pc := partials[index]; pc != nil {
			return pc
		}
		pc := &partialCall{Index: index}
		partials[index] = pc
		order = append(order, index)
		return pc
	}
	ensureCallID := func(pc *partialCall) string {
		if pc == nil {
			return ""
		}
		if strings.TrimSpace(pc.CallID) == "" {
			pc.CallID = fmt.Sprintf("moonshot_call_%d", pc.Index+1)
		}
		return strings.TrimSpace(pc.CallID)
	}
	emitStart := func(pc *partialCall) {
		if pc == nil || pc.Started {
			return
		}
		callID := ensureCallID(pc)
		name := canonicalProviderToolName(pc.Name, aliasToReal)
		if callID == "" || name == "" {
			return
		}
		pc.Started = true
		emitProviderEvent(onEvent, StreamEvent{
			Type: StreamEventToolCallStart,
			ToolCall: &PartialToolCall{
				ID:   callID,
				Name: name,
			},
		})
	}
	emitDelta := func(pc *partialCall) {
		if pc == nil {
			return
		}
		callID := ensureCallID(pc)
		name := canonicalProviderToolName(pc.Name, aliasToReal)
		if callID == "" || name == "" {
			return
		}
		raw := strings.TrimSpace(pc.ArgsRaw.String())
		args := map[string]any{}
		if raw != "" {
			_ = json.Unmarshal([]byte(raw), &args)
		}
		emitStart(pc)
		emitProviderEvent(onEvent, StreamEvent{
			Type: StreamEventToolCallDelta,
			ToolCall: &PartialToolCall{
				ID:            callID,
				Name:          name,
				ArgumentsJSON: raw,
				Arguments:     cloneAnyMap(args),
			},
		})
	}
	emitEnd := func(pc *partialCall) {
		if pc == nil || pc.Ended {
			return
		}
		callID := ensureCallID(pc)
		name := canonicalProviderToolName(pc.Name, aliasToReal)
		if callID == "" || name == "" {
			return
		}
		raw := strings.TrimSpace(pc.ArgsRaw.String())
		args := map[string]any{}
		if raw != "" {
			_ = json.Unmarshal([]byte(raw), &args)
		}
		pc.Args = args
		pc.Ended = true
		emitStart(pc)
		emitProviderEvent(onEvent, StreamEvent{
			Type: StreamEventToolCallEnd,
			ToolCall: &PartialToolCall{
				ID:        callID,
				Name:      name,
				Arguments: cloneAnyMap(args),
			},
		})
	}

	for stream.Next() {
		chunk := stream.Current()
		if rid := strings.TrimSpace(chunk.ID); rid != "" {
			result.RawProviderDiag["response_id"] = rid
		}
		if chunk.Usage.PromptTokens > 0 || chunk.Usage.CompletionTokens > 0 || chunk.Usage.CompletionTokensDetails.ReasoningTokens > 0 {
			result.Usage = TurnUsage{
				InputTokens:     chunk.Usage.PromptTokens,
				OutputTokens:    chunk.Usage.CompletionTokens,
				ReasoningTokens: chunk.Usage.CompletionTokensDetails.ReasoningTokens,
			}
		}
		for _, choice := range chunk.Choices {
			if finish := mapOpenAIChatFinishReason(choice.FinishReason); finish != "unknown" {
				result.FinishReason = finish
			}
			delta := choice.Delta
			if delta.Content != "" {
				textBuf.WriteString(delta.Content)
				emitProviderEvent(onEvent, StreamEvent{Type: StreamEventTextDelta, Text: delta.Content})
			}
			if reasoning := extractMoonshotChatReasoningDelta(delta); reasoning != "" {
				reasoningBuf.WriteString(reasoning)
				emitProviderEvent(onEvent, StreamEvent{Type: StreamEventThinkingDelta, Text: reasoning})
			}
			for _, tc := range delta.ToolCalls {
				pc := getPartial(tc.Index)
				if pc == nil {
					continue
				}
				if id := strings.TrimSpace(tc.ID); id != "" {
					pc.CallID = id
				}
				name := canonicalProviderToolName(tc.Function.Name, aliasToReal)
				if name != "" {
					pc.Name = name
				}
				if argsDelta := tc.Function.Arguments; argsDelta != "" {
					pc.ArgsRaw.WriteString(argsDelta)
					emitDelta(pc)
					continue
				}
				emitStart(pc)
			}
		}
	}
	if err := stream.Err(); err != nil {
		return ModelGatewayResult{}, err
	}

	sort.SliceStable(order, func(i, j int) bool { return order[i] < order[j] })
	for _, idx := range order {
		pc := partials[idx]
		if pc == nil {
			continue
		}
		emitEnd(pc)
		if !pc.Ended {
			continue
		}
		result.ToolCalls = append(result.ToolCalls, ToolCall{
			ID:   ensureCallID(pc),
			Name: canonicalProviderToolName(pc.Name, aliasToReal),
			Args: cloneAnyMap(pc.Args),
		})
	}

	result.Text = strings.TrimSpace(textBuf.String())
	result.Reasoning = strings.TrimSpace(reasoningBuf.String())
	if len(result.ToolCalls) > 0 {
		result.FinishReason = "tool_calls"
	}
	if result.FinishReason == "unknown" && result.Text != "" {
		result.FinishReason = "stop"
	}
	if result.Text == "" && result.Reasoning == "" && len(result.ToolCalls) == 0 {
		return ModelGatewayResult{}, errors.New("missing streamed response")
	}
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventUsage, Usage: &PartialUsage{
		InputTokens:     result.Usage.InputTokens,
		OutputTokens:    result.Usage.OutputTokens,
		ReasoningTokens: result.Usage.ReasoningTokens,
	}})
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventFinishReason, FinishHint: result.FinishReason})
	return result, nil
}

func (p *moonshotProvider) Turn(ctx context.Context, req ModelGatewayRequest) (ModelGatewayResult, error) {
	if p == nil {
		return ModelGatewayResult{}, errors.New("nil provider")
	}
	if strings.TrimSpace(req.Model) == "" {
		return ModelGatewayResult{}, errors.New("missing model")
	}

	messages := buildOpenAIChatMessages(req.Messages)
	if len(messages) == 0 {
		messages = append(messages, openai.UserMessage("Continue."))
	}

	params := openai.ChatCompletionNewParams{
		Model:    oshared.ChatModel(strings.TrimSpace(req.Model)),
		Messages: messages,
	}
	if req.Budgets.MaxOutputToken > 0 {
		params.MaxTokens = openai.Int(int64(req.Budgets.MaxOutputToken))
	}
	if req.ProviderControls.Temperature != nil {
		params.Temperature = openai.Float(*req.ProviderControls.Temperature)
	}
	if req.ProviderControls.TopP != nil {
		params.TopP = openai.Float(*req.ProviderControls.TopP)
	}
	switch strings.ToLower(strings.TrimSpace(req.ProviderControls.ResponseFormat)) {
	case "":
		// default behavior
	case "text":
		txt := oshared.NewResponseFormatTextParam()
		params.ResponseFormat = openai.ChatCompletionNewParamsResponseFormatUnion{OfText: &txt}
	case "json_object":
		obj := oshared.NewResponseFormatJSONObjectParam()
		params.ResponseFormat = openai.ChatCompletionNewParamsResponseFormatUnion{OfJSONObject: &obj}
	}
	tools, aliasToReal := buildOpenAIChatTools(req.Tools, p.strictToolSchema)
	if err := applyChatReasoning(&params, req.ProviderControls); err != nil {
		return ModelGatewayResult{}, err
	}
	decorateChatCompletionParams(&params, req.WebSearchMode, &tools)
	if len(tools) > 0 {
		params.Tools = tools
	}

	completion, err := p.client.Chat.Completions.New(ctx, params)
	if err != nil {
		return ModelGatewayResult{}, err
	}
	result := ModelGatewayResult{
		FinishReason:    "unknown",
		RawProviderDiag: map[string]any{"response_id": strings.TrimSpace(completion.ID)},
		Usage: TurnUsage{
			InputTokens:     completion.Usage.PromptTokens,
			OutputTokens:    completion.Usage.CompletionTokens,
			ReasoningTokens: completion.Usage.CompletionTokensDetails.ReasoningTokens,
		},
	}
	if len(completion.Choices) == 0 {
		return ModelGatewayResult{}, errors.New("missing completion choices")
	}
	choice := completion.Choices[0]
	result.FinishReason = mapOpenAIChatFinishReason(string(choice.FinishReason))
	result.Text = strings.TrimSpace(choice.Message.Content)
	result.Reasoning = strings.TrimSpace(extractMoonshotReasoningJSON(choice.Message.RawJSON()))
	for _, tc := range choice.Message.ToolCalls {
		name := canonicalProviderToolName(tc.Function.Name, aliasToReal)
		args := map[string]any{}
		rawArgs := strings.TrimSpace(tc.Function.Arguments)
		if rawArgs != "" {
			_ = json.Unmarshal([]byte(rawArgs), &args)
		}
		result.ToolCalls = append(result.ToolCalls, ToolCall{
			ID:   strings.TrimSpace(tc.ID),
			Name: name,
			Args: cloneAnyMap(args),
		})
	}
	if len(result.ToolCalls) > 0 {
		result.FinishReason = "tool_calls"
	}
	if result.FinishReason == "unknown" && (result.Text != "" || result.Reasoning != "") {
		result.FinishReason = "stop"
	}
	if result.Text == "" && result.Reasoning == "" && len(result.ToolCalls) == 0 {
		return ModelGatewayResult{}, errors.New("missing completion content")
	}
	return result, nil
}

func buildOpenAIChatTools(defs []ToolDef, strict bool) ([]openai.ChatCompletionToolParam, map[string]string) {
	out := make([]openai.ChatCompletionToolParam, 0, len(defs))
	aliasToReal := make(map[string]string, len(defs))
	for _, def := range defs {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		schema := map[string]any{}
		if len(def.InputSchema) > 0 {
			_ = json.Unmarshal(def.InputSchema, &schema)
		}
		alias := sanitizeProviderToolName(name)
		fn := oshared.FunctionDefinitionParam{
			Name:        alias,
			Description: openai.String(strings.TrimSpace(def.Description)),
			Strict:      openai.Bool(strict),
		}
		if len(schema) > 0 {
			fn.Parameters = oshared.FunctionParameters(schema)
		}
		out = append(out, openai.ChatCompletionToolParam{Function: fn})
		aliasToReal[alias] = name
	}
	return out, aliasToReal
}

func applyResponsesReasoning(params *oresponses.ResponseNewParams, controls ProviderControls) error {
	if params == nil {
		return nil
	}
	selection, capability, err := providerReasoningSelection(controls)
	if err != nil {
		return err
	}
	if selection.IsZero() {
		return nil
	}
	switch capability.WireShape {
	case "openai_responses_reasoning_effort":
		params.Reasoning = oshared.ReasoningParam{Effort: oshared.ReasoningEffort(reasoningEffortWireValue(selection.Level))}
	case "openrouter_reasoning_metadata":
		params.SetExtraFields(mergeAnyFields(params.ExtraFields(), map[string]any{
			"reasoning": map[string]any{"effort": reasoningEffortWireValue(selection.Level)},
		}))
	case "qwen_enable_thinking":
		if selection.BudgetTokens > 0 {
			return fmt.Errorf("qwen responses reasoning does not support thinking_budget")
		}
		if selection.Level == config.AIReasoningLevelOff {
			params.Reasoning = oshared.ReasoningParam{Effort: oshared.ReasoningEffort("none")}
		}
	default:
		return fmt.Errorf("unsupported responses reasoning wire shape %q", capability.WireShape)
	}
	return nil
}

func applyChatReasoning(params *openai.ChatCompletionNewParams, controls ProviderControls) error {
	if params == nil {
		return nil
	}
	selection, capability, err := providerReasoningSelection(controls)
	if err != nil {
		return err
	}
	if selection.IsZero() {
		return nil
	}
	extraFields := params.ExtraFields()
	switch capability.WireShape {
	case "openai_chat_reasoning_effort", "openai_responses_reasoning_effort", "glm_reasoning_effort", "xai_reasoning_effort", "groq_qwen_reasoning_effort", "groq_gpt_oss_reasoning_effort", "ollama_model_family_think":
		params.ReasoningEffort = oshared.ReasoningEffort(reasoningEffortWireValue(selection.Level))
	case "kimi_thinking_type", "glm_thinking_type":
		extraFields = mergeAnyFields(extraFields, map[string]any{"thinking": map[string]any{"type": thinkingTypeForSelection(selection)}})
	case "deepseek_reasoning_effort":
		if selection.Level == config.AIReasoningLevelOff {
			extraFields = mergeAnyFields(extraFields, map[string]any{"thinking": map[string]any{"type": "disabled"}})
		} else {
			params.ReasoningEffort = oshared.ReasoningEffort(reasoningEffortWireValue(selection.Level))
		}
	case "qwen_enable_thinking":
		extra := map[string]any{"enable_thinking": selection.Level != config.AIReasoningLevelOff}
		if selection.BudgetTokens > 0 {
			extra["thinking_budget"] = selection.BudgetTokens
		}
		extraFields = mergeAnyFields(extraFields, extra)
	case "gemini_thinking_level":
		params.ReasoningEffort = oshared.ReasoningEffort(reasoningEffortWireValue(selection.Level))
	case "gemini_openai_thinking_budget":
		extra := map[string]any{}
		if selection.Level == config.AIReasoningLevelOff {
			extra["extra_body"] = map[string]any{"google": map[string]any{"thinking_config": map[string]any{"thinking_budget": 0}}}
		}
		if selection.BudgetTokens > 0 {
			extra["extra_body"] = map[string]any{"google": map[string]any{"thinking_config": map[string]any{"thinking_budget": selection.BudgetTokens}}}
		}
		extraFields = mergeAnyFields(extraFields, extra)
	case "openrouter_reasoning_metadata":
		extraFields = mergeAnyFields(extraFields, map[string]any{"reasoning": map[string]any{"effort": reasoningEffortWireValue(selection.Level)}})
	default:
		return fmt.Errorf("unsupported chat reasoning wire shape %q", capability.WireShape)
	}
	if len(extraFields) > 0 {
		params.SetExtraFields(extraFields)
	}
	return nil
}

func thinkingTypeForSelection(selection config.AIReasoningSelection) string {
	if selection.Level == config.AIReasoningLevelOff {
		return "disabled"
	}
	return "enabled"
}

func applyAnthropicReasoning(params *anthropic.MessageNewParams, controls ProviderControls) error {
	if params == nil {
		return nil
	}
	selection, capability, err := providerReasoningSelection(controls)
	if err != nil {
		return err
	}
	if selection.IsZero() {
		return nil
	}
	if capability.WireShape != "anthropic_output_config_effort" {
		return fmt.Errorf("unsupported anthropic reasoning wire shape %q", capability.WireShape)
	}
	if selection.Level == config.AIReasoningLevelOff {
		disabled := anthropic.NewThinkingConfigDisabledParam()
		params.Thinking = anthropic.ThinkingConfigParamUnion{OfDisabled: &disabled}
		return nil
	}
	if selection.BudgetTokens > 0 {
		if selection.BudgetTokens >= params.MaxTokens {
			return fmt.Errorf("anthropic reasoning budget %d must be less than max_tokens %d", selection.BudgetTokens, params.MaxTokens)
		}
		params.Thinking = anthropic.ThinkingConfigParamOfEnabled(selection.BudgetTokens)
	} else if selection.Level != "" && selection.Level != config.AIReasoningLevelDefault {
		adaptive := anthropic.NewThinkingConfigAdaptiveParam()
		params.Thinking = anthropic.ThinkingConfigParamUnion{OfAdaptive: &adaptive}
	}
	if selection.Level != "" && selection.Level != config.AIReasoningLevelDefault {
		params.OutputConfig = anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffort(selection.Level)}
	}
	return nil
}

func decorateChatCompletionParams(params *openai.ChatCompletionNewParams, webSearchMode string, tools *[]openai.ChatCompletionToolParam) {
	if params == nil {
		return
	}
	extraFields := params.ExtraFields()
	switch strings.TrimSpace(webSearchMode) {
	case providerWebSearchModeKimiBuiltin:
		if tools != nil {
			*tools = append(*tools, openAIChatToolOverride(map[string]any{
				"type": "builtin_function",
				"function": map[string]any{
					"name": "$web_search",
				},
			}))
		}
	case providerWebSearchModeGLMWebSearchTool:
		if tools != nil {
			*tools = append(*tools, openAIChatToolOverride(map[string]any{
				"type": "web_search",
				"web_search": map[string]any{
					"search_result": true,
				},
			}))
		}
	case providerWebSearchModeDeepSeekNative:
		extraFields = mergeAnyFields(extraFields, map[string]any{"enable_search": true})
	}
	if len(extraFields) > 0 {
		params.SetExtraFields(extraFields)
	}
}

func openAIChatToolOverride(v map[string]any) openai.ChatCompletionToolParam {
	b, _ := json.Marshal(v)
	return param.Override[openai.ChatCompletionToolParam](json.RawMessage(b))
}

func decorateResponsesParams(params *oresponses.ResponseNewParams, webSearchMode string, tools *[]oresponses.ToolUnionParam) {
	if params == nil {
		return
	}
	switch strings.TrimSpace(webSearchMode) {
	case providerWebSearchModeOpenAIResponsesBuiltin:
		if tools != nil {
			*tools = append(*tools, oresponses.ToolParamOfWebSearchPreview(oresponses.WebSearchToolTypeWebSearchPreview))
		}
	case providerWebSearchModeQwenResponsesWebSearch:
		if tools != nil {
			*tools = append(*tools, openAIResponsesToolOverride(map[string]any{
				"type": "web_search",
			}))
		}
	}
}

func openAIResponsesToolOverride(v map[string]any) oresponses.ToolUnionParam {
	b, _ := json.Marshal(v)
	return param.Override[oresponses.ToolUnionParam](json.RawMessage(b))
}

func buildOpenAIChatMessages(messages []Message) []openai.ChatCompletionMessageParamUnion {
	out := make([]openai.ChatCompletionMessageParamUnion, 0, len(messages)+2)
	for _, msg := range messages {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		switch role {
		case "system":
			if txt := joinMessageText(msg); txt != "" {
				out = append(out, openai.SystemMessage(txt))
			}
		case "tool":
			for _, part := range msg.Content {
				if strings.ToLower(strings.TrimSpace(part.Type)) != "tool_result" {
					continue
				}
				callID := strings.TrimSpace(part.ToolCallID)
				if callID == "" {
					callID = strings.TrimSpace(part.ToolUseID)
				}
				if callID == "" {
					continue
				}
				output := strings.TrimSpace(part.Text)
				if output == "" && len(part.JSON) > 0 {
					output = string(part.JSON)
				}
				if output == "" {
					output = "{}"
				}
				out = append(out, openai.ToolMessage(output, callID))
			}
		case "assistant":
			var textBuf strings.Builder
			var reasoningBuf strings.Builder
			toolCalls := make([]openai.ChatCompletionMessageToolCallParam, 0, 2)
			appendAssistantText := func(text string) {
				text = strings.TrimSpace(text)
				if text == "" {
					return
				}
				if textBuf.Len() > 0 {
					textBuf.WriteString("\n")
				}
				textBuf.WriteString(text)
			}
			appendAssistantReasoning := func(text string) {
				text = strings.TrimSpace(text)
				if text == "" {
					return
				}
				if reasoningBuf.Len() > 0 {
					reasoningBuf.WriteString("\n")
				}
				reasoningBuf.WriteString(text)
			}
			for _, part := range msg.Content {
				switch strings.ToLower(strings.TrimSpace(part.Type)) {
				case "text":
					appendAssistantText(part.Text)
				case "reasoning":
					appendAssistantReasoning(part.Text)
				case "tool_call":
					callID := strings.TrimSpace(part.ToolCallID)
					if callID == "" {
						callID = strings.TrimSpace(part.ToolUseID)
					}
					if callID == "" {
						callID = fmt.Sprintf("assistant_call_%d", len(toolCalls)+1)
					}
					name := strings.TrimSpace(part.ToolName)
					if name == "" {
						name = strings.TrimSpace(part.Text)
					}
					name = sanitizeProviderToolName(name)
					if name == "" {
						continue
					}
					argsRaw := strings.TrimSpace(part.ArgsJSON)
					if argsRaw == "" && len(part.JSON) > 0 {
						argsRaw = strings.TrimSpace(string(part.JSON))
					}
					if argsRaw == "" {
						argsRaw = "{}"
					}
					if !json.Valid([]byte(argsRaw)) {
						argsRaw = "{}"
					}
					toolCalls = append(toolCalls, openai.ChatCompletionMessageToolCallParam{
						ID: callID,
						Function: openai.ChatCompletionMessageToolCallFunctionParam{
							Name:      name,
							Arguments: argsRaw,
						},
					})
				}
			}
			content := strings.TrimSpace(textBuf.String())
			if len(toolCalls) == 0 {
				if content != "" {
					out = append(out, openai.AssistantMessage(content))
				}
				continue
			}
			assistant := openai.ChatCompletionAssistantMessageParam{ToolCalls: toolCalls}
			if content != "" {
				assistant.Content = openai.ChatCompletionAssistantMessageParamContentUnion{OfString: openai.String(content)}
			}
			assistant.SetExtraFields(map[string]any{
				"reasoning_content": strings.TrimSpace(reasoningBuf.String()),
			})
			out = append(out, openai.ChatCompletionMessageParamUnion{OfAssistant: &assistant})
		default:
			contentParts := make([]openai.ChatCompletionContentPartUnionParam, 0, len(msg.Content))
			for _, part := range msg.Content {
				switch strings.ToLower(strings.TrimSpace(part.Type)) {
				case "text":
					if txt := strings.TrimSpace(part.Text); txt != "" {
						contentParts = append(contentParts, openai.TextContentPart(txt))
					}
				case "image":
					if uri := strings.TrimSpace(part.FileURI); uri != "" {
						contentParts = append(contentParts, openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{URL: uri}))
					}
				case "file":
					continue
				}
			}
			if len(contentParts) == 0 {
				if txt := joinMessageText(msg); txt != "" {
					out = append(out, openai.UserMessage(txt))
				}
				continue
			}
			if len(contentParts) == 1 {
				if txt := contentParts[0].GetText(); txt != nil {
					out = append(out, openai.UserMessage(*txt))
					continue
				}
			}
			out = append(out, openai.UserMessage(contentParts))
		}
	}
	return out
}

func extractMoonshotChatReasoningDelta(delta openai.ChatCompletionChunkChoiceDelta) string {
	return extractMoonshotReasoningJSON(delta.RawJSON())
}

func extractMoonshotReasoningJSON(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return ""
	}
	decoded := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return ""
	}
	for _, key := range []string{"reasoning_content", "reasoning"} {
		if text := extractMoonshotReasoningValue(decoded[key]); text != "" {
			return text
		}
	}
	return ""
}

func extractMoonshotReasoningValue(v any) string {
	switch val := v.(type) {
	case string:
		// Preserve provider fragment whitespace exactly as streamed. Moonshot/Kimi may
		// emit reasoning as token-like fragments such as "Let" + " me", and trimming
		// each fragment corrupts the visible reasoning transcript.
		return val
	case []any:
		var b strings.Builder
		for _, item := range val {
			if text := extractMoonshotReasoningValue(item); text != "" {
				b.WriteString(text)
			}
		}
		return b.String()
	case map[string]any:
		for _, key := range []string{"text", "content", "reasoning_content", "reasoning"} {
			if text := extractMoonshotReasoningValue(val[key]); text != "" {
				return text
			}
		}
	}
	return ""
}

func mapOpenAIChatFinishReason(reason string) string {
	reason = strings.TrimSpace(strings.ToLower(reason))
	switch reason {
	case "stop", "length", "tool_calls", "content_filter", "function_call":
		return reason
	default:
		return "unknown"
	}
}

func emitProviderEvent(onEvent func(StreamEvent), event StreamEvent) {
	if onEvent != nil {
		onEvent(event)
	}
}

func buildOpenAITools(defs []ToolDef, strict bool) ([]oresponses.ToolUnionParam, map[string]string) {
	out := make([]oresponses.ToolUnionParam, 0, len(defs))
	aliasToReal := make(map[string]string, len(defs))
	for _, def := range defs {
		if strings.TrimSpace(def.Name) == "" {
			continue
		}
		schema := map[string]any{}
		if len(def.InputSchema) > 0 {
			_ = json.Unmarshal(def.InputSchema, &schema)
		}
		alias := sanitizeProviderToolName(def.Name)
		out = append(out, oresponses.ToolParamOfFunction(alias, schema, strict))
		aliasToReal[alias] = def.Name
	}
	return out, aliasToReal
}

func buildOpenAIInput(messages []Message) (oresponses.ResponseInputParam, string) {
	items := make(oresponses.ResponseInputParam, 0, len(messages)+2)
	instructions := ""
	for _, msg := range messages {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		switch role {
		case "system":
			if txt := joinMessageText(msg); txt != "" {
				if instructions == "" {
					instructions = txt
				} else {
					instructions += "\n\n" + txt
				}
			}
		case "tool":
			for _, part := range msg.Content {
				if strings.TrimSpace(part.Type) != "tool_result" {
					continue
				}
				callID := strings.TrimSpace(part.ToolCallID)
				if callID == "" {
					callID = strings.TrimSpace(part.ToolUseID)
				}
				if callID == "" {
					continue
				}
				output := strings.TrimSpace(part.Text)
				if output == "" && len(part.JSON) > 0 {
					output = string(part.JSON)
				}
				items = append(items, oresponses.ResponseInputItemParamOfFunctionCallOutput(callID, output))
			}
		case "assistant":
			handledAssistantPart := false
			appendFunctionCall := func(part ContentPart) {
				callID := strings.TrimSpace(part.ToolCallID)
				if callID == "" {
					callID = strings.TrimSpace(part.ToolUseID)
				}
				if callID == "" {
					return
				}
				name := strings.TrimSpace(part.ToolName)
				if name == "" {
					name = strings.TrimSpace(part.Text)
				}
				name = sanitizeProviderToolName(name)
				if name == "" {
					return
				}
				argsRaw := strings.TrimSpace(part.ArgsJSON)
				if argsRaw == "" && len(part.JSON) > 0 {
					argsRaw = strings.TrimSpace(string(part.JSON))
				}
				if argsRaw == "" {
					argsRaw = "{}"
				}
				if !json.Valid([]byte(argsRaw)) {
					argsRaw = "{}"
				}
				items = append(items, oresponses.ResponseInputItemParamOfFunctionCall(argsRaw, callID, name))
				handledAssistantPart = true
			}
			var textBuf strings.Builder
			appendAssistantText := func(text string) {
				text = strings.TrimSpace(text)
				if text == "" {
					return
				}
				if textBuf.Len() > 0 {
					textBuf.WriteString("\n")
				}
				textBuf.WriteString(text)
				handledAssistantPart = true
			}
			flushAssistantText := func() {
				txt := strings.TrimSpace(textBuf.String())
				textBuf.Reset()
				if txt == "" {
					return
				}
				items = append(items, oresponses.ResponseInputItemParamOfMessage(txt, oresponses.EasyInputMessageRoleAssistant))
			}
			for _, part := range msg.Content {
				switch strings.ToLower(strings.TrimSpace(part.Type)) {
				case "text":
					appendAssistantText(part.Text)
				case "tool_call":
					flushAssistantText()
					appendFunctionCall(part)
				}
			}
			if !handledAssistantPart {
				appendAssistantText(joinMessageText(msg))
			}
			flushAssistantText()
		default:
			uiRole := oresponses.EasyInputMessageRoleUser
			content := make(oresponses.ResponseInputMessageContentListParam, 0, len(msg.Content))
			flushMessage := func() {
				if len(content) == 0 {
					return
				}
				items = append(items, oresponses.ResponseInputItemParamOfMessage(content, uiRole))
				content = content[:0]
			}
			for _, part := range msg.Content {
				switch strings.ToLower(strings.TrimSpace(part.Type)) {
				case "text":
					if txt := strings.TrimSpace(part.Text); txt != "" {
						content = append(content, oresponses.ResponseInputContentUnionParam{
							OfInputText: &oresponses.ResponseInputTextParam{Text: txt},
						})
					}
				case "image":
					if uri := strings.TrimSpace(part.FileURI); uri != "" {
						content = append(content, oresponses.ResponseInputContentUnionParam{
							OfInputImage: &oresponses.ResponseInputImageParam{
								Detail:   oresponses.ResponseInputImageDetailAuto,
								ImageURL: openai.String(uri),
							},
						})
					}
				case "file":
					uri := strings.TrimSpace(part.FileURI)
					if uri == "" {
						continue
					}
					var fp oresponses.ResponseInputFileParam
					if b64, ok := extractDataURLBase64(uri); ok {
						fp.FileData = openai.String(b64)
					} else if strings.HasPrefix(uri, "http://") || strings.HasPrefix(uri, "https://") {
						fp.FileURL = openai.String(uri)
					} else {
						// Do not pass local paths directly to the provider; let the fs tool read them.
						continue
					}
					if fn := strings.TrimSpace(part.Text); fn != "" {
						fp.Filename = openai.String(fn)
					}
					content = append(content, oresponses.ResponseInputContentUnionParam{OfInputFile: &fp})
				}
			}
			if len(content) == 0 {
				if txt := joinMessageText(msg); txt != "" {
					content = append(content, oresponses.ResponseInputContentUnionParam{
						OfInputText: &oresponses.ResponseInputTextParam{Text: txt},
					})
				}
			}
			flushMessage()
		}
	}
	return items, instructions
}

func extractDataURLBase64(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "data:") {
		return "", false
	}
	meta, data, ok := strings.Cut(raw, ",")
	if !ok {
		return "", false
	}
	if !strings.Contains(meta, ";base64") {
		return "", false
	}
	data = strings.TrimSpace(data)
	if data == "" {
		return "", false
	}
	return data, true
}

type anthropicProvider struct {
	client anthropic.Client
}

func (p *anthropicProvider) StreamTurn(ctx context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	if p == nil {
		return ModelGatewayResult{}, errors.New("nil provider")
	}
	if strings.TrimSpace(req.Model) == "" {
		return ModelGatewayResult{}, errors.New("missing model")
	}
	if err := validateGatewayAttachmentParts(req.Messages, "anthropic"); err != nil {
		return ModelGatewayResult{}, err
	}
	tools, aliasToReal := buildAnthropicTools(req.Tools)
	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(strings.TrimSpace(req.Model)),
		MaxTokens: modelGatewayDefaultMaxOutputTokens,
		Messages:  buildAnthropicMessages(req.Messages),
		Tools:     tools,
	}
	if req.Budgets.MaxOutputToken > 0 {
		params.MaxTokens = int64(req.Budgets.MaxOutputToken)
	}
	if req.ProviderControls.Temperature != nil {
		params.Temperature = anthropic.Float(*req.ProviderControls.Temperature)
	}
	if req.ProviderControls.TopP != nil {
		params.TopP = anthropic.Float(*req.ProviderControls.TopP)
	}
	if err := applyAnthropicReasoning(&params, req.ProviderControls); err != nil {
		return ModelGatewayResult{}, err
	}
	if system := collectSystemPrompt(req.Messages); strings.TrimSpace(system) != "" {
		params.System = []anthropic.TextBlockParam{{Text: strings.TrimSpace(system)}}
	}

	stream := p.client.Messages.NewStreaming(ctx, params)
	msg := anthropic.Message{}
	var textBuf strings.Builder

	type partialCall struct {
		Index int64
		ID    string
		Name  string

		Started bool
		Ended   bool
		ArgsRaw strings.Builder
		Args    map[string]any
	}
	partials := map[int64]*partialCall{} // content_block index -> partial

	emitStart := func(pc *partialCall) {
		if pc == nil || pc.Started {
			return
		}
		pc.Started = true
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallStart, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.ID), Name: canonicalProviderToolName(pc.Name, aliasToReal)}})
	}
	emitDelta := func(pc *partialCall) {
		if pc == nil {
			return
		}
		if strings.TrimSpace(pc.Name) == "" || strings.TrimSpace(pc.ID) == "" {
			return
		}
		emitStart(pc)
		raw := strings.TrimSpace(pc.ArgsRaw.String())
		var args map[string]any
		if raw != "" {
			_ = json.Unmarshal([]byte(raw), &args) // Streaming deltas may be incomplete; ignore parse failures.
		}
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallDelta, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.ID), Name: canonicalProviderToolName(pc.Name, aliasToReal), ArgumentsJSON: raw, Arguments: cloneAnyMap(args)}})
	}
	emitEnd := func(pc *partialCall, rawArgs string) {
		if pc == nil || pc.Ended {
			return
		}
		pc.Ended = true
		rawArgs = strings.TrimSpace(rawArgs)
		args := map[string]any{}
		if rawArgs != "" {
			_ = json.Unmarshal([]byte(rawArgs), &args)
		}
		pc.Args = args
		emitStart(pc)
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallEnd, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.ID), Name: canonicalProviderToolName(pc.Name, aliasToReal), Arguments: cloneAnyMap(args)}})
	}

	for stream.Next() {
		event := stream.Current()
		if err := msg.Accumulate(event); err != nil {
			return ModelGatewayResult{}, err
		}
		switch variant := event.AsAny().(type) {
		case anthropic.ContentBlockStartEvent:
			if strings.TrimSpace(variant.ContentBlock.Type) != "tool_use" {
				continue
			}
			callID := strings.TrimSpace(variant.ContentBlock.ID)
			if callID == "" {
				callID = fmt.Sprintf("anthropic_call_%d", len(partials)+1)
			}
			toolName := canonicalProviderToolName(variant.ContentBlock.Name, aliasToReal)
			pc := &partialCall{Index: variant.Index, ID: callID, Name: toolName}
			partials[variant.Index] = pc
			emitStart(pc)
			if variant.ContentBlock.Input != nil {
				if b, err := json.Marshal(variant.ContentBlock.Input); err == nil {
					raw := strings.TrimSpace(string(b))
					if raw != "" && raw != "{}" {
						pc.ArgsRaw.WriteString(raw)
						emitDelta(pc)
					}
				}
			}

		case anthropic.ContentBlockDeltaEvent:
			switch delta := variant.Delta.AsAny().(type) {
			case anthropic.TextDelta:
				if delta.Text == "" {
					continue
				}
				textBuf.WriteString(delta.Text)
				emitProviderEvent(onEvent, StreamEvent{Type: StreamEventTextDelta, Text: delta.Text})
			case anthropic.InputJSONDelta:
				pc := partials[variant.Index]
				if pc == nil {
					continue
				}
				if delta.PartialJSON == "" {
					continue
				}
				pc.ArgsRaw.WriteString(delta.PartialJSON)
				emitDelta(pc)
			case anthropic.ThinkingDelta:
				if strings.TrimSpace(delta.Thinking) != "" {
					emitProviderEvent(onEvent, StreamEvent{Type: StreamEventThinkingDelta, Text: delta.Thinking})
				}
			}
		case anthropic.ContentBlockStopEvent:
			pc := partials[variant.Index]
			if pc == nil || pc.Ended {
				continue
			}
			raw := strings.TrimSpace(pc.ArgsRaw.String())
			if raw == "" {
				idx := int(variant.Index)
				if idx >= 0 && idx < len(msg.Content) {
					if tu, ok := msg.Content[idx].AsAny().(anthropic.ToolUseBlock); ok && len(tu.Input) > 0 {
						raw = strings.TrimSpace(string(tu.Input))
					}
				}
			}
			emitEnd(pc, raw)
		}
	}
	if err := stream.Err(); err != nil {
		return ModelGatewayResult{}, err
	}

	result := ModelGatewayResult{
		FinishReason: mapAnthropicStopReason(msg.StopReason),
		Text:         strings.TrimSpace(textBuf.String()),
		Usage: TurnUsage{
			InputTokens:  msg.Usage.InputTokens,
			OutputTokens: msg.Usage.OutputTokens,
		},
		RawProviderDiag: map[string]any{"message_id": strings.TrimSpace(msg.ID)},
	}

	seen := map[string]struct{}{}
	indices := make([]int64, 0, len(partials))
	for idx, pc := range partials {
		if pc == nil || !pc.Ended {
			continue
		}
		indices = append(indices, idx)
	}
	sort.Slice(indices, func(i, j int) bool { return indices[i] < indices[j] })
	for _, idx := range indices {
		pc := partials[idx]
		if pc == nil {
			continue
		}
		id := strings.TrimSpace(pc.ID)
		if id == "" {
			continue
		}
		seen[id] = struct{}{}
		result.ToolCalls = append(result.ToolCalls, ToolCall{ID: id, Name: canonicalProviderToolName(pc.Name, aliasToReal), Args: cloneAnyMap(pc.Args)})
	}

	for _, block := range msg.Content {
		switch variant := block.AsAny().(type) {
		case anthropic.TextBlock:
			if strings.TrimSpace(result.Text) == "" {
				result.Text = strings.TrimSpace(variant.Text)
			}
		case anthropic.ToolUseBlock:
			args := map[string]any{}
			if len(variant.Input) > 0 {
				_ = json.Unmarshal(variant.Input, &args)
			}
			callID := strings.TrimSpace(variant.ID)
			if callID == "" {
				callID = fmt.Sprintf("anthropic_call_%d", len(result.ToolCalls)+1)
			}
			if _, ok := seen[callID]; ok {
				continue
			}
			toolName := canonicalProviderToolName(variant.Name, aliasToReal)
			call := ToolCall{ID: callID, Name: toolName, Args: args}
			result.ToolCalls = append(result.ToolCalls, call)
			raw := ""
			if len(variant.Input) > 0 {
				raw = string(variant.Input)
			}
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallStart, ToolCall: &PartialToolCall{ID: call.ID, Name: call.Name}})
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallDelta, ToolCall: &PartialToolCall{ID: call.ID, Name: call.Name, ArgumentsJSON: raw, Arguments: cloneAnyMap(call.Args)}})
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallEnd, ToolCall: &PartialToolCall{ID: call.ID, Name: call.Name, Arguments: cloneAnyMap(call.Args)}})
		}
	}
	if len(result.ToolCalls) > 0 {
		result.FinishReason = "tool_calls"
	}
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventUsage, Usage: &PartialUsage{InputTokens: result.Usage.InputTokens, OutputTokens: result.Usage.OutputTokens, ReasoningTokens: result.Usage.ReasoningTokens}})
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventFinishReason, FinishHint: result.FinishReason})
	return result, nil
}

func buildAnthropicTools(defs []ToolDef) ([]anthropic.ToolUnionParam, map[string]string) {
	out := make([]anthropic.ToolUnionParam, 0, len(defs))
	aliasToReal := make(map[string]string, len(defs))
	for _, def := range defs {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		schemaMap := map[string]any{}
		if len(def.InputSchema) > 0 {
			_ = json.Unmarshal(def.InputSchema, &schemaMap)
		}
		required, _ := toStringSlice(schemaMap["required"])
		param := anthropic.ToolParam{
			Name:        sanitizeProviderToolName(name),
			Description: anthropic.String(strings.TrimSpace(def.Description)),
			InputSchema: anthropic.ToolInputSchemaParam{Type: "object", Properties: schemaMap["properties"], Required: required},
			Strict:      anthropic.Bool(true),
		}
		aliasToReal[sanitizeProviderToolName(name)] = name
		out = append(out, anthropic.ToolUnionParam{OfTool: &param})
	}
	return out, aliasToReal
}

func buildAnthropicMessages(messages []Message) []anthropic.MessageParam {
	out := make([]anthropic.MessageParam, 0, len(messages)+1)
	for _, msg := range messages {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		if role == "system" {
			continue
		}
		blocks := make([]anthropic.ContentBlockParamUnion, 0, len(msg.Content)+1)
		for _, part := range msg.Content {
			switch strings.ToLower(strings.TrimSpace(part.Type)) {
			case "tool_result":
				callID := strings.TrimSpace(part.ToolCallID)
				if callID == "" {
					callID = strings.TrimSpace(part.ToolUseID)
				}
				if callID == "" {
					continue
				}
				content := strings.TrimSpace(part.Text)
				if content == "" && len(part.JSON) > 0 {
					content = string(part.JSON)
				}
				blocks = append(blocks, anthropic.NewToolResultBlock(callID, content, false))
			case "image":
				uri := strings.TrimSpace(part.FileURI)
				if uri == "" {
					continue
				}
				if b64, ok := extractDataURLBase64(uri); ok {
					mediaType := strings.TrimSpace(part.MimeType)
					if mediaType == "" {
						mediaType = "image/png"
					}
					blocks = append(blocks, anthropic.NewImageBlockBase64(mediaType, b64))
					continue
				}
				if strings.HasPrefix(uri, "http://") || strings.HasPrefix(uri, "https://") {
					blocks = append(blocks, anthropic.NewImageBlock(anthropic.URLImageSourceParam{URL: uri}))
				}
			case "file":
				uri := strings.TrimSpace(part.FileURI)
				if uri == "" {
					continue
				}
				mime := strings.ToLower(strings.TrimSpace(part.MimeType))
				b64, ok := extractDataURLBase64(uri)
				if !ok {
					continue
				}
				switch mime {
				case "application/pdf":
					blocks = append(blocks, anthropic.NewDocumentBlock(anthropic.Base64PDFSourceParam{Data: b64}))
				default:
					if !isTextLikeMimeType(mime) {
						continue
					}
					decoded, err := base64.StdEncoding.DecodeString(b64)
					if err != nil {
						continue
					}
					txt := strings.TrimSpace(string(decoded))
					if txt == "" {
						continue
					}
					txt = truncateRunes(txt, 40_000)
					blocks = append(blocks, anthropic.NewDocumentBlock(anthropic.PlainTextSourceParam{Data: txt}))
				}
			default:
				if txt := strings.TrimSpace(part.Text); txt != "" {
					blocks = append(blocks, anthropic.NewTextBlock(txt))
				}
			}
		}
		if len(blocks) == 0 {
			if txt := joinMessageText(msg); txt != "" {
				blocks = append(blocks, anthropic.NewTextBlock(txt))
			}
		}
		if len(blocks) == 0 {
			continue
		}
		if role == "assistant" {
			out = append(out, anthropic.NewAssistantMessage(blocks...))
		} else {
			out = append(out, anthropic.NewUserMessage(blocks...))
		}
	}
	if len(out) == 0 {
		out = append(out, anthropic.NewUserMessage(anthropic.NewTextBlock("Continue.")))
	}
	return out
}

func isTextLikeMimeType(mime string) bool {
	mime = strings.ToLower(strings.TrimSpace(mime))
	if strings.HasPrefix(mime, "text/") {
		return true
	}
	switch mime {
	case "application/json", "application/xml", "application/yaml", "application/x-yaml", "application/toml", "application/markdown":
		return true
	default:
		return false
	}
}

func validateGatewayAttachmentParts(messages []Message, route string) error {
	for messageIndex, message := range messages {
		for partIndex, part := range message.Content {
			partType := strings.ToLower(strings.TrimSpace(part.Type))
			if partType != "image" && partType != "file" {
				continue
			}
			uri := strings.TrimSpace(part.FileURI)
			mimeType := strings.ToLower(strings.TrimSpace(part.MimeType))
			if uri == "" || mimeType == "" {
				return fmt.Errorf("message %d attachment %d is incomplete", messageIndex, partIndex)
			}
			if partType == "image" {
				switch mimeType {
				case "image/png", "image/jpeg", "image/gif", "image/webp":
				default:
					return fmt.Errorf("message %d attachment %d has unsupported image MIME type %q", messageIndex, partIndex, mimeType)
				}
				if _, ok := extractDataURLBase64(uri); !ok && !strings.HasPrefix(uri, "http://") && !strings.HasPrefix(uri, "https://") {
					return fmt.Errorf("message %d attachment %d has unsupported image source", messageIndex, partIndex)
				}
				continue
			}
			if !supportedProviderFileMIMEType(mimeType) {
				return fmt.Errorf("message %d attachment %d has unsupported file MIME type %q", messageIndex, partIndex, mimeType)
			}
			switch route {
			case "openai-responses":
				if _, ok := extractDataURLBase64(uri); !ok && !strings.HasPrefix(uri, "http://") && !strings.HasPrefix(uri, "https://") {
					return fmt.Errorf("message %d attachment %d has unsupported file source", messageIndex, partIndex)
				}
			case "anthropic":
				if mimeType != "application/pdf" && !isTextLikeMimeType(mimeType) {
					return fmt.Errorf("message %d attachment %d is unsupported by Anthropic", messageIndex, partIndex)
				}
				if _, ok := extractDataURLBase64(uri); !ok {
					return fmt.Errorf("message %d attachment %d requires inline file data", messageIndex, partIndex)
				}
			default:
				return fmt.Errorf("provider route %q does not support file input", route)
			}
		}
	}
	return nil
}

func collectSystemPrompt(messages []Message) string {
	parts := make([]string, 0, 2)
	for _, msg := range messages {
		if strings.ToLower(strings.TrimSpace(msg.Role)) != "system" {
			continue
		}
		if txt := joinMessageText(msg); txt != "" {
			parts = append(parts, txt)
		}
	}
	return strings.Join(parts, "\n\n")
}

func joinMessageText(msg Message) string {
	parts := make([]string, 0, len(msg.Content))
	for _, part := range msg.Content {
		if strings.ToLower(strings.TrimSpace(part.Type)) != "text" {
			continue
		}
		if txt := strings.TrimSpace(part.Text); txt != "" {
			parts = append(parts, txt)
		}
	}
	return strings.Join(parts, "\n")
}

func (r *run) supportsModelGatewayProvider(provider *config.AIProvider) bool {
	if r == nil || provider == nil {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(provider.Type)) {
	case "openai", "anthropic", "moonshot", "chatglm", "deepseek", "qwen", "openrouter", "xai", "groq", "ollama", "openai_compatible", DesktopModelSourceProviderType:
		return true
	default:
		return false
	}
}

func newProviderAdapter(providerType string, baseURL string, apiKey string, strictToolSchemaOverride *bool, parallelToolCallsOverride ...parallelToolCallsWireMode) (ModelGateway, error) {
	providerType = strings.ToLower(strings.TrimSpace(providerType))
	if strings.TrimSpace(apiKey) == "" && providerType != "ollama" {
		return nil, errors.New("missing provider api key")
	}
	if providerType == "ollama" && strings.TrimSpace(apiKey) == "" {
		apiKey = "ollama"
	}
	strictToolSchema := resolveStrictToolSchema(providerType, baseURL, strictToolSchemaOverride)
	parallelTools := resolveParallelToolCallsWireMode(providerType, baseURL)
	if len(parallelToolCallsOverride) > 0 {
		parallelTools = parallelToolCallsOverride[0]
	}
	switch providerType {
	case "openai":
		opts := []ooption.RequestOption{ooption.WithAPIKey(strings.TrimSpace(apiKey))}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, ooption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &openAIProvider{
			client:           openai.NewClient(opts...),
			strictToolSchema: strictToolSchema,
			parallelTools:    parallelTools,
		}, nil
	case "openai_compatible", "openrouter", "xai", "groq", "ollama":
		opts := []ooption.RequestOption{ooption.WithAPIKey(strings.TrimSpace(apiKey))}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, ooption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &openAIProvider{
			client:           openai.NewClient(opts...),
			strictToolSchema: strictToolSchema,
			forceChat:        true,
			parallelTools:    parallelTools,
		}, nil
	case "chatglm", "deepseek":
		opts := []ooption.RequestOption{ooption.WithAPIKey(strings.TrimSpace(apiKey))}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, ooption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &openAIProvider{
			client:           openai.NewClient(opts...),
			strictToolSchema: strictToolSchema,
			forceChat:        true,
			parallelTools:    parallelTools,
		}, nil
	case "qwen":
		opts := []ooption.RequestOption{ooption.WithAPIKey(strings.TrimSpace(apiKey))}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, ooption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &openAIProvider{
			client:           openai.NewClient(opts...),
			strictToolSchema: strictToolSchema,
			forceChat:        true,
			parallelTools:    parallelTools,
		}, nil
	case "moonshot":
		opts := []ooption.RequestOption{ooption.WithAPIKey(strings.TrimSpace(apiKey))}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, ooption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &moonshotProvider{
			client:           openai.NewClient(opts...),
			strictToolSchema: strictToolSchema,
		}, nil
	case "anthropic":
		opts := []aoption.RequestOption{aoption.WithAPIKey(strings.TrimSpace(apiKey))}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, aoption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &anthropicProvider{client: anthropic.NewClient(opts...)}, nil
	default:
		return nil, fmt.Errorf("unsupported provider type %q", providerType)
	}
}

func resolveParallelToolCallsWireMode(providerType string, baseURL string) parallelToolCallsWireMode {
	providerType = strings.ToLower(strings.TrimSpace(providerType))
	baseURL = strings.TrimSpace(baseURL)
	if providerType == "openai" && baseURL == "" {
		return parallelToolCallsWireEnable
	}
	if baseURL == "" {
		return parallelToolCallsWireOmit
	}
	u, err := url.Parse(baseURL)
	if err != nil || u == nil || !strings.EqualFold(strings.TrimSpace(u.Scheme), "https") {
		return parallelToolCallsWireOmit
	}
	host := strings.ToLower(strings.TrimSpace(u.Hostname()))
	officialHosts := map[string]map[string]struct{}{
		"openai":     {"api.openai.com": {}},
		"qwen":       {"dashscope.aliyuncs.com": {}, "dashscope-intl.aliyuncs.com": {}, "dashscope-us.aliyuncs.com": {}},
		"openrouter": {"openrouter.ai": {}},
		"xai":        {"api.x.ai": {}},
		"groq":       {"api.groq.com": {}},
	}
	if _, ok := officialHosts[providerType][host]; ok {
		return parallelToolCallsWireEnable
	}
	return parallelToolCallsWireOmit
}

func resolveStrictToolSchema(providerType string, baseURL string, override *bool) bool {
	if override != nil {
		return *override
	}
	return shouldUseStrictOpenAIToolSchema(providerType, baseURL)
}

func shouldUseStrictOpenAIToolSchema(providerType string, baseURL string) bool {
	providerType = strings.ToLower(strings.TrimSpace(providerType))
	if providerType == "openai_compatible" || providerType == "chatglm" || providerType == "deepseek" || providerType == "qwen" || providerType == "openrouter" || providerType == "xai" || providerType == "groq" || providerType == "ollama" {
		// Compatible endpoints vary widely in strict function schema support; disable strict mode by default.
		return false
	}
	if providerType == "moonshot" {
		// Moonshot uses a chat-completions-compatible endpoint; strict schema is not guaranteed.
		return false
	}
	if providerType != "openai" {
		return true
	}

	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return true
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(strings.TrimSpace(u.Hostname()))
	// Enable strict mode by default only for official OpenAI domains.
	return host == "api.openai.com"
}

type toolReferenceIntegrityStats struct {
	OrphanToolCallIDs          []string
	PrependedAssistantMessages int
	DroppedToolResultParts     int
	DroppedToolMessages        int
}

func cloneMessages(messages []Message) []Message {
	if len(messages) == 0 {
		return nil
	}
	out := make([]Message, 0, len(messages))
	for _, msg := range messages {
		cloned := Message{
			Role:    msg.Role,
			Content: make([]ContentPart, 0, len(msg.Content)),
		}
		for _, part := range msg.Content {
			cp := part
			if len(part.JSON) > 0 {
				cp.JSON = append([]byte(nil), part.JSON...)
			}
			cloned.Content = append(cloned.Content, cp)
		}
		out = append(out, cloned)
	}
	return out
}

func enforceToolReferenceIntegrity(messages []Message, archived []Message) ([]Message, toolReferenceIntegrityStats) {
	current := cloneMessages(messages)
	stats := toolReferenceIntegrityStats{}
	if len(current) == 0 {
		return current, stats
	}

	missing := findMissingToolCallIDs(current)
	if len(missing) > 0 {
		stats.OrphanToolCallIDs = append(stats.OrphanToolCallIDs, missing...)
	}

	if len(archived) > 0 && len(missing) > 0 {
		recovered := collectAssistantDeclarationsForCallIDs(archived, missing)
		if len(recovered) > 0 {
			stats.PrependedAssistantMessages = len(recovered)
			prefixed := make([]Message, 0, len(recovered)+len(current))
			prefixed = append(prefixed, cloneMessages(recovered)...)
			prefixed = append(prefixed, current...)
			current = prefixed
		}
	}

	declared := make(map[string]struct{}, 8)
	out := make([]Message, 0, len(current))
	for _, msg := range current {
		filtered := make([]ContentPart, 0, len(msg.Content))
		dropped := 0
		for _, part := range msg.Content {
			partType := strings.ToLower(strings.TrimSpace(part.Type))
			switch partType {
			case "tool_call":
				callID := toolCallIDFromPart(part)
				if callID != "" {
					declared[callID] = struct{}{}
				}
				filtered = append(filtered, part)
			case "tool_result":
				callID := toolCallIDFromPart(part)
				if callID == "" {
					dropped++
					continue
				}
				if _, ok := declared[callID]; !ok {
					dropped++
					continue
				}
				filtered = append(filtered, part)
			default:
				filtered = append(filtered, part)
			}
		}
		if dropped > 0 {
			stats.DroppedToolResultParts += dropped
		}
		if len(filtered) == 0 {
			stats.DroppedToolMessages++
			continue
		}
		msg.Content = filtered
		out = append(out, msg)
	}
	return out, stats
}

func findMissingToolCallIDs(messages []Message) []string {
	if len(messages) == 0 {
		return nil
	}
	declared := make(map[string]struct{}, 8)
	missingSet := make(map[string]struct{}, 4)
	order := make([]string, 0, 4)
	for _, msg := range messages {
		for _, part := range msg.Content {
			partType := strings.ToLower(strings.TrimSpace(part.Type))
			switch partType {
			case "tool_call":
				callID := toolCallIDFromPart(part)
				if callID == "" {
					continue
				}
				declared[callID] = struct{}{}
			case "tool_result":
				callID := toolCallIDFromPart(part)
				if callID == "" {
					continue
				}
				if _, ok := declared[callID]; ok {
					continue
				}
				if _, seen := missingSet[callID]; seen {
					continue
				}
				missingSet[callID] = struct{}{}
				order = append(order, callID)
			}
		}
	}
	return order
}

func collectAssistantDeclarationsForCallIDs(archived []Message, callIDs []string) []Message {
	if len(archived) == 0 || len(callIDs) == 0 {
		return nil
	}
	need := make(map[string]struct{}, len(callIDs))
	for _, id := range callIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		need[id] = struct{}{}
	}
	if len(need) == 0 {
		return nil
	}
	indexSet := make(map[int]struct{}, len(need))
	for i := len(archived) - 1; i >= 0; i-- {
		msg := archived[i]
		if strings.ToLower(strings.TrimSpace(msg.Role)) != "assistant" {
			continue
		}
		ids := toolCallIDsFromAssistantMessage(msg)
		if len(ids) == 0 {
			continue
		}
		hit := false
		for _, id := range ids {
			if _, ok := need[id]; ok {
				delete(need, id)
				hit = true
			}
		}
		if hit {
			indexSet[i] = struct{}{}
		}
		if len(need) == 0 {
			break
		}
	}
	if len(indexSet) == 0 {
		return nil
	}
	indexes := make([]int, 0, len(indexSet))
	for idx := range indexSet {
		indexes = append(indexes, idx)
	}
	sort.Ints(indexes)
	out := make([]Message, 0, len(indexes))
	for _, idx := range indexes {
		out = append(out, archived[idx])
	}
	return out
}

func toolCallIDsFromAssistantMessage(msg Message) []string {
	if strings.ToLower(strings.TrimSpace(msg.Role)) != "assistant" {
		return nil
	}
	out := make([]string, 0, 2)
	seen := make(map[string]struct{}, 2)
	for _, part := range msg.Content {
		if strings.ToLower(strings.TrimSpace(part.Type)) != "tool_call" {
			continue
		}
		callID := toolCallIDFromPart(part)
		if callID == "" {
			continue
		}
		if _, ok := seen[callID]; ok {
			continue
		}
		seen[callID] = struct{}{}
		out = append(out, callID)
	}
	return out
}

func toolCallIDFromPart(part ContentPart) string {
	callID := strings.TrimSpace(part.ToolCallID)
	if callID == "" {
		callID = strings.TrimSpace(part.ToolUseID)
	}
	return callID
}

func isProviderToolCallReferenceError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(strings.TrimSpace(err.Error()))
	if msg == "" {
		return false
	}
	if !strings.Contains(msg, "tool_call_id") && !strings.Contains(msg, "tool call id") {
		return false
	}
	return strings.Contains(msg, "not found")
}

func appendLimited(in []string, value string, limit int) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return in
	}
	in = append(in, value)
	if limit > 0 && len(in) > limit {
		return append([]string(nil), in[len(in)-limit:]...)
	}
	return in
}

func buildAssistantHistoryMessage(text string, reasoning string, calls []ToolCall) (Message, bool) {
	parts := make([]ContentPart, 0, len(calls)+2)
	if txt := strings.TrimSpace(text); txt != "" {
		parts = append(parts, ContentPart{Type: "text", Text: txt})
	}
	if len(calls) > 0 {
		if txt := strings.TrimSpace(reasoning); txt != "" {
			parts = append(parts, ContentPart{Type: "reasoning", Text: txt})
		}
		for _, call := range calls {
			callID := strings.TrimSpace(call.ID)
			name := strings.TrimSpace(call.Name)
			if callID == "" || name == "" {
				continue
			}
			args := cloneAnyMap(call.Args)
			if args == nil {
				args = map[string]any{}
			}
			b, _ := json.Marshal(args)
			rawArgs := strings.TrimSpace(string(b))
			if rawArgs == "" || rawArgs == "null" || !json.Valid(b) {
				rawArgs = "{}"
				b = []byte(rawArgs)
			}
			parts = append(parts, ContentPart{
				Type:       "tool_call",
				ToolCallID: callID,
				ToolName:   name,
				ArgsJSON:   rawArgs,
				JSON:       b,
			})
		}
	}
	if len(parts) == 0 {
		return Message{}, false
	}
	return Message{Role: "assistant", Content: parts}, true
}

func buildToolResultMessages(results []ToolResult, calls []ToolCall) []Message {
	if len(results) == 0 {
		return nil
	}
	callByID := map[string]ToolCall{}
	for _, call := range calls {
		callByID[strings.TrimSpace(call.ID)] = call
	}
	out := make([]Message, 0, len(results))
	for _, result := range results {
		callID := strings.TrimSpace(result.ToolID)
		if callID == "" {
			if call, ok := callByID[result.ToolID]; ok {
				callID = strings.TrimSpace(call.ID)
			}
		}
		payload, err := contractSafeToolResultPayload(result)
		if err != nil {
			panic(fmt.Sprintf("invalid tool result message: %v", err))
		}
		b, _ := json.Marshal(payload)
		out = append(out, Message{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: callID, Text: string(b), JSON: b}}})
	}
	return out
}

func buildToolCallMessages(calls []ToolCall, reasoning string) []Message {
	msg, ok := buildAssistantHistoryMessage("", reasoning, calls)
	if !ok {
		return nil
	}
	return []Message{msg}
}

func extractSignalText(call ToolCall, key string) string {
	if call.Args == nil {
		return ""
	}
	value := call.Args[key]
	if s, ok := value.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

func extractSignalStringList(call ToolCall, key string) []string {
	if call.Args == nil {
		return nil
	}
	raw := call.Args[key]
	switch v := raw.(type) {
	case []string:
		out := make([]string, 0, len(v))
		for _, item := range v {
			s := strings.TrimSpace(item)
			if s != "" {
				out = append(out, s)
			}
		}
		return out
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			s, _ := item.(string)
			s = strings.TrimSpace(s)
			if s != "" {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

func extractModelSignalRequestUserInputQuestions(call ToolCall, key string) ([]RequestUserInputQuestion, string) {
	if call.Args == nil {
		return nil, ""
	}
	rawItems := toAnySlice(call.Args[key])
	if len(rawItems) == 0 {
		return nil, ""
	}
	questions := make([]RequestUserInputQuestion, 0, len(rawItems))
	contractError := ""
	for _, item := range rawItems {
		record, ok := item.(map[string]any)
		if !ok || record == nil {
			continue
		}
		question, reason, ok := requestUserInputQuestionFromModelRecord(record)
		if !ok {
			if reason != "" && contractError == "" {
				contractError = reason
			}
			continue
		}
		questions = append(questions, question)
	}
	return normalizeRequestUserInputQuestions(questions), contractError
}

func normalizeAskUserOptions(options []string) []string {
	if len(options) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(options))
	out := make([]string, 0, len(options))
	for _, item := range options {
		text := truncateRunes(strings.TrimSpace(item), 120)
		if text == "" {
			continue
		}
		key := strings.ToLower(text)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, text)
		if len(out) >= 4 {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (r *run) failReplyFinish(step int, finishReason string, finalizationReason string, errMsg string) error {
	if r == nil {
		return errors.New(strings.TrimSpace(errMsg))
	}
	normalizedFinishReason := normalizeReplyFinishReason(finishReason)
	r.recordRunDiagnostic("reply.finish_rejected", RealtimeStreamKindLifecycle, map[string]any{
		"step_index":    step,
		"finish_reason": normalizedFinishReason,
		"finish_class":  string(classifyReplyFinish(normalizedFinishReason)),
	})
	if strings.TrimSpace(finalizationReason) != "" {
		r.setFinalizationReason(finalizationReason)
	}
	return r.failRun(errMsg, fmt.Errorf("provider returned finish_reason=%q", normalizedFinishReason))
}

func finalizationReasonForAskUserSource(source string) string {
	source = strings.TrimSpace(source)
	if source == "model_signal" {
		return "ask_user_waiting_model"
	}
	return ""
}

func validateAskUserSignal(signal askUserSignal) string {
	rawQuestions := append([]RequestUserInputQuestion(nil), signal.Questions...)
	signal = normalizeAskUserSignal(signal)
	if signal.ContractError != "" {
		return signal.ContractError
	}
	if strings.TrimSpace(signal.Question) == "" {
		return "empty_question"
	}
	if signal.ReasonCode == "" {
		return "missing_reason_code"
	}
	if len(signal.RequiredFromUser) == 0 {
		return "missing_required_from_user"
	}
	if reason := validateRequestUserInputQuestionsContract(rawQuestions); reason != "" {
		return reason
	}
	if len(signal.EvidenceRefs) == 0 {
		return "missing_evidence_refs"
	}
	return ""
}

func (r *run) hydrateTodoRuntimeState(ctx context.Context, state *runtimeState) (string, bool) {
	if state == nil {
		return "", false
	}

	threadID := ""
	if r != nil {
		threadID = strings.TrimSpace(r.threadID)
	}
	if r != nil && r.activeFloretHost() != nil && threadID != "" {
		readCtx := ctx
		if readCtx == nil {
			readCtx = context.Background()
		}
		if _, hasDeadline := readCtx.Deadline(); !hasDeadline {
			var cancel context.CancelFunc
			readCtx, cancel = context.WithTimeout(readCtx, 2*time.Second)
			defer cancel()
		}
		snapshot, err := r.activeFloretHost().ReadThreadAgentTodos(readCtx, flruntime.ThreadID(threadID))
		if err == nil {
			hasSnapshot := !snapshot.UpdatedAt.IsZero() || snapshot.Version > 0 || strings.TrimSpace(string(snapshot.UpdatedByRunID)) != "" || strings.TrimSpace(snapshot.UpdatedByToolCall) != ""
			if hasSnapshot {
				todos := make([]TodoItem, 0, len(snapshot.Items))
				for _, item := range snapshot.Items {
					todos = append(todos, TodoItem{ID: item.ID, Content: item.Content, Status: string(item.Status)})
				}
				summary := summarizeTodos(todos)
				actionableSummary := actionableTodoSummary(todos)
				state.TodoTrackingEnabled = true
				state.TodoTotalCount = summary.Total
				state.TodoOpenCount = actionableSummary.Pending + actionableSummary.InProgress
				state.TodoInProgressCount = actionableSummary.InProgress
				state.TodoSnapshotVersion = snapshot.Version
				return "thread_snapshot", true
			}
		}
	}
	return "", false
}

func updateTodoRuntimeState(state *runtimeState, calls []ToolCall, results []ToolResult, round int) {
	if state == nil || len(results) == 0 {
		return
	}
	callNameByID := make(map[string]string, len(calls))
	for _, call := range calls {
		id := strings.TrimSpace(call.ID)
		name := strings.TrimSpace(call.Name)
		if id == "" || name == "" {
			continue
		}
		callNameByID[id] = name
	}
	for _, result := range results {
		toolName := strings.TrimSpace(result.ToolName)
		if toolName == "" {
			toolName = callNameByID[strings.TrimSpace(result.ToolID)]
		}
		if toolName != "write_todos" || strings.TrimSpace(result.Status) != toolResultStatusSuccess {
			continue
		}
		totalCount, openCount, inProgressCount, version, ok := extractWriteTodosState(result.Data)
		if !ok {
			continue
		}
		state.TodoTrackingEnabled = true
		state.TodoTotalCount = totalCount
		state.TodoOpenCount = openCount
		state.TodoInProgressCount = inProgressCount
		state.TodoSnapshotVersion = version
		state.TodoLastUpdatedRound = round
	}
}

func extractWriteTodosState(raw any) (totalCount int, openCount int, inProgressCount int, version int64, ok bool) {
	root, ok := raw.(map[string]any)
	if !ok || root == nil {
		return 0, 0, 0, 0, false
	}
	summary, ok := root["summary"].(map[string]any)
	if !ok || summary == nil {
		return 0, 0, 0, 0, false
	}
	pending := readAnyInt(summary["pending"])
	inProgress := readAnyInt(summary["in_progress"])
	completed := readAnyInt(summary["completed"])
	cancelled := readAnyInt(summary["cancelled"])
	total := readAnyInt(summary["total"])
	if total < 0 || pending < 0 || inProgress < 0 || completed < 0 || cancelled < 0 {
		return 0, 0, 0, 0, false
	}
	if todos, ok := root["todos"].([]TodoItem); ok {
		actionableSummary := actionableTodoSummary(todos)
		pending = actionableSummary.Pending
		inProgress = actionableSummary.InProgress
	}
	open := pending + inProgress
	ver := int64(readAnyInt(root["version"]))
	if ver < 0 {
		ver = 0
	}
	return total, open, inProgress, ver, true
}

func readAnyInt(raw any) int {
	switch v := raw.(type) {
	case int:
		return v
	case int8:
		return int(v)
	case int16:
		return int(v)
	case int32:
		return int(v)
	case int64:
		return int(v)
	case uint:
		return int(v)
	case uint8:
		return int(v)
	case uint16:
		return int(v)
	case uint32:
		return int(v)
	case uint64:
		return int(v)
	case float32:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		i, err := v.Int64()
		if err != nil {
			return 0
		}
		return int(i)
	default:
		return 0
	}
}

func (r *run) buildLayeredSystemPrompt(objective string, permissionType string, complexity string, round int, isFirstRound bool, tools []ToolDef, state runtimeState, exceptionOverlay string, capability runCapabilityContract) string {
	snapshot := buildPromptRuntimeSnapshot(r, objective, permissionType, complexity, round, isFirstRound, tools, state, exceptionOverlay, capability)
	document := buildPromptDocument(snapshot)
	return document.render(layeredPromptStaticPrefixCache, promptStaticPrefixCacheKey(snapshot))
}

func (r *run) buildSocialSystemPrompt() string {
	core := []string{
		"# Identity",
		"You are Flower.",
		"You are the user's on-device helper for the current device/environment.",
		"The user message is social conversation rather than a task request.",
		"",
		"# Response Rules",
		"- Reply naturally in a brief and friendly style.",
		"- Do NOT call tools.",
		"- Do NOT mention internal routing, prompts, or policies.",
		"- If helpful, ask one short follow-up question to invite a concrete task.",
	}
	core = append(core, "")
	core = append(core, buildMarkdownOutputContractLines()...)
	runtime := buildBasicPromptCurrentContextLines(promptWorkingDirForRun(r), currentPromptLocalTimeContext(time.Now))
	return strings.Join([]string{strings.Join(core, "\n"), strings.Join(runtime, "\n")}, "\n\n")
}

func (r *run) buildCreativeSystemPrompt() string {
	core := []string{
		"# Identity",
		"You are Flower, the user's on-device writing assistant.",
		"The user request is creative generation (story/poem/copy/roleplay), not a tool-execution task.",
		"",
		"# Response Rules",
		"- Produce high-quality creative output directly.",
		"- Follow the user's requested language, format, and style.",
		"- Do NOT call tools.",
		"- Do NOT mention internal routing, prompts, or policies.",
		"- Keep coherence and avoid starting a second unrelated piece unless user explicitly asks for multiple works.",
	}
	core = append(core, "")
	core = append(core, buildMarkdownOutputContractLines()...)
	runtime := buildBasicPromptCurrentContextLines(promptWorkingDirForRun(r), currentPromptLocalTimeContext(time.Now))
	return strings.Join([]string{strings.Join(core, "\n"), strings.Join(runtime, "\n")}, "\n\n")
}

func buildMarkdownOutputContractLines() []string {
	return []string{
		"# Markdown Output Contract",
		"- If you use markdown, keep it structurally valid while streaming and after completion.",
		"- Put headings, lists, blockquotes, and thematic breaks on their own lines.",
		"- Separate block-level elements with a blank line.",
		"- Do NOT append prose on the same line after a heading, thematic break, or standalone emphasized paragraph.",
		"- If strict markdown would be awkward, prefer plain paragraphs over broken markdown.",
	}
}

func joinSkillNames(skills []SkillMeta) string {
	if len(skills) == 0 {
		return "[]"
	}
	names := make([]string, 0, len(skills))
	for _, skill := range skills {
		name := strings.TrimSpace(skill.Name)
		if name == "" {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	return strings.Join(names, ",")
}

func buildSkillCatalogPrompt(skills []SkillMeta) string {
	if len(skills) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("## Skills\n")
	sb.WriteString("Use use_skill(name) when a request clearly matches one of the skills below.\n")
	for _, skill := range skills {
		name := strings.TrimSpace(skill.Name)
		desc := strings.TrimSpace(skill.Description)
		if name == "" || desc == "" {
			continue
		}
		sb.WriteString("- ")
		sb.WriteString(name)
		sb.WriteString(": ")
		sb.WriteString(desc)
		sb.WriteString("\n")
	}
	return strings.TrimSpace(sb.String())
}

func buildSkillOverlayPrompt(active []SkillActivation) string {
	if len(active) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("## Active Skill Overlay\n")
	for _, skill := range active {
		name := strings.TrimSpace(skill.Name)
		if name == "" {
			continue
		}
		sb.WriteString("### ")
		sb.WriteString(name)
		sb.WriteString("\n")
		content := strings.TrimSpace(skill.Content)
		if content == "" {
			sb.WriteString("(no content)\n")
			continue
		}
		sb.WriteString(truncateRunes(content, 1200))
		sb.WriteString("\n")
	}
	return strings.TrimSpace(sb.String())
}

func joinToolNames(tools []ToolDef) string {
	if len(tools) == 0 {
		return "[]"
	}
	names := make([]string, 0, len(tools))
	for _, tool := range tools {
		if name := strings.TrimSpace(tool.Name); name != "" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return strings.Join(names, ",")
}

func joinToolAndSignalNames(tools []string, signals []string) string {
	names := make([]string, 0, len(tools)+len(signals))
	seen := make(map[string]struct{}, len(tools)+len(signals))
	for _, source := range [][]string{tools, signals} {
		for _, rawName := range source {
			name := strings.TrimSpace(rawName)
			if name == "" {
				continue
			}
			if _, ok := seen[name]; ok {
				continue
			}
			seen[name] = struct{}{}
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		return "[]"
	}
	sort.Strings(names)
	return strings.Join(names, ",")
}

func (r *run) waitForTaskCompleteConfirm(ctx context.Context, resultText string) (bool, error) {
	if r == nil {
		return false, errors.New("nil run")
	}
	toolID, err := newToolID()
	if err != nil {
		return false, err
	}
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeToolApprovalRequested,
		ToolID:     toolID,
		ToolName:   "task_complete",
		ObservedAt: time.Now(),
		Metadata: map[string]any{
			"approval_id": toolID,
		},
	})

	ch := make(chan bool, 1)
	promoted := make(chan struct{})
	r.mu.Lock()
	r.toolApprovals[toolID] = &toolApprovalRequest{
		decision:      ch,
		promoted:      promoted,
		toolName:      "task_complete",
		requestedAtMs: time.Now().UnixMilli(),
	}
	r.mu.Unlock()
	if r.service == nil {
		r.promoteToolApproval(toolID)
	}
	r.publishControlConfirmationRequested(toolID)
	defer func() {
		r.mu.Lock()
		delete(r.toolApprovals, toolID)
		r.mu.Unlock()
	}()
	select {
	case <-promoted:
	case <-ctx.Done():
		r.publishToolApprovalResolved(toolID, FlowerApprovalStateCanceled, ctx.Err().Error())
		return false, ctx.Err()
	}

	timeout := r.toolApprovalTO
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case approved := <-ch:
		if approved {
			r.recordObservationActivityEvent(observation.Event{
				Type:       observation.EventTypeToolApprovalApproved,
				ToolID:     toolID,
				ToolName:   "task_complete",
				ObservedAt: time.Now(),
				Metadata: map[string]any{
					"approval_id": toolID,
				},
			})
			return true, nil
		}
		r.recordObservationActivityEvent(observation.Event{
			Type:       observation.EventTypeToolApprovalRejected,
			ToolID:     toolID,
			ToolName:   "task_complete",
			Error:      "Rejected by user",
			ObservedAt: time.Now(),
			Metadata: map[string]any{
				"approval_id": toolID,
			},
		})
		return false, nil
	case <-ctx.Done():
		r.publishToolApprovalResolved(toolID, FlowerApprovalStateCanceled, ctx.Err().Error())
		return false, ctx.Err()
	case <-timer.C:
		r.recordObservationActivityEvent(observation.Event{
			Type:       observation.EventTypeToolApprovalTimedOut,
			ToolID:     toolID,
			ToolName:   "task_complete",
			Error:      "Approval timed out",
			ObservedAt: time.Now(),
			Metadata: map[string]any{
				"approval_id": toolID,
			},
		})
		r.publishToolApprovalResolved(toolID, FlowerApprovalStateTimedOut, "approval timed out")
		return false, errors.New("approval timed out")
	}
}

func (r *run) persistAskUserWaitingPrompt(signal askUserSignal, _ string, toolID string) (string, int) {
	if r == nil {
		return "", 0
	}
	signal = normalizeAskUserSignal(signal)
	questions := normalizeRequestUserInputQuestions(signal.Questions)
	if len(questions) == 0 {
		return "", 0
	}
	question := strings.TrimSpace(signal.Question)
	if question == "" {
		question = strings.TrimSpace(questions[0].Question)
	}
	if question == "" {
		return "", 0
	}
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		id, err := newToolID()
		if err != nil {
			return "", 0
		}
		toolID = id
	}
	prompt := normalizeRequestUserInputPrompt(&RequestUserInputPrompt{
		MessageID:          strings.TrimSpace(r.messageID),
		ToolID:             toolID,
		ToolName:           "ask_user",
		ReasonCode:         signal.ReasonCode,
		ReasoningSelection: r.currentReasoning,
		RequiredFromUser:   append([]string(nil), signal.RequiredFromUser...),
		EvidenceRefs:       append([]string(nil), signal.EvidenceRefs...),
		Questions:          questions,
	})
	if prompt == nil {
		return "", 0
	}
	r.setWaitingPrompt(prompt)
	return toolID, len(questions)
}

func requestUserInputQuestionChoiceCount(questions []RequestUserInputQuestion) int {
	total := 0
	for _, question := range normalizeRequestUserInputQuestions(questions) {
		total += len(question.Choices)
	}
	return total
}

func extractOpenAIResponseText(resp oresponses.Response) string {
	var sb strings.Builder
	for _, item := range resp.Output {
		if strings.TrimSpace(item.Type) != "message" {
			continue
		}
		msg := item.AsMessage()
		for _, part := range msg.Content {
			if strings.TrimSpace(part.Type) != "output_text" {
				continue
			}
			if sb.Len() > 0 {
				sb.WriteString("\n")
			}
			sb.WriteString(strings.TrimSpace(part.Text))
		}
	}
	return sb.String()
}

func extractOpenAIURLSources(resp oresponses.Response) []SourceRef {
	out := make([]SourceRef, 0, 8)
	seen := make(map[string]struct{}, 8)
	for _, item := range resp.Output {
		if strings.TrimSpace(item.Type) != "message" {
			continue
		}
		for _, part := range item.Content {
			if strings.TrimSpace(part.Type) != "output_text" {
				continue
			}
			for _, ann := range part.Annotations {
				if strings.TrimSpace(ann.Type) != "url_citation" {
					continue
				}
				u := strings.TrimSpace(ann.URL)
				if u == "" {
					continue
				}
				if _, ok := seen[u]; ok {
					continue
				}
				seen[u] = struct{}{}
				out = append(out, SourceRef{Title: strings.TrimSpace(ann.Title), URL: u})
			}
		}
	}
	return out
}

func mapOpenAIStatus(status oresponses.ResponseStatus) string {
	switch strings.TrimSpace(strings.ToLower(string(status))) {
	case "":
		return "stop"
	case "completed":
		return "stop"
	case "incomplete":
		return "length"
	case "failed":
		return "error"
	case "cancelled":
		return "error"
	default:
		return "unknown"
	}
}

func mapAnthropicStopReason(reason anthropic.StopReason) string {
	switch strings.TrimSpace(strings.ToLower(string(reason))) {
	case "tool_use":
		return "tool_calls"
	case "end_turn", "stop_sequence":
		return "stop"
	case "max_tokens":
		return "length"
	case "refusal":
		return "content_filter"
	default:
		return "unknown"
	}
}

func sanitizeProviderToolName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	var sb strings.Builder
	for _, ch := range name {
		switch {
		case ch >= 'a' && ch <= 'z':
			sb.WriteRune(ch)
		case ch >= 'A' && ch <= 'Z':
			sb.WriteRune(ch)
		case ch >= '0' && ch <= '9':
			sb.WriteRune(ch)
		case ch == '_' || ch == '-':
			sb.WriteRune(ch)
		case ch == '.':
			sb.WriteRune('_')
		default:
			sb.WriteRune('_')
		}
	}
	out := strings.Trim(sb.String(), "_-")
	if out == "" {
		return "tool"
	}
	if strings.TrimSpace(name) == "web.search" && out == "web_search" {
		// Avoid colliding with provider-hosted web_search tool namespaces.
		return "web_search_tool"
	}
	return out
}

func canonicalProviderToolName(name string, aliasToReal map[string]string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	if realName, ok := aliasToReal[name]; ok {
		return strings.TrimSpace(realName)
	}
	return name
}

func toStringSlice(raw any) ([]string, bool) {
	switch v := raw.(type) {
	case []string:
		out := make([]string, 0, len(v))
		for _, item := range v {
			s := strings.TrimSpace(item)
			if s != "" {
				out = append(out, s)
			}
		}
		return out, true
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			s, _ := item.(string)
			s = strings.TrimSpace(s)
			if s != "" {
				out = append(out, s)
			}
		}
		return out, true
	default:
		return nil, false
	}
}
