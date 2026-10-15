package ai

import (
	"context"
	"encoding/json"
	"fmt"
	flruntime "github.com/floegence/floret/v7/runtime"
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

	actualCallCount     int
	previousResponseIDs []string
	issuedResponseIDs   []string
	inputs              []string
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
	m.actualCallCount++
	call := m.actualCallCount
	responseID := fmt.Sprintf("resp_run_%d", call)
	token := fmt.Sprintf("CONTINUATION_TOKEN_%d", call)
	m.previousResponseIDs = append(m.previousResponseIDs, previousResponseID)
	m.issuedResponseIDs = append(m.issuedResponseIDs, responseID)
	input, _ := json.Marshal(req["input"])
	m.inputs = append(m.inputs, string(input))
	m.mu.Unlock()

	writeOpenAIResponsesSSE(w, r, strings.TrimSpace(fmt.Sprint(req["model"])), responseID, token)
}

func (m *openAIContinuationMock) snapshot() ([]string, []string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.previousResponseIDs...), append([]string(nil), m.issuedResponseIDs...)
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

func newOpenAIContinuationServiceForTest(t *testing.T, baseURL string, continuation bool) (*Service, session.Meta) {
	t.Helper()

	var flag *bool
	if continuation {
		flag = &continuation
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg := &config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []config.AIProvider{{
			ID:                    "openai",
			Name:                  "OpenAI",
			Type:                  "openai",
			ResponsesContinuation: flag,
			BaseURL:               strings.TrimSpace(baseURL),
			Models:                []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}},
	}

	svc, err := NewService(Options{
		Logger:                       logger,
		StateDir:                     t.TempDir(),
		AgentHomeDir:                 t.TempDir(),
		Shell:                        "bash",
		Config:                       cfg,
		ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 30 * time.Second, FirstOutputTimeout: 10 * time.Second, IdleTimeout: 10 * time.Second},
		ToolApprovalTimeout:          5 * time.Second,
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
	enabled := true
	configureResponsesContinuation(provider, config.AIProvider{Type: "openai", ResponsesContinuation: &enabled})
	result, err := provider.StreamTurn(context.Background(), ModelGatewayRequest{
		Model: "gpt-5-mini",
		Messages: []Message{{
			Role:    "user",
			Content: []ContentPart{{Type: "text", Text: "hello"}},
		}},
		PreviousState: &ModelGatewayState{Kind: providerContinuationKindOpenAIResponses, ID: "resp_prev"},
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

func TestOpenAIProviderStreamTurnCanDisablePreviousResponseID(t *testing.T) {
	t.Parallel()

	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		_ = json.Unmarshal(raw, &body)
		writeOpenAIResponsesSSE(w, r, "gpt-5-mini", "resp_next", "hello")
	}))
	t.Cleanup(srv.Close)

	provider, err := newProviderAdapter("openai", strings.TrimSuffix(srv.URL, "/")+"/v1", "sk-test", nil)
	if err != nil {
		t.Fatalf("newProviderAdapter: %v", err)
	}
	configureResponsesContinuation(provider, config.AIProvider{Type: "openai", AuthMethod: config.AIAuthAPIKey})
	if _, err := provider.StreamTurn(context.Background(), ModelGatewayRequest{
		Model:         "gpt-5-mini",
		Messages:      []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "complete history"}}}},
		PreviousState: &ModelGatewayState{Kind: providerContinuationKindOpenAIResponses, ID: "resp_prev"},
	}, nil); err != nil {
		t.Fatalf("StreamTurn: %v", err)
	}
	if _, ok := body["previous_response_id"]; ok {
		t.Fatalf("disabled continuation sent previous_response_id: %v", body)
	}
	if !strings.Contains(fmt.Sprint(body["input"]), "complete history") {
		t.Fatalf("disabled continuation lost complete history: %v", body["input"])
	}
}

func TestOpenAIContinuationConfigurationPreservesPreparedSnapshot(t *testing.T) {
	t.Parallel()
	for _, enabled := range []bool{false, true} {
		t.Run(fmt.Sprintf("initially_%v", enabled), func(t *testing.T) {
			var bodies []map[string]json.RawMessage
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				bodies = append(bodies, body)
				writeOpenAIResponsesSSE(w, r, "gpt-5-mini", "resp_next", "hello")
			}))
			defer srv.Close()
			gateway, err := newProviderAdapter("openai", srv.URL, "sk-test", nil)
			if err != nil {
				t.Fatal(err)
			}
			provider := gateway.(*openAIProvider)
			configureResponsesContinuation(provider, config.AIProvider{Type: "openai", ResponsesContinuation: &enabled})
			req := ModelGatewayRequest{Model: "gpt-5-mini", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "complete history"}}}},
				PreviousState: &ModelGatewayState{Kind: providerContinuationKindOpenAIResponses, ID: "resp_previous"}}
			prepared, err := provider.prepareTurn(t.Context(), req)
			if err != nil {
				t.Fatal(err)
			}
			defer prepared.Close()
			nextEnabled := !enabled
			configureResponsesContinuation(provider, config.AIProvider{Type: "openai", ResponsesContinuation: &nextEnabled})
			if _, err := prepared.StreamTurn(t.Context(), nil); err != nil {
				t.Fatal(err)
			}
			if _, err := provider.StreamTurn(t.Context(), req, nil); err != nil {
				t.Fatal(err)
			}
			for index, want := range []bool{enabled, nextEnabled} {
				if _, got := bodies[index]["previous_response_id"]; got != want {
					t.Errorf("request %d continuation=%v, want %v", index, got, want)
				}
				if !strings.Contains(string(bodies[index]["input"]), "complete history") {
					t.Errorf("request %d lost full history", index)
				}
			}
		})
	}
}

