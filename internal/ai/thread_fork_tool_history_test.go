package ai

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

func TestFlowerForkContinuesToolHistoryAfterRestart(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		definitions, _ := request["tools"].([]any)
		if len(definitions) == 0 {
			writeDeepSeekIntegrationTextResponse(w, flusher, "title", "Fork history")
			return
		}
		for _, definition := range definitions {
			if definition.(map[string]any)["type"] != "function" {
				t.Error("current DeepSeek request enabled a hosted tool")
			}
		}
		if requests.Add(1) == 1 {
			output := []any{
				map[string]any{"type": "reasoning", "content": []any{map[string]any{"type": "reasoning_text", "text": "Before tools;"}}},
				map[string]any{"type": "reasoning", "content": []any{map[string]any{"type": "reasoning_text", "text": "Calling index;"}}},
				map[string]any{"type": "function_call", "id": "item1", "call_id": "index1", "name": "okf_index", "arguments": "{}"},
				map[string]any{"type": "function_call", "id": "item2", "call_id": "index2", "name": "okf_index", "arguments": "{}"},
			}
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": "tools", "status": "completed", "output": output}})
			return
		}
		calls, results := 0, 0
		input, _ := request["input"].([]any)
		for _, value := range input {
			item, _ := value.(map[string]any)
			switch item["type"] {
			case "function_call":
				calls++
			case "function_call_output":
				results++
			}
		}
		if calls != 2 || results != 2 {
			t.Errorf("provider history calls=%d results=%d, want exactly two complete exchanges", calls, results)
			http.Error(w, "invalid history", http.StatusBadRequest)
			return
		}
		writeDeepSeekIntegrationTextResponse(w, flusher, fmt.Sprintf("answer-%d", requests.Load()), "History continued.")
	}))
	t.Cleanup(server.Close)
	stateDir := t.TempDir()
	open := func() *Service {
		svc, err := NewService(Options{
			Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
			Config:         &config.AIConfig{CurrentModelID: "deepseek/deepseek-v4-flash", Providers: []config.AIProvider{{ID: "deepseek", Type: "deepseek", BaseURL: server.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "deepseek-v4-flash"}}}}},
			RunMaxWallTime: 10 * time.Second, RunIdleTimeout: 5 * time.Second, PersistOpTimeout: 2 * time.Second,
			ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil },
		})
		if err != nil {
			t.Fatal(err)
		}
		return svc
	}
	svc := open()
	t.Cleanup(func() { _ = svc.Close() })
	meta := testSendTurnMeta()
	source, err := svc.CreateThread(t.Context(), meta, "Fork history", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	send := func(threadID, requestID string) {
		view, err := runTypedTurnForTest(t, t.Context(), svc, meta, requestID, RunStartRequest{ThreadID: threadID, Input: RunInput{Text: "Continue the history."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}})
		if err != nil || view.LastOutcome == nil || *view.LastOutcome != flruntime.TurnOutcomeCompleted {
			t.Fatalf("send %s: failure=%+v err=%v", threadID, view.Failure, err)
		}
		requireAssistantTimelineTextContains(t, t.Context(), svc, meta, threadID, "History continued.")
	}
	send(source.ThreadID, "source")
	ids := []string{source.ThreadID}
	for i := 0; i < 2; i++ {
		forked, err := svc.ForkThreadWithOptions(t.Context(), meta, ids[len(ids)-1], ForkThreadRequest{ClientRequestID: fmt.Sprintf("fork-%d", i), Title: "History · Fork"})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, forked.ThreadID)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc = open()
	for i, id := range ids {
		send(id, fmt.Sprintf("continue-%d", i))
		detail, err := svc.GetFlowerThreadDetail(t.Context(), meta, id)
		if err != nil || detail.Current.Failure != nil || detail.Thread.Title == "" {
			t.Fatalf("reloaded detail=%+v err=%v", detail, err)
		}
	}
	if requests.Load() != 5 {
		t.Fatalf("provider requests=%d, want source tool/answer plus three continuations", requests.Load())
	}
}
