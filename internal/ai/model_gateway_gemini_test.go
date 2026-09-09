package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/floegence/redeven/internal/config"
)

func TestGeminiStreamPreservesToolSignaturesAndImageInput(t *testing.T) {
	const image = "data:image/png;base64,AQID"
	requests := make(chan map[string]any, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/openai/chat/completions" || r.Header.Get("Authorization") != "Bearer gemini-test" {
			t.Errorf("unexpected Gemini route or credential")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		requests <- body
		messages := body["messages"].([]any)
		w.Header().Set("Content-Type", "text/event-stream")
		send := func(delta map[string]any, finish any) {
			writeOpenAISSEJSON(w, w.(http.Flusher), map[string]any{"id": "gemini-response", "object": "chat.completion.chunk", "model": "gemini-3.8-flash", "choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}})
		}
		if len(messages) == 1 {
			send(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "call_1", "type": "function", "function": map[string]any{"name": "lookup", "arguments": "{\"city\":\"Paris\"}"}}}}, nil)
			// Signature may arrive after the argument fragments, without a tool ID.
			send(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "extra_content": map[string]any{"google": map[string]any{"thought_signature": "signed-original-bytes"}}}}}, "tool_calls")
		} else {
			send(map[string]any{"content": "Sunny"}, "stop")
		}
	}))
	defer server.Close()
	gateway, err := newProviderAdapter("google", server.URL+"/v1beta/openai/", "gemini-test", nil)
	if err != nil {
		t.Fatal(err)
	}
	req := ModelGatewayRequest{Model: "gemini-3.8-flash", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "Describe the weather"}, {Type: "image", FileURI: image, MimeType: "image/png"}}}}, Tools: []ToolDef{{Name: "lookup", InputSchema: json.RawMessage(`{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}`)}}, ProviderControls: ProviderControls{ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelHigh}, ReasoningCapability: config.AIReasoningCapabilityForModel("google", "gemini-3.8-flash")}}
	first, err := gateway.StreamTurn(context.Background(), req, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.ToolCalls) != 1 || first.ProviderState == nil {
		t.Fatalf("missing tool or signature state: %+v", first)
	}
	body := <-requests
	raw, _ := json.Marshal(body)
	if body["reasoning_effort"] != "high" || !strings.Contains(string(raw), image) {
		t.Fatalf("missing effort or image: %s", raw)
	}
	req.PreviousState = first.ProviderState
	req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "tool_call", ToolCallID: "call_1", ToolName: "lookup", ArgsJSON: `{"city":"Paris"}`}}}, Message{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: "call_1", Text: "sunny"}}})
	var streamed strings.Builder
	second, err := gateway.StreamTurn(context.Background(), req, func(event StreamEvent) {
		if event.Type == StreamEventTextDelta {
			streamed.WriteString(event.Text)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.Text != "Sunny" || streamed.String() != "Sunny" {
		t.Fatalf("bad streamed answer: %+v", second)
	}
	raw, _ = json.Marshal(<-requests)
	if !strings.Contains(string(raw), `"thought_signature":"signed-original-bytes"`) || !strings.Contains(string(raw), `"tool_call_id":"call_1"`) {
		t.Fatalf("missing signed continuation: %s", raw)
	}
	// An edited/forked tool call must not borrow an unrelated signature.
	req.Messages[1].Content[0].ArgsJSON = `{"city":"London"}`
	if _, err = gateway.StreamTurn(context.Background(), req, nil); err == nil {
		t.Fatal("mismatched signature accepted")
	}
}

func TestGeminiOpaqueStateCrossesFloretAdapter(t *testing.T) {
	adapter := newFloretProviderAdapter(nil, "google", "gemini-3.8-flash", ProviderControls{}, TurnBudgets{}, "")
	state := &flprovider.State{Kind: geminiStateKind, ID: "gemini-3.8-flash", Attributes: map[string]string{"tool_signatures": "{}"}}
	request, err := adapter.turnRequest(context.Background(), flprovider.Request{PreviousState: state})
	if err != nil {
		t.Fatal(err)
	}
	if request.PreviousState == nil || request.PreviousState.Kind != geminiStateKind || request.ProviderControls.PreviousResponseID != "" {
		t.Fatalf("state mapping: %+v", request)
	}
}
