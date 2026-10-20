package appserver

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/floegence/redeven/internal/chatgpt"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/settings"
)

func TestSavedRegistrationSelectableAfterFinalConnectionRemoval(t *testing.T) {
	path := writeTestConfigWithAI(t)
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	srv, err := New(Options{
		Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}},
		ListenAddr: "127.0.0.1:0", ConfigPath: path,
		ResolveSessionMeta: resolveMetaForTest("audit", session.Meta{CanRead: true, CanAdmin: true, LocalHostAccess: "verified"}),
	})
	if err != nil {
		t.Fatal(err)
	}
	a := settings.ChatGPTAccount{
		Issuer: "https://auth.openai.com", Subject: "subject", Email: "audit@example.com", ClientID: "issued",
		AccessToken: "saved", Scopes: []string{"resource.invoke", "chatgpt.tokens.use.direct"}, ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := srv.secrets.UpdateChatGPTAccount(t.Context(), a.ID(), func(p *settings.ChatGPTAccount) error { *p = a; return nil }); err != nil {
		t.Fatal(err)
	}
	previous := &config.AIConfig{Providers: []config.AIProvider{{ID: "previous", Type: "openai", AuthMethod: config.AIAuthChatGPT, AccountID: a.ID()}}}
	results := srv.signOutRemovedAccounts(previous, cfg.AI)
	if len(results) != 1 || !results[0].LocalCleanupComplete || !results[0].RevocationConfirmed {
		t.Fatalf("unexpected removal result: %+v", results)
	}
	stored, exists, err := srv.secrets.ChatGPTAccount(a.ID())
	if err != nil || !exists || stored.ClientID != "issued" {
		t.Fatal("setup did not preserve registration")
	}
	response := performServerRequest(srv, http.MethodGet, "/_redeven_proxy/api/ai/auth/chatgpt/accounts", envOriginWithChannel("audit"), "")
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected response: %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), a.ID()) {
		t.Fatalf("retained registration is unavailable to the account picker after final connection removal: %s", response.Body.String())
	}
}

func TestRemoveSignedOutRegistrationRequiresLocalAccessAndPreservesBindings(t *testing.T) {
	for _, local := range []bool{true, false} {
		meta := session.Meta{CanRead: true, CanAdmin: true}
		if local {
			meta.LocalHostAccess = "verified"
		}
		path := writeTestConfigWithAI(t)
		srv, err := New(Options{Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}}, ListenAddr: "127.0.0.1:0", ConfigPath: path, ResolveSessionMeta: resolveMetaForTest("remove", meta)})
		if err != nil {
			t.Fatal(err)
		}
		account := settings.ChatGPTAccount{Issuer: "https://auth.openai.com", Subject: "subject", ClientID: "issued", Email: "person@example.com", AccessToken: "secret"}
		if err := srv.secrets.UpdateChatGPTAccount(t.Context(), account.ID(), func(p *settings.ChatGPTAccount) error { *p = account; return nil }); err != nil {
			t.Fatal(err)
		}
		remove := func() int {
			return performServerRequest(srv, http.MethodPost, "/_redeven_proxy/api/ai/auth/chatgpt/remove", envOriginWithChannel("remove"), `{"scope_id":"dialog","account_id":"`+account.ID()+`"}`).Code
		}
		if code := remove(); local && code != http.StatusBadRequest || !local && code != http.StatusForbidden {
			t.Fatalf("unexpected unsafe removal status: %d", code)
		}
		if err := srv.secrets.UpdateChatGPTAccount(t.Context(), account.ID(), func(p *settings.ChatGPTAccount) error { p.AccessToken = ""; p.Lifecycle = "signed_out"; return nil }); err != nil {
			t.Fatal(err)
		}
		_, err = config.Update(path, func(cfg *config.Config) error {
			cfg.AI.Providers = append(cfg.AI.Providers, config.AIProvider{ID: "bound-account", Type: "openai", AuthMethod: config.AIAuthChatGPT, AccountID: account.ID(), ModelSelection: &config.AIModelSelection{SelectedModels: []string{}}})
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if code := remove(); local && code != http.StatusOK || !local && code != http.StatusForbidden {
			t.Fatalf("unexpected removal status: %d", code)
		}
		_, exists, err := srv.secrets.ChatGPTAccount(account.ID())
		if err != nil || exists == local {
			t.Fatalf("wrong registration existence: %v, %v", exists, err)
		}
		cfg, err := config.Load(path)
		if err != nil || cfg.AI.Providers[len(cfg.AI.Providers)-1].AccountID != account.ID() {
			t.Fatal("removal changed provider configuration")
		}
	}
}

