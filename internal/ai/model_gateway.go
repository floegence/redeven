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
	"unicode/utf8"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	aoption "github.com/anthropics/anthropic-sdk-go/option"
	assestream "github.com/anthropics/anthropic-sdk-go/packages/ssestream"
	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/floegence/redeven/internal/config"
	openai "github.com/openai/openai-go/v3"
	ooption "github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/param"
	oresponses "github.com/openai/openai-go/v3/responses"
	oshared "github.com/openai/openai-go/v3/shared"
)

const (
	modelGatewayDefaultMaxOutputTokens      = 4096
	modelGatewayDefaultContextWindowTokens  = 128000
	providerContinuationKindOpenAIResponses = "openai_responses"
	modelGatewayHardMaxToolCalls            = 200
)

const (
	providerWebSearchModeDisabled               = config.AIWebSearchDisabled
	providerWebSearchModeOpenAIResponsesBuiltin = config.AIWebSearchOpenAI
	providerWebSearchModeKimiBuiltin            = config.AIWebSearchKimi
	providerWebSearchModeGLMWebSearchTool       = config.AIWebSearchGLM
	providerWebSearchModeQwenResponsesWebSearch = config.AIWebSearchQwen
	providerWebSearchModeExternalBrave          = config.AIWebSearchBrave
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

func resolveProviderWebSearchCapability(provider config.AIProvider, modelName string) config.AIWebSearchResolution {
	return config.ResolveAIWebSearch(provider, modelName, true)
}

type openAIProvider struct {
	responsesPool         *openAIResponsesPool
	transportIdentity     openAIConnectionIdentity
	officialOpenAI        bool
	providerType          string
	client                openai.Client
	strictToolSchema      bool
	responsesContinuation bool
	forceChat             bool
	gemini                bool
	parallelTools         parallelToolCallsWireMode
	chatGPT               bool
	chatGPTToken          func(context.Context) (string, error)
	chatGPTFailure        func(context.Context, string, error)
	chatGPTWatch          func(context.Context, func(error)) (func(), error)
}

func (p *openAIProvider) failureProviderType() string {
	if p.chatGPT {
		return "chatgpt"
	}
	return p.providerType
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
	prepared, err := p.prepareTurn(ctx, req)
	if err != nil {
		return ModelGatewayResult{}, err
	}
	defer prepared.Close()
	return prepared.StreamTurn(ctx, onEvent)
}

func (p *openAIProvider) prepareTurn(ctx context.Context, req ModelGatewayRequest) (preparedModelGatewayTurn, error) {
	if p == nil {
		return nil, errors.New("nil provider")
	}
	if strings.TrimSpace(req.Model) == "" {
		return nil, errors.New("missing model")
	}
	if req.ReusePolicy != nil {
		if err := req.ReusePolicy.Validate(); err != nil {
			return nil, err
		}
		if !req.ReusePolicy.ProviderStateAllowed && req.PreviousState != nil {
			return nil, errors.New("provider state forbidden by request reuse policy")
		}
	}
	useChat := p.forceChat
	switch req.Protocol {
	case "":
	case "openai-chat-completions":
		useChat = true
	case "openai-responses":
		useChat = false
	default:
		return nil, fmt.Errorf("unsupported OpenAI-compatible protocol %q", req.Protocol)
	}
	route := "openai-responses"
	if useChat {
		route = "openai-chat"
	}
	if err := validateGatewayAttachmentParts(req.Messages, route); err != nil {
		return nil, err
	}
	if useChat && p.chatGPT {
		return nil, errors.New("ChatGPT requires Responses")
	}
	if useChat {
		return p.prepareChatTurn(ctx, req)
	}

	params := oresponses.ResponseNewParams{
		Model:           oshared.ResponsesModel(strings.TrimSpace(req.Model)),
		MaxOutputTokens: openai.Int(modelGatewayDefaultMaxOutputTokens),
	}
	if policy := req.ReusePolicy; policy != nil && policy.PromptCacheEnabled && p.officialOpenAI {
		params.PromptCacheKey = openai.String(openAIPromptCacheKey(policy.PromptCacheNamespace, p.transportIdentity))
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
	if state := req.PreviousState; state != nil && !p.chatGPT && p.responsesContinuation && (req.ReusePolicy == nil || req.ReusePolicy.PreferContinuation) {
		if state.Kind != providerContinuationKindOpenAIResponses || strings.TrimSpace(state.ID) == "" || len(state.Attributes) != 0 {
			return nil, errors.New("invalid OpenAI Responses continuation state")
		}
		params.PreviousResponseID = openai.String(strings.TrimSpace(state.ID))
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

	wireDefs, aliases, err := prepareOpenAIToolSchemas(req.Tools, p.strictToolSchema)
	if err != nil {
		return nil, err
	}
	inputItems, instructions, err := buildOpenAIInput(req.Messages, aliases)
	if err != nil {
		return nil, err
	}
	if len(inputItems) == 0 {
		inputItems = append(inputItems, oresponses.ResponseInputItemParamOfMessage("Continue.", oresponses.EasyInputMessageRoleUser))
	}
	params.Input = oresponses.ResponseNewParamsInputUnion{OfInputItemList: inputItems}
	if strings.TrimSpace(instructions) != "" {
		params.Instructions = openai.String(strings.TrimSpace(instructions))
	}
	tools := buildOpenAITools(wireDefs, p.strictToolSchema, aliases)
	if err := applyResponsesReasoning(&params, req.ProviderControls); err != nil {
		return nil, err
	}
	decorateResponsesParams(&params, req.WebSearchMode, &tools)
	if len(tools) > 0 {
		params.Tools = tools
	}

	records := []chatGPTNativeRecord{}
	canonical := []json.RawMessage{}
	if p.chatGPT {
		params.MaxOutputTokens = param.Opt[int64]{}
		params.Temperature = param.Opt[float64]{}
		params.TopP = param.Opt[float64]{}
		params.Store = openai.Bool(false)
		params.Include = append(params.Include, oresponses.ResponseIncludableReasoningEncryptedContent)
		params.Tools, err = chatGPTNamespaces(params.Tools)
		if err != nil {
			return nil, err
		}
		params.Input.OfInputItemList, records, canonical, err = chatGPTReplay(req, inputItems)
		if err != nil {
			return nil, err
		}
	}
	return newPreparedModelWire(p.providerType, req.Model, flprovider.RequestFormatOpenAIResponses, params, req, aliases, func(ctx context.Context, payload []byte, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
		return p.streamResponsesTurn(ctx, aliases, payload, onEvent, chatGPTStreamContext{Request: req, Records: records, Canonical: canonical})
	})
}

func (p *openAIProvider) streamResponsesTurn(ctx context.Context, aliases providerToolAliases, payload []byte, onEvent func(StreamEvent), chatGPTContext ...chatGPTStreamContext) (result ModelGatewayResult, resultErr error) {
	var bearer string
	if p.chatGPTWatch != nil {
		watchCtx, cancel := context.WithCancelCause(ctx)
		stop, err := p.chatGPTWatch(watchCtx, cancel)
		if err != nil {
			return ModelGatewayResult{}, err
		}
		defer stop()
		defer cancel(nil)
		ctx = watchCtx
		defer func() {
			if cause := context.Cause(watchCtx); cause != nil && !errors.Is(cause, context.Canceled) {
				resultErr = cause
			}
		}()
	}
	defer func() {
		if resultErr != nil && p.chatGPTFailure != nil && bearer != "" {
			p.chatGPTFailure(context.WithoutCancel(ctx), bearer, resultErr)
		}
	}()
	var httpResponse *http.Response
	options := []ooption.RequestOption{ooption.WithRequestBody("application/json", payload), ooption.WithResponseInto(&httpResponse), ooption.WithMiddleware(func(r *http.Request, next ooption.MiddlewareNext) (*http.Response, error) {
		res, err := next(r)
		markProviderResponseReceived(res)
		return res, err
	})}
	if p.chatGPTToken != nil {
		token, err := p.chatGPTToken(ctx)
		if err != nil {
			return ModelGatewayResult{}, err
		}
		bearer = token
		options = append(options, ooption.WithAPIKey(token), ooption.WithMaxRetries(0))
	}
	var native chatGPTStreamContext
	if len(chatGPTContext) == 1 {
		native = chatGPTContext[0]
	}
	stream, lease, fallback, err := p.responsesStream(ctx, native.Request, bearer, payload, &httpResponse, options)
	if err != nil {
		return ModelGatewayResult{}, providerRequestFailure(err, httpResponse, p.failureProviderType())
	}
	defer func() {
		_ = stream.Close()
		if lease != nil {
			lease.finish(resultErr == nil)
		}
	}()
	// Failed attempts may still report billable usage. Keep only explicit protocol
	// facts, without granting their unfinished text or tool drafts completion.
	var observedUsage TurnUsage
	defer func() {
		if resultErr != nil {
			result.Usage = observedUsage
		}
	}()
	var textBuf strings.Builder
	var completed oresponses.Response
	gotCompleted := false
	var reasoningBuf strings.Builder
	var assistantFragments []Message
	fragmentStart := 0
	originalOnEvent := onEvent
	if p.chatGPT {
		onEvent = func(event StreamEvent) {
			if event.Type == StreamEventHostedTool {
				text := textBuf.String()[fragmentStart:]
				if text != "" {
					assistantFragments = append(assistantFragments, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: text}}})
				}
				fragmentStart = textBuf.Len()
			}
			if originalOnEvent != nil {
				originalOnEvent(event)
			}
		}
	}
	hosted := newResponsesHostedEvents(onEvent)
	var nativeCompletedItems chatGPTCompletedItems

	type partialCall struct {
		ItemID      string
		CallID      string
		Name        string
		OutputIndex int64

		Started  bool
		Ended    bool
		ArgsRaw  strings.Builder
		ArgsSent int
		Args     map[string]any
	}
	partials := map[string]*partialCall{} // item_id -> partial

	emitStart := func(pc *partialCall) {
		if pc == nil || pc.Started {
			return
		}
		name := canonicalProviderToolName(pc.Name, aliases)
		if strings.TrimSpace(pc.CallID) == "" || name == "" {
			return
		}
		pc.Started = true
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallStart, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.CallID), Name: name}})
	}
	emitDelta := func(pc *partialCall) {
		if pc == nil {
			return
		}
		if strings.TrimSpace(pc.Name) == "" || strings.TrimSpace(pc.CallID) == "" {
			return
		}
		emitStart(pc)
		raw := pc.ArgsRaw.String()
		if len(raw) <= pc.ArgsSent {
			return
		}
		delta := raw[pc.ArgsSent:]
		pc.ArgsSent = len(raw)
		name := canonicalProviderToolName(pc.Name, aliases)
		if name == "" {
			return
		}
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallDelta, Text: delta, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.CallID), Name: name}})
	}
	emitEnd := func(pc *partialCall, rawArgs string) {
		if pc == nil || pc.Ended {
			return
		}
		name := canonicalProviderToolName(pc.Name, aliases)
		if name == "" || strings.TrimSpace(pc.CallID) == "" {
			return
		}
		pc.Ended = true
		rawArgs = strings.TrimSpace(rawArgs)
		args := parseProviderToolArguments(rawArgs)
		args = aliases.restoreArguments(name, args)
		pc.Args = args
		emitStart(pc)
		emitDelta(pc)
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallEnd, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.CallID), Name: name, Arguments: cloneProviderToolArguments(args)}})
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

	for !gotCompleted && stream.Next() {
		event := stream.Current()
		if event.Response.JSON.Usage.Valid() {
			usage, err := turnUsageFromOpenAIResponse(event.Response.Usage)
			if err != nil {
				return ModelGatewayResult{}, fmt.Errorf("normalize OpenAI response usage: %w", err)
			}
			observedUsage = usage
		}
		switch strings.TrimSpace(event.Type) {
		case "response.output_text.delta":
			delta := event.Delta
			if delta == "" {
				continue
			}
			textBuf.WriteString(delta)
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventTextDelta, Text: delta})

		case "response.reasoning_summary_text.delta":
			delta := event.Delta
			reasoningBuf.WriteString(delta)
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventThinkingDelta, Text: delta})

		case "response.output_item.added":
			item := event.Item
			if p.chatGPT && item.Type == "function_call" && item.Namespace != chatGPTToolNamespace {
				return ModelGatewayResult{}, errors.New("unexpected ChatGPT tool namespace")
			}
			hosted.item(item)
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
			if name := canonicalProviderToolName(item.Name, aliases); name != "" {
				pc.Name = name
			}
			emitStart(pc)
			if raw := item.Arguments.OfString; raw != "" {
				pc.ArgsRaw.WriteString(raw)
			}
			emitDelta(pc)

		case "response.function_call_arguments.delta":
			pc := getPartial(event.ItemID)
			if pc == nil {
				continue
			}
			delta := event.Delta
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
			raw := event.Arguments
			if raw != "" {
				if !strings.HasPrefix(raw, pc.ArgsRaw.String()) {
					return ModelGatewayResult{}, errors.New("provider tool arguments changed streamed prefix")
				}
				pc.ArgsRaw.Reset()
				pc.ArgsRaw.WriteString(raw)
			}
			emitEnd(pc, pc.ArgsRaw.String())

		case "response.output_item.done":
			item := event.Item
			if p.chatGPT {
				if err := nativeCompletedItems.add(event.OutputIndex, item); err != nil {
					return ModelGatewayResult{}, err
				}
			}
			if p.chatGPT && item.Type == "function_call" && item.Namespace != chatGPTToolNamespace {
				return ModelGatewayResult{}, errors.New("unexpected ChatGPT tool namespace")
			}
			hosted.item(item)
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
			if name := canonicalProviderToolName(item.Name, aliases); name != "" {
				pc.Name = name
			}
			if raw := item.Arguments.OfString; raw != "" && pc.ArgsRaw.Len() == 0 {
				pc.ArgsRaw.WriteString(raw)
			}
			emitEnd(pc, pc.ArgsRaw.String())

		case "response.incomplete", "response.completed":
			if p.chatGPT && event.Type == "response.incomplete" {
				return ModelGatewayResult{}, providerStreamFailure(event.RawJSON(), httpResponse, p.failureProviderType())
			}
			completed = event.Response
			if p.chatGPT {
				var err error
				completed.Output, err = nativeCompletedItems.complete(completed.Output)
				if err != nil {
					return ModelGatewayResult{}, err
				}
			}
			for _, item := range completed.Output {
				if p.chatGPT && item.Type == "function_call" && item.Namespace != chatGPTToolNamespace {
					return ModelGatewayResult{}, errors.New("unexpected ChatGPT tool namespace")
				}
				hosted.item(item)
			}
			gotCompleted = true
		case "response.failed", "error":
			return ModelGatewayResult{}, providerStreamFailure(event.RawJSON(), httpResponse, p.failureProviderType())
		}
	}
	if err := stream.Err(); err != nil {
		return ModelGatewayResult{}, providerRequestFailure(err, httpResponse, p.failureProviderType())
	}
	if !gotCompleted {
		return ModelGatewayResult{}, flprovider.WithRetryAdvice(errors.New("provider stream closed without terminal response"), flprovider.RetryAdvice{Category: flprovider.RetryStreamInterrupted})
	}
	result = ModelGatewayResult{
		FinishReason:    "unknown",
		Text:            textBuf.String(),
		Reasoning:       reasoningBuf.String(),
		RawProviderDiag: map[string]any{},
	}
	result.FinishReason = mapOpenAIStatus(completed.Status)
	if completed.Status == "incomplete" && completed.IncompleteDetails.Reason == "content_filter" {
		result.FinishReason = "content_filter"
	}
	if result.Reasoning == "" {
		for _, item := range completed.Output {
			if item.Type == "reasoning" {
				for _, summary := range item.Summary {
					result.Reasoning += summary.Text
				}
			}
		}
	}
	result.Sources = extractOpenAIURLSources(completed)
	usage, usageErr := turnUsageFromOpenAIResponse(completed.Usage)
	if usageErr != nil {
		return ModelGatewayResult{}, fmt.Errorf("normalize OpenAI response usage: %w", usageErr)
	}
	result.Usage = usage
	if rid := strings.TrimSpace(completed.ID); rid != "" {
		result.RawProviderDiag["response_id"] = rid
		result.ProviderState = &ModelGatewayState{
			Kind: providerContinuationKindOpenAIResponses,
			ID:   rid,
		}
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
			Call:        ToolCall{ID: id, Name: canonicalProviderToolName(pc.Name, aliases), Args: cloneProviderToolArguments(pc.Args)},
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
		toolName := canonicalProviderToolName(item.Name, aliases)
		rawArgs := strings.TrimSpace(item.Arguments.OfString)
		args := parseProviderToolArguments(rawArgs)
		args = aliases.restoreArguments(toolName, args)
		call := ToolCall{ID: callID, Name: toolName, Args: args}
		result.ToolCalls = append(result.ToolCalls, call)
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallStart, ToolCall: &PartialToolCall{ID: call.ID, Name: call.Name}})
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallDelta, Text: rawArgs, ToolCall: &PartialToolCall{ID: call.ID, Name: call.Name}})
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallEnd, ToolCall: &PartialToolCall{ID: call.ID, Name: call.Name, Arguments: cloneProviderToolArguments(call.Args)}})
	}

	if len(result.ToolCalls) > 0 {
		result.FinishReason = "tool_calls"
	}
	finalText := extractOpenAIResponseText(completed)
	if strings.HasPrefix(finalText, result.Text) {
		// Complete only an exact streamed prefix; annotations address finalText.
		if suffix := finalText[len(result.Text):]; suffix != "" {
			textBuf.WriteString(suffix)
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventTextDelta, Text: suffix})
		}
		result.Text = finalText
	} else {
		// Already emitted text cannot be rewritten. Keep the sources, but do
		// not claim final-response offsets apply to a different transcript.
		for i := range result.Sources {
			result.Sources[i].StartIndex, result.Sources[i].EndIndex = nil, nil
		}
	}

	if result.FinishReason == "unknown" && result.Text != "" {
		result.FinishReason = "stop"
	}
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventUsage, Usage: partialUsageFromTurnUsage(result.Usage)})
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventFinishReason, FinishHint: result.FinishReason})
	if p.chatGPT {
		if len(chatGPTContext) != 1 {
			return ModelGatewayResult{}, errors.New("missing ChatGPT request identity")
		}
		native := chatGPTContext[0]
		var stateErr error
		result.ProviderState, stateErr = chatGPTState(native.Request, result, completed, aliases, native.Records, native.Canonical, append(assistantFragments, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: textBuf.String()[fragmentStart:]}}}))
		if stateErr != nil {
			return ModelGatewayResult{}, stateErr
		}
	}
	if policy := native.Request.ReusePolicy; policy != nil && !policy.ProviderStateAllowed {
		result.ProviderState = nil
	}
	if err := validateModelGatewayResult(result); err != nil {
		return ModelGatewayResult{}, err
	}
	if lease != nil {
		if err := lease.confirm(payload, completed, result.ProviderState); err != nil {
			return ModelGatewayResult{}, err
		}
	}
	result.RawProviderDiag["transport"] = "http"
	if lease != nil {
		result.RawProviderDiag["transport"] = "websocket"
	}
	if fallback != "" {
		result.RawProviderDiag["transport_fallback"] = fallback
	}
	return result, nil
}

