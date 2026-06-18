package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	aoption "github.com/anthropics/anthropic-sdk-go/option"
	"github.com/floegence/floret/observation"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	openai "github.com/openai/openai-go"
	ooption "github.com/openai/openai-go/option"
	"github.com/openai/openai-go/packages/param"
	oresponses "github.com/openai/openai-go/responses"
	oshared "github.com/openai/openai-go/shared"
)

const (
	nativeDefaultMaxOutputTokens            = 4096
	nativeDefaultCompactThreshold           = 0.80
	nativeMinCompactThreshold               = 0.65
	nativeMaxCompactThreshold               = 0.90
	nativeDefaultContextLimit               = 128000
	nativeToolResultPruneBudget             = 50000
	nativeToolResultPruneRunes              = 480
	nativeToolResultKeepTurns               = 2
	providerContinuationKindOpenAIResponses = "openai_responses"
	nativeHardMaxToolCalls                  = 200
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
}

func (p *openAIProvider) StreamTurn(ctx context.Context, req TurnRequest, onEvent func(StreamEvent)) (TurnResult, error) {
	if p == nil {
		return TurnResult{}, errors.New("nil provider")
	}
	if strings.TrimSpace(req.Model) == "" {
		return TurnResult{}, errors.New("missing model")
	}
	if p.forceChat {
		return p.streamChatTurn(ctx, req, onEvent)
	}

	params := oresponses.ResponseNewParams{
		Model:             oshared.ResponsesModel(strings.TrimSpace(req.Model)),
		MaxOutputTokens:   openai.Int(nativeDefaultMaxOutputTokens),
		ParallelToolCalls: openai.Bool(false),
	}
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
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallStart, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.CallID), Name: strings.TrimSpace(pc.Name)}})
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
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallDelta, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.CallID), Name: strings.TrimSpace(pc.Name), ArgumentsJSON: raw, Arguments: cloneAnyMap(args)}})
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
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallEnd, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.CallID), Name: strings.TrimSpace(pc.Name), Arguments: cloneAnyMap(args)}})
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
			name := strings.TrimSpace(item.Name)
			if realName, ok := aliasToReal[name]; ok {
				name = realName
			}
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
			name := strings.TrimSpace(item.Name)
			if realName, ok := aliasToReal[name]; ok {
				name = realName
			}
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
		return TurnResult{}, err
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
		return TurnResult{}, errors.New("missing response.completed event")
	}

	result := TurnResult{
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
			result.ProviderState = &TurnProviderState{
				ContinuationKind: providerContinuationKindOpenAIResponses,
				ContinuationID:   rid,
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
			Call:        ToolCall{ID: id, Name: strings.TrimSpace(pc.Name), Args: cloneAnyMap(pc.Args)},
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
			toolName := strings.TrimSpace(item.Name)
			if realName, ok := aliasToReal[toolName]; ok {
				toolName = realName
			}
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

func (p *openAIProvider) streamChatTurn(ctx context.Context, req TurnRequest, onEvent func(StreamEvent)) (TurnResult, error) {
	if p == nil {
		return TurnResult{}, errors.New("nil provider")
	}
	if strings.TrimSpace(req.Model) == "" {
		return TurnResult{}, errors.New("missing model")
	}

	messages := buildOpenAIChatMessages(req.Messages)
	if len(messages) == 0 {
		messages = append(messages, openai.UserMessage("Continue."))
	}

	params := openai.ChatCompletionNewParams{
		Model:             oshared.ChatModel(strings.TrimSpace(req.Model)),
		Messages:          messages,
		ParallelToolCalls: openai.Bool(false),
		StreamOptions:     openai.ChatCompletionStreamOptionsParam{IncludeUsage: openai.Bool(true)},
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
	case "text":
		txt := oshared.NewResponseFormatTextParam()
		params.ResponseFormat = openai.ChatCompletionNewParamsResponseFormatUnion{OfText: &txt}
	case "json_object":
		obj := oshared.NewResponseFormatJSONObjectParam()
		params.ResponseFormat = openai.ChatCompletionNewParamsResponseFormatUnion{OfJSONObject: &obj}
	}

	tools, aliasToReal := buildOpenAIChatTools(req.Tools, p.strictToolSchema)
	decorateChatCompletionParams(&params, req.WebSearchMode, req.ProviderControls.DisableReasoning, &tools)
	if len(tools) > 0 {
		params.Tools = tools
	}

	stream := p.client.Chat.Completions.NewStreaming(ctx, params)
	var textBuf strings.Builder
	result := TurnResult{
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
		name := strings.TrimSpace(pc.Name)
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
		name := strings.TrimSpace(pc.Name)
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
		name := strings.TrimSpace(pc.Name)
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
				name := strings.TrimSpace(tc.Function.Name)
				if realName, ok := aliasToReal[name]; ok {
					name = realName
				}
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
		return TurnResult{}, err
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
		result.ToolCalls = append(result.ToolCalls, ToolCall{ID: ensureCallID(pc), Name: strings.TrimSpace(pc.Name), Args: cloneAnyMap(pc.Args)})
	}
	result.Text = strings.TrimSpace(textBuf.String())
	if len(result.ToolCalls) > 0 {
		result.FinishReason = "tool_calls"
	}
	if result.FinishReason == "unknown" && result.Text != "" {
		result.FinishReason = "stop"
	}
	if result.Text == "" && len(result.ToolCalls) == 0 {
		return TurnResult{}, errors.New("missing streamed response")
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

func (p *moonshotProvider) StreamTurn(ctx context.Context, req TurnRequest, onEvent func(StreamEvent)) (TurnResult, error) {
	if p == nil {
		return TurnResult{}, errors.New("nil provider")
	}
	if strings.TrimSpace(req.Model) == "" {
		return TurnResult{}, errors.New("missing model")
	}

	messages := buildOpenAIChatMessages(req.Messages)
	if len(messages) == 0 {
		messages = append(messages, openai.UserMessage("Continue."))
	}

	params := openai.ChatCompletionNewParams{
		Model:             oshared.ChatModel(strings.TrimSpace(req.Model)),
		Messages:          messages,
		ParallelToolCalls: openai.Bool(false),
		StreamOptions:     openai.ChatCompletionStreamOptionsParam{IncludeUsage: openai.Bool(true)},
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
	decorateChatCompletionParams(&params, req.WebSearchMode, req.ProviderControls.DisableReasoning, &tools)
	if len(tools) > 0 {
		params.Tools = tools
	}

	stream := p.client.Chat.Completions.NewStreaming(ctx, params)
	var textBuf strings.Builder
	var reasoningBuf strings.Builder
	result := TurnResult{
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
		name := strings.TrimSpace(pc.Name)
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
		name := strings.TrimSpace(pc.Name)
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
		name := strings.TrimSpace(pc.Name)
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
				name := strings.TrimSpace(tc.Function.Name)
				if realName, ok := aliasToReal[name]; ok {
					name = realName
				}
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
		return TurnResult{}, err
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
			Name: strings.TrimSpace(pc.Name),
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
		return TurnResult{}, errors.New("missing streamed response")
	}
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventUsage, Usage: &PartialUsage{
		InputTokens:     result.Usage.InputTokens,
		OutputTokens:    result.Usage.OutputTokens,
		ReasoningTokens: result.Usage.ReasoningTokens,
	}})
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventFinishReason, FinishHint: result.FinishReason})
	return result, nil
}

func (p *moonshotProvider) Turn(ctx context.Context, req TurnRequest) (TurnResult, error) {
	if p == nil {
		return TurnResult{}, errors.New("nil provider")
	}
	if strings.TrimSpace(req.Model) == "" {
		return TurnResult{}, errors.New("missing model")
	}

	messages := buildOpenAIChatMessages(req.Messages)
	if len(messages) == 0 {
		messages = append(messages, openai.UserMessage("Continue."))
	}

	params := openai.ChatCompletionNewParams{
		Model:             oshared.ChatModel(strings.TrimSpace(req.Model)),
		Messages:          messages,
		ParallelToolCalls: openai.Bool(false),
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
	decorateChatCompletionParams(&params, req.WebSearchMode, req.ProviderControls.DisableReasoning, &tools)
	if len(tools) > 0 {
		params.Tools = tools
	}

	completion, err := p.client.Chat.Completions.New(ctx, params)
	if err != nil {
		return TurnResult{}, err
	}
	result := TurnResult{
		FinishReason:    "unknown",
		RawProviderDiag: map[string]any{"response_id": strings.TrimSpace(completion.ID)},
		Usage: TurnUsage{
			InputTokens:     completion.Usage.PromptTokens,
			OutputTokens:    completion.Usage.CompletionTokens,
			ReasoningTokens: completion.Usage.CompletionTokensDetails.ReasoningTokens,
		},
	}
	if len(completion.Choices) == 0 {
		return TurnResult{}, errors.New("missing completion choices")
	}
	choice := completion.Choices[0]
	result.FinishReason = mapOpenAIChatFinishReason(string(choice.FinishReason))
	result.Text = strings.TrimSpace(choice.Message.Content)
	result.Reasoning = strings.TrimSpace(extractMoonshotReasoningJSON(choice.Message.RawJSON()))
	for _, tc := range choice.Message.ToolCalls {
		name := strings.TrimSpace(tc.Function.Name)
		if realName, ok := aliasToReal[name]; ok {
			name = realName
		}
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
		return TurnResult{}, errors.New("missing completion content")
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

func decorateChatCompletionParams(params *openai.ChatCompletionNewParams, webSearchMode string, disableReasoning bool, tools *[]openai.ChatCompletionToolParam) {
	if params == nil {
		return
	}
	extraFields := map[string]any{}
	if disableReasoning {
		extraFields["thinking"] = map[string]any{"type": "disabled"}
		extraFields["enable_thinking"] = false
	}
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
		extraFields["thinking"] = map[string]any{"type": "disabled"}
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
		extraFields["enable_search"] = true
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
					if uri := strings.TrimSpace(part.FileURI); uri != "" {
						contentParts = append(contentParts, openai.TextContentPart("Attachment reference: "+uri))
					}
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

func (p *anthropicProvider) StreamTurn(ctx context.Context, req TurnRequest, onEvent func(StreamEvent)) (TurnResult, error) {
	if p == nil {
		return TurnResult{}, errors.New("nil provider")
	}
	if strings.TrimSpace(req.Model) == "" {
		return TurnResult{}, errors.New("missing model")
	}
	tools, aliasToReal := buildAnthropicTools(req.Tools)
	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(strings.TrimSpace(req.Model)),
		MaxTokens: nativeDefaultMaxOutputTokens,
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
	if req.ProviderControls.ThinkingBudgetTokens >= 1024 && int64(req.ProviderControls.ThinkingBudgetTokens) < params.MaxTokens {
		params.Thinking = anthropic.ThinkingConfigParamOfEnabled(int64(req.ProviderControls.ThinkingBudgetTokens))
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
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallStart, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.ID), Name: strings.TrimSpace(pc.Name)}})
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
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallDelta, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.ID), Name: strings.TrimSpace(pc.Name), ArgumentsJSON: raw, Arguments: cloneAnyMap(args)}})
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
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallEnd, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.ID), Name: strings.TrimSpace(pc.Name), Arguments: cloneAnyMap(args)}})
	}

	for stream.Next() {
		event := stream.Current()
		if err := msg.Accumulate(event); err != nil {
			return TurnResult{}, err
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
			toolName := strings.TrimSpace(variant.ContentBlock.Name)
			if realName, ok := aliasToReal[toolName]; ok {
				toolName = realName
			}
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
		return TurnResult{}, err
	}

	result := TurnResult{
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
		result.ToolCalls = append(result.ToolCalls, ToolCall{ID: id, Name: strings.TrimSpace(pc.Name), Args: cloneAnyMap(pc.Args)})
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
			toolName := strings.TrimSpace(variant.Name)
			if realName, ok := aliasToReal[toolName]; ok {
				toolName = realName
			}
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

func (r *run) shouldUseNativeRuntime(provider *config.AIProvider) bool {
	if r == nil || provider == nil {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(provider.Type)) {
	case "openai", "anthropic", "moonshot", "chatglm", "deepseek", "qwen", "openai_compatible", DesktopModelSourceProviderType:
		return true
	default:
		return false
	}
}

func newProviderAdapter(providerType string, baseURL string, apiKey string, strictToolSchemaOverride *bool) (Provider, error) {
	providerType = strings.ToLower(strings.TrimSpace(providerType))
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("missing provider api key")
	}
	strictToolSchema := resolveStrictToolSchema(providerType, baseURL, strictToolSchemaOverride)
	switch providerType {
	case "openai":
		opts := []ooption.RequestOption{ooption.WithAPIKey(strings.TrimSpace(apiKey))}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, ooption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &openAIProvider{
			client:           openai.NewClient(opts...),
			strictToolSchema: strictToolSchema,
		}, nil
	case "openai_compatible":
		opts := []ooption.RequestOption{ooption.WithAPIKey(strings.TrimSpace(apiKey))}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, ooption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &openAIProvider{
			client:           openai.NewClient(opts...),
			strictToolSchema: strictToolSchema,
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
		}, nil
	case "qwen":
		opts := []ooption.RequestOption{ooption.WithAPIKey(strings.TrimSpace(apiKey))}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, ooption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &openAIProvider{
			client:           openai.NewClient(opts...),
			strictToolSchema: strictToolSchema,
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

func resolveStrictToolSchema(providerType string, baseURL string, override *bool) bool {
	if override != nil {
		return *override
	}
	return shouldUseStrictOpenAIToolSchema(providerType, baseURL)
}

func shouldUseStrictOpenAIToolSchema(providerType string, baseURL string) bool {
	providerType = strings.ToLower(strings.TrimSpace(providerType))
	if providerType == "openai_compatible" || providerType == "chatglm" || providerType == "deepseek" || providerType == "qwen" {
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

func buildInitialMessages(history []RunHistoryMsg, userInput string) []Message {
	messages := make([]Message, 0, len(history)+1)
	for _, msg := range history {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		if role != "assistant" && role != "user" {
			continue
		}
		text := strings.TrimSpace(msg.Text)
		if text == "" {
			continue
		}
		messages = append(messages, Message{Role: role, Content: []ContentPart{{Type: "text", Text: text}}})
	}
	if txt := strings.TrimSpace(userInput); txt != "" {
		messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: txt}}})
	}
	return messages
}

func buildMessagesForRun(req RunRequest) []Message {
	if strings.TrimSpace(req.ContextPack.ThreadID) != "" {
		return buildMessagesFromPromptPack(req.ContextPack, req.Input.Text)
	}
	messages := buildInitialMessages(req.History, req.Input.Text)
	if len(req.Input.Attachments) > 0 {
		for _, it := range req.Input.Attachments {
			if strings.TrimSpace(it.URL) == "" {
				continue
			}
			messages = append(messages, Message{
				Role: "user",
				Content: []ContentPart{{
					Type:     "file",
					FileURI:  strings.TrimSpace(it.URL),
					MimeType: strings.TrimSpace(it.MimeType),
					Text:     strings.TrimSpace(it.Name),
				}},
			})
		}
	}
	return messages
}

func buildResumeMessagesForRun(req RunRequest) []Message {
	if strings.TrimSpace(req.ContextPack.ThreadID) != "" {
		return buildMessagesFromPromptPackWithOptions(req.ContextPack, req.Input.Text, promptPackMessageBuildOptions{
			IncludeRecentDialogue: false,
		})
	}
	messages := make([]Message, 0, 1+len(req.Input.Attachments))
	if txt := strings.TrimSpace(req.Input.Text); txt != "" {
		messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: txt}}})
	}
	for _, it := range req.Input.Attachments {
		if strings.TrimSpace(it.URL) == "" {
			continue
		}
		messages = append(messages, Message{
			Role: "user",
			Content: []ContentPart{{
				Type:     "file",
				FileURI:  strings.TrimSpace(it.URL),
				MimeType: strings.TrimSpace(it.MimeType),
				Text:     strings.TrimSpace(it.Name),
			}},
		})
	}
	return messages
}

