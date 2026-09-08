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
		if calls.Add(1) == 1 {
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
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc = open()
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
