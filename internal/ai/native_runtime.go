package ai

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	aoption "github.com/anthropics/anthropic-sdk-go/option"
	contextcompactor "github.com/floegence/redeven-agent/internal/ai/context/compactor"
	contextmodel "github.com/floegence/redeven-agent/internal/ai/context/model"
	"github.com/floegence/redeven-agent/internal/config"
	openai "github.com/openai/openai-go"
	ooption "github.com/openai/openai-go/option"
	oresponses "github.com/openai/openai-go/responses"
	oshared "github.com/openai/openai-go/shared"
)

const (
	nativeDefaultMaxSteps        = 24
	nativeDefaultMaxOutputTokens = 4096
	nativeDefaultNoToolRounds    = 2
	nativeCompactThreshold       = 0.70
	nativeDefaultContextLimit    = 128000
	// nativeHardMaxSteps is the absolute safety net for the task-driven loop.
	// The loop is now driven by completion signals (task_complete, ask_user,
	// implicit_complete), NOT by a step budget. This constant only prevents
	// runaway loops caused by bugs.
	nativeHardMaxSteps = 200
)

type openAIProvider struct {
	client           openai.Client
	strictToolSchema bool
}

func (p *openAIProvider) StreamTurn(ctx context.Context, req TurnRequest, onEvent func(StreamEvent)) (TurnResult, error) {
	if p == nil {
		return TurnResult{}, errors.New("nil provider")
	}
	if strings.TrimSpace(req.Model) == "" {
		return TurnResult{}, errors.New("missing model")
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

	inputItems, instructions := buildOpenAIInput(req.Messages, p.strictToolSchema)
	if len(inputItems) == 0 {
		inputItems = append(inputItems, oresponses.ResponseInputItemParamOfMessage("Continue.", oresponses.EasyInputMessageRoleUser))
	}
	params.Input = oresponses.ResponseNewParamsInputUnion{OfInputItemList: inputItems}
	if strings.TrimSpace(instructions) != "" {
		params.Instructions = openai.String(strings.TrimSpace(instructions))
	}
	tools, aliasToReal := buildOpenAITools(req.Tools, p.strictToolSchema)
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
	if !gotCompleted {
		return TurnResult{}, errors.New("missing response.completed event")
	}

	result := TurnResult{
		FinishReason: mapOpenAIStatus(completed.Status),
		Text:         strings.TrimSpace(textBuf.String()),
		Usage: TurnUsage{
			InputTokens:     completed.Usage.InputTokens,
			OutputTokens:    completed.Usage.OutputTokens,
			ReasoningTokens: completed.Usage.OutputTokensDetails.ReasoningTokens,
		},
		RawProviderDiag: map[string]any{"response_id": strings.TrimSpace(completed.ID)},
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
	if len(result.ToolCalls) > 0 {
		result.FinishReason = "tool_calls"
	}
	if result.Text == "" {
		result.Text = strings.TrimSpace(extractOpenAIResponseText(completed))
	}
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventUsage, Usage: &PartialUsage{InputTokens: result.Usage.InputTokens, OutputTokens: result.Usage.OutputTokens, ReasoningTokens: result.Usage.ReasoningTokens}})
	emitProviderEvent(onEvent, StreamEvent{Type: StreamEventFinishReason, FinishHint: result.FinishReason})
	return result, nil
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

func buildOpenAIInput(messages []Message, includeAssistantOutputMessages bool) (oresponses.ResponseInputParam, string) {
	items := make(oresponses.ResponseInputParam, 0, len(messages)+2)
	instructions := ""
	assistantMsgSeq := 0
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
			}
			if !includeAssistantOutputMessages {
				for _, part := range msg.Content {
					if strings.ToLower(strings.TrimSpace(part.Type)) != "tool_call" {
						continue
					}
					appendFunctionCall(part)
				}
				continue
			}

			outputContent := make([]oresponses.ResponseOutputMessageContentUnionParam, 0, len(msg.Content))
			appendOutputText := func(text string) {
				text = strings.TrimSpace(text)
				if text == "" {
					return
				}
				outputContent = append(outputContent, oresponses.ResponseOutputMessageContentUnionParam{
					OfOutputText: &oresponses.ResponseOutputTextParam{
						Text:        text,
						Annotations: []oresponses.ResponseOutputTextAnnotationUnionParam{},
					},
				})
			}
			flushOutputMessage := func() {
				if len(outputContent) == 0 {
					return
				}
				assistantMsgSeq++
				// OpenAI Responses requires output message IDs to start with "msg_".
				msgID := fmt.Sprintf("msg_hist%d", assistantMsgSeq)
				items = append(items, oresponses.ResponseInputItemParamOfOutputMessage(
					outputContent,
					msgID,
					oresponses.ResponseOutputMessageStatusCompleted,
				))
				outputContent = outputContent[:0]
			}
			for _, part := range msg.Content {
				switch strings.ToLower(strings.TrimSpace(part.Type)) {
				case "text":
					appendOutputText(part.Text)
				case "tool_call":
					flushOutputMessage()
					appendFunctionCall(part)
				}
			}
			if len(outputContent) == 0 {
				appendOutputText(joinMessageText(msg))
			}
			flushOutputMessage()
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
				// Backward-compatible fallback: collapse text parts into a single string message.
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
	case "openai", "openai_compatible", "anthropic":
		return true
	default:
		return false
	}
}

