package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func TestDegradedSummary_ThreeSections(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{Log: slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{}))})
	out := r.degradedSummary(newRuntimeState("objective"), "objective")

	if !strings.Contains(out, "Done\n") || !strings.Contains(out, "\n\nNot Done\n") || !strings.Contains(out, "\n\nNext Actions\n") {
		t.Fatalf("unexpected degraded summary sections: %q", out)
	}
	if strings.Contains(out, "\n\nObjective\n") {
		t.Fatalf("degraded summary must not include Objective section: %q", out)
	}
	if !strings.Contains(out, "Objective:") {
		t.Fatalf("degraded summary must carry objective inside Next Actions: %q", out)
	}
}

func TestFinalizeIfContextCanceled_DoesNotAppendNotice(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{Log: slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{}))})
	r.muAssistant.Lock()
	r.assistantBlocks = []any{&persistedMarkdownBlock{Type: "markdown", Content: "hello"}}
	r.muAssistant.Unlock()

	r.muCancel.Lock()
	r.cancelReason = "canceled"
	r.muCancel.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if !r.finalizeIfContextCanceled(ctx) {
		t.Fatalf("expected finalizeIfContextCanceled to finalize")
	}

	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	b, _ := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if b == nil {
		t.Fatalf("missing assistant markdown block")
	}
	if strings.TrimSpace(b.Content) != "hello" {
		t.Fatalf("assistant content changed after cancel: %q", b.Content)
	}
}

func TestBuiltInToolHandler_CanceledApproval_MapsToAborted(t *testing.T) {
	t.Parallel()

	agentHomeDir := t.TempDir()
	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir: agentHomeDir,
		Shell:        "bash",
		SessionMeta:  &session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true},
	})
	h := &builtInToolHandler{r: r, toolName: "terminal.exec"}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	res, err := h.Execute(ctx, ToolCall{
		ID:   "tool_1",
		Name: "terminal.exec",
		Args: map[string]any{"command": "printf 'hi' > a.txt"},
	})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if res.Status != toolResultStatusAborted {
		t.Fatalf("status=%q, want %q (summary=%q details=%q)", res.Status, toolResultStatusAborted, res.Summary, res.Details)
	}
	if res.Summary != "tool.aborted" {
		t.Fatalf("summary=%q, want %q", res.Summary, "tool.aborted")
	}
}

func TestBuiltInToolHandler_ApprovalTimeout_MapsToTimeout(t *testing.T) {
	t.Parallel()

	agentHomeDir := t.TempDir()
	r := newRun(runOptions{
		Log:                 slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir:        agentHomeDir,
		Shell:               "bash",
		AIConfig:            &config.AIConfig{ExecutionPolicy: &config.AIExecutionPolicy{RequireUserApproval: true}},
		SessionMeta:         &session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true},
		ToolApprovalTimeout: 25 * time.Millisecond,
	})
	h := &builtInToolHandler{r: r, toolName: "terminal.exec"}

	res, err := h.Execute(context.Background(), ToolCall{
		ID:   "tool_1",
		Name: "terminal.exec",
		Args: map[string]any{"command": "printf 'hi' > a.txt"},
	})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if res.Status != toolResultStatusTimeout {
		t.Fatalf("status=%q, want %q (summary=%q details=%q)", res.Status, toolResultStatusTimeout, res.Summary, res.Details)
	}
	if res.Summary != "tool.timeout" {
		t.Fatalf("summary=%q, want %q", res.Summary, "tool.timeout")
	}
}

type openAIDoomLoopGuardMock struct {
	mu sync.Mutex

	step       int
	fsPath     string
	finalToken string
}

