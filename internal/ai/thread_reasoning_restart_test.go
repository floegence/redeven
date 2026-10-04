package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestThreadReasoningOffSurvivesRestartAndWaitingContinuation(t *testing.T) {
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		var tools []json.RawMessage
		_ = json.Unmarshal(request["tools"], &tools)
		if len(tools) == 0 {
			writeDeepSeekIntegrationResponse(w, flusher, "title", "", "Reasoning restart")
			return
		}
		if string(request["reasoning"]) != `{"effort":"none"}` {
			t.Errorf("provider reasoning=%s, want explicit Off", request["reasoning"])
		}
		var surface map[string]any
		encoded, _ := json.Marshal(request)
		_ = json.Unmarshal(encoded, &surface)
		n := calls.Add(1)
		permission := "readonly"
		if n == 1 {
			permission = "approval_required"
		}
		assertPermissionProviderSurface(t, surface, permission)
		if n == 1 {
			args := `{"reason_code":"missing_external_input","required_from_user":["Choose a target."],"evidence_refs":["message:latest"],"questions":[{"id":"target","header":"Target","question":"Which target?","response_mode":"write","is_secret":false,"write_label":"Target","write_placeholder":"Type a target"}]}`
			for _, event := range []string{"response.output_item.added", "response.output_item.done"} {
				writeOpenAISSEJSON(w, flusher, map[string]any{
					"type": event, "output_index": 0,
					"item": map[string]any{"type": "function_call", "id": "ask", "call_id": "ask", "name": "ask_user", "arguments": args},
				})
			}
			writeOpenAISSEJSON(w, flusher, map[string]any{
				"type": "response.completed", "response": map[string]any{"id": "waiting", "status": "completed",
					"output": []any{map[string]any{"type": "function_call", "id": "ask", "call_id": "ask", "name": "ask_user", "arguments": args}}},
			})
			return
		}
		writeDeepSeekIntegrationResponse(w, flusher, "done", "", "Target accepted.")
	}))
	defer provider.Close()
	stateDir := t.TempDir()
	meta := &session.Meta{
		EndpointID: "reasoning-restart", ChannelID: "reasoning-channel", NamespacePublicID: "namespace",
		UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
	}
	open := func() *Service {
		t.Helper()
		svc, err := NewService(Options{
			Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
			Config: &config.AIConfig{CurrentModelID: "deepseek/deepseek-v4-flash", Providers: []config.AIProvider{{
				ID: "deepseek", Name: "DeepSeek", Type: "deepseek", BaseURL: provider.URL,
				Models: []config.AIProviderModel{{ModelName: "deepseek-v4-flash"}},
			}}},
			ResolveProviderAPIKey: func(string) (string, bool, error) { return "test-key", true, nil },
			RunMaxWallTime:        5 * time.Second, RunIdleTimeout: 5 * time.Second, PersistOpTimeout: 2 * time.Second,
		})
		if err != nil {
			t.Fatal(err)
		}
		return svc
	}
	svc := open()
	defer func() { _ = svc.Close() }()
	created, err := svc.CreateThread(t.Context(), meta, "", "deepseek/deepseek-v4-flash", "", "")
	if err != nil {
		t.Fatal(err)
	}
	off := config.AIReasoningSelection{Level: config.AIReasoningLevelOff}
	if err := svc.SetThreadReasoningSelection(t.Context(), meta, created.ThreadID, off); err != nil {
		t.Fatal(err)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc = open()
	view, err := svc.GetThread(t.Context(), meta, created.ThreadID)
	if err != nil || view.ReasoningSelection != off {
		t.Fatalf("reopened reasoning: view=%+v err=%v", view, err)
	}
	if _, err := svc.SendUserTurn(context.Background(), meta, SendUserTurnRequest{
		ClientRequestID: "reasoning-start", ThreadID: created.ThreadID, Input: RunInput{Text: "Ask me which target to use."},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	}); err != nil {
		t.Fatal(err)
	}
	waiting := waitForAskUserIntegrationThread(t, svc, meta, created.ThreadID, func(view *ThreadView) bool {
		return view.RunStatus == "waiting_user" && view.WaitingPrompt != nil
	})
	if err := svc.SetThreadReasoningSelection(t.Context(), meta, created.ThreadID, config.AIReasoningSelection{Level: config.AIReasoningLevelHigh}); !errors.Is(err, ErrThreadBusy) {
		t.Fatalf("waiting reasoning change error=%v, want ErrThreadBusy", err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, created.ThreadID, "readonly"); err != nil {
		t.Fatal(err)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc = open()
	settings, err := svc.snapshotThreadStore().GetThreadSettings(t.Context(), meta.EndpointID, created.ThreadID)
	if err != nil || settings.PermissionType != "readonly" {
		t.Fatalf("saved default lost: %+v %v", settings, err)
	}
	if _, err := svc.SubmitRequestUserInputResponse(context.Background(), meta, SubmitRequestUserInputResponseRequest{
		ThreadID: created.ThreadID,
		Response: RequestUserInputResponse{PromptID: waiting.WaitingPrompt.PromptID, Answers: map[string]RequestUserInputAnswer{"target": {Text: "staging"}}},
	}); err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, created.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
	if calls.Load() != 2 {
		t.Fatalf("provider calls=%d, want one initial call and one continuation", calls.Load())
	}
}

func TestOllamaReasoningOnSurvivesRestartAndProviderDispatch(t *testing.T) {
	var agentCalls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/tags":
			_, _ = w.Write([]byte(`{"models":[{"name":"renamed-model"}]}`))
			return
		case "/api/ps":
			_, _ = w.Write([]byte(`{"models":[]}`))
			return
		case "/api/show":
			_, _ = w.Write([]byte(`{"capabilities":["tools","thinking"],"thinking":{"values":[false,true],"default":false},"parameters":"num_ctx 131072"}`))
			return
		case "/v1/chat/completions":
			var body map[string]json.RawMessage
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
				return
			}
			var tools []json.RawMessage
			_ = json.Unmarshal(body["tools"], &tools)
			if len(tools) > 0 {
				agentCalls.Add(1)
				if string(body["reasoning_effort"]) != `"medium"` {
					t.Errorf("lost On on dispatch: %s", body["reasoning_effort"])
				}
			}
			w.Header().Set("Content-Type", "text/event-stream")
			flusher := w.(http.Flusher)
			for _, delta := range []map[string]any{{"reasoning": "Inspect first."}, {"content": "Done."}} {
				writeOpenAISSEJSON(w, flusher, map[string]any{"id": "ollama", "object": "chat.completion.chunk", "model": "renamed-model", "choices": []any{map[string]any{"index": 0, "delta": delta}}})
			}
			writeOpenAISSEJSON(w, flusher, map[string]any{"id": "ollama", "object": "chat.completion.chunk", "model": "renamed-model", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": "stop"}}})
		default:
			t.Errorf("unexpected request %s", r.URL)
			w.WriteHeader(404)
		}
	}))
	defer provider.Close()
	state := t.TempDir()
	meta := &session.Meta{EndpointID: "ollama-reasoning", ChannelID: "channel", NamespacePublicID: "namespace", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	open := func() *Service {
		svc, err := NewService(Options{StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Config: &config.AIConfig{CurrentModelID: "local/renamed-model", Providers: []config.AIProvider{{ID: "local", Type: "ollama", BaseURL: provider.URL + "/v1", ModelSelection: &config.AIModelSelection{}}}}, RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second})
		if err != nil {
			t.Fatal(err)
		}
		return svc
	}
	svc := open()
	defer func() { _ = svc.Close() }()
	created, err := svc.CreateThread(t.Context(), meta, "", "local/renamed-model", "", "")
	if err != nil {
		t.Fatal(err)
	}
	on := config.AIReasoningSelection{Level: config.AIReasoningLevelOn}
	if err := svc.SetThreadReasoningSelection(t.Context(), meta, created.ThreadID, on); err != nil {
		t.Fatal(err)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc = open()
	view, err := svc.GetThread(t.Context(), meta, created.ThreadID)
	if err != nil || view.ReasoningSelection != on {
		t.Fatalf("restored=%+v err=%v", view, err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: created.ThreadID, ClientRequestID: "reasoning-on", Input: RunInput{Text: "Reply briefly."}}); err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, created.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
	if agentCalls.Load() != 1 {
		t.Fatalf("agent calls=%d", agentCalls.Load())
	}
}
