// Package chatgpt owns Redeven's local ChatGPT registrations and ephemeral OAuth
// attempts. It implements the documented public OSS flow, never Codex credentials.
package chatgpt

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/floegence/redeven/internal/settings"
)

const (
	Issuer     = "https://auth.openai.com"
	Resource   = "https://api.openai.com/v1"
	UsageURL   = "https://chatgpt.com/settings/usage"
	Scope      = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
	attemptTTL = 5 * time.Minute
)

type Error struct {
	Code   string
	Action string
}

func (e *Error) Error() string { return "ChatGPT: " + e.Code }
func Failure(code string) *Error {
	action := "retry"
	switch code {
	case "subscription_sharing_usage_limit_exceeded":
		action = "manage_usage"
	case "subscription_sharing_user_not_eligible", "subscription_sharing_unsupported_capability", "subscription_sharing_route_not_supported", "chatpass_v2_scope_not_authorized", "chatpass_v2_invalid_authorization_context":
		action = "review_connection"
	case "authorization_required", "plan_permission_required", "invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_invalid", "refresh_token_reused", "subscription_sharing_invalid_user":
		action = "sign_in"
	}
	return &Error{Code: code, Action: action}
}

type AccountStatus struct {
	AccountID           string `json:"account_id"`
	Email               string `json:"email"`
	State               string `json:"state"`
	WelcomeAcknowledged bool   `json:"welcome_acknowledged"`
}

func status(a settings.ChatGPTAccount) AccountStatus {
	state := "authorization_required"
	if a.AccessToken != "" {
		state = "plan_permission_required"
		if a.PlanEnabled() {
			state = "ready"
		}
	}
	return AccountStatus{a.ID(), a.Email, state, a.WelcomeAcknowledged}
}

type AttemptStatus struct {
	ID        string         `json:"id"`
	State     string         `json:"state"`
	Account   *AccountStatus `json:"account,omitempty"`
	ErrorCode string         `json:"error_code,omitempty"`
}

type attempt struct {
	owner                                      string
	status                                     AttemptStatus
	state, nonce, verifier, redirect, clientID string
	returning                                  settings.ChatGPTAccount
	account                                    settings.ChatGPTAccount
	expires                                    time.Time
	cancel                                     context.CancelFunc
	listener                                   net.Listener
}

type Client struct {
	Store                                    *settings.SecretsStore
	http                                     *http.Client
	issuer, authorizeURL, tokenURL, resource string
	openBrowser                              func(context.Context, string) error
	mu                                       sync.Mutex
	attempts                                 map[string]*attempt
	providerMu                               sync.Mutex
	provider                                 *oidc.Provider
}

func New(store *settings.SecretsStore) *Client {
	return &Client{Store: store, http: &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, issuer: Issuer, resource: Resource, authorizeURL: Issuer + "/api/accounts/authorize", tokenURL: Issuer + "/api/accounts/oauth/token", openBrowser: openBrowser, attempts: map[string]*attempt{}}
}
func random() (string, error) {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b), err
}
func (c *Client) Start(owner, accountID string, reconsent bool) (AttemptStatus, error) {
	return c.start(owner, accountID, reconsent, nil)
}

