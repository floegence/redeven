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

type anthropicMock struct {
	token     string
	responses []anthropicMockResponse

	mu               sync.Mutex
	sawMessages      bool
	requestToolNames []string
	step             int
}

type anthropicMockResponse struct {
	Text       string
	StopReason string
}

func (m *anthropicMock) handle(w http.ResponseWriter, r *http.Request) {
	if r == nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if strings.TrimSpace(r.Header.Get("x-api-key")) != "sk-ant-test" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if !strings.HasSuffix(strings.TrimSpace(r.URL.Path), "/messages") {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	body, _ := io.ReadAll(r.Body)
	_ = r.Body.Close()
	var req map[string]any
	_ = json.Unmarshal(body, &req)

	toolNames := make([]string, 0, 8)
	if rawTools, ok := req["tools"].([]any); ok {
		for _, item := range rawTools {
			m, ok := item.(map[string]any)
			if !ok || m == nil {
				continue
			}
			name, _ := m["name"].(string)
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			toolNames = append(toolNames, name)
		}
	}

	m.mu.Lock()
	m.sawMessages = true
	m.requestToolNames = toolNames
	m.step++
	step := m.step
	resp := anthropicMockResponse{Text: m.token, StopReason: "end_turn"}
	if len(m.responses) > 0 {
		idx := step - 1
		if idx >= len(m.responses) {
			idx = len(m.responses) - 1
		}
		if idx >= 0 {
			resp = m.responses[idx]
		}
	}
	m.mu.Unlock()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	f, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	writeAnthropicSSEJSON(w, f, map[string]any{
		"type":    "message_start",
		"message": map[string]any{},
	})
	writeAnthropicSSEJSON(w, f, map[string]any{
		"type":          "content_block_start",
		"index":         0,
		"content_block": map[string]any{"type": "text", "text": ""},
	})
	if strings.TrimSpace(resp.Text) != "" {
		writeAnthropicSSEJSON(w, f, map[string]any{
			"type":  "content_block_delta",
			"index": 0,
			"delta": map[string]any{"type": "text_delta", "text": resp.Text},
		})
	}
	writeAnthropicSSEJSON(w, f, map[string]any{
		"type":  "content_block_stop",
		"index": 0,
	})
	writeAnthropicSSEJSON(w, f, map[string]any{
		"type":  "message_delta",
		"delta": map[string]any{"stop_reason": resp.StopReason, "stop_sequence": nil},
		"usage": map[string]any{"output_tokens": 1},
	})
	writeAnthropicSSEJSON(w, f, map[string]any{
		"type": "message_stop",
	})
}

func (m *anthropicMock) didSeeMessages() bool {
	m.mu.Lock()
	v := m.sawMessages
	m.mu.Unlock()
	return v
}

func writeAnthropicSSEJSON(w io.Writer, f http.Flusher, v any) {
	if m, ok := v.(map[string]any); ok {
		if t, ok := m["type"].(string); ok {
			t = strings.TrimSpace(t)
			if t != "" {
				_, _ = io.WriteString(w, "event: ")
				_, _ = io.WriteString(w, t)
				_, _ = io.WriteString(w, "\n")
			}
		}
	}
	b, _ := json.Marshal(v)
	_, _ = io.WriteString(w, "data: ")
	_, _ = w.Write(b)
	_, _ = io.WriteString(w, "\n\n")
	f.Flush()
}

func newAnthropicTestService(t *testing.T, mock *anthropicMock) (*Service, session.Meta) {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()

	baseURL := strings.TrimSuffix(srv.URL, "/") + "/v1"
	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "anthropic",
				Name:    "Anthropic",
				Type:    "anthropic",
				BaseURL: baseURL,
				Models:  []config.AIProviderModel{{ModelName: "claude-3-5-sonnet-latest"}},
			},
		},
	}

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_test_anthropic_1",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
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
			if strings.TrimSpace(providerID) != "anthropic" {
				return "", false, nil
			}
			return "sk-ant-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	return svc, meta
}

