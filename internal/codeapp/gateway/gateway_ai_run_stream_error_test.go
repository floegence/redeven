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

func TestGateway_AI_Run_InvalidModelStillStreamsError(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()

	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini", Label: "GPT-5 Mini", IsDefault: true}},
			},
		},
	}

	channelID := "ch_test_ai_stream_error_1"
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
		Logger:             logger,
		StateDir:           stateDir,
		FSRoot:             stateDir,
		Shell:              "bash",
		Config:             cfg,
		RunMaxWallTime:     30 * time.Second,
		RunIdleTimeout:     10 * time.Second,
		ResolveSessionMeta: resolveMeta,
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

	// Start run with an invalid model id (missing "<provider_id>/").
	{
		body := map[string]any{
			"thread_id": threadID,
			"model":     "gpt-5-mini",
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
		if runID := strings.TrimSpace(rr.Header().Get("X-Redeven-AI-Run-ID")); runID == "" {
			t.Fatalf("missing X-Redeven-AI-Run-ID header")
		}
		if rr.Body.Len() == 0 {
			t.Fatalf("expected non-empty NDJSON response body")
		}
		bodyText := rr.Body.String()
		if !strings.Contains(bodyText, `"type":"error"`) {
			t.Fatalf("NDJSON stream missing error event, body=%q", bodyText)
		}
		if !strings.Contains(strings.ToLower(bodyText), "invalid model") {
			t.Fatalf("NDJSON stream missing invalid model error, body=%q", bodyText)
		}
	}
}

