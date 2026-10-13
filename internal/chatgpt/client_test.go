package chatgpt

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/settings"
)

func testClient(t *testing.T) (*Client, *url.URL, func(string, string, string, string) string, *atomic.Int32) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var server *httptest.Server
	var nonce string
	refreshes := &atomic.Int32{}
	sign := func(subject, audience, n, issuer string) string {
		claims, _ := json.Marshal(map[string]any{"iss": issuer, "sub": subject, "aud": audience, "nonce": n, "email": "test@example.com", "exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix()})
		encoded := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","kid":"test"}`)) + "." + base64.RawURLEncoding.EncodeToString(claims)
		hash := sha256.Sum256([]byte(encoded))
		signature, e := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, hash[:])
		if e != nil {
			t.Fatal(e)
		}
		return encoded + "." + base64.RawURLEncoding.EncodeToString(signature)
	}
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			json.NewEncoder(w).Encode(map[string]any{"issuer": server.URL, "jwks_uri": server.URL + "/keys", "authorization_endpoint": server.URL + "/authorize", "token_endpoint": server.URL + "/token", "revocation_endpoint": server.URL + "/revoke", "id_token_signing_alg_values_supported": []string{"RS256"}})
		case "/keys":
			json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]any{"kty": "RSA", "kid": "test", "alg": "RS256", "use": "sig", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": "AQAB"}}})
		case "/token":
			r.ParseForm()
			if r.Form.Get("resource") != Resource {
				t.Error("missing public resource")
			}
			token := map[string]any{"access_token": "access", "refresh_token": "rotated", "token_type": "Bearer", "expires_in": 3600, "scope": Scope}
			if r.Form.Get("grant_type") == "refresh_token" {
				refreshes.Add(1)
				if r.Form.Has("scope") {
					t.Error("refresh must omit scope")
				}
				if r.Form.Get("refresh_token") != "refresh" {
					t.Error("rotating token refreshed twice")
				}
			} else {
				if r.Form.Get("code_verifier") == "" || !strings.HasPrefix(r.Form.Get("redirect_uri"), "http://127.0.0.1:") {
					t.Error("invalid PKCE or redirect binding")
				}
				token["id_token"] = sign("subject", r.Form.Get("client_id"), nonce, server.URL)
			}
			json.NewEncoder(w).Encode(token)
		case "/revoke":
			r.ParseForm()
			if r.Form.Get("client_id") != "issued" {
				t.Error("revocation client binding")
			}
			w.WriteHeader(200)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	client := New(settings.NewSecretsStore(filepath.Join(t.TempDir(), "secrets.json")))
	client.issuer = server.URL
	client.authorizeURL = server.URL + "/authorize"
	client.tokenURL = server.URL + "/token"
	var authorization *url.URL
	client.openBrowser = func(_ context.Context, address string) error {
		authorization, err = url.Parse(address)
		nonce = authorization.Query().Get("nonce")
		return err
	}
	initial, e := client.Start("owner", "", false)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { client.Cancel("owner", initial.ID) })
	return client, authorization, sign, refreshes
}

