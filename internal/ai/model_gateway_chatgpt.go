package ai

import (
	"encoding/json"
	"errors"

	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/floegence/redeven/internal/chatgpt"
	"github.com/openai/openai-go/v3/packages/param"
	oresponses "github.com/openai/openai-go/v3/responses"
)

const chatGPTStateKind = "openai_chatgpt_native_v1"
const chatGPTToolNamespace = "redeven"

// Floret owns output reconciliation; this bridge preserves SDK native bytes and
// maps typed structural failures into Redeven's durable diagnostic envelope.
type responsesCompletedItems struct {
	output      flprovider.ResponsesOutput
	diagnostics []responsesOutputDiagnostic
}

func (c *responsesCompletedItems) add(index int64, item oresponses.ResponseOutputItemUnion) error {
	return responsesOutputFailure(c.output.Add(index, json.RawMessage(item.RawJSON())))
}

func (c *responsesCompletedItems) complete(snapshot []oresponses.ResponseOutputItemUnion) ([]oresponses.ResponseOutputItemUnion, error) {
	raw := make([]json.RawMessage, len(snapshot))
	for i, item := range snapshot {
		raw[i] = json.RawMessage(item.RawJSON())
	}
	output, details, err := c.output.CompleteWithDiagnostics(raw)
	if err != nil {
		return nil, responsesOutputFailure(err)
	}
	c.diagnostics = nil
	for _, detail := range details {
		c.diagnostics = append(c.diagnostics, projectResponsesOutputDiagnostic(detail))
	}
	result := make([]oresponses.ResponseOutputItemUnion, len(output))
	for i, item := range output {
		if err := json.Unmarshal(item, &result[i]); err != nil {
			return nil, &providerValidationError{code: responseOutputInvalid, cause: err}
		}
	}
	return result, nil
}

func responsesOutputFailure(err error) error {
	var failure *flprovider.ResponsesOutputError
	if !errors.As(err, &failure) {
		return err
	}
	result := &providerValidationError{code: providerValidationCode(failure.Code), cause: err, outputIndex: failure.OutputIndex, outputFields: failure.Fields}
	if failure.Detail != nil {
		detail := projectResponsesOutputDiagnostic(*failure.Detail)
		result.outputDetail = &detail
	}
	return result
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
				return nil, &providerValidationError{code: responseHistoryPreparationFailed}
			}
		} else {
			previous = &flprovider.State{Kind: state.Kind, ID: state.ID, ReusePolicy: state.ReusePolicy, Attributes: state.Attributes}
		}
	}
	history, err := flprovider.PrepareResponsesHistory(options, canonical, previous)
	if err != nil {
		return nil, &providerValidationError{code: responseHistoryPreparationFailed, cause: err}
	}
	return history, nil
}

func responsesInput(items []json.RawMessage) oresponses.ResponseInputParam {
	out := make(oresponses.ResponseInputParam, 0, len(items))
	for _, raw := range items {
		out = append(out, param.Override[oresponses.ResponseInputItemUnionParam](raw))
	}
	return out
}

const responsesNativeStateKind = "openai_responses_native_v1"

func (p *openAIProvider) responsesState(history *flprovider.ResponsesHistory, result ModelGatewayResult, completed oresponses.Response, aliases providerToolAliases) (*ModelGatewayState, error) {
	parts := []ContentPart{}
	for _, call := range result.ToolCalls {
		raw, err := json.Marshal(call.Args)
		if err != nil {
			return nil, err
		}
		parts = append(parts, ContentPart{Type: "tool_call", ToolCallID: call.ID, ToolName: call.Name, ArgsJSON: string(raw)})
	}
	calls, _, err := buildOpenAIInput([]Message{{Role: "assistant", Content: parts}}, aliases)
	if err != nil {
		return nil, err
	}
	namespace := ""
	if p.chatGPT {
		namespace = chatGPTToolNamespace
	}
	callItems, err := canonicalResponsesInput(calls, namespace)
	if err != nil {
		return nil, err
	}
	output := []json.RawMessage{}
	for _, item := range completed.Output {
		raw := json.RawMessage(item.RawJSON())
		if !json.Valid(raw) {
			return nil, &providerValidationError{code: responseOutputInvalid}
		}
		output = append(output, raw)
	}
	if len(output) == 0 {
		return nil, &providerValidationError{code: responseOutputMissing}
	}
	state, err := history.CommitAssistant(completed.ID, result.Text, callItems, output)
	if err != nil {
		return nil, &providerValidationError{code: responseHistoryCommitFailed, cause: err}
	}
	return &ModelGatewayState{Kind: state.Kind, ID: state.ID, ReusePolicy: state.ReusePolicy, Attributes: state.Attributes}, nil
}

type responsesStreamContext struct {
	Request ModelGatewayRequest
	History *flprovider.ResponsesHistory
}
