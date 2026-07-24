package appserver

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func isServerRunPolicyClassifierRequest(req map[string]any) bool {
	if req == nil {
		return false
	}
	instructions, _ := req["instructions"].(string)
	return strings.Contains(strings.TrimSpace(instructions), "RUN_POLICY_CLASSIFIER_V1")
}

func extractServerResponsesUserText(req map[string]any) string {
	if req == nil {
		return ""
	}
	rawInput, ok := req["input"]
	if !ok {
		return ""
	}
	items, ok := rawInput.([]any)
	if !ok {
		return ""
	}
	for i := len(items) - 1; i >= 0; i-- {
		msg, ok := items[i].(map[string]any)
		if !ok || msg == nil {
			continue
		}
		role := strings.ToLower(strings.TrimSpace(fmt.Sprint(msg["role"])))
		if role != "user" {
			continue
		}
		content, ok := msg["content"].([]any)
		if !ok {
			continue
		}
		parts := make([]string, 0, len(content))
		for _, item := range content {
			part, ok := item.(map[string]any)
			if !ok || part == nil {
				continue
			}
			if strings.ToLower(strings.TrimSpace(fmt.Sprint(part["type"]))) != "input_text" {
				continue
			}
			txt := strings.TrimSpace(fmt.Sprint(part["text"]))
			if txt != "" {
				parts = append(parts, txt)
			}
		}
		if len(parts) > 0 {
			return strings.Join(parts, "\n")
		}
	}
	return ""
}