func finishTestLogin(t *testing.T, c *Client, authorization *url.URL) AttemptStatus {
	t.Helper()
	q := authorization.Query()
	callback, e := url.Parse(q.Get("redirect_uri"))
	if e != nil {
		t.Fatal(e)
	}
	callback.RawQuery = url.Values{"state": {q.Get("state")}, "code": {"code"}, "client_id": {"issued"}}.Encode()
	response, e := http.Get(callback.String())
	if e != nil {
		t.Fatal(e)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("callback status %d", response.StatusCode)
	}
	c.mu.Lock()
	var id string
	for key := range c.attempts {
		id = key
	}
	c.mu.Unlock()
	out, e := c.Poll("owner", id)
	if e != nil {
		t.Fatal(e)
	}
	return out
}
func TestSignInPersistsIndependentlyOfConnectionEditing(t *testing.T) {
	c, address, _, _ := testClient(t)
	q := address.Query()
	if q.Get("client_id") != "dynamic_agent_client" || q.Get("agent_name_hint") != "Redeven" || q.Get("code_challenge_method") != "S256" || q.Get("state") == "" || q.Get("nonce") == "" {
		t.Fatal("missing dynamic registration or nonce")
	}
	ready := finishTestLogin(t, c, address)
	if ready.State != "ready" || ready.Account.State != "ready" {
		t.Fatalf("not verified: %+v", ready)
	}
	if stored, ok, err := c.Store.ChatGPTAccount(ready.Account.AccountID); err != nil || !ok || stored.AccessToken == "" {
		t.Fatalf("verified login not persisted: %v", err)
	}
	if _, err := c.Poll("other", ready.ID); err == nil {
		t.Fatal("cross-owner access")
	}
	c.Cancel("owner", ready.ID)
	if stored, ok, _ := c.Store.ChatGPTAccount(ready.Account.AccountID); !ok || stored.AccessToken == "" {
		t.Fatal("closing the editor removed completed login")
	}
	raw, _ := json.Marshal(ready)
	if strings.Contains(string(raw), "access_token") || strings.Contains(string(raw), "id_token") || strings.Contains(string(raw), "refresh_token") {
		t.Fatal("UI token leak")
	}
}
func TestIdentityValidationFailsClosed(t *testing.T) {
	c, _, sign, _ := testClient(t)
	for _, tc := range []struct{ name, subject, audience, nonce, issuer string }{
		{"nonce", "subject", "issued", "wrong", c.issuer}, {"audience", "subject", "other", "nonce", c.issuer}, {"issuer", "subject", "issued", "nonce", "https://other.invalid"}, {"subject", "", "issued", "nonce", c.issuer},
	} {
		t.Run(tc.name, func(t *testing.T) {
			token := tokenResponse{IDToken: sign(tc.subject, tc.audience, tc.nonce, tc.issuer), AccessToken: "access", RefreshToken: "refresh", Scope: Scope, ExpiresIn: 3600}
			if _, err := c.validate(context.Background(), "issued", "nonce", token, settings.ChatGPTAccount{}); err == nil {
				t.Fatal("invalid identity accepted")
			}
		})
	}
	token := tokenResponse{IDToken: sign("other", "issued", "nonce", c.issuer), AccessToken: "access", RefreshToken: "refresh", Scope: Scope, ExpiresIn: 3600}
	if _, err := c.validate(context.Background(), "issued", "nonce", token, settings.ChatGPTAccount{Issuer: c.issuer, Subject: "subject", ClientID: "issued"}); err == nil {
		t.Fatal("returning identity replaced")
	}
	token.IDToken = sign("subject", "issued", "nonce", c.issuer)
	token.Scope = "openid profile email offline_access resource.invoke"
	account, err := c.validate(context.Background(), "issued", "nonce", token, settings.ChatGPTAccount{})
	if err != nil || account.PlanEnabled() {
		t.Fatal("missing plan permission enabled inference")
	}
}
func TestIdentitySignatureAndExpiryRejected(t *testing.T) {
	c, _, sign, _ := testClient(t)
	valid := sign("subject", "issued", "nonce", c.issuer)
	fragments := strings.Split(valid, ".")
	signature, _ := base64.RawURLEncoding.DecodeString(fragments[2])
	signature[0] ^= 1
	tampered := fragments[0] + "." + fragments[1] + "." + base64.RawURLEncoding.EncodeToString(signature)
	for _, raw := range []string{tampered, valid} {
		if raw == valid {
			p, err := c.oidcProvider(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			c.provider = p
		}
		token := tokenResponse{IDToken: raw, AccessToken: "access", RefreshToken: "refresh", Scope: Scope, ExpiresIn: 3600}
		if raw == valid {
			p := c.provider
			_, err := p.Verifier(&oidc.Config{ClientID: "issued", Now: func() time.Time { return time.Now().Add(2 * time.Hour) }}).Verify(oidc.ClientContext(context.Background(), c.http), raw)
			if err == nil {
				t.Fatal("expired identity accepted")
			}
		} else if _, err := c.validate(context.Background(), "issued", "nonce", token, settings.ChatGPTAccount{}); err == nil {
			t.Fatal("invalid signature accepted")
		}
	}
}

func TestRefreshSerializedAndSignOutRetainsRegistration(t *testing.T) {
	c, _, _, refreshes := testClient(t)
	account := settings.ChatGPTAccount{Issuer: c.issuer, Subject: "subject", ClientID: "issued", AccessToken: "old", RefreshToken: "refresh", Scopes: strings.Fields(Scope), ExpiresAt: time.Now().Add(-time.Minute)}
	if err := c.Store.UpdateChatGPTAccount(context.Background(), account.ID(), func(a *settings.ChatGPTAccount) error { *a = account; return nil }); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Go(func() {
			peer := New(settings.NewSecretsStore(c.Store.Path()))
			peer.tokenURL = c.tokenURL
			peer.issuer = c.issuer
			token, err := peer.AccessToken(context.Background(), account.ID())
			if err != nil || token != "access" {
				t.Errorf("refresh: %s %v", token, err)
			}
		})
	}
	wg.Wait()
	if refreshes.Load() != 1 {
		t.Fatalf("refresh count %d", refreshes.Load())
	}
	confirmed, err := c.SignOut(context.Background(), account.ID())
	if err != nil || !confirmed {
		t.Fatalf("sign out %v %v", confirmed, err)
	}
	stored, ok, err := c.Store.ChatGPTAccount(account.ID())
	if err != nil || !ok || stored.ClientID != "issued" || stored.AccessToken != "" || stored.RefreshToken != "" {
		t.Fatal("signout lost registration or retained tokens")
	}
}
func TestCancelRejectsLateCallback(t *testing.T) {
	c, address, _, _ := testClient(t)
	c.mu.Lock()
	var a *attempt
	for _, item := range c.attempts {
		a = item
	}
	c.mu.Unlock()
	c.Cancel("owner", a.status.ID)
	callback := httptest.NewRequest("GET", a.redirect+"?state="+address.Query().Get("state")+"&code=code&client_id=issued", nil)
	response := httptest.NewRecorder()
	c.callback(context.Background(), a, response, callback)
	if response.Code != 410 {
		t.Fatalf("late callback %d", response.Code)
	}
	if _, ok, _ := c.Store.ChatGPTAccount(a.returning.ID()); ok {
		t.Fatal("late callback stored credentials")
	}
}

