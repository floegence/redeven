package gateway

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/floegence/redeven-agent/internal/ai"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func TestGateway_AI_Run_UsesNativeSDKAndPersistsAssistantMessage(t *testing.T) {
	t.Parallel()

	token := "MOCK_OK_GATEWAY"

	// Minimal OpenAI Responses streaming mock (SSE).
	openaiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		f, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		write := func(v any) {
			b, _ := json.Marshal(v)
			_, _ = io.WriteString(w, "data: ")
			_, _ = w.Write(b)
			_, _ = io.WriteString(w, "\n\n")
			f.Flush()
		}

		now := time.Now().Unix()
		itemID := "msg_gateway_1"
		write(map[string]any{
			"type": "response.created",
			"response": map[string]any{
				"id":         "resp_gateway_1",
				"created_at": now,
				"model":      "gpt-5-mini",
			},
		})
		write(map[string]any{
			"type":         "response.output_item.added",
			"output_index": 0,
			"item": map[string]any{
				"type": "message",
				"id":   itemID,
			},
		})
		write(map[string]any{
			"type":    "response.output_text.delta",
			"item_id": itemID,
			"delta":   token,
		})
		write(map[string]any{
			"type":         "response.output_item.done",
			"output_index": 0,
			"item": map[string]any{
				"type": "message",
				"id":   itemID,
			},
		})
		write(map[string]any{
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
	}))
	t.Cleanup(openaiSrv.Close)

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()

	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: strings.TrimSuffix(openaiSrv.URL, "/") + "/v1",
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini", IsDefault: true}},
			},
		},
	}

	channelID := "ch_test_ai_gateway_1"
	envOrigin := envOriginWithChannel(channelID)
	meta := session.Meta{
		EndpointID:        "env_123",
		NamespacePublicID: "ns_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	resolveMeta := resolveMetaForTest(channelID, meta)

	aiSvc, err := ai.NewService(ai.Options{
		Logger:              logger,
		StateDir:            stateDir,
		FSRoot:              stateDir,
		Shell:               "bash",
		Config:              cfg,
		RunMaxWallTime:      30 * time.Second,
		RunIdleTimeout:      10 * time.Second,
		ToolApprovalTimeout: 5 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) {
			return "sk-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	t.Cleanup(func() { _ = aiSvc.Close() })

	dist := fstest.MapFS{
		"env/index.html": {Data: []byte("<html>env</html>")},
		"inject.js":      {Data: []byte("console.log('inject');")},
	}
	gw, err := New(Options{
		Logger:             logger,
		Backend:            &stubBackend{},
		DistFS:             dist,
		ListenAddr:         "127.0.0.1:0",
		ConfigPath:         writeTestConfigWithAI(t),
		ResolveSessionMeta: resolveMeta,
		AI:                 aiSvc,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// Create thread.
	var threadID string
	{
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/threads", bytes.NewBufferString(`{"title":"hello"}`))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("create thread status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp struct {
			OK   bool `json:"ok"`
			Data struct {
				Thread struct {
					ThreadID string `json:"thread_id"`
				} `json:"thread"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal create thread: %v", err)
		}
		threadID = strings.TrimSpace(resp.Data.Thread.ThreadID)
		if !resp.OK || threadID == "" {
			t.Fatalf("unexpected create thread response: %s", rr.Body.String())
		}
	}

	// Run.
	{
		body := map[string]any{
			"thread_id": threadID,
			"model":     "openai/gpt-5-mini",
			"input":     map[string]any{"text": "hi", "attachments": []any{}},
			"options":   map[string]any{"max_steps": 1},
		}
		b, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/runs", bytes.NewBuffer(b))
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("run status=%d body=%s", rr.Code, rr.Body.String())
		}
		runID := strings.TrimSpace(rr.Header().Get("X-Redeven-AI-Run-ID"))
		if runID == "" {
			t.Fatalf("missing X-Redeven-AI-Run-ID header")
		}
		if !strings.Contains(rr.Body.String(), token) {
			t.Fatalf("NDJSON stream missing token %q, body=%q", token, rr.Body.String())
		}
		if !strings.Contains(rr.Body.String(), `"type":"message-end"`) {
			t.Fatalf("NDJSON stream missing message-end, body=%q", rr.Body.String())
		}
	}

	// Thread metadata should be updated by persisted assistant message.
	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads/"+threadID, nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("get thread status=%d body=%s", rr.Code, rr.Body.String())
		}
		var resp struct {
			OK   bool `json:"ok"`
			Data struct {
				Thread struct {
					LastMessagePreview string `json:"last_message_preview"`
				} `json:"thread"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal get thread: %v", err)
		}
		if !resp.OK {
			t.Fatalf("unexpected get thread response: %s", rr.Body.String())
		}
		if strings.TrimSpace(resp.Data.Thread.LastMessagePreview) == "" {
			t.Fatalf("last_message_preview should not be empty")
		}
		// Native runtime enforces explicit completion; preview should reflect the waiting_user question.
		if !strings.Contains(resp.Data.Thread.LastMessagePreview, "explicit completion") {
			t.Fatalf("last_message_preview=%q, want it to include %q", resp.Data.Thread.LastMessagePreview, "explicit completion")
		}
	}
}