func buildMessagesFromPromptPack(pack contextmodel.PromptPack, currentUserInput string) []Message {
	return buildMessagesFromPromptPackWithOptions(pack, currentUserInput, promptPackMessageBuildOptions{
		IncludeRecentDialogue: true,
	})
}

type promptPackMessageBuildOptions struct {
	IncludeRecentDialogue bool
}

func buildMessagesFromPromptPackWithOptions(pack contextmodel.PromptPack, currentUserInput string, opts promptPackMessageBuildOptions) []Message {
	messages := make([]Message, 0, len(pack.RecentDialogue)*2+8)
	if txt := strings.TrimSpace(pack.SystemContract); txt != "" {
		messages = append(messages, Message{Role: "system", Content: []ContentPart{{Type: "text", Text: txt}}})
	}

	contextParts := make([]string, 0, 8)
	if txt := strings.TrimSpace(pack.Objective); txt != "" {
		contextParts = append(contextParts, "Objective: "+txt)
	}
	if len(pack.ActiveConstraints) > 0 {
		contextParts = append(contextParts, "Active constraints:")
		for _, c := range pack.ActiveConstraints {
			c = strings.TrimSpace(c)
			if c == "" {
				continue
			}
			contextParts = append(contextParts, "- "+c)
		}
	}
	if txt := strings.TrimSpace(pack.ThreadSnapshot); txt != "" {
		contextParts = append(contextParts, "Thread snapshot:")
		contextParts = append(contextParts, txt)
	}
	if len(contextParts) > 0 {
		messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: strings.Join(contextParts, "\n")}}})
	}

	if txt := renderUserProvidedContext(pack.UserProvidedContext); txt != "" {
		messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: txt}}})
	}

	if opts.IncludeRecentDialogue {
		for _, turn := range pack.RecentDialogue {
			if txt := strings.TrimSpace(turn.UserText); txt != "" {
				messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: txt}}})
			}
			if txt := strings.TrimSpace(turn.AssistantText); txt != "" {
				messages = append(messages, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: txt}}})
			}
		}
	}

	if len(pack.RecentStructuredUserInputs) > 0 {
		parts := make([]string, 0, len(pack.RecentStructuredUserInputs))
		for _, item := range pack.RecentStructuredUserInputs {
			line := strings.TrimSpace(item.PublicSummary)
			if line == "" {
				line = strings.TrimSpace(item.Question)
			}
			if line == "" {
				continue
			}
			parts = append(parts, "- "+line)
		}
		if len(parts) > 0 {
			messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "Recent structured user inputs:\n" + strings.Join(parts, "\n")}}})
		}
	}

	if len(pack.ExecutionEvidence) > 0 {
		parts := make([]string, 0, len(pack.ExecutionEvidence))
		for _, ev := range pack.ExecutionEvidence {
			line := strings.TrimSpace(ev.Summary)
			if line == "" {
				line = strings.TrimSpace(ev.Name)
			}
			if line == "" {
				continue
			}
			parts = append(parts, "- "+line)
		}
		if len(parts) > 0 {
			messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "Execution evidence:\n" + strings.Join(parts, "\n")}}})
		}
	}

	if len(pack.PendingTodos) > 0 {
		parts := make([]string, 0, len(pack.PendingTodos))
		for _, item := range pack.PendingTodos {
			txt := strings.TrimSpace(item.Content)
			if txt == "" {
				continue
			}
			parts = append(parts, "- "+txt)
		}
		if len(parts) > 0 {
			messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "Pending todos:\n" + strings.Join(parts, "\n")}}})
		}
	}

	if len(pack.Blockers) > 0 {
		parts := make([]string, 0, len(pack.Blockers))
		for _, item := range pack.Blockers {
			txt := strings.TrimSpace(item.Content)
			if txt == "" {
				continue
			}
			parts = append(parts, "- "+txt)
		}
		if len(parts) > 0 {
			messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "Blockers:\n" + strings.Join(parts, "\n")}}})
		}
	}

	if len(pack.RetrievedLongTermMemory) > 0 {
		parts := make([]string, 0, len(pack.RetrievedLongTermMemory))
		for _, item := range pack.RetrievedLongTermMemory {
			txt := strings.TrimSpace(item.Content)
			if txt == "" {
				continue
			}
			parts = append(parts, "- "+txt)
		}
		if len(parts) > 0 {
			messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "Long-term memory:\n" + strings.Join(parts, "\n")}}})
		}
	}

	for _, att := range pack.AttachmentsManifest {
		url := strings.TrimSpace(att.URL)
		if url == "" {
			continue
		}
		mode := strings.ToLower(strings.TrimSpace(att.Mode))
		if mode == "text_reference" {
			reference := strings.TrimSpace(att.Name)
			if reference == "" {
				reference = url
			}
			msg := "Attachment reference: " + reference
			if reference != url {
				msg += " (" + url + ")"
			}
			messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: msg}}})
			continue
		}
		messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "file", FileURI: url, MimeType: strings.TrimSpace(att.MimeType), Text: strings.TrimSpace(att.Name)}}})
	}

	if txt := strings.TrimSpace(currentUserInput); txt != "" {
		messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: txt}}})
	}
	return messages
}