// A declined grant may be re-consented using its issued registration while the
// account remains a draft. It never falls back to registering a new client.
func (c *Client) StartWithDraft(owner, accountID string, reconsent bool, previousAttemptID string) (AttemptStatus, error) {
	if previousAttemptID == "" {
		return c.Start(owner, accountID, reconsent)
	}
	c.mu.Lock()
	a := c.attempts[previousAttemptID]
	if a == nil || a.owner != owner || a.status.State != "ready" || time.Now().After(a.expires) || a.account.ID() != accountID {
		c.mu.Unlock()
		return AttemptStatus{}, Failure("attempt_expired")
	}
	registration := a.account
	c.mu.Unlock()
	return c.start(owner, accountID, reconsent, &registration)
}
func (c *Client) start(owner, accountID string, reconsent bool, draft *settings.ChatGPTAccount) (AttemptStatus, error) {
	if owner == "" {
		return AttemptStatus{}, errors.New("missing local access owner")
	}
	ctx, cancel := context.WithTimeout(context.Background(), attemptTTL)
	var err error
	a := &attempt{owner: owner, expires: time.Now().Add(attemptTTL), cancel: cancel, clientID: "dynamic_agent_client"}
	for _, dest := range []*string{&a.state, &a.nonce, &a.verifier, &a.status.ID} {
		*dest, err = random()
		if err != nil {
			cancel()
			return AttemptStatus{}, err
		}
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		cancel()
		return AttemptStatus{}, err
	}
	a.listener = ln
	a.redirect = "http://" + ln.Addr().String() + "/auth/callback"
	a.status.State = "preparing"
	c.mu.Lock()
	for id, pending := range c.attempts {
		if time.Now().After(pending.expires) || pending.owner == owner {
			pending.cancel()
			_ = pending.listener.Close()
			delete(c.attempts, id)
		}
	}
	if len(c.attempts) >= 16 {
		c.mu.Unlock()
		cancel()
		ln.Close()
		return AttemptStatus{}, errors.New("too many sign-in attempts")
	}
	c.attempts[a.status.ID] = a
	c.mu.Unlock()
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second, MaxHeaderBytes: 16 << 10, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { c.callback(ctx, a, w, r) })}
	go func() { _ = server.Serve(ln) }()
	go func() {
		<-ctx.Done()
		_ = server.Close()
		c.mu.Lock()
		if c.attempts[a.status.ID] == a {
			delete(c.attempts, a.status.ID)
		}
		c.mu.Unlock()
	}()
	// Publish ownership before credential reads can block, so channel loss also
	// cancels preparation rather than allowing a late browser launch.
	prepared := false
	defer func() {
		if !prepared {
			c.Cancel(owner, a.status.ID)
		}
	}()
	host, err := c.Store.ChatGPTHostID(ctx)
	if err != nil {
		return AttemptStatus{}, err
	}
	if accountID != "" {
		old, ok, err := c.Store.ChatGPTAccount(accountID)
		if draft != nil {
			old = *draft
			ok = true
			err = nil
		}
		if err != nil || !ok {
			cancel()
			return AttemptStatus{}, Failure("authorization_required")
		}
		a.returning = old
		a.clientID = old.ClientID
	}
	c.mu.Lock()
	active := c.attempts[a.status.ID] == a && ctx.Err() == nil
	if active {
		a.status.State = "waiting"
	}
	c.mu.Unlock()
	if !active {
		return AttemptStatus{}, Failure("authorization_cancelled")
	}
	challenge := sha256.Sum256([]byte(a.verifier))
	q := url.Values{"client_id": {a.clientID}, "ext_agent_host_id": {host}, "response_type": {"code"}, "redirect_uri": {a.redirect}, "scope": {Scope}, "resource": {Resource}, "state": {a.state}, "nonce": {a.nonce}, "code_challenge_method": {"S256"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(challenge[:])}}
	if a.clientID == "dynamic_agent_client" {
		q.Set("agent_name_hint", "Redeven")
	} else {
		if a.returning.IDToken != "" {
			q.Set("id_token_hint", a.returning.IDToken)
		}
		if a.returning.Email != "" {
			q.Set("login_hint", a.returning.Email)
		}
	}
	if reconsent {
		q.Set("prompt", "consent")
	}
	// Authorization URLs can contain an ID-token hint. Never return or log them.
	if err := c.openBrowser(ctx, c.authorizeURL+"?"+q.Encode()); err != nil {
		c.Cancel(owner, a.status.ID)
		return AttemptStatus{}, errors.New("could not open the system browser")
	}
	prepared = true
	return c.Poll(owner, a.status.ID)
}
func (c *Client) callback(ctx context.Context, a *attempt, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	if r.Method != http.MethodGet || r.URL.Path != "/auth/callback" || r.Host != strings.TrimPrefix(a.redirect, "http://")[:len(strings.TrimPrefix(a.redirect, "http://"))-len("/auth/callback")] {
		http.Error(w, "Invalid callback.", 400)
		return
	}
	q := r.URL.Query()
	for _, key := range []string{"code", "client_id", "error"} {
		if len(q[key]) > 1 {
			http.Error(w, "Ambiguous callback.", 400)
			return
		}
	}
	if len(q["state"]) != 1 || subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(a.state)) != 1 {
		http.Error(w, "Invalid authorization state.", 400)
		return
	}
	c.mu.Lock()
	active := c.attempts[a.status.ID] == a && a.status.State == "waiting" && ctx.Err() == nil
	if active {
		a.status.State = "verifying"
	}
	c.mu.Unlock()
	if !active {
		http.Error(w, "This sign-in attempt has ended.", 410)
		return
	}
	var account settings.ChatGPTAccount
	var err error
	switch {
	case q.Get("error") != "":
		err = Failure("authorization_cancelled")
	case len(q["code"]) != 1 || q.Get("code") == "":
		err = Failure("incomplete_registration")
	default:
		clientID := q.Get("client_id")
		if a.clientID == "dynamic_agent_client" {
			if len(q["client_id"]) != 1 || clientID == "" || clientID == "dynamic_agent_client" {
				err = Failure("incomplete_registration")
			}
		} else {
			if clientID != "" && clientID != a.clientID {
				err = Failure("account_mismatch")
			}
			clientID = a.clientID
		}
		if err == nil {
			token, e := c.exchange(ctx, url.Values{"grant_type": {"authorization_code"}, "client_id": {clientID}, "code": {q.Get("code")}, "code_verifier": {a.verifier}, "redirect_uri": {a.redirect}, "resource": {Resource}})
			if e != nil {
				err = e
			} else {
				account, err = c.validate(ctx, clientID, a.nonce, token, a.returning)
			}
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.attempts[a.status.ID] != a || ctx.Err() != nil {
		http.Error(w, "This sign-in attempt has ended.", 410)
		return
	}
	if err != nil {
		a.status.State = "failed"
		a.status.ErrorCode = "identity_validation_failed"
		var failure *Error
		if errors.As(err, &failure) {
			a.status.ErrorCode = failure.Code
		}
		http.Error(w, "Sign-in did not complete. Return to Redeven to try again.", 400)
	} else {
		a.account = account
		s := status(account)
		a.status.Account = &s
		a.status.State = "ready"
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, `<!doctype html><html><meta name="viewport" content="width=device-width"><title>Redeven</title><style>body{font:16px system-ui;margin:12vh auto;padding:24px;max-width:480px;color:#242424;background:#fafafa}h1{font-size:26px}p{line-height:1.6;color:#666}@media(prefers-color-scheme:dark){body{background:#141414;color:#eee}p{color:#aaa}}</style><h1>Continue in Redeven</h1><p>Your account has been verified. Return to the provider settings to review and save your connection. You can close this tab.</p></html>`)
	}
	// Stop accepting callbacks, but retain the verified draft until Save or cancel.
	_ = a.listener.Close()
}
func (c *Client) Poll(owner, id string) (AttemptStatus, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	a := c.attempts[id]
	if a == nil || a.owner != owner || time.Now().After(a.expires) {
		return AttemptStatus{}, Failure("attempt_expired")
	}
	out := a.status
	if out.Account != nil {
		clone := *out.Account
		out.Account = &clone
	}
	return out, nil
}
func (c *Client) Cancel(owner, id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if a := c.attempts[id]; a != nil && a.owner == owner {
		delete(c.attempts, id)
		a.cancel()
		_ = a.listener.Close()
	}
}
func (c *Client) UseAttempt(owner, id, accountID string, apply func(settings.ChatGPTAccount) error) error {
	return c.UseAttempts([]Binding{{Owner: owner, AttemptID: id, AccountID: accountID}}, func(accounts []settings.ChatGPTAccount) error { return apply(accounts[0]) })
}

