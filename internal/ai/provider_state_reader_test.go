package ai

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
	oresponses "github.com/openai/openai-go/v3/responses"
)

func TestChatGPTNativeStateReaderSupportsPublishedWriters(t *testing.T) {
	for _, policy := range []flprovider.StateReusePolicy{flprovider.StateReuseExactSurface, flprovider.StateReuseCanonicalHistory} {
		for _, responseID := range []string{"", "resp_previous"} {
			state := &ModelGatewayState{Kind: chatGPTStateKind, ID: "gpt-6.1-sol", ReusePolicy: policy, Attributes: map[string]string{"native_output": "[]"}}
			if responseID != "" {
				state.Attributes["response_id"] = responseID
			}
			raw, err := json.Marshal(state)
			if err != nil {
				t.Fatal(err)
			}
			var restored ModelGatewayState
			if err = json.Unmarshal(raw, &restored); err != nil {
				t.Fatal(err)
			}
			req := ModelGatewayRequest{Model: state.ID, PreviousState: &restored}
			if _, err = (&openAIProvider{chatGPT: true}).prepareResponsesHistory(req, oresponses.ResponseInputParam{}); err != nil {
				t.Fatalf("policy=%q response=%q: %v", policy, responseID, err)
			}
		}
	}
	for _, attributes := range []map[string]string{
		{"native_output": "[]", "unknown": "unsupported"},
		{"native_output": "[]", "response_id": ""},
		{"native_output": "[]", "response_id": "resp\ninvalid"},
		{"native_output": "[]", "response_id": strings.Repeat("r", 513)},
		{"response_id": "resp_without_history"},
	} {
		req := ModelGatewayRequest{Model: "gpt-6.1-sol", PreviousState: &ModelGatewayState{Kind: chatGPTStateKind, ID: "gpt-6.1-sol", Attributes: attributes}}
		if _, err := (&openAIProvider{chatGPT: true}).prepareResponsesHistory(req, oresponses.ResponseInputParam{}); err == nil {
			t.Fatal("accepted malformed native state")
		}
	}
	req := ModelGatewayRequest{Model: "gpt-6.1-sol", PreviousState: &ModelGatewayState{Kind: chatGPTStateKind, ID: "gpt-6.1-sol", ReusePolicy: "unknown", Attributes: map[string]string{"native_output": "[]"}}}
	if _, err := (&openAIProvider{chatGPT: true}).prepareResponsesHistory(req, oresponses.ResponseInputParam{}); err == nil {
		t.Fatal("accepted unknown reuse policy")
	}
}

func TestDesktopModelSourceRPCPreservesCanonicalReusePolicy(t *testing.T) {
	state := &ModelGatewayState{Kind: chatGPTStateKind, ID: "gpt-6.1-sol", ReusePolicy: flprovider.StateReuseCanonicalHistory, Attributes: map[string]string{"native_output": "[]", "response_id": "resp"}}
	client, cleanup := startTestDesktopModelSource(t, func(frame DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame {
		if frame.Method != "ai.turn.stream" {
			return testDesktopModelSourceError(frame.ID, "METHOD_NOT_FOUND", "unexpected method")
		}
		var body desktopModelSourceStreamRequest
		if err := json.Unmarshal(frame.Params, &body); err != nil {
			t.Error(err)
		}
		if !reflect.DeepEqual(body.Request.PreviousState, state) {
			t.Errorf("RPC request lost native state: %+v", body.Request.PreviousState)
		}
		return testDesktopModelSourceResult(t, frame.ID, ModelGatewayResult{FinishReason: "stop", ProviderState: state})
	})
	defer cleanup()
	result, err := client.ModelGateway("desktop:model_test").StreamTurn(t.Context(), ModelGatewayRequest{Model: "desktop:model_test", PreviousState: state}, nil)
	if err != nil {
		t.Fatal(err)
	}
	mapped, err := flowerProviderStateToFloret(result.ProviderState)
	if err != nil || mapped == nil || mapped.ReusePolicy != flprovider.StateReuseCanonicalHistory || !reflect.DeepEqual(mapped.Attributes, state.Attributes) {
		t.Fatalf("RPC result lost native state: state=%+v err=%v", mapped, err)
	}
}
