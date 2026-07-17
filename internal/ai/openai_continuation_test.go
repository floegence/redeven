package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type openAIContinuationMock struct {
	mu sync.Mutex

	actualCallCount      int
	previousResponseIDs  []string
	issuedPreviousIDs    []string
	issuedResponseIDs    []string
	rejectPreviousIDOnce map[string]bool
}

func (m *openAIContinuationMock) handle(w http.ResponseWriter, r *http.Request) {
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

	previousResponseID := ""
	if raw, ok := req["previous_response_id"]; ok && raw != nil {
		previousResponseID = strings.TrimSpace(fmt.Sprint(raw))
	}

	m.mu.Lock()
	if m.rejectPreviousIDOnce == nil {
		m.rejectPreviousIDOnce = map[string]bool{}
	}
	if previousResponseID != "" && m.rejectPreviousIDOnce[previousResponseID] {
		delete(m.rejectPreviousIDOnce, previousResponseID)
		m.previousResponseIDs = append(m.previousResponseIDs, previousResponseID)
		m.mu.Unlock()
		writeOpenAIAPIError(w, http.StatusBadRequest, "invalid previous_response_id", "previous_response_id", "invalid_previous_response_id")
		return
	}
	m.actualCallCount++
	call := m.actualCallCount
	responseID := fmt.Sprintf("resp_run_%d", call)
	token := fmt.Sprintf("CONTINUATION_TOKEN_%d", call)
	m.previousResponseIDs = append(m.previousResponseIDs, previousResponseID)
	m.issuedPreviousIDs = append(m.issuedPreviousIDs, previousResponseID)
	m.issuedResponseIDs = append(m.issuedResponseIDs, responseID)
	m.mu.Unlock()

	writeOpenAIResponsesSSE(w, r, strings.TrimSpace(fmt.Sprint(req["model"])), responseID, token)
}

func (m *openAIContinuationMock) snapshot() ([]string, []string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	previous := append([]string(nil), m.previousResponseIDs...)
	issued := append([]string(nil), m.issuedResponseIDs...)
	return previous, issued
}

func (m *openAIContinuationMock) successfulCalls() ([]string, []string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	previous := append([]string(nil), m.issuedPreviousIDs...)
	issued := append([]string(nil), m.issuedResponseIDs...)
	return previous, issued
}

func writeOpenAIResponsesSSE(w http.ResponseWriter, r *http.Request, model string, responseID string, token string) {
	if strings.TrimSpace(model) == "" {
		model = "gpt-5-mini"
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	itemID := "msg_test"
	writeSSEJSON(w, flusher, map[string]any{
		"type": "response.created",
		"response": map[string]any{
			"id":         strings.TrimSpace(responseID),
			"created_at": time.Now().Unix(),
			"model":      model,
		},
	})
	writeSSEJSON(w, flusher, map[string]any{
		"type":         "response.output_item.added",
		"output_index": 0,
		"item": map[string]any{
			"type": "message",
			"id":   itemID,
		},
	})
	writeSSEJSON(w, flusher, map[string]any{
		"type":    "response.output_text.delta",
		"item_id": itemID,
		"delta":   token,
	})
	writeSSEJSON(w, flusher, map[string]any{
		"type":         "response.output_item.done",
		"output_index": 0,
		"item": map[string]any{
			"type": "message",
			"id":   itemID,
		},
	})
	writeSSEJSON(w, flusher, map[string]any{
		"type": "response.completed",
		"response": map[string]any{
			"id":     strings.TrimSpace(responseID),
			"status": "completed",
			"usage": map[string]any{
				"input_tokens":  1,
				"output_tokens": 1,
			},
		},
	})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	flusher.Flush()
}

func writeOpenAIAPIError(w http.ResponseWriter, status int, message string, param string, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{
			"type":    "invalid_request_error",
			"message": strings.TrimSpace(message),
			"param":   strings.TrimSpace(param),
			"code":    strings.TrimSpace(code),
		},
	})
}