func renderUserProvidedContext(ctx *contextmodel.UserProvidedContext) string {
	if ctx == nil {
		return ""
	}
	parts := []string{"User-provided context:"}
	meta := make([]string, 0, 6)
	if txt := strings.TrimSpace(ctx.ActionID); txt != "" {
		meta = append(meta, "action="+txt)
	}
	if txt := strings.TrimSpace(ctx.Provider); txt != "" {
		meta = append(meta, "provider="+txt)
	}
	if txt := strings.TrimSpace(ctx.SourceSurface); txt != "" {
		meta = append(meta, "surface="+txt)
	}
	if txt := strings.TrimSpace(ctx.SourceSurfaceID); txt != "" {
		meta = append(meta, "surface_id="+txt)
	}
	if txt := strings.TrimSpace(ctx.TargetID); txt != "" {
		meta = append(meta, "target.target_id="+txt)
	}
	if txt := strings.TrimSpace(ctx.Locality); txt != "" {
		meta = append(meta, "target.locality="+txt)
	}
	if txt := strings.TrimSpace(ctx.CurrentTargetID); txt != "" {
		meta = append(meta, "execution_context.current_target_id="+txt)
	}
	if txt := strings.TrimSpace(ctx.SourceEnvPublicID); txt != "" {
		meta = append(meta, "execution_context.source_env_public_id="+txt)
	}
	if txt := strings.TrimSpace(ctx.RuntimeHint); txt != "" {
		meta = append(meta, "execution_context.runtime_hint="+txt)
	}
	if txt := strings.TrimSpace(ctx.SessionSource); txt != "" {
		meta = append(meta, "execution_context.session_source="+txt)
	}
	if len(meta) > 0 {
		parts = append(parts, "- "+strings.Join(meta, ", "))
	}
	if txt := strings.TrimSpace(ctx.SuggestedWorkingDir); txt != "" {
		parts = append(parts, "- suggested_working_dir="+txt)
	}
	for _, item := range ctx.Items {
		if txt := renderUserProvidedContextItem(item); txt != "" {
			parts = append(parts, txt)
		}
	}
	if len(parts) == 1 {
		return ""
	}
	return strings.Join(parts, "\n")
}

