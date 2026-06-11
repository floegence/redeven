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
	"unicode/utf8"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type autoTitleMock struct {
	mu           sync.Mutex
	requestCount int
	maxTokens    []int
	requests     []map[string]any
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
	maxTokens := jsonNumberToInt(req["max_output_tokens"])

	m.mu.Lock()
	m.requestCount++
	m.maxTokens = append(m.maxTokens, maxTokens)
	m.requests = append(m.requests, req)
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

func (m *autoTitleMock) maxTokensSnapshot() []int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]int(nil), m.maxTokens...)
}

func (m *autoTitleMock) requestPayloads() []map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]map[string]any(nil), m.requests...)
}

func jsonNumberToInt(v any) int {
	switch val := v.(type) {
	case float64:
		return int(val)
	case float32:
		return int(val)
	case int:
		return val
	case int64:
		return int(val)
	case json.Number:
		n, _ := val.Int64()
		return int(n)
	default:
		return 0
	}
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

func TestScheduleAutoThreadTitle_PopulatesUntitledThread(t *testing.T) {
	t.Parallel()

	mock := &autoTitleMock{token: `Fix failing regression tests`}
	svc, meta := newAutoTitleTestService(t, mock)

	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, &meta, "", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	svc.scheduleAutoThreadTitle(&meta, thread.ThreadID, effectiveCurrentUserInput{
		MessageID:              "msg_auto_title_1",
		MessageRowID:           1,
		MessageCreatedAtUnixMs: 100,
		PublicText:             "please fix the failing regression tests in CI",
	})

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		th, getErr := svc.threadsDB.GetThread(ctx, meta.EndpointID, thread.ThreadID)
		if getErr != nil {
			t.Fatalf("GetThread: %v", getErr)
		}
		if th != nil && strings.TrimSpace(th.Title) != "" {
			assertShortAutoTitle(t, th.Title)
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
			payloads := mock.requestPayloads()
			if len(payloads) == 0 {
				t.Fatalf("provider request payload missing")
			}
			rawPayload, err := json.Marshal(payloads[0])
			if err != nil {
				t.Fatalf("Marshal request payload: %v", err)
			}
			payloadText := string(rawPayload)
			if !strings.Contains(payloadText, "You generate concise thread titles for an interactive AI agent.") {
				t.Fatalf("provider request did not use Floret title prompt: %s", payloadText)
			}
			if strings.Contains(payloadText, "thread_title_v1") || strings.Contains(payloadText, "Return JSON only") {
				t.Fatalf("provider request retained old Redeven title prompt: %s", payloadText)
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("auto title was not applied before timeout")
}

func TestApplyAutoThreadTitle_ManualBlankRenamePreventsOverwrite(t *testing.T) {
	t.Parallel()

	mock := &autoTitleMock{token: `Should not apply`}
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
			{Token: ``},
			{Token: `Retry failing CI regression tests`},
		},
	}
	svc, meta := newAutoTitleTestService(t, mock)

	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, &meta, "", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	svc.scheduleAutoThreadTitle(&meta, thread.ThreadID, effectiveCurrentUserInput{
		MessageID:              "msg_retry_1",
		MessageRowID:           1,
		MessageCreatedAtUnixMs: 100,
		PublicText:             "please fix the retry failure in CI",
	})

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		th, getErr := svc.threadsDB.GetThread(ctx, meta.EndpointID, thread.ThreadID)
		if getErr != nil {
			t.Fatalf("GetThread: %v", getErr)
		}
		if th != nil && strings.TrimSpace(th.Title) != "" {
			assertShortAutoTitle(t, th.Title)
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

func TestScheduleAutoThreadTitle_LeavesThreadUntitledAfterGenerationFailures(t *testing.T) {
	t.Parallel()

	mock := &autoTitleMock{
		responses: []autoTitleMockResponse{
			{Token: ``},
			{Token: ``},
			{Token: ``},
		},
	}
	svc, meta := newAutoTitleTestService(t, mock)
	svc.threadTitleCoordinator.retryDelay = func(int) time.Duration { return 5 * time.Millisecond }

	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, &meta, "", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	firstText := "please fix the failing regression tests in CI before the release cut ships today"
	persisted, _, err := svc.persistUserMessage(ctx, &meta, meta.EndpointID, thread.ThreadID, RunInput{Text: firstText})
	if err != nil {
		t.Fatalf("persistUserMessage: %v", err)
	}

	svc.scheduleAutoThreadTitle(&meta, thread.ThreadID, effectiveCurrentUserInput{
		MessageID:              persisted.MessageID,
		MessageRowID:           persisted.RowID,
		MessageCreatedAtUnixMs: persisted.CreatedAtUnixMs,
		PublicText:             firstText,
	})

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		key := runThreadKey(meta.EndpointID, thread.ThreadID)
		svc.threadTitleCoordinator.mu.Lock()
		_, pending := svc.threadTitleCoordinator.pending[key]
		_, inFlight := svc.threadTitleCoordinator.inFlight[key]
		svc.threadTitleCoordinator.mu.Unlock()
		if mock.count() == 3 && !pending && !inFlight {
			th, getErr := svc.threadsDB.GetThread(ctx, meta.EndpointID, thread.ThreadID)
			if getErr != nil {
				t.Fatalf("GetThread: %v", getErr)
			}
			if th == nil {
				t.Fatalf("thread missing")
			}
			if strings.TrimSpace(th.Title) != "" || strings.TrimSpace(th.TitleSource) != "" {
				t.Fatalf("thread title should remain empty after provider failures: %+v", th)
			}
			if th.TitleInputMessageID != "" || th.TitleModelID != "" || th.TitlePromptVersion != "" {
				t.Fatalf("title metadata should remain empty after provider failures: %+v", th)
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("auto title failures did not exhaust before timeout; count=%d maxTokens=%v", mock.count(), mock.maxTokensSnapshot())
}

func TestScheduleAutoThreadTitle_NewerPendingInputReplacesOlderFailedRequest(t *testing.T) {
	t.Parallel()

	mock := &autoTitleMock{
		responses: []autoTitleMockResponse{
			{Token: ``},
			{Token: `Prepare a focused sandbox smoke fix`},
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
		MessageID:              "msg_retry_old",
		MessageRowID:           1,
		MessageCreatedAtUnixMs: 100,
		PublicText:             "please inspect the failing CI job",
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
		MessageID:              "msg_retry_new",
		MessageRowID:           2,
		MessageCreatedAtUnixMs: 200,
		PublicText:             "please prepare a focused sandbox smoke fix",
	})

	deadline = time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		th, getErr := svc.threadsDB.GetThread(ctx, meta.EndpointID, thread.ThreadID)
		if getErr != nil {
			t.Fatalf("GetThread: %v", getErr)
		}
		if th != nil && strings.TrimSpace(th.Title) != "" {
			assertShortAutoTitle(t, th.Title)
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

func TestAutoThreadTitleCoordinator_ScheduleKeepsNewerPendingRequest(t *testing.T) {
	t.Parallel()

	c := &autoThreadTitleCoordinator{
		pending: make(map[string]autoThreadTitleRequest),
		wakeCh:  make(chan struct{}, 1),
	}

	newer := autoThreadTitleRequest{
		EndpointID:             "env",
		ThreadID:               "thread",
		MessageID:              "msg_new",
		MessageRowID:           2,
		MessageCreatedAtUnixMs: 200,
		PublicText:             "new title input",
	}
	older := autoThreadTitleRequest{
		EndpointID:             "env",
		ThreadID:               "thread",
		MessageID:              "msg_old",
		MessageRowID:           1,
		MessageCreatedAtUnixMs: 100,
		PublicText:             "old title input",
	}

	c.Schedule(newer)
	c.Schedule(older)

	key := runThreadKey("env", "thread")
	c.mu.Lock()
	pending, ok := c.pending[key]
	c.mu.Unlock()
	if !ok {
		t.Fatalf("pending request missing")
	}
	if pending.MessageID != newer.MessageID {
		t.Fatalf("pending.MessageID=%q, want %q", pending.MessageID, newer.MessageID)
	}
}

func TestAutoThreadTitleCoordinator_ScheduleDoesNotResetSamePendingRequest(t *testing.T) {
	t.Parallel()

	req := autoThreadTitleRequest{
		EndpointID:             "env",
		ThreadID:               "thread",
		MessageID:              "msg_pending",
		MessageRowID:           2,
		MessageCreatedAtUnixMs: 200,
		PublicText:             "pending title input",
		UpdatedByID:            "u_original",
		UpdatedByEmail:         "original@example.com",
		Attempts:               2,
		NextAttemptAt:          time.Now().Add(30 * time.Second),
	}
	key := runThreadKey(req.EndpointID, req.ThreadID)
	c := &autoThreadTitleCoordinator{
		pending: map[string]autoThreadTitleRequest{
			key: req,
		},
		wakeCh: make(chan struct{}, 1),
	}

	duplicate := req
	duplicate.Attempts = 0
	duplicate.NextAttemptAt = time.Now()
	duplicate.UpdatedByID = "u_recovered"
	duplicate.UpdatedByEmail = "recovered@example.com"
	c.Schedule(duplicate)

	c.mu.Lock()
	pending, ok := c.pending[key]
	c.mu.Unlock()
	if !ok {
		t.Fatalf("pending request missing")
	}
	if pending.Attempts != 2 {
		t.Fatalf("pending.Attempts=%d, want 2", pending.Attempts)
	}
	if !pending.NextAttemptAt.Equal(req.NextAttemptAt) {
		t.Fatalf("pending.NextAttemptAt=%v, want %v", pending.NextAttemptAt, req.NextAttemptAt)
	}
}

func TestAutoThreadTitleCoordinator_InFlightRequestIsNotRescheduled(t *testing.T) {
	t.Parallel()

	req := autoThreadTitleRequest{
		EndpointID:             "env",
		ThreadID:               "thread",
		MessageID:              "msg_current",
		MessageRowID:           3,
		MessageCreatedAtUnixMs: 300,
		PublicText:             "current title input",
		UpdatedByID:            "u_original",
		UpdatedByEmail:         "original@example.com",
	}
	key := runThreadKey(req.EndpointID, req.ThreadID)
	c := &autoThreadTitleCoordinator{
		pending: map[string]autoThreadTitleRequest{
			key: req,
		},
		inFlight: make(map[string]autoThreadTitleRequest),
		wakeCh:   make(chan struct{}, 1),
	}

	selected, wait, ok := c.nextRequest()
	if !ok || wait != 0 {
		t.Fatalf("nextRequest ok=%v wait=%v, want due request", ok, wait)
	}
	if !autoThreadTitleRequestsMatch(selected, req) {
		t.Fatalf("selected=%+v, want %+v", selected, req)
	}

	duplicate := req
	duplicate.UpdatedByID = "u_recovered"
	duplicate.UpdatedByEmail = "recovered@example.com"
	c.Schedule(duplicate)

	c.mu.Lock()
	_, pending := c.pending[key]
	active, activeOK := c.inFlight[key]
	c.mu.Unlock()
	if pending {
		t.Fatalf("duplicate in-flight request was requeued")
	}
	if !activeOK || !autoThreadTitleRequestsMatch(active, req) {
		t.Fatalf("inFlight=%+v ok=%v, want original request", active, activeOK)
	}
}

func TestAutoThreadTitleCoordinator_RetryRequeuesOwnedInFlightRequest(t *testing.T) {
	t.Parallel()

	req := autoThreadTitleRequest{
		EndpointID:             "env",
		ThreadID:               "thread",
		MessageID:              "msg_retry",
		MessageRowID:           4,
		MessageCreatedAtUnixMs: 400,
		PublicText:             "retry title input",
	}
	key := runThreadKey(req.EndpointID, req.ThreadID)
	c := &autoThreadTitleCoordinator{
		pending:    make(map[string]autoThreadTitleRequest),
		inFlight:   map[string]autoThreadTitleRequest{key: req},
		retryDelay: func(int) time.Duration { return 0 },
	}

	c.handleResult(req, autoThreadTitleApplyResult{
		Status: autoThreadTitleApplyStatusRetry,
		Reason: "generation_failed",
	})

	c.mu.Lock()
	pending, pendingOK := c.pending[key]
	_, activeOK := c.inFlight[key]
	c.mu.Unlock()
	if activeOK {
		t.Fatalf("in-flight request was not released after retry")
	}
	if !pendingOK {
		t.Fatalf("retry request was not requeued")
	}
	if pending.Attempts != 1 {
		t.Fatalf("pending.Attempts=%d, want 1", pending.Attempts)
	}
}

func TestAutoThreadTitleCoordinator_HandleResultKeepsNewerPendingRequest(t *testing.T) {
	t.Parallel()

	newer := autoThreadTitleRequest{
		EndpointID:             "env",
		ThreadID:               "thread",
		MessageID:              "msg_new",
		MessageRowID:           2,
		MessageCreatedAtUnixMs: 200,
		PublicText:             "new title input",
	}
	older := autoThreadTitleRequest{
		EndpointID:             "env",
		ThreadID:               "thread",
		MessageID:              "msg_old",
		MessageRowID:           1,
		MessageCreatedAtUnixMs: 100,
		PublicText:             "old title input",
	}

	c := &autoThreadTitleCoordinator{
		pending: map[string]autoThreadTitleRequest{
			runThreadKey("env", "thread"): newer,
		},
	}
	c.handleResult(older, autoThreadTitleApplyResult{
		Status: autoThreadTitleApplyStatusTerminal,
		Reason: "title_already_present",
	})

	key := runThreadKey("env", "thread")
	c.mu.Lock()
	pending, ok := c.pending[key]
	c.mu.Unlock()
	if !ok {
		t.Fatalf("pending request missing after stale terminal result")
	}
	if pending.MessageID != newer.MessageID {
		t.Fatalf("pending.MessageID=%q, want %q", pending.MessageID, newer.MessageID)
	}
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
			{Token: `Recover blank thread title after restart`},
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
			assertShortAutoTitle(t, th.Title)
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

func assertShortAutoTitle(t *testing.T, title string) {
	t.Helper()
	title = strings.TrimSpace(title)
	if title == "" {
		t.Fatalf("Title is empty, want generated auto title")
	}
	if got := utf8.RuneCountInString(title); got > 16 {
		t.Fatalf("Title=%q length=%d, want at most 16 runes", title, got)
	}
}