type Binding struct{ Owner, AttemptID, AccountID string }

// UseAttempts consumes verified drafts only after the whole configuration save
// succeeds. A failed save leaves the same owner able to retry without signing in.
func (c *Client) UseAttempts(bindings []Binding, apply func([]settings.ChatGPTAccount) error) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	accounts := make([]settings.ChatGPTAccount, 0, len(bindings))
	seen := map[string]bool{}
	for _, binding := range bindings {
		a := c.attempts[binding.AttemptID]
		if a == nil || seen[binding.AttemptID] || a.owner != binding.Owner || a.status.State != "ready" || time.Now().After(a.expires) || a.account.ID() != binding.AccountID {
			return Failure("attempt_expired")
		}
		seen[binding.AttemptID] = true
		accounts = append(accounts, a.account)
	}
	if err := apply(accounts); err != nil {
		return err
	}
	for _, binding := range bindings {
		a := c.attempts[binding.AttemptID]
		delete(c.attempts, binding.AttemptID)
		a.cancel()
		_ = a.listener.Close()
	}
	return nil
}
func (c *Client) Status(id string) (AccountStatus, error) {
	a, ok, err := c.Store.ChatGPTAccount(id)
	if err != nil {
		return AccountStatus{}, err
	}
	if !ok {
		return AccountStatus{AccountID: id, State: "authorization_required"}, nil
	}
	return status(a), nil
}
func (c *Client) Acknowledge(ctx context.Context, id string) error {
	return c.Store.UpdateChatGPTAccount(ctx, id, func(a *settings.ChatGPTAccount) error { a.WelcomeAcknowledged = true; return nil })
}

