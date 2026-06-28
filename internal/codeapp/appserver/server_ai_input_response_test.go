package appserver

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"testing/fstest"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestServer_AIThreadInputResponseUsesURLThreadID(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	channelID := "ch_test_ai_input_response"
	envOrigin := envOriginWithChannel(channelID)
	meta := session.Meta{
		EndpointID:        "env_input_response",
		NamespacePublicID: "ns_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	aiSvc, err := ai.NewService(ai.Options{
		Logger:       logger,
		StateDir:     stateDir,
		AgentHomeDir: stateDir,
		Shell:        "/bin/sh",
		Config: &config.AIConfig{
			CurrentModelID: "openai/gpt-5-mini",
			Providers: []config.AIProvider{{
				ID:   "openai",
				Name: "OpenAI",
				Type: "openai",
				Models: []config.AIProviderModel{{
					ModelName: "gpt-5-mini",
				}},
			}},
		},
		RunMaxWallTime:   3 * time.Second,
		RunIdleTimeout:   3 * time.Second,
		PersistOpTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	t.Cleanup(func() { _ = aiSvc.Close() })

	thread, err := aiSvc.CreateThread(context.Background(), &meta, "input response", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	prompt := &ai.RequestUserInputPrompt{
		PromptID:         "prompt_appserver_input",
		MessageID:        "msg_appserver_input",
		ToolID:           "tool_appserver_input",
		ToolName:         "request_user_input",
		ReasonCode:       "needs_choice",
		RequiredFromUser: []string{"Choose a path."},
		Questions: []ai.RequestUserInputQuestion{
			{
				ID:           "question_1",
				Header:       "Path",
				Question:     "Which path?",
				ResponseMode: "write",
			},
		},
	}
	promptBody, err := json.Marshal(prompt)
	if err != nil {
		t.Fatalf("json.Marshal prompt: %v", err)
	}
	threadsDB, err := threadstore.Open(filepath.Join(stateDir, "ai", "threads.sqlite"))
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	t.Cleanup(func() { _ = threadsDB.Close() })
	if err := threadsDB.UpdateThreadRunState(
		context.Background(),
		meta.EndpointID,
		thread.ThreadID,
		"waiting_user",
		"",
		"",
		string(promptBody),
		meta.UserPublicID,
		meta.UserEmail,
	); err != nil {
		t.Fatalf("UpdateThreadRunState waiting_user: %v", err)
	}

	srv, err := New(Options{
		Logger:  logger,
		Backend: &stubBackend{},
		DistFS: fstest.MapFS{
			"env/index.html": {Data: []byte("<html>env</html>")},
			"inject.js":      {Data: []byte("console.log('inject');")},
		},
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfigWithAI(t),
		ResolveSessionMeta: resolveMetaForTest(channelID, meta),
		AI:                 aiSvc,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	inputResponsePath := "/_redeven_proxy/api/ai/threads/" + url.PathEscape(thread.ThreadID) + "/input_response"
	mismatch := performServerRequest(srv, http.MethodPost, inputResponsePath, envOrigin, `{
		"thread_id":"other_thread",
		"response":{"prompt_id":"prompt_appserver_input","answers":{"question_1":{"text":"ship it"}}},
		"input":{"text":"ship it","attachments":[]},
		"options":{}
	}`)
	if mismatch.Code != http.StatusBadRequest {
		t.Fatalf("mismatched thread_id status=%d, want=%d body=%s", mismatch.Code, http.StatusBadRequest, mismatch.Body.String())
	}

	trailing := performServerRequest(srv, http.MethodPost, inputResponsePath, envOrigin, `{} {}`)
	if trailing.Code != http.StatusBadRequest {
		t.Fatalf("trailing body status=%d, want=%d body=%s", trailing.Code, http.StatusBadRequest, trailing.Body.String())
	}

	body := bytes.NewBufferString(`{
		"response":{"prompt_id":"prompt_appserver_input","answers":{"question_1":{"text":"ship it"}}},
		"input":{"text":"ship it","attachments":[]},
		"options":{}
	}`)
	req := httptest.NewRequest(http.MethodPost, inputResponsePath, body)
	req.Header.Set("Origin", envOrigin)
	rr := httptest.NewRecorder()
	srv.serveHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("input response status=%d body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		OK   bool `json:"ok"`
		Data struct {
			RunID                   string `json:"run_id"`
			Kind                    string `json:"kind"`
			ConsumedWaitingPromptID string `json:"consumed_waiting_prompt_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json.Unmarshal response: %v", err)
	}
	if !resp.OK || resp.Data.Kind != "start" || resp.Data.RunID == "" || resp.Data.ConsumedWaitingPromptID != "prompt_appserver_input" {
		t.Fatalf("unexpected input response payload: %+v", resp)
	}
}