func TestIntegration_ModelGateway_Anthropic_Stream_Succeeds(t *testing.T) {
	t.Parallel()

	token := "MOCK_ANTHROPIC_OK"
	mock := &anthropicMock{token: token}
	svc, meta := newAnthropicTestService(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	th, err := svc.CreateThread(ctx, &meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_test_model_gateway_anthropic_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "anthropic/claude-3-5-sonnet-latest",
		Input:    RunInput{Text: "hello"},
		Options:  RunOptions{},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	if !strings.Contains(rr.Body.String(), token) {
		t.Fatalf("NDJSON stream missing token %q, body=%q", token, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"type":"message-end"`) {
		t.Fatalf("NDJSON stream missing message-end, body=%q", rr.Body.String())
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing after run")
	}
	if strings.TrimSpace(view.LastMessagePreview) == "" {
		t.Fatalf("last_message_preview should not be empty")
	}
	if !strings.Contains(view.LastMessagePreview, token) {
		t.Fatalf("last_message_preview=%q, want it to include %q", view.LastMessagePreview, token)
	}
	if !mock.didSeeMessages() {
		t.Fatalf("expected Anthropic Messages API call (/messages)")
	}
}

func TestIntegration_ModelGateway_Anthropic_LengthContinuationSucceeds(t *testing.T) {
	t.Parallel()

	mock := &anthropicMock{
		responses: []anthropicMockResponse{
			{Text: "PART_1", StopReason: "max_tokens"},
			{Text: "PART_2", StopReason: "end_turn"},
		},
	}
	svc, meta := newAnthropicTestService(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	th, err := svc.CreateThread(ctx, &meta, "length continuation", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_test_model_gateway_anthropic_length_1"
	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "anthropic/claude-3-5-sonnet-latest",
		Input:    RunInput{Text: "请用 markdown 写一篇长篇童话故事"},
		Options:  RunOptions{},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	if !strings.Contains(rr.Body.String(), "PART_1") || !strings.Contains(rr.Body.String(), "PART_2") {
		t.Fatalf("NDJSON stream should contain both continuation chunks, body=%q", rr.Body.String())
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if got := strings.TrimSpace(view.RunStatus); got != string(RunStateSuccess) {
		t.Fatalf("run_status=%q, want %q", got, RunStateSuccess)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 50, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	foundAssistant := false
	for _, msg := range msgs {
		if strings.TrimSpace(msg.Role) != "assistant" {
			continue
		}
		foundAssistant = true
		if got := strings.TrimSpace(msg.TextContent); got != "PART_1PART_2" {
			t.Fatalf("assistant text=%q, want PART_1PART_2", got)
		}
	}
	if !foundAssistant {
		t.Fatalf("missing assistant message")
	}

	runEvents, err := svc.ListRunEvents(ctx, &meta, runID, 2000)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	var continuation map[string]any
	for _, event := range runEvents.Events {
		if event.EventType != "floret.step.end" {
			continue
		}
		payload, ok := event.Payload.(map[string]any)
		if !ok {
			t.Fatalf("run event %q payload type=%T, want map[string]any", event.EventType, event.Payload)
		}
		if strings.TrimSpace(fmt.Sprint(payload["finish_reason"])) == "length" {
			continuation = payload
			break
		}
	}
	if continuation == nil {
		t.Fatalf("missing floret.step.end length event")
	}
	if got := strings.TrimSpace(fmt.Sprint(continuation["finish_reason"])); got != "length" {
		t.Fatalf("continuation finish_reason=%q, want length", got)
	}
}

func TestIntegration_ModelGateway_Anthropic_ContentFilterFails(t *testing.T) {
	t.Parallel()

	mock := &anthropicMock{
		responses: []anthropicMockResponse{
			{Text: "PARTIAL_STORY", StopReason: "refusal"},
		},
	}
	svc, meta := newAnthropicTestService(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	th, err := svc.CreateThread(ctx, &meta, "content filter", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_test_model_gateway_anthropic_content_filter_1"
	rr := httptest.NewRecorder()
	err = svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "anthropic/claude-3-5-sonnet-latest",
		Input:    RunInput{Text: "请你输出一个5000字的故事"},
		Options:  RunOptions{},
	}, rr)
	if err == nil {
		t.Fatalf("StartRun should fail for content-filtered response")
	}
	if !strings.Contains(err.Error(), `finish_reason="content_filter"`) {
		t.Fatalf("StartRun error=%q, want content_filter", err)
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if got := strings.TrimSpace(view.RunStatus); got != string(RunStateFailed) {
		t.Fatalf("run_status=%q, want %q", got, RunStateFailed)
	}
	if !strings.Contains(view.RunError, "content_filter") {
		t.Fatalf("run_error=%q, want content_filter detail", view.RunError)
	}

	runEvents, err := svc.ListRunEvents(ctx, &meta, runID, 2000)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	projectedTurnResult := findRunEventPayload(t, runEvents.Events, "floret.projected_turn.result")
	if got := strings.TrimSpace(fmt.Sprint(projectedTurnResult["finish_reason"])); got != "content_filter" {
		t.Fatalf("finish_reason=%q, want content_filter", got)
	}
	rejected := findRunEventPayload(t, runEvents.Events, "reply.finish_rejected")
	if got := strings.TrimSpace(fmt.Sprint(rejected["finish_class"])); got != string(replyFinishClassBlocked) {
		t.Fatalf("finish_class=%q, want %q", got, replyFinishClassBlocked)
	}
}

func TestIntegration_ModelGateway_Anthropic_IdentityLengthContinuationCompletesWithNaturalStop(t *testing.T) {
	t.Parallel()

	mock := &anthropicMock{
		responses: []anthropicMockResponse{
			{Text: "FIRST_PART", StopReason: "max_tokens"},
			{Text: "SECOND_PART", StopReason: "end_turn"},
		},
	}
	svc, meta := newAnthropicTestService(t, mock)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	th, err := svc.CreateThread(ctx, &meta, "identity continuation", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_test_model_gateway_anthropic_identity_length_1"
	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "anthropic/claude-3-5-sonnet-latest",
		Input:    RunInput{Text: "你是谁"},
		Options:  RunOptions{},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if got := strings.TrimSpace(view.RunStatus); got != string(RunStateSuccess) {
		t.Fatalf("run_status=%q, want %q", got, RunStateSuccess)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 50, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	assistantCount := 0
	for _, msg := range msgs {
		if strings.TrimSpace(msg.Role) != "assistant" {
			continue
		}
		assistantCount++
		if got := strings.TrimSpace(msg.TextContent); got != "FIRST_PARTSECOND_PART" {
			t.Fatalf("assistant text=%q, want FIRST_PARTSECOND_PART", got)
		}
	}
	if assistantCount != 1 {
		t.Fatalf("assistant message count=%d, want 1", assistantCount)
	}

	runEvents, err := svc.ListRunEvents(ctx, &meta, runID, 2000)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	endPayload := findRunEventPayload(t, runEvents.Events, "run.end")
	if got := strings.TrimSpace(fmt.Sprint(endPayload["finalization_reason"])); got != "natural_stop" {
		t.Fatalf("finalization_reason=%q, want %q", got, "natural_stop")
	}
}