func newOpenAIContinuationServiceForTest(t *testing.T, baseURL string) (*Service, session.Meta) {
	t.Helper()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()
	cfg := &config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: strings.TrimSpace(baseURL),
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			},
		},
	}

	svc, err := NewService(Options{
		Logger:              logger,
		StateDir:            stateDir,
		AgentHomeDir:        agentHomeDir,
		Shell:               "bash",
		Config:              cfg,
		RunMaxWallTime:      30 * time.Second,
		RunIdleTimeout:      10 * time.Second,
		ToolApprovalTimeout: 5 * time.Second,
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

	meta := session.Meta{
		EndpointID:        "env_continuation",
		NamespacePublicID: "ns_continuation",
		ChannelID:         "ch_continuation",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	return svc, meta
}

func TestOpenAIProviderStreamTurn_UsesPreviousResponseIDAndReturnsProviderState(t *testing.T) {
	t.Parallel()

	var (
		mu       sync.Mutex
		captured string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.TrimSpace(r.URL.Path) != "/v1/responses" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		body, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var req map[string]any
		_ = json.Unmarshal(body, &req)
		previousResponseID := ""
		if raw, ok := req["previous_response_id"]; ok && raw != nil {
			previousResponseID = strings.TrimSpace(fmt.Sprint(raw))
		}
		mu.Lock()
		captured = previousResponseID
		mu.Unlock()
		writeOpenAIResponsesSSE(w, r, "gpt-5-mini", "resp_next", "hello")
	}))
	t.Cleanup(srv.Close)

	provider, err := newProviderAdapter("openai", strings.TrimSuffix(srv.URL, "/")+"/v1", "sk-test", nil)
	if err != nil {
		t.Fatalf("newProviderAdapter: %v", err)
	}

	result, err := provider.StreamTurn(context.Background(), ModelGatewayRequest{
		Model: "gpt-5-mini",
		Messages: []Message{{
			Role:    "user",
			Content: []ContentPart{{Type: "text", Text: "hello"}},
		}},
		ProviderControls: ProviderControls{PreviousResponseID: "resp_prev"},
	}, nil)
	if err != nil {
		t.Fatalf("StreamTurn: %v", err)
	}
	mu.Lock()
	gotPrevious := captured
	mu.Unlock()
	if gotPrevious != "resp_prev" {
		t.Fatalf("previous_response_id=%q, want %q", gotPrevious, "resp_prev")
	}
	if result.ProviderState == nil {
		t.Fatalf("expected provider continuation state")
	}
	if result.ProviderState.ID != "resp_next" {
		t.Fatalf("provider_state.id=%q, want %q", result.ProviderState.ID, "resp_next")
	}
}

func TestIntegration_Service_OpenAIContinuationPersistsAndResumes(t *testing.T) {
	t.Parallel()

	mock := &openAIContinuationMock{}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	svc, meta := newOpenAIContinuationServiceForTest(t, strings.TrimSuffix(srv.URL, "/")+"/v1")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	thread, err := svc.CreateThread(ctx, &meta, "Continuation thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	if err := svc.StartRun(ctx, &meta, "run_continuation_1", RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hello"},
		Options:  RunOptions{},
	}, httptest.NewRecorder()); err != nil {
		t.Fatalf("StartRun first: %v", err)
	}

	continuation, err := svc.threadsDB.GetThreadProviderContinuation(ctx, meta.EndpointID, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetThreadProviderContinuation first: %v", err)
	}
	if continuation == nil || continuation.State.ID != "resp_run_1" {
		t.Fatalf("continuation after first run=%+v, want resp_run_1", continuation)
	}

	if err := svc.StartRun(ctx, &meta, "run_continuation_2", RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hello again"},
		Options:  RunOptions{},
	}, httptest.NewRecorder()); err != nil {
		t.Fatalf("StartRun second: %v", err)
	}

	allPreviousIDs, _ := mock.snapshot()
	if len(allPreviousIDs) < 2 {
		t.Fatalf("previousIDs=%v, want multiple provider calls", allPreviousIDs)
	}
	if allPreviousIDs[0] != "" {
		t.Fatalf("first actual previous_response_id=%q, want empty", allPreviousIDs[0])
	}
	successfulPreviousIDs, issuedResponseIDs := mock.successfulCalls()
	resumedResponseID := ""
	for i, previousID := range successfulPreviousIDs {
		if previousID == "resp_run_1" && i < len(issuedResponseIDs) {
			resumedResponseID = issuedResponseIDs[i]
			break
		}
	}
	if resumedResponseID == "" {
		t.Fatalf("successfulPreviousIDs=%v issuedResponseIDs=%v, want a successful call resumed from resp_run_1", successfulPreviousIDs, issuedResponseIDs)
	}

	continuation, err = svc.threadsDB.GetThreadProviderContinuation(ctx, meta.EndpointID, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetThreadProviderContinuation second: %v", err)
	}
	if continuation == nil || continuation.State.ID != resumedResponseID {
		t.Fatalf("continuation after second run=%+v, want resumed response %q", continuation, resumedResponseID)
	}
}

