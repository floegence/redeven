package appserver

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestServer_AIQueueEndpoints(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	providerStarted := make(chan struct{}, 4)
	providerDone := make(chan struct{}, 4)

	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		providerStarted <- struct{}{}
		<-r.Context().Done()
		providerDone <- struct{}{}
	}))
	var providerClosed atomic.Bool
	t.Cleanup(func() {
		if providerClosed.CompareAndSwap(false, true) {
			providerServer.Close()
		}
	})

	cfg := &config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: providerServer.URL,
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			},
		},
	}

	channelID := "ch_test_ai_followups_1"
	envOrigin := envOriginWithChannel(channelID)
	meta := session.Meta{
		ChannelID:         channelID,
		EndpointID:        "env_followups",
		NamespacePublicID: "ns_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	resolveMeta := resolveMetaForTest(channelID, meta)

	threadIDForCleanup := ""

	aiSvc, err := ai.NewService(ai.Options{
		Logger:           logger,
		StateDir:         stateDir,
		AgentHomeDir:     stateDir,
		Shell:            "bash",
		Config:           cfg,
		RunMaxWallTime:   30 * time.Second,
		RunIdleTimeout:   30 * time.Second,
		PersistOpTimeout: 2 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) {
			return "sk-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	var aiServiceClosed atomic.Bool
	t.Cleanup(func() {
		if aiServiceClosed.CompareAndSwap(false, true) {
			_ = aiSvc.CancelThread(&meta, threadIDForCleanup)
			_ = aiSvc.Close()
		}
	})

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	srv, err := New(Options{
		Logger:             logger,
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfigWithAI(t),
		ResolveSessionMeta: resolveMeta,
		AIServiceProvider:  newStaticAIServiceProvider(aiSvc),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	ctx := context.Background()
	thread, err := aiSvc.CreateThread(ctx, &meta, "followups thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	threadIDForCleanup = thread.ThreadID

	started, err := aiSvc.SendUserTurn(ctx, &meta, ai.SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: ai.RunInput{
			Text: "keep this run active briefly",
		},
		Options: ai.RunOptions{},
	})
	if err != nil {
		t.Fatalf("SendUserTurn active: %v", err)
	}
	if started.Kind != "start" || strings.TrimSpace(started.TurnID) == "" || started.Current.Activity != flruntime.ThreadActivityActive {
		t.Fatalf("active command result=%#v", started)
	}

	deadline := time.Now().Add(2 * time.Second)
	activeRunID := ""
	for time.Now().Before(deadline) {
		view, viewErr := aiSvc.GetThread(ctx, &meta, thread.ThreadID)
		if viewErr == nil && view != nil && strings.TrimSpace(view.ActiveRunID) != "" {
			activeRunID = strings.TrimSpace(view.ActiveRunID)
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	view, err := aiSvc.GetThread(ctx, &meta, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetThread before queued turns: %v", err)
	}
	if view == nil || activeRunID == "" || strings.TrimSpace(view.ActiveRunID) != activeRunID {
		t.Fatalf("canonical Floret turn did not start in time: %#v", view)
	}
	select {
	case <-providerStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("provider stream did not start in time")
	}

	queuedResp1, err := aiSvc.SendUserTurn(ctx, &meta, ai.SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: ai.RunInput{
			Text: "first queued via app server test",
		},
		Options: ai.RunOptions{},
	})
	if err != nil {
		t.Fatalf("SendUserTurn first: %v", err)
	}
	queuedResp2, err := aiSvc.SendUserTurn(ctx, &meta, ai.SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: ai.RunInput{
			Text: "second queued via app server test",
		},
		Options: ai.RunOptions{},
	})
	if err != nil {
		t.Fatalf("SendUserTurn second: %v", err)
	}
	if queuedResp1.Kind != "queued" || queuedResp1.TurnID != "" || queuedResp1.RunID != "" ||
		queuedResp2.Kind != "queued" || queuedResp2.TurnID != "" || queuedResp2.RunID != "" {
		t.Fatalf("unexpected queued kinds: first=%q second=%q", queuedResp1.Kind, queuedResp2.Kind)
	}
	queueID1 := strings.TrimSpace(queuedResp1.QueueID)
	queueID2 := strings.TrimSpace(queuedResp2.QueueID)
	if queueID1 == "" || queueID2 == "" {
		t.Fatalf("queue IDs should not be empty: %q %q", queueID1, queueID2)
	}

	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/followups", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("legacy followups route status=%d body=%s, want 404", rr.Code, rr.Body.String())
		}
	}

	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID, nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("get thread status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp struct {
			OK   bool `json:"ok"`
			Data struct {
				Thread struct {
					QueuedTurnCount int `json:"queued_turn_count"`
				} `json:"thread"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal get thread: %v", err)
		}
		if resp.Data.Thread.QueuedTurnCount != 2 {
			t.Fatalf("queued_turn_count=%d, want 2", resp.Data.Thread.QueuedTurnCount)
		}
	}

	reorderQueue := func(first, second string) {
		t.Helper()
		body := bytes.NewBufferString(`{"ordered_queue_ids":["` + first + `","` + second + `"]}`)
		req := httptest.NewRequest(http.MethodPatch, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/queue/order", body)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("reorder queue status=%d body=%s", rr.Code, rr.Body.String())
		}
	}
	assertQueueOrder := func(first, second string) {
		t.Helper()
		current, currentErr := aiSvc.GetThread(ctx, &meta, thread.ThreadID)
		if currentErr != nil {
			t.Fatalf("get thread after reorder: %v", currentErr)
		}
		if len(current.QueuedTurns) != 2 || current.QueuedTurns[0].QueueID != first || current.QueuedTurns[1].QueueID != second {
			t.Fatalf("unexpected reordered queue: %#v", current.QueuedTurns)
		}
	}
	reorderQueue(queueID2, queueID1)
	assertQueueOrder(queueID2, queueID1)
	reorderQueue(queueID1, queueID2)
	assertQueueOrder(queueID1, queueID2)
	reorderQueue(queueID2, queueID1)
	assertQueueOrder(queueID2, queueID1)

	{
		req := httptest.NewRequest(http.MethodDelete, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/queue/"+queueID1, nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("delete queued input status=%d body=%s", rr.Code, rr.Body.String())
		}
	}

	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID, nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("get thread after delete status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp struct {
			Data struct {
				Thread struct {
					QueuedTurnCount int `json:"queued_turn_count"`
				} `json:"thread"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal get thread after delete: %v", err)
		}
		if resp.Data.Thread.QueuedTurnCount != 1 {
			t.Fatalf("queued_turn_count=%d, want 1", resp.Data.Thread.QueuedTurnCount)
		}
	}

	{
		cancelStartedAt := time.Now()
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/cancel", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("cancel thread status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp struct {
			OK   bool `json:"ok"`
			Data struct {
				OK bool `json:"ok"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal cancel thread: %v", err)
		}
		if !resp.OK || !resp.Data.OK {
			t.Fatalf("unexpected cancel thread response: %s", rr.Body.String())
		}
		if elapsed := time.Since(cancelStartedAt); elapsed > 2*time.Second {
			t.Fatalf("cancel request elapsed=%s, want no more than 2s", elapsed)
		}
		select {
		case <-providerDone:
		case <-time.After(2 * time.Second):
			t.Fatal("provider stream did not close after cancel")
		}
	}

	serviceCloseStartedAt := time.Now()
	if err := aiSvc.Close(); err != nil {
		t.Fatalf("ai service close: %v", err)
	}
	aiServiceClosed.Store(true)
	if elapsed := time.Since(serviceCloseStartedAt); elapsed > 2*time.Second {
		t.Fatalf("ai service close elapsed=%s, want no more than 2s", elapsed)
	}
	serverCloseStartedAt := time.Now()
	providerServer.Close()
	providerClosed.Store(true)
	if elapsed := time.Since(serverCloseStartedAt); elapsed > 2*time.Second {
		t.Fatalf("provider server close elapsed=%s, want no more than 2s", elapsed)
	}
}
