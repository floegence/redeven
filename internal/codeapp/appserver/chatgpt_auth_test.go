package appserver

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/settings"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"
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
			if location == "local" {
				return
			}
			before, _ := os.ReadFile(path)
			for _, action := range []string{"start", "status", "cancel", "sign-out", "acknowledge"} {
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