func TestServer_AI_Run_UsesModelGatewayAndPersistsAssistantMessage(t *testing.T) {
	t.Parallel()

	token := "MOCK_OK_GATEWAY"

	// Minimal OpenAI Responses streaming mock (SSE).
	openaiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

		body, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var req map[string]any
		_ = json.Unmarshal(body, &req)

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		f, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		write := func(v any) {
			b, _ := json.Marshal(v)
			_, _ = io.WriteString(w, "data: ")
			_, _ = w.Write(b)
			_, _ = io.WriteString(w, "\n\n")
			f.Flush()
		}

		now := time.Now().Unix()
		if isServerRunPolicyClassifierRequest(req) {
			userText := strings.ToLower(strings.TrimSpace(extractServerResponsesUserText(req)))
			classifierToken := `{"intent":"task","reason":"actionable_request_detected","objective_mode":"replace","complexity":"standard","todo_policy":"recommended","minimum_todo_items":0,"confidence":0.78}`
			if strings.Contains(userText, "hi") || strings.Contains(userText, "hello") {
				classifierToken = `{"intent":"social","reason":"small_talk_detected","objective_mode":"replace","complexity":"simple","todo_policy":"none","minimum_todo_items":0,"confidence":0.95}`
			}
			write(map[string]any{
				"type":  "response.output_text.delta",
				"delta": classifierToken,
			})
			write(map[string]any{
				"type": "response.completed",
				"response": map[string]any{
					"id":     "resp_appserver_classifier",
					"model":  "gpt-5-mini",
					"status": "completed",
				},
			})
			_, _ = io.WriteString(w, "data: [DONE]\n\n")
			f.Flush()
			return
		}

		itemID := "msg_appserver_1"
		write(map[string]any{
			"type": "response.created",
			"response": map[string]any{
				"id":         "resp_appserver_1",
				"created_at": now,
				"model":      "gpt-5-mini",
			},
		})
		write(map[string]any{
			"type":         "response.output_item.added",
			"output_index": 0,
			"item": map[string]any{
				"type": "message",
				"id":   itemID,
			},
		})
		write(map[string]any{
			"type":    "response.output_text.delta",
			"item_id": itemID,
			"delta":   token,
		})
		write(map[string]any{
			"type":         "response.output_item.done",
			"output_index": 0,
			"item": map[string]any{
				"type": "message",
				"id":   itemID,
			},
		})
		write(map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
				},
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
	}))
	t.Cleanup(openaiSrv.Close)

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()

	cfg := &config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: strings.TrimSuffix(openaiSrv.URL, "/") + "/v1",
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			},
		},
	}

	channelID := "ch_test_ai_appserver_1"
	envOrigin := envOriginWithChannel(channelID)
	meta := session.Meta{
		EndpointID:        "env_123",
		NamespacePublicID: "ns_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	resolveMeta := resolveMetaForTest(channelID, meta)

	aiSvc, err := ai.NewService(ai.Options{
		Logger:              logger,
		StateDir:            stateDir,
		AgentHomeDir:        stateDir,
		Shell:               "bash",
		Config:              cfg,
		RunMaxWallTime:      30 * time.Second,
		RunIdleTimeout:      10 * time.Second,
		ToolApprovalTimeout: 5 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) {
			return "sk-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	t.Cleanup(func() { _ = aiSvc.Close() })

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

	// Create thread.
	var threadID string
	{
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/threads", bytes.NewBufferString(`{"title":"hello"}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("create thread status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp struct {
			OK   bool `json:"ok"`
			Data struct {
				Thread struct {
					ThreadID string `json:"thread_id"`
				} `json:"thread"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal create thread: %v", err)
		}
		threadID = strings.TrimSpace(resp.Data.Thread.ThreadID)
		if !resp.OK || threadID == "" {
			t.Fatalf("unexpected create thread response: %s", rr.Body.String())
		}
	}

	// Run.
	{
		for _, testCase := range []struct {
			name string
			body string
		}{
			{
				name: "legacy message identity",
				body: `{"thread_id":"` + threadID + `","model":"openai/gpt-5-mini","input":{"message_id":"legacy","text":"must fail","attachments":[]},"options":{}}`,
			},
			{
				name: "invalid turn identity",
				body: `{"thread_id":"` + threadID + `","model":"openai/gpt-5-mini","input":{"turn_id":"invalid turn id","text":"must fail","attachments":[]},"options":{}}`,
			},
		} {
			t.Run(testCase.name, func(t *testing.T) {
				rr := performServerRequest(
					srv,
					http.MethodPost,
					"/_redeven_proxy/api/ai/threads/"+threadID+"/turns",
					envOrigin,
					testCase.body,
				)
				if rr.Code != http.StatusBadRequest {
					t.Fatalf("invalid send status=%d, want=%d body=%s", rr.Code, http.StatusBadRequest, rr.Body.String())
				}
				view, err := aiSvc.GetThread(t.Context(), &meta, threadID)
				if err != nil {
					t.Fatal(err)
				}
				if view.QueuedTurnCount != 0 || len(view.QueuedTurns) != 0 || aiSvc.HasActiveThreadForEndpoint(meta.EndpointID, threadID) {
					t.Fatalf("invalid send changed product admission state: %#v", view)
				}
				bootstrap, err := aiSvc.GetFlowerThreadLiveBootstrap(t.Context(), &meta, threadID)
				if err != nil {
					t.Fatal(err)
				}
				if len(bootstrap.TimelineMessages) != 0 {
					t.Fatalf("invalid send created canonical timeline: %#v", bootstrap.TimelineMessages)
				}
			})
		}

		longThread, err := aiSvc.CreateThread(t.Context(), &meta, "long inline rejection", "", "", "")
		if err != nil {
			t.Fatal(err)
		}
		longOwner, err := ai.NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
		if err != nil {
			t.Fatal(err)
		}
		longLease, err := aiSvc.AcquireComposerDraftLease(t.Context(), longOwner, longThread.ThreadID, "appserver-long-inline", false)
		if err != nil || longLease.State != "owned" {
			t.Fatalf("acquire long draft lease: result=%#v err=%v", longLease, err)
		}
		longText := strings.Repeat("😀", 50_001)
		longTurnID := "turn_appserver_long_inline"
		longDraftValue, _ := json.Marshal(map[string]any{
			"text": longText, "attachments": []any{}, "mode": "admission_in_flight",
			"model_id": "openai/gpt-5-mini", "proposed_turn_id": longTurnID, "admission_started": true,
		})
		longDraft, err := aiSvc.MutateComposerDraft(t.Context(), longOwner, ai.ComposerDraftMutationRequest{
			ScopeID: longThread.ThreadID, HolderID: "appserver-long-inline", LeaseID: longLease.Draft.LeaseID,
			ExpectedRevision: longLease.Draft.Revision, Value: longDraftValue,
		})
		if err != nil {
			t.Fatal(err)
		}
		longBody, _ := json.Marshal(map[string]any{
			"thread_id": longThread.ThreadID, "draft_id": longThread.ThreadID,
			"expected_draft_revision": longDraft.Revision, "model": "openai/gpt-5-mini",
			"input":   map[string]any{"turn_id": longTurnID, "text": longText, "attachments": []any{}},
			"options": map[string]any{},
		})
		longResponse := performServerRequest(
			srv, http.MethodPost, "/_redeven_proxy/api/ai/threads/"+longThread.ThreadID+"/turns", envOrigin, string(longBody),
		)
		var longError struct {
			OK        bool   `json:"ok"`
			ErrorCode string `json:"error_code"`
		}
		if decodeErr := json.Unmarshal(longResponse.Body.Bytes(), &longError); decodeErr != nil {
			t.Fatal(decodeErr)
		}
		if longResponse.Code != http.StatusBadRequest || longError.OK || longError.ErrorCode != ai.LongTextAttachmentRequiredErrorCode {
			t.Fatalf("long inline response status=%d body=%s", longResponse.Code, longResponse.Body.String())
		}
		if stored, loadErr := aiSvc.LoadComposerDraft(t.Context(), longOwner, longThread.ThreadID); loadErr != nil || stored.Revision != longDraft.Revision {
			t.Fatalf("rejected HTTP admission changed draft: stored=%#v err=%v", stored, loadErr)
		}

		const turnID = "turn_appserver_receipt"
		owner, err := ai.NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
		if err != nil {
			t.Fatal(err)
		}
		lease, err := aiSvc.AcquireComposerDraftLease(t.Context(), owner, threadID, "appserver-integration", false)
		if err != nil || lease.State != "owned" || lease.Draft.LeaseID == "" {
			t.Fatalf("acquire draft lease: result=%#v err=%v", lease, err)
		}
		draft, err := aiSvc.MutateComposerDraft(t.Context(), owner, ai.ComposerDraftMutationRequest{
			ScopeID: threadID, HolderID: "appserver-integration", LeaseID: lease.Draft.LeaseID,
			ExpectedRevision: lease.Draft.Revision,
			Value:            json.RawMessage(`{"text":"hi","attachments":[],"mode":"admission_in_flight","model_id":"openai/gpt-5-mini","proposed_turn_id":"turn_appserver_receipt","admission_started":true}`),
		})
		if err != nil {
			t.Fatal(err)
		}
		body := map[string]any{
			"thread_id":               threadID,
			"draft_id":                threadID,
			"expected_draft_revision": draft.Revision,
			"model":                   "openai/gpt-5-mini",
			"input":                   map[string]any{"turn_id": turnID, "text": "hi", "attachments": []any{}},
			"options":                 map[string]any{"permission_type": "approval_required"},
		}
		b, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/threads/"+threadID+"/turns", bytes.NewBuffer(b))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != http.StatusAccepted {
			t.Fatalf("send turn status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp struct {
			OK   bool `json:"ok"`
			Data struct {
				RunID  string `json:"run_id"`
				TurnID string `json:"turn_id"`
				Kind   string `json:"kind"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal send turn: %v", err)
		}
		if !resp.OK || strings.TrimSpace(resp.Data.RunID) == "" || resp.Data.TurnID != turnID || resp.Data.Kind != "start" {
			t.Fatalf("unexpected send turn response: %s", rr.Body.String())
		}
	}

	// Thread metadata should be updated by the detached thread turn once the assistant message is persisted.
	deadline := time.Now().Add(3 * time.Second)
	lastPreview := ""
	for time.Now().Before(deadline) {
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+threadID, nil)
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
					LastMessagePreview string `json:"last_message_preview"`
				} `json:"thread"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal get thread: %v", err)
		}
		if !resp.OK {
			t.Fatalf("unexpected get thread response: %s", rr.Body.String())
		}
		lastPreview = strings.TrimSpace(resp.Data.Thread.LastMessagePreview)
		if strings.Contains(lastPreview, token) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("last_message_preview=%q, want it to include %q", lastPreview, token)
}