func TestIntegration_Service_OpenAIContinuationRejectedPreviousResponseIDFailsAndClearsState(t *testing.T) {
	t.Parallel()

	mock := &openAIContinuationMock{
		rejectPreviousIDOnce: map[string]bool{"resp_run_1": true},
	}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	svc, meta := newOpenAIContinuationServiceForTest(t, strings.TrimSuffix(srv.URL, "/")+"/v1")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	thread, err := svc.CreateThread(ctx, &meta, "Continuation replay", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	if err := svc.StartRun(ctx, &meta, "run_replay_1", RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hello"},
		Options:  RunOptions{},
	}, httptest.NewRecorder()); err != nil {
		t.Fatalf("StartRun first: %v", err)
	}
	err = svc.StartRun(ctx, &meta, "run_replay_2", RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hello again"},
		Options:  RunOptions{},
	}, httptest.NewRecorder())
	if err == nil {
		t.Fatalf("StartRun second succeeded, want rejected continuation error")
	}
	if !strings.Contains(err.Error(), "previous_response_id") {
		t.Fatalf("StartRun second error=%v, want rejected continuation detail", err)
	}

	previousIDs, issuedResponseIDs := mock.snapshot()
	if len(previousIDs) < 2 {
		t.Fatalf("previousIDs=%v, want multiple provider calls", previousIDs)
	}
	if previousIDs[0] != "" || !containsString(previousIDs, "resp_run_1") {
		t.Fatalf("previousIDs=%v, want initial empty call and rejected resp_run_1 replay", previousIDs)
	}
	if !containsString(issuedResponseIDs, "resp_run_1") {
		t.Fatalf("issuedResponseIDs=%v, want first successful response", issuedResponseIDs)
	}

	continuation, err := svc.threadsDB.GetThreadProviderContinuation(ctx, meta.EndpointID, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetThreadProviderContinuation: %v", err)
	}
	if continuation != nil {
		t.Fatalf("continuation after rejected state=%+v, want cleared", continuation)
	}
}

func TestProviderContinuationProjector_PreviousStateRequiresMatchingEnvelope(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		continuation threadstore.ThreadProviderContinuation
		providerType string
		modelName    string
		wantPrevious bool
	}{
		{
			name: "matching state",
			continuation: threadstore.ThreadProviderContinuation{
				State: threadstore.ProviderContinuationState{
					Kind:       providerContinuationKindOpenAIResponses,
					ID:         "resp_prev",
					Attributes: map[string]string{"cursor": "cur_1"},
				},
				ProviderID:      "openai",
				Model:           "gpt-5-mini",
				BaseURL:         "https://api.openai.com/v1",
				UpdatedAtUnixMs: 2,
			},
			providerType: "openai",
			modelName:    "gpt-5-mini",
			wantPrevious: true,
		},
		{
			name: "model mismatch",
			continuation: threadstore.ThreadProviderContinuation{
				State: threadstore.ProviderContinuationState{
					Kind: providerContinuationKindOpenAIResponses,
					ID:   "resp_prev",
				},
				ProviderID:      "openai",
				Model:           "gpt-5",
				BaseURL:         "https://api.openai.com/v1",
				UpdatedAtUnixMs: 2,
			},
			providerType: "openai",
			modelName:    "gpt-5-mini",
		},
		{
			name: "provider id mismatch",
			continuation: threadstore.ThreadProviderContinuation{
				State: threadstore.ProviderContinuationState{
					Kind: providerContinuationKindOpenAIResponses,
					ID:   "resp_prev",
				},
				ProviderID:      "openai",
				Model:           "gpt-5-mini",
				BaseURL:         "https://api.openai.com/v1",
				UpdatedAtUnixMs: 2,
			},
			providerType: "openai",
			modelName:    "gpt-5-mini",
		},
		{
			name: "base url mismatch",
			continuation: threadstore.ThreadProviderContinuation{
				State: threadstore.ProviderContinuationState{
					Kind: providerContinuationKindOpenAIResponses,
					ID:   "resp_prev",
				},
				ProviderID:      "openai",
				Model:           "gpt-5-mini",
				BaseURL:         "https://api.openai.com/v1",
				UpdatedAtUnixMs: 2,
			},
			providerType: "openai",
			modelName:    "gpt-5-mini",
		},
		{
			name: "kind mismatch",
			continuation: threadstore.ThreadProviderContinuation{
				State: threadstore.ProviderContinuationState{
					Kind: "other_kind",
					ID:   "resp_prev",
				},
				ProviderID:      "openai",
				Model:           "gpt-5-mini",
				BaseURL:         "https://api.openai.com/v1",
				UpdatedAtUnixMs: 2,
			},
			providerType: "openai",
			modelName:    "gpt-5-mini",
		},
		{
			name: "provider type not supported",
			continuation: threadstore.ThreadProviderContinuation{
				State: threadstore.ProviderContinuationState{
					Kind: providerContinuationKindOpenAIResponses,
					ID:   "resp_prev",
				},
				ProviderID:      "openai",
				Model:           "gpt-5-mini",
				BaseURL:         "https://api.openai.com/v1",
				UpdatedAtUnixMs: 2,
			},
			providerType: "moonshot",
			modelName:    "kimi-k2.6",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
			store, err := threadstore.Open(dbPath)
			if err != nil {
				t.Fatalf("Open: %v", err)
			}
			t.Cleanup(func() { _ = store.Close() })

			ctx := context.Background()
			if err := store.CreateThread(ctx, threadstore.Thread{
				ThreadID:              "th_resume",
				EndpointID:            "env_resume",
				NamespacePublicID:     "ns_resume",
				CreatedByUserPublicID: "u1",
				CreatedByUserEmail:    "u1@example.com",
				UpdatedByUserPublicID: "u1",
				UpdatedByUserEmail:    "u1@example.com",
				CreatedAtUnixMs:       1,
				UpdatedAtUnixMs:       1,
			}); err != nil {
				t.Fatalf("CreateThread: %v", err)
			}
			if err := store.SetThreadProviderContinuation(ctx, "env_resume", "th_resume", tt.continuation); err != nil {
				t.Fatalf("SetThreadProviderContinuation: %v", err)
			}

			r := newRun(runOptions{
				ThreadsDB:  store,
				EndpointID: "env_resume",
				ThreadID:   "th_resume",
			})
			providerID := "openai"
			baseURL := "https://api.openai.com/v1"
			if tt.name == "provider id mismatch" {
				providerID = "openai-alt"
			}
			if tt.name == "base url mismatch" {
				baseURL = "https://proxy.example.com/v1"
			}
			projector := newProviderContinuationProjector(r, providerID, tt.providerType, tt.modelName, baseURL)
			state, err := projector.PreviousState(ctx)
			if err != nil {
				t.Fatalf("PreviousState: %v", err)
			}
			if tt.wantPrevious {
				if state == nil || state.ID != "resp_prev" || state.Kind != providerContinuationKindOpenAIResponses {
					t.Fatalf("previous state=%+v, want resp_prev", state)
				}
				if state.Attributes["cursor"] != "cur_1" {
					t.Fatalf("previous attributes=%v, want cursor", state.Attributes)
				}
				return
			}
			if state != nil {
				t.Fatalf("previous state=%+v, want nil", state)
			}
		})
	}
}

