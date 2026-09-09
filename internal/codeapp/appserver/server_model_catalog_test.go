package appserver

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func TestModelCatalogEndpointRequiresAdminAndLeavesConfigurationUnchanged(t *testing.T) {
	cfgPath := writeTestConfigWithAI(t)
	before, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	svc, err := ai.NewService(ai.Options{StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	for _, tc := range []struct {
		name  string
		admin bool
		body  string
		want  int
	}{
		{"admin offline catalog before AI configured", true, `{"type":"deepseek"}`, http.StatusOK},
		{"reader", false, `{"type":"deepseek"}`, http.StatusForbidden},
		{"unknown field", true, `{"type":"deepseek","unexpected":true}`, http.StatusBadRequest},
		{"trailing body", true, `{"type":"deepseek"} {}`, http.StatusBadRequest},
		{"oversized body", true, `{"type":"deepseek","api_key":"` + strings.Repeat("x", 65536) + `"}`, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			channel := "ch_model_catalog"
			srv, err := New(Options{Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}, "inject.js": {Data: []byte("")}}, ListenAddr: "127.0.0.1:0", ConfigPath: cfgPath, AIServiceProvider: newStaticAIServiceProvider(svc), ResolveSessionMeta: resolveMetaForTest(channel, session.Meta{CanRead: true, CanAdmin: tc.admin})})
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/ai/model_catalog", strings.NewReader(tc.body))
			req.Header.Set("Origin", envOriginWithChannel(channel))
			rr := httptest.NewRecorder()
			srv.serveHTTP(rr, req)
			if rr.Code != tc.want {
				t.Fatalf("status %d, want %d: %s", rr.Code, tc.want, rr.Body.String())
			}
			if tc.want == http.StatusOK && (!strings.Contains(rr.Body.String(), "deepseek-v4-flash-vision-exp") || !strings.Contains(rr.Body.String(), `"image"`)) {
				t.Fatalf("missing model image capability: %s", rr.Body.String())
			}
		})
	}
	after, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("read-only catalog query rewrote configuration")
	}
}
