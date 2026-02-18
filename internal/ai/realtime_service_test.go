package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

type slowOpenAIMock struct {
	delay time.Duration
}

func (m slowOpenAIMock) handle(w http.ResponseWriter, r *http.Request) {
	if r == nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if strings.TrimSpace(r.Header.Get("Authorization")) != "Bearer sk-test" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
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

	writeRealtimeSSE(w, f, map[string]any{
		"type": "response.created",
		"response": map[string]any{
			"id":         "resp_realtime_test_1",
			"created_at": time.Now().Unix(),
			"model":      "gpt-5-mini",
		},
	})
	time.Sleep(m.delay)
	writeRealtimeSSE(w, f, map[string]any{
		"type":  "response.output_text.delta",
		"delta": "working",
	})
	writeRealtimeSSE(w, f, map[string]any{
		"type": "response.completed",
		"response": map[string]any{
			"id":     "resp_realtime_test_1",
			"model":  "gpt-5-mini",
			"status": "completed",
			"usage": map[string]any{
				"input_tokens":  1,
				"output_tokens": 1,
				"output_tokens_details": map[string]any{
					"reasoning_tokens": 0,
				},
			},
		},
	})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	f.Flush()
}

func writeRealtimeSSE(w io.Writer, f http.Flusher, payload any) {
	b, _ := json.Marshal(payload)
	_, _ = io.WriteString(w, "data: ")
	_, _ = w.Write(b)
	_, _ = io.WriteString(w, "\n\n")
	f.Flush()
}

func newRealtimeTestService(t *testing.T, delay time.Duration) *Service {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(slowOpenAIMock{delay: delay}.handle))
	t.Cleanup(server.Close)

	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Type:    "openai",
				BaseURL: strings.TrimSuffix(server.URL, "/") + "/v1",
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			},
		},
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	svc, err := NewService(Options{
		Logger:              logger,
		StateDir:            t.TempDir(),
		FSRoot:              t.TempDir(),
		Shell:               "bash",
		Config:              cfg,
		RunMaxWallTime:      30 * time.Second,
		RunIdleTimeout:      10 * time.Second,
		ToolApprovalTimeout: 5 * time.Second,
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(providerID) != "openai" {
				return "", false, nil
			}
			return "sk-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func TestStartRunDetached_ImmediateCancelStillStopsRun(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_a",
		UserPublicID:      "u_a",
		UserEmail:         "u_a@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 2*time.Second)

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_detached_cancel_1"
	if err := svc.StartRunDetached(&meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hi"},
		Options:  RunOptions{MaxSteps: 1},
	}); err != nil {
		t.Fatalf("StartRunDetached: %v", err)
	}

	if err := svc.CancelRun(&meta, runID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if !svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
			break
		}
		time.Sleep(30 * time.Millisecond)
	}
	if svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
		t.Fatalf("run still active after cancel")
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing")
	}
	if strings.TrimSpace(view.RunStatus) != "canceled" {
		t.Fatalf("run_status=%q, want canceled", view.RunStatus)
	}
	if strings.Contains(view.LastMessagePreview, "Canceled.") {
		t.Fatalf("last_message_preview must not include cancellation notice: %q", view.LastMessagePreview)
	}
}

func TestListActiveThreadRuns_ReturnsDetachedRunSnapshot(t *testing.T) {
	t.Parallel()

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_a",
		UserPublicID:      "u_a",
		UserEmail:         "u_a@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	svc := newRealtimeTestService(t, 2*time.Second)

	ctx := context.Background()
	th, err := svc.CreateThread(ctx, &meta, "hello", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_detached_snapshot_1"
	if err := svc.StartRunDetached(&meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hi"},
		Options:  RunOptions{MaxSteps: 1},
	}); err != nil {
		t.Fatalf("StartRunDetached: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
		t.Fatalf("expected active run")
	}

	runs := svc.ListActiveThreadRuns(meta.EndpointID)
	if len(runs) != 1 {
		t.Fatalf("active run count=%d, want=1", len(runs))
	}
	if runs[0].ThreadID != th.ThreadID {
		t.Fatalf("thread_id=%q, want=%q", runs[0].ThreadID, th.ThreadID)
	}
	if runs[0].RunID != runID {
		t.Fatalf("run_id=%q, want=%q", runs[0].RunID, runID)
	}

	if err := svc.CancelRun(&meta, runID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if !svc.HasActiveThreadForEndpoint(meta.EndpointID, th.ThreadID) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("run still active after cancel")
}