func newProviderAdapter(providerType string, baseURL string, apiKey string) (Provider, error) {
	providerType = strings.ToLower(strings.TrimSpace(providerType))
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("missing provider api key")
	}
	switch providerType {
	case "openai":
		opts := []ooption.RequestOption{ooption.WithAPIKey(strings.TrimSpace(apiKey))}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, ooption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &openAIProvider{
			client:           openai.NewClient(opts...),
			strictToolSchema: shouldUseStrictOpenAIToolSchema(providerType, baseURL),
		}, nil
	case "openai_compatible":
		opts := []ooption.RequestOption{ooption.WithAPIKey(strings.TrimSpace(apiKey))}
		if strings.TrimSpace(baseURL) != "" {
			opts = append(opts, ooption.WithBaseURL(strings.TrimSpace(baseURL)))
		}
		return &openAIProvider{
			client:           openai.NewClient(opts...),
			strictToolSchema: shouldUseStrictOpenAIToolSchema(providerType, baseURL),
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

func shouldUseStrictOpenAIToolSchema(providerType string, baseURL string) bool {
	providerType = strings.ToLower(strings.TrimSpace(providerType))
	if providerType == "openai_compatible" {
		// Compatible gateways vary widely in strict function schema support; disable strict mode by default.
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

func (r *run) runNative(ctx context.Context, req RunRequest, providerCfg config.AIProvider, apiKey string, taskObjective string) error {
	if r == nil {
		return errors.New("nil run")
	}
	providerType := strings.ToLower(strings.TrimSpace(providerCfg.Type))
	_, modelName, ok := strings.Cut(strings.TrimSpace(req.Model), "/")
	if !ok {
		modelName = strings.TrimSpace(req.Model)
	}
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return r.failRun("Invalid model id", fmt.Errorf("invalid model id %q", strings.TrimSpace(req.Model)))
	}
	capability := contextmodel.NormalizeCapability(req.ModelCapability)
	if capability.ModelName == "" {
		capability.ModelName = modelName
	}
	if capability.ProviderID == "" {
		providerID, _, _ := strings.Cut(strings.TrimSpace(req.Model), "/")
		capability.ProviderID = strings.TrimSpace(providerID)
	}
	req.ModelCapability = capability
	if !capability.SupportsReasoningTokens {
		req.Options.ThinkingBudgetTokens = 0
	}
	if !capability.SupportsStrictJSONSchema && strings.EqualFold(strings.TrimSpace(req.Options.ResponseFormat), "json_schema") {
		req.Options.ResponseFormat = "json_object"
	}

	maxSteps := req.Options.MaxSteps
	if maxSteps <= 0 {
		maxSteps = nativeDefaultMaxSteps
	}
	if maxSteps > nativeHardMaxSteps {
		maxSteps = nativeHardMaxSteps
	}
	maxNoToolRounds := req.Options.MaxNoToolRounds
	if maxNoToolRounds <= 0 {
		maxNoToolRounds = nativeDefaultNoToolRounds
	}

	mode := normalizeRunMode(req.Options.Mode, r.cfg.EffectiveMode())
	req.Options.Mode = mode
	r.runMode = mode
	intent := normalizeRunIntent(req.Options.Intent)
	req.Options.Intent = intent

	execCtx := ctx
	var cancelMaxWall context.CancelFunc
	if r.maxWallTime > 0 {
		execCtx, cancelMaxWall = context.WithTimeout(execCtx, r.maxWallTime)
		defer cancelMaxWall()
	}

	touchActivity := func() {}
	if r.idleTimeout > 0 {
		idleCtx, cancelIdle := context.WithCancel(execCtx)
		execCtx = idleCtx
		activityCh := make(chan struct{}, 1)
		idleDone := make(chan struct{})
		defer close(idleDone)
		defer cancelIdle()

		touchActivity = func() {
			select {
			case activityCh <- struct{}{}:
			default:
			}
		}

		touchActivity()
		go func() {
			idleTimer := time.NewTimer(r.idleTimeout)
			defer idleTimer.Stop()
			for {
				select {
				case <-idleDone:
					return
				case <-idleCtx.Done():
					return
				case <-activityCh:
					if !idleTimer.Stop() {
						select {
						case <-idleTimer.C:
						default:
						}
					}
					idleTimer.Reset(r.idleTimeout)
				case <-idleTimer.C:
					r.requestCancel("timed_out")
					cancelIdle()
					return
				}
			}
		}()
	}

	adapter, err := newProviderAdapter(providerType, strings.TrimSpace(providerCfg.BaseURL), strings.TrimSpace(apiKey))
	if err != nil {
		return r.failRun("Failed to initialize provider adapter", err)
	}

	r.persistRunEvent("native.runtime.start", RealtimeStreamKindLifecycle, map[string]any{
		"provider_type": providerType,
		"model":         modelName,
		"max_steps":     maxSteps,
		"mode":          mode,
		"intent":        intent,
	})

	if intent == RunIntentSocial {
		return r.runNativeSocial(execCtx, adapter, providerType, modelName, mode, req)
	}

	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, r); err != nil {
		return r.failRun("Failed to initialize tool registry", err)
	}
	modeFilter := ModeToolFilter(DefaultModeToolFilter{})
	if len(r.toolAllowlist) > 0 {
		allow := make(map[string]struct{}, len(r.toolAllowlist))
		for name := range r.toolAllowlist {
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			allow[name] = struct{}{}
		}
		modeFilter = allowlistModeToolFilter{base: modeFilter, allowlist: allow}
	}
	scheduler, err := NewCoreToolScheduler(registry, modeFilter)
	if err != nil {
		return r.failRun("Failed to initialize tool scheduler", err)
	}
	r.ensureSkillManager()

	loop := AgentLoop{
		runID:  strings.TrimSpace(r.id),
		parent: nil,
		depth:  0,
		budget: LoopBudget{MaxSteps: maxSteps},
		deriveBudget: func(parent LoopBudget, hint BudgetHint) LoopBudget {
			child := parent
			if hint.MaxSteps > 0 && hint.MaxSteps < child.MaxSteps {
				child.MaxSteps = hint.MaxSteps
			}
			if child.MaxSteps <= 0 {
				child.MaxSteps = nativeDefaultMaxSteps
			}
			return child
		},
	}
	_ = loop

	if strings.TrimSpace(req.ContextPack.Objective) != "" {
		taskObjective = strings.TrimSpace(req.ContextPack.Objective)
	}
	state := newRuntimeState(taskObjective)
	messages := buildMessagesForRun(req)
	contextLimit := nativeDefaultContextLimit
	if req.ModelCapability.MaxContextTokens > 0 {
		contextLimit = req.ModelCapability.MaxContextTokens
	}
	runtimeCompactor := contextcompactor.New(nil)

	recoveryCount := 0
	noToolRounds := 0
	lastSignature := ""
	signatureHits := map[string]int{}
	failedSignatures := map[string]bool{}
	mistakeWindow := make([]int, 0, 8)
	exceptionOverlay := ""
	isFirstRound := true

	appendMistake := func(score int) {
		mistakeWindow = append(mistakeWindow, score)
		if len(mistakeWindow) > 8 {
			mistakeWindow = append([]int(nil), mistakeWindow[len(mistakeWindow)-8:]...)
		}
	}
	mistakeSum := func() int {
		sum := 0
		for _, v := range mistakeWindow {
			sum += v
		}
		return sum
	}
	resetMistakes := func() {
		mistakeWindow = mistakeWindow[:0]
	}
	endAskUser := func(step int, question string) error {
		question = strings.TrimSpace(question)
		if question == "" {
			question = "I need clarification to continue safely."
		}
		prefix := ""
		if r.hasNonEmptyAssistantText() {
			prefix = "\n\n"
		}
		_ = r.appendTextDelta(prefix + question)
		r.setFinalizationReason("ask_user_waiting")
		r.setEndReason("complete")
		r.emitLifecyclePhase("ended", map[string]any{"reason": "ask_user_waiting", "step_index": step})
		r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
		return nil
	}

	for step := 0; ; step++ {
		// Safety net — absolute maximum to prevent infinite loop bugs.
		// The loop is task-driven: it exits via task_complete, ask_user,
		// or implicit_complete. This cap should never be reached in
		// normal operation.
		if step >= nativeHardMaxSteps {
			break
		}
		touchActivity()
		if r.finalizeIfContextCanceled(execCtx) {
			return nil
		}

		activeTools := scheduler.ActiveTools(mode)
		systemPrompt := r.buildLayeredSystemPrompt(taskObjective, mode, step, maxSteps, isFirstRound, activeTools, state, exceptionOverlay)
		turnMessages := composeTurnMessages(systemPrompt, messages)
		turnReq := TurnRequest{
			Model:            modelName,
			Messages:         turnMessages,
			Tools:            activeTools,
			Budgets:          TurnBudgets{MaxSteps: maxSteps, MaxInputTokens: req.Options.MaxInputTokens, MaxOutputToken: req.Options.MaxOutputTokens, MaxCostUSD: req.Options.MaxCostUSD},
			ModeFlags:        ModeFlags{Mode: mode, ReasoningOnly: req.Options.ReasoningOnly},
			ProviderControls: ProviderControls{ThinkingBudgetTokens: req.Options.ThinkingBudgetTokens, CacheControl: req.Options.CacheControl, ResponseFormat: req.Options.ResponseFormat, Temperature: req.Options.Temperature, TopP: req.Options.TopP},
		}

		estimateTokens, estimateSource := estimateTurnTokens(providerType, turnReq)
		state.EstimateSource = estimateSource
		pressure := float64(estimateTokens) / float64(contextLimit)
		if pressure >= nativeCompactThreshold {
			if req.ContextPack.ThreadID != "" {
				targetTokens := req.Options.MaxInputTokens
				if targetTokens <= 0 {
					targetTokens = contextLimit
				}
				compressed, changed, _, compactErr := runtimeCompactor.CompactPromptPack(execCtx, strings.TrimSpace(r.endpointID), targetTokens, req.ContextPack)
				if compactErr == nil && changed {
					req.ContextPack = compressed
					messages = buildMessagesFromPromptPack(req.ContextPack, req.Input.Text)
				} else {
					messages = compactMessages(messages)
				}
			} else {
				messages = compactMessages(messages)
			}
			state = syncRuntimeStateAfterCompact(state, messages)
			turnMessages = composeTurnMessages(systemPrompt, messages)
			turnReq.Messages = turnMessages
		}

		stepResult, stepErr := adapter.StreamTurn(execCtx, turnReq, func(event StreamEvent) {
			switch event.Type {
			case StreamEventTextDelta:
				if strings.TrimSpace(event.Text) != "" {
					touchActivity()
					_ = r.appendTextDelta(event.Text)
				}
			case StreamEventThinkingDelta:
				if strings.TrimSpace(event.Text) != "" {
					r.persistRunEvent("thinking.delta", RealtimeStreamKindLifecycle, map[string]any{"delta": truncateRunes(event.Text, 2000)})
				}
			case StreamEventToolCallDelta:
				if event.ToolCall != nil {
					_ = scheduler.HandlePartial(execCtx, *event.ToolCall)
				}
			}
		})
		if stepErr != nil {
			recoveryCount++
			if r.finalizeIfContextCanceled(execCtx) {
				return nil
			}
			if recoveryCount > 5 {
				return endAskUser(step, fmt.Sprintf("I encountered repeated errors from the AI provider and cannot continue. Last error: %s", sanitizeLogText(stepErr.Error(), 200)))
			}
			exceptionOverlay = buildRecoveryOverlay(recoveryCount, 5, stepErr, lastSignature)
			state.RecentErrors = appendLimited(state.RecentErrors, sanitizeLogText(stepErr.Error(), 300), 6)
			time.Sleep(backoffDuration(recoveryCount))
			continue
		}
		touchActivity()
		exceptionOverlay = ""
		r.persistRunEvent("native.turn.result", RealtimeStreamKindLifecycle, map[string]any{
			"step_index":    step,
			"finish_reason": strings.TrimSpace(stepResult.FinishReason),
			"tool_calls":    len(stepResult.ToolCalls),
			"usage": map[string]any{
				"input_tokens":     stepResult.Usage.InputTokens,
				"output_tokens":    stepResult.Usage.OutputTokens,
				"reasoning_tokens": stepResult.Usage.ReasoningTokens,
			},
			"estimate_tokens": estimateTokens,
			"estimate_source": estimateSource,
		})

		normalCalls, taskCompleteCall, askUserCall := splitSignalToolCalls(stepResult.ToolCalls)
		for _, call := range normalCalls {
			state.ToolCallLedger[call.ID] = "proposed"
		}

		if len(normalCalls) > 0 {
			noToolRounds = 0
			sigByCallID := make(map[string]string, len(normalCalls))
			dispatchCalls := make([]ToolCall, 0, len(normalCalls))
			guardedResults := make(map[string]ToolResult, 4) // tool_id -> result
			hasFailedSignatureRetry := false
			for _, call := range normalCalls {
				sig := buildToolSignature(call)
				if sig != "" {
					sigByCallID[strings.TrimSpace(call.ID)] = sig
					lastSignature = sig
					if failedSignatures[sig] {
						hasFailedSignatureRetry = true
					}
					signatureHits[sig] = signatureHits[sig] + 1
					hits := signatureHits[sig]
					if hits >= 2 {
						state.NoProgressSignatures = appendLimited(state.NoProgressSignatures, sig, 8)
						r.persistRunEvent("guard.doom_loop", RealtimeStreamKindLifecycle, map[string]any{
							"signature": sig,
							"hits":      hits,
							"tool_name": strings.TrimSpace(call.Name),
						})
					}
					if hits >= 3 {
						return endAskUser(step, fmt.Sprintf("The same tool call is repeating without progress (%s). Please clarify what should change or provide missing context.", strings.TrimSpace(call.Name)))
					}
					if hits == 2 {
						guardedResults[strings.TrimSpace(call.ID)] = ToolResult{
							ToolID:   strings.TrimSpace(call.ID),
							ToolName: strings.TrimSpace(call.Name),
							Status:   toolResultStatusAborted,
							Summary:  "guard.doom_loop",
							Details:  "Repeated identical tool call blocked by doom-loop guard.",
							Data:     map[string]any{"signature": sig, "hits": hits},
						}
						if strings.TrimSpace(call.ID) != "" {
							state.ToolCallLedger[strings.TrimSpace(call.ID)] = "aborted"
						}
						continue
					}
				}
				dispatchCalls = append(dispatchCalls, call)
			}

			for _, call := range dispatchCalls {
				state.ToolCallLedger[call.ID] = "dispatched"
			}

			dispatchedResults := scheduler.Dispatch(execCtx, mode, dispatchCalls)
			resByID := make(map[string]ToolResult, len(dispatchedResults)+len(guardedResults))
			for id, tr := range guardedResults {
				resByID[strings.TrimSpace(id)] = tr
			}
			for _, tr := range dispatchedResults {
				resByID[strings.TrimSpace(tr.ToolID)] = tr
			}
			toolResults := make([]ToolResult, 0, len(normalCalls))
			for _, call := range normalCalls {
				id := strings.TrimSpace(call.ID)
				if tr, ok := resByID[id]; ok {
					toolResults = append(toolResults, tr)
				}
			}

			messages = append(messages, buildToolCallMessages(normalCalls)...)
			messages = append(messages, buildToolResultMessages(toolResults, normalCalls)...)
			state.PendingToolCalls = nil
			hasError := false
			hasSuccess := false
			hasArgumentError := false
			sawDoomLoopGuard := false
			for _, tr := range toolResults {
				if tr.Status == toolResultStatusSuccess {
					hasSuccess = true
					state.CompletedActionFacts = appendLimited(state.CompletedActionFacts, tr.ToolName+": "+strings.TrimSpace(tr.Summary), 12)
					if tr.ToolID != "" {
						state.ToolCallLedger[tr.ToolID] = "completed"
					}
					continue
				}
				hasError = true
				if tr.Summary == "tool.argument_error" {
					hasArgumentError = true
				}
				if tr.Summary == "guard.doom_loop" {
					sawDoomLoopGuard = true
				}
				state.BlockedActionFacts = appendLimited(state.BlockedActionFacts, tr.ToolName+": "+strings.TrimSpace(tr.Details), 12)
				if tr.ToolID != "" {
					if tr.Status == toolResultStatusAborted {
						state.ToolCallLedger[tr.ToolID] = "aborted"
					} else {
						state.ToolCallLedger[tr.ToolID] = "failed"
					}
				}
			}

			for _, call := range normalCalls {
				id := strings.TrimSpace(call.ID)
				sig := strings.TrimSpace(sigByCallID[id])
				if sig == "" {
					continue
				}
				if tr, ok := resByID[id]; ok && tr.Status == toolResultStatusSuccess {
					delete(failedSignatures, sig)
					continue
				}
				failedSignatures[sig] = true
			}

			if hasError && !hasSuccess {
				recoveryCount++
				failure := errors.New("tool failure")
				if sawDoomLoopGuard {
					failure = errors.New("doom-loop guard hit")
				}
				exceptionOverlay = buildRecoveryOverlay(recoveryCount, 5, failure, lastSignature)
			} else {
				recoveryCount = 0
				if hasSuccess {
					resetMistakes()
				}
			}

			if !hasSuccess {
				stepMistake := 0
				if hasArgumentError {
					stepMistake++
				}
				if hasFailedSignatureRetry {
					stepMistake++
				}
				appendMistake(stepMistake)
				if mistakeSum() >= 3 {
					return endAskUser(step, "I am not making progress due to repeated tool mistakes. Please clarify the objective or provide additional context to proceed.")
				}
			}
			isFirstRound = false
			continue
		}

		if askUserCall != nil {
			question := extractSignalText(*askUserCall, "question")
			if question == "" {
				question = "I need clarification to continue safely."
			}
			if strings.TrimSpace(stepResult.Text) == "" {
				_ = r.appendTextDelta(question)
			}
			r.setFinalizationReason("ask_user_waiting")
			r.setEndReason("complete")
			r.emitLifecyclePhase("ended", map[string]any{"reason": "ask_user_waiting", "step_index": step})
			r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
			return nil
		}

		if taskCompleteCall != nil {
			resultText := extractSignalText(*taskCompleteCall, "result")
			if resultText == "" {
				resultText = strings.TrimSpace(stepResult.Text)
			}
			if req.Options.RequireUserConfirmOnTaskComplete {
				approved, approveErr := r.waitForTaskCompleteConfirm(execCtx, resultText)
				if approveErr != nil {
					recoveryCount++
					exceptionOverlay = buildRecoveryOverlay(recoveryCount, 3, approveErr, lastSignature)
					continue
				}
				if !approved {
					messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "The user rejected completion. Continue the same objective with improved evidence."}}})
					state.PendingUserInputQueue = appendLimited(state.PendingUserInputQueue, "completion_rejected", 4)
					exceptionOverlay = "[RECOVERY] Completion rejected. Continue same objective and provide stronger evidence."
					isFirstRound = false
					continue
				}
			}
			if strings.TrimSpace(resultText) != "" && strings.TrimSpace(stepResult.Text) == "" {
				_ = r.appendTextDelta(strings.TrimSpace(resultText))
			}
			r.setFinalizationReason("task_complete")
			r.setEndReason("complete")
			r.emitLifecyclePhase("ended", map[string]any{"reason": "task_complete", "step_index": step})
			r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
			return nil
		}

		finishReason := strings.ToLower(strings.TrimSpace(stepResult.FinishReason))
		if finishReason == "length" {
			// Genuine truncation — recovery path.
			recoveryCount++
			fail := errors.New("provider output truncated (length)")
			exceptionOverlay = buildRecoveryOverlay(recoveryCount, 5, fail, "")
			messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "Continue from where you left off, without repeating previous content."}}})
			isFirstRound = false
			continue
		}
		if finishReason == "tool_calls" || finishReason == "unknown" {
			// Model wanted tools but parsing failed, or unknown state — treat as backpressure nudge.
			noToolRounds++
			exceptionOverlay = fmt.Sprintf("[BACKPRESSURE] Provider returned finish_reason=%q but no valid tool calls were parsed. You MUST do one of: (1) Call task_complete if done, (2) Use tools to investigate, (3) Call ask_user if stuck.", finishReason)
			messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "Continue from where you left off. Call a tool or task_complete."}}})
			isFirstRound = false
			continue
		}

		hasVisibleText := strings.TrimSpace(stepResult.Text) != "" || r.hasNonEmptyAssistantText()
		if !hasVisibleText {
			appendMistake(1)
			if mistakeSum() >= 3 {
				return endAskUser(step, "I am not getting usable output and cannot proceed safely. Please clarify the objective or provide more context.")
			}
			recoveryCount++
			if recoveryCount > 5 {
				return endAskUser(step, "I have been unable to produce output after multiple attempts. Please check the AI provider configuration or try rephrasing your request.")
			}
			exceptionOverlay = buildRecoveryOverlay(recoveryCount, 5, errors.New("empty output"), lastSignature)
			isFirstRound = false
			continue
		}

		if req.Options.ReasoningOnly {
			r.setFinalizationReason("implicit_complete_reasoning_only")
			r.setEndReason("complete")
			r.emitLifecyclePhase("ended", map[string]any{"reason": "implicit_complete_reasoning_only", "step_index": step})
			r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
			return nil
		}

		noToolRounds++
		if noToolRounds < maxNoToolRounds {
			exceptionOverlay = fmt.Sprintf("[BACKPRESSURE] No tool call used (%d/%d). You MUST do one of: (1) Call task_complete if the task is done, (2) Use tools to continue investigating or making changes, (3) Call ask_user if you are stuck and need clarification.", noToolRounds, maxNoToolRounds)
			messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "You must either call task_complete, use a tool, or call ask_user. Do not respond with text only."}}})
			isFirstRound = false
			continue
		}

		r.setFinalizationReason("implicit_complete_backpressure")
		r.setEndReason("complete")
		r.emitLifecyclePhase("ended", map[string]any{"reason": "implicit_complete_backpressure", "step_index": step})
		r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
		return nil
	}

	// Safety net reached (nativeHardMaxSteps). This should rarely happen in
	// normal operation — the loop is task-driven and exits via task_complete,
	// ask_user, or implicit_complete. Reaching here indicates a bug or a
	// genuinely very long task.
	r.persistRunEvent("guard.hard_max_steps", RealtimeStreamKindLifecycle, map[string]any{
		"hard_max_steps": nativeHardMaxSteps,
	})

	// Attempt one final LLM turn to produce a summary. Only provide
	// task_complete — no other tools — to force the LLM to summarize.
	summaryMsg := "You have reached the absolute step limit. Summarize what you accomplished and what remains, then call task_complete."
	messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: summaryMsg}}})
	summaryOverlay := "[FINAL SUMMARY] You have exhausted the hard step limit. You MUST call task_complete now with a detailed summary of what was done and what remains."
	summarySystemPrompt := r.buildLayeredSystemPrompt(taskObjective, mode, nativeHardMaxSteps, maxSteps, false, scheduler.ActiveTools(mode), state, summaryOverlay)
	summaryTurnMessages := composeTurnMessages(summarySystemPrompt, messages)

	signalOnlyTools := make([]ToolDef, 0, 1)
	for _, t := range scheduler.ActiveTools(mode) {
		if t.Name == "task_complete" {
			signalOnlyTools = append(signalOnlyTools, t)
			break
		}
	}
	summaryReq := TurnRequest{
		Model:            modelName,
		Messages:         summaryTurnMessages,
		Tools:            signalOnlyTools,
		Budgets:          TurnBudgets{MaxSteps: 1, MaxInputTokens: req.Options.MaxInputTokens, MaxOutputToken: req.Options.MaxOutputTokens, MaxCostUSD: req.Options.MaxCostUSD},
		ModeFlags:        ModeFlags{Mode: mode},
		ProviderControls: ProviderControls{ResponseFormat: req.Options.ResponseFormat, Temperature: req.Options.Temperature, TopP: req.Options.TopP},
	}
	summaryResult, summaryErr := adapter.StreamTurn(execCtx, summaryReq, func(event StreamEvent) {
		if event.Type == StreamEventTextDelta && strings.TrimSpace(event.Text) != "" {
			_ = r.appendTextDelta(event.Text)
		}
	})

	if summaryErr != nil || strings.TrimSpace(summaryResult.Text) == "" {
		// Summary turn failed — tell user via endAskUser with specific error,
		// rather than producing a mechanical degradedSummary.
		if !r.hasNonEmptyAssistantText() {
			errMsg := "The task reached the maximum step limit and the AI provider could not produce a summary."
			if summaryErr != nil {
				errMsg = fmt.Sprintf("The task reached the maximum step limit. Summary attempt failed: %s", sanitizeLogText(summaryErr.Error(), 200))
			}
			return endAskUser(nativeHardMaxSteps, errMsg)
		}
	}

	finReason := "exhausted_summary"
	r.setFinalizationReason(finReason)
	r.setEndReason("complete")
	r.emitLifecyclePhase("ended", map[string]any{"reason": finReason})
	r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
	return nil
}