func TestDisconnectCancelsSignInWhileCredentialStoreIsBusy(t *testing.T) {
	store := settings.NewSecretsStore(filepath.Join(t.TempDir(), "secrets.json"))
	lock, err := lockfile.Acquire(store.Path() + ".lock")
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Release()
	c := New(store)
	var opened atomic.Int32
	c.openBrowser = func(context.Context, string) error { opened.Add(1); return nil }
	result := make(chan error, 1)
	go func() { _, err := c.Start("verified:channel:dialog", "", false); result <- err }()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		c.mu.Lock()
		owned := len(c.attempts) == 1
		c.mu.Unlock()
		if owned {
			break
		}
		time.Sleep(time.Millisecond)
	}
	c.CancelChannel("channel")
	if err := lock.Release(); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err == nil || opened.Load() != 0 {
		t.Fatalf("disconnected preparation opened browser: error=%v opened=%d", err, opened.Load())
	}
}

func TestSavedAccountReconsentUsesIssuedRegistration(t *testing.T) {
	c, address, _, _ := testClient(t)
	ready := finishTestLogin(t, c, address)
	var nextURL *url.URL
	c.openBrowser = func(_ context.Context, address string) error {
		var err error
		nextURL, err = url.Parse(address)
		return err
	}
	next, err := c.Start("owner", ready.Account.AccountID, true)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Cancel("owner", next.ID) })
	if nextURL.Query().Get("client_id") != "issued" || nextURL.Query().Get("prompt") != "consent" || nextURL.Query().Get("state") == address.Query().Get("state") {
		t.Fatal("reconsent registered another client or reused state")
	}
	if _, ok, _ := c.Store.ChatGPTAccount(ready.Account.AccountID); !ok {
		t.Fatal("reconsent lost saved registration")
	}
	if _, err := c.Poll("owner", ready.ID); err == nil {
		t.Fatal("superseded draft remains active")
	}
}