func renderUserProvidedContextItem(item contextmodel.UserProvidedContextItem) string {
	kind := strings.TrimSpace(item.Kind)
	if kind == "" {
		return ""
	}
	lines := []string{"- item kind=" + kind}
	if txt := strings.TrimSpace(item.Title); txt != "" {
		lines = append(lines, "  title: "+txt)
	}
	if txt := strings.TrimSpace(item.Detail); txt != "" {
		lines = append(lines, "  detail: "+txt)
	}
	if txt := strings.TrimSpace(item.Path); txt != "" {
		pathLine := "  path: " + txt
		if item.IsDirectory {
			pathLine += " (directory)"
		}
		lines = append(lines, pathLine)
	}
	if txt := strings.TrimSpace(item.RootLabel); txt != "" {
		lines = append(lines, "  root: "+txt)
	}
	if txt := strings.TrimSpace(item.WorkingDir); txt != "" {
		lines = append(lines, "  working_dir: "+txt)
	}
	if txt := strings.TrimSpace(item.Selection); txt != "" {
		lines = append(lines, "  selection: "+txt)
	}
	if item.SelectionChars > 0 {
		lines = append(lines, fmt.Sprintf("  selection_chars: %d", item.SelectionChars))
	}
	if item.PID > 0 {
		lines = append(lines, fmt.Sprintf("  pid: %d", item.PID))
	}
	if txt := strings.TrimSpace(item.Name); txt != "" {
		lines = append(lines, "  name: "+txt)
	}
	if txt := strings.TrimSpace(item.Username); txt != "" {
		lines = append(lines, "  username: "+txt)
	}
	if item.CPUPercent != 0 {
		lines = append(lines, fmt.Sprintf("  cpu_percent: %.2f", item.CPUPercent))
	}
	if item.MemoryBytes > 0 {
		lines = append(lines, fmt.Sprintf("  memory_bytes: %d", item.MemoryBytes))
	}
	if txt := strings.TrimSpace(item.Platform); txt != "" {
		lines = append(lines, "  platform: "+txt)
	}
	if item.CapturedAtMs > 0 {
		lines = append(lines, fmt.Sprintf("  captured_at_ms: %d", item.CapturedAtMs))
	}
	if txt := strings.TrimSpace(item.Content); txt != "" {
		lines = append(lines, "  content:\n"+indentText(txt, "    "))
	}
	return strings.Join(lines, "\n")
}

