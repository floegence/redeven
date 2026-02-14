package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type openAIMissingCompletedMock struct {
	// mode is "text" or "tool_call".
	mode string
}

func (m *openAIMissingCompletedMock) handle(w http.ResponseWriter, r *http.Request) {
	if r == nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !strings.HasSuffix(strings.TrimSpace(r.URL.Path), "/responses") {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	_, _ = io.ReadAll(r.Body)
	_ = r.Body.Close()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	f, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	switch strings.TrimSpace(m.mode) {
	case "tool_call":
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":         "response.output_item.added",
			"output_index": 0,
			"item": map[string]any{
				"type":      "function_call",
				"id":        "fc_1",
				"call_id":   "call_1",
				"name":      "terminal_exec",
				"arguments": `{"command":"pwd"}`,
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.output_item.done",
			"item": map[string]any{
				"type":      "function_call",
				"id":        "fc_1",
				"call_id":   "call_1",
				"name":      "terminal_exec",
				"arguments": `{"command":"pwd"}`,
			},
		})
	default: // "text"
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":  "response.output_text.delta",
			"delta": "HELLO_NO_COMPLETED",
		})
	}

	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	f.Flush()
}

func TestOpenAIProvider_StreamTurn_MissingCompleted_SucceedsWithText(t *testing.T) {
	t.Parallel()

	mock := &openAIMissingCompletedMock{mode: "text"}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	baseURL := strings.TrimSuffix(srv.URL, "/") + "/v1"
	adapter, err := newProviderAdapter("openai", baseURL, "sk-test")
	if err != nil {
		t.Fatalf("newProviderAdapter: %v", err)
	}

	res, err := adapter.StreamTurn(context.Background(), TurnRequest{
		Model:    "gpt-5-mini",
		Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hi"}}}},
	}, nil)
	if err != nil {
		t.Fatalf("StreamTurn: %v", err)
	}
	if strings.TrimSpace(res.Text) != "HELLO_NO_COMPLETED" {
		t.Fatalf("text=%q, want %q", res.Text, "HELLO_NO_COMPLETED")
	}
	if strings.TrimSpace(res.FinishReason) != "stop" {
		t.Fatalf("finish_reason=%q, want stop", res.FinishReason)
	}
}

func TestOpenAIProvider_StreamTurn_MissingCompleted_SucceedsWithToolCall(t *testing.T) {
	t.Parallel()

	mock := &openAIMissingCompletedMock{mode: "tool_call"}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	baseURL := strings.TrimSuffix(srv.URL, "/") + "/v1"
	adapter, err := newProviderAdapter("openai", baseURL, "sk-test")
	if err != nil {
		t.Fatalf("newProviderAdapter: %v", err)
	}

	res, err := adapter.StreamTurn(context.Background(), TurnRequest{
		Model: "gpt-5-mini",
		Messages: []Message{
			{Role: "user", Content: []ContentPart{{Type: "text", Text: "hi"}}},
		},
		Tools: []ToolDef{
			{Name: "terminal.exec", InputSchema: json.RawMessage(`{"type":"object"}`)},
		},
	}, nil)
	if err != nil {
		t.Fatalf("StreamTurn: %v", err)
	}
	if strings.TrimSpace(res.FinishReason) != "tool_calls" {
		t.Fatalf("finish_reason=%q, want tool_calls", res.FinishReason)
	}
	if len(res.ToolCalls) != 1 {
		t.Fatalf("tool_calls=%d, want 1", len(res.ToolCalls))
	}
	call := res.ToolCalls[0]
	if strings.TrimSpace(call.ID) != "call_1" {
		t.Fatalf("call_id=%q, want call_1", call.ID)
	}
	if strings.TrimSpace(call.Name) != "terminal.exec" {
		t.Fatalf("call_name=%q, want terminal.exec", call.Name)
	}
	if strings.TrimSpace(anyToString(call.Args["command"])) != "pwd" {
		t.Fatalf("call.args.command=%v, want pwd", call.Args["command"])
	}
}