func (r *run) runNativeSocial(
	execCtx context.Context,
	adapter Provider,
	providerType string,
	modelName string,
	mode string,
	req RunRequest,
) error {
	if r == nil {
		return errors.New("nil run")
	}
	if adapter == nil {
		return r.failRun("Failed to initialize provider adapter", errors.New("nil provider adapter"))
	}
	if r.finalizeIfContextCanceled(execCtx) {
		return nil
	}

	r.emitLifecyclePhase("synthesizing", map[string]any{"intent": RunIntentSocial})
	messages := buildMessagesForRun(req)

	systemPrompt := r.buildSocialSystemPrompt()
	turnReq := TurnRequest{
		Model:            modelName,
		Messages:         composeTurnMessages(systemPrompt, messages),
		Tools:            nil,
		Budgets:          TurnBudgets{MaxSteps: 1, MaxInputTokens: req.Options.MaxInputTokens, MaxOutputToken: req.Options.MaxOutputTokens, MaxCostUSD: req.Options.MaxCostUSD},
		ModeFlags:        ModeFlags{Mode: mode, ReasoningOnly: true},
		ProviderControls: ProviderControls{ThinkingBudgetTokens: req.Options.ThinkingBudgetTokens, CacheControl: req.Options.CacheControl, ResponseFormat: req.Options.ResponseFormat, Temperature: req.Options.Temperature, TopP: req.Options.TopP},
	}
	estimateTokens, estimateSource := estimateTurnTokens(providerType, turnReq)
	stepResult, stepErr := adapter.StreamTurn(execCtx, turnReq, func(event StreamEvent) {
		switch event.Type {
		case StreamEventTextDelta:
			if strings.TrimSpace(event.Text) != "" {
				_ = r.appendTextDelta(event.Text)
			}
		case StreamEventThinkingDelta:
			if strings.TrimSpace(event.Text) != "" {
				r.persistRunEvent("thinking.delta", RealtimeStreamKindLifecycle, map[string]any{
					"delta": truncateRunes(event.Text, 2000),
				})
			}
		}
	})
	if stepErr != nil {
		if r.finalizeIfContextCanceled(execCtx) {
			return nil
		}
		return r.failRun("Failed to generate social response", stepErr)
	}

	r.persistRunEvent("native.turn.result", RealtimeStreamKindLifecycle, map[string]any{
		"step_index":    0,
		"finish_reason": strings.TrimSpace(stepResult.FinishReason),
		"tool_calls":    len(stepResult.ToolCalls),
		"usage": map[string]any{
			"input_tokens":     stepResult.Usage.InputTokens,
			"output_tokens":    stepResult.Usage.OutputTokens,
			"reasoning_tokens": stepResult.Usage.ReasoningTokens,
		},
		"estimate_tokens": estimateTokens,
		"estimate_source": estimateSource,
		"intent":          RunIntentSocial,
	})

	if !r.hasNonEmptyAssistantText() {
		if txt := strings.TrimSpace(stepResult.Text); txt != "" {
			_ = r.appendTextDelta(txt)
		}
	}
	if !r.hasNonEmptyAssistantText() {
		_ = r.appendTextDelta("Hello! I'm here. Tell me what task you want to work on.")
	}

	r.setFinalizationReason("social_reply")
	r.setEndReason("complete")
	r.emitLifecyclePhase("ended", map[string]any{"reason": "social_reply", "step_index": 0})
	r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
	return nil
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

func buildMessagesFromPromptPack(pack contextmodel.PromptPack, currentUserInput string) []Message {
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

	for _, turn := range pack.RecentDialogue {
		if txt := strings.TrimSpace(turn.UserText); txt != "" {
			messages = append(messages, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: txt}}})
		}
		if txt := strings.TrimSpace(turn.AssistantText); txt != "" {
			messages = append(messages, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: txt}}})
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

