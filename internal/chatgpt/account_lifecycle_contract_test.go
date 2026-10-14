package chatgpt

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/settings"
)

func TestIssuedClientSurvivesCodeExchangeFailure(t *testing.T) {
	c, address, _, _ := testClient(t)
	failureServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
	}))
	defer failureServer.Close()
	c.tokenURL = failureServer.URL
	callback, _ := url.Parse(address.Query().Get("redirect_uri"))
	callback.RawQuery = url.Values{"state": {address.Query().Get("state")}, "code": {"expired-code"}, "client_id": {"issued"}}.Encode()
	response, err := http.Get(callback.String())
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("unexpected callback status: %d", response.StatusCode)
	}
	c.mu.Lock()
	var initialID string
	for id := range c.attempts {
		initialID = id
	}
	c.mu.Unlock()
	var retryURL *url.URL
	c.openBrowser = func(_ context.Context, address string) error {
		retryURL, err = url.Parse(address)
		return err
	}
	next, retryErr := c.Start("owner", SignInOptions{PreviousAttemptID: initialID})
	if retryErr != nil {
		t.Fatalf("issued registration cannot resume OAuth after code exchange invalid_grant: %v", retryErr)
	}
	defer c.Cancel("owner", next.ID)
	if retryURL.Query().Get("client_id") != "issued" || retryURL.Query().Get("state") == address.Query().Get("state") || retryURL.Query().Get("code_challenge") == address.Query().Get("code_challenge") || retryURL.Query().Get("nonce") == address.Query().Get("nonce") {
		t.Fatal("retry discarded the registration or reused one-time authorization inputs")
	}
	callback, _ = url.Parse(retryURL.Query().Get("redirect_uri"))
	callback.RawQuery = url.Values{"state": {retryURL.Query().Get("state")}, "code": {"another-expired-code"}}.Encode()
	response, err = http.Get(callback.String())
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatal("retry unexpectedly completed")
	}
	final, err := c.Start("owner", SignInOptions{PreviousAttemptID: next.ID})
	if err != nil {
		t.Fatalf("second retry discarded issued client: %v", err)
	}
	defer c.Cancel("owner", final.ID)
	if retryURL.Query().Get("client_id") != "issued" {
		t.Fatal("second retry registered another client")
	}
}

func TestIdentityOnlyRegistrationSurvivesDialogClose(t *testing.T) {
	c, address, sign, _ := testClient(t)
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		_ = json.NewEncoder(w).Encode(tokenResponse{
			AccessToken: "identity-access", RefreshToken: "identity-refresh", TokenType: "Bearer", ExpiresIn: 3600,
			Scope:   "openid profile email offline_access resource.invoke",
			IDToken: sign("subject", r.Form.Get("client_id"), address.Query().Get("nonce"), c.issuer),
		})
	}))
	defer tokenServer.Close()
	c.tokenURL = tokenServer.URL
	ready := finishTestLogin(t, c, address)
	if ready.Account.State != "plan_permission_required" {
		t.Fatalf("unexpected account state: %s", ready.Account.State)
	}
	c.Cancel("owner", ready.ID)
	account, exists, err := c.Store.ChatGPTAccount(ready.Account.AccountID)
	if err != nil {
		t.Fatal(err)
	}
	if !exists || account.ClientID != "issued" {
		t.Fatal("valid identity-only sign-in and issued registration disappear when dialog closes")
	}
}

