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
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

type autoTitleMock struct {
	mu           sync.Mutex
	requestCount int
	token        string
	responses    []autoTitleMockResponse
}

type autoTitleMockResponse struct {
	StatusCode int
	Token      string
	Delay      time.Duration
	WaitCh     <-chan struct{}
}

func (m *autoTitleMock) handle(w http.ResponseWriter, r *http.Request) {
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

	body, _ := io.ReadAll(r.Body)
	_ = r.Body.Close()
	var req map[string]any
	_ = json.Unmarshal(body, &req)

	m.mu.Lock()
	m.requestCount++
	var response autoTitleMockResponse
	if len(m.responses) > 0 {
		response = m.responses[0]
		m.responses = append([]autoTitleMockResponse(nil), m.responses[1:]...)
	}
	m.mu.Unlock()

	if response.WaitCh != nil {
		<-response.WaitCh
	}
	if response.Delay > 0 {
		time.Sleep(response.Delay)
	}
	if response.StatusCode >= 400 {
		http.Error(w, http.StatusText(response.StatusCode), response.StatusCode)
		return
	}

	if strings.TrimSpace(r.URL.Path) != "/v1/responses" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if strings.TrimSpace(anyToString(req["model"])) == "" {
		http.Error(w, "missing model", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	f, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	itemID := "msg_auto_title"
	writeSSEJSON(w, f, map[string]any{
		"type": "response.created",
		"response": map[string]any{
			"id":         "resp_auto_title",
			"created_at": time.Now().Unix(),
			"model":      strings.TrimSpace(anyToString(req["model"])),
		},
	})
	writeSSEJSON(w, f, map[string]any{
		"type":         "response.output_item.added",
		"output_index": 0,
		"item":         map[string]any{"type": "message", "id": itemID},
	})
	writeSSEJSON(w, f, map[string]any{
		"type":    "response.output_text.delta",
		"item_id": itemID,
		"delta": func() string {
			if strings.TrimSpace(response.Token) != "" {
				return response.Token
			}
			return m.token
		}(),
	})
	writeSSEJSON(w, f, map[string]any{
		"type":         "response.output_item.done",
		"output_index": 0,
		"item":         map[string]any{"type": "message", "id": itemID},
	})
	writeSSEJSON(w, f, map[string]any{
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
}

func (m *autoTitleMock) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.requestCount
}

func newAutoTitleTestService(t *testing.T, mock *autoTitleMock) (*Service, session.Meta) {
	t.Helper()
	return newAutoTitleTestServiceWithStateDir(t, mock, t.TempDir())
}

func newAutoTitleTestServiceWithStateDir(t *testing.T, mock *autoTitleMock, stateDir string) (*Service, session.Meta) {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: strings.TrimSuffix(srv.URL, "/") + "/v1",
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			},
		},
	}

	meta := session.Meta{
		EndpointID:        "env_auto_title_test",
		NamespacePublicID: "ns_auto_title_test",
		ChannelID:         "ch_auto_title_test",
		UserPublicID:      "u_auto_title_test",
		UserEmail:         "u_auto_title_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}

	svc, err := NewService(Options{
		Logger:           slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo})),
		StateDir:         stateDir,
		AgentHomeDir:     t.TempDir(),
		Shell:            "bash",
		Config:           cfg,
		PersistOpTimeout: 2 * time.Second,
		RunMaxWallTime:   5 * time.Second,
		RunIdleTimeout:   2 * time.Second,
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

	return svc, meta
}

func TestParseAutoThreadTitleDecision_NormalizesJSONPayload(t *testing.T) {
	t.Parallel()

	got, err := parseAutoThreadTitleDecision("```json\n{\"title\":\"  Fix\\n failing regression tests  \",\"reason\":\"intent_summary\"}\n```")
	if err != nil {
		t.Fatalf("parseAutoThreadTitleDecision: %v", err)
	}
	if got.Title != "Fix failing regression tests" {
		t.Fatalf("Title=%q, want normalized title", got.Title)
	}
	if got.Reason != "intent_summary" {
		t.Fatalf("Reason=%q, want intent_summary", got.Reason)
	}
}

