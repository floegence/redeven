package appserver

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/ai/agentplugins"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestAgentPluginManagementRoutes(t *testing.T) {
	t.Setenv("REDEVEN_AGENT_AI_PLUGIN_CATALOGS", `[{"id":"team","name":"Team extensions","url":"https://catalog.example.com/plugins.json"}]`)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	state := t.TempDir()
	service, e := ai.NewService(ai.Options{Logger: logger, StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", Config: &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: "https://api.openai.com/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}}})
	if e != nil {
		t.Fatal(e)
	}
	defer service.Close()
	const channel = "plugin_management"
	newServer := func(meta session.Meta) *Server {
		server, e := New(Options{Logger: logger, Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}, "inject.js": {Data: []byte("")}}, ListenAddr: "127.0.0.1:0", ConfigPath: writeTestConfigWithAI(t), ResolveSessionMeta: resolveMetaForTest(channel, meta), AIServiceProvider: newStaticAIServiceProvider(service)})
		if e != nil {
			t.Fatal(e)
		}
		return server
	}
	request := func(server *Server, method, path string, body any) *httptest.ResponseRecorder {
		b, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, strings.NewReader(string(b)))
		r.Header.Set("Origin", envOriginWithChannel(channel))
		w := httptest.NewRecorder()
		server.serveHTTP(w, r)
		return w
	}
	admin := newServer(session.Meta{CanRead: true, CanAdmin: true, UserPublicID: "owner"})
	reader := newServer(session.Meta{CanRead: true, UserPublicID: "reader"})
	other := newServer(session.Meta{CanRead: true, CanAdmin: true, UserPublicID: "other"})
	const base = "/_redeven_proxy/api/ai/agent-plugins"
	var listing struct{ Data ai.AgentPluginsView }
	listed := request(reader, "GET", base, nil)
	if listed.Code != 200 || json.Unmarshal(listed.Body.Bytes(), &listing) != nil || len(listing.Data.Sources) != 1 || !listing.Data.Sources[0].Managed || listing.Data.Sources[0].ID != "configured:team" {
		t.Fatal("configured source unavailable to readers", listed.Code, listed.Body)
	}
	removed := request(admin, "DELETE", base+"/sources", map[string]any{"id": "configured:team", "revision": listing.Data.Revision})
	if removed.Code < 400 || !strings.Contains(removed.Body.String(), "catalog_source_managed") {
		t.Fatal("runtime configuration mutated through user source API", removed.Code, removed.Body)
	}
	for _, action := range []struct{ method, path string }{{"POST", "/prepare"}, {"POST", "/commit"}, {"PUT", ""}, {"DELETE", ""}, {"POST", "/check"}, {"PUT", "/credentials"}, {"POST", "/sources"}, {"DELETE", "/sources"}} {
		if w := request(reader, action.method, base+action.path, map[string]any{}); w.Code != 403 {
			t.Fatalf("reader %s %s: %d", action.method, action.path, w.Code)
		}
	}
	root := filepath.Join(state, "package")
	if e = os.MkdirAll(root, 0700); e != nil {
		t.Fatal(e)
	}
	manifest, _ := json.Marshal(map[string]any{"$schema": agentplugins.ManifestSchema, "name": "route-fixture"})
	if e = os.WriteFile(filepath.Join(root, "plugin.json"), manifest, 0600); e != nil {
		t.Fatal(e)
	}
	mcp, _ := json.Marshal(map[string]any{"$schema": agentplugins.MCPSchema, "mcpServers": map[string]any{"local": map[string]any{"type": "stdio", "command": "must-not-execute"}}})
	if e = os.WriteFile(filepath.Join(root, "mcp.json"), mcp, 0600); e != nil {
		t.Fatal(e)
	}
	w := request(admin, "POST", base+"/prepare", agentplugins.PrepareRequest{RequestID: "route-install", Source: agentplugins.Source{Type: "local", Directory: root}})
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	var prepared struct{ Data agentplugins.Operation }
	if e = json.Unmarshal(w.Body.Bytes(), &prepared); e != nil {
		t.Fatal(e)
	}
	deadline := time.Now().Add(5 * time.Second)
	for prepared.Data.Status == "preparing" && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
		w = request(admin, "GET", base+"/operation?id="+prepared.Data.ID, nil)
		if e = json.Unmarshal(w.Body.Bytes(), &prepared); e != nil {
			t.Fatal(e)
		}
	}
	if prepared.Data.Status != "ready" {
		t.Fatal(prepared, w.Body)
	}
	if w = request(other, "GET", base+"/operation?id="+prepared.Data.ID, nil); w.Code == 200 {
		t.Fatal("another administrator accessed private operation")
	}
	w = request(admin, "POST", base+"/commit", agentplugins.CommitRequest{OperationID: prepared.Data.ID, Digest: prepared.Data.Digest, Enabled: true, Components: []string{"mcp:local"}})
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	var installed struct{ Data agentplugins.Install }
	if e = json.Unmarshal(w.Body.Bytes(), &installed); e != nil {
		t.Fatal(e)
	}
	identity := map[string]any{"id": installed.Data.ID, "revision": installed.Data.Revision, "component": "mcp:local"}
	if w = request(admin, "POST", base+"/check", identity); w.Code != 403 || !strings.Contains(w.Body.String(), "process_permission_required") {
		t.Fatal(w.Code, w.Body)
	}
	identity["values"] = map[string]string{"API_KEY": "secret-that-must-not-leak"}
	if w = request(admin, "PUT", base+"/credentials", identity); w.Code != 200 || strings.Contains(w.Body.String(), "secret-that-must-not-leak") {
		t.Fatal(w.Code, w.Body)
	}
	if w = request(reader, "GET", base, nil); w.Code != 200 || strings.Contains(w.Body.String(), "secret-that-must-not-leak") || strings.Contains(w.Body.String(), "route-install") {
		t.Fatal(w.Code, w.Body)
	}
	r := httptest.NewRequest(http.MethodPost, base+"/prepare", strings.NewReader("{}"))
	r.Header.Set("Origin", "https://untrusted.example")
	response := httptest.NewRecorder()
	admin.serveHTTP(response, r)
	if response.Code < 400 {
		t.Fatal("cross-origin installation accepted")
	}
	if w = request(admin, "PUT", base, map[string]any{"unknown": true}); w.Code != 400 {
		t.Fatal("unknown fields accepted")
	}
}