func TestIntegrationServiceDurableRuntimeContextReusesOpenAIContinuation(t *testing.T) {
	t.Parallel()

	for _, continuation := range []bool{false, true} {
		t.Run(fmt.Sprintf("enabled_%v", continuation), func(t *testing.T) {
			mock := &openAIContinuationMock{}
			srv := httptest.NewServer(http.HandlerFunc(mock.handle))
			t.Cleanup(srv.Close)
			svc, meta := newOpenAIContinuationServiceForTest(t, strings.TrimSuffix(srv.URL, "/")+"/v1", continuation)

			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			thread, err := svc.CreateThread(ctx, &meta, "Continuation thread", "", "", "")
			if err != nil {
				t.Fatalf("CreateThread: %v", err)
			}
			for index, input := range []string{"hello", "hello again"} {
				if _, err := runTypedTurnForTest(t, ctx, svc, &meta, fmt.Sprintf("run_continuation_%d", index+1), RunStartRequest{
					ThreadID: thread.ThreadID,
					Model:    "openai/gpt-5-mini",
					Input:    RunInput{Text: input},
					Options:  RunOptions{},
				}); err != nil {
					t.Fatalf("typed Send %d: %v", index+1, err)
				}
			}

			previousIDs, issuedResponseIDs := mock.snapshot()
			if len(previousIDs) < 2 || len(issuedResponseIDs) < 2 {
				t.Fatalf("provider calls=(previous=%v responses=%v), want both turns", previousIDs, issuedResponseIDs)
			}
			wantPrevious := ""
			if continuation {
				wantPrevious = issuedResponseIDs[0]
			}
			if previousIDs[0] != "" || previousIDs[1] != wantPrevious {
				t.Fatalf("previous response ids=%v, want first-turn continuation %q", previousIDs, wantPrevious)
			}
			mock.mu.Lock()
			secondInput := mock.inputs[1]
			mock.mu.Unlock()
			for _, text := range []string{"hello", "CONTINUATION_TOKEN_1", "hello again"} {
				if !strings.Contains(secondInput, text) {
					t.Errorf("missing canonical history %q: %s", text, secondInput)
				}
			}
		})
	}
}

func TestOpenAIContinuationFailureRecoversAfterDisablingConfiguration(t *testing.T) {
	t.Parallel()
	var mu sync.Mutex
	var bodies []map[string]json.RawMessage
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		mu.Lock()
		bodies = append(bodies, body)
		mu.Unlock()
		if _, ok := body["previous_response_id"]; ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, `{"error":{"message":"Previous response not found","type":"invalid_request_error","code":"previous_response_not_found"}}`)
			return
		}
		writeOpenAIResponsesSSE(w, r, "gpt-5-mini", "resp_confirmed", "Confirmed answer")
	}))
	defer srv.Close()
	svc, meta := newOpenAIContinuationServiceForTest(t, srv.URL, true)
	thread, err := svc.CreateThread(t.Context(), &meta, "Gateway recovery", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	for index, text := range []string{"First canonical message", "Continue this conversation"} {
		_, err := runTypedTurnForTest(t, t.Context(), svc, &meta, fmt.Sprintf("gateway_%d", index), RunStartRequest{
			ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: text},
		})
		if index == 0 && err != nil || index == 1 && err == nil {
			t.Fatalf("turn %d: %v", index, err)
		}
	}
	svc.mu.Lock()
	next := *svc.cfg
	next.Providers = append([]config.AIProvider(nil), svc.cfg.Providers...)
	svc.mu.Unlock()
	next.Providers[0].ResponsesContinuation = nil
	if err := svc.UpdateConfig(&next, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RetryThreadContinuation(t.Context(), &meta, thread.ThreadID); err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, &meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 3 {
		t.Fatalf("provider requests=%d, want one per turn without hidden retries", len(bodies))
	}
	if _, ok := bodies[2]["previous_response_id"]; ok {
		t.Fatal("retry retained disabled continuation")
	}
	for _, text := range []string{"First canonical message", "Confirmed answer", "Continue this conversation"} {
		if !strings.Contains(string(bodies[2]["input"]), text) {
			t.Errorf("retry lost canonical history %q", text)
		}
	}
}
