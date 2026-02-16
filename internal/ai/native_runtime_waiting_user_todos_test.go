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

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

type openAIWaitingUserTodosCloseoutMock struct {
	mu sync.Mutex

	step int
}

func (m *openAIWaitingUserTodosCloseoutMock) handle(w http.ResponseWriter, r *http.Request) {
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
				"id":     "resp_waiting_user_todos_intent",
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
		// A failing tool call to create a blocker fact.
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.created",
			"response": map[string]any{
				"id":         "resp_waiting_user_todos_step_1",
				"created_at": time.Now().Unix(),
				"model":      model,
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_waiting_user_todos_step_1",
				"model":  model,
				"status": "completed",
				"output": []any{
					map[string]any{
						"type":      "function_call",
						"id":        "fc_waiting_user_todos_1",
						"call_id":   "call_waiting_user_todos_1",
						"name":      "terminal_exec",
						"arguments": `{"command":"false"}`,
					},
				},
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
				},
			},
		})
	default:
		// ask_user tool call; runtime must close open todos before entering waiting_user.
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.created",
			"response": map[string]any{
				"id":         "resp_waiting_user_todos_step_2",
				"created_at": time.Now().Unix(),
				"model":      model,
			},
		})
		writeOpenAISSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"id":     "resp_waiting_user_todos_step_2",
				"model":  model,
				"status": "completed",
				"output": []any{
					map[string]any{
						"type":      "function_call",
						"id":        "fc_waiting_user_todos_2",
						"call_id":   "call_waiting_user_todos_2",
						"name":      "ask_user",
						"arguments": `{"question":"Which option should I pick, A or B?","reason_code":"user_decision_required","required_from_user":["Choose option A or B."],"evidence_refs":[]}`,
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

func TestIntegration_NativeSDK_OpenAI_AskUser_ClosesOpenTodosBeforeWaitingUser(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	fsRoot := t.TempDir()

	mock := &openAIWaitingUserTodosCloseoutMock{}
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

	// Use a failing command to create a blocker fact while keeping RWX enabled.
	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         "ch_test_waiting_user_closeout_todos",
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

	th, err := svc.CreateThread(ctx, &meta, "todo closeout thread", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	seedTodosJSON, err := encodeTodoItemsJSON([]TodoItem{
		{ID: "todo_1", Content: "Inspect workspace", Status: TodoStatusPending},
	})
	if err != nil {
		t.Fatalf("encodeTodoItemsJSON: %v", err)
	}
	if _, err := svc.threadsDB.ReplaceThreadTodosSnapshot(ctx, threadstore.ThreadTodosSnapshot{
		EndpointID:      meta.EndpointID,
		ThreadID:        th.ThreadID,
		TodosJSON:       seedTodosJSON,
		UpdatedAtUnixMs: time.Now().UnixMilli(),
		UpdatedByRunID:  "seed",
		UpdatedByToolID: "seed",
	}, nil); err != nil {
		t.Fatalf("ReplaceThreadTodosSnapshot seed: %v", err)
	}

	runID := "run_test_native_openai_waiting_user_closeout_todos_1"
	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, runID, RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "Inspect todo closeout before ask_user"},
		Options:  RunOptions{MaxSteps: 4, MaxNoToolRounds: 1},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	snapshot, err := svc.threadsDB.GetThreadTodosSnapshot(ctx, meta.EndpointID, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThreadTodosSnapshot: %v", err)
	}
	items, err := decodeTodoItemsJSON(snapshot.TodosJSON)
	if err != nil {
		t.Fatalf("decodeTodoItemsJSON: %v", err)
	}
	summary := summarizeTodos(items)
	if summary.Pending+summary.InProgress != 0 {
		body := rr.Body.String()
		events, _ := svc.threadsDB.ListRunEvents(ctx, meta.EndpointID, runID, 2000)
		eventTypes := make([]string, 0, len(events))
		for _, ev := range events {
			eventTypes = append(eventTypes, strings.TrimSpace(ev.EventType))
		}
		t.Fatalf("open todos=%d, want 0 (snapshot=%q) (stream=%q) (events=%v)", summary.Pending+summary.InProgress, snapshot.TodosJSON, body, eventTypes)
	}
	if len(items) != 1 || strings.TrimSpace(items[0].Status) != TodoStatusCancelled {
		t.Fatalf("unexpected todos after closeout: %+v", items)
	}
	if !strings.Contains(strings.ToLower(items[0].Note), strings.ToLower(waitingUserCloseoutNotePrefix)) {
		t.Fatalf("todo note missing closeout prefix: %q", items[0].Note)
	}

	events, err := svc.threadsDB.ListRunEvents(ctx, meta.EndpointID, runID, 2000)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	found := false
	for _, ev := range events {
		if strings.TrimSpace(ev.EventType) == "todos.closeout.waiting_user" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("missing todos.closeout.waiting_user run event")
	}
}
