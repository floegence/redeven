package appserver

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/settings"
)

func TestServer_AIProviderBundleCredentialRequirements(t *testing.T) {
	for _, tc := range []struct {
		name, kind, savedKey, savedWebKey string
		keyPatch, webPatch                []any
		brave                             bool
		wantError                         string
		invalidField                      string
	}{
		{name: "required key missing", kind: "openai", wantError: "api key"},
		{name: "stored key retained", kind: "openai", savedKey: "stored-key"},
		{name: "new key supplied", kind: "openai", keyPatch: []any{"new-key"}},
		{name: "required key deletion rejected", kind: "openai", savedKey: "stored-key", keyPatch: []any{nil}, wantError: "api key"},
		{name: "last patch determines readiness", kind: "openai", keyPatch: []any{"new-key", nil}, wantError: "api key"},
		{name: "Ollama needs no key", kind: "ollama"},
		{name: "Ollama retains optional key", kind: "ollama", savedKey: "stored-key"},
		{name: "Ollama can clear optional key", kind: "ollama", savedKey: "stored-key", keyPatch: []any{nil}},
		{name: "compatible endpoint needs no key", kind: "openai_compatible"},
		{name: "compatible endpoint retains optional key", kind: "openai_compatible", savedKey: "stored-key"},
		{name: "compatible endpoint accepts optional key", kind: "openai_compatible", keyPatch: []any{"new-key"}},
		{name: "compatible endpoint can clear optional key", kind: "openai_compatible", savedKey: "stored-key", keyPatch: []any{nil}},
		{name: "Brave requires separate key", kind: "openai_compatible", brave: true, wantError: "web search api key"},
		{name: "Brave accepts new key", kind: "openai_compatible", webPatch: []any{"new-web-key"}, brave: true},
		{name: "Brave retains stored key", kind: "openai_compatible", savedKey: "stored-key", savedWebKey: "stored-web-key", brave: true},
		{name: "Brave key deletion rejected", kind: "openai_compatible", savedKey: "stored-key", savedWebKey: "stored-web-key", webPatch: []any{nil}, brave: true, wantError: "web search api key"},
		{name: "Anthropic accepts default URL and optional limits", kind: "anthropic", savedKey: "stored-key", invalidField: "optional limits"},
		{name: "Gemini accepts default URL and optional limits", kind: "google", savedKey: "stored-key", invalidField: "optional limits"},
		{name: "missing required URL", kind: "ollama", invalidField: "base_url", wantError: "base_url"},
		{name: "invalid URL", kind: "ollama", invalidField: "url scheme", wantError: "base_url"},
		{name: "missing models", kind: "ollama", invalidField: "models", wantError: "missing models"},
		{name: "missing model name", kind: "ollama", invalidField: "model_name", wantError: "model_name"},
		{name: "missing serving context", kind: "ollama", invalidField: "context_window", wantError: "context_window"},
		{name: "missing custom context", kind: "openai_compatible", savedKey: "stored-key", invalidField: "context_window", wantError: "context_window"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfgPath := writeTestConfigWithAI(t)
			cfg, err := config.Load(cfgPath)
			if err != nil {
				t.Fatal(err)
			}
			svc, err := ai.NewService(ai.Options{StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh", Config: cfg.AI})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = svc.Close() })
			const channel = "credential-test"
			srv, err := New(Options{
				Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}},
				ListenAddr: "127.0.0.1:0", ConfigPath: cfgPath, AIServiceProvider: newStaticAIServiceProvider(svc),
				ResolveSessionMeta: resolveMetaForTest(channel, session.Meta{CanRead: true, CanAdmin: true}),
			})
			if err != nil {
				t.Fatal(err)
			}
			if tc.savedKey != "" {
				if err := srv.secrets.SetAIProviderAPIKey("provider", tc.savedKey); err != nil {
					t.Fatal(err)
				}
			}
			if tc.savedWebKey != "" {
				if err := srv.secrets.ApplyWebSearchProviderAPIKeyPatches([]settings.WebSearchProviderAPIKeyPatch{{ProviderID: "provider", APIKey: &tc.savedWebKey}}); err != nil {
					t.Fatal(err)
				}
			}
			before, err := os.ReadFile(cfgPath)
			if err != nil {
				t.Fatal(err)
			}
			provider := config.AIProvider{ID: "provider", Type: tc.kind, Models: []config.AIProviderModel{{ModelName: "agent", ContextWindow: 32768}}}
			if tc.kind != "openai" && tc.kind != "anthropic" && tc.kind != "google" {
				provider.BaseURL = "http://127.0.0.1:11434/v1"
			}
			if tc.brave {
				provider.WebSearch = &config.AIProviderWebSearch{Mode: "brave"}
			}
			switch tc.invalidField {
			case "base_url":
				provider.BaseURL = ""
			case "url scheme":
				provider.BaseURL = "file:///tmp/model"
			case "models":
				provider.Models = nil
			case "model_name":
				provider.Models[0].ModelName = ""
			case "context_window", "optional limits":
				provider.Models[0].ContextWindow = 0
			}
			patches := func(values []any) []any {
				out := []any{}
				for _, value := range values {
					out = append(out, map[string]any{"provider_id": "provider", "api_key": value})
				}
				return out
			}
			body, err := json.Marshal(map[string]any{
				"model_profile":            config.AIModelProfile{CurrentModelID: "provider/agent", Providers: []config.AIProvider{provider}},
				"provider_api_key_patches": patches(tc.keyPatch), "web_search_provider_key_patches": patches(tc.webPatch),
			})
			if err != nil {
				t.Fatal(err)
			}
			rr := performServerRequest(srv, http.MethodPut, "/_redeven_proxy/api/ai/provider_bundle", envOriginWithChannel(channel), string(body))
			if tc.wantError == "" {
				if rr.Code != http.StatusOK {
					t.Fatalf("save failed: %d %s", rr.Code, rr.Body.String())
				}
				finalKey := func(stored string, patches []any) string {
					for _, patch := range patches {
						stored, _ = patch.(string)
					}
					return stored
				}
				key, _, err := srv.secrets.GetAIProviderAPIKey("provider")
				if err != nil || key != finalKey(tc.savedKey, tc.keyPatch) {
					t.Fatalf("saved provider credential does not match the bundle: %v", err)
				}
				webKey, _, err := srv.secrets.GetWebSearchProviderAPIKey("provider")
				if err != nil || webKey != finalKey(tc.savedWebKey, tc.webPatch) {
					t.Fatalf("saved web credential does not match the bundle: %v", err)
				}
				saved, err := config.Load(cfgPath)
				if err != nil || saved.AI.CurrentModelID != "provider/agent" || saved.AI.Providers[0].Type != tc.kind {
					t.Fatalf("saved profile does not match the bundle: %v", err)
				}
				return
			}
			if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), tc.wantError) {
				t.Fatalf("expected rejection containing %q: %d %s", tc.wantError, rr.Code, rr.Body.String())
			}
			after, err := os.ReadFile(cfgPath)
			if err != nil {
				t.Fatal(err)
			}
			if string(after) != string(before) {
				t.Fatal("invalid provider changed persisted configuration")
			}
			key, _, err := srv.secrets.GetAIProviderAPIKey("provider")
			if err != nil || key != tc.savedKey {
				t.Fatalf("invalid provider changed credential: %v", err)
			}
			webKey, _, err := srv.secrets.GetWebSearchProviderAPIKey("provider")
			if err != nil || webKey != tc.savedWebKey {
				t.Fatalf("invalid provider changed web credential: %v", err)
			}
		})
	}
}