func indentText(text string, prefix string) string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	for i, line := range lines {
		lines[i] = prefix + line
	}
	return strings.Join(lines, "\n")
}

type providerTurnResumeState struct {
	Enabled            bool
	PreviousResponseID string
	SkipReason         string
}

func canonicalProviderContinuationBaseURL(providerType string, baseURL string) string {
	providerType = strings.ToLower(strings.TrimSpace(providerType))
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL != "" {
		return baseURL
	}
	if providerType == "openai" {
		return "https://api.openai.com/v1"
	}
	return ""
}

func isOpenAIResponsesProviderContinuationEnabled(providerType string) bool {
	return strings.EqualFold(strings.TrimSpace(providerType), "openai")
}

func isOpenAIContinuationRejection(err error) bool {
	if err == nil {
		return false
	}
	var apiErr *openai.Error
	if !errors.As(err, &apiErr) || apiErr == nil {
		return false
	}
	if apiErr.StatusCode != http.StatusBadRequest && apiErr.StatusCode != http.StatusNotFound {
		return false
	}
	payload := strings.ToLower(strings.Join([]string{
		strings.TrimSpace(apiErr.Code),
		strings.TrimSpace(apiErr.Param),
		strings.TrimSpace(apiErr.Type),
		strings.TrimSpace(apiErr.Message),
	}, " "))
	if strings.Contains(payload, "previous_response_id") {
		return true
	}
	if strings.Contains(payload, "response_id") && (strings.Contains(payload, "invalid") || strings.Contains(payload, "not found") || strings.Contains(payload, "expired")) {
		return true
	}
	return false
}

func buildProviderContinuationCandidate(providerID string, providerType string, modelName string, baseURL string, state *TurnProviderState) threadstore.ThreadProviderContinuation {
	if state == nil {
		return threadstore.ThreadProviderContinuation{}
	}
	kind := strings.TrimSpace(state.ContinuationKind)
	continuationID := strings.TrimSpace(state.ContinuationID)
	if kind == "" || continuationID == "" {
		return threadstore.ThreadProviderContinuation{}
	}
	return threadstore.ThreadProviderContinuation{
		Kind:            kind,
		ContinuationID:  continuationID,
		ProviderID:      strings.TrimSpace(providerID),
		Model:           strings.TrimSpace(modelName),
		BaseURL:         canonicalProviderContinuationBaseURL(providerType, baseURL),
		UpdatedAtUnixMs: time.Now().UnixMilli(),
	}.Normalized()
}

func (r *run) loadProviderTurnResumeState(ctx context.Context, providerCfg config.AIProvider, providerType string, modelName string) (providerTurnResumeState, error) {
	state := providerTurnResumeState{}
	if r == nil || r.threadsDB == nil {
		state.SkipReason = "thread_store_unavailable"
		return state, nil
	}
	if strings.TrimSpace(r.endpointID) == "" || strings.TrimSpace(r.threadID) == "" {
		state.SkipReason = "thread_identity_missing"
		return state, nil
	}
	if !isOpenAIResponsesProviderContinuationEnabled(providerType) {
		state.SkipReason = "provider_not_supported"
		return state, nil
	}
	continuation, err := r.threadsDB.GetThreadProviderContinuation(ctx, strings.TrimSpace(r.endpointID), strings.TrimSpace(r.threadID))
	if err != nil {
		return state, err
	}
	if continuation == nil || continuation.IsZero() {
		state.SkipReason = "thread_state_missing"
		return state, nil
	}
	if continuation.Kind != providerContinuationKindOpenAIResponses {
		state.SkipReason = "kind_mismatch"
		return state, nil
	}
	if continuation.ProviderID != strings.TrimSpace(providerCfg.ID) {
		state.SkipReason = "provider_id_mismatch"
		return state, nil
	}
	if continuation.Model != strings.TrimSpace(modelName) {
		state.SkipReason = "model_mismatch"
		return state, nil
	}
	if continuation.BaseURL != canonicalProviderContinuationBaseURL(providerType, providerCfg.BaseURL) {
		state.SkipReason = "base_url_mismatch"
		return state, nil
	}
	state.Enabled = true
	state.PreviousResponseID = continuation.ContinuationID
	return state, nil
}

