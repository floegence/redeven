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

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
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

type moonshotAutoTitleMock struct {
	mu           sync.Mutex
	requestCount int
	maxTokens    []int
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

func (m *moonshotAutoTitleMock) handle(w http.ResponseWriter, r *http.Request) {
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
	if !strings.HasSuffix(strings.TrimSpace(r.URL.Path), "/chat/completions") {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	var req map[string]any
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	maxTokens := jsonNumberToInt(req["max_tokens"])
	m.mu.Lock()
	m.requestCount++
	m.maxTokens = append(m.maxTokens, maxTokens)
	m.mu.Unlock()

	f, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")

	if maxTokens < autoThreadTitleMaxOutputHigh {
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_auto_title_low",
			"object":  "chat.completion.chunk",
			"created": 123,
			"model":   "kimi-k2.6",
			"choices": []any{
				map[string]any{
					"index":         0,
					"finish_reason": nil,
					"delta": map[string]any{
						"role":              "assistant",
						"reasoning_content": "Need to summarize the thread issue before returning JSON.",
					},
				},
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_auto_title_low",
			"object":  "chat.completion.chunk",
			"created": 123,
			"model":   "kimi-k2.6",
			"choices": []any{
				map[string]any{
					"index":         0,
					"finish_reason": "length",
					"delta":         map[string]any{},
				},
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_auto_title_low",
			"object":  "chat.completion.chunk",
			"created": 123,
			"model":   "kimi-k2.6",
			"choices": []any{},
			"usage": map[string]any{
				"prompt_tokens":     12,
				"completion_tokens": 4,
				"total_tokens":      16,
				"completion_tokens_details": map[string]any{
					"reasoning_tokens": 4,
				},
			},
		})
		return
	}

	writeOpenAISSEJSON(w, f, map[string]any{
		"id":      "chatcmpl_auto_title_high",
		"object":  "chat.completion.chunk",
		"created": 124,
		"model":   "kimi-k2.6",
		"choices": []any{
			map[string]any{
				"index":         0,
				"finish_reason": nil,
				"delta": map[string]any{
					"role":              "assistant",
					"reasoning_content": "Expanded budget allows the final JSON payload to be emitted.",
				},
			},
		},
	})
	writeOpenAISSEJSON(w, f, map[string]any{
		"id":      "chatcmpl_auto_title_high",
		"object":  "chat.completion.chunk",
		"created": 124,
		"model":   "kimi-k2.6",
		"choices": []any{
			map[string]any{
				"index":         0,
				"finish_reason": nil,
				"delta": map[string]any{
					"content": `{"title":"Investigate thread title stuck on New Chat","reason":"debug_thread_title"}`,
				},
			},
		},
	})
	writeOpenAISSEJSON(w, f, map[string]any{
		"id":      "chatcmpl_auto_title_high",
		"object":  "chat.completion.chunk",
		"created": 124,
		"model":   "kimi-k2.6",
		"choices": []any{
			map[string]any{
				"index":         0,
				"finish_reason": "stop",
				"delta":         map[string]any{},
			},
		},
	})
	writeOpenAISSEJSON(w, f, map[string]any{
		"id":      "chatcmpl_auto_title_high",
		"object":  "chat.completion.chunk",
		"created": 124,
		"model":   "kimi-k2.6",
		"choices": []any{},
		"usage": map[string]any{
			"prompt_tokens":     14,
			"completion_tokens": 8,
			"total_tokens":      22,
			"completion_tokens_details": map[string]any{
				"reasoning_tokens": 6,
			},
		},
	})
}

func (m *moonshotAutoTitleMock) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.requestCount
}

func (m *moonshotAutoTitleMock) maxTokensSnapshot() []int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]int(nil), m.maxTokens...)
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

