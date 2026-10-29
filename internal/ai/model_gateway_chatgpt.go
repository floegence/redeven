package ai

import (
	"encoding/json"
	"errors"
	"reflect"

	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/floegence/redeven/internal/chatgpt"
	"github.com/openai/openai-go/v3/packages/param"
	oresponses "github.com/openai/openai-go/v3/responses"
)

const chatGPTStateKind = "openai_chatgpt_native_v1"
const chatGPTToolNamespace = "redeven"

// Completed item events carry original native bytes even when the terminal
// response omits its output snapshot. This collection belongs to one request.
type responsesCompletedItems struct {
	items map[int64]oresponses.ResponseOutputItemUnion
	bytes int
}

func (c *responsesCompletedItems) add(index int64, item oresponses.ResponseOutputItemUnion) error {
	var value map[string]any
	raw := item.RawJSON()
	if len(raw) > 8<<20 {
		return errors.New("Responses native output exceeds the context state limit")
	}
	if index < 0 || json.Unmarshal([]byte(raw), &value) != nil || value == nil {
		return errors.New("invalid completed Responses output item")
	}
	if previous, exists := c.items[index]; exists {
		var old map[string]any
		_ = json.Unmarshal([]byte(previous.RawJSON()), &old)
		if !reflect.DeepEqual(old, value) {
			return errors.New("conflicting completed Responses output item")
		}
		return nil
	}
	if c.bytes+len(raw) > 8<<20 {
		return errors.New("Responses native output exceeds the context state limit")
	}
	if c.items == nil {
		c.items = make(map[int64]oresponses.ResponseOutputItemUnion)
	}
	c.items[index] = item
	c.bytes += len(raw)
	return nil
}

func (c *responsesCompletedItems) complete(snapshot []oresponses.ResponseOutputItemUnion) ([]oresponses.ResponseOutputItemUnion, error) {
	for index, item := range snapshot {
		if err := c.add(int64(index), item); err != nil {
			return nil, err
		}
	}
	if len(c.items) == 0 {
		return nil, errors.New("missing native Responses output")
	}
	if len(snapshot) > 0 && len(snapshot) != len(c.items) {
		return nil, errors.New("incomplete completed Responses output snapshot")
	}
	output := make([]oresponses.ResponseOutputItemUnion, len(c.items))
	for index := range output {
		item, exists := c.items[int64(index)]
		if !exists {
			return nil, errors.New("missing completed Responses output item")
		}
		output[index] = item
	}
	return output, nil
}

func chatGPTNamespaces(tools []oresponses.ToolUnionParam) ([]oresponses.ToolUnionParam, error) {
	out := make([]oresponses.ToolUnionParam, 0, 2)
	functions := []oresponses.NamespaceToolToolUnionParam{}
	for _, tool := range tools {
		if tool.OfFunction != nil {
			raw, err := json.Marshal(tool.OfFunction)
			if err != nil {
				return nil, err
			}
			var fn oresponses.NamespaceToolToolFunctionParam
			if err := json.Unmarshal(raw, &fn); err != nil {
				return nil, err
			}
			functions = append(functions, oresponses.NamespaceToolToolUnionParam{OfFunction: &fn})
		} else if tool.OfWebSearch != nil {
			out = append(out, tool)
		} else {
			return nil, chatgpt.Failure("subscription_sharing_unsupported_capability")
		}
	}
	if len(functions) > 0 {
		out = append(out, oresponses.ToolUnionParam{OfNamespace: &oresponses.NamespaceToolParam{Name: chatGPTToolNamespace, Description: "Redeven tools", Tools: functions}})
	}
	return out, nil
}

func canonicalResponsesInput(items oresponses.ResponseInputParam, namespace string) ([]json.RawMessage, error) {
	out := make([]json.RawMessage, 0, len(items))
	for _, item := range items {
		raw, err := json.Marshal(item)
		if err != nil {
			return nil, err
		}
		var body map[string]json.RawMessage
		if err := json.Unmarshal(raw, &body); err != nil {
			return nil, err
		}
		// History calls remain in the same namespace as their original declarations.
		if namespace != "" && string(body["type"]) == `"function_call"` {
			body["namespace"], _ = json.Marshal(namespace)
		}
		raw, err = json.Marshal(body)
		if err != nil {
			return nil, err
		}
		out = append(out, raw)
	}
	return out, nil
}