func TestPersistProviderContinuationCandidate_PersistsProviderState(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	ctx := context.Background()
	if err := store.CreateThread(ctx, threadstore.Thread{
		ThreadID:              "th_sync",
		EndpointID:            "env_sync",
		NamespacePublicID:     "ns_sync",
		CreatedByUserPublicID: "u1",
		CreatedByUserEmail:    "u1@example.com",
		UpdatedByUserPublicID: "u1",
		UpdatedByUserEmail:    "u1@example.com",
		CreatedAtUnixMs:       1,
		UpdatedAtUnixMs:       1,
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := store.SetThreadProviderContinuation(ctx, "env_sync", "th_sync", threadstore.ThreadProviderContinuation{
		State: threadstore.ProviderContinuationState{
			Kind: providerContinuationKindOpenAIResponses,
			ID:   "resp_prev",
		},
		ProviderID:      "openai",
		Model:           "gpt-5-mini",
		BaseURL:         "https://api.openai.com/v1",
		UpdatedAtUnixMs: 2,
	}); err != nil {
		t.Fatalf("SetThreadProviderContinuation: %v", err)
	}

	if err := persistProviderContinuationCandidate(ctx, store, "env_sync", "th_sync", threadstore.ThreadProviderContinuation{
		State: threadstore.ProviderContinuationState{
			Kind:       providerContinuationKindOpenAIResponses,
			ID:         "resp_next",
			Attributes: map[string]string{"cursor": "cur_next"},
		},
		ProviderID:      "openai",
		Model:           "gpt-5-mini",
		BaseURL:         "https://api.openai.com/v1",
		UpdatedAtUnixMs: 3,
	}); err != nil {
		t.Fatalf("persistProviderContinuationCandidate: %v", err)
	}

	got, err := store.GetThreadProviderContinuation(ctx, "env_sync", "th_sync")
	if err != nil {
		t.Fatalf("GetThreadProviderContinuation: %v", err)
	}
	if got == nil || got.State.ID != "resp_next" {
		t.Fatalf("continuation after sync=%+v, want resp_next", got)
	}
	if got.State.Attributes["cursor"] != "cur_next" {
		t.Fatalf("continuation attributes=%v, want cursor", got.State.Attributes)
	}
}