func newMoonshotAutoTitleTestService(t *testing.T, mock *moonshotAutoTitleMock) (*Service, session.Meta) {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "moonshot",
				Name:    "Moonshot",
				Type:    "moonshot",
				BaseURL: strings.TrimSuffix(srv.URL, "/") + "/v1",
				Models:  []config.AIProviderModel{{ModelName: "kimi-k2.6"}},
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
		StateDir:         t.TempDir(),
		AgentHomeDir:     t.TempDir(),
		Shell:            "bash",
		Config:           cfg,
		PersistOpTimeout: 2 * time.Second,
		RunMaxWallTime:   5 * time.Second,
		RunIdleTimeout:   2 * time.Second,
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(providerID) != "moonshot" {
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

func TestApplyAutoThreadTitle_ExpandsOutputBudgetForReasoningHeavyProvider(t *testing.T) {
	t.Parallel()

	mock := &moonshotAutoTitleMock{}
	svc, meta := newMoonshotAutoTitleTestService(t, mock)

	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, &meta, "", "moonshot/kimi-k2.6", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	svc.applyAutoThreadTitle(ctx, meta.EndpointID, thread.ThreadID, "msg_auto_title_budget", "please investigate why the thread title stays on New Chat", meta.UserPublicID, meta.UserEmail)

	th, err := svc.threadsDB.GetThread(ctx, meta.EndpointID, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if th == nil {
		t.Fatalf("thread missing")
	}
	if th.Title != "Investigate thread title stuck on New Chat" {
		t.Fatalf("Title=%q, want adaptive retry title", th.Title)
	}
	if th.TitleSource != "auto" {
		t.Fatalf("TitleSource=%q, want auto", th.TitleSource)
	}
	if th.TitleInputMessageID != "msg_auto_title_budget" {
		t.Fatalf("TitleInputMessageID=%q, want msg_auto_title_budget", th.TitleInputMessageID)
	}
	if th.TitleModelID != "moonshot/kimi-k2.6" {
		t.Fatalf("TitleModelID=%q, want moonshot/kimi-k2.6", th.TitleModelID)
	}
	if mock.count() != 2 {
		t.Fatalf("requestCount=%d, want 2 attempts within one apply call", mock.count())
	}
	if got := mock.maxTokensSnapshot(); len(got) != 2 || got[0] != autoThreadTitleMaxOutputLow || got[1] != autoThreadTitleMaxOutputHigh {
		t.Fatalf("maxTokens=%v, want [%d %d]", got, autoThreadTitleMaxOutputLow, autoThreadTitleMaxOutputHigh)
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

func TestScheduleAutoThreadTitle_FallsBackAfterThreeFailures(t *testing.T) {
	t.Parallel()

	mock := &autoTitleMock{
		responses: []autoTitleMockResponse{
			{Token: `{"title":`},
			{Token: `{"title":`},
			{Token: `{"title":`},
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

	wantFallback := normalizeAutoThreadTitle(firstText)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		th, getErr := svc.threadsDB.GetThread(ctx, meta.EndpointID, thread.ThreadID)
		if getErr != nil {
			t.Fatalf("GetThread: %v", getErr)
		}
		if th != nil && strings.TrimSpace(th.Title) != "" {
			if th.Title != wantFallback {
				t.Fatalf("Title=%q, want fallback %q", th.Title, wantFallback)
			}
			if th.TitleSource != threadstore.ThreadTitleSourceAutoFallback {
				t.Fatalf("TitleSource=%q, want %q", th.TitleSource, threadstore.ThreadTitleSourceAutoFallback)
			}
			if th.TitleInputMessageID != persisted.MessageID {
				t.Fatalf("TitleInputMessageID=%q, want %q", th.TitleInputMessageID, persisted.MessageID)
			}
			if th.TitleModelID != "" {
				t.Fatalf("TitleModelID=%q, want empty for fallback", th.TitleModelID)
			}
			if th.TitlePromptVersion != "" {
				t.Fatalf("TitlePromptVersion=%q, want empty for fallback", th.TitlePromptVersion)
			}
			if mock.count() != 3 {
				t.Fatalf("requestCount=%d, want 3 generation attempts before fallback", mock.count())
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("fallback title was not applied before timeout")
}

func TestScheduleAutoThreadTitle_RegeneratesAfterFallbackWhenNewUserMessageArrives(t *testing.T) {
	t.Parallel()

	mock := &autoTitleMock{token: `{"title":"Prepare focused sandbox smoke fix","reason":"intent_summary"}`}
	svc, meta := newAutoTitleTestService(t, mock)

	ctx := context.Background()
	thread, err := svc.CreateThread(ctx, &meta, "", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	firstPersisted, _, err := svc.persistUserMessage(ctx, &meta, meta.EndpointID, thread.ThreadID, RunInput{Text: "first request that becomes fallback title"})
	if err != nil {
		t.Fatalf("persistUserMessage first: %v", err)
	}
	updated, err := svc.threadsDB.SetFallbackThreadTitle(ctx, meta.EndpointID, thread.ThreadID, normalizeAutoThreadTitle("first request that becomes fallback title"), firstPersisted.MessageID, 321, meta.UserPublicID, meta.UserEmail)
	if err != nil {
		t.Fatalf("SetFallbackThreadTitle: %v", err)
	}
	if !updated {
		t.Fatalf("SetFallbackThreadTitle updated=false, want true")
	}
	secondText := "please prepare a focused sandbox smoke fix"
	secondPersisted, _, err := svc.persistUserMessage(ctx, &meta, meta.EndpointID, thread.ThreadID, RunInput{Text: secondText})
	if err != nil {
		t.Fatalf("persistUserMessage second: %v", err)
	}

	svc.scheduleAutoThreadTitle(&meta, thread.ThreadID, effectiveCurrentUserInput{
		MessageID:              secondPersisted.MessageID,
		MessageRowID:           secondPersisted.RowID,
		MessageCreatedAtUnixMs: secondPersisted.CreatedAtUnixMs,
		PublicText:             secondText,
	})

	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		th, getErr := svc.threadsDB.GetThread(ctx, meta.EndpointID, thread.ThreadID)
		if getErr != nil {
			t.Fatalf("GetThread: %v", getErr)
		}
		if th != nil && strings.TrimSpace(th.Title) == "Prepare focused sandbox smoke fix" {
			if th.TitleSource != threadstore.ThreadTitleSourceAuto {
				t.Fatalf("TitleSource=%q, want %q", th.TitleSource, threadstore.ThreadTitleSourceAuto)
			}
			if th.TitleInputMessageID != secondPersisted.MessageID {
				t.Fatalf("TitleInputMessageID=%q, want %q", th.TitleInputMessageID, secondPersisted.MessageID)
			}
			if th.TitleModelID != "openai/gpt-5-mini" {
				t.Fatalf("TitleModelID=%q, want openai/gpt-5-mini", th.TitleModelID)
			}
			if mock.count() != 1 {
				t.Fatalf("requestCount=%d, want 1 regeneration attempt", mock.count())
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("auto title was not regenerated after fallback")
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