func TestScheduleAutoThreadTitle_PopulatesUntitledThread(t *testing.T) {
	t.Parallel()

	mock := &autoTitleMock{token: `{"title":"Fix failing regression tests","reason":"intent_summary"}`}
	svc, meta := newAutoTitleTestService(t, mock)

	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, &meta, "", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	svc.scheduleAutoThreadTitle(&meta, thread.ThreadID, effectiveCurrentUserInput{
		MessageID:  "msg_auto_title_1",
		PublicText: "please fix the failing regression tests in CI",
	})

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		th, getErr := svc.threadsDB.GetThread(ctx, meta.EndpointID, thread.ThreadID)
		if getErr != nil {
			t.Fatalf("GetThread: %v", getErr)
		}
		if th != nil && strings.TrimSpace(th.Title) != "" {
			if th.Title != "Fix failing regression tests" {
				t.Fatalf("Title=%q, want generated title", th.Title)
			}
			if th.TitleSource != "auto" {
				t.Fatalf("TitleSource=%q, want auto", th.TitleSource)
			}
			if th.TitleInputMessageID != "msg_auto_title_1" {
				t.Fatalf("TitleInputMessageID=%q, want msg_auto_title_1", th.TitleInputMessageID)
			}
			if th.TitleModelID != "openai/gpt-5-mini" {
				t.Fatalf("TitleModelID=%q, want openai/gpt-5-mini", th.TitleModelID)
			}
			if th.TitlePromptVersion != autoThreadTitlePromptVersion {
				t.Fatalf("TitlePromptVersion=%q, want %q", th.TitlePromptVersion, autoThreadTitlePromptVersion)
			}
			if mock.count() == 0 {
				t.Fatalf("requestCount=0, want >=1")
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("auto title was not applied before timeout")
}

func TestApplyAutoThreadTitle_ManualBlankRenamePreventsOverwrite(t *testing.T) {
	t.Parallel()

	mock := &autoTitleMock{token: `{"title":"Should not apply","reason":"intent_summary"}`}
	svc, meta := newAutoTitleTestService(t, mock)

	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, &meta, "", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := svc.RenameThread(ctx, &meta, thread.ThreadID, ""); err != nil {
		t.Fatalf("RenameThread: %v", err)
	}

	svc.applyAutoThreadTitle(ctx, meta.EndpointID, thread.ThreadID, "msg_auto_title_2", "please fix the flaky test", meta.UserPublicID, meta.UserEmail)

	th, err := svc.threadsDB.GetThread(ctx, meta.EndpointID, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing")
	}
	if th.Title != "" {
		t.Fatalf("Title=%q, want empty manual blank title", th.Title)
	}
	if th.TitleSource != "user" {
		t.Fatalf("TitleSource=%q, want user", th.TitleSource)
	}
	if mock.count() != 0 {
		t.Fatalf("requestCount=%d, want 0", mock.count())
	}
}

func TestScheduleAutoThreadTitle_RetriesUntilSuccess(t *testing.T) {
	t.Parallel()

	mock := &autoTitleMock{
		responses: []autoTitleMockResponse{
			{Token: `{"title":`},
			{Token: `{"title":"Retry failing CI regression tests","reason":"intent_summary"}`},
		},
	}
	svc, meta := newAutoTitleTestService(t, mock)

	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, &meta, "", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	svc.scheduleAutoThreadTitle(&meta, thread.ThreadID, effectiveCurrentUserInput{
		MessageID:  "msg_retry_1",
		PublicText: "please fix the retry failure in CI",
	})

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		th, getErr := svc.threadsDB.GetThread(ctx, meta.EndpointID, thread.ThreadID)
		if getErr != nil {
			t.Fatalf("GetThread: %v", getErr)
		}
		if th != nil && strings.TrimSpace(th.Title) != "" {
			if th.Title != "Retry failing CI regression tests" {
				t.Fatalf("Title=%q, want retry result", th.Title)
			}
			if th.TitleInputMessageID != "msg_retry_1" {
				t.Fatalf("TitleInputMessageID=%q, want msg_retry_1", th.TitleInputMessageID)
			}
			if mock.count() < 2 {
				t.Fatalf("requestCount=%d, want >=2 after retry", mock.count())
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("auto title was not applied after retry")
}

func TestScheduleAutoThreadTitle_NewerPendingInputReplacesOlderFailedRequest(t *testing.T) {
	t.Parallel()

	mock := &autoTitleMock{
		responses: []autoTitleMockResponse{
			{Token: `{"title":`},
			{Token: `{"title":"Prepare a focused sandbox smoke fix","reason":"intent_summary"}`},
		},
	}
	svc, meta := newAutoTitleTestService(t, mock)
	svc.threadTitleCoordinator.retryDelay = func(int) time.Duration { return 5 * time.Second }

	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, &meta, "", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	svc.scheduleAutoThreadTitle(&meta, thread.ThreadID, effectiveCurrentUserInput{
		MessageID:  "msg_retry_old",
		PublicText: "please inspect the failing CI job",
	})

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		key := runThreadKey(meta.EndpointID, thread.ThreadID)
		svc.threadTitleCoordinator.mu.Lock()
		pending, ok := svc.threadTitleCoordinator.pending[key]
		svc.threadTitleCoordinator.mu.Unlock()
		if ok && pending.MessageID == "msg_retry_old" && pending.Attempts == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	key := runThreadKey(meta.EndpointID, thread.ThreadID)
	svc.threadTitleCoordinator.mu.Lock()
	pending, ok := svc.threadTitleCoordinator.pending[key]
	svc.threadTitleCoordinator.mu.Unlock()
	if !ok || pending.MessageID != "msg_retry_old" || pending.Attempts != 1 {
		t.Fatalf("old retry was not pending before replacement: %+v", pending)
	}
	svc.scheduleAutoThreadTitle(&meta, thread.ThreadID, effectiveCurrentUserInput{
		MessageID:  "msg_retry_new",
		PublicText: "please prepare a focused sandbox smoke fix",
	})

	deadline = time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		th, getErr := svc.threadsDB.GetThread(ctx, meta.EndpointID, thread.ThreadID)
		if getErr != nil {
			t.Fatalf("GetThread: %v", getErr)
		}
		if th != nil && strings.TrimSpace(th.Title) != "" {
			if th.Title != "Prepare a focused sandbox smoke fix" {
				t.Fatalf("Title=%q, want latest retry result", th.Title)
			}
			if th.TitleInputMessageID != "msg_retry_new" {
				t.Fatalf("TitleInputMessageID=%q, want msg_retry_new", th.TitleInputMessageID)
			}
			if mock.count() < 2 {
				t.Fatalf("requestCount=%d, want >=2", mock.count())
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("newer pending input was not applied")
}

func TestNewService_RecoversPendingAutoThreadTitles(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	initialMock := &autoTitleMock{}
	svc, meta := newAutoTitleTestServiceWithStateDir(t, initialMock, stateDir)

	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, &meta, "", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	persisted, _, err := svc.persistUserMessage(ctx, &meta, meta.EndpointID, thread.ThreadID, RunInput{
		Text: "please recover the blank thread title after restart",
	})
	if err != nil {
		t.Fatalf("persistUserMessage: %v", err)
	}
	if err := svc.Close(); err != nil {
		t.Fatalf("Close initial service: %v", err)
	}

	recoveryMock := &autoTitleMock{
		responses: []autoTitleMockResponse{
			{Token: `{"title":"Recover blank thread title after restart","reason":"intent_summary"}`},
		},
	}
	recoveredSvc, recoveredMeta := newAutoTitleTestServiceWithStateDir(t, recoveryMock, stateDir)
	defer func() { _ = recoveredSvc.Close() }()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		th, getErr := recoveredSvc.threadsDB.GetThread(ctx, recoveredMeta.EndpointID, thread.ThreadID)
		if getErr != nil {
			t.Fatalf("GetThread: %v", getErr)
		}
		if th != nil && strings.TrimSpace(th.Title) != "" {
			if th.Title != "Recover blank thread title after restart" {
				t.Fatalf("Title=%q, want recovery title", th.Title)
			}
			if th.TitleInputMessageID != persisted.MessageID {
				t.Fatalf("TitleInputMessageID=%q, want %q", th.TitleInputMessageID, persisted.MessageID)
			}
			if recoveryMock.count() == 0 {
				t.Fatalf("recovery requestCount=0, want >=1")
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("recovery auto title was not applied")
}
