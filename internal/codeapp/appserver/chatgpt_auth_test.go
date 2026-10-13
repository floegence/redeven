package appserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/settings"
)

func TestChatGPTLocalCapabilityAndRemoteMutationDenial(t *testing.T) {
	for _, location := range []string{"ssh", "gateway", "remote_desktop", "remote_web", "unknown", "local"} {
		t.Run(location, func(t *testing.T) {
			path := writeTestConfigWithAI(t)
			cfg, err := config.Load(path)
			if err != nil {
				t.Fatal(err)
			}
			svc, err := ai.NewService(ai.Options{StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh", Config: cfg.AI})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { svc.Close() })
			meta := session.Meta{CanRead: true, CanAdmin: true}
			if location == "local" {
				meta.LocalHostAccess = "verified-native-owner"
			}
			srv, err := New(Options{Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}}, ListenAddr: "127.0.0.1:0", ConfigPath: path, AIServiceProvider: newStaticAIServiceProvider(svc), ResolveSessionMeta: resolveMetaForTest("local-check", meta)})
			if err != nil {
				t.Fatal(err)
			}
			response := performServerRequest(srv, http.MethodGet, "/_redeven_proxy/api/settings", envOriginWithChannel("local-check"), "")
			var envelope struct {
				Data struct {
					AuthCapabilities authCapabilities `json:"auth_capabilities"`
				}
			}
			if json.Unmarshal(response.Body.Bytes(), &envelope) != nil || envelope.Data.AuthCapabilities.OpenAIChatGPT.Available != (location == "local") {
				t.Fatalf("wrong capability: %s", response.Body.String())
			}
			accounts := performServerRequest(srv, http.MethodGet, "/_redeven_proxy/api/ai/auth/chatgpt/accounts", envOriginWithChannel("local-check"), "")
			if location != "local" && accounts.Code != 403 {
				t.Fatalf("remote account state admitted: %d", accounts.Code)
			}
			if location == "local" && accounts.Code != 200 {
				t.Fatalf("local account state denied: %d %s", accounts.Code, accounts.Body.String())
			}
			if location == "local" {
				return
			}
			before, _ := os.ReadFile(path)
			for _, action := range []string{"start", "status", "cancel", "sign-out", "acknowledge", "retry"} {
				req := httptest.NewRequest("POST", "/_redeven_proxy/api/ai/auth/chatgpt/"+action, strings.NewReader(`{"scope_id":"dialog","local_host":true}`))
				req.Header.Set("Origin", envOriginWithChannel("local-check"))
				req.Header.Set("X-Redeven-Host-Access", "local_host")
				rec := httptest.NewRecorder()
				srv.ServeHTTP(rec, req)
				if rec.Code != 403 || !strings.Contains(rec.Body.String(), "chatgpt_local_only") {
					t.Fatalf("%s permitted: %d %s", action, rec.Code, rec.Body.String())
				}
			}
			provider := config.AIProvider{ID: "openai", Type: "openai", AuthMethod: "chatgpt", AccountID: "chatgpt_fake", ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-5.5"}}}
			body, _ := json.Marshal(map[string]any{"model_profile": config.AIModelProfile{CurrentModelID: "openai/gpt-5.5", Providers: []config.AIProvider{provider}}})
			save := performServerRequest(srv, "PUT", "/_redeven_proxy/api/ai/provider_bundle", envOriginWithChannel("local-check"), string(body))
			if save.Code != 403 {
				t.Fatalf("remote save: %d %s", save.Code, save.Body.String())
			}
			after, _ := os.ReadFile(path)
			if string(after) != string(before) {
				t.Fatal("denied save changed config")
			}
		})
	}
}

func TestChatGPTClientCannotEraseAuthenticationWithoutLocalCurrentContract(t *testing.T) {
	path := writeTestConfigWithAI(t)
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	cfg.AI.Providers[0].Models = nil
	cfg.AI.Providers[0].AuthMethod = config.AIAuthChatGPT
	cfg.AI.Providers[0].AccountID = "chatgpt_saved"
	cfg.AI.Providers[0].ModelSelection = &config.AIModelSelection{SelectedModels: []string{"gpt-5-mini"}}
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	svc, err := ai.NewService(ai.Options{StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh", Config: cfg.AI})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { svc.Close() })
	srv, err := New(Options{Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}}, ListenAddr: "127.0.0.1:0", ConfigPath: path, AIServiceProvider: newStaticAIServiceProvider(svc), ResolveSessionMeta: resolveMetaForTest("client-version", session.Meta{CanRead: true, CanAdmin: true, LocalHostAccess: "verified"})})
	if err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	oldProfile := config.AIModelProfile{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}}
	for _, version := range []int{0, 2} {
		body, _ := json.Marshal(map[string]any{"auth_schema_version": version, "model_profile": oldProfile})
		response := performServerRequest(srv, "PUT", "/_redeven_proxy/api/ai/provider_bundle", envOriginWithChannel("client-version"), string(body))
		if response.Code != 409 || !strings.Contains(response.Body.String(), "auth_client_update_required") {
			t.Fatalf("old client save: %d %s", response.Code, response.Body.String())
		}
	}
	remote, err := New(Options{Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}}, ListenAddr: "127.0.0.1:0", ConfigPath: path, AIServiceProvider: newStaticAIServiceProvider(svc), ResolveSessionMeta: resolveMetaForTest("remote-client", session.Meta{CanRead: true, CanAdmin: true})})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"auth_schema_version": 1, "model_profile": oldProfile})
	response := performServerRequest(remote, "PUT", "/_redeven_proxy/api/ai/provider_bundle", envOriginWithChannel("remote-client"), string(body))
	if response.Code != 403 || !strings.Contains(response.Body.String(), "chatgpt_local_only") {
		t.Fatalf("remote authentication replacement: %d %s", response.Code, response.Body.String())
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(before) {
		t.Fatal("old client changed authentication")
	}
}

