package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestRedevenHostedRunAskUserWaitsAndResumesWithoutAuthorityCorruption(t *testing.T) {
	t.Parallel()

	var mainCalls atomic.Int32
	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)

		tools, _ := request["tools"].([]any)
		if len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "resp_title", "Clarify deployment")
			return
		}
		if mainCalls.Add(1) == 1 {
			args := `{"reason_code":"missing_external_input","required_from_user":["Choose a deployment target."],"evidence_refs":["message:latest"],"questions":[{"id":"target","header":"Target","question":"Which target should I deploy?","response_mode":"write","is_secret":false,"write_label":"Target","write_placeholder":"Type a target"}]}`
			writeOpenAISSEJSON(w, flusher, map[string]any{
				"type": "response.output_item.added", "output_index": 0,
				"item": map[string]any{"type": "function_call", "id": "fc_ask_user", "call_id": "call_ask_user", "name": "ask_user", "arguments": args},
			})
			writeOpenAISSEJSON(w, flusher, map[string]any{
				"type": "response.output_item.done", "output_index": 0,
				"item": map[string]any{"type": "function_call", "id": "fc_ask_user", "call_id": "call_ask_user", "name": "ask_user", "arguments": args},
			})
			writeAskUserIntegrationCompletedResponse(w, flusher, "resp_waiting")
			return
		}
		writeAskUserIntegrationTextResponse(w, flusher, "resp_resumed", "Deployment target accepted.")
	}))
	t.Cleanup(providerServer.Close)

	stateDir := t.TempDir()
	meta := &session.Meta{
		EndpointID: "env_ask_user_integration", ChannelID: "channel_ask_user_integration",
		NamespacePublicID: "namespace_ask_user", UserPublicID: "user_ask_user", UserEmail: "ask-user@example.com",
		CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
	}
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
		Config: &config.AIConfig{
			CurrentModelID: "openai/gpt-5-mini",
			Providers: []config.AIProvider{{
				ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: providerServer.URL + "/v1",
				Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			}},
		},
		RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second, PersistOpTimeout: 2 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil },
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	thread, err := svc.CreateThread(context.Background(), meta, "", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	start, err := svc.SendUserTurn(context.Background(), meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini",
		Input:   RunInput{TurnID: "turn_ask_user_initial", Text: "Deploy the application."},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	})
	if err != nil || start.Kind != "start" {
		t.Fatalf("SendUserTurn response=%#v err=%v", start, err)
	}

	waiting := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool {
		return strings.TrimSpace(view.RunStatus) == "waiting_user" && view.WaitingPrompt != nil &&
			!svc.HasActiveThreadForEndpoint(meta.EndpointID, thread.ThreadID)
	})
	prompt := waiting.WaitingPrompt
	if prompt == nil || len(prompt.Questions) != 1 || prompt.Questions[0].ID != "target" {
		t.Fatalf("waiting prompt=%#v, want canonical target question", prompt)
	}
	response, err := svc.SubmitRequestUserInputResponse(context.Background(), meta, SubmitRequestUserInputResponseRequest{
		ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini",
		Response: RequestUserInputResponse{
			PromptID: prompt.PromptID,
			Answers:  map[string]RequestUserInputAnswer{"target": {Text: "production"}},
		},
		Input:   RunInput{TurnID: "turn_ask_user_response", Text: "production"},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	})
	if err != nil || response.Kind != "start" || response.ConsumedWaitingPromptID != prompt.PromptID {
		t.Fatalf("SubmitRequestUserInputResponse response=%#v err=%v", response, err)
	}

	completed := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool {
		return !svc.HasActiveThreadForEndpoint(meta.EndpointID, thread.ThreadID) && strings.TrimSpace(view.RunStatus) == "success"
	})
	if completed.WaitingPrompt != nil || strings.TrimSpace(completed.RunError) != "" {
		t.Fatalf("completed thread retained waiting/error state: %#v", completed)
	}
	bootstrap, err := svc.GetFlowerThreadLiveBootstrap(context.Background(), meta, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadLiveBootstrap: %v", err)
	}
	if len(bootstrap.TimelineMessages) == 0 || !strings.Contains(strings.ToLower(bootstrap.Thread.Title), "clarify") {
		t.Fatalf("canonical bootstrap=%#v, want resumed timeline and provider title", bootstrap)
	}
	if mainCalls.Load() != 2 {
		t.Fatalf("main provider calls=%d, want waiting and resumed calls", mainCalls.Load())
	}
}

func writeAskUserIntegrationCompletedResponse(w http.ResponseWriter, flusher http.Flusher, responseID string) {
	writeOpenAISSEJSON(w, flusher, map[string]any{
		"type": "response.completed",
		"response": map[string]any{
			"id": responseID, "model": "gpt-5-mini", "status": "completed",
			"usage": map[string]any{"input_tokens": 1, "output_tokens": 1},
		},
	})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	flusher.Flush()
}

func writeAskUserIntegrationTextResponse(w http.ResponseWriter, flusher http.Flusher, responseID string, text string) {
	writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_text.delta", "delta": text})
	writeAskUserIntegrationCompletedResponse(w, flusher, responseID)
}

func waitForAskUserIntegrationThread(t *testing.T, svc *Service, meta *session.Meta, threadID string, ready func(*ThreadView) bool) *ThreadView {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		view, err := svc.GetThread(context.Background(), meta, threadID)
		if err == nil && view != nil && ready(view) {
			return view
		}
		time.Sleep(10 * time.Millisecond)
	}
	view, err := svc.GetThread(context.Background(), meta, threadID)
	t.Fatalf("thread did not reach expected state: view=%#v err=%v", view, err)
	return nil
}