func composeTurnMessages(systemPrompt string, history []Message) []Message {
	messages := make([]Message, 0, len(history)+1)
	if strings.TrimSpace(systemPrompt) != "" {
		messages = append(messages, Message{Role: "system", Content: []ContentPart{{Type: "text", Text: strings.TrimSpace(systemPrompt)}}})
	}
	messages = append(messages, history...)
	return messages
}

func estimateTurnTokens(providerType string, req TurnRequest) (int, string) {
	providerType = strings.ToLower(strings.TrimSpace(providerType))
	factor := 4.0
	if providerType == "anthropic" {
		factor = 3.8
	}
	chars := 0
	for _, msg := range req.Messages {
		for _, part := range msg.Content {
			chars += len([]rune(part.Text))
			chars += len([]rune(part.FileURI))
			chars += len(part.JSON)
		}
	}
	for _, tool := range req.Tools {
		chars += len([]rune(tool.Name))
		chars += len([]rune(tool.Description))
		chars += len(tool.InputSchema)
	}
	estimate := int(float64(chars)/factor) + 32
	if estimate < 0 {
		estimate = 0
	}
	return estimate, "heuristic"
}

func compactMessages(messages []Message) []Message {
	if len(messages) <= 12 {
		return append([]Message(nil), messages...)
	}
	keepRecent := 10
	if keepRecent > len(messages) {
		keepRecent = len(messages)
	}
	archived := messages[:len(messages)-keepRecent]
	recent := append([]Message(nil), messages[len(messages)-keepRecent:]...)
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
	compacted = append(compacted, recent...)
	return compacted
}

