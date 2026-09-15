package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/redeven/internal/config"
)

type computerIdentityExecutor struct{ calls chan TargetToolCall }

func (e *computerIdentityExecutor) EnsureTargetReady(context.Context, string) error { return nil }
func (e *computerIdentityExecutor) ExecuteTargetTool(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
	e.calls <- call
	return TargetToolResult{TargetID: call.TargetID, ExecutionLocation: "fixture", Result: map[string]any{"observed": true}}, nil
}

func TestComputerProductionThreadsReleaseCanonicalTargetOwnership(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		if defs, _ := body["tools"].([]any); len(defs) > 0 && requests.Add(1)%2 == 1 {
			item := map[string]any{"type": "function_call", "id": "observe", "call_id": "observe", "name": "computer_screenshot", "arguments": `{}`}
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
			writeAskUserIntegrationCompletedResponse(w, flusher, "observe")
			return
		}
		writeAskUserIntegrationTextResponse(w, flusher, "done", "Observed the target.")
	}))
	defer server.Close()
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "browser-main", Kind: "browser.managed", DisplayName: "Managed Browser", Ready: true, State: "ready", Capabilities: []string{"observe", "interaction"}}); err != nil {
		t.Fatal(err)
	}
	executor := &computerIdentityExecutor{calls: make(chan TargetToolCall, 4)}
	host := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": executor}, t.TempDir())
	defer host.Close()
	state := t.TempDir()
	svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: host, TargetToolExecutor: host,
		Config:                &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: server.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "test", true, nil }, RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	meta := testSendTurnMeta()
	for _, name := range []string{"first", "second"} {
		thread, err := svc.CreateThread(t.Context(), meta, name, "openai/gpt-5-mini", "", "")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: name, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Observe the managed browser."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}}); err != nil {
			t.Fatal(err)
		}
		view := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.RunStatus == "success" || v.RunStatus == "failed" })
		if view.RunStatus != "success" {
			t.Fatalf("%s: %s", name, view.RunError)
		}
		canonical, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
		if err != nil {
			t.Fatal(err)
		}
		select {
		case call := <-executor.calls:
			if call.ThreadID != thread.ThreadID || call.RunID == "" || call.RunID != canonical.RunID.String() || call.TurnID != canonical.TurnID.String() || call.ToolCallID != "observe" {
				t.Errorf("%s: executor received incomplete canonical identity: %+v", name, call)
			}
		default:
			t.Fatalf("%s: completed thread did not execute its observation; previous ownership was not released", name)
		}
	}
}
