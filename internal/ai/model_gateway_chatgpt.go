package ai

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/chatgpt"
	"github.com/openai/openai-go/v3/packages/param"
	oresponses "github.com/openai/openai-go/v3/responses"
)

const chatGPTStateKind = "openai_chatgpt_native_v1"
const chatGPTToolNamespace = "redeven"

type chatGPTNativeRecord struct {
	Start   int               `json:"start"`
	Prefix  string            `json:"prefix"`
	Visible []json.RawMessage `json:"visible"`
	Output  []json.RawMessage `json:"output"`
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
		} else if tool.OfWebSearch != nil || tool.OfWebSearchPreview != nil {
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

func canonicalInput(items oresponses.ResponseInputParam) ([]json.RawMessage, error) {
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
		if string(body["type"]) == `"function_call"` {
			body["namespace"] = json.RawMessage(`"redeven"`)
		}
		raw, err = json.Marshal(body)
		if err != nil {
			return nil, err
		}
		out = append(out, raw)
	}
	return out, nil
}
func nativeFingerprint(items []json.RawMessage) string {
	bytes, _ := json.Marshal(items)
	return fmt.Sprintf("%x", sha256.Sum256(bytes))
}
func chatGPTReplay(req ModelGatewayRequest, items oresponses.ResponseInputParam) (oresponses.ResponseInputParam, []chatGPTNativeRecord, []json.RawMessage, error) {
	canonical, err := canonicalInput(items)
	if err != nil {
		return nil, nil, nil, err
	}
	records := []chatGPTNativeRecord{}
	if state := req.PreviousState; state != nil {
		if state.Kind != chatGPTStateKind || state.ID != req.Model || len(state.Attributes) != 1 || len(state.Attributes["native_output"]) > 8<<20 {
			return nil, nil, nil, errors.New("incompatible ChatGPT provider state")
		}
		if err := json.Unmarshal([]byte(state.Attributes["native_output"]), &records); err != nil || records == nil {
			return nil, nil, nil, errors.New("invalid ChatGPT native provider state")
		}
	}
	retained := []chatGPTNativeRecord{}
	replacements := map[int]chatGPTNativeRecord{}
	for _, record := range records {
		if record.Start < 0 || record.Prefix == "" || len(record.Output) == 0 {
			return nil, nil, nil, errors.New("invalid ChatGPT native output record")
		}
		for _, raw := range record.Output {
			var item struct {
				Type      string `json:"type"`
				Namespace string `json:"namespace"`
			}
			if json.Unmarshal(raw, &item) != nil || !strings.Contains("|reasoning|message|function_call|web_search_call|", "|"+item.Type+"|") || item.Type == "function_call" && item.Namespace != chatGPTToolNamespace {
				return nil, nil, nil, errors.New("unsupported ChatGPT native output")
			}
		}
		// Compaction/fork may remove an output's canonical prefix. Only records
		// still bound to this exact projected history can be reused.
		if record.Start > len(canonical) || nativeFingerprint(canonical[:record.Start]) != record.Prefix {
			continue
		}
		end := record.Start + len(record.Visible)
		if end > len(canonical) || nativeFingerprint(canonical[record.Start:end]) != nativeFingerprint(record.Visible) {
			return nil, nil, nil, errors.New("ChatGPT native output does not match canonical history")
		}
		if _, exists := replacements[record.Start]; exists {
			return nil, nil, nil, errors.New("ambiguous ChatGPT native output")
		}
		retained = append(retained, record)
		replacements[record.Start] = record
	}
	rendered := make(oresponses.ResponseInputParam, 0, len(canonical))
	for i := 0; i <= len(canonical); {
		if record, ok := replacements[i]; ok {
			for _, raw := range record.Output {
				rendered = append(rendered, param.Override[oresponses.ResponseInputItemUnionParam](raw))
			}
			delete(replacements, i)
			if len(record.Visible) > 0 {
				i += len(record.Visible)
				continue
			}
		}
		if i == len(canonical) {
			break
		}
		rendered = append(rendered, param.Override[oresponses.ResponseInputItemUnionParam](canonical[i]))
		i++
	}
	return rendered, retained, canonical, nil
}
func chatGPTState(req ModelGatewayRequest, result ModelGatewayResult, completed oresponses.Response, aliases providerToolAliases, records []chatGPTNativeRecord, canonical []json.RawMessage, fragments []Message) (*ModelGatewayState, error) {
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
	visibleRaw, err := canonicalInput(visible)
	if err != nil {
		return nil, err
	}
	output := []json.RawMessage{}
	for _, item := range completed.Output {
		raw := json.RawMessage(item.RawJSON())
		if !json.Valid(raw) {
			return nil, errors.New("missing native ChatGPT output bytes")
		}
		output = append(output, raw)
	}
	if len(output) == 0 {
		return nil, errors.New("missing native ChatGPT output")
	}
	records = append(records, chatGPTNativeRecord{Start: len(canonical), Prefix: nativeFingerprint(canonical), Visible: visibleRaw, Output: output})
	raw, err := json.Marshal(records)
	if err != nil {
		return nil, err
	}
	if len(raw) > 8<<20 {
		return nil, errors.New("ChatGPT native output exceeds the context state limit")
	}
	return &ModelGatewayState{Kind: chatGPTStateKind, ID: req.Model, Attributes: map[string]string{"native_output": string(raw)}}, nil
}

type chatGPTStreamContext struct {
	Request   ModelGatewayRequest
	Records   []chatGPTNativeRecord
	Canonical []json.RawMessage
}