func syncRuntimeStateAfterCompact(state runtimeState, messages []Message) runtimeState {
	state.PendingToolCalls = nil
	state.NoProgressSignatures = tailStrings(state.NoProgressSignatures, 6)
	state.RecentErrors = tailStrings(state.RecentErrors, 4)
	if len(messages) == 0 {
		state.ActiveObjectiveDigest = ""
	}
	return state
}

func tailStrings(in []string, keep int) []string {
	if keep <= 0 || len(in) == 0 {
		return nil
	}
	if len(in) <= keep {
		return append([]string(nil), in...)
	}
	return append([]string(nil), in[len(in)-keep:]...)
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

func splitSignalToolCalls(calls []ToolCall) (normal []ToolCall, taskComplete *ToolCall, askUser *ToolCall) {
	normal = make([]ToolCall, 0, len(calls))
	for i := range calls {
		call := calls[i]
		switch strings.TrimSpace(call.Name) {
		case "task_complete":
			if taskComplete == nil {
				copyCall := call
				taskComplete = &copyCall
			}
		case "ask_user":
			if askUser == nil {
				copyCall := call
				askUser = &copyCall
			}
		default:
			normal = append(normal, call)
		}
	}
	return normal, taskComplete, askUser
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
		payload := map[string]any{
			"status":      strings.TrimSpace(result.Status),
			"summary":     strings.TrimSpace(result.Summary),
			"details":     strings.TrimSpace(result.Details),
			"truncated":   result.Truncated,
			"content_ref": strings.TrimSpace(result.ContentRef),
		}
		if result.Data != nil {
			payload["data"] = result.Data
		}
		if result.Error != nil {
			result.Error.Normalize()
			payload["error"] = result.Error
		}
		b, _ := json.Marshal(payload)
		out = append(out, Message{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: callID, Text: string(b), JSON: b}}})
	}
	return out
}

