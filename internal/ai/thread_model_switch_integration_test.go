package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestThreadModelSwitchUsesPersistedModelAcrossTurnsAndRestart(t *testing.T) {
	var captureMu sync.Mutex
	var mainRequests []map[string]any
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
		model, _ := request["model"].(string)
		tools, _ := request["tools"].([]any)
		if len(tools) == 0 {
			writeDeepSeekIntegrationTextResponseForModel(w, flusher, "chat_title", model, "Model switch")
			return
		}
		captureMu.Lock()
		mainRequests = append(mainRequests, request)
		call := len(mainRequests)
		captureMu.Unlock()
		writeDeepSeekIntegrationTextResponseForModel(w, flusher, "chat_turn_"+strconv.Itoa(call), model, "turn completed")
	}))
	t.Cleanup(providerServer.Close)

	stateDir := t.TempDir()
	meta := &session.Meta{
		EndpointID: "env_model_switch", ChannelID: "channel_model_switch",
		NamespacePublicID: "namespace_model_switch", UserPublicID: "user_model_switch", UserEmail: "model-switch@example.com",
		CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
	}
	newService := func() *Service {
		svc, err := NewService(Options{
			Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
			Config: &config.AIConfig{
				CurrentModelID: "deepseek/deepseek-v4-flash",
				Providers: []config.AIProvider{{
					ID: "deepseek", Name: "DeepSeek", Type: "deepseek", BaseURL: providerServer.URL + "/v1",
					Models: []config.AIProviderModel{{ModelName: "deepseek-v4-flash"}, {ModelName: "deepseek-v4-pro"}},
				}},
			},
			RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second, PersistOpTimeout: 2 * time.Second,
			ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil },
		})
		if err != nil {
			t.Fatalf("NewService: %v", err)
		}
		return svc
	}
	svc := newService()
	t.Cleanup(func() {
		if svc != nil {
			_ = svc.Close()
		}
	})

	thread, err := svc.CreateThread(context.Background(), meta, "", "deepseek/deepseek-v4-flash", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	sendAndWaitForModelSwitch(t, svc, meta, thread.ThreadID, "flash input", "deepseek/deepseek-v4-flash")

	if err := svc.SetThreadModel(t.Context(), meta, thread.ThreadID, "deepseek/deepseek-v4-pro"); err != nil {
		t.Fatalf("SetThreadModel(pro): %v", err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionReadonly)); err != nil {
		t.Fatalf("SetThreadPermissionType(readonly): %v", err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{
		ClientRequestID: "request-stale-model", ThreadID: thread.ThreadID, Model: "deepseek/deepseek-v4-flash", Input: RunInput{Text: "stale model must fail"},
	}); !errors.Is(err, ErrThreadModelConflict) {
		t.Fatalf("SendUserTurn stale model error=%v, want ErrThreadModelConflict", err)
	}
	sendAndWaitForModelSwitch(t, svc, meta, thread.ThreadID, "pro input", "")

	if err := svc.SetThreadModel(t.Context(), meta, thread.ThreadID, "deepseek/deepseek-v4-flash"); err != nil {
		t.Fatalf("SetThreadModel(flash): %v", err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
		t.Fatalf("SetThreadPermissionType(full_access): %v", err)
	}
	if err := svc.Close(); err != nil {
		t.Fatalf("Close before restart: %v", err)
	}
	svc = newService()
	sendAndWaitForModelSwitch(t, svc, meta, thread.ThreadID, "flash after restart", "")

	captureMu.Lock()
	requests := append([]map[string]any(nil), mainRequests...)
	captureMu.Unlock()
	if len(requests) != 3 {
		t.Fatalf("main request count=%d, want 3", len(requests))
	}
	wantModels := []string{"deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash"}
	for i, want := range wantModels {
		if got, _ := requests[i]["model"].(string); got != want {
			t.Fatalf("request %d model=%q, want %q", i+1, got, want)
		}
	}
	assertModelSwitchRequestHistory(t, requests)
}

func sendAndWaitForModelSwitch(t *testing.T, svc *Service, meta *session.Meta, threadID string, text string, model string) {
	t.Helper()
	response, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{
		ClientRequestID: "request-model-switch-" + strings.ReplaceAll(text, " ", "-"), ThreadID: threadID, Model: model, Input: RunInput{Text: text},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	})
	if err != nil || response.Kind != "start" {
		t.Fatalf("SendUserTurn(%q) response=%#v err=%v", text, response, err)
	}
	completed := waitForAskUserIntegrationThread(t, svc, meta, threadID, func(view *ThreadView) bool {
		return strings.TrimSpace(view.RunStatus) == "success"
	})
	if strings.TrimSpace(completed.RunError) != "" {
		t.Fatalf("SendUserTurn(%q) completed with error: %#v", text, completed)
	}
}

func assertModelSwitchRequestHistory(t *testing.T, requests []map[string]any) {
	t.Helper()
	messageJSON := make([][]byte, len(requests))
	for i, request := range requests {
		messages, ok := request["input"].([]any)
		if !ok {
			t.Fatalf("request %d omitted messages", i+1)
		}
		messageJSON[i], _ = json.Marshal(messages)
	}
	for i, expected := range []string{"flash input", "pro input", "flash after restart"} {
		for requestIndex := i; requestIndex < len(messageJSON); requestIndex++ {
			if !strings.Contains(string(messageJSON[requestIndex]), expected) {
				t.Fatalf("request %d omitted canonical history %q", requestIndex+1, expected)
			}
		}
	}
	if !reflect.DeepEqual(requests[0]["tools"], requests[2]["tools"]) {
		t.Fatal("Flash render lineage changed tools across model switch and restart")
	}
	if reflect.DeepEqual(requests[0]["tools"], requests[1]["tools"]) {
		t.Fatal("new Pro turn did not receive the current readonly tool surface")
	}
	if !reflect.DeepEqual(requests[0]["input"].([]any)[0], requests[2]["input"].([]any)[0]) {
		t.Fatal("Flash render lineage changed its first message prefix")
	}
	if reflect.DeepEqual(requests[0]["input"].([]any)[0], requests[1]["input"].([]any)[0]) {
		t.Fatal("new Pro turn did not receive the current readonly System Prompt")
	}
	for i, request := range requests {
		if _, ok := request["previous_response_id"]; ok {
			t.Fatalf("request %d leaked provider continuation metadata across turns", i+1)
		}
	}
}

func writeDeepSeekIntegrationTextResponseForModel(w http.ResponseWriter, flusher http.Flusher, responseID string, model string, text string) {
	writeDeepSeekIntegrationTextResponse(w, flusher, responseID, text)
}
