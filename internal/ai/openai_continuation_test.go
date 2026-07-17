package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

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
	return append([]string(nil), m.previousResponseIDs...), append([]string(nil), m.issuedResponseIDs...)
}

func (m *openAIContinuationMock) successfulCalls() ([]string, []string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.issuedPreviousIDs...), append([]string(nil), m.issuedResponseIDs...)
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
	cfg := &config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []config.AIProvider{{
			ID:      "openai",
			Name:    "OpenAI",
			Type:    "openai",
			BaseURL: strings.TrimSpace(baseURL),
			Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}},
	}

	svc, err := NewService(Options{
		Logger:              logger,
		StateDir:            t.TempDir(),
		AgentHomeDir:        t.TempDir(),
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

	return svc, session.Meta{
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
}

func TestOpenAIProviderStreamTurnUsesPreviousResponseIDAndReturnsProviderState(t *testing.T) {
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
		t.Fatalf("previous_response_id=%q, want resp_prev", gotPrevious)
	}
	if result.ProviderState == nil || result.ProviderState.ID != "resp_next" {
		t.Fatalf("provider state=%+v, want resp_next", result.ProviderState)
	}
}

func TestIntegrationServiceOpenAIContinuationPersistsInFloretAndResumes(t *testing.T) {
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
	for index, input := range []string{"hello", "hello again"} {
		if err := svc.StartRun(ctx, &meta, fmt.Sprintf("run_continuation_%d", index+1), RunStartRequest{
			ThreadID: thread.ThreadID,
			Model:    "openai/gpt-5-mini",
			Input:    RunInput{Text: input},
			Options:  RunOptions{},
		}, httptest.NewRecorder()); err != nil {
			t.Fatalf("StartRun %d: %v", index+1, err)
		}
	}

	allPreviousIDs, _ := mock.snapshot()
	if len(allPreviousIDs) < 2 || allPreviousIDs[0] != "" {
		t.Fatalf("previous response ids=%v, want initial empty state and resumed turn", allPreviousIDs)
	}
	successfulPreviousIDs, _ := mock.successfulCalls()
	if !containsString(successfulPreviousIDs, "resp_run_1") {
		t.Fatalf("successful previous response ids=%v, want resp_run_1", successfulPreviousIDs)
	}
}

func TestIntegrationServiceRejectedOpenAIContinuationFailsWithoutReplay(t *testing.T) {
	t.Parallel()

	mock := &openAIContinuationMock{rejectPreviousIDOnce: map[string]bool{"resp_run_1": true}}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)
	svc, meta := newOpenAIContinuationServiceForTest(t, strings.TrimSuffix(srv.URL, "/")+"/v1")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	thread, err := svc.CreateThread(ctx, &meta, "Continuation rejection", "", "", "")
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
	if err == nil || !strings.Contains(err.Error(), "previous_response_id") {
		t.Fatalf("StartRun second error=%v, want rejected continuation", err)
	}

	previousIDs, issuedResponseIDs := mock.snapshot()
	if !containsString(previousIDs, "resp_run_1") || !containsString(issuedResponseIDs, "resp_run_1") {
		t.Fatalf("previous ids=%v issued ids=%v, want one rejected resp_run_1 continuation", previousIDs, issuedResponseIDs)
	}
	if len(previousIDs) != 2 {
		t.Fatalf("provider calls=%v, want no Redeven replay after rejection", previousIDs)
	}
}
