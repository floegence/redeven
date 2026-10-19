package appserver

import (
	"io"
	"log/slog"
	"net/http"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func TestServer_AIToolPreviewRequiresReadAndExactIdentity(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc, err := ai.NewService(ai.Options{Logger: logger, StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh", Config: appserverTestAIConfig()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	for _, canRead := range []bool{true, false} {
		meta := session.Meta{EndpointID: "preview-env", NamespacePublicID: "preview-namespace", UserPublicID: "preview-user", CanRead: canRead}
		srv, err := New(Options{Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}, "inject.js": {Data: []byte("void 0")}}, ListenAddr: "127.0.0.1:0", Logger: logger, AIServiceProvider: newStaticAIServiceProvider(svc), ConfigPath: writeTestConfig(t), ResolveSessionMeta: resolveMetaForTest("preview-channel", meta)})
		if err != nil {
			t.Fatal(err)
		}
		for _, tc := range []struct {
			body   string
			status int
		}{
			{`{"turn_id":"turn","run_id":"run","tool_call_id":"call"}`, http.StatusNotFound},
			{`{"turn_id":"turn","run_id":"run","tool_call_id":"call","content":"forged"}`, http.StatusBadRequest},
			{`{"turn_id":"turn"}`, http.StatusNotFound},
			{`{} {}`, http.StatusBadRequest},
		} {
			expected := tc.status
			if !canRead {
				expected = http.StatusForbidden
			}
			response := performServerRequest(srv, http.MethodPost, "/_redeven_proxy/api/ai/threads/unknown/tool-preview", envOriginWithChannel("preview-channel"), tc.body)
			if response.Code != expected {
				t.Fatalf("canRead=%v status=%d expected=%d body=%s", canRead, response.Code, expected, response.Body.String())
			}
		}
	}
}