func (m *openAIDoomLoopGuardMock) handle(w http.ResponseWriter, r *http.Request) {
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
	if isIntentClassifierRequest(req) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		f, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":  "response.output_text.delta",
			"delta": `{"intent":"task","execution_contract":"agentic_loop","reason":"continued_workspace_investigation","objective_mode":"replace","complexity":"standard","todo_policy":"recommended","minimum_todo_items":0,"confidence":0.89}`,
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_doom_intent",
				"model":  "gpt-5-mini",
				"status": "completed",
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
		return
	}

	m.mu.Lock()
	m.step++
	step := m.step
	path := m.fsPath
	finalToken := m.finalToken
	m.mu.Unlock()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	f, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	switch step {
	case 1:
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_doom_1",
				"model":  "gpt-5-mini",
				"status": "completed",
				"output": []any{
					map[string]any{
						"type":      "function_call",
						"id":        "fc_doom_1",
						"call_id":   "call_doom_1",
						"name":      "terminal_exec",
						"arguments": fmt.Sprintf(`{"command":"pwd","cwd":%q}`, path),
					},
				},
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
					"output_tokens_details": map[string]any{
						"reasoning_tokens": 0,
					},
				},
			},
		})
	case 2:
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_doom_2",
				"model":  "gpt-5-mini",
				"status": "completed",
				"output": []any{
					map[string]any{
						"type":      "function_call",
						"id":        "fc_doom_2",
						"call_id":   "call_doom_2",
						"name":      "terminal_exec",
						"arguments": fmt.Sprintf(`{"command":"pwd","cwd":%q}`, path),
					},
				},
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
					"output_tokens_details": map[string]any{
						"reasoning_tokens": 0,
					},
				},
			},
		})
	default:
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":  "response.output_text.delta",
			"delta": finalToken,
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_doom_3",
				"model":  "gpt-5-mini",
				"status": "completed",
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
					"output_tokens_details": map[string]any{
						"reasoning_tokens": 0,
					},
				},
			},
		})
	}
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	f.Flush()
}

func (m *openAIDoomLoopGuardMock) snapshotStep() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.step
}

func TestIntegration_NativeSDK_OpenAI_DoomLoopGuard_BlocksRepeat(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(agentHomeDir, "sample.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatalf("write sample file: %v", err)
	}

	finalToken := "OPENAI_DOOM_LOOP_OK"
	mock := &openAIDoomLoopGuardMock{finalToken: finalToken, fsPath: agentHomeDir}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	baseURL := strings.TrimSuffix(srv.URL, "/") + "/v1"
	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: baseURL,
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			},
		},
	}

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_test_doom_loop_guard",
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

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	th, err := svc.CreateThread(ctx, &meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_test_native_openai_doom_loop_guard_1"
	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "Trigger doom-loop guard by repeating tool calls"},
		Options:  RunOptions{MaxSteps: 6, MaxNoToolRounds: 1},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	body := rr.Body.String()
	if !strings.Contains(body, finalToken) {
		t.Fatalf("NDJSON stream missing token %q, body=%q", finalToken, body)
	}

	toolCalls, err := svc.threadsDB.ListRecentThreadToolCalls(ctx, meta.EndpointID, th.ThreadID, 20)
	if err != nil {
		t.Fatalf("ListRecentThreadToolCalls: %v", err)
	}
	if len(toolCalls) != 1 {
		t.Fatalf("tool call records=%d, want 1; records=%+v", len(toolCalls), toolCalls)
	}
	if toolCalls[0].ToolName != "terminal.exec" {
		t.Fatalf("tool_name=%q, want %q", toolCalls[0].ToolName, "terminal.exec")
	}

	events, err := svc.threadsDB.ListRunEvents(ctx, meta.EndpointID, runID, 2000)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	sawGuard := false
	for _, ev := range events {
		if strings.TrimSpace(ev.EventType) == "guard.doom_loop" {
			sawGuard = true
			break
		}
	}
	if !sawGuard {
		t.Fatalf("expected guard.doom_loop event, got %d events", len(events))
	}
	if mock.snapshotStep() < 3 {
		t.Fatalf("expected at least 3 provider turns, got %d", mock.snapshotStep())
	}
}

type openAILengthFinishReasonMock struct {
	mu sync.Mutex

	step         int
	fsPath       string
	partialToken string
	finalToken   string
}