func buildToolCallMessages(calls []ToolCall) []Message {
	if len(calls) == 0 {
		return nil
	}
	out := make([]Message, 0, len(calls))
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
		out = append(out, Message{
			Role: "assistant",
			Content: []ContentPart{{
				Type:       "tool_call",
				ToolCallID: callID,
				ToolName:   name,
				ArgsJSON:   rawArgs,
				JSON:       b,
			}},
		})
	}
	return out
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

func buildToolSignature(call ToolCall) string {
	name := strings.TrimSpace(call.Name)
	if name == "" {
		return ""
	}
	args := cloneAnyMap(call.Args)
	canonical, err := canonicalJSON(args)
	if err != nil {
		canonical = "{}"
	}
	sum := sha256.Sum256([]byte(name + "|" + canonical))
	return hex.EncodeToString(sum[:])
}

func canonicalJSON(v any) (string, error) {
	sorted := normalizeAnyForJSON(v)
	b, err := json.Marshal(sorted)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func normalizeAnyForJSON(v any) any {
	switch x := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make(map[string]any, len(x))
		for _, k := range keys {
			out[k] = normalizeAnyForJSON(x[k])
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i := range x {
			out[i] = normalizeAnyForJSON(x[i])
		}
		return out
	default:
		return x
	}
}

func buildRecoveryOverlay(used int, max int, failure error, lastSignature string) string {
	failureType := "unknown"
	if failure != nil {
		failureType = sanitizeLogText(failure.Error(), 160)
	}
	return fmt.Sprintf("[RECOVERY] Step %d/%d\nLast failure: %s\nDo NOT repeat signature: %s\nYou MUST choose one action from: repair args | switch tool | ask_user | summarize safe status.", used, max, failureType, strings.TrimSpace(lastSignature))
}

func backoffDuration(attempt int) time.Duration {
	switch attempt {
	case 1:
		return 2 * time.Second
	case 2:
		return 4 * time.Second
	default:
		return 8 * time.Second
	}
}

func (r *run) buildLayeredSystemPrompt(objective string, mode string, round int, maxSteps int, isFirstRound bool, tools []ToolDef, state runtimeState, exceptionOverlay string) string {
	core := []string{
		"# Identity & Mandate",
		"You are Redeven Agent, an autonomous AI assistant that completes tasks by using tools.",
		"Keep going until the user's task is completely resolved before ending your turn.",
		"Only call task_complete when you are confident the problem is fully solved.",
		"If you are unsure, use tools to verify your work before completing.",
		"",
		"# Tool Usage Strategy",
		"Follow this workflow for every task:",
		"1. **Investigate** — Use terminal.exec with rg/sed/cat to understand the workspace and gather context.",
		"2. **Plan** — Identify what needs to be done based on the information gathered.",
		"3. **Act** — Use apply_patch for file edits; use terminal.exec for validated command actions.",
		"4. **Verify** — Use terminal.exec to run checks (tests/lint/build) and confirm correctness.",
		"5. **Iterate** — If verification fails, diagnose the issue and repeat from step 1.",
		"",
		"# Mandatory Rules",
		"- Use tools when they are needed for reliable evidence or actions.",
		"- You MUST call task_complete with a detailed result summary when done. Never end without it.",
		"- You MUST use tools to investigate before answering questions about files, code, or the workspace.",
		"- If you can answer by reading files, use terminal.exec with rg/sed/cat first.",
		"- Prefer apply_patch for file edits instead of shell redirection or ad-hoc overwrite commands.",
		"- Use workdir/cwd fields on terminal.exec instead of running cd in the command string.",
		"- Do NOT fabricate file contents, command outputs, or tool results. Always use tools to get real data.",
		"- If information is insufficient and tools cannot help, call ask_user.",
		"",
		"# Anti-Patterns (NEVER do these)",
		"- Do NOT respond with only text when tools could answer the question.",
		"- Do NOT call task_complete without first verifying your work.",
		"- Do NOT give up after a tool error — try a different approach.",
		"- Do NOT repeat the same tool call with identical arguments.",
		"",
		"# Common Workflows",
		"- **File questions**: terminal.exec (rg --files / rg pattern / sed -n) → analyze → task_complete",
		"- **Code changes**: terminal.exec (inspect) → apply_patch → terminal.exec (verify) → task_complete",
		"- **Shell tasks**: terminal.exec → inspect output → task_complete",
		"- **Debugging**: terminal.exec (reproduce) → apply_patch fix → terminal.exec (verify) → task_complete",
		"",
		"# Search Template",
		"- Default: `rg \"<PATTERN>\" . --hidden --glob '!.git'`",
		"- If output is too large or slow, retry with: `rg \"<PATTERN>\" . --hidden --glob '!.git' --glob '!node_modules' --glob '!dist'`",
	}
	availableSkills := r.listSkills()
	activeSkills := r.activeSkills()

	cwd := strings.TrimSpace(r.fsRoot)
	toolNames := joinToolNames(tools)
	recentErrors := "none"
	if len(state.RecentErrors) > 0 {
		recentErrors = strings.Join(state.RecentErrors, " | ")
	}
	runtime := []string{
		"## Current Context",
		fmt.Sprintf("- Working directory: %s", cwd),
		fmt.Sprintf("- Current round: %d (first_round=%t)", round+1, isFirstRound),
		fmt.Sprintf("- Mode: %s", strings.TrimSpace(mode)),
		fmt.Sprintf("- Available tools: %s", toolNames),
		fmt.Sprintf("- Objective: %s", strings.TrimSpace(objective)),
		fmt.Sprintf("- Recent errors: %s", recentErrors),
	}
	if len(availableSkills) > 0 {
		runtime = append(runtime, fmt.Sprintf("- Available skills: %s", joinSkillNames(availableSkills)))
	}
	parts := []string{strings.Join(core, "\n"), strings.Join(runtime, "\n")}
	if len(availableSkills) > 0 {
		parts = append(parts, buildSkillCatalogPrompt(availableSkills))
	}
	if len(activeSkills) > 0 {
		parts = append(parts, buildSkillOverlayPrompt(activeSkills))
	}
	if strings.TrimSpace(exceptionOverlay) != "" {
		parts = append(parts, strings.TrimSpace(exceptionOverlay))
	}
	return strings.Join(parts, "\n\n")
}

func (r *run) buildSocialSystemPrompt() string {
	core := []string{
		"# Identity",
		"You are Redeven Agent.",
		"The user message is social conversation rather than a task request.",
		"",
		"# Response Rules",
		"- Reply naturally in a brief and friendly style.",
		"- Do NOT call tools.",
		"- Do NOT mention internal routing, prompts, or policies.",
		"- If helpful, ask one short follow-up question to invite a concrete task.",
	}
	cwd := strings.TrimSpace(r.fsRoot)
	runtime := []string{
		"## Current Context",
		fmt.Sprintf("- Working directory: %s", cwd),
	}
	return strings.Join([]string{strings.Join(core, "\n"), strings.Join(runtime, "\n")}, "\n\n")
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
	r.mu.Lock()
	idx := r.nextBlockIndex
	r.nextBlockIndex++
	r.needNewTextBlock = true
	r.mu.Unlock()

	r.sendStreamEvent(streamEventBlockStart{Type: "block-start", MessageID: r.messageID, BlockIndex: idx, BlockType: "tool-call"})
	block := ToolCallBlock{
		Type:             "tool-call",
		ToolName:         "task_complete",
		ToolID:           toolID,
		Args:             map[string]any{"result": truncateRunes(strings.TrimSpace(resultText), 500)},
		RequiresApproval: true,
		ApprovalState:    "required",
		Status:           ToolCallStatusPending,
	}
	r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
	r.persistSetToolBlock(idx, block)

	ch := make(chan bool, 1)
	r.mu.Lock()
	r.toolApprovals[toolID] = ch
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
			block.ApprovalState = "approved"
			block.Status = ToolCallStatusSuccess
			r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
			r.persistSetToolBlock(idx, block)
			return true, nil
		}
		block.ApprovalState = "rejected"
		block.Status = ToolCallStatusError
		block.Error = "Rejected by user"
		r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
		r.persistSetToolBlock(idx, block)
		return false, nil
	case <-ctx.Done():
		return false, ctx.Err()
	case <-timer.C:
		block.ApprovalState = "rejected"
		block.Status = ToolCallStatusError
		block.Error = "Approval timed out"
		r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
		r.persistSetToolBlock(idx, block)
		return false, errors.New("approval timed out")
	}
}