func TestSavedRegistrationRequiresSelectionBeforeStartingAnother(t *testing.T) {
	c, address, _, _ := testClient(t)
	ready := finishTestLogin(t, c, address)
	opened := 0
	c.openBrowser = func(context.Context, string) error { opened++; return nil }
	for _, lifecycle := range []string{"", "signed_out"} {
		if err := c.Store.UpdateChatGPTAccount(t.Context(), ready.Account.AccountID, func(a *settings.ChatGPTAccount) error {
			a.Lifecycle = lifecycle
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		next, err := c.Start("another-dialog", SignInOptions{})
		if err == nil {
			c.Cancel("another-dialog", next.ID)
			t.Fatal("unselected login created another registration instead of requiring account selection")
		}
	}
	if opened != 0 {
		t.Fatal("unselected login opened the browser")
	}
}

func TestReturningLoginReusesOneRecordAndExplicitWorkspaceKeepsSeparateCredentials(t *testing.T) {
	c, address, _, _ := testClient(t)
	ready := finishTestLogin(t, c, address)
	previous, _, _ := c.Store.ChatGPTAccount(ready.Account.AccountID)
	open := c.openBrowser
	var nextURL *url.URL
	c.openBrowser = func(ctx context.Context, address string) error {
		var err error
		nextURL, err = url.Parse(address)
		if err != nil {
			return err
		}
		return open(ctx, address)
	}
	for range 2 {
		next, err := c.Start("owner", SignInOptions{AccountID: ready.Account.AccountID})
		if err != nil {
			t.Fatal(err)
		}
		if nextURL.Query().Get("client_id") != "issued" || nextURL.Query().Get("login_hint") != previous.Email {
			t.Fatal("returning login discarded registration hints")
		}
		out := finishTestLogin(t, c, nextURL)
		if out.ID != next.ID || out.Account.AccountID != ready.Account.AccountID {
			t.Fatal("returning login created another account")
		}
		accounts, err := c.Store.ChatGPTAccounts(t.Context())
		if err != nil || len(accounts) != 1 {
			t.Fatal("returning login duplicated the canonical record")
		}
	}
	if _, err := c.Start("owner", SignInOptions{AccountID: ready.Account.AccountID, NewRegistration: true}); err == nil {
		t.Fatal("ambiguous selected-account and new-registration intent was admitted")
	}
	before, _, _ := c.Store.ChatGPTAccount(ready.Account.AccountID)
	next, err := c.Start("owner", SignInOptions{NewRegistration: true})
	if err != nil || nextURL.Query().Get("client_id") != "dynamic_agent_client" {
		t.Fatalf("explicit new registration was rejected: %v", err)
	}
	defer c.Cancel("owner", next.ID)
	callback, _ := url.Parse(nextURL.Query().Get("redirect_uri"))
	callback.RawQuery = url.Values{"state": {nextURL.Query().Get("state")}, "code": {"code"}, "client_id": {"another-workspace"}}.Encode()
	response, err := http.Get(callback.String())
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	out, err := c.Poll("owner", next.ID)
	accounts, readErr := c.Store.ChatGPTAccounts(t.Context())
	after := accounts[ready.Account.AccountID]
	if response.StatusCode != http.StatusOK || err != nil || readErr != nil || len(accounts) != 2 || out.Account == nil || out.Account.AccountID == ready.Account.AccountID || out.Account.Email != previous.Email {
		t.Fatal("explicit same-email workspace lost its separate registration")
	}
	if after.SessionRevision != before.SessionRevision || after.ClientID != before.ClientID || after.IDToken != before.IDToken || after.RefreshToken != before.RefreshToken {
		t.Fatal("new workspace overwrote the existing registration")
	}
}

func TestCancelDuringCodeExchangeRevokesReceivedSession(t *testing.T) {
	c, address, sign, _ := testClient(t)
	entered, release := make(chan struct{}), make(chan struct{})
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		_ = json.NewEncoder(w).Encode(tokenResponse{AccessToken: "canceled-access", RefreshToken: "canceled-refresh", TokenType: "Bearer", ExpiresIn: 3600, Scope: Scope, IDToken: sign("subject", "issued", address.Query().Get("nonce"), c.issuer)})
	}))
	defer tokenServer.Close()
	c.tokenURL = tokenServer.URL
	revoked := make(chan string, 1)
	c.http.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/revoke" {
			_ = r.ParseForm()
			revoked <- r.Form.Get("token")
		}
		return http.DefaultTransport.RoundTrip(r)
	})
	c.mu.Lock()
	var a *attempt
	for _, item := range c.attempts {
		a = item
	}
	c.mu.Unlock()
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		defer close(done)
		c.callback(t.Context(), a, response, httptest.NewRequest("GET", a.redirect+"?state="+address.Query().Get("state")+"&code=code&client_id=issued", nil))
	}()
	<-entered
	c.Cancel("owner", a.status.ID)
	close(release)
	<-done
	if response.Code != http.StatusGone {
		t.Fatalf("canceled callback status: %d", response.Code)
	}
	select {
	case token := <-revoked:
		if token != "canceled-refresh" {
			t.Fatal("did not revoke newly minted refresh token")
		}
	default:
		t.Fatal("cancellation abandoned a minted session")
	}
	accounts, err := c.Store.ChatGPTAccounts(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	for _, account := range accounts {
		if account.AccessToken != "" || account.RefreshToken != "" || account.Lifecycle != "signed_out" {
			t.Fatal("cancellation installed usable credentials")
		}
	}
}

