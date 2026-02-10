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

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

type openAIMock struct {
	token string

	mu           sync.Mutex
	sawResponses bool
	sawChat      bool

	requestToolNames    []string
	requestInvalidTools []string
}

func isValidOpenAIToolName(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '_' || r == '-':
		default:
			return false
		}
	}
	return true
}

func extractOpenAIToolNames(req map[string]any) []string {
	if req == nil {
		return nil
	}

	// Chat Completions: tools: [{ type: "function", function: { name } }]
	if raw, ok := req["tools"]; ok {
		list, ok := raw.([]any)
		if !ok {
			return nil
		}
		out := make([]string, 0, len(list))
		for _, it := range list {
			m, ok := it.(map[string]any)
			if !ok || m == nil {
				continue
			}
			if n, ok := m["name"].(string); ok && strings.TrimSpace(n) != "" {
				out = append(out, strings.TrimSpace(n))
				continue
			}
			fn, ok := m["function"].(map[string]any)
			if !ok || fn == nil {
				continue
			}
			n, _ := fn["name"].(string)
			n = strings.TrimSpace(n)
			if n != "" {
				out = append(out, n)
			}
		}
		return out
	}

	// Legacy: functions: [{ name }]
	if raw, ok := req["functions"]; ok {
		list, ok := raw.([]any)
		if !ok {
			return nil
		}
		out := make([]string, 0, len(list))
		for _, it := range list {
			m, ok := it.(map[string]any)
			if !ok || m == nil {
				continue
			}
			n, _ := m["name"].(string)
			n = strings.TrimSpace(n)
			if n != "" {
				out = append(out, n)
			}
		}
		return out
	}

	return nil
}

func (m *openAIMock) handle(w http.ResponseWriter, r *http.Request) {
	if r == nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if auth != "Bearer sk-test" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	body, _ := io.ReadAll(r.Body)
	_ = r.Body.Close()
	var req map[string]any
	_ = json.Unmarshal(body, &req) // best-effort; used only for request sanity checks

	path := strings.TrimSpace(r.URL.Path)
	switch {
	case strings.HasSuffix(path, "/responses"):
		m.mu.Lock()
		m.sawResponses = true
		m.requestToolNames = extractOpenAIToolNames(req)
		m.requestInvalidTools = m.requestInvalidTools[:0]
		for _, n := range m.requestToolNames {
			if !isValidOpenAIToolName(n) {
				m.requestInvalidTools = append(m.requestInvalidTools, n)
			}
		}
		m.mu.Unlock()

		if strings.TrimSpace(fmt.Sprint(req["model"])) == "" {
			http.Error(w, "missing model", http.StatusBadRequest)
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

		itemID := "msg_test_1"
		created := map[string]any{
			"type": "response.created",
			"response": map[string]any{
				"id":         "resp_test_1",
				"created_at": time.Now().Unix(),
				"model":      strings.TrimSpace(fmt.Sprint(req["model"])),
			},
		}
		writeSSEJSON(w, f, created)
		writeSSEJSON(w, f, map[string]any{
			"type":         "response.output_item.added",
			"output_index": 0,
			"item": map[string]any{
				"type": "message",
				"id":   itemID,
			},
		})
		writeSSEJSON(w, f, map[string]any{
			"type":    "response.output_text.delta",
			"item_id": itemID,
			"delta":   m.token,
		})
		writeSSEJSON(w, f, map[string]any{
			"type":         "response.output_item.done",
			"output_index": 0,
			"item": map[string]any{
				"type": "message",
				"id":   itemID,
			},
		})
		writeSSEJSON(w, f, map[string]any{
			"type": "response.completed",
			"response": map[string]any{
				"usage": map[string]any{
					"input_tokens":  1,
					"output_tokens": 1,
				},
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
		return

	case strings.HasSuffix(path, "/chat/completions"):
		m.mu.Lock()
		m.sawChat = true
		m.requestToolNames = extractOpenAIToolNames(req)
		m.requestInvalidTools = m.requestInvalidTools[:0]
		for _, n := range m.requestToolNames {
			if !isValidOpenAIToolName(n) {
				m.requestInvalidTools = append(m.requestInvalidTools, n)
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
			model = "gpt-4o-mini"
		}

		writeSSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_test_1",
			"created": time.Now().Unix(),
			"model":   model,
			"choices": []any{
				map[string]any{
					"index": 0,
					"delta": map[string]any{"role": "assistant", "content": m.token},
				},
			},
		})
		writeSSEJSON(w, f, map[string]any{
			"id":      "chatcmpl_test_1",
			"created": time.Now().Unix(),
			"model":   model,
			"choices": []any{
				map[string]any{
					"index":         0,
					"delta":         map[string]any{},
					"finish_reason": "stop",
				},
			},
		})
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		f.Flush()
		return

	default:
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
}

func (m *openAIMock) didSeeChat() bool {
	m.mu.Lock()
	v := m.sawChat
	m.mu.Unlock()
	return v
}

func (m *openAIMock) didSeeResponses() bool {
	m.mu.Lock()
	v := m.sawResponses
	m.mu.Unlock()
	return v
}

func (m *openAIMock) invalidToolNames() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, 0, len(m.requestInvalidTools))
	out = append(out, m.requestInvalidTools...)
	return out
}

func (m *openAIMock) toolNamesSnapshot() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, 0, len(m.requestToolNames))
	out = append(out, m.requestToolNames...)
	return out
}

