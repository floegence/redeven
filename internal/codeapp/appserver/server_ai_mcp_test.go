package appserver

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestMCPManagementRoutes(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	stateDir := t.TempDir()
	service, err := ai.NewService(ai.Options{Logger: logger, StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh", Config: &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: "https://api.openai.com/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	const channel = "mcp_management"
	newServer := func(meta session.Meta) *Server {
		server, err := New(Options{Logger: logger, Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}, "inject.js": {Data: []byte("")}}, ListenAddr: "127.0.0.1:0", ConfigPath: writeTestConfigWithAI(t), ResolveSessionMeta: resolveMetaForTest(channel, meta), AIServiceProvider: newStaticAIServiceProvider(service)})
		if err != nil {
			t.Fatal(err)
		}
		return server
	}
	request := func(server *Server, method, path, body, origin string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Origin", origin)
		response := httptest.NewRecorder()
		server.serveHTTP(response, req)
		return response
	}
	admin := newServer(session.Meta{CanRead: true, CanAdmin: true})
	reader := newServer(session.Meta{CanRead: true, CanWrite: true, CanExecute: true})
	const base = "/_redeven_proxy/api/ai/mcp"
	input := `{"id":"workspace","name":"Workspace","transport":"http","url":"https://tools.example.com/mcp","enabled":false,"headers":{"Authorization":"Bearer private-token"}}`
	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		if response := request(reader, method, base, input, envOriginWithChannel(channel)); response.Code != http.StatusForbidden {
			t.Fatalf("reader %s = %d: %s", method, response.Code, response.Body)
		}
	}
	if response := request(reader, http.MethodPost, base+"/check", `{"id":"workspace","revision":1}`, envOriginWithChannel(channel)); response.Code != http.StatusForbidden {
		t.Fatalf("reader check = %d", response.Code)
	}
	if response := request(admin, http.MethodPut, base, input, "https://untrusted.example"); response.Code < 400 {
		t.Fatal("cross-origin configuration mutation accepted")
	}
	response := request(admin, http.MethodPut, base, input, envOriginWithChannel(channel))
	if response.Code != http.StatusOK {
		t.Fatalf("save = %d: %s", response.Code, response.Body)
	}
	if strings.Contains(response.Body.String(), "private-token") {
		t.Fatal("save leaked credentials")
	}
	response = request(reader, http.MethodGet, base, "", envOriginWithChannel(channel))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"header_keys":["Authorization"]`) || strings.Contains(response.Body.String(), "private-token") {
		t.Fatalf("redacted catalog = %d: %s", response.Code, response.Body)
	}
	for _, body := range []string{`{"id":"workspace","unknown":true}`, input + `{}`, `[]`} {
		if response := request(admin, http.MethodPut, base, body, envOriginWithChannel(channel)); response.Code != http.StatusBadRequest {
			t.Fatalf("invalid request accepted: %s", body)
		}
	}
	response = request(admin, http.MethodDelete, base, `{"id":"workspace","revision":1}`, envOriginWithChannel(channel))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"servers":[]`) {
		t.Fatalf("delete = %d: %s", response.Code, response.Body)
	}
}