func (m *openAILengthFinishReasonMock) handle(w http.ResponseWriter, r *http.Request) {
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
	if isIntentClassifierRequest(req) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		f, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":  "response.output_text.delta",
			"delta": classifyIntentResponseToken(req),
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_len_intent",
				"model":  "gpt-5-mini",
				"status": "completed",
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
		return
	}

	m.mu.Lock()
	m.step++
	step := m.step
	path := m.fsPath
	partial := m.partialToken
	finalToken := m.finalToken
	m.mu.Unlock()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	f, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	switch step {
	case 1:
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_len_1",
				"model":  "gpt-5-mini",
				"status": "completed",
				"output": []any{
					map[string]any{
						"type":      "function_call",
						"id":        "fc_len_1",
						"call_id":   "call_len_1",
						"name":      "terminal_exec",
						"arguments": fmt.Sprintf(`{"command":"pwd","cwd":%q}`, path),
					},
				},
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
					"output_tokens_details": map[string]any{
						"reasoning_tokens": 0,
					},
				},
			},
		})
	case 2:
		writeOpenAISSEJSON(w, f, map[string]any{"type": "response.output_text.delta", "delta": partial})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_len_2",
				"model":  "gpt-5-mini",
				"status": "incomplete",
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
					"output_tokens_details": map[string]any{
						"reasoning_tokens": 0,
					},
				},
			},
		})
	default:
		writeOpenAISSEJSON(w, f, map[string]any{"type": "response.output_text.delta", "delta": finalToken})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_len_3",
				"model":  "gpt-5-mini",
				"status": "completed",
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
					"output_tokens_details": map[string]any{
						"reasoning_tokens": 0,
					},
				},
			},
		})
	}

	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	f.Flush()
}

func (m *openAILengthFinishReasonMock) snapshotStep() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.step
}

func TestIntegration_NativeSDK_OpenAI_LengthFinishReason_ForcesRecovery(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(agentHomeDir, "sample.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatalf("write sample file: %v", err)
	}

	mock := &openAILengthFinishReasonMock{
		fsPath:       agentHomeDir,
		partialToken: "OPENAI_LEN_PARTIAL",
		finalToken:   "OPENAI_LEN_FINAL_OK",
	}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	baseURL := strings.TrimSuffix(srv.URL, "/") + "/v1"
	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: baseURL,
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			},
		},
	}

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_test_length_finish_reason",
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

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	th, err := svc.CreateThread(ctx, &meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_test_native_openai_length_finish_reason_1"
	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "Force length finish reason then recovery"},
		Options:  RunOptions{MaxSteps: 6, MaxNoToolRounds: 1},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	body := rr.Body.String()
	if !strings.Contains(body, mock.finalToken) {
		t.Fatalf("NDJSON stream missing final token %q, body=%q", mock.finalToken, body)
	}
	if mock.snapshotStep() < 3 {
		t.Fatalf("expected at least 3 provider turns, got %d", mock.snapshotStep())
	}
}

type openAINoToolTextOnlyMock struct {
	mu sync.Mutex

	step       int
	replyToken string
}

func (m *openAINoToolTextOnlyMock) handle(w http.ResponseWriter, r *http.Request) {
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
	if isIntentClassifierRequest(req) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		f, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":  "response.output_text.delta",
			"delta": classifyIntentResponseToken(req),
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_no_tool_intent",
				"model":  "gpt-5-mini",
				"status": "completed",
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
		return
	}

	m.mu.Lock()
	m.step++
	step := m.step
	token := m.replyToken
	m.mu.Unlock()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	f, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	reply := token
	if step > 1 {
		reply = token + "_FOLLOWUP"
	}
	writeOpenAISSEJSON(w, f, map[string]any{
		"type":  "response.output_text.delta",
		"delta": reply,
	})
	writeOpenAISSEJSON(w, f, map[string]any{
		"type": "response.completed",
		"response": map[string]any{
			"id":            fmt.Sprintf("resp_no_tool_%d", step),
			"model":         "gpt-5-mini",
			"status":        "completed",
			"finish_reason": "stop",
			"output": []any{
				map[string]any{
					"type": "output_text",
					"text": reply,
				},
			},
			"usage": map[string]any{
				"input_tokens":  1,
				"output_tokens": 1,
			},
		},
	})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	f.Flush()
}

type openAITextThenAskUserMock struct {
	mu sync.Mutex

	step            int
	provisionalText string
	questionText    string
}