func writeSSEJSON(w io.Writer, f http.Flusher, v any) {
	b, _ := json.Marshal(v)
	_, _ = io.WriteString(w, "data: ")
	_, _ = w.Write(b)
	_, _ = io.WriteString(w, "\n\n")
	f.Flush()
}

func TestIntegration_AISDK_OpenAI_ResponsesStream_GPT5_Succeeds(t *testing.T) {
	t.Parallel()

	token := "MOCK_OK_RESPONSES"
	mock := &openAIMock{token: token}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	fsRoot := t.TempDir()

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

	channelID := "ch_test_ai_sdk_1"
	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         channelID,
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
	if err := svc.StartRun(ctx, &meta, "run_test_ai_sdk_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "Say hello"},
		Options:  RunOptions{MaxSteps: 1},
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
	if !strings.Contains(view.LastMessagePreview, token) {
		t.Fatalf("last_message_preview=%q, want token %q", view.LastMessagePreview, token)
	}

	if !mock.didSeeResponses() {
		t.Fatalf("expected OpenAI Responses API call (/responses)")
	}
	if mock.didSeeChat() {
		t.Fatalf("unexpected OpenAI Chat Completions API call (/chat/completions)")
	}
	if names := mock.toolNamesSnapshot(); len(names) == 0 {
		t.Fatalf("expected OpenAI request to include tool definitions")
	}
	if bad := mock.invalidToolNames(); len(bad) > 0 {
		t.Fatalf("invalid OpenAI tool names: %+v", bad)
	}
}

func TestIntegration_AISDK_OpenAI_ResponsesStream_GPT4o_Succeeds(t *testing.T) {
	t.Parallel()

	token := "MOCK_OK_CHAT"
	mock := &openAIMock{token: token}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	fsRoot := t.TempDir()

	baseURL := strings.TrimSuffix(srv.URL, "/") + "/v1"
	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: baseURL,
				Models:  []config.AIProviderModel{{ModelName: "gpt-4o-mini", IsDefault: true}},
			},
		},
	}

	channelID := "ch_test_ai_sdk_2"
	meta := session.Meta{
		EndpointID:        "env_test",
		NamespacePublicID: "ns_test",
		ChannelID:         channelID,
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
	if err := svc.StartRun(ctx, &meta, "run_test_ai_sdk_2", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-4o-mini",
		Input:    RunInput{Text: "Say hello"},
		Options:  RunOptions{MaxSteps: 1},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	if !strings.Contains(rr.Body.String(), token) {
		t.Fatalf("NDJSON stream missing token %q, body=%q", token, rr.Body.String())
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing after run")
	}
	if !strings.Contains(view.LastMessagePreview, token) {
		t.Fatalf("last_message_preview=%q, want token %q", view.LastMessagePreview, token)
	}

	if !mock.didSeeResponses() {
		t.Fatalf("expected OpenAI Responses API call (/responses)")
	}
	if mock.didSeeChat() {
		t.Fatalf("unexpected OpenAI Chat Completions API call (/chat/completions)")
	}
	if names := mock.toolNamesSnapshot(); len(names) == 0 {
		t.Fatalf("expected OpenAI request to include tool definitions")
	}
	if bad := mock.invalidToolNames(); len(bad) > 0 {
		t.Fatalf("invalid OpenAI tool names: %+v", bad)
	}
}