func TestCancelWhileAccountOperationIsBusyDoesNotInstall(t *testing.T) {
	c, address, sign, _ := testClient(t)
	id := (settings.ChatGPTAccount{Issuer: c.issuer, Subject: "subject", ClientID: "issued"}).ID()
	unlock, err := c.Store.LockChatGPTAccountOperation(t.Context(), id)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	exchanged := make(chan struct{})
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(tokenResponse{AccessToken: "late-access", RefreshToken: "late-refresh", TokenType: "Bearer", ExpiresIn: 3600, Scope: Scope, IDToken: sign("subject", "issued", address.Query().Get("nonce"), c.issuer)})
		close(exchanged)
	}))
	defer tokenServer.Close()
	c.tokenURL = tokenServer.URL
	c.mu.Lock()
	var a *attempt
	for _, item := range c.attempts {
		a = item
	}
	c.mu.Unlock()
	done := make(chan struct{})
	go func() {
		defer close(done)
		c.callback(t.Context(), a, httptest.NewRecorder(), httptest.NewRequest("GET", a.redirect+"?state="+address.Query().Get("state")+"&code=code&client_id=issued", nil))
	}()
	<-exchanged
	c.Cancel("owner", a.status.ID)
	unlock()
	<-done
	if account, exists, err := c.Store.ChatGPTAccount(id); err != nil || exists && (account.AccessToken != "" || account.Lifecycle != "signed_out") {
		t.Fatalf("late usable installation: exists=%v err=%v", exists, err)
	}
}

