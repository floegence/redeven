package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func TestOpenAICompatibleStreamTurn_ProjectsAdvertisedReasoningContent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		flusher := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		for _, fragment := range []string{"Think", " clearly"} {
			writeOpenAISSEJSON(w, flusher, map[string]any{
				"id": "chat_reasoning", "object": "chat.completion.chunk", "created": 1, "model": "deepseek-v4",
				"choices": []any{map[string]any{"index": 0, "finish_reason": nil, "delta": map[string]any{"reasoning_content": fragment}}},
			})
		}
		writeOpenAISSEJSON(w, flusher, map[string]any{
			"id": "chat_reasoning", "object": "chat.completion.chunk", "created": 1, "model": "deepseek-v4",
			"choices": []any{map[string]any{"index": 0, "finish_reason": "stop", "delta": map[string]any{}}},
		})
	}))
	defer srv.Close()

	provider, err := newProviderAdapter("openai_compatible", srv.URL+"/v1", "sk-test", nil)
	if err != nil {
		t.Fatalf("newProviderAdapter: %v", err)
	}
	events := make([]StreamEvent, 0, 2)
	result, err := provider.StreamTurn(context.Background(), ModelGatewayRequest{
		Model:    "deepseek-v4",
		Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hello"}}}},
		ProviderControls: ProviderControls{ReasoningCapability: config.AIReasoningCapability{
			Kind: "effort", ResponseReasoningFields: []string{"reasoning_content"},
		}},
	}, func(event StreamEvent) { events = append(events, event) })
	if err != nil {
		t.Fatalf("StreamTurn: %v", err)
	}
	if result.Text != "" || result.Reasoning != "Think clearly" {
		t.Fatalf("result=%+v, want reasoning-only response", result)
	}
	if got := strings.Join(streamEventTexts(events, StreamEventThinkingDelta), ""); got != "Think clearly" {
		t.Fatalf("thinking deltas=%q", got)
	}
}

func TestBuildOpenAIChatMessagesWithCapability_GatesReasoningReplay(t *testing.T) {
	messages := []Message{{Role: "assistant", Content: []ContentPart{
		{Type: "reasoning", Text: "inspect first"},
		{Type: "tool_call", ToolCallID: "call_1", ToolName: "terminal.exec", ArgsJSON: `{"cmd":"pwd"}`},
	}}}

	withReplay := buildOpenAIChatMessagesWithCapability(messages, config.AIReasoningCapability{
		Kind: "toggle", HistoryReplayRequirements: []string{"reasoning_content"},
	})
	withoutCapability := buildOpenAIChatMessagesWithCapability(messages, config.AIReasoningCapability{})
	withoutReplay := buildOpenAIChatMessagesWithCapability(messages, config.AIReasoningCapability{Kind: "none"})
	assertReasoningContent := func(label string, encoded any, want bool) {
		t.Helper()
		raw, err := json.Marshal(encoded)
		if err != nil {
			t.Fatalf("%s marshal: %v", label, err)
		}
		has := strings.Contains(string(raw), `"reasoning_content":"inspect first"`)
		if has != want {
			t.Fatalf("%s payload=%s, reasoning_content presence=%v want %v", label, raw, has, want)
		}
	}
	assertReasoningContent("required", withReplay, true)
	assertReasoningContent("unknown", withoutCapability, false)
	assertReasoningContent("unsupported", withoutReplay, false)
}