func estimateTextTokens(text string) int {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0
	}
	return len([]rune(text))/4 + 1
}

func (r *run) emitContextCompactionEvent(eventType string, payload map[string]any) {
	if r == nil {
		return
	}
	eventType = strings.TrimSpace(eventType)
	if eventType == "" {
		return
	}
	if payload == nil {
		payload = map[string]any{}
	}
	r.persistRunEvent(eventType, RealtimeStreamKindContext, payload)
	r.sendStreamEvent(streamEventContextCompaction{
		Type:      "context-compaction",
		EventType: eventType,
		Payload:   cloneAnyMap(payload),
	})
}

func normalizeCompactionThreshold(input float64) float64 {
	if input <= 0 {
		return nativeDefaultCompactThreshold
	}
	return clampFloat(input, nativeMinCompactThreshold, nativeMaxCompactThreshold)
}

func resolveInputContextLimit(contextWindow int, maxInputTokens int) int {
	if contextWindow <= 0 {
		contextWindow = nativeDefaultContextLimit
	}
	if maxInputTokens > 0 && maxInputTokens < contextWindow {
		return maxInputTokens
	}
	return contextWindow
}

func deriveModelWindowCompactionThreshold(contextWindow int, inputContextLimit int) float64 {
	inputContextLimit = resolveInputContextLimit(contextWindow, inputContextLimit)
	contextWindow = resolveInputContextLimit(contextWindow, 0)
	if contextWindow <= 0 {
		return nativeDefaultCompactThreshold
	}
	if inputContextLimit >= contextWindow {
		return nativeMaxCompactThreshold
	}
	return clampFloat(float64(inputContextLimit)/float64(contextWindow), nativeMinCompactThreshold, nativeMaxCompactThreshold)
}

func resolveCompactionThreshold(configThreshold float64, contextWindow int, inputContextLimit int) float64 {
	cfg := normalizeCompactionThreshold(configThreshold)
	window := deriveModelWindowCompactionThreshold(contextWindow, inputContextLimit)
	if window > 0 {
		cfg = minFloat(cfg, window)
	}
	return clampFloat(cfg, nativeMinCompactThreshold, nativeMaxCompactThreshold)
}

func clampFloat(value float64, minVal float64, maxVal float64) float64 {
	if minVal > maxVal {
		minVal, maxVal = maxVal, minVal
	}
	if value < minVal {
		return minVal
	}
	if value > maxVal {
		return maxVal
	}
	return value
}

func minFloat(a float64, b float64) float64 {
	if a <= b {
		return a
	}
	return b
}

type toolResultPruneStats struct {
	PrunedParts         int
	PrunedTokensBefore  int
	PrunedTokensAfter   int
	ProtectedStartIndex int
}

func pruneToolResultPayloads(messages []Message, budgetTokens int, keepRecentUserTurns int, maxRunes int) ([]Message, toolResultPruneStats) {
	out := cloneMessages(messages)
	stats := toolResultPruneStats{}
	if len(out) == 0 || budgetTokens <= 0 || keepRecentUserTurns < 0 {
		return out, stats
	}

	protectedStart := len(out)
	userSeen := 0
	for i := len(out) - 1; i >= 0; i-- {
		if strings.EqualFold(strings.TrimSpace(out[i].Role), "user") {
			userSeen++
			if userSeen > keepRecentUserTurns {
				protectedStart = i + 1
				break
			}
		}
	}
	stats.ProtectedStartIndex = protectedStart
	if protectedStart == 0 {
		return out, stats
	}

	accumulated := 0
	for i := len(out) - 1; i >= 0; i-- {
		for j := len(out[i].Content) - 1; j >= 0; j-- {
			part := &out[i].Content[j]
			if !strings.EqualFold(strings.TrimSpace(part.Type), "tool_result") {
				continue
			}
			payload := strings.TrimSpace(part.Text)
			if payload == "" && len(part.JSON) > 0 {
				payload = strings.TrimSpace(string(part.JSON))
			}
			if payload == "" {
				payload = "{}"
			}
			payloadTokens := estimateTextTokens(payload)
			if payloadTokens <= 0 {
				payloadTokens = 1
			}
			accumulated += payloadTokens
			if i >= protectedStart || accumulated <= budgetTokens {
				continue
			}
			callID := toolCallIDFromPart(*part)
			placeholder := "[tool_result_compacted]"
			if callID != "" {
				placeholder += " call_id=" + callID
			}
			placeholder += " output moved to compressed context summary."
			trimmed, truncated := truncateByRunes(payload, maxRunes)
			if truncated {
				placeholder += "\npreview: " + trimmed + " ..."
			} else {
				placeholder += "\npreview: " + trimmed
			}
			placeholder = strings.TrimSpace(placeholder)
			part.Text = placeholder
			part.JSON = nil
			stats.PrunedParts++
			stats.PrunedTokensBefore += payloadTokens
			replacementTokens := estimateTextTokens(placeholder)
			if replacementTokens <= 0 {
				replacementTokens = 1
			}
			stats.PrunedTokensAfter += replacementTokens
		}
	}
	return out, stats
}

type toolReferenceIntegrityStats struct {
	OrphanToolCallIDs          []string
	PrependedAssistantMessages int
	DroppedToolResultParts     int
	DroppedToolMessages        int
}

