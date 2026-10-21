package appserver

import (
	"encoding/json"
	"net/http"
	"os"
	"reflect"
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
		brave, disabled                   bool
		wantError                         string
		invalidField                      string
	}{
		{name: "legacy exclusion save rejected", kind: "ollama", invalidField: "legacy selection", keyPatch: []any{"new-key"}, wantError: "selected_models"},
		{name: "disabled provider needs no key", kind: "openai", disabled: true},
		{name: "disabled provider retains credentials", kind: "openai", savedKey: "stored-key", disabled: true},
		{name: "disabled Brave retains both credentials", kind: "openai_compatible", savedKey: "stored-key", savedWebKey: "stored-web-key", brave: true, disabled: true},
		{name: "disabled Brave needs no key", kind: "openai_compatible", brave: true, disabled: true},
		{name: "disabled provider still requires valid structure", kind: "ollama", disabled: true, invalidField: "base_url", wantError: "base_url"},
		{name: "disabled provider still requires explicit selection", kind: "ollama", disabled: true, invalidField: "legacy selection", wantError: "selected_models"},
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
		{name: "configured without model selection", kind: "ollama", invalidField: "models"},
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
			if tc.disabled {
				enabled := false
				provider.Enabled = &enabled
			}
			if tc.kind != "openai" && tc.kind != "anthropic" && tc.kind != "google" {
				provider.BaseURL = "http://127.0.0.1:11434/v1"
			}
			if tc.brave {
				provider.WebSearch = &config.AIProviderWebSearch{Enabled: true, Source: "brave"}
			}
			switch tc.invalidField {
			case "legacy selection":
				provider.Models = nil
				provider.ModelSelection = &config.AIModelSelection{}
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
			currentModel := "provider/agent"
			if tc.invalidField == "models" {
				currentModel = ""
			}
			body, err := json.Marshal(map[string]any{
				"model_profile":            config.AIModelProfile{CurrentModelID: currentModel, Providers: []config.AIProvider{provider}},
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
				if err != nil || saved.AI.CurrentModelID != currentModel || saved.AI.Providers[0].Type != tc.kind || saved.AI.Providers[0].IsEnabled() == tc.disabled {
					t.Fatalf("saved profile does not match the bundle: %v", err)
				}
				if tc.disabled {
					enabled := true
					provider.Enabled = &enabled
					body, err := json.Marshal(map[string]any{"model_profile": config.AIModelProfile{CurrentModelID: "provider/agent", Providers: []config.AIProvider{provider}}})
					if err != nil {
						t.Fatal(err)
					}
					rr := performServerRequest(srv, http.MethodPut, "/_redeven_proxy/api/ai/provider_bundle", envOriginWithChannel(channel), string(body))
					wantReady := (config.AIProviderAPIKeyOptional(tc.kind) || tc.savedKey != "") && (!tc.brave || tc.savedWebKey != "")
					if wantReady && rr.Code != http.StatusOK || !wantReady && rr.Code != http.StatusBadRequest {
						t.Fatalf("re-enable credential validation: %d %s", rr.Code, rr.Body.String())
					}
					reloaded, err := config.Load(cfgPath)
					if err != nil || reloaded.AI.Providers[0].IsEnabled() != wantReady || reloaded.AI.CurrentModelID != "provider/agent" {
						t.Fatalf("re-enable changed saved intent: %v", err)
					}
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

func TestServer_AIProviderBundlePreservesUnchangedChatGPTBindingAfterPlanPermissionChanges(t *testing.T) {
	path := writeTestConfigWithAI(t)
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	account := settings.ChatGPTAccount{
		Issuer: "https://auth.openai.com", Subject: "plan-changed", ClientID: "issued-client",
		AccessToken: "saved-token", Scopes: []string{"resource.invoke", "chatgpt.tokens.use.direct"},
	}
	previousProvider := config.AIProvider{
		ID: "openai", Type: "openai", AuthMethod: config.AIAuthChatGPT, AccountID: account.ID(),
		ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-5.5"}},
	}
	previousAI := &config.AIConfig{CurrentModelID: "openai/gpt-5.5", Providers: []config.AIProvider{previousProvider}}
	cfg.AI = previousAI
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	svc, err := ai.NewService(ai.Options{StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh", Config: cfg.AI})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	srv, err := New(Options{
		Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}},
		ListenAddr: "127.0.0.1:0", ConfigPath: path, AIServiceProvider: newStaticAIServiceProvider(svc),
		ResolveSessionMeta: resolveMetaForTest("credential-test", session.Meta{CanRead: true, CanAdmin: true}),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.secrets.UpdateChatGPTAccount(t.Context(), account.ID(), func(stored *settings.ChatGPTAccount) error {
		*stored = account
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := srv.secrets.UpdateChatGPTAccount(t.Context(), account.ID(), func(stored *settings.ChatGPTAccount) error {
		stored.Scopes = []string{"resource.invoke"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if changed, _, err := srv.secrets.ChatGPTAccount(account.ID()); err != nil || changed.PlanEnabled() {
		t.Fatalf("ChatGPT account did not lose plan permission: %v", err)
	}

	anthropicKey := "anthropic-key"
	profile := config.AIModelProfile{
		CurrentModelID: previousAI.CurrentModelID,
		Providers: []config.AIProvider{
			previousProvider,
			{ID: "anthropic", Type: "anthropic", Models: []config.AIProviderModel{{ModelName: "claude-sonnet-4-5"}}},
		},
	}
	updated, err := srv.saveAIProviderBundle(svc, profile, []settings.AIProviderAPIKeyPatch{{ProviderID: "anthropic", APIKey: &anthropicKey}}, nil, true)
	if err != nil {
		t.Fatalf("unrelated provider save was rejected: %v", err)
	}
	if len(updated.AI.Providers) != 2 || !reflect.DeepEqual(updated.AI.Providers[0], previousProvider) {
		t.Fatalf("existing ChatGPT configuration changed: %+v", updated.AI.Providers)
	}
	if key, ok, err := srv.secrets.GetAIProviderAPIKey("anthropic"); err != nil || !ok || key != anthropicKey {
		t.Fatalf("Anthropic credential was not saved: configured=%v err=%v", ok, err)
	}
}

func TestServer_AIProviderBundleRejectsNewReboundAndReenabledChatGPTWithoutPlan(t *testing.T) {
	account := settings.ChatGPTAccount{Issuer: "https://auth.openai.com", Subject: "prior-account", ClientID: "issued-client"}
	missingAccountID := "chatgpt_plan_required"
	for _, tc := range []struct {
		name         string
		previous     *config.AIConfig
		accountID    string
		priorAccount *settings.ChatGPTAccount
	}{
		{name: "new binding", previous: &config.AIConfig{}, accountID: missingAccountID},
		{
			name: "rebound account", previous: &config.AIConfig{Providers: []config.AIProvider{{
				ID: "openai", Type: "openai", AuthMethod: config.AIAuthChatGPT, AccountID: account.ID(),
				ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-5.5"}},
			}}}, accountID: missingAccountID, priorAccount: &account,
		},
		{
			name: "reenabled account", previous: &config.AIConfig{Providers: []config.AIProvider{{
				ID: "openai", Type: "openai", AuthMethod: config.AIAuthChatGPT, AccountID: missingAccountID,
				Enabled: boolPointer(false), ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-5.5"}},
			}}}, accountID: missingAccountID,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := writeTestConfigWithAI(t)
			cfg, err := config.Load(path)
			if err != nil {
				t.Fatal(err)
			}
			cfg.AI = tc.previous
			if err := config.Save(path, cfg); err != nil {
				t.Fatal(err)
			}
			svc, err := ai.NewService(ai.Options{StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh", Config: cfg.AI})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = svc.Close() })
			srv, err := New(Options{
				Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}},
				ListenAddr: "127.0.0.1:0", ConfigPath: path, AIServiceProvider: newStaticAIServiceProvider(svc),
				ResolveSessionMeta: resolveMetaForTest("credential-test", session.Meta{CanRead: true, CanAdmin: true}),
			})
			if err != nil {
				t.Fatal(err)
			}
			if tc.priorAccount != nil {
				if err := srv.secrets.UpdateChatGPTAccount(t.Context(), tc.priorAccount.ID(), func(stored *settings.ChatGPTAccount) error {
					*stored = *tc.priorAccount
					return nil
				}); err != nil {
					t.Fatal(err)
				}
			}
			provider := config.AIProvider{
				ID: "openai", Type: "openai", AuthMethod: config.AIAuthChatGPT, AccountID: tc.accountID,
				ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-5.5"}},
			}
			if tc.name == "reenabled account" {
				provider.Enabled = boolPointer(true)
			}
			anthropicKey := "replacement-anthropic-key"
			if err := srv.secrets.SetAIProviderAPIKey("anthropic", "retained-anthropic-key"); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			profile := config.AIModelProfile{Providers: []config.AIProvider{
				provider,
				{ID: "anthropic", Type: "anthropic", Models: []config.AIProviderModel{{ModelName: "claude-sonnet-4-5"}}},
			}}
			_, err = srv.saveAIProviderBundle(svc, profile, []settings.AIProviderAPIKeyPatch{{ProviderID: "anthropic", APIKey: &anthropicKey}}, nil, true)
			if err == nil || !strings.Contains(err.Error(), "ChatGPT plan permission") {
				t.Fatalf("invalid ChatGPT binding was accepted: %v", err)
			}
			after, err := os.ReadFile(path)
			if err != nil || string(after) != string(before) {
				t.Fatalf("rejected save changed persisted configuration: %v", err)
			}
			if key, ok, err := srv.secrets.GetAIProviderAPIKey("anthropic"); err != nil || !ok || key != "retained-anthropic-key" {
				t.Fatalf("rejected save changed provider credential: configured=%v err=%v", ok, err)
			}
		})
	}
}

func boolPointer(value bool) *bool {
	return &value
}
