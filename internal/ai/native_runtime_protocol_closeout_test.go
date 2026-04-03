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

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type openAIRuntimeCloseoutMock struct {
	mu sync.Mutex

	step      int
	finalText string
	writePath string
	writeBody string
}

func (m *openAIRuntimeCloseoutMock) handle(w http.ResponseWriter, r *http.Request) {
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
				"id":     "resp_runtime_closeout_intent",
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
	finalText := m.finalText
	writePath := m.writePath
	writeBody := m.writeBody
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
				"id":     "resp_runtime_closeout_step_1",
				"model":  "gpt-5-mini",
				"status": "completed",
				"output": []any{
					map[string]any{
						"type":      "function_call",
						"id":        "fc_runtime_closeout_1",
						"call_id":   "call_runtime_closeout_1",
						"name":      "file_write",
						"arguments": fmt.Sprintf(`{"file_path":%q,"content":%q}`, writePath, writeBody),
					},
				},
			},
		})
	default:
		writeOpenAISSEJSON(w, f, map[string]any{
			"type":  "response.output_text.delta",
			"delta": finalText,
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":            "resp_runtime_closeout_step_2",
				"model":         "gpt-5-mini",
				"status":        "completed",
				"finish_reason": "stop",
				"output": []any{
					map[string]any{
						"type": "output_text",
						"text": finalText,
					},
				},
			},
		})
	}

	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	f.Flush()
}

func TestIntegration_NativeSDK_OpenAI_RuntimeCloseoutWithoutTaskComplete(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()
	workspace := filepath.Join(agentHomeDir, "workspace")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}
	target := filepath.Join(workspace, "PROTOCOL_CLOSEOUT_NOTE.md")
	finalText := fmt.Sprintf("Runtime closeout succeeded. Evidence: %s", target)
	mock := &openAIRuntimeCloseoutMock{
		finalText: finalText,
		writePath: "PROTOCOL_CLOSEOUT_NOTE.md",
		writeBody: "created by runtime closeout integration test\n",
	}
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
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_test_runtime_closeout",
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

	th, err := svc.CreateThread(ctx, &meta, "runtime closeout", "", "", workspace)
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_test_native_openai_runtime_closeout_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "create a note and summarize it"},
		Options:  RunOptions{MaxSteps: 4, MaxNoToolRounds: 1},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	if !strings.Contains(rr.Body.String(), finalText) {
		t.Fatalf("stream output missing final runtime-closeout text: %q", rr.Body.String())
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("expected written file at %s: %v", target, err)
	}

	thread, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if strings.TrimSpace(strings.ToLower(thread.RunStatus)) != "success" {
		t.Fatalf("run status=%q, want success", thread.RunStatus)
	}

	toolCalls, err := svc.threadsDB.ListRecentThreadToolCalls(ctx, meta.EndpointID, th.ThreadID, 20)
	if err != nil {
		t.Fatalf("ListRecentThreadToolCalls: %v", err)
	}
	sawFileWrite := false
	for _, call := range toolCalls {
		if strings.TrimSpace(call.ToolName) == "task_complete" {
			t.Fatalf("runtime closeout run should not persist task_complete: %+v", call)
		}
		if strings.TrimSpace(call.ToolName) == "file.write" && strings.TrimSpace(call.Status) == "success" {
			sawFileWrite = true
		}
	}
	if !sawFileWrite {
		t.Fatalf("expected successful file.write tool call, got %+v", toolCalls)
	}

	events, err := svc.ListRunEvents(ctx, &meta, "run_test_native_openai_runtime_closeout_1", 2000)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	foundProtocolCloseout := false
	for _, ev := range events.Events {
		if strings.TrimSpace(ev.EventType) != "protocol.closeout.attempt" {
			continue
		}
		payload, _ := ev.Payload.(map[string]any)
		if payload == nil {
			continue
		}
		if passed, _ := payload["gate_passed"].(bool); passed {
			foundProtocolCloseout = true
			break
		}
	}
	if !foundProtocolCloseout {
		t.Fatalf("missing successful protocol.closeout.attempt event")
	}
}
