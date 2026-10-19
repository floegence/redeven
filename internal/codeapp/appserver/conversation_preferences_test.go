package appserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestServer_ConversationPreferencesPermissionsStrictJSONAndConflict(t *testing.T) {
	svc, err := ai.NewService(ai.Options{StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh", Config: &config.AIConfig{CurrentModelID: "deepseek/deepseek-v4-flash", Providers: []config.AIProvider{{ID: "deepseek", Type: "deepseek", Models: []config.AIProviderModel{{ModelName: "deepseek-v4-flash"}}}}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	const channel = "ch_conversation_preferences"
	meta := session.Meta{NamespacePublicID: "ns", EndpointID: "env", UserPublicID: "alice", CanRead: true, CanWrite: true, CanExecute: true}
	srv, err := New(Options{ConfigPath: writeTestConfigWithAI(t), Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}, "inject.js": {Data: []byte("inject")}}, ListenAddr: "127.0.0.1:0", AIServiceProvider: newStaticAIServiceProvider(svc), ResolveSessionMeta: func(id string) (*session.Meta, bool) { copy := meta; copy.ChannelID = id; return &copy, id == channel }})
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, body string, want int) map[string]any {
		t.Helper()
		req := httptest.NewRequest(method, "/_redeven_proxy/api/ai/conversation_preferences", bytes.NewBufferString(body))
		req.Header.Set("Origin", envOriginWithChannel(channel))
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		if rr.Code != want {
			t.Fatalf("%s %s: status=%d want=%d body=%s", method, body, rr.Code, want, rr.Body.String())
		}
		var envelope map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		data, _ := envelope["data"].(map[string]any)
		return data
	}
	if data := request(http.MethodGet, "", http.StatusOK); data["revision"] != float64(0) {
		t.Fatalf("initial=%v", data)
	}
	for _, body := range []string{`{"expected_revision":0,"unknown":true}`, `{"expected_revision":0} {}`, `{"model_id":"deepseek/deepseek-v4-flash"}`, `{"expected_revision":null,"model_id":"deepseek/deepseek-v4-flash"}`, `{"expected_revision":0}`} {
		request(http.MethodPatch, body, http.StatusBadRequest)
	}
	data := request(http.MethodPatch, `{"expected_revision":0,"model_id":"deepseek/deepseek-v4-flash"}`, http.StatusOK)
	if data["revision"] != float64(1) || data["model_id"] != "deepseek/deepseek-v4-flash" {
		t.Fatalf("saved=%v", data)
	}
	request(http.MethodPatch, `{"expected_revision":0,"model_id":"deepseek/deepseek-v4-flash"}`, http.StatusConflict)
	meta.CanWrite = false
	request(http.MethodGet, "", http.StatusOK)
	request(http.MethodPatch, `{"expected_revision":1,"model_id":"deepseek/deepseek-v4-flash"}`, http.StatusForbidden)
	meta.UserPublicID = "bob"
	if data := request(http.MethodGet, "", http.StatusOK); data["revision"] != float64(0) || data["model_id"] != nil {
		t.Fatalf("cross-user preference=%v", data)
	}
	meta.CanRead = false
	request(http.MethodGet, "", http.StatusForbidden)
}
