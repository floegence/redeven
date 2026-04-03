package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type openAIExitPlanModeMock struct{}

func (m *openAIExitPlanModeMock) handle(w http.ResponseWriter, r *http.Request) {
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
				"id":     "resp_exit_plan_mode_intent",
				"model":  "gpt-5-mini",
				"status": "completed",
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
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

	writeOpenAISSEJSON(w, f, map[string]any{
		"type": "response.completed",
		"response": map[string]any{
			"id":     "resp_exit_plan_mode_step_1",
			"model":  "gpt-5-mini",
			"status": "completed",
			"output": []any{
				map[string]any{
					"type":      "function_call",
					"id":        "fc_exit_plan_mode_1",
					"call_id":   "call_exit_plan_mode_1",
					"name":      "exit_plan_mode",
					"arguments": `{"summary":"Need act mode to edit the requested file."}`,
				},
			},
		},
	})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	f.Flush()
}

func TestIntegration_NativeSDK_OpenAI_ExitPlanMode_PersistsToolCallRecord(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()

	mock := &openAIExitPlanModeMock{}
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
		ChannelID:         "ch_test_exit_plan_mode",
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

	th, err := svc.CreateThread(ctx, &meta, "exit plan mode", "", "", agentHomeDir)
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_test_native_openai_exit_plan_mode_1"
	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "Plan the edit and request act mode."},
		Options: RunOptions{
			Mode:            config.AIModePlan,
			MaxSteps:        3,
			MaxNoToolRounds: 1,
		},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	thread, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if got := strings.TrimSpace(thread.RunStatus); got != "waiting_user" {
		t.Fatalf("run_status=%q, want waiting_user", got)
	}

	toolCalls, err := svc.threadsDB.ListRecentThreadToolCalls(ctx, meta.EndpointID, th.ThreadID, 20)
	if err != nil {
		t.Fatalf("ListRecentThreadToolCalls: %v", err)
	}
	foundExitPlanMode := false
	for _, call := range toolCalls {
		if strings.TrimSpace(call.ToolName) == "exit_plan_mode" && strings.TrimSpace(call.Status) == string(ToolCallStatusSuccess) {
			foundExitPlanMode = true
			break
		}
	}
	if !foundExitPlanMode {
		t.Fatalf("expected exit_plan_mode tool call record, got %+v", toolCalls)
	}

	events, err := svc.ListRunEvents(ctx, &meta, runID, 2000)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	foundToolResult := false
	for _, ev := range events.Events {
		if strings.TrimSpace(ev.EventType) != "tool.result" {
			continue
		}
		payload, _ := ev.Payload.(map[string]any)
		if strings.TrimSpace(anyToString(payload["tool_name"])) == "exit_plan_mode" && strings.TrimSpace(anyToString(payload["status"])) == "success" {
			foundToolResult = true
			break
		}
	}
	if !foundToolResult {
		t.Fatalf("missing exit_plan_mode tool.result event")
	}
}
