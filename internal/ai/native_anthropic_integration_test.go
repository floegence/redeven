package ai

import (
	"context"
	"encoding/json"
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

type anthropicMock struct {
	token string

	mu               sync.Mutex
	sawMessages      bool
	requestToolNames []string
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
	writeAnthropicSSEJSON(w, f, map[string]any{
		"type":  "content_block_delta",
		"index": 0,
		"delta": map[string]any{"type": "text_delta", "text": m.token},
	})
	writeAnthropicSSEJSON(w, f, map[string]any{
		"type":  "content_block_stop",
		"index": 0,
	})
	writeAnthropicSSEJSON(w, f, map[string]any{
		"type":  "message_delta",
		"delta": map[string]any{"stop_reason": "end_turn", "stop_sequence": nil},
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

func (m *anthropicMock) toolNamesSnapshot() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, 0, len(m.requestToolNames))
	out = append(out, m.requestToolNames...)
	return out
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

func TestIntegration_NativeSDK_Anthropic_Stream_Succeeds(t *testing.T) {
	t.Parallel()

	token := "MOCK_ANTHROPIC_OK"
	mock := &anthropicMock{token: token}
	srv := httptest.NewServer(http.HandlerFunc(mock.handle))
	t.Cleanup(srv.Close)

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	fsRoot := t.TempDir()

	baseURL := strings.TrimSuffix(srv.URL, "/") + "/v1"
	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "anthropic",
				Name:    "Anthropic",
				Type:    "anthropic",
				BaseURL: baseURL,
				Models:  []config.AIProviderModel{{ModelName: "claude-3-5-sonnet-latest", IsDefault: true}},
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
		FSRoot:              fsRoot,
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

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	th, err := svc.CreateThread(ctx, &meta, "hello", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_test_native_anthropic_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "anthropic/claude-3-5-sonnet-latest",
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
	if strings.TrimSpace(view.LastMessagePreview) == "" {
		t.Fatalf("last_message_preview should not be empty")
	}
	if !strings.Contains(view.LastMessagePreview, token) {
		t.Fatalf("last_message_preview=%q, want it to include %q", view.LastMessagePreview, token)
	}
	if !mock.didSeeMessages() {
		t.Fatalf("expected Anthropic Messages API call (/messages)")
	}
	if names := mock.toolNamesSnapshot(); len(names) == 0 {
		t.Fatalf("expected Anthropic request to include tool definitions")
	}
}
