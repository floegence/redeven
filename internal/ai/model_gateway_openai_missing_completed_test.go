package ai

import (
	"context"
	"encoding/json"
	"errors"

	flprovider "github.com/floegence/floret/v7/provider"
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

func TestOpenAIProvider_StreamTurn_MissingCompleted_RejectsUnfinishedText(t *testing.T) {
	t.Parallel()

	mock := &openAIMissingCompletedMock{mode: "text"}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	baseURL := strings.TrimSuffix(srv.URL, "/") + "/v1"
	adapter, err := newProviderAdapter("openai", baseURL, "sk-test", nil)
	if err != nil {
		t.Fatalf("newProviderAdapter: %v", err)
	}

	res, err := adapter.StreamTurn(context.Background(), ModelGatewayRequest{
		Model:    "gpt-5-mini",
		Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hi"}}}},
	}, nil)
	var adviser flprovider.RetryAdviser
	if !errors.As(err, &adviser) || adviser.ProviderRetryAdvice().Category != flprovider.RetryStreamInterrupted {
		t.Fatalf("missing terminal event must be interrupted: %v", err)
	}
	if res.FinishReason != "" || len(res.ToolCalls) != 0 {
		t.Fatalf("unfinished stream granted completion: %+v", res)
	}
}

func TestOpenAIProvider_StreamTurn_MissingCompleted_RejectsUnconfirmedToolCall(t *testing.T) {
	t.Parallel()

	mock := &openAIMissingCompletedMock{mode: "tool_call"}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	baseURL := strings.TrimSuffix(srv.URL, "/") + "/v1"
	adapter, err := newProviderAdapter("openai", baseURL, "sk-test", nil)
	if err != nil {
		t.Fatalf("newProviderAdapter: %v", err)
	}

	res, err := adapter.StreamTurn(context.Background(), ModelGatewayRequest{
		Model: "gpt-5-mini",
		Messages: []Message{
			{Role: "user", Content: []ContentPart{{Type: "text", Text: "hi"}}},
		},
		Tools: []ToolDef{
			{Name: "terminal.exec", InputSchema: json.RawMessage(`{"type":"object"}`)},
		},
	}, nil)
	var adviser flprovider.RetryAdviser
	if !errors.As(err, &adviser) || adviser.ProviderRetryAdvice().Category != flprovider.RetryStreamInterrupted {
		t.Fatalf("missing terminal event must be interrupted: %v", err)
	}
	if res.FinishReason != "" || len(res.ToolCalls) != 0 {
		t.Fatalf("unfinished stream granted tool execution: %+v", res)
	}
}
