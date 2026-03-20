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

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

type openAIToolLoopMock struct {
	mu sync.Mutex

	step                  int
	finalToken            string
	fsPath                string
	sawResponses          bool
	sawToolDefinitions    bool
	sawFunctionCallInput  bool
	sawFunctionCallOutput bool
}

func (m *openAIToolLoopMock) handle(w http.ResponseWriter, r *http.Request) {
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
		model := strings.TrimSpace(fmt.Sprint(req["model"]))
		if model == "" {
			model = "gpt-5-mini"
		}
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.created",
			"response": map[string]any{
				"id":         "resp_intent_tool_loop",
				"created_at": time.Now().Unix(),
				"model":      model,
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":  "response.output_text.delta",
			"delta": classifyIntentResponseToken(req),
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_intent_tool_loop",
				"model":  model,
				"status": "completed",
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
				},
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
		return
	}

	m.mu.Lock()
	m.sawResponses = true
	if rawTools, ok := req["tools"].([]any); ok && len(rawTools) > 0 {
		m.sawToolDefinitions = true
	}
	if hasFunctionCallItem(req["input"]) {
		m.sawFunctionCallInput = true
	}
	if hasFunctionCallOutputItem(req["input"]) {
		m.sawFunctionCallOutput = true
	}
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

	model := strings.TrimSpace(fmt.Sprint(req["model"]))
	if model == "" {
		model = "gpt-5-mini"
	}

	switch step {
	case 1:
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.created",
			"response": map[string]any{
				"id":         "resp_test_step_1",
				"created_at": time.Now().Unix(),
				"model":      model,
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_test_step_1",
				"model":  model,
				"status": "completed",
				"output": []any{
					map[string]any{
						"type":      "function_call",
						"id":        "fc_test_1",
						"call_id":   "call_test_1",
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
			"type": "response.created",
			"response": map[string]any{
				"id":         "resp_test_step_2",
				"created_at": time.Now().Unix(),
				"model":      model,
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":  "response.output_text.delta",
			"delta": finalToken,
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_test_step_2",
				"model":  model,
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

func hasFunctionCallOutputItem(input any) bool {
	list, ok := input.([]any)
	if !ok {
		return false
	}
	for _, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if strings.TrimSpace(fmt.Sprint(m["type"])) == "function_call_output" {
			return true
		}
	}
	return false
}

func hasFunctionCallItem(input any) bool {
	list, ok := input.([]any)
	if !ok {
		return false
	}
	for _, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if strings.TrimSpace(fmt.Sprint(m["type"])) == "function_call" {
			return true
		}
	}
	return false
}

func hasAssistantMessageContaining(input any, needle string) bool {
	needle = strings.TrimSpace(needle)
	if needle == "" {
		return false
	}
	list, ok := input.([]any)
	if !ok {
		return false
	}
	for _, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if strings.TrimSpace(fmt.Sprint(m["role"])) != "assistant" {
			continue
		}
		b, _ := json.Marshal(m)
		if strings.Contains(string(b), needle) {
			return true
		}
	}
	return false
}

func (m *openAIToolLoopMock) snapshot() (bool, bool, bool, bool, int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sawResponses, m.sawToolDefinitions, m.sawFunctionCallInput, m.sawFunctionCallOutput, m.step
}

func writeOpenAISSEJSON(w io.Writer, f http.Flusher, payload any) {
	b, _ := json.Marshal(payload)
	_, _ = io.WriteString(w, "data: ")
	_, _ = w.Write(b)
	_, _ = io.WriteString(w, "\n\n")
	f.Flush()
}

func TestIntegration_NativeSDK_OpenAI_ToolLoop_Succeeds(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(agentHomeDir, "sample.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatalf("write sample file: %v", err)
	}

	finalToken := "OPENAI_TOOL_LOOP_OK"
	mock := &openAIToolLoopMock{finalToken: finalToken, fsPath: agentHomeDir}
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
		ChannelID:         "ch_test_native_tool_loop",
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

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_test_native_openai_tool_loop_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "List workspace root and summarize"},
		Options:  RunOptions{MaxSteps: 4},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	body := rr.Body.String()
	if !strings.Contains(body, finalToken) {
		t.Fatalf("NDJSON stream missing token %q, body=%q", finalToken, body)
	}
	if !strings.Contains(body, `"type":"message-end"`) {
		t.Fatalf("NDJSON stream missing message-end, body=%q", body)
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
	if !strings.Contains(view.LastMessagePreview, finalToken) {
		t.Fatalf("last_message_preview=%q, want it to include %q", view.LastMessagePreview, finalToken)
	}

	sawResponses, sawToolDefs, sawCallInput, sawCallOutput, stepCount := mock.snapshot()
	if !sawResponses {
		t.Fatalf("expected OpenAI Responses API call (/responses)")
	}
	if !sawToolDefs {
		t.Fatalf("expected OpenAI request to include tool definitions")
	}
	if !sawCallInput {
		t.Fatalf("expected second turn input to include function_call")
	}
	if !sawCallOutput {
		t.Fatalf("expected second turn input to include function_call_output")
	}
	if stepCount < 2 {
		t.Fatalf("expected at least 2 provider turns, got %d", stepCount)
	}
}

type openAITextOnlyContinuationMock struct {
	mu sync.Mutex

	step                int
	textToken           string
	finalToken          string
	sawAssistantHistory bool
	secondInputJSON     string
}

func (m *openAITextOnlyContinuationMock) handle(w http.ResponseWriter, r *http.Request) {
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
		model := strings.TrimSpace(fmt.Sprint(req["model"]))
		if model == "" {
			model = "gpt-5-mini"
		}
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.created",
			"response": map[string]any{
				"id":         "resp_intent_text_only_commit",
				"created_at": time.Now().Unix(),
				"model":      model,
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":  "response.output_text.delta",
			"delta": classifyIntentResponseToken(req),
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_intent_text_only_commit",
				"model":  model,
				"status": "completed",
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
				},
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
		return
	}

	m.mu.Lock()
	m.step++
	step := m.step
	textToken := m.textToken
	finalToken := m.finalToken
	if step >= 2 {
		if b, err := json.Marshal(req["input"]); err == nil {
			m.secondInputJSON = string(b)
		}
		if hasAssistantMessageContaining(req["input"], textToken) {
			m.sawAssistantHistory = true
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

	model := strings.TrimSpace(fmt.Sprint(req["model"]))
	if model == "" {
		model = "gpt-5-mini"
	}

	writeOpenAISSEJSON(w, f, map[string]any{
		"type": "response.created",
		"response": map[string]any{
			"id":         fmt.Sprintf("resp_text_only_commit_%d", step),
			"created_at": time.Now().Unix(),
			"model":      model,
		},
	})
	if step == 1 {
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":  "response.output_text.delta",
			"delta": textToken,
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_text_only_commit_1",
				"model":  model,
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
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
		return
	}
	writeOpenAISSEJSON(w, f, map[string]any{
		"type": "response.completed",
		"response": map[string]any{
			"id":     "resp_text_only_commit_2",
			"model":  model,
			"status": "completed",
			"output": []any{
				map[string]any{
					"type":      "function_call",
					"id":        "fc_text_only_commit_done",
					"call_id":   "call_text_only_commit_done",
					"name":      "task_complete",
					"arguments": fmt.Sprintf(`{"result":%q}`, finalToken),
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
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	f.Flush()
}

func (m *openAITextOnlyContinuationMock) snapshot() (step int, sawAssistantHistory bool, secondInputJSON string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.step, m.sawAssistantHistory, m.secondInputJSON
}

func TestIntegration_NativeSDK_OpenAI_TextOnlyContinuationCommitsAssistantHistory(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()

	textToken := "TEXT_ONLY_CONTEXT_COMMIT"
	finalToken := "TEXT_ONLY_CONTEXT_COMMIT_DONE"
	mock := &openAITextOnlyContinuationMock{textToken: textToken, finalToken: finalToken}
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
		ChannelID:         "ch_test_text_only_history",
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

	runID := "run_test_native_openai_text_only_history_1"
	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "inspect current status"},
		Options:  RunOptions{MaxSteps: 4, MaxNoToolRounds: 1},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	body := rr.Body.String()
	if !strings.Contains(body, textToken) {
		t.Fatalf("stream output missing text token %q, body=%q", textToken, body)
	}
	if !strings.Contains(body, finalToken) {
		t.Fatalf("stream output missing final token %q, body=%q", finalToken, body)
	}

	stepCount, sawAssistantHistory, secondInputJSON := mock.snapshot()
	if stepCount != 2 {
		t.Fatalf("provider step count=%d, want 2", stepCount)
	}
	if !sawAssistantHistory {
		t.Fatalf("expected second provider turn to include prior assistant text in input history, input=%s", secondInputJSON)
	}

	events, err := svc.ListRunEvents(ctx, &meta, runID, 200)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	foundCommitEvent := false
	for _, ev := range events.Events {
		if strings.TrimSpace(ev.EventType) != "assistant.turn.history" {
			continue
		}
		payload, ok := ev.Payload.(map[string]any)
		if !ok {
			t.Fatalf("assistant.turn.history payload type=%T, want map[string]any", ev.Payload)
		}
		if strings.TrimSpace(fmt.Sprint(payload["source"])) != "text_only_continuation" {
			continue
		}
		if committed := strings.TrimSpace(fmt.Sprint(payload["committed"])); committed != "true" {
			t.Fatalf("assistant.turn.history committed=%q, want true", committed)
		}
		foundCommitEvent = true
		break
	}
	if !foundCommitEvent {
		t.Fatalf("missing assistant.turn.history event for text_only_continuation")
	}
}

type openAIMixedSignalSameTurnMock struct {
	mu sync.Mutex

	step          int
	sawSecondTurn bool
}

func (m *openAIMixedSignalSameTurnMock) handle(w http.ResponseWriter, r *http.Request) {
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
		model := strings.TrimSpace(fmt.Sprint(req["model"]))
		if model == "" {
			model = "gpt-5-mini"
		}
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.created",
			"response": map[string]any{
				"id":         "resp_intent_mixed_signal",
				"created_at": time.Now().Unix(),
				"model":      model,
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":  "response.output_text.delta",
			"delta": classifyIntentResponseToken(req),
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_intent_mixed_signal",
				"model":  model,
				"status": "completed",
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
				},
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
		return
	}

	m.mu.Lock()
	m.step++
	step := m.step
	if step > 1 {
		m.sawSecondTurn = true
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

	model := strings.TrimSpace(fmt.Sprint(req["model"]))
	if model == "" {
		model = "gpt-5-mini"
	}

	if step == 1 {
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.created",
			"response": map[string]any{
				"id":         "resp_mixed_signal_step_1",
				"created_at": time.Now().Unix(),
				"model":      model,
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_mixed_signal_step_1",
				"model":  model,
				"status": "completed",
				"output": []any{
					map[string]any{
						"type":      "function_call",
						"id":        "fc_mixed_signal_todos",
						"call_id":   "call_mixed_signal_todos",
						"name":      "write_todos",
						"arguments": `{"todos":[{"id":"todo_1","content":"summarize status","status":"completed"}]}`,
					},
					map[string]any{
						"type":      "function_call",
						"id":        "fc_mixed_signal_complete",
						"call_id":   "call_mixed_signal_complete",
						"name":      "task_complete",
						"arguments": `{"result":"MIXED_SIGNAL_COMPLETED"}`,
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
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
		return
	}

	writeOpenAISSEJSON(w, f, map[string]any{
		"type": "response.created",
		"response": map[string]any{
			"id":         "resp_mixed_signal_step_2",
			"created_at": time.Now().Unix(),
			"model":      model,
		},
	})
	writeOpenAISSEJSON(w, f, map[string]any{
		"type": "response.completed",
		"response": map[string]any{
			"id":     "resp_mixed_signal_step_2",
			"model":  model,
			"status": "completed",
			"output": []any{
				map[string]any{
					"type":      "function_call",
					"id":        "fc_mixed_signal_step_2_complete",
					"call_id":   "call_mixed_signal_step_2_complete",
					"name":      "task_complete",
					"arguments": `{"result":"SECOND_TURN_FALLBACK"}`,
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
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	f.Flush()
}

func (m *openAIMixedSignalSameTurnMock) snapshot() (step int, sawSecondTurn bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.step, m.sawSecondTurn
}

func TestIntegration_NativeSDK_OpenAI_MixedSignalsCompleteInSameTurn(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()

	mock := &openAIMixedSignalSameTurnMock{}
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
		ChannelID:         "ch_test_native_mixed_signal_same_turn",
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

	th, err := svc.CreateThread(ctx, &meta, "mixed signal", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_test_native_openai_mixed_signal_same_turn_1"
	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "Summarize quickly and complete"},
		Options:  RunOptions{MaxSteps: 4},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	body := rr.Body.String()
	if !strings.Contains(body, "MIXED_SIGNAL_COMPLETED") {
		t.Fatalf("expected mixed-turn completion result in stream, body=%q", body)
	}
	if strings.Contains(body, "SECOND_TURN_FALLBACK") {
		t.Fatalf("unexpected fallback completion from second turn, body=%q", body)
	}

	events, err := svc.threadsDB.ListRunEvents(ctx, meta.EndpointID, runID, 2000)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	sawWriteTodos := false
	sawCompletion := false
	for _, ev := range events {
		if strings.TrimSpace(ev.EventType) == "tool.call" && strings.Contains(ev.PayloadJSON, "\"tool_name\":\"write_todos\"") {
			sawWriteTodos = true
		}
		if strings.TrimSpace(ev.EventType) == "completion.attempt" && strings.Contains(ev.PayloadJSON, "\"gate_passed\":true") {
			sawCompletion = true
		}
	}
	if !sawWriteTodos {
		t.Fatalf("expected write_todos tool.call event in mixed-signal turn")
	}
	if !sawCompletion {
		t.Fatalf("expected successful completion.attempt event in mixed-signal turn")
	}

	stepCount, sawSecondTurn := mock.snapshot()
	if sawSecondTurn || stepCount != 1 {
		t.Fatalf("expected single provider task turn, got step_count=%d saw_second_turn=%v", stepCount, sawSecondTurn)
	}
}
