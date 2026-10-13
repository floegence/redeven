package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/floegence/redeven/internal/chatgpt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChatGPTWireFullHistoryNamespaceAndNativeReplay(t *testing.T) {
	var bodies []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		json.Unmarshal(raw, &body)
		bodies = append(bodies, body)
		if r.Header.Get("Authorization") != "Bearer rotating-access" {
			t.Error("current OAuth token not resolved")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		output := []any{map[string]any{"type": "reasoning", "id": "reasoning_1", "summary": []any{}, "encrypted_content": "opaque-encrypted"}, map[string]any{"type": "message", "id": "message_1", "role": "assistant", "status": "completed", "phase": "commentary", "content": []any{map[string]any{"type": "output_text", "text": "checking", "annotations": []any{}}}}, map[string]any{"type": "function_call", "id": "item_1", "call_id": "call_1", "name": "inspect", "namespace": "redeven", "arguments": "{}", "status": "completed"}}
		event := map[string]any{"type": "response.completed", "response": map[string]any{"id": "response_1", "model": "gpt-5.5", "status": "completed", "output": output}}
		encoded, _ := json.Marshal(event)
		fmt.Fprintf(w, "event: response.completed\ndata: %s\n\n", encoded)
	}))
	defer server.Close()
	adapter, err := newProviderAdapter("openai", server.URL+"/v1", "never-use-this-key", nil)
	if err != nil {
		t.Fatal(err)
	}
	provider := adapter.(*openAIProvider)
	provider.chatGPT = true
	provider.requireTerminal = true
	provider.chatGPTToken = func(context.Context) (string, error) { return "rotating-access", nil }
	req := ModelGatewayRequest{Model: "gpt-5.5", Messages: []Message{{Role: "system", Content: []ContentPart{{Type: "text", Text: "system instructions"}}}, {Role: "user", Content: []ContentPart{{Type: "text", Text: "inspect the image"}, {Type: "image", MimeType: "image/png", FileURI: "https://example.com/image.png"}}}}, Tools: []ToolDef{{Name: "inspect", InputSchema: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)}}}
	first, err := provider.StreamTurn(context.Background(), req, nil)
	if err != nil {
		t.Fatal(err)
	}
	wire, _ := json.Marshal(bodies[0])
	for _, field := range []string{"max_output_tokens", "temperature", "top_p", "previous_response_id", "metadata", "background", "conversation", "max_tool_calls", "prompt_cache_retention", "truncation", "safety_identifier"} {
		if _, ok := bodies[0][field]; ok {
			t.Errorf("unsupported field %s", field)
		}
	}
	if bodies[0]["store"] != false || bodies[0]["stream"] != true || bodies[0]["instructions"] != "system instructions" || !strings.Contains(string(wire), `"type":"namespace"`) || !strings.Contains(string(wire), `"name":"redeven"`) || !strings.Contains(string(wire), "input_image") || !strings.Contains(string(wire), "reasoning.encrypted_content") {
		t.Fatalf("invalid public ChatGPT wire: %s", wire)
	}
	req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: first.Text}, {Type: "tool_call", ToolCallID: "call_1", ToolName: "inspect", ArgsJSON: "{}"}}}, Message{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: "call_1", Text: "done"}}})
	req.PreviousState = first.ProviderState
	if _, err := provider.StreamTurn(context.Background(), req, nil); err != nil {
		t.Fatal(err)
	}
	replay, _ := json.Marshal(bodies[1])
	if !strings.Contains(string(replay), "opaque-encrypted") || !strings.Contains(string(replay), `"phase":"commentary"`) || !strings.Contains(string(replay), "function_call_output") || !strings.Contains(string(replay), "inspect the image") {
		t.Fatalf("incomplete replay %s", replay)
	}
	req.Messages = []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "compacted complete summary"}}}}
	if _, err := provider.StreamTurn(context.Background(), req, nil); err != nil {
		t.Fatal(err)
	}
	compacted, _ := json.Marshal(bodies[2])
	if strings.Contains(string(compacted), "opaque-encrypted") || !strings.Contains(string(compacted), "compacted complete summary") {
		t.Fatal("stale native output crossed compaction")
	}
}
func TestChatGPTStreamTerminalAndLateUsageFailures(t *testing.T) {
	for _, terminal := range []string{"response.failed", "response.incomplete", "disconnect"} {
		t.Run(terminal, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
				if terminal != "disconnect" {
					fmt.Fprintf(w, "data: {\"type\":%q,\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}}\n\n", terminal)
				}
			}))
			defer server.Close()
			adapter, _ := newProviderAdapter("openai", server.URL+"/v1", "access", nil)
			p := adapter.(*openAIProvider)
			p.chatGPT = true
			p.requireTerminal = true
			result, err := p.StreamTurn(context.Background(), ModelGatewayRequest{Model: "gpt-5.5", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hello"}}}}}, nil)
			if err == nil || result.ProviderState != nil {
				t.Fatal("noncompleted response committed state")
			}
			if terminal == "response.failed" {
				var e *chatgpt.RequestError
				if !errors.As(err, &e) || chatgpt.Failure(e.Code).Action != "manage_usage" || classifyRunFailureCode(err, "") != runErrorCodeChatGPTUsage {
					t.Fatalf("wrong recovery: %v", err)
				}
			}
		})
	}
}