func (m *openAITextThenAskUserMock) handle(w http.ResponseWriter, r *http.Request) {
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
	if isIntentClassifierRequest(req) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		f, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":  "response.output_text.delta",
			"delta": classifyIntentResponseToken(req),
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_text_then_ask_intent",
				"model":  "gpt-5-mini",
				"status": "completed",
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
		return
	}

	m.mu.Lock()
	m.step++
	step := m.step
	provisionalText := m.provisionalText
	questionText := m.questionText
	m.mu.Unlock()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	f, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	writeOpenAISSEJSON(w, f, map[string]any{
		"type": "response.created",
		"response": map[string]any{
			"id":         fmt.Sprintf("resp_text_then_ask_%d", step),
			"created_at": time.Now().Unix(),
			"model":      "gpt-5-mini",
		},
	})

	if step == 1 {
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":  "response.output_text.delta",
			"delta": provisionalText,
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":            "resp_text_then_ask_1",
				"model":         "gpt-5-mini",
				"status":        "completed",
				"finish_reason": "stop",
				"output": []any{
					map[string]any{
						"type": "output_text",
						"text": provisionalText,
					},
				},
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
				},
			},
		})
	} else {
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_text_then_ask_2",
				"model":  "gpt-5-mini",
				"status": "completed",
				"output": []any{
					map[string]any{
						"type":    "function_call",
						"id":      "fc_text_then_ask_2",
						"call_id": "call_text_then_ask_2",
						"name":    "ask_user",
						"arguments": fmt.Sprintf(
							`{"questions":[{"id":"question_1","header":"Need input","question":%q,"is_secret":false,"response_mode":"select","choices_exhaustive":true,"choices":[{"choice_id":"choice_1","label":"Option 1","kind":"select"},{"choice_id":"choice_2","label":"Option 2","kind":"select"}]}],"reason_code":"user_decision_required","required_from_user":["Choose one option."],"evidence_refs":["model asked for the next user choice"]}`,
							questionText,
						),
					},
				},
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
				},
			},
		})
	}

	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	f.Flush()
}

func TestIntegration_NativeSDK_OpenAI_MissingExplicitCompletionDoesNotPolluteAssistantText(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()

	mock := &openAINoToolTextOnlyMock{
		replyToken: "PRELIM_ANALYSIS_ONLY",
	}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	baseURL := strings.TrimSuffix(srv.URL, "/") + "/v1"
	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: baseURL,
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			},
		},
	}

	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_test_missing_explicit_completion",
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

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	th, err := svc.CreateThread(ctx, &meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := svc.contextRepo.SetOpenGoal(ctx, meta.EndpointID, th.ThreadID, "continue repository analysis"); err != nil {
		t.Fatalf("SetOpenGoal: %v", err)
	}

	runID := "run_test_native_openai_missing_explicit_completion_1"
	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "continue"},
		Options:  RunOptions{MaxSteps: 4, MaxNoToolRounds: 1},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	body := rr.Body.String()
	if !strings.Contains(body, mock.replyToken) {
		t.Fatalf("stream output missing reply token %q, body=%q", mock.replyToken, body)
	}
	fallbackText := "I still do not have explicit completion."
	if !strings.Contains(body, `"toolName":"ask_user"`) {
		t.Fatalf("stream output missing ask_user tool block, body=%q", body)
	}
	if !strings.Contains(body, fallbackText) {
		t.Fatalf("stream output missing fallback question text %q, body=%q", fallbackText, body)
	}
	if strings.Contains(body, `"delta":"I still do not have explicit completion`) {
		t.Fatalf("fallback question should be emitted by ask_user tool block only, body=%q", body)
	}

	events, err := svc.ListRunEvents(ctx, &meta, runID, 2000)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	foundAskUserWaiting := false
	for _, ev := range events.Events {
		if strings.TrimSpace(ev.EventType) != "ask_user.waiting" {
			continue
		}
		payload, ok := ev.Payload.(map[string]any)
		if !ok {
			t.Fatalf("ask_user.waiting payload type=%T, want map[string]any", ev.Payload)
		}
		if source := strings.TrimSpace(fmt.Sprint(payload["source"])); source != "missing_explicit_completion" {
			t.Fatalf("ask_user.waiting source=%q, want %q", source, "missing_explicit_completion")
		}
		appended, _ := payload["appended_to_message"].(bool)
		if appended {
			t.Fatalf("ask_user.waiting appended_to_message should be false; waiting_user question is rendered from ask_user tool block")
		}
		foundAskUserWaiting = true
		break
	}
	if !foundAskUserWaiting {
		t.Fatalf("missing ask_user.waiting event")
	}
}