func TestRemoteAPIKeyEditsPreserveChatGPTAuthentication(t *testing.T) {
	account := config.AIProvider{ID: "account", Type: "openai", AuthMethod: config.AIAuthChatGPT, AccountID: "saved"}
	apiKey := config.AIProvider{ID: "api", Type: "openai", AuthMethod: config.AIAuthAPIKey}
	previous := &config.AIConfig{Providers: []config.AIProvider{account, apiKey}}
	if !preservesChatGPTBindings(previous, config.AIModelProfile{Providers: []config.AIProvider{account, apiKey, {ID: "new-key", Type: "anthropic"}}}) {
		t.Fatal("API-key edits were blocked by an unchanged account binding")
	}
	for _, change := range []string{"remove", "method", "account", "copy", "rename"} {
		t.Run(change, func(t *testing.T) {
			changed := account
			next := []config.AIProvider{changed, apiKey}
			switch change {
			case "remove":
				next = []config.AIProvider{apiKey}
			case "method":
				next[0].AuthMethod = config.AIAuthAPIKey
				next[0].AccountID = ""
			case "account":
				next[0].AccountID = "replacement"
			case "copy":
				changed.ID = "copy"
				next = append(next, changed)
			case "rename":
				next[0].ID = "renamed"
			}
			if preservesChatGPTBindings(previous, config.AIModelProfile{Providers: next}) {
				t.Fatal("remote authentication mutation was admitted")
			}
		})
	}
}

