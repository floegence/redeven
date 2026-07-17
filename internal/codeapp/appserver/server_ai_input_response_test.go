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

	flconfig "github.com/floegence/floret/config"
	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	"github.com/floegence/redeven/internal/ai"
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
	const waitingTurnID = "msg_appserver_input"
	const waitingToolID = "tool_appserver_input"
	const promptID = "rui_" + waitingTurnID + "_" + waitingToolID
	seedAppserverWaitingPrompt(t, stateDir, thread.ThreadID, waitingTurnID, "run_appserver_input", waitingToolID)

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
		"response":{"prompt_id":"`+promptID+`","answers":{"question_1":{"text":"ship it"}}},
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
		"response":{"prompt_id":"` + promptID + `","answers":{"question_1":{"text":"ship it"}}},
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
	if !resp.OK || resp.Data.Kind != "start" || resp.Data.RunID == "" || resp.Data.ConsumedWaitingPromptID != promptID {
		t.Fatalf("unexpected input response payload: %+v", resp)
	}
}

type appserverAskUserGateway struct {
	toolID string
	args   string
}

func (g appserverAskUserGateway) StreamModel(context.Context, flruntime.ModelRequest) (<-chan flruntime.ModelEvent, error) {
	events := make(chan flruntime.ModelEvent, 2)
	events <- flruntime.ModelEvent{Type: flruntime.ModelEventToolCalls, ToolCalls: []fltools.ToolCall{{ID: g.toolID, Name: "ask_user", Args: g.args}}}
	events <- flruntime.ModelEvent{Type: flruntime.ModelEventDone, Reason: "tool_calls"}
	close(events)
	return events, nil
}

func seedAppserverWaitingPrompt(t *testing.T, stateDir string, threadID string, turnID string, runID string, toolID string) {
	t.Helper()
	args, err := json.Marshal(map[string]any{
		"reason_code":        "needs_choice",
		"required_from_user": []string{"Choose a path."},
		"evidence_refs":      []string{"message:latest"},
		"questions": []map[string]any{{
			"id": "question_1", "header": "Path", "question": "Which path?", "response_mode": "write", "is_secret": false,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	store, err := flruntime.OpenSQLiteStore(filepath.Join(stateDir, "ai", "floret_threads.sqlite"))
	if err != nil {
		t.Fatalf("OpenSQLiteStore: %v", err)
	}
	defer func() { _ = store.Close() }()
	host, err := flruntime.NewHost(flruntime.HostOptions{
		Config: flconfig.Config{ContextPolicy: flconfig.ContextPolicy{
			ContextWindowTokens: 128000, MaxOutputTokens: 4096, ReservedOutputTokens: 4096, MaxCompactionFailures: 2,
		}},
		Store:                store,
		ModelGateway:         appserverAskUserGateway{toolID: toolID, args: string(args)},
		ModelGatewayIdentity: flruntime.ModelGatewayIdentity{Provider: "test", Model: "ask-user-test", StateCompatibilityKey: "test:ask-user-test"},
	})
	if err != nil {
		t.Fatalf("NewHost: %v", err)
	}
	result, err := host.RunTurn(context.Background(), flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(threadID), TurnID: flruntime.TurnID(turnID), RunID: flruntime.RunID(runID),
		Input:   "wait for user input",
		Signals: flruntime.TurnSignalSpec{Definitions: flruntime.CoreControlDefinitions(false), Project: flruntime.ProjectCoreControlSignal},
	})
	if err != nil {
		t.Fatalf("RunTurn: %v", err)
	}
	if result.Status != flruntime.TurnStatusWaiting {
		t.Fatalf("waiting turn status=%q, want waiting", result.Status)
	}
}