func (p *openAIProvider) prepareChatTurn(ctx context.Context, req ModelGatewayRequest) (preparedModelGatewayTurn, error) {
	if p == nil {
		return nil, errors.New("nil provider")
	}
	if !p.gemini && req.PreviousState != nil {
		return nil, errors.New("OpenAI Chat does not support opaque continuation state")
	}
	if strings.TrimSpace(req.Model) == "" {
		return nil, errors.New("missing model")
	}

	wireDefs, aliases, err := prepareOpenAIToolSchemas(req.Tools, p.strictToolSchema)
	if err != nil {
		return nil, err
	}
	capability := req.ProviderControls.ReasoningCapability.Normalize()
	messages, err := buildOpenAIChatMessagesWithCapability(req.Messages, capability, aliases)
	if err != nil {
		return nil, err
	}
	if len(messages) == 0 {
		messages = append(messages, openai.UserMessage("Continue."))
	}

	signatures := map[string]geminiToolSignature{}
	if p.gemini {
		messages, signatures, err = restoreGeminiSignatures(req, messages)
		if err != nil {
			return nil, err
		}
	}
	params := openai.ChatCompletionNewParams{
		Model:         oshared.ChatModel(strings.TrimSpace(req.Model)),
		Messages:      messages,
		StreamOptions: openai.ChatCompletionStreamOptionsParam{IncludeUsage: openai.Bool(true)},
	}
	if policy := req.ReusePolicy; policy != nil && policy.PromptCacheEnabled && p.officialOpenAI {
		params.PromptCacheKey = openai.String(openAIPromptCacheKey(policy.PromptCacheNamespace, p.transportIdentity))
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

	tools := buildOpenAIChatTools(wireDefs, p.strictToolSchema, aliases)
	if err := applyChatReasoning(&params, req.ProviderControls); err != nil {
		return nil, err
	}
	decorateChatCompletionParams(&params, req.WebSearchMode, &tools)
	if len(tools) > 0 {
		params.Tools = tools
	}

	model := req.Model
	return newPreparedModelWire(p.providerType, model, flprovider.RequestFormatOpenAIChat, params, req, aliases, func(ctx context.Context, payload []byte, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
		return p.streamPreparedChatTurn(ctx, model, capability, aliases, signatures, payload, onEvent)
	})
}

func (p *openAIProvider) streamPreparedChatTurn(ctx context.Context, model string, capability config.AIReasoningCapability, aliases providerToolAliases, signatures map[string]geminiToolSignature, payload []byte, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	var httpResponse *http.Response
	stream := p.client.Chat.Completions.NewStreaming(ctx, openai.ChatCompletionNewParams{}, ooption.WithRequestBody("application/json", payload), ooption.WithResponseInto(&httpResponse), ooption.WithMiddleware(func(r *http.Request, next ooption.MiddlewareNext) (*http.Response, error) {
		res, err := next(r)
		markProviderResponseReceived(res)
		return res, err
	}))
	defer func() { _ = stream.Close() }()
	var textBuf strings.Builder
	var reasoningBuf strings.Builder
	result := ModelGatewayResult{
		FinishReason:    "unknown",
		RawProviderDiag: map[string]any{},
	}
	type partialCall struct {
		Index     int64
		CallID    string
		Name      string
		Started   bool
		Ended     bool
		Signature string
		ArgsRaw   strings.Builder
		ArgsSent  int
		Args      map[string]any
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
		name := canonicalProviderToolName(pc.Name, aliases)
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
		name := canonicalProviderToolName(pc.Name, aliases)
		if callID == "" || name == "" {
			return
		}
		raw := pc.ArgsRaw.String()
		if len(raw) <= pc.ArgsSent {
			return
		}
		delta := raw[pc.ArgsSent:]
		pc.ArgsSent = len(raw)
		emitStart(pc)
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallDelta, Text: delta, ToolCall: &PartialToolCall{ID: callID, Name: name}})
	}
	emitEnd := func(pc *partialCall) {
		if pc == nil || pc.Ended {
			return
		}
		callID := ensureCallID(pc)
		name := canonicalProviderToolName(pc.Name, aliases)
		if callID == "" || name == "" {
			return
		}
		raw := strings.TrimSpace(pc.ArgsRaw.String())
		args := parseProviderToolArguments(raw)
		args = aliases.restoreArguments(name, args)
		pc.Args = args
		pc.Ended = true
		emitStart(pc)
		emitDelta(pc)
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallEnd, ToolCall: &PartialToolCall{ID: callID, Name: name, Arguments: cloneProviderToolArguments(args)}})
	}

	for stream.Next() {
		chunk := stream.Current()
		if rid := strings.TrimSpace(chunk.ID); rid != "" {
			result.RawProviderDiag["response_id"] = rid
		}
		if chunk.Usage.PromptTokens > 0 || chunk.Usage.CompletionTokens > 0 || chunk.Usage.CompletionTokensDetails.ReasoningTokens > 0 {
			usage, usageErr := turnUsageFromOpenAICompletion(chunk.Usage)
			if usageErr != nil {
				return ModelGatewayResult{}, fmt.Errorf("normalize OpenAI chat usage: %w", usageErr)
			}
			result.Usage = usage
		}
		for _, choice := range chunk.Choices {
			if finish := mapOpenAIChatFinishReason(choice.FinishReason); finish != "unknown" {
				result.FinishReason = finish
			}
			delta := choice.Delta
			if reasoning := extractResponseReasoningDelta(delta.RawJSON(), capability); reasoning != "" {
				reasoningBuf.WriteString(reasoning)
				emitProviderEvent(onEvent, StreamEvent{Type: StreamEventThinkingDelta, Text: reasoning})
			}
			if delta.Content != "" {
				textBuf.WriteString(delta.Content)
				emitProviderEvent(onEvent, StreamEvent{Type: StreamEventTextDelta, Text: delta.Content})
			}
			for _, tc := range delta.ToolCalls {
				pc := getPartial(tc.Index)
				if p.gemini {
					sig, err := geminiSignatureFromDelta(tc.RawJSON())
					if err != nil {
						return ModelGatewayResult{}, err
					}
					if sig != "" {
						if pc.Signature != "" && pc.Signature != sig {
							return ModelGatewayResult{}, errors.New("gemini changed a tool thought signature")
						}
						pc.Signature = sig
					}
				}
				if id := strings.TrimSpace(tc.ID); id != "" {
					pc.CallID = id
				}
				if name := canonicalProviderToolName(tc.Function.Name, aliases); name != "" {
					pc.Name = name
				}
				if argsDelta := tc.Function.Arguments; argsDelta != "" {
					pc.ArgsRaw.WriteString(argsDelta)
					emitDelta(pc)
					continue
				}
				emitStart(pc)
				emitDelta(pc)
			}
		}
	}
	if err := stream.Err(); err != nil {
		return result, providerRequestFailure(err, httpResponse, p.failureProviderType())
	}

	sort.SliceStable(order, func(i, j int) bool { return order[i] < order[j] })
	if result.FinishReason == "unknown" {
		return result, flprovider.WithRetryAdvice(errors.New("provider stream closed without finish reason"), flprovider.RetryAdvice{Category: flprovider.RetryStreamInterrupted})
	}
	for _, idx := range order {
		pc := partials[idx]
		if pc == nil {
			continue
		}
		emitEnd(pc)
		if !pc.Ended {
			continue
		}
		if p.gemini && pc.Signature != "" {
			signatures[ensureCallID(pc)] = geminiToolSignature{Signature: pc.Signature, Name: providerHistoryToolWireName(pc.Name, aliases), Arguments: geminiArguments(pc.ArgsRaw.String())}
		}
		result.ToolCalls = append(result.ToolCalls, ToolCall{ID: ensureCallID(pc), Name: canonicalProviderToolName(pc.Name, aliases), Args: cloneProviderToolArguments(pc.Args)})
	}
	result.Text = strings.TrimSpace(textBuf.String())
	result.Reasoning = reasoningBuf.String()
	if len(result.ToolCalls) > 0 {
		result.FinishReason = "tool_calls"
	}
	if result.FinishReason == "unknown" && result.Text != "" {
		result.FinishReason = "stop"
	}
	if result.Text == "" && result.Reasoning == "" && len(result.ToolCalls) == 0 {
		return ModelGatewayResult{}, errors.New("missing streamed response")
	}
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventUsage, Usage: partialUsageFromTurnUsage(result.Usage)})
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventFinishReason, FinishHint: result.FinishReason})
	if p.gemini && len(signatures) > 0 {
		raw, err := json.Marshal(signatures)
		if err != nil {
			return ModelGatewayResult{}, err
		}
		result.ProviderState = &ModelGatewayState{Kind: geminiStateKind, ID: model, Attributes: map[string]string{"tool_signatures": string(raw)}}
	}
	return result, validateModelGatewayResult(result)
}

