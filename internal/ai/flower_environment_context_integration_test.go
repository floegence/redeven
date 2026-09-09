package ai

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestEnvironmentCardSendPreservesDeviceThroughDeepSeekWireFollowup(t *testing.T) {
	var mu sync.Mutex
	var bodies []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		if len(extractOpenAIToolNames(request)) == 0 {
			writeDeepSeekIntegrationTextResponse(w, flusher, "title", "Device assessment")
			return
		}
		raw, _ := json.Marshal(request)
		mu.Lock()
		bodies = append(bodies, string(raw))
		count := len(bodies)
		mu.Unlock()
		if count == 1 {
			writeDeepSeekIntegrationTextResponse(w, flusher, "first", "First check complete.")
		} else {
			writeDeepSeekIntegrationTextResponse(w, flusher, "followup", "Follow-up complete.")
		}
	}))
	t.Cleanup(server.Close)
	stateDir := t.TempDir()
	meta := &session.Meta{EndpointID: "env_tool_runtime", ChannelID: "channel", NamespacePublicID: "namespace", UserPublicID: "user", UserEmail: "context@example.invalid", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
		Config:         &config.AIConfig{CurrentModelID: "deepseek/deepseek-v4-flash", Providers: []config.AIProvider{{ID: "deepseek", Name: "DeepSeek", Type: "deepseek", BaseURL: server.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "deepseek-v4-flash"}}}}},
		RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second, PersistOpTimeout: 2 * time.Second, ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	thread, err := svc.CreateThread(t.Context(), meta, "", "deepseek/deepseek-v4-flash", "", "")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("testdata/environment_flower_context.json")
	if err != nil {
		t.Fatal(err)
	}
	var card ContextActionEnvelope
	if err := json.Unmarshal(raw, &card); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "selected", ThreadID: thread.ThreadID, Model: "deepseek/deepseek-v4-flash", Input: RunInput{Text: "Assess this device.", ContextAction: &card}}); err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ClientRequestID: "followup", ThreadID: thread.ThreadID, Model: "deepseek/deepseek-v4-flash", Input: RunInput{Text: "What about its memory?"}}); err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool {
		return view.RunStatus == "success" && strings.Contains(view.LastMessagePreview, "Follow-up")
	})
	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 2 {
		t.Fatalf("HTTP requests=%d", len(bodies))
	}
	for index, body := range bodies {
		for _, fact := range []string{"udesk26", "ssh:host:udesk26:7afba939", "redeven targets exec", "User-selected device", "Tool execution environment", "env_tool_runtime"} {
			if !strings.Contains(body, fact) {
				t.Errorf("HTTP request %d omitted %q", index+1, fact)
			}
		}
	}
}