func TestIntegration_NativeSDK_OpenAI_TextThenAskUser_ReconcilesFinalWaitingTranscript(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()

	mock := &openAITextThenAskUserMock{
		provisionalText: "PROVISIONAL_MARKDOWN_QUESTION",
		questionText:    "Choose the real structured path.",
	}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	baseURL := strings.TrimSuffix(srv.URL, "/") + "/v1"
	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: baseURL,
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			},
		},
	}

	meta := session.Meta{
		EndpointID:        "env_test_text_then_ask",
		NamespacePublicID: "ns_test_text_then_ask",
		ChannelID:         "ch_test_text_then_ask",
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

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	th, err := svc.CreateThread(ctx, &meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := svc.contextRepo.SetOpenGoal(ctx, meta.EndpointID, th.ThreadID, "continue guided interaction"); err != nil {
		t.Fatalf("SetOpenGoal: %v", err)
	}

	runID := "run_test_native_openai_text_then_ask_user_1"
	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "continue"},
		Options:  RunOptions{MaxSteps: 4, MaxNoToolRounds: 2},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	body := rr.Body.String()
	if !strings.Contains(body, mock.provisionalText) {
		t.Fatalf("stream output missing provisional text %q, body=%q", mock.provisionalText, body)
	}
	if !strings.Contains(body, `"toolName":"ask_user"`) {
		t.Fatalf("stream output missing ask_user tool block, body=%q", body)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	var assistantMsg *threadstore.Message
	for i := range msgs {
		if strings.TrimSpace(msgs[i].Role) != "assistant" {
			continue
		}
		assistantMsg = &msgs[i]
	}
	if assistantMsg == nil {
		t.Fatalf("assistant message missing")
	}
	if got := strings.TrimSpace(assistantMsg.TextContent); got != mock.questionText {
		t.Fatalf("assistant text_content=%q, want %q", got, mock.questionText)
	}
	if strings.Contains(assistantMsg.MessageJSON, mock.provisionalText) {
		t.Fatalf("assistant message_json still contains provisional text: %s", assistantMsg.MessageJSON)
	}

	var persisted struct {
		Blocks []json.RawMessage `json:"blocks"`
	}
	if err := json.Unmarshal([]byte(assistantMsg.MessageJSON), &persisted); err != nil {
		t.Fatalf("json.Unmarshal assistant message: %v", err)
	}
	if len(persisted.Blocks) == 0 {
		t.Fatalf("assistant blocks missing")
	}

	foundAskUser := false
	for _, raw := range persisted.Blocks {
		var metaBlock struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &metaBlock); err != nil {
			t.Fatalf("json.Unmarshal block meta: %v", err)
		}
		switch strings.TrimSpace(metaBlock.Type) {
		case "markdown":
			var markdown struct {
				Content string `json:"content"`
			}
			if err := json.Unmarshal(raw, &markdown); err != nil {
				t.Fatalf("json.Unmarshal markdown block: %v", err)
			}
			if strings.TrimSpace(markdown.Content) != "" {
				t.Fatalf("markdown block should be cleared, got %q", markdown.Content)
			}
		case "tool-call":
			var tool struct {
				ToolName string `json:"toolName"`
			}
			if err := json.Unmarshal(raw, &tool); err != nil {
				t.Fatalf("json.Unmarshal tool block: %v", err)
			}
			if strings.TrimSpace(tool.ToolName) == "ask_user" {
				foundAskUser = true
			}
		}
	}
	if !foundAskUser {
		t.Fatalf("assistant message missing ask_user tool block")
	}
}