type tokenResponse struct {
	AccessToken       string `json:"access_token"`
	RefreshToken      string `json:"refresh_token"`
	IDToken           string `json:"id_token"`
	TokenType         string `json:"token_type"`
	ExpiresIn         int64  `json:"expires_in"`
	Scope             string `json:"scope"`
	EarliestRefreshAt int64  `json:"earliest_refresh_at"`
}

func (c *Client) exchange(ctx context.Context, form url.Values) (tokenResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return tokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := c.http.Do(req)
	if err != nil {
		return tokenResponse{}, Failure("temporarily_unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		var out struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&out)
		if response.StatusCode >= 500 {
			return tokenResponse{}, Failure("temporarily_unavailable")
		}
		if out.Error == "" {
			out.Error = "authorization_failed"
		}
		return tokenResponse{}, Failure(out.Error)
	}
	var token tokenResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 128<<10)).Decode(&token); err != nil {
		return tokenResponse{}, Failure("invalid_token_response")
	}
	if token.AccessToken == "" || token.ExpiresIn <= 0 || !strings.EqualFold(token.TokenType, "Bearer") {
		return tokenResponse{}, Failure("invalid_token_response")
	}
	return token, nil
}
func (c *Client) oidcProvider(ctx context.Context) (*oidc.Provider, error) {
	c.providerMu.Lock()
	defer c.providerMu.Unlock()
	if c.provider != nil {
		return c.provider, nil
	}
	p, err := oidc.NewProvider(oidc.ClientContext(ctx, c.http), c.issuer)
	if err == nil {
		c.provider = p
	}
	return p, err
}
func (c *Client) validate(ctx context.Context, clientID, nonce string, t tokenResponse, old settings.ChatGPTAccount) (settings.ChatGPTAccount, error) {
	if t.IDToken == "" {
		return settings.ChatGPTAccount{}, Failure("identity_validation_failed")
	}
	p, err := c.oidcProvider(ctx)
	if err != nil {
		return settings.ChatGPTAccount{}, Failure("identity_validation_failed")
	}
	token, err := p.Verifier(&oidc.Config{ClientID: clientID}).Verify(oidc.ClientContext(ctx, c.http), t.IDToken)
	if err != nil || token.Subject == "" || nonce != "" && subtle.ConstantTimeCompare([]byte(token.Nonce), []byte(nonce)) != 1 {
		return settings.ChatGPTAccount{}, Failure("identity_validation_failed")
	}
	if old.Subject != "" && (old.Subject != token.Subject || old.Issuer != token.Issuer || old.ClientID != clientID) {
		return settings.ChatGPTAccount{}, Failure("account_mismatch")
	}
	var claims struct {
		Email string `json:"email"`
	}
	if err := token.Claims(&claims); err != nil {
		return settings.ChatGPTAccount{}, Failure("identity_validation_failed")
	}
	if slices.Contains(strings.Fields(t.Scope), "offline_access") && t.RefreshToken == "" {
		return settings.ChatGPTAccount{}, Failure("invalid_token_response")
	}
	return settings.ChatGPTAccount{Issuer: token.Issuer, Subject: token.Subject, Email: claims.Email, ClientID: clientID, IDToken: t.IDToken, AccessToken: t.AccessToken, RefreshToken: t.RefreshToken, Scopes: strings.Fields(t.Scope), ExpiresAt: time.Now().Add(time.Duration(t.ExpiresIn) * time.Second), EarliestRefreshAt: time.Unix(t.EarliestRefreshAt, 0), WelcomeAcknowledged: old.WelcomeAcknowledged}, nil
}
func unusable(code string) bool {
	return slices.Contains([]string{"invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_invalid", "refresh_token_reused"}, code)
}
func clearTokens(a *settings.ChatGPTAccount) {
	a.AccessToken = ""
	a.RefreshToken = ""
	a.IDToken = ""
	a.Scopes = nil
	a.ExpiresAt = time.Time{}
	a.EarliestRefreshAt = time.Time{}
}
func (c *Client) AccessToken(ctx context.Context, id string) (string, error) {
	var bearer string
	var terminal error
	err := c.Store.UpdateChatGPTAccount(ctx, id, func(a *settings.ChatGPTAccount) error {
		if a.AccessToken == "" {
			return Failure("authorization_required")
		}
		if !a.PlanEnabled() {
			return Failure("plan_permission_required")
		}
		if time.Until(a.ExpiresAt) > 2*time.Minute {
			bearer = a.AccessToken
			return nil
		}
		if a.RefreshToken == "" {
			return Failure("authorization_required")
		}
		if time.Now().Before(a.EarliestRefreshAt) {
			if time.Now().Before(a.ExpiresAt) {
				bearer = a.AccessToken
				return nil
			}
			return Failure("temporarily_unavailable")
		}
		t, err := c.exchange(ctx, url.Values{"grant_type": {"refresh_token"}, "client_id": {a.ClientID}, "refresh_token": {a.RefreshToken}, "resource": {Resource}})
		if err != nil {
			var e *Error
			if errors.As(err, &e) && unusable(e.Code) {
				clearTokens(a)
				terminal = e
				return nil
			}
			return err
		}
		if t.RefreshToken == "" {
			return Failure("invalid_token_response")
		}
		next := *a
		if t.IDToken != "" {
			next, err = c.validate(ctx, a.ClientID, "", t, *a)
			if err != nil {
				return err
			}
		} else {
			next.AccessToken = t.AccessToken
			next.RefreshToken = t.RefreshToken
			next.Scopes = strings.Fields(t.Scope)
			next.ExpiresAt = time.Now().Add(time.Duration(t.ExpiresIn) * time.Second)
			next.EarliestRefreshAt = time.Unix(t.EarliestRefreshAt, 0)
		}
		*a = next
		if !a.PlanEnabled() {
			terminal = Failure("plan_permission_required")
			return nil
		}
		bearer = a.AccessToken
		return nil
	})
	if err != nil {
		return "", err
	}
	if terminal != nil {
		return "", terminal
	}
	return bearer, nil
}
func (c *Client) SignOut(ctx context.Context, id string) (bool, error) {
	confirmed := false
	err := c.Store.UpdateChatGPTAccount(ctx, id, func(a *settings.ChatGPTAccount) error {
		if a.RefreshToken == "" {
			confirmed = true
		} else if p, err := c.oidcProvider(ctx); err == nil {
			var metadata struct {
				RevocationEndpoint string `json:"revocation_endpoint"`
			}
			if p.Claims(&metadata) == nil && strings.HasPrefix(metadata.RevocationEndpoint, c.issuer+"/") {
				form := url.Values{"token": {a.RefreshToken}, "token_type_hint": {"refresh_token"}, "client_id": {a.ClientID}}
				req, err := http.NewRequestWithContext(ctx, http.MethodPost, metadata.RevocationEndpoint, strings.NewReader(form.Encode()))
				if err == nil {
					req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
					if response, err := c.http.Do(req); err == nil {
						confirmed = response.StatusCode == 200
						response.Body.Close()
					}
				}
			}
		}
		clearTokens(a)
		return nil
	})
	return confirmed, err
}
func openBrowser(ctx context.Context, address string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.CommandContext(ctx, "open", address)
	case "windows":
		cmd = exec.CommandContext(ctx, "rundll32", "url.dll,FileProtocolHandler", address)
	default:
		cmd = exec.CommandContext(ctx, "xdg-open", address)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

// RequestError retains protocol evidence without returning credentials or an
// untrusted upstream error message as executable product guidance.
type RequestError struct {
	Status          int
	Code, RequestID string
	Body            json.RawMessage
}

func (e *RequestError) Error() string {
	if Failure(e.Code).Action == "retry" {
		switch e.Status {
		case http.StatusUnauthorized:
			return Failure("authorization_required").Error()
		case http.StatusForbidden:
			return Failure("plan_permission_required").Error()
		}
	}
	return "ChatGPT: " + e.Code
}

type Model struct {
	Slug        string `json:"slug"`
	DisplayName string `json:"display_name"`
	Visibility  string `json:"visibility"`
}

func (c *Client) Models(ctx context.Context, accountID string) ([]Model, error) {
	bearer, err := c.AccessToken(ctx, accountID)
	if err != nil {
		return nil, err
	}
	return c.models(ctx, bearer)
}
func (c *Client) AttemptModels(ctx context.Context, owner, id string) ([]Model, error) {
	c.mu.Lock()
	a := c.attempts[id]
	if a == nil || a.owner != owner || a.status.State != "ready" || time.Now().After(a.expires) {
		c.mu.Unlock()
		return nil, Failure("attempt_expired")
	}
	account := a.account
	c.mu.Unlock()
	if !account.PlanEnabled() {
		return nil, Failure("plan_permission_required")
	}
	return c.models(ctx, account.AccessToken)
}
func (c *Client) models(ctx context.Context, bearer string) ([]Model, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.resource+"/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	response, err := c.http.Do(req)
	if err != nil {
		return nil, Failure("temporarily_unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
		var body struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &body)
		return nil, &RequestError{Status: response.StatusCode, Code: body.Error.Code, RequestID: response.Header.Get("x-request-id"), Body: raw}
	}
	var body struct {
		Models []Model `json:"models"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&body); err != nil {
		return nil, Failure("invalid_model_catalog")
	}
	if body.Models == nil {
		return nil, Failure("invalid_model_catalog")
	}
	out := make([]Model, 0, len(body.Models))
	seen := map[string]bool{}
	for _, m := range body.Models {
		if m.Visibility == "list" && m.Slug != "" && !seen[m.Slug] {
			out = append(out, m)
			seen[m.Slug] = true
		}
	}
	return out, nil
}

// CancelChannel ends short-lived attempts when their admitted connection closes.
func (c *Client) CancelChannel(channelID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for id, a := range c.attempts {
		owner := strings.SplitN(a.owner, ":", 3)
		if len(owner) == 3 && owner[1] == channelID {
			delete(c.attempts, id)
			a.cancel()
			_ = a.listener.Close()
		}
	}
}
