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

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestServer_AI_FollowupsEndpoints(t *testing.T) {
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
		AI:                 aiSvc,
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

	err = aiSvc.StartRunDetached(&meta, "run_appserver_active", ai.RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: ai.RunInput{
			Text: "keep this run active briefly",
		},
		Options: ai.RunOptions{},
	})
	if err != nil {
		t.Fatalf("StartRunDetached: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if aiSvc.HasActiveThreadForEndpoint(meta.EndpointID, thread.ThreadID) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !aiSvc.HasActiveThreadForEndpoint(meta.EndpointID, thread.ThreadID) {
		t.Fatalf("active run did not start in time")
	}
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		view, viewErr := aiSvc.GetThread(ctx, &meta, thread.ThreadID)
		if viewErr == nil && view != nil && strings.TrimSpace(view.ActiveRunID) == "run_appserver_active" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	view, err := aiSvc.GetThread(ctx, &meta, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetThread before queued turns: %v", err)
	}
	if view == nil || strings.TrimSpace(view.ActiveRunID) != "run_appserver_active" {
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
			TurnID: "m_appserver_queue_1",
			Text:   "first queued via app server test",
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
			TurnID: "m_appserver_queue_2",
			Text:   "second queued via app server test",
		},
		Options: ai.RunOptions{},
	})
	if err != nil {
		t.Fatalf("SendUserTurn second: %v", err)
	}
	if queuedResp1.Kind != "queued" || queuedResp1.TurnID != "m_appserver_queue_1" || strings.TrimSpace(queuedResp1.RunID) == "" ||
		queuedResp2.Kind != "queued" || queuedResp2.TurnID != "m_appserver_queue_2" || strings.TrimSpace(queuedResp2.RunID) == "" {
		t.Fatalf("unexpected queued kinds: first=%q second=%q", queuedResp1.Kind, queuedResp2.Kind)
	}
	followupID1 := strings.TrimSpace(queuedResp1.QueueID)
	followupID2 := strings.TrimSpace(queuedResp2.QueueID)
	if followupID1 == "" || followupID2 == "" {
		t.Fatalf("followup IDs should not be empty: %q %q", followupID1, followupID2)
	}

	var revision int64
	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/followups", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("list followups status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp struct {
			OK   bool `json:"ok"`
			Data struct {
				Revision int64 `json:"revision"`
				Queued   []struct {
					FollowupID string `json:"followup_id"`
					Text       string `json:"text"`
				} `json:"queued"`
				Drafts []struct {
					FollowupID string `json:"followup_id"`
				} `json:"drafts"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal list followups: %v", err)
		}
		if !resp.OK || len(resp.Data.Queued) != 2 || len(resp.Data.Drafts) != 0 {
			t.Fatalf("unexpected followups response: %s", rr.Body.String())
		}
		if resp.Data.Queued[0].FollowupID != followupID1 || resp.Data.Queued[1].FollowupID != followupID2 {
			t.Fatalf("unexpected followup order: %+v", resp.Data.Queued)
		}
		revision = resp.Data.Revision
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

	{
		body := bytes.NewBufferString(`{"lane":"queued","ordered_followup_ids":["` + followupID2 + `","` + followupID1 + `"],"expected_revision":` + jsonNumberString(revision) + `}`)
		req := httptest.NewRequest(http.MethodPatch, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/followups/order", body)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("reorder followups status=%d body=%s", rr.Code, rr.Body.String())
		}
	}

	{
		body := bytes.NewBufferString(`{"lane":"queued","ordered_followup_ids":["` + followupID1 + `","` + followupID2 + `"],"expected_revision":` + jsonNumberString(revision) + `}`)
		req := httptest.NewRequest(http.MethodPatch, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/followups/order", body)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusConflict {
			t.Fatalf("stale reorder status=%d body=%s", rr.Code, rr.Body.String())
		}
	}

	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/followups", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("list followups after reorder status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp struct {
			Data struct {
				Queued []struct {
					FollowupID string `json:"followup_id"`
					Text       string `json:"text"`
				} `json:"queued"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal list followups after reorder: %v", err)
		}
		if len(resp.Data.Queued) != 2 || resp.Data.Queued[0].FollowupID != followupID2 || resp.Data.Queued[1].FollowupID != followupID1 {
			t.Fatalf("unexpected reordered followups response: %s", rr.Body.String())
		}
	}

	{
		body := bytes.NewBufferString(`{"text":"edited queued text"}`)
		req := httptest.NewRequest(http.MethodPatch, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/followups/"+followupID2, body)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("patch followup status=%d body=%s", rr.Code, rr.Body.String())
		}
	}

	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/followups", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("list followups after patch status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp struct {
			Data struct {
				Queued []struct {
					FollowupID string `json:"followup_id"`
					Text       string `json:"text"`
				} `json:"queued"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal list followups after patch: %v", err)
		}
		if len(resp.Data.Queued) != 2 || resp.Data.Queued[0].FollowupID != followupID2 || resp.Data.Queued[0].Text != "edited queued text" {
			t.Fatalf("unexpected patched followups response: %s", rr.Body.String())
		}
	}

	{
		req := httptest.NewRequest(http.MethodDelete, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/followups/"+followupID1, nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("delete followup status=%d body=%s", rr.Code, rr.Body.String())
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
				OK                 bool `json:"ok"`
				RecoveredFollowups []struct {
					FollowupID string `json:"followup_id"`
					Lane       string `json:"lane"`
					Text       string `json:"text"`
				} `json:"recovered_followups"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal cancel thread: %v", err)
		}
		if !resp.OK || !resp.Data.OK || len(resp.Data.RecoveredFollowups) != 1 {
			t.Fatalf("unexpected cancel thread response: %s", rr.Body.String())
		}
		if got := resp.Data.RecoveredFollowups[0]; got.FollowupID != followupID2 || got.Lane != "draft" || got.Text != "edited queued text" {
			t.Fatalf("unexpected recovered followup: %+v", got)
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

	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/followups", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("list followups after cancel status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp struct {
			Data struct {
				Queued []struct {
					FollowupID string `json:"followup_id"`
				} `json:"queued"`
				Drafts []struct {
					FollowupID string `json:"followup_id"`
					Text       string `json:"text"`
				} `json:"drafts"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal list followups after cancel: %v", err)
		}
		if len(resp.Data.Queued) != 0 || len(resp.Data.Drafts) != 1 || resp.Data.Drafts[0].FollowupID != followupID2 {
			t.Fatalf("unexpected followups after cancel: %s", rr.Body.String())
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

func jsonNumberString(v int64) string {
	b, _ := json.Marshal(v)
	return string(b)
}