type moonshotProvider struct {
	client           openai.Client
	strictToolSchema bool
}

func (p *moonshotProvider) StreamTurn(ctx context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	prepared, err := p.prepareTurn(ctx, req)
	if err != nil {
		return ModelGatewayResult{}, err
	}
	defer prepared.Close()
	return prepared.StreamTurn(ctx, onEvent)
}

func (p *moonshotProvider) prepareTurn(ctx context.Context, req ModelGatewayRequest) (preparedModelGatewayTurn, error) {
	if p == nil {
		return nil, errors.New("nil provider")
	}
	if req.PreviousState != nil {
		return nil, errors.New("opaque continuation state is not supported by Moonshot")
	}
	if strings.TrimSpace(req.Model) == "" {
		return nil, errors.New("missing model")
	}

	wireDefs, aliases, err := prepareOpenAIToolSchemas(req.Tools, p.strictToolSchema)
	if err != nil {
		return nil, err
	}
	messages, err := buildOpenAIChatMessagesWithCapability(req.Messages, req.ProviderControls.ReasoningCapability, aliases)
	if err != nil {
		return nil, err
	}
	if len(messages) == 0 {
		messages = append(messages, openai.UserMessage("Continue."))
	}

	params := openai.ChatCompletionNewParams{
		Model:         oshared.ChatModel(strings.TrimSpace(req.Model)),
		Messages:      messages,
		StreamOptions: openai.ChatCompletionStreamOptionsParam{IncludeUsage: openai.Bool(true)},
	}
	if req.Budgets.MaxOutputToken > 0 {
		if strings.HasPrefix(req.Model, "kimi-k3") {
			params.MaxCompletionTokens = openai.Int(int64(req.Budgets.MaxOutputToken))
		} else {
			params.MaxTokens = openai.Int(int64(req.Budgets.MaxOutputToken))
		}
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

	tools := buildOpenAIChatTools(wireDefs, p.strictToolSchema, aliases)
	if err := applyChatReasoning(&params, req.ProviderControls); err != nil {
		return nil, err
	}
	decorateChatCompletionParams(&params, req.WebSearchMode, &tools)
	if len(tools) > 0 {
		params.Tools = tools
	}

	return newPreparedModelWire("moonshot", req.Model, flprovider.RequestFormatOpenAIChat, params, req, aliases, func(ctx context.Context, payload []byte, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
		return p.streamPreparedTurn(ctx, aliases, payload, onEvent)
	})
}

func (p *moonshotProvider) streamPreparedTurn(ctx context.Context, aliases providerToolAliases, payload []byte, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	var httpResponse *http.Response
	stream := p.client.Chat.Completions.NewStreaming(ctx, openai.ChatCompletionNewParams{}, ooption.WithRequestBody("application/json", payload), ooption.WithResponseInto(&httpResponse), ooption.WithMiddleware(func(r *http.Request, next ooption.MiddlewareNext) (*http.Response, error) {
		res, err := next(r)
		markProviderResponseReceived(res)
		return res, err
	}))
	defer func() { _ = stream.Close() }()
	var textBuf strings.Builder
	var reasoningBuf strings.Builder
	result := ModelGatewayResult{
		FinishReason:    "unknown",
		RawProviderDiag: map[string]any{},
	}

	type partialCall struct {
		Index    int64
		CallID   string
		Name     string
		Started  bool
		Ended    bool
		ArgsRaw  strings.Builder
		ArgsSent int
		Args     map[string]any
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
		name := canonicalProviderToolName(pc.Name, aliases)
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
		name := canonicalProviderToolName(pc.Name, aliases)
		if callID == "" || name == "" {
			return
		}
		raw := pc.ArgsRaw.String()
		if len(raw) <= pc.ArgsSent {
			return
		}
		delta := raw[pc.ArgsSent:]
		pc.ArgsSent = len(raw)
		emitStart(pc)
		emitProviderEvent(onEvent, StreamEvent{
			Type: StreamEventToolCallDelta,
			Text: delta,
			ToolCall: &PartialToolCall{
				ID:   callID,
				Name: name,
			},
		})
	}
	emitEnd := func(pc *partialCall) {
		if pc == nil || pc.Ended {
			return
		}
		callID := ensureCallID(pc)
		name := canonicalProviderToolName(pc.Name, aliases)
		if callID == "" || name == "" {
			return
		}
		raw := strings.TrimSpace(pc.ArgsRaw.String())
		args := parseProviderToolArguments(raw)
		args = aliases.restoreArguments(name, args)
		pc.Args = args
		pc.Ended = true
		emitStart(pc)
		emitDelta(pc)
		emitProviderEvent(onEvent, StreamEvent{
			Type: StreamEventToolCallEnd,
			ToolCall: &PartialToolCall{
				ID:        callID,
				Name:      name,
				Arguments: cloneProviderToolArguments(args),
			},
		})
	}

	for stream.Next() {
		chunk := stream.Current()
		if rid := strings.TrimSpace(chunk.ID); rid != "" {
			result.RawProviderDiag["response_id"] = rid
		}
		if chunk.Usage.PromptTokens > 0 || chunk.Usage.CompletionTokens > 0 || chunk.Usage.CompletionTokensDetails.ReasoningTokens > 0 {
			usage, usageErr := turnUsageFromOpenAICompletion(chunk.Usage)
			if usageErr != nil {
				return ModelGatewayResult{}, fmt.Errorf("normalize Moonshot chat usage: %w", usageErr)
			}
			result.Usage = usage
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
				if name := canonicalProviderToolName(tc.Function.Name, aliases); name != "" {
					pc.Name = name
				}
				if argsDelta := tc.Function.Arguments; argsDelta != "" {
					pc.ArgsRaw.WriteString(argsDelta)
					emitDelta(pc)
					continue
				}
				emitStart(pc)
				emitDelta(pc)
			}
		}
	}
	if err := stream.Err(); err != nil {
		return result, providerRequestFailure(err, httpResponse, "moonshot")
	}
	if result.FinishReason == "unknown" {
		return result, flprovider.WithRetryAdvice(errors.New("provider stream closed without finish reason"), flprovider.RetryAdvice{Category: flprovider.RetryStreamInterrupted})
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
			Name: canonicalProviderToolName(pc.Name, aliases),
			Args: cloneProviderToolArguments(pc.Args),
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
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventUsage, Usage: partialUsageFromTurnUsage(result.Usage)})
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventFinishReason, FinishHint: result.FinishReason})
	return result, validateModelGatewayResult(result)
}

