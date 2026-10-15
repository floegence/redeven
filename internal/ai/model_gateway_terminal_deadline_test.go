package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestResponsesTerminalReleasesOpenHTTPStream(t *testing.T) {
	for _, mode := range []string{"text", "tool", "truncated", "filtered"} {
		t.Run(mode, func(t *testing.T) {
			released := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				response := map[string]any{"id": "response", "status": "completed", "output": []any{map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "complete"}}}}, "usage": map[string]any{"input_tokens": 8, "output_tokens": 2}}
				typ := "response.completed"
				if mode == "tool" {
					response["output"] = []any{map[string]any{"type": "function_call", "id": "item", "call_id": "call", "name": "inspect", "arguments": `{"path":"file"}`}}
				}
				if mode == "truncated" || mode == "filtered" {
					typ = "response.incomplete"
					response["status"] = "incomplete"
					reason := "max_output_tokens"
					if mode == "filtered" {
						reason = "content_filter"
					}
					response["incomplete_details"] = map[string]any{"reason": reason}
				}
				writeOpenAISSEJSON(w, w.(http.Flusher), map[string]any{"type": typ, "response": response})
				<-r.Context().Done()
				close(released)
			}))
			defer server.Close()
			adapter, err := newProviderAdapter("openai", server.URL, "fixture", nil)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 500*time.Millisecond)
			defer cancel()
			result, err := adapter.StreamTurn(ctx, ModelGatewayRequest{Model: "gpt-5-mini", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "inspect"}}}}, Tools: []ToolDef{{Name: "inspect", InputSchema: json.RawMessage(`{"type":"object","properties":{"path":{"type":"string"}}}`)}}}, nil)
			if err != nil {
				t.Fatalf("terminal event still waits for EOF: %v", err)
			}
			want := map[string]string{"text": "stop", "tool": "tool_calls", "truncated": "length", "filtered": "content_filter"}[mode]
			if result.FinishReason != want {
				t.Fatalf("finish=%s want=%s", result.FinishReason, want)
			}
			if mode == "tool" && (len(result.ToolCalls) != 1 || result.ToolCalls[0].Args["path"] != "file") {
				t.Fatalf("tool=%+v", result.ToolCalls)
			}
			select {
			case <-released:
			case <-time.After(time.Second):
				t.Fatal("response body was not released")
			}
		})
	}
}
