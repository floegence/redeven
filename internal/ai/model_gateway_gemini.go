package ai

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/packages/param"
)

const geminiStateKind = "gemini_openai_tool_signatures_v1"

type geminiToolSignature struct {
	Signature string `json:"signature"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

func geminiArguments(raw string) string {
	var value any
	if json.Unmarshal([]byte(raw), &value) != nil {
		return raw
	}
	canonical, _ := json.Marshal(value)
	return string(canonical)
}

func geminiSignatureFromDelta(raw string) (string, error) {
	var delta struct {
		ExtraContent struct {
			Google struct {
				ThoughtSignature string `json:"thought_signature"`
			} `json:"google"`
		} `json:"extra_content"`
	}
	if err := json.Unmarshal([]byte(raw), &delta); err != nil {
		return "", fmt.Errorf("decode Gemini thought signature: %w", err)
	}
	return delta.ExtraContent.Google.ThoughtSignature, nil
}

// Signatures stay in the existing opaque provider state. Match the exact tool
// identity and arguments before replay; pruning follows the projected history.
func restoreGeminiSignatures(req ModelGatewayRequest, messages []openai.ChatCompletionMessageParamUnion) ([]openai.ChatCompletionMessageParamUnion, map[string]geminiToolSignature, error) {
	stored := map[string]geminiToolSignature{}
	retained := map[string]geminiToolSignature{}
	if state := req.PreviousState; state != nil {
		if state.Kind != geminiStateKind || state.ID != req.Model {
			return nil, nil, errors.New("incompatible Gemini provider state")
		}
		if err := json.Unmarshal([]byte(state.Attributes["tool_signatures"]), &stored); err != nil || stored == nil {
			return nil, nil, errors.New("invalid Gemini tool signature state")
		}
	}
	for i, message := range messages {
		raw, err := json.Marshal(message)
		if err != nil {
			return nil, nil, err
		}
		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			return nil, nil, err
		}
		calls, _ := body["tool_calls"].([]any)
		changed := false
		for _, entry := range calls {
			call, ok := entry.(map[string]any)
			if !ok {
				return nil, nil, errors.New("invalid Gemini tool call")
			}
			id, _ := call["id"].(string)
			signature, ok := stored[id]
			if !ok {
				continue
			}
			fn, _ := call["function"].(map[string]any)
			name, _ := fn["name"].(string)
			arguments, _ := fn["arguments"].(string)
			if signature.Signature == "" || signature.Name != name || signature.Arguments != geminiArguments(arguments) {
				return nil, nil, errors.New("Gemini tool signature does not match conversation")
			}
			call["extra_content"] = map[string]any{"google": map[string]string{"thought_signature": signature.Signature}}
			retained[id] = signature
			changed = true
		}
		if changed {
			raw, err = json.Marshal(body)
			if err != nil {
				return nil, nil, err
			}
			messages[i] = param.Override[openai.ChatCompletionMessageParamUnion](json.RawMessage(raw))
		}
	}
	return messages, retained, nil
}
