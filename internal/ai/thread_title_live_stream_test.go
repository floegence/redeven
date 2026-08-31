package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/floret/v6/identity"
	flruntime "github.com/floegence/floret/v6/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type liveAutomaticTitleOpenAIMock struct {
	failTitle    bool
	titleStarted chan struct{}
	releaseTitle chan struct{}
	startOnce    sync.Once
	releaseOnce  sync.Once
}

func newLiveAutomaticTitleOpenAIMock(failTitle bool) *liveAutomaticTitleOpenAIMock {
	return &liveAutomaticTitleOpenAIMock{
		failTitle: failTitle, titleStarted: make(chan struct{}), releaseTitle: make(chan struct{}),
	}
}

func (mock *liveAutomaticTitleOpenAIMock) release() {
	mock.releaseOnce.Do(func() { close(mock.releaseTitle) })
}

func (mock *liveAutomaticTitleOpenAIMock) handle(w http.ResponseWriter, r *http.Request) {
	if r == nil || r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer sk-test" || !strings.HasSuffix(r.URL.Path, "/responses") {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	body, _ := io.ReadAll(r.Body)
	_ = r.Body.Close()
	isTitle := bytes.Contains(body, []byte("You generate concise thread titles"))
	if isTitle {
		mock.startOnce.Do(func() { close(mock.titleStarted) })
		select {
		case <-r.Context().Done():
			return
		case <-mock.releaseTitle:
		}
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.WriteHeader(http.StatusOK)
	flusher := w.(http.Flusher)
	responseID := "resp_live_main"
	if isTitle {
		responseID = "resp_live_title"
	}
	writeTestRealtimeSSE(w, flusher, map[string]any{
		"type":     "response.created",
		"response": map[string]any{"id": responseID, "created_at": time.Now().Unix(), "model": "gpt-5-mini"},
	})
	if !isTitle || !mock.failTitle {
		text := "Assistant response"
		if isTitle {
			text = "Live title"
		}
		writeTestRealtimeSSE(w, flusher, map[string]any{"type": "response.output_text.delta", "delta": text})
	}
	if !isTitle {
		call := map[string]any{
			"type": "function_call", "id": "fc_live_title_complete", "call_id": "call_live_title_complete",
			"name": "task_complete", "arguments": `{}`,
		}
		writeTestRealtimeSSE(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 1, "item": call})
		writeTestRealtimeSSE(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 1, "item": call})
	}
	writeTestRealtimeSSE(w, flusher, map[string]any{
		"type": "response.completed",
		"response": map[string]any{
			"id": responseID, "model": "gpt-5-mini", "status": "completed",
			"usage": map[string]any{"input_tokens": 1, "output_tokens": 1, "output_tokens_details": map[string]any{"reasoning_tokens": 0}},
		},
	})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	flusher.Flush()
}

func TestAutomaticTitleSettlementPublishesCanonicalWorkspaceSummary(t *testing.T) {
	for _, test := range []struct {
		name        string
		failTitle   bool
		finalTitle  string
		finalStatus flruntime.ThreadTitleStatus
	}{
		{name: "ready", finalTitle: "Live title", finalStatus: flruntime.ThreadTitleStatusReady},
		{name: "failed", failTitle: true, finalTitle: "First user request", finalStatus: flruntime.ThreadTitleStatusFailed},
	} {
		t.Run(test.name, func(t *testing.T) {
			mock := newLiveAutomaticTitleOpenAIMock(test.failTitle)
			t.Cleanup(mock.release)
			server := httptest.NewServer(http.HandlerFunc(mock.handle))
			t.Cleanup(server.Close)
			cfg := &config.AIConfig{
				CurrentModelID: "openai/gpt-5-mini",
				Providers: []config.AIProvider{{
					ID: "openai", Type: "openai", BaseURL: strings.TrimSuffix(server.URL, "/") + "/v1",
					Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
				}},
			}
			svc, err := NewService(Options{
				Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/bash", Config: cfg,
				PersistOpTimeout: 2 * time.Second, RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 2 * time.Second,
				ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil },
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = svc.Close() })
			meta := &session.Meta{
				EndpointID: "env_live_title_" + test.name, ChannelID: "channel_live_title_" + test.name,
				UserPublicID: "user_live_title", UserEmail: "live-title@example.com", NamespacePublicID: "namespace_live_title",
				CanRead: true, CanWrite: true, CanExecute: true,
			}
			thread, err := svc.CreateThread(t.Context(), meta, "", "openai/gpt-5-mini", "", "")
			if err != nil {
				t.Fatal(err)
			}
			subscription, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
			if err != nil {
				t.Fatal(err)
			}
			defer subscription.Close()
			if ready := nextFlowerLiveStreamFrame(t, subscription); ready.Kind != FlowerLiveStreamReady {
				t.Fatalf("ready kind=%q", ready.Kind)
			}

			terminal, err := runTypedTurnForTest(t, t.Context(), svc, meta, "request-live-title-"+test.name, RunStartRequest{
				ThreadID: thread.ThreadID,
				Model:    "openai/gpt-5-mini",
				Input:    RunInput{Text: "First user request"},
			})
			if err != nil {
				t.Fatalf("run turn: %v; failure=%#v", err, terminal.Failure)
			}
			select {
			case <-mock.titleStarted:
			case <-time.After(3 * time.Second):
				t.Fatal("automatic title provider request did not start")
			}
			pending := nextFlowerTitleSummary(t, subscription, thread.ThreadID, flruntime.ThreadTitleStatusPending)
			if pending.Title != "First user request" {
				t.Fatalf("pending title=%q, want fallback", pending.Title)
			}

			mock.release()
			settled := nextFlowerTitleSummary(t, subscription, thread.ThreadID, test.finalStatus)
			if settled.Title != test.finalTitle {
				t.Fatalf("settled title=%q, want %q", settled.Title, test.finalTitle)
			}
			summary, err := threadSummaryFromRuntime(t.Context(), svc.threadRuntime, identity.ThreadID(thread.ThreadID))
			if err != nil {
				t.Fatal(err)
			}
			if summary.Title != test.finalTitle || summary.TitleStatus != test.finalStatus {
				t.Fatalf("canonical title=(%q, %q), want (%q, %q)", summary.Title, summary.TitleStatus, test.finalTitle, test.finalStatus)
			}
		})
	}
}

func nextFlowerTitleSummary(
	t *testing.T,
	subscription *FlowerLiveStreamSubscription,
	threadID string,
	status flruntime.ThreadTitleStatus,
) ThreadView {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	for {
		frame, err := subscription.Next(ctx)
		if err != nil {
			t.Fatalf("next Flower title summary: %v", err)
		}
		if frame.Kind != FlowerLiveStreamSummaryBatch {
			continue
		}
		var envelope FlowerLiveStreamEnvelope
		if err := json.Unmarshal(frame.Data, &envelope); err != nil {
			t.Fatal(err)
		}
		for _, summary := range envelope.Summaries {
			if summary.ThreadID == threadID && summary.TitleStatus == string(status) {
				return summary
			}
		}
	}
}
