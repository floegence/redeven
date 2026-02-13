package gateway

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven-agent/internal/ai"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func TestGateway_AI_Permissions_ReadOnlyCanBrowseButCannotMutate(t *testing.T) {
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
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini", IsDefault: true}},
			},
		},
	}

	aiSvc, err := ai.NewService(ai.Options{
		Logger:   logger,
		StateDir: stateDir,
		FSRoot:   stateDir,
		Shell:    "bash",
		Config:   cfg,
		ResolveProviderAPIKey: func(string) (string, bool, error) {
			return "sk-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("ai.NewService: %v", err)
	}
	t.Cleanup(func() { _ = aiSvc.Close() })

	channelID := "ch_test_ai_permissions_ro_1"
	envOrigin := envOriginWithChannel(channelID)
	meta := session.Meta{
		EndpointID:        "env_123",
		NamespacePublicID: "ns_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          false,
		CanExecute:        false,
		CanAdmin:          false,
	}
	resolveMeta := resolveMetaForTest(channelID, meta)

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

	// Read-only sessions can browse AI threads.
	{
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/threads", nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("list threads status=%d body=%s", rr.Code, rr.Body.String())
		}
	}

	assertForbidden := func(method string, path string) {
		t.Helper()
		req := httptest.NewRequest(method, path, nil)
		req.Header.Set("Origin", envOrigin)
		rr := httptest.NewRecorder()
		gw.serveHTTP(rr, req)
		if rr.Code != http.StatusForbidden {
			t.Fatalf("%s %s status=%d body=%s", method, path, rr.Code, rr.Body.String())
		}
		if !strings.Contains(rr.Body.String(), "read/write/execute permission denied") {
			t.Fatalf("%s %s unexpected body=%s", method, path, rr.Body.String())
		}
	}

	// Mutating AI endpoints require RWX.
	assertForbidden(http.MethodPost, "/_redeven_proxy/api/ai/threads")
	assertForbidden(http.MethodPatch, "/_redeven_proxy/api/ai/threads/th_test")
	assertForbidden(http.MethodDelete, "/_redeven_proxy/api/ai/threads/th_test")
	assertForbidden(http.MethodPost, "/_redeven_proxy/api/ai/threads/th_test/messages")
	assertForbidden(http.MethodPost, "/_redeven_proxy/api/ai/runs")
	assertForbidden(http.MethodPost, "/_redeven_proxy/api/ai/runs/run_test/cancel")
	assertForbidden(http.MethodPost, "/_redeven_proxy/api/ai/runs/run_test/tool_approvals")
	assertForbidden(http.MethodPost, "/_redeven_proxy/api/ai/uploads")
}