func (p *moonshotProvider) Turn(ctx context.Context, req ModelGatewayRequest) (ModelGatewayResult, error) {
	if p == nil {
		return ModelGatewayResult{}, errors.New("nil provider")
	}
	if strings.TrimSpace(req.Model) == "" {
		return ModelGatewayResult{}, errors.New("missing model")
	}

	wireDefs, aliases, err := prepareOpenAIToolSchemas(req.Tools, p.strictToolSchema)
	if err != nil {
		return ModelGatewayResult{}, err
	}
	messages, err := buildOpenAIChatMessagesWithCapability(req.Messages, req.ProviderControls.ReasoningCapability, aliases)
	if err != nil {
		return ModelGatewayResult{}, err
	}
	if len(messages) == 0 {
		messages = append(messages, openai.UserMessage("Continue."))
	}

	params := openai.ChatCompletionNewParams{
		Model:    oshared.ChatModel(strings.TrimSpace(req.Model)),
		Messages: messages,
	}
	if req.Budgets.MaxOutputToken > 0 {
		if strings.HasPrefix(req.Model, "kimi-k3") {
			params.MaxCompletionTokens = openai.Int(int64(req.Budgets.MaxOutputToken))
		} else {
			params.MaxTokens = openai.Int(int64(req.Budgets.MaxOutputToken))
		}
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
	tools := buildOpenAIChatTools(wireDefs, p.strictToolSchema, aliases)
	if err := applyChatReasoning(&params, req.ProviderControls); err != nil {
		return ModelGatewayResult{}, err
	}
	decorateChatCompletionParams(&params, req.WebSearchMode, &tools)
	if len(tools) > 0 {
		params.Tools = tools
	}

	var httpResponse *http.Response
	completion, err := p.client.Chat.Completions.New(ctx, params, ooption.WithResponseInto(&httpResponse), ooption.WithMiddleware(func(r *http.Request, next ooption.MiddlewareNext) (*http.Response, error) {
		res, err := next(r)
		markProviderResponseReceived(res)
		return res, err
	}))
	if err != nil {
		return ModelGatewayResult{}, providerRequestFailure(err, httpResponse, "moonshot")
	}
	usage, err := turnUsageFromOpenAICompletion(completion.Usage)
	if err != nil {
		return ModelGatewayResult{}, fmt.Errorf("normalize Moonshot completion usage: %w", err)
	}
	result := ModelGatewayResult{
		FinishReason:    "unknown",
		RawProviderDiag: map[string]any{"response_id": strings.TrimSpace(completion.ID)},
		Usage:           usage,
	}
	if len(completion.Choices) == 0 {
		return ModelGatewayResult{}, errors.New("missing completion choices")
	}
	choice := completion.Choices[0]
	result.FinishReason = mapOpenAIChatFinishReason(string(choice.FinishReason))
	result.Text = strings.TrimSpace(choice.Message.Content)
	result.Reasoning = strings.TrimSpace(extractMoonshotReasoningJSON(choice.Message.RawJSON()))
	for _, tc := range choice.Message.ToolCalls {
		name := canonicalProviderToolName(tc.Function.Name, aliases)
		rawArgs := strings.TrimSpace(tc.Function.Arguments)
		args := parseProviderToolArguments(rawArgs)
		args = aliases.restoreArguments(name, args)
		result.ToolCalls = append(result.ToolCalls, ToolCall{
			ID:   strings.TrimSpace(tc.ID),
			Name: name,
			Args: cloneProviderToolArguments(args),
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
	return result, validateModelGatewayResult(result)
}

func buildOpenAIChatTools(defs []ToolDef, strict bool, aliases providerToolAliases) []openai.ChatCompletionToolUnionParam {
	out := make([]openai.ChatCompletionToolUnionParam, 0, len(defs))
	for _, def := range defs {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		schema := map[string]any{}
		if len(def.InputSchema) > 0 {
			_ = json.Unmarshal(def.InputSchema, &schema)
		}
		alias := aliases.wireName(name)
		fn := oshared.FunctionDefinitionParam{
			Name:        alias,
			Description: openai.String(strings.TrimSpace(def.Description)),
			Strict:      openai.Bool(strict && def.Strict),
		}
		if len(schema) > 0 {
			fn.Parameters = oshared.FunctionParameters(schema)
		}
		out = append(out, openai.ChatCompletionToolUnionParam{OfFunction: &openai.ChatCompletionFunctionToolParam{Function: fn}})
	}
	return out
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
	case "qwen_enable_thinking", "qwen_reasoning_effort":
		if selection.BudgetTokens > 0 {
			return fmt.Errorf("qwen responses reasoning does not support thinking_budget")
		}
		if selection.Level == config.AIReasoningLevelOn {
			params.SetExtraFields(mergeAnyFields(params.ExtraFields(), map[string]any{"enable_thinking": true}))
		} else {
			params.Reasoning = oshared.ReasoningParam{Effort: oshared.ReasoningEffort(reasoningEffortWireValue(selection.Level))}
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
	case "openai_chat_reasoning_effort", "openai_responses_reasoning_effort", "glm_reasoning_effort", "kimi_reasoning_effort", "xai_reasoning_effort", "groq_qwen_reasoning_effort", "groq_gpt_oss_reasoning_effort":
		params.ReasoningEffort = oshared.ReasoningEffort(reasoningEffortWireValue(selection.Level))
	case "ollama_model_family_think":
		effort, err := flprovider.OllamaReasoningEffort(floretModelGatewayCapabilities(capability).ReasoningCapability, selection)
		if err != nil {
			return err
		}
		if effort != "" {
			params.ReasoningEffort = oshared.ReasoningEffort(effort)
		}
	case "kimi_thinking_type", "glm_thinking_type":
		extraFields = mergeAnyFields(extraFields, map[string]any{"thinking": map[string]any{"type": thinkingTypeForSelection(selection)}})
	case "qwen_enable_thinking", "qwen_reasoning_effort":
		if capability.WireShape == "qwen_reasoning_effort" && selection.Level != "" && selection.Level != config.AIReasoningLevelDefault {
			params.ReasoningEffort = oshared.ReasoningEffort(reasoningEffortWireValue(selection.Level))
		}
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
	if capability.WireShape != "anthropic_output_config_effort" && capability.WireShape != "anthropic_thinking_budget_tokens" {
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
	if selection.Level != "" && selection.Level != config.AIReasoningLevelDefault && selection.Level != config.AIReasoningLevelOn {
		params.OutputConfig = anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffort(selection.Level)}
	}
	return nil
}

func decorateChatCompletionParams(params *openai.ChatCompletionNewParams, webSearchMode string, tools *[]openai.ChatCompletionToolUnionParam) {
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
	}
	if len(extraFields) > 0 {
		params.SetExtraFields(extraFields)
	}
}

func openAIChatToolOverride(v map[string]any) openai.ChatCompletionToolUnionParam {
	b, _ := json.Marshal(v)
	return param.Override[openai.ChatCompletionToolUnionParam](json.RawMessage(b))
}

func decorateResponsesParams(params *oresponses.ResponseNewParams, webSearchMode string, tools *[]oresponses.ToolUnionParam) {
	if params == nil {
		return
	}
	switch strings.TrimSpace(webSearchMode) {
	case providerWebSearchModeOpenAIResponsesBuiltin:
		if tools != nil {
			*tools = append(*tools, oresponses.ToolParamOfWebSearch(oresponses.WebSearchToolTypeWebSearch))
			params.Include = append(params.Include, oresponses.ResponseIncludableWebSearchCallActionSources)
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

func buildOpenAIChatMessagesWithCapability(messages []Message, capability config.AIReasoningCapability, aliases providerToolAliases) ([]openai.ChatCompletionMessageParamUnion, error) {
	capability = capability.Normalize()
	replayField := ""
	for _, field := range []string{"reasoning_content", "reasoning"} {
		if reasoningCapabilityContains(capability.HistoryReplayRequirements, field) {
			replayField = field
			break
		}
	}
	replayReasoning := replayField != ""
	out := make([]openai.ChatCompletionMessageParamUnion, 0, len(messages)+2)
	toolImages := make([]openai.ChatCompletionContentPartUnionParam, 0)
	flushToolImages := func() {
		if len(toolImages) == 0 {
			return
		}
		out = append(out, openai.UserMessage(toolImages))
		toolImages = nil
	}
	for _, msg := range messages {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		if role != "tool" {
			flushToolImages()
		}
		switch role {
		case "system":
			if txt := joinMessageText(msg); txt != "" {
				out = append(out, openai.SystemMessage(txt))
			}
		case "tool":
			results := make([]ContentPart, 0, 1)
			images := make([]ContentPart, 0)
			for _, part := range msg.Content {
				switch strings.ToLower(strings.TrimSpace(part.Type)) {
				case "tool_result":
					results = append(results, part)
				case "image":
					images = append(images, part)
				case "file":
					return nil, errors.New("chat completions does not support file tool output")
				}
			}
			if len(images) > 0 && len(results) != 1 {
				return nil, errors.New("tool images require exactly one tool result")
			}
			for _, result := range results {
				callID := contentPartCallID(result)
				if callID == "" {
					return nil, errors.New("tool result is missing a call ID")
				}
				output := contentPartToolResultText(result)
				if output == "" {
					output = "{}"
				}
				out = append(out, openai.ToolMessage(output, callID))
				if len(images) > 0 {
					// Chat tool messages accept text only. Keep all parallel results
					// together, then send their native images with explicit call identity.
					toolImages = append(toolImages, openai.TextContentPart("Images returned by tool call "+callID+" ("+contentPartToolName(result)+")"))
					for _, image := range images {
						if strings.TrimSpace(image.FileURI) == "" {
							return nil, errors.New("tool image has no resolved input")
						}
						toolImages = append(toolImages, openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{URL: image.FileURI}))
					}
				}
			}
		case "assistant":
			var textBuf strings.Builder
			var reasoningBuf strings.Builder
			toolCalls := make([]openai.ChatCompletionMessageToolCallUnionParam, 0, 2)
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
					name := providerHistoryToolWireName(contentPartToolName(part), aliases)
					if name == "" {
						return nil, errors.New("assistant history tool call is missing a name")
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
					toolCalls = append(toolCalls, openai.ChatCompletionMessageToolCallUnionParam{OfFunction: &openai.ChatCompletionMessageFunctionToolCallParam{
						ID: callID,
						Function: openai.ChatCompletionMessageFunctionToolCallFunctionParam{
							Name:      name,
							Arguments: argsRaw,
						},
					}})
				}
			}
			content := strings.TrimSpace(textBuf.String())
			if len(toolCalls) == 0 && content == "" && (!replayReasoning || reasoningBuf.Len() == 0) {
				continue
			}
			// Reasoning-only continuations still need a string content field on
			// OpenAI-compatible endpoints such as Ollama.
			assistant := openai.ChatCompletionAssistantMessageParam{
				ToolCalls: toolCalls,
				Content:   openai.ChatCompletionAssistantMessageParamContentUnion{OfString: openai.String(content)},
			}
			if replayReasoning && reasoningBuf.Len() > 0 {
				assistant.SetExtraFields(map[string]any{replayField: reasoningBuf.String()})
			}
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
					return nil, errors.New("chat completions does not support file input")
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
	flushToolImages()
	return out, nil
}

func reasoningCapabilityContains(values []string, want string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), want) {
			return true
		}
	}
	return false
}

func extractResponseReasoningDelta(raw string, capability config.AIReasoningCapability) string {
	capability = capability.Normalize()
	if capability.IsZero() || len(capability.ResponseReasoningFields) == 0 {
		return ""
	}
	decoded := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return ""
	}
	for _, field := range capability.ResponseReasoningFields {
		if value, ok := decoded[strings.TrimSpace(field)]; ok {
			if text := extractReasoningValue(value); text != "" {
				return text
			}
		}
	}
	return ""
}

func extractReasoningValue(value any) string {
	switch value := value.(type) {
	case string:
		return value
	case []any:
		var out strings.Builder
		for _, item := range value {
			out.WriteString(extractReasoningValue(item))
		}
		return out.String()
	case map[string]any:
		for _, key := range []string{"text", "content", "reasoning_content", "reasoning"} {
			if text := extractReasoningValue(value[key]); text != "" {
				return text
			}
		}
	}
	return ""
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

func buildOpenAITools(defs []ToolDef, strict bool, aliases providerToolAliases) []oresponses.ToolUnionParam {
	out := make([]oresponses.ToolUnionParam, 0, len(defs))
	for _, def := range defs {
		if strings.TrimSpace(def.Name) == "" {
			continue
		}
		schema := map[string]any{}
		if len(def.InputSchema) > 0 {
			_ = json.Unmarshal(def.InputSchema, &schema)
		}
		alias := aliases.wireName(def.Name)
		out = append(out, oresponses.ToolParamOfFunction(alias, schema, strict && def.Strict))
	}
	return out
}

func buildOpenAIInput(messages []Message, aliases providerToolAliases) (oresponses.ResponseInputParam, string, error) {
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
			media := false
			results := 0
			for _, part := range msg.Content {
				switch strings.ToLower(strings.TrimSpace(part.Type)) {
				case "image", "file":
					media = true
				case "tool_result":
					results++
				}
			}
			if media && results != 1 {
				return nil, "", errors.New("tool media requires exactly one tool result")
			}
			for _, part := range msg.Content {
				if !strings.EqualFold(strings.TrimSpace(part.Type), "tool_result") {
					continue
				}
				callID := contentPartCallID(part)
				if callID == "" {
					return nil, "", errors.New("tool result is missing a call ID")
				}
				output, err := buildOpenAIResponsesToolOutput(msg, part, media)
				if err != nil {
					return nil, "", err
				}
				items = append(items, oresponses.ResponseInputItemUnionParam{
					OfFunctionCallOutput: &oresponses.ResponseInputItemFunctionCallOutputParam{CallID: openai.String(callID), Output: output},
				})
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
				name := providerHistoryToolWireName(contentPartToolName(part), aliases)
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
	return items, instructions, nil
}

func contentPartCallID(part ContentPart) string {
	if id := strings.TrimSpace(part.ToolCallID); id != "" {
		return id
	}
	return strings.TrimSpace(part.ToolUseID)
}

func contentPartToolResultText(part ContentPart) string {
	if text := strings.TrimSpace(part.Text); text != "" {
		return text
	}
	return string(part.JSON)
}

func buildOpenAIResponsesToolOutput(msg Message, result ContentPart, media bool) (oresponses.ResponseInputItemFunctionCallOutputOutputUnionParam, error) {
	if !media {
		return oresponses.ResponseInputItemFunctionCallOutputOutputUnionParam{OfString: openai.String(contentPartToolResultText(result))}, nil
	}
	content := make(oresponses.ResponseFunctionCallOutputItemListParam, 0, len(msg.Content))
	for _, part := range msg.Content {
		switch strings.ToLower(strings.TrimSpace(part.Type)) {
		case "text", "tool_result":
			if text := contentPartToolResultText(part); text != "" {
				content = append(content, oresponses.ResponseFunctionCallOutputItemUnionParam{OfInputText: &oresponses.ResponseInputTextContentParam{Text: text}})
			}
		case "image":
			if strings.TrimSpace(part.FileURI) == "" {
				return oresponses.ResponseInputItemFunctionCallOutputOutputUnionParam{}, errors.New("tool image has no resolved input")
			}
			content = append(content, oresponses.ResponseFunctionCallOutputItemUnionParam{OfInputImage: &oresponses.ResponseInputImageContentParam{
				ImageURL: openai.String(part.FileURI), Detail: oresponses.ResponseInputImageContentDetailAuto,
			}})
		case "file":
			file := oresponses.ResponseInputFileContentParam{Filename: openai.String(part.Text)}
			if data, ok := extractDataURLBase64(part.FileURI); ok {
				file.FileData = openai.String(data)
			} else if strings.HasPrefix(part.FileURI, "https://") || strings.HasPrefix(part.FileURI, "http://") {
				file.FileURL = openai.String(part.FileURI)
			} else {
				return oresponses.ResponseInputItemFunctionCallOutputOutputUnionParam{}, errors.New("tool file has no supported resolved input")
			}
			content = append(content, oresponses.ResponseFunctionCallOutputItemUnionParam{OfInputFile: &file})
		}
	}
	return oresponses.ResponseInputItemFunctionCallOutputOutputUnionParam{OfResponseFunctionCallOutputItemArray: content}, nil
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
	prepared, err := p.prepareTurn(ctx, req)
	if err != nil {
		return ModelGatewayResult{}, err
	}
	defer prepared.Close()
	return prepared.StreamTurn(ctx, onEvent)
}

func (p *anthropicProvider) prepareTurn(ctx context.Context, req ModelGatewayRequest) (preparedModelGatewayTurn, error) {
	if p == nil {
		return nil, errors.New("nil provider")
	}
	if req.PreviousState != nil {
		return nil, errors.New("opaque continuation state is not supported by Anthropic")
	}
	if strings.TrimSpace(req.Model) == "" {
		return nil, errors.New("missing model")
	}
	if err := validateGatewayAttachmentParts(req.Messages, "anthropic"); err != nil {
		return nil, err
	}
	tools := buildAnthropicTools(req.Tools)
	messages, err := buildAnthropicMessages(req.Messages)
	if err != nil {
		return nil, err
	}
	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(strings.TrimSpace(req.Model)),
		MaxTokens: modelGatewayDefaultMaxOutputTokens,
		Messages:  messages,
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
		return nil, err
	}
	if system := collectSystemPrompt(req.Messages); strings.TrimSpace(system) != "" {
		params.System = []anthropic.TextBlockParam{{Text: strings.TrimSpace(system)}}
	}

	return newPreparedModelWire("anthropic", req.Model, flprovider.RequestFormatAnthropic, params, req, providerToolAliases{}, func(ctx context.Context, payload []byte, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
		return p.streamPreparedTurn(ctx, payload, onEvent)
	})
}

func (p *anthropicProvider) streamPreparedTurn(ctx context.Context, payload []byte, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	var httpResponse *http.Response
	err := p.client.Post(ctx, "v1/messages", nil, &httpResponse, aoption.WithRequestBody("application/json", payload), aoption.WithMiddleware(func(r *http.Request, next aoption.MiddlewareNext) (*http.Response, error) {
		res, err := next(r)
		markProviderResponseReceived(res)
		return res, err
	}))
	if err != nil {
		return ModelGatewayResult{}, providerRequestFailure(err, httpResponse, "anthropic")
	}
	stream := assestream.NewDecoder(httpResponse)

	defer func() { _ = stream.Close() }()
	msg := anthropic.Message{}
	failed := func(cause error) (ModelGatewayResult, error) {
		usage, err := turnUsageFromAnthropic(msg.Usage)
		if err != nil {
			return ModelGatewayResult{}, fmt.Errorf("normalize Anthropic response usage: %w", err)
		}
		return ModelGatewayResult{Usage: usage}, cause
	}
	gotStop := false
	var textBuf strings.Builder

	type partialCall struct {
		Index int64
		ID    string
		Name  string

		Started  bool
		Ended    bool
		ArgsRaw  strings.Builder
		ArgsSent int
		Args     map[string]any
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
		raw := pc.ArgsRaw.String()
		if len(raw) <= pc.ArgsSent {
			return
		}
		delta := raw[pc.ArgsSent:]
		pc.ArgsSent = len(raw)
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallDelta, Text: delta, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.ID), Name: strings.TrimSpace(pc.Name)}})
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
		emitDelta(pc)
		emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallEnd, ToolCall: &PartialToolCall{ID: strings.TrimSpace(pc.ID), Name: strings.TrimSpace(pc.Name), Arguments: cloneAnyMap(args)}})
	}

	for stream.Next() {
		wire := stream.Event()
		if wire.Type == "error" {
			return failed(providerStreamFailure(string(wire.Data), httpResponse, "anthropic"))
		}
		if wire.Type == "ping" {
			continue
		}
		var event anthropic.MessageStreamEventUnion
		if err := json.Unmarshal(wire.Data, &event); err != nil {
			return failed(err)
		}
		if event.Type == "message_stop" {
			gotStop = true
		}
		if err := msg.Accumulate(event); err != nil {
			return failed(err)
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
		return failed(providerRequestFailure(err, httpResponse, "anthropic"))
	}
	if !gotStop {
		return failed(flprovider.WithRetryAdvice(errors.New("provider stream closed without message_stop"), flprovider.RetryAdvice{Category: flprovider.RetryStreamInterrupted}))
	}

	usage, err := turnUsageFromAnthropic(msg.Usage)
	if err != nil {
		return ModelGatewayResult{}, fmt.Errorf("normalize Anthropic usage: %w", err)
	}
	result := ModelGatewayResult{
		FinishReason:    mapAnthropicStopReason(msg.StopReason),
		Text:            strings.TrimSpace(textBuf.String()),
		Usage:           usage,
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
			call := ToolCall{ID: callID, Name: toolName, Args: args}
			result.ToolCalls = append(result.ToolCalls, call)
			raw := ""
			if len(variant.Input) > 0 {
				raw = string(variant.Input)
			}
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallStart, ToolCall: &PartialToolCall{ID: call.ID, Name: call.Name}})
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallDelta, Text: raw, ToolCall: &PartialToolCall{ID: call.ID, Name: call.Name}})
			emitProviderEvent(onEvent, StreamEvent{Type: StreamEventToolCallEnd, ToolCall: &PartialToolCall{ID: call.ID, Name: call.Name, Arguments: cloneProviderToolArguments(call.Args)}})
		}
	}
	if len(result.ToolCalls) > 0 {
		result.FinishReason = "tool_calls"
	}
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventUsage, Usage: partialUsageFromTurnUsage(result.Usage)})
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventFinishReason, FinishHint: result.FinishReason})
	return result, nil
}