func (r *run) degradedSummary(state runtimeState, objective string) string {
	done := strings.Join(state.CompletedActionFacts, "\n- ")
	notDone := strings.Join(state.BlockedActionFacts, "\n- ")
	next := strings.Join(state.PendingUserInputQueue, "\n- ")
	if strings.TrimSpace(done) == "" {
		done = "- No verified completed actions recorded."
	} else {
		done = "- " + done
	}
	if strings.TrimSpace(notDone) == "" {
		notDone = "- No explicit blocked actions recorded."
	} else {
		notDone = "- " + notDone
	}
	if strings.TrimSpace(next) == "" {
		next = "- Provide one concrete next step (path/command) to continue."
	} else {
		next = "- " + next
	}
	goal := strings.TrimSpace(objective)
	if goal == "" {
		goal = strings.TrimSpace(state.ActiveObjectiveDigest)
	}
	if goal == "" {
		goal = "Current objective is not available."
	}
	next = next + "\n- Objective: " + truncateRunes(goal, 400)
	return fmt.Sprintf("Done\n%s\n\nNot Done\n%s\n\nNext Actions\n%s", done, notDone, next)
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

func mapOpenAIStatus(status oresponses.ResponseStatus) string {
	switch strings.TrimSpace(strings.ToLower(string(status))) {
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
