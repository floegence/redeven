package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/floegence/redeven-agent/internal/ai"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func TestGateway_AI_FollowupsEndpoints(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()

	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
			return
		case <-time.After(3 * time.Second):
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"error":{"message":"forced stop for followups test"}}`))
	}))
	defer providerServer.Close()

	cfg := &config.AIConfig{
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
		RunMaxWallTime:   6 * time.Second,
		RunIdleTimeout:   6 * time.Second,
		PersistOpTimeout: 2 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) {
			return "sk-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	t.Cleanup(func() {
		_ = aiSvc.CancelThread(&meta, threadIDForCleanup)
		_ = aiSvc.Close()
	})

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	gw, err := New(Options{
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

	err = aiSvc.StartRunDetached(&meta, "run_gateway_active", ai.RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: ai.RunInput{
			Text: "keep this run active briefly",
		},
		Options: ai.RunOptions{MaxSteps: 1},
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

	queuedResp1, err := aiSvc.SendUserTurn(ctx, &meta, ai.SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: ai.RunInput{
			MessageID: "m_gateway_queue_1",
			Text:      "first queued via gateway test",
		},
		Options: ai.RunOptions{MaxSteps: 1},
	})
	if err != nil {
		t.Fatalf("SendUserTurn first: %v", err)
	}
	queuedResp2, err := aiSvc.SendUserTurn(ctx, &meta, ai.SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: ai.RunInput{
			MessageID: "m_gateway_queue_2",
			Text:      "second queued via gateway test",
		},
		Options: ai.RunOptions{MaxSteps: 1},
	})
	if err != nil {
		t.Fatalf("SendUserTurn second: %v", err)
	}
	if queuedResp1.Kind != "queued" || queuedResp2.Kind != "queued" {
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
		gw.serveHTTP(rr, req)
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
		gw.serveHTTP(rr, req)
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
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("reorder followups status=%d body=%s", rr.Code, rr.Body.String())
		}
	}

	{
		body := bytes.NewBufferString(`{"lane":"queued","ordered_followup_ids":["` + followupID1 + `","` + followupID2 + `"],"expected_revision":` + jsonNumberString(revision) + `}`)
		req := httptest.NewRequest(http.MethodPatch, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/followups/order", body)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusConflict {
			t.Fatalf("stale reorder status=%d body=%s", rr.Code, rr.Body.String())
		}
	}

	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/followups", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
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
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("patch followup status=%d body=%s", rr.Code, rr.Body.String())
		}
	}

	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID+"/followups", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
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
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("delete followup status=%d body=%s", rr.Code, rr.Body.String())
		}
	}

	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+thread.ThreadID, nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
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
}

func jsonNumberString(v int64) string {
	b, _ := json.Marshal(v)
	return string(b)
}