func TestRemoteProviderSaveRechecksLatestAccountInsideConfigWrite(t *testing.T) {
	path := writeTestConfigWithAI(t)
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	account := settings.ChatGPTAccount{Issuer: "https://auth.openai.com", Subject: "test-subject", ClientID: "issued-client", AccessToken: "test-token", Scopes: []string{"resource.invoke", "chatgpt.tokens.use.direct"}, ExpiresAt: time.Now().Add(time.Hour)}
	provider := config.AIProvider{ID: "openai", Type: "openai", AuthMethod: config.AIAuthChatGPT, AccountID: account.ID(), ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-5-mini"}}}
	stale := config.AIModelProfile{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{provider}}
	provider.AccountID = "newly-confirmed-account"
	cfg.AI.Providers = []config.AIProvider{provider}
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	svc, err := ai.NewService(ai.Options{StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh", Config: cfg.AI})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { svc.Close() })
	srv, err := New(Options{Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}}, ListenAddr: "127.0.0.1:0", ConfigPath: path, AIServiceProvider: newStaticAIServiceProvider(svc), ResolveSessionMeta: resolveMetaForTest("remote-save", session.Meta{CanRead: true, CanAdmin: true})})
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.secrets.UpdateChatGPTAccount(context.Background(), account.ID(), func(stored *settings.ChatGPTAccount) error { *stored = account; return nil }); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	_, err = srv.saveAIProviderBundle(svc, stale, nil, nil, false)
	var denied aiProviderBundleSaveError
	if !errors.As(err, &denied) || denied.status != 403 || !errors.Is(err, errChatGPTLocalOnly) {
		t.Fatalf("stale remote binding was admitted: %v", err)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("stale remote save replaced the newly confirmed account")
	}
}

func TestChatGPTAccountProjectionDoesNotExposeCredentialsAndRequiresAdmin(t *testing.T) {
	path := writeTestConfigWithAI(t)
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	svc, err := ai.NewService(ai.Options{StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh", Config: cfg.AI})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	for _, admin := range []bool{false, true} {
		srv, err := New(Options{Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}}, ListenAddr: "127.0.0.1:0", ConfigPath: path, AIServiceProvider: newStaticAIServiceProvider(svc), ResolveSessionMeta: resolveMetaForTest("status", session.Meta{CanRead: true, CanAdmin: admin, LocalHostAccess: "verified"})})
		if err != nil {
			t.Fatal(err)
		}
		a := settings.ChatGPTAccount{Issuer: "https://auth.openai.com", Subject: "verified-subject", Email: "person@example.com", ClientID: "issued-client", AccessToken: "secret-access", RefreshToken: "secret-refresh", IDToken: "secret-id", Scopes: []string{"resource.invoke", "chatgpt.tokens.use.direct"}, ExpiresAt: time.Now().Add(time.Hour)}
		if err := srv.secrets.UpdateChatGPTAccount(t.Context(), a.ID(), func(p *settings.ChatGPTAccount) error { *p = a; return nil }); err != nil {
			t.Fatal(err)
		}
		cfg.AI.Providers[0].AuthMethod = config.AIAuthChatGPT
		cfg.AI.Providers[0].AccountID = a.ID()
		cfg.AI.Providers[0].Models = nil
		cfg.AI.Providers[0].ModelSelection = &config.AIModelSelection{SelectedModels: []string{"gpt-5-mini"}}
		if err := config.Save(path, cfg); err != nil {
			t.Fatal(err)
		}
		response := performServerRequest(srv, "GET", "/_redeven_proxy/api/ai/auth/chatgpt/accounts", envOriginWithChannel("status"), "")
		if !admin {
			if response.Code != 403 {
				t.Fatalf("nonadmin status admitted: %d", response.Code)
			}
			continue
		}
		if response.Code != 200 || !strings.Contains(response.Body.String(), "person@example.com") {
			t.Fatalf("status projection: %d %s", response.Code, response.Body.String())
		}
		for _, secret := range []string{"secret-access", "secret-refresh", "secret-id", "issued-client", "verified-subject", "access_token", "refresh_token", "id_token"} {
			if strings.Contains(response.Body.String(), secret) {
				t.Fatalf("status leaked %s", secret)
			}
		}
	}
}