func compactMessages(messages []Message) ([]Message, toolReferenceIntegrityStats) {
	stats := toolReferenceIntegrityStats{}
	if len(messages) <= 12 {
		out := cloneMessages(messages)
		out, gateStats := enforceToolReferenceIntegrity(out, nil)
		return out, mergeToolReferenceStats(stats, gateStats)
	}
	keepRecent := 10
	if keepRecent > len(messages) {
		keepRecent = len(messages)
	}
	archived := cloneMessages(messages[:len(messages)-keepRecent])
	recent := cloneMessages(messages[len(messages)-keepRecent:])
	summaryLines := make([]string, 0, len(archived))
	for _, msg := range archived {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		if role != "user" && role != "assistant" && role != "tool" {
			continue
		}
		txt := joinMessageText(msg)
		if txt == "" {
			for _, part := range msg.Content {
				if strings.ToLower(strings.TrimSpace(part.Type)) == "tool_result" {
					txt = strings.TrimSpace(part.Text)
					break
				}
			}
		}
		if txt == "" {
			continue
		}
		if len([]rune(txt)) > 100 {
			txt = string([]rune(txt)[:100]) + " ..."
		}
		summaryLines = append(summaryLines, "- "+role+": "+txt)
	}
	compacted := make([]Message, 0, len(recent)+1)
	if len(summaryLines) > 0 {
		if len(summaryLines) > 12 {
			summaryLines = summaryLines[len(summaryLines)-12:]
		}
		compacted = append(compacted, Message{
			Role: "system",
			Content: []ContentPart{{
				Type: "text",
				Text: "Compressed context summary:\n" + strings.Join(summaryLines, "\n"),
			}},
		})
	}
	for i := range recent {
		for j := range recent[i].Content {
			part := &recent[i].Content[j]
			if strings.ToLower(strings.TrimSpace(part.Type)) == "tool_result" {
				trimmed, truncated := truncateByRunes(part.Text, 500)
				if truncated {
					part.Text = trimmed + " ... [compressed]"
				}
			}
		}
	}
	var repairStats toolReferenceIntegrityStats
	recent, repairStats = enforceToolReferenceIntegrity(recent, archived)
	stats = mergeToolReferenceStats(stats, repairStats)
	compacted = append(compacted, recent...)
	compacted, gateStats := enforceToolReferenceIntegrity(compacted, nil)
	stats = mergeToolReferenceStats(stats, gateStats)
	return compacted, stats
}

