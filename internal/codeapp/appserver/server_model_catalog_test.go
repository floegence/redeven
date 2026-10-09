package appserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestModelDirectoryBaselineDoesNotContactDynamicProvider(t *testing.T) {
	var requests atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		<-r.Context().Done()
	}))
	defer provider.Close()
	cfg := &config.AIConfig{CurrentModelID: "static/agent", Providers: []config.AIProvider{
		{ID: "static", Type: "openai_compatible", Models: []config.AIProviderModel{{ModelName: "agent"}}},
		{ID: "offline", Type: "ollama", BaseURL: provider.URL, ModelSelection: &config.AIModelSelection{SelectedModels: []string{"missing"}}},
	}}
	svc, err := ai.NewService(ai.Options{Config: cfg, StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	channel := "ch_model_baseline"
	srv, err := New(Options{Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}, "inject.js": {Data: []byte("")}}, ListenAddr: "127.0.0.1:0", ConfigPath: writeTestConfigWithAI(t), AIServiceProvider: newStaticAIServiceProvider(svc), ResolveSessionMeta: resolveMetaForTest(channel, session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true})})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		query string
		want  int
	}{
		{"?mode=baseline", http.StatusOK},
		{"?mode=unknown", http.StatusBadRequest},
		{"?mode=baseline&mode=baseline", http.StatusBadRequest},
		{"?unexpected=1", http.StatusBadRequest},
	} {
		ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
		req := httptest.NewRequest(http.MethodGet, "/_redeven_proxy/api/ai/models"+tc.query, nil).WithContext(ctx)
		req.Header.Set("Origin", envOriginWithChannel(channel))
		rr := httptest.NewRecorder()
		srv.serveHTTP(rr, req)
		cancel()
		if rr.Code != tc.want {
			t.Fatalf("%s: status %d, want %d: %s", tc.query, rr.Code, tc.want, rr.Body.String())
		}
		if tc.want == http.StatusOK {
			var response struct {
				Data struct {
					Current   string `json:"current_model"`
					Directory struct {
						Models []struct {
							ID    string `json:"id"`
							State string `json:"state"`
						} `json:"models"`
					} `json:"directory"`
				} `json:"data"`
			}
			if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Data.Current != cfg.CurrentModelID || len(response.Data.Directory.Models) != 2 {
				t.Fatalf("missing baseline directory: %s", rr.Body.String())
			}
		}
	}
	if requests.Load() != 0 {
		t.Fatalf("baseline contacted the dynamic provider %d times", requests.Load())
	}
}

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