func TestSavedUnboundAccountsHaveDistinctIdentityAndLocalManagement(t *testing.T) {
	for _, local := range []bool{true, false} {
		t.Run(map[bool]string{true: "local", false: "remote"}[local], func(t *testing.T) {
			meta := session.Meta{CanRead: true, CanAdmin: true}
			if local {
				meta.LocalHostAccess = "verified"
			}
			srv, err := New(Options{Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("env")}}, ListenAddr: "127.0.0.1:0", ConfigPath: writeTestConfigWithAI(t), ResolveSessionMeta: resolveMetaForTest("registry", meta)})
			if err != nil {
				t.Fatal(err)
			}
			a := settings.ChatGPTAccount{Issuer: "https://auth.openai.com", Subject: "same-subject", Email: "same@example.com", ClientID: "first-registration", AccessToken: "private-access", IDToken: "private-id", Scopes: []string{"openid"}, ExpiresAt: time.Now().Add(time.Hour)}
			b := a
			b.ClientID = "second-registration"
			for _, account := range []settings.ChatGPTAccount{a, b} {
				if err := srv.secrets.UpdateChatGPTAccount(t.Context(), account.ID(), func(p *settings.ChatGPTAccount) error { *p = account; return nil }); err != nil {
					t.Fatal(err)
				}
			}
			response := performServerRequest(srv, http.MethodGet, "/_redeven_proxy/api/ai/auth/chatgpt/accounts", envOriginWithChannel("registry"), "")
			if !local {
				if response.Code != http.StatusForbidden || strings.Contains(response.Body.String(), a.Email) {
					t.Fatal("remote account read admitted")
				}
			} else {
				var body struct {
					Data struct {
						Saved []chatgpt.AccountStatus `json:"saved_accounts"`
					} `json:"data"`
				}
				if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &body) != nil || len(body.Data.Saved) != 2 {
					t.Fatalf("missing registrations: %s", response.Body.String())
				}
				if body.Data.Saved[0].AccountID == body.Data.Saved[1].AccountID || body.Data.Saved[0].State != "plan_permission_required" {
					t.Fatal("registrations merged or plan permission fabricated")
				}
				for _, secret := range []string{a.AccessToken, a.IDToken, a.ClientID, b.ClientID} {
					if strings.Contains(response.Body.String(), secret) {
						t.Fatal("account projection leaked credentials")
					}
				}
				for _, input := range []struct{ body, code string }{
					{`{"scope_id":"unselected"}`, "account_selection_required"},
					{`{"scope_id":"ambiguous","new_registration":true,"account_id":"` + a.ID() + `"}`, "invalid_authorization_request"},
				} {
					start := performServerRequest(srv, http.MethodPost, "/_redeven_proxy/api/ai/auth/chatgpt/start", envOriginWithChannel("registry"), input.body)
					if start.Code != http.StatusBadRequest || !strings.Contains(start.Body.String(), `"error_code":"`+input.code+`"`) {
						t.Fatalf("registration intent was not enforced: %s", start.Body.String())
					}
				}
			}
			response = performServerRequest(srv, http.MethodPost, "/_redeven_proxy/api/ai/auth/chatgpt/sign-out", envOriginWithChannel("registry"), `{"scope_id":"dialog","account_id":"`+a.ID()+`"}`)
			stored, _, _ := srv.secrets.ChatGPTAccount(a.ID())
			if local {
				if response.Code != http.StatusOK || stored.Lifecycle != "signed_out" || stored.ClientID != a.ClientID || stored.AccessToken != "" {
					t.Fatalf("unbound signout failed: %s", response.Body.String())
				}
			} else if response.Code != http.StatusForbidden || stored.AccessToken != a.AccessToken {
				t.Fatal("remote signout mutated local account")
			}
		})
	}
}
