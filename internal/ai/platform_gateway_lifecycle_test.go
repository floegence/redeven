package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
)

func TestPlatformGatewayRunSurvivesCallerDisconnectAndHistoryRestart(t *testing.T) {
	started, finish := make(chan struct{}), make(chan struct{})
	var startOnce, finishOnce sync.Once
	var calls atomic.Int32
	edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/ai/v1/leases/renew":
			_ = json.NewEncoder(w).Encode(platformGatewayLease{Token: "renewed-lease", RenewalToken: "renewal-capability", ExpiresAtUnix: time.Now().Add(time.Minute).Unix(), EntitlementVersion: 1})
		case "/api/ai/v1/catalog":
			_, _ = w.Write([]byte(`{"models":[{"model_id":"test-model","available":true,"capabilities":["text","tools","responses"],"context_window":64000,"max_output_tokens":2048}]}`))
		case "/api/ai/v1/requests":
			calls.Add(1)
			var in platformGatewayRunRequest
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Error(err)
				return
			}
			if in.ThreadID == "" || in.RunID == "" || in.TurnID == "" || in.AttemptID == "" || in.LogicalRequestID == "" || in.PromptScopeID == "" {
				t.Error("Floret dispatch identity is incomplete")
			}
			if r.Header.Get("Authorization") != "Bearer renewed-lease" {
				t.Error("dispatch does not use the renewed lease")
			}
			startOnce.Do(func() { close(started) })
			select {
			case <-finish:
				writeOpenAIResponsesSSE(w, r, "platform/test-model", "resp_rd_continuation", "Background result persisted.")
			case <-r.Context().Done():
				t.Error("caller disconnect cancelled the background model call")
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(edge.Close)
	t.Cleanup(func() { finishOnce.Do(func() { close(finish) }) })
	stateDir := t.TempDir()
	meta := &session.Meta{EndpointID: "platform-env", ChannelID: "platform-channel", UserPublicID: "platform-user", NamespacePublicID: "platform-namespace", CanRead: true, CanWrite: true, CanExecute: true, PlatformAIGrant: "initial-lease", PlatformAIGatewayURL: edge.URL, PlatformAIEntitlementVersion: 1}
	open := func() *Service {
		t.Helper()
		svc, err := NewService(Options{
			Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
			RunMaxWallTime: 10 * time.Second, RunIdleTimeout: 5 * time.Second, PersistOpTimeout: 2 * time.Second,
			ResolveProviderAPIKey: func(string) (string, bool, error) {
				t.Error("platform provider tried to read a Provider key")
				return "", false, nil
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		return svc
	}
	svc := open()
	t.Cleanup(func() { _ = svc.Close() })
	thread, err := svc.CreateThread(t.Context(), meta, "Platform background task", "platform/test-model", "", "")
	if err != nil {
		t.Fatal(err)
	}
	caller, disconnect := context.WithCancel(t.Context())
	stream, err := svc.SubscribeFlowerLiveStream(caller, meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	sent, err := svc.SendUserTurn(caller, meta, SendUserTurnRequest{ClientRequestID: "platform-background-request", ThreadID: thread.ThreadID, Input: RunInput{Text: "Continue in the background."}})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		view, viewErr := svc.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
		raw, _ := json.Marshal(view)
		t.Fatalf("background platform dispatch did not start: %s (%v)", raw, viewErr)
	}
	disconnect()
	stream.Close()
	reconnected, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer reconnected.Close()
	ready := nextFlowerLiveStreamFrame(t, reconnected)
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(ready.Data, &envelope); err != nil {
		t.Fatal(err)
	}
	if ready.Kind != FlowerLiveStreamReady || len(envelope.Summaries) != 1 || envelope.Summaries[0].ActiveRunID != sent.RunID {
		t.Fatal("reconnection did not restore the same running task")
	}
	finishOnce.Do(func() { close(finish) })
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc = open()
	detail, err := svc.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(detail)
	if err != nil || !strings.Contains(string(raw), "Background result persisted.") {
		t.Fatalf("reopened history lost the platform result: %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("provider calls=%d, want exactly one execution", calls.Load())
	}
}