func mergeToolReferenceStats(base toolReferenceIntegrityStats, other toolReferenceIntegrityStats) toolReferenceIntegrityStats {
	if len(other.OrphanToolCallIDs) > 0 {
		existing := make(map[string]struct{}, len(base.OrphanToolCallIDs))
		for _, id := range base.OrphanToolCallIDs {
			existing[strings.TrimSpace(id)] = struct{}{}
		}
		for _, id := range other.OrphanToolCallIDs {
			id = strings.TrimSpace(id)
			if id == "" {
				continue
			}
			if _, ok := existing[id]; ok {
				continue
			}
			existing[id] = struct{}{}
			base.OrphanToolCallIDs = append(base.OrphanToolCallIDs, id)
		}
	}
	base.PrependedAssistantMessages += other.PrependedAssistantMessages
	base.DroppedToolResultParts += other.DroppedToolResultParts
	base.DroppedToolMessages += other.DroppedToolMessages
	return base
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
	r.persistRunEvent("reply.finish_rejected", RealtimeStreamKindLifecycle, map[string]any{
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

func evaluateTaskCompletionGate(resultText string, state runtimeState, complexity string, mode string) (bool, string) {
	_ = state
	_ = complexity
	_ = mode
	text := strings.TrimSpace(resultText)
	if text == "" {
		return false, "empty_result"
	}
	return true, "ok"
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

func (r *run) hydrateTodoRuntimeState(ctx context.Context, state *runtimeState, pack contextmodel.PromptPack) (string, bool) {
	if state == nil {
		return "", false
	}

	endpointID := ""
	threadID := ""
	if r != nil {
		endpointID = strings.TrimSpace(r.endpointID)
		threadID = strings.TrimSpace(r.threadID)
	}
	if r != nil && r.threadsDB != nil && endpointID != "" && threadID != "" {
		readCtx := ctx
		if readCtx == nil {
			readCtx = context.Background()
		}
		if _, hasDeadline := readCtx.Deadline(); !hasDeadline {
			var cancel context.CancelFunc
			readCtx, cancel = context.WithTimeout(readCtx, 2*time.Second)
			defer cancel()
		}
		snapshot, err := r.threadsDB.GetThreadTodosSnapshot(readCtx, endpointID, threadID)
		if err == nil {
			hasSnapshot := snapshot.UpdatedAtUnixMs > 0 || snapshot.Version > 0 || strings.TrimSpace(snapshot.UpdatedByRunID) != "" || strings.TrimSpace(snapshot.UpdatedByToolID) != ""
			if hasSnapshot {
				todos, decodeErr := decodeTodoItemsJSON(snapshot.TodosJSON)
				if decodeErr == nil {
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
	}

	_ = pack // thread todos are authoritative; do not infer open todos from prompt-pack memory.
	return "", false
}

func deriveTodoRuntimeStateFromPromptPack(pack contextmodel.PromptPack) (openCount int, inProgressCount int, ok bool) {
	if len(pack.PendingTodos) == 0 {
		return 0, 0, false
	}
	seen := make(map[string]struct{}, len(pack.PendingTodos))
	for i, item := range pack.PendingTodos {
		content := strings.TrimSpace(item.Content)
		if content == "" {
			continue
		}
		key := strings.TrimSpace(item.MemoryID)
		if key == "" {
			key = fmt.Sprintf("pending_todo_%d::%s", i, content)
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		openCount++
		if strings.HasPrefix(strings.ToLower(content), "[in_progress]") {
			inProgressCount++
		}
	}
	if openCount == 0 {
		return 0, 0, false
	}
	return openCount, inProgressCount, true
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

func (r *run) buildLayeredSystemPrompt(objective string, mode string, complexity string, round int, isFirstRound bool, tools []ToolDef, state runtimeState, exceptionOverlay string, capability runCapabilityContract) string {
	snapshot := buildPromptRuntimeSnapshot(r, objective, mode, complexity, round, isFirstRound, tools, state, exceptionOverlay, capability)
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
	r.mu.Lock()
	r.toolApprovals[toolID] = &toolApprovalRequest{
		decision:      ch,
		toolName:      "task_complete",
		requestedAtMs: time.Now().UnixMilli(),
	}
	r.waitingApproval = true
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		delete(r.toolApprovals, toolID)
		r.waitingApproval = false
		r.mu.Unlock()
	}()

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
		return false, errors.New("approval timed out")
	}
}

func (r *run) recordTaskCompleteSignal(toolID string, resultText string, evidenceRefs []string) {
	if r == nil {
		return
	}
	toolID = r.persistTaskCompleteSignal(toolID, resultText, evidenceRefs)
	r.recordObservationActivityEvent(observation.Event{
		Type:       observation.EventTypeControlSignal,
		ToolID:     toolID,
		ToolName:   "task_complete",
		ToolKind:   "control",
		Result:     truncateRunes(strings.TrimSpace(resultText), 500),
		ObservedAt: time.Now(),
		Metadata: map[string]any{
			"control_disposition": "terminal",
			"result_count":        len(normalizeEvidenceRefs(evidenceRefs)),
		},
	})
}

func normalizeEvidenceRefs(evidenceRefs []string) []string {
	cleanEvidenceRefs := make([]string, 0, len(evidenceRefs))
	for _, ref := range evidenceRefs {
		if ref = strings.TrimSpace(ref); ref != "" {
			cleanEvidenceRefs = append(cleanEvidenceRefs, ref)
		}
	}
	return cleanEvidenceRefs
}

func (r *run) persistTaskCompleteSignal(toolID string, resultText string, evidenceRefs []string) string {
	if r == nil {
		return strings.TrimSpace(toolID)
	}
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		if id, err := newToolID(); err == nil {
			toolID = id
		} else {
			toolID = "tool_task_complete"
		}
	}
	resultText = strings.TrimSpace(resultText)
	cleanEvidenceRefs := normalizeEvidenceRefs(evidenceRefs)
	args := map[string]any{
		"result": truncateRunes(resultText, 500),
	}
	result := map[string]any{
		"result": resultText,
	}
	if len(cleanEvidenceRefs) > 0 {
		args["evidence_refs"] = append([]string(nil), cleanEvidenceRefs...)
		result["evidence_refs"] = append([]string(nil), cleanEvidenceRefs...)
	}
	toolID = r.persistSyntheticToolSuccess(toolID, "task_complete", args, result)
	return toolID
}

func (r *run) persistAskUserWaitingSignal(signal askUserSignal, source string) (string, int) {
	if r == nil {
		return "", 0
	}
	signal = normalizeAskUserSignal(signal)
	source = strings.TrimSpace(source)
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
	toolID, err := newToolID()
	if err != nil {
		toolID = "tool_ask_user_waiting"
	}
	prompt := normalizeRequestUserInputPrompt(&RequestUserInputPrompt{
		MessageID:        strings.TrimSpace(r.messageID),
		ToolID:           toolID,
		ToolName:         "ask_user",
		ReasonCode:       signal.ReasonCode,
		RequiredFromUser: append([]string(nil), signal.RequiredFromUser...),
		EvidenceRefs:     append([]string(nil), signal.EvidenceRefs...),
		Questions:        questions,
	})
	if prompt == nil {
		return "", 0
	}
	r.setWaitingPrompt(prompt)
	args := map[string]any{
		"questions":          questions,
		"reason_code":        signal.ReasonCode,
		"required_from_user": append([]string(nil), signal.RequiredFromUser...),
		"evidence_refs":      append([]string(nil), signal.EvidenceRefs...),
	}
	result := map[string]any{
		"questions":          questions,
		"source":             source,
		"reason_code":        signal.ReasonCode,
		"required_from_user": append([]string(nil), signal.RequiredFromUser...),
		"evidence_refs":      append([]string(nil), signal.EvidenceRefs...),
		"waiting_prompt":     prompt,
		"waiting_user":       true,
	}
	toolID = r.persistSyntheticToolSuccess(toolID, "ask_user", args, result)
	return toolID, len(questions)
}

func (r *run) persistExitPlanModeWaitingSignal(toolID string, args ExitPlanModeArgs, result ExitPlanModeResult) (string, int) {
	if r == nil || result.WaitingPrompt == nil {
		return "", 0
	}
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		if id, err := newToolID(); err == nil {
			toolID = id
		} else {
			toolID = "tool_exit_plan_mode_waiting"
		}
	}
	args.Summary = truncateRunes(strings.TrimSpace(args.Summary), 280)
	args.AllowedPrompts = normalizeExitPlanPromptRefs(args.AllowedPrompts)
	prompt := normalizeRequestUserInputPrompt(result.WaitingPrompt)
	if prompt == nil {
		return "", 0
	}
	r.setWaitingPrompt(prompt)
	blockArgs := map[string]any{}
	if args.Summary != "" {
		blockArgs["summary"] = args.Summary
	}
	if len(args.AllowedPrompts) > 0 {
		blockArgs["allowed_prompts"] = args.AllowedPrompts
	}
	blockResult := map[string]any{
		"summary":        strings.TrimSpace(result.Summary),
		"waiting_prompt": prompt,
		"waiting_user":   true,
	}
	toolID = r.persistSyntheticToolSuccess(toolID, "exit_plan_mode", blockArgs, blockResult)
	return toolID, len(prompt.Questions)
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