func TestChatGPTRemovedBindingSignsOutOnlyAfterSuccessfulSave(t *testing.T) {
	for _, scenario := range []string{"shared", "disabled", "remove-last", "remove-all", "api-key", "failed-save"} {
		t.Run(scenario, func(t *testing.T) {
			path := writeTestConfigWithAI(t)
			cfg, err := config.Load(path)
			if err != nil {
				t.Fatal(err)
			}
			svc, err := ai.NewService(ai.Options{StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh", Config: cfg.AI})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = svc.Close() })
			srv, err := New(Options{Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}}, ListenAddr: "127.0.0.1:0", ConfigPath: path, AIServiceProvider: newStaticAIServiceProvider(svc), ResolveSessionMeta: resolveMetaForTest("save", session.Meta{CanRead: true, CanAdmin: true, LocalHostAccess: "verified"})})
			if err != nil {
				t.Fatal(err)
			}
			a := settings.ChatGPTAccount{Issuer: "https://auth.openai.com", Subject: "subject", ClientID: "issued", AccessToken: "saved", Scopes: []string{"resource.invoke", "chatgpt.tokens.use.direct"}, ExpiresAt: time.Now().Add(time.Hour)}
			if err := srv.secrets.UpdateChatGPTAccount(t.Context(), a.ID(), func(p *settings.ChatGPTAccount) error { *p = a; return nil }); err != nil {
				t.Fatal(err)
			}
			old := &config.AIConfig{Providers: []config.AIProvider{{ID: "one", Type: "openai", AuthMethod: config.AIAuthChatGPT, AccountID: a.ID(), ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-5-mini"}}}}}
			cfg.AI = old
			if err := config.Save(path, cfg); err != nil {
				t.Fatal(err)
			}
			next := config.AIModelProfile{}
			switch scenario {
			case "shared":
				old.Providers = append(old.Providers, config.AIProvider{ID: "two", Type: "openai", AuthMethod: config.AIAuthChatGPT, AccountID: a.ID(), ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-5-mini"}}})
				next.Providers = old.Providers[1:]
			case "disabled":
				next.Providers = append([]config.AIProvider(nil), old.Providers...)
				disabled := false
				next.Providers[0].Enabled = &disabled
			case "remove-all":
				next.Providers = []config.AIProvider{}
			case "remove-last":
				next.Providers = []config.AIProvider{{ID: "local", Type: "ollama", BaseURL: "http://127.0.0.1:11434/v1", Models: []config.AIProviderModel{{ModelName: "agent", ContextWindow: 32768}}}}
				next.CurrentModelID = "local/agent"
			case "api-key", "failed-save":
				next.Providers = []config.AIProvider{{ID: "one", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}
				next.CurrentModelID = "one/gpt-5-mini"
			}
			var patches []settings.AIProviderAPIKeyPatch
			if scenario == "api-key" {
				key := "api-key"
				patches = []settings.AIProviderAPIKeyPatch{{ProviderID: "one", APIKey: &key}}
			}
			updated, saveErr := srv.saveAIProviderBundle(svc, next, patches, nil, true)
			if scenario == "failed-save" {
				if saveErr == nil {
					t.Fatal("invalid save accepted")
				}
				stored, _, _ := srv.secrets.ChatGPTAccount(a.ID())
				if stored.AccessToken != "saved" || stored.Lifecycle != "" {
					t.Fatal("failed save signed out old account")
				}
				return
			}
			if saveErr != nil {
				t.Fatal(saveErr)
			}
			results := srv.signOutRemovedAccounts(old, updated.AI)
			stored, _, _ := srv.secrets.ChatGPTAccount(a.ID())
			if scenario == "shared" || scenario == "disabled" {
				if len(results) != 0 || stored.AccessToken != "saved" {
					t.Fatal("remaining binding was signed out")
				}
				return
			}
			if len(results) != 1 || !results[0].LocalCleanupComplete || stored.AccessToken != "" || stored.Lifecycle != "signed_out" || stored.ClientID != "issued" {
				t.Fatalf("final removal did not sign out: %+v", results)
			}
		})
	}
}