// Native history and its published envelope are owned by Floret.
func (p *openAIProvider) prepareResponsesHistory(req ModelGatewayRequest, items oresponses.ResponseInputParam) (*flprovider.ResponsesHistory, error) {
	options := flprovider.ResponsesHistoryOptions{Kind: responsesNativeStateKind, ID: req.Model}
	if p.chatGPT {
		options.Kind, options.FunctionNamespace = chatGPTStateKind, chatGPTToolNamespace
	}
	canonical, err := canonicalResponsesInput(items, options.FunctionNamespace)
	if err != nil {
		return nil, err
	}
	var previous *flprovider.State
	if state := req.PreviousState; state != nil {
		// Published API-key states contain only an ID. Keep their existing explicit
		// continuation behavior; they contain no native bytes to reconstruct. New
		// responses always publish the upstream-owned complete native envelope.
		if !p.chatGPT && state.Kind == providerContinuationKindOpenAIResponses {
			if state.ID == "" || len(state.Attributes) != 0 || state.ReusePolicy != flprovider.StateReuseExactSurface {
				return nil, errors.New("invalid published Responses ID state")
			}
		} else {
			previous = &flprovider.State{Kind: state.Kind, ID: state.ID, ReusePolicy: state.ReusePolicy, Attributes: state.Attributes}
		}
	}
	return flprovider.PrepareResponsesHistory(options, canonical, previous)
}

func responsesInput(items []json.RawMessage) oresponses.ResponseInputParam {
	out := make(oresponses.ResponseInputParam, 0, len(items))
	for _, raw := range items {
		out = append(out, param.Override[oresponses.ResponseInputItemUnionParam](raw))
	}
	return out
}

const responsesNativeStateKind = "openai_responses_native_v1"

func (p *openAIProvider) responsesState(history *flprovider.ResponsesHistory, result ModelGatewayResult, completed oresponses.Response, aliases providerToolAliases, fragments []Message) (*ModelGatewayState, error) {
	parts := []ContentPart{}
	if len(fragments) == 0 || len(fragments) == 1 && joinMessageText(fragments[0]) == "" {
		fragments = []Message{{Role: "assistant", Content: []ContentPart{{Type: "text", Text: result.Text}}}}
	}
	for _, call := range result.ToolCalls {
		raw, err := json.Marshal(call.Args)
		if err != nil {
			return nil, err
		}
		parts = append(parts, ContentPart{Type: "tool_call", ToolCallID: call.ID, ToolName: call.Name, ArgsJSON: string(raw)})
	}
	fragments = append(fragments, Message{Role: "assistant", Content: parts})
	visible, _, err := buildOpenAIInput(fragments, aliases)
	if err != nil {
		return nil, err
	}
	namespace := ""
	if p.chatGPT {
		namespace = chatGPTToolNamespace
	}
	visibleRaw, err := canonicalResponsesInput(visible, namespace)
	if err != nil {
		return nil, err
	}
	output := []json.RawMessage{}
	for _, item := range completed.Output {
		raw := json.RawMessage(item.RawJSON())
		if !json.Valid(raw) {
			return nil, errors.New("missing native Responses output bytes")
		}
		output = append(output, raw)
	}
	if len(output) == 0 {
		return nil, errors.New("missing native Responses output")
	}
	state, err := history.Commit(completed.ID, visibleRaw, output)
	if err != nil {
		return nil, err
	}
	return &ModelGatewayState{Kind: state.Kind, ID: state.ID, ReusePolicy: state.ReusePolicy, Attributes: state.Attributes}, nil
}

type responsesStreamContext struct {
	Request ModelGatewayRequest
	History *flprovider.ResponsesHistory
}