func buildAnthropicTools(defs []ToolDef) []anthropic.ToolUnionParam {
	out := make([]anthropic.ToolUnionParam, 0, len(defs))
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
			Name:        name,
			Description: anthropic.String(strings.TrimSpace(def.Description)),
			InputSchema: anthropic.ToolInputSchemaParam{Type: "object", Properties: schemaMap["properties"], Required: required},
			Strict:      anthropic.Bool(true),
		}
		out = append(out, anthropic.ToolUnionParam{OfTool: &param})
	}
	return out
}

func buildAnthropicMessages(messages []Message) ([]anthropic.MessageParam, error) {
	out := make([]anthropic.MessageParam, 0, len(messages)+1)
	for _, msg := range messages {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		if role == "system" {
			continue
		}
		blocks := make([]anthropic.ContentBlockParamUnion, 0, len(msg.Content)+1)
		for _, part := range msg.Content {
			switch strings.ToLower(strings.TrimSpace(part.Type)) {
			case "tool_call":
				callID := contentPartCallID(part)
				name := contentPartToolName(part)
				args := strings.TrimSpace(part.ArgsJSON)
				if args == "" {
					args = string(part.JSON)
				}
				if callID == "" || name == "" || !json.Valid([]byte(args)) {
					return nil, errors.New("anthropic tool call has invalid identity or arguments")
				}
				blocks = append(blocks, anthropic.NewToolUseBlock(callID, json.RawMessage(args), name))
			case "tool_result":
				callID := contentPartCallID(part)
				if callID == "" {
					return nil, errors.New("anthropic tool result is missing a call ID")
				}
				blocks = append(blocks, anthropic.NewToolResultBlock(callID, contentPartToolResultText(part), false))
			case "image":
				uri := strings.TrimSpace(part.FileURI)
				if b64, ok := extractDataURLBase64(uri); ok {
					blocks = append(blocks, anthropic.NewImageBlockBase64(part.MimeType, b64))
				} else if strings.HasPrefix(uri, "http://") || strings.HasPrefix(uri, "https://") {
					blocks = append(blocks, anthropic.NewImageBlock(anthropic.URLImageSourceParam{URL: uri}))
				} else {
					return nil, errors.New("anthropic image has no supported resolved input")
				}
			case "file":
				mime := strings.ToLower(strings.TrimSpace(part.MimeType))
				b64, ok := extractDataURLBase64(part.FileURI)
				if !ok {
					return nil, errors.New("anthropic file requires inline data")
				}
				switch {
				case mime == "application/pdf":
					blocks = append(blocks, anthropic.NewDocumentBlock(anthropic.Base64PDFSourceParam{Data: b64}))
				case isTextLikeMimeType(mime):
					decoded, err := base64.StdEncoding.DecodeString(b64)
					if err != nil {
						return nil, fmt.Errorf("decode Anthropic text file: %w", err)
					}
					blocks = append(blocks, anthropic.NewDocumentBlock(anthropic.PlainTextSourceParam{Data: string(decoded)}))
				default:
					return nil, fmt.Errorf("anthropic does not support file MIME type %q", mime)
				}
			default:
				if txt := strings.TrimSpace(part.Text); txt != "" {
					blocks = append(blocks, anthropic.NewTextBlock(txt))
				}
			}
		}
		if role == "tool" {
			var result *anthropic.ToolResultBlockParam
			content := make([]anthropic.ToolResultBlockParamContentUnion, 0, len(blocks))
			for _, block := range blocks {
				switch {
				case block.OfToolResult != nil:
					if result != nil {
						return nil, errors.New("anthropic tool message requires exactly one result")
					}
					result = block.OfToolResult
					content = append(content, result.Content...)
				case block.OfText != nil:
					content = append(content, anthropic.ToolResultBlockParamContentUnion{OfText: block.OfText})
				case block.OfImage != nil:
					content = append(content, anthropic.ToolResultBlockParamContentUnion{OfImage: block.OfImage})
				case block.OfDocument != nil:
					content = append(content, anthropic.ToolResultBlockParamContentUnion{OfDocument: block.OfDocument})
				default:
					return nil, errors.New("anthropic tool message has unsupported content")
				}
			}
			if result == nil {
				return nil, errors.New("anthropic tool message is missing its result")
			}
			result.Content = content
			blocks = []anthropic.ContentBlockParamUnion{{OfToolResult: result}}
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
	return out, nil
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
				switch route {
				case "openai-responses", "openai-chat", "anthropic":
				default:
					return fmt.Errorf("provider route %q does not support image input", route)
				}
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
	case "openai", "anthropic", "google", "moonshot", "chatglm", "deepseek", "qwen", "openrouter", "xai", "groq", "ollama", "openai_compatible", "redeven_platform", DesktopModelSourceProviderType:
		return true
	default:
		return false
	}
}

func newProviderAdapter(providerType string, baseURL string, apiKey string, strictToolSchemaOverride *bool, parallelToolCallsOverride ...parallelToolCallsWireMode) (ModelGateway, error) {
	providerType = strings.ToLower(strings.TrimSpace(providerType))
	if strings.TrimSpace(apiKey) == "" && !config.AIProviderAPIKeyOptional(providerType) {
		return nil, errors.New("missing provider api key")
	}
	strictToolSchema := resolveStrictToolSchema(providerType, baseURL, strictToolSchemaOverride)
	parallelTools := resolveParallelToolCallsWireMode(providerType, baseURL)
	if len(parallelToolCallsOverride) > 0 {
		parallelTools = parallelToolCallsOverride[0]
	}
	switch providerType {
	case "openai":
		opts := []ooption.RequestOption{ooption.WithAPIKey(strings.TrimSpace(apiKey)), ooption.WithMaxRetries(0)}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, ooption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &openAIProvider{
			providerType:      providerType,
			officialOpenAI:    isOfficialOpenAIEndpoint(providerType, baseURL),
			transportIdentity: openAIConnectionIdentity{Provider: providerType, Endpoint: normalizedOpenAIEndpoint(baseURL)},
			client:            openai.NewClient(opts...),
			strictToolSchema:  strictToolSchema,
			parallelTools:     parallelTools,
		}, nil
	case "openai_compatible", "openrouter", "xai", "groq", "ollama", "google":
		if providerType == "google" && strings.TrimSpace(baseURL) == "" {
			baseURL = "https://generativelanguage.googleapis.com/v1beta/openai/"
		}
		opts := []ooption.RequestOption{ooption.WithAPIKey(strings.TrimSpace(apiKey)), ooption.WithMaxRetries(0)}
		if strings.TrimSpace(apiKey) == "" {
			// Override ambient SDK credentials and omit authentication for keyless endpoints.
			opts = append(opts, ooption.WithHeaderDel("Authorization"))
		}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, ooption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &openAIProvider{
			providerType:      providerType,
			officialOpenAI:    isOfficialOpenAIEndpoint(providerType, baseURL),
			transportIdentity: openAIConnectionIdentity{Provider: providerType, Endpoint: normalizedOpenAIEndpoint(baseURL)},
			client:            openai.NewClient(opts...),
			strictToolSchema:  strictToolSchema,
			forceChat:         true,
			gemini:            providerType == "google",
			parallelTools:     parallelTools,
		}, nil
	case "deepseek":
		return &deepSeekProvider{baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"), apiKey: strings.TrimSpace(apiKey), strictTools: strictToolSchema}, nil
	case "chatglm":
		opts := []ooption.RequestOption{ooption.WithAPIKey(strings.TrimSpace(apiKey)), ooption.WithMaxRetries(0)}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, ooption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &openAIProvider{
			providerType:      providerType,
			officialOpenAI:    isOfficialOpenAIEndpoint(providerType, baseURL),
			transportIdentity: openAIConnectionIdentity{Provider: providerType, Endpoint: normalizedOpenAIEndpoint(baseURL)},
			client:            openai.NewClient(opts...),
			strictToolSchema:  strictToolSchema,
			forceChat:         true,
			parallelTools:     parallelTools,
		}, nil
	case "qwen":
		opts := []ooption.RequestOption{ooption.WithAPIKey(strings.TrimSpace(apiKey)), ooption.WithMaxRetries(0)}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, ooption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &openAIProvider{
			providerType:      providerType,
			officialOpenAI:    isOfficialOpenAIEndpoint(providerType, baseURL),
			transportIdentity: openAIConnectionIdentity{Provider: providerType, Endpoint: normalizedOpenAIEndpoint(baseURL)},
			client:            openai.NewClient(opts...),
			strictToolSchema:  strictToolSchema,
			forceChat:         true,
			parallelTools:     parallelTools,
		}, nil
	case "moonshot":
		opts := []ooption.RequestOption{ooption.WithAPIKey(strings.TrimSpace(apiKey)), ooption.WithMaxRetries(0)}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, ooption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &moonshotProvider{
			client:           openai.NewClient(opts...),
			strictToolSchema: strictToolSchema,
		}, nil
	case "anthropic":
		opts := []aoption.RequestOption{aoption.WithAPIKey(strings.TrimSpace(apiKey)), aoption.WithMaxRetries(0)}
		if strings.TrimSpace(baseURL) != "" {
			// The Messages SDK appends v1/messages. Accept the versioned base
			// previously saved by Flower without duplicating the API version.
			baseURL = strings.TrimSpace(baseURL)
			if endpoint, err := url.Parse(baseURL); err == nil {
				endpoint.Path = strings.TrimSuffix(strings.TrimRight(endpoint.Path, "/"), "/v1")
				baseURL = endpoint.String()
			}
			opts = append(opts, aoption.WithBaseURL(baseURL))
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
	if providerType == "google" || providerType == "openai_compatible" || providerType == "chatglm" || providerType == "deepseek" || providerType == "qwen" || providerType == "openrouter" || providerType == "xai" || providerType == "groq" || providerType == "ollama" {
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
		payload, err := modelToolResultPayload(result)
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

func updateTodoRuntimeState(state *todoRuntimeState, calls []ToolCall, results []ToolResult, round int) {
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

func (r *run) buildLayeredSystemPrompt(permissionType string, capability runCapabilityContract) string {
	snapshot := buildPromptRuntimeSnapshot(permissionType, capability)
	document := buildPromptDocument(snapshot)
	return document.render()
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
		"# Output Integration",
		"- Embed requested images, screenshots, audio and video as ![title](source) on separate lines. Use exact returned computer:// references, existing absolute paths or supported HTTP(S) media URLs; never invent media.",
		"- For an interactive HTML preview, use an absolute .html link or a fenced block with the exact info string `html preview`; an ordinary `html` fence only shows code. Keep previews self-contained (inline CSS/JS, embedded images): no network, storage, shell, external scripts, frames, forms or sibling assets. Limits: HTML 1 MB, local media 64 MiB.",
	}
}

func buildSkillCatalogPrompt(skills []SkillMeta) string {
	if len(skills) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("## Skills\n")
	sb.WriteString("Current skill catalog. Follow the current request's capability policy for activation.\n")
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
			sb.WriteString(part.Text)
		}
	}
	return sb.String()
}

func extractOpenAIURLSources(resp oresponses.Response) []SourceRef {
	var out []SourceRef
	offset := 0
	for _, item := range resp.Output {
		if item.Type != "message" {
			continue
		}
		for _, part := range item.Content {
			if part.Type != "output_text" {
				continue
			}
			count := utf8.RuneCountInString(part.Text)
			for _, ann := range part.Annotations {
				if ann.Type != "url_citation" {
					continue
				}
				source := SourceRef{Title: ann.Title, URL: ann.URL}
				// JSON presence is required: missing offsets must not bind at zero.
				var raw struct {
					Start *int `json:"start_index"`
					End   *int `json:"end_index"`
				}
				_ = json.Unmarshal([]byte(ann.RawJSON()), &raw)
				if raw.Start != nil && raw.End != nil && *raw.Start >= 0 && *raw.End > *raw.Start && *raw.End <= count {
					start, end := offset+*raw.Start, offset+*raw.End
					source.StartIndex, source.EndIndex = &start, &end
				}
				out = append(out, source)
			}
			offset += count
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

type providerToolAliases struct {
	canonicalToWire map[string]string
	wireToCanonical map[string]string
	argumentRules   map[string]*strictArgumentRule
}

func newOpenAIProviderToolAliases(defs []ToolDef) (providerToolAliases, error) {
	aliases := providerToolAliases{
		canonicalToWire: make(map[string]string, len(defs)),
		wireToCanonical: make(map[string]string, len(defs)),
	}
	register := func(canonical string) error {
		canonical = strings.TrimSpace(canonical)
		if canonical == "" {
			return nil
		}
		switch canonical {
		case "terminal_exec", "terminal_read", "terminal_write", "terminal_terminate":
			return fmt.Errorf("tool name %q is not canonical; use the dotted terminal name", canonical)
		}
		wire := openAIWireToolName(canonical)
		if existing, ok := aliases.wireToCanonical[wire]; ok && existing != canonical {
			return fmt.Errorf("OpenAI tool alias %q collides for %q and %q", wire, existing, canonical)
		}
		aliases.canonicalToWire[canonical] = wire
		aliases.wireToCanonical[wire] = canonical
		return nil
	}
	for _, def := range defs {
		if err := register(def.Name); err != nil {
			return providerToolAliases{}, err
		}
	}
	return aliases, nil
}

func contentPartToolName(part ContentPart) string {
	if name := strings.TrimSpace(part.ToolName); name != "" {
		return name
	}
	return strings.TrimSpace(part.Text)
}

func (a providerToolAliases) wireName(canonical string) string {
	return a.canonicalToWire[strings.TrimSpace(canonical)]
}

func (a providerToolAliases) canonicalName(wire string) string {
	wire = strings.TrimSpace(wire)
	if canonical := a.wireToCanonical[wire]; canonical != "" {
		return canonical
	}
	if _, ok := a.canonicalToWire[wire]; ok {
		return wire
	}
	return ""
}

func openAIWireToolName(name string) string {
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

func canonicalProviderToolName(name string, aliases providerToolAliases) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	if canonical := aliases.canonicalName(name); canonical != "" {
		return canonical
	}
	return name
}

func providerHistoryToolWireName(name string, aliases providerToolAliases) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	if wire := aliases.wireName(name); wire != "" {
		return wire
	}
	return openAIWireToolName(name)
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
