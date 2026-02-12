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
	fsRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(fsRoot, "sample.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatalf("write sample file: %v", err)
	}

	finalToken := "OPENAI_TOOL_LOOP_OK"
	mock := &openAIToolLoopMock{finalToken: finalToken, fsPath: fsRoot}
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
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini", IsDefault: true}},
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
		FSRoot:              fsRoot,
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

	th, err := svc.CreateThread(ctx, &meta, "hello", "")
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
	if !strings.Contains(view.LastMessagePreview, finalToken) {
		t.Fatalf("last_message_preview=%q, want token %q", view.LastMessagePreview, finalToken)
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