func TestRefreshAcrossProcesses(t *testing.T) {
	if os.Getenv("REDEVEN_CHATGPT_REFRESH_CHILD") == "1" {
		c := New(settings.NewSecretsStore(os.Getenv("REDEVEN_CHATGPT_TEST_STORE")))
		c.tokenURL = os.Getenv("REDEVEN_CHATGPT_TEST_TOKEN_URL")
		token, err := c.AccessToken(context.Background(), os.Getenv("REDEVEN_CHATGPT_TEST_ACCOUNT"))
		if err != nil || token != "access" {
			t.Fatalf("child refresh failed: %v", err)
		}
		return
	}
	c, _, _, refreshes := testClient(t)
	account := settings.ChatGPTAccount{Issuer: c.issuer, Subject: "subject", ClientID: "issued", AccessToken: "old", RefreshToken: "refresh", Scopes: strings.Fields(Scope), ExpiresAt: time.Now().Add(-time.Minute)}
	if err := c.Store.UpdateChatGPTAccount(context.Background(), account.ID(), func(a *settings.ChatGPTAccount) error { *a = account; return nil }); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			cmd := exec.Command(os.Args[0], "-test.run=^TestRefreshAcrossProcesses$")
			cmd.Env = append(os.Environ(), "REDEVEN_CHATGPT_REFRESH_CHILD=1", "REDEVEN_CHATGPT_TEST_STORE="+c.Store.Path(), "REDEVEN_CHATGPT_TEST_TOKEN_URL="+c.tokenURL, "REDEVEN_CHATGPT_TEST_ACCOUNT="+account.ID())
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Errorf("child: %v %s", err, output)
			}
		})
	}
	wg.Wait()
	if refreshes.Load() != 1 {
		t.Fatalf("cross-process refresh count %d", refreshes.Load())
	}
	stored, ok, err := settings.NewSecretsStore(c.Store.Path()).ChatGPTAccount(account.ID())
	if err != nil || !ok || stored.RefreshToken != "rotated" {
		t.Fatal("restart lost rotating token")
	}
}

func TestRefreshFailureAndEarliestRefresh(t *testing.T) {
	for _, code := range []string{"invalid_grant", "temporarily_unavailable", "earliest_refresh_at"} {
		t.Run(code, func(t *testing.T) {
			c, _, _, _ := testClient(t)
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				requests.Add(1)
				w.WriteHeader(400)
				json.NewEncoder(w).Encode(map[string]string{"error": code})
			}))
			defer server.Close()
			c.tokenURL = server.URL
			account := settings.ChatGPTAccount{Issuer: c.issuer, Subject: "subject", ClientID: "issued", AccessToken: "old", RefreshToken: "refresh", Scopes: strings.Fields(Scope), ExpiresAt: time.Now().Add(-time.Minute)}
			if code == "earliest_refresh_at" {
				account.EarliestRefreshAt = time.Now().Add(time.Hour)
			}
			if err := c.Store.UpdateChatGPTAccount(context.Background(), account.ID(), func(a *settings.ChatGPTAccount) error { *a = account; return nil }); err != nil {
				t.Fatal(err)
			}
			if _, err := c.AccessToken(context.Background(), account.ID()); err == nil {
				t.Fatal("refresh failure ignored")
			}
			stored, _, err := c.Store.ChatGPTAccount(account.ID())
			if err != nil {
				t.Fatal(err)
			}
			if stored.ClientID != "issued" {
				t.Fatal("registration lost")
			}
			if code == "invalid_grant" {
				if stored.AccessToken != "" || stored.RefreshToken != "" {
					t.Fatal("terminal failure retained credentials")
				}
			} else if stored.AccessToken != "old" || stored.RefreshToken != "refresh" {
				t.Fatal("transient failure deleted credentials")
			}
			if code == "earliest_refresh_at" && requests.Load() != 0 {
				t.Fatal("refreshed before allowed time")
			}
		})
	}
}