func TestMaintenanceRenewsUnboundIdentityOnlySignInWithoutInference(t *testing.T) {
	var refreshed atomic.Int32
	c := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) {
		refreshed.Add(1)
		_ = r.ParseForm()
		if r.Form.Has("scope") || r.Form.Get("grant_type") != "refresh_token" {
			t.Error("maintenance changed the grant")
		}
		_ = json.NewEncoder(w).Encode(tokenResponse{AccessToken: "identity-next", RefreshToken: "identity-rotated", TokenType: "Bearer", ExpiresIn: 3600, Scope: "openid profile email offline_access resource.invoke"})
	})
	a := savedAccount(t, c, time.Now().Add(-time.Minute))
	if err := c.Store.UpdateChatGPTAccount(t.Context(), a.ID(), func(p *settings.ChatGPTAccount) error {
		p.Scopes = []string{"openid", "offline_access", "resource.invoke"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	stop := c.Maintain(t.Context())
	defer stop()
	stored := awaitAccount(t, c, a.ID(), func(a settings.ChatGPTAccount) bool { return a.RefreshToken == "identity-rotated" })
	if refreshed.Load() != 1 || stored.PlanEnabled() {
		t.Fatal("identity-only maintenance enabled inference or repeated rotation")
	}
	if _, err := c.AccessToken(t.Context(), a.ID()); err == nil {
		t.Fatal("identity-only credentials admitted inference")
	}
}

func TestCanceledVerifiedRegistrationRetainsUnconfirmedRevocation(t *testing.T) {
	c, address, sign, _ := testClient(t)
	entered, release := make(chan struct{}), make(chan struct{})
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		_ = json.NewEncoder(w).Encode(tokenResponse{AccessToken: "discard-access", RefreshToken: "discard-refresh", TokenType: "Bearer", ExpiresIn: 3600, Scope: Scope, IDToken: sign("subject", "issued", address.Query().Get("nonce"), c.issuer)})
	}))
	defer tokenServer.Close()
	c.tokenURL = tokenServer.URL
	c.http.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/revoke" {
			return &http.Response{StatusCode: 403, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
		}
		return http.DefaultTransport.RoundTrip(r)
	})
	c.mu.Lock()
	var a *attempt
	for _, item := range c.attempts {
		a = item
	}
	c.mu.Unlock()
	done := make(chan struct{})
	go func() {
		defer close(done)
		c.callback(t.Context(), a, httptest.NewRecorder(), httptest.NewRequest("GET", a.redirect+"?state="+address.Query().Get("state")+"&code=code&client_id=issued", nil))
	}()
	<-entered
	c.Cancel("owner", a.status.ID)
	close(release)
	<-done
	id := (settings.ChatGPTAccount{Issuer: c.issuer, Subject: "subject", ClientID: "issued"}).ID()
	stored, exists, err := c.Store.ChatGPTAccount(id)
	if err != nil || !exists || stored.AccessToken != "" || stored.RefreshToken != "" || stored.IDToken != "" || stored.Lifecycle != "signed_out" || stored.RevocationConfirmed == nil || *stored.RevocationConfirmed {
		t.Fatal("unconfirmed cleanup was hidden or retained usable credentials")
	}
	status, err := c.Status(id)
	if err != nil || status.State != "signed_out" || status.RevocationConfirmed == nil || *status.RevocationConfirmed {
		t.Fatal("cleanup outcome is unavailable to the account picker")
	}
}

func TestCancelDoesNotWaitForBusyCredentialFileDuringCommit(t *testing.T) {
	c, address, _, _ := testClient(t)
	lock, err := lockfile.Acquire(c.Store.Path() + ".lock")
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Release()
	c.mu.Lock()
	var a *attempt
	for _, item := range c.attempts {
		a = item
	}
	c.mu.Unlock()
	callback, _ := url.Parse(address.Query().Get("redirect_uri"))
	callback.RawQuery = url.Values{"state": {address.Query().Get("state")}, "code": {"code"}, "client_id": {"issued"}}.Encode()
	done := make(chan struct{})
	go func() {
		defer close(done)
		response, err := http.Get(callback.String())
		if err == nil {
			response.Body.Close()
		}
	}()
	deadline := time.Now().Add(2 * time.Second)
	committing := false
	for time.Now().Before(deadline) {
		if !a.finishMu.TryLock() {
			committing = true
			break
		}
		a.finishMu.Unlock()
		time.Sleep(time.Millisecond)
	}
	if !committing {
		lock.Release()
		<-done
		t.Fatal("callback did not reach commit")
	}
	canceled := make(chan struct{})
	go func() { c.Cancel("owner", a.status.ID); close(canceled) }()
	select {
	case <-canceled:
	case <-time.After(time.Second):
		lock.Release()
		<-canceled
		<-done
		t.Fatal("cancellation waited for an unrelated credential write")
	}
	lock.Release()
	<-done
	// Closing the listener can finish the browser request before the accepted
	// exchange finishes its independent credential cleanup. Await that outcome
	// before TempDir cleanup removes the protected store.
	id := (settings.ChatGPTAccount{Issuer: c.issuer, Subject: "subject", ClientID: "issued"}).ID()
	awaitAccount(t, c, id, func(account settings.ChatGPTAccount) bool {
		return account.Lifecycle == "signed_out" && account.AccessToken == "" && account.RefreshToken == ""
	})
}
