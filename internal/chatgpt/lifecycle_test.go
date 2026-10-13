package chatgpt

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/settings"
)

func savedAccount(t *testing.T, c *Client, expires time.Time) settings.ChatGPTAccount {
	t.Helper()
	a := settings.ChatGPTAccount{Issuer: c.issuer, Subject: "subject", ClientID: "issued", AccessToken: "old", RefreshToken: "refresh", Scopes: strings.Fields(Scope), ExpiresAt: expires}
	if err := c.Store.UpdateChatGPTAccount(t.Context(), a.ID(), func(p *settings.ChatGPTAccount) error { *p = a; return nil }); err != nil {
		t.Fatal(err)
	}
	return a
}

func TestRefreshDoesNotBlockStatusOrOtherCredentials(t *testing.T) {
	c, _, _, _ := testClient(t)
	a := savedAccount(t, c, time.Now().Add(-time.Minute))
	entered, release := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		json.NewEncoder(w).Encode(tokenResponse{AccessToken: "new", RefreshToken: "rotated", TokenType: "Bearer", ExpiresIn: 3600, Scope: Scope})
	}))
	defer server.Close()
	c.tokenURL = server.URL
	done := make(chan error, 1)
	go func() { _, err := c.AccessToken(context.Background(), a.ID()); done <- err }()
	<-entered
	read := make(chan error, 1)
	go func() { _, err := c.Status(a.ID()); read <- err }()
	select {
	case err := <-read:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		close(release)
		<-done
		t.Fatal("status blocked behind refresh network request")
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestExpiredTokenStatusIsNotReady(t *testing.T) {
	c, _, _, _ := testClient(t)
	a := savedAccount(t, c, time.Now().Add(-time.Minute))
	s, err := c.Status(a.ID())
	if err != nil || s.State == "ready" {
		t.Fatalf("expired state: %+v %v", s, err)
	}
}

func TestUnknownCredentialLifecycleNeverRefreshesOrDispatches(t *testing.T) {
	var requests atomic.Int32
	c := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		tokenReply(w, "new", "rotated")
	})
	a := savedAccount(t, c, time.Now().Add(-time.Minute))
	if err := c.Store.UpdateChatGPTAccount(t.Context(), a.ID(), func(p *settings.ChatGPTAccount) error {
		p.Lifecycle = "unknown"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, maintenance := range []bool{false, true} {
		if _, err := c.accessToken(t.Context(), a.ID(), maintenance); err == nil || err.Error() != Failure("storage_unavailable").Error() {
			t.Fatalf("unknown lifecycle admitted: %v", err)
		}
	}
	if requests.Load() != 0 {
		t.Fatal("unknown lifecycle triggered a token request")
	}
	current, _, err := c.Store.ChatGPTAccount(a.ID())
	if err != nil || current.RefreshToken != a.RefreshToken || current.Lifecycle != "unknown" {
		t.Fatal("unknown lifecycle was overwritten")
	}
}

func TestConfirmedPlanPermissionRejectionBlocksValidBearer(t *testing.T) {
	var requests atomic.Int32
	c := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		tokenReply(w, "new", "rotated")
	})
	a := savedAccount(t, c, time.Now().Add(time.Hour))
	c.ObserveRequestFailure(t.Context(), a.ID(), a.AccessToken, &RequestError{Status: 403, Code: "chatpass_v2_scope_not_authorized"})
	if _, err := c.AccessToken(t.Context(), a.ID()); err == nil || err.Error() != Failure("plan_permission_required").Error() {
		t.Fatalf("rejected plan permission admitted: %v", err)
	}
	stored, _, _ := c.Store.ChatGPTAccount(a.ID())
	if _, err := c.tokenAfterChange(stored, false); err == nil {
		t.Fatal("waiter admitted a permission-rejected credential")
	}
	if requests.Load() != 0 || stored.RefreshToken != a.RefreshToken {
		t.Fatal("permission rejection refreshed or deleted the session")
	}
}

func TestMaintenanceNotifiesExpiryWhileSharedBackoffDefersRefresh(t *testing.T) {
	var now atomic.Int64
	now.Store(time.Now().UnixNano())
	var requests atomic.Int32
	c := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(503)
	})
	c.now = func() time.Time { return time.Unix(0, now.Load()) }
	a := savedAccount(t, c, c.nowTime().Add(time.Minute))
	if err := c.Store.UpdateChatGPTAccount(t.Context(), a.ID(), func(p *settings.ChatGPTAccount) error {
		p.RetryAt = c.nowTime().Add(5 * time.Minute)
		p.ErrorCode = "temporarily_unavailable"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	states := make(chan string, 8)
	unsubscribe := c.Subscribe(func(id string) {
		if id == a.ID() {
			status, _ := c.Status(id)
			states <- status.State
		}
	})
	defer unsubscribe()
	ticks := make(chan time.Time)
	c.maintenanceTick = ticks
	stop := c.Maintain(t.Context())
	defer stop()
	for _, expected := range []string{"ready", "temporarily_unavailable"} {
		if expected != "ready" {
			now.Store(c.nowTime().Add(2 * time.Minute).UnixNano())
			select {
			case ticks <- c.nowTime():
			case <-time.After(time.Second):
				t.Fatal("maintenance stopped")
			}
		}
		select {
		case state := <-states:
			if state != expected {
				t.Fatalf("state=%s want %s", state, expected)
			}
		case <-time.After(time.Second):
			t.Fatal("expiry state change was not published")
		}
	}
	if requests.Load() != 0 {
		t.Fatal("expiry observation bypassed shared backoff")
	}
}

func lifecycleClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/.well-known/openid-configuration" {
			_ = json.NewEncoder(w).Encode(map[string]any{"issuer": server.URL, "jwks_uri": server.URL + "/keys", "revocation_endpoint": server.URL + "/revoke"})
			return
		}
		handler(w, r)
	}))
	t.Cleanup(server.Close)
	c := New(settings.NewSecretsStore(filepath.Join(t.TempDir(), "secrets.json")))
	c.issuer, c.tokenURL = server.URL, server.URL+"/token"
	return c
}
func tokenReply(w http.ResponseWriter, access, refresh string) {
	_ = json.NewEncoder(w).Encode(tokenResponse{AccessToken: access, RefreshToken: refresh, TokenType: "Bearer", ExpiresIn: 3600, Scope: Scope})
}
func awaitAccount(t *testing.T, c *Client, id string, predicate func(settings.ChatGPTAccount) bool) settings.ChatGPTAccount {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		a, ok, err := c.Store.ChatGPTAccount(id)
		if err == nil && ok && predicate(a) {
			return a
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("account fact did not settle")
	return settings.ChatGPTAccount{}
}
func TestMaintenanceRotatesAcrossThirtyDaysAndClockResumeWithoutRequests(t *testing.T) {
	var now atomic.Int64
	now.Store(time.Now().UnixNano())
	var rotations atomic.Int32
	c := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		n := rotations.Add(1)
		expected := "refresh"
		if n > 1 {
			expected = fmt.Sprintf("refresh-%d", n-1)
		}
		if r.Form.Get("refresh_token") != expected || r.Form.Get("client_id") != "issued" || r.Form.Get("resource") != Resource || r.Form.Has("scope") {
			t.Error("incorrect rotation grant")
		}
		tokenReply(w, fmt.Sprintf("access-%d", n), fmt.Sprintf("refresh-%d", n))
	})
	c.now = func() time.Time { return time.Unix(0, now.Load()) }
	ticks := make(chan time.Time)
	c.maintenanceTick = ticks
	a := savedAccount(t, c, c.nowTime().Add(time.Hour))
	stop := c.Maintain(t.Context())
	defer stop()
	for i := 1; i <= 33; i++ {
		now.Store(c.nowTime().Add(24 * time.Hour).UnixNano())
		select {
		case ticks <- c.nowTime():
		case <-time.After(3 * time.Second):
			t.Fatal("maintenance stopped")
		}
		awaitAccount(t, c, a.ID(), func(a settings.ChatGPTAccount) bool { return a.RefreshToken == fmt.Sprintf("refresh-%d", i) })
	}
	if rotations.Load() != 33 {
		t.Fatalf("rotations=%d", rotations.Load())
	}
	// Shutdown stops network work, preserving the login.
	stop()
	current, _, _ := c.Store.ChatGPTAccount(a.ID())
	if current.RefreshToken == "" {
		t.Fatal("runtime shutdown signed out")
	}
}
func TestSharedBackoffKeepsValidAccessAndStopsExpiredDispatch(t *testing.T) {
	for _, status := range []int{429, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			now := time.Now()
			var calls int
			c := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) {
				calls++
				if calls == 1 {
					w.Header().Set("Retry-After", "45")
					w.WriteHeader(status)
					return
				}
				tokenReply(w, "new", "rotated")
			})
			c.now = func() time.Time { return now }
			a := savedAccount(t, c, now.Add(10*time.Second))
			token, err := c.AccessToken(t.Context(), a.ID())
			if err != nil || token != "old" {
				t.Fatalf("valid access lost: %q %v", token, err)
			}
			now = now.Add(11 * time.Second)
			for range 5 {
				if _, err := c.AccessToken(t.Context(), a.ID()); err == nil {
					t.Fatal("expired dispatch permitted")
				}
			}
			status, _ := c.Status(a.ID())
			if status.State != "temporarily_unavailable" || calls != 1 {
				t.Fatalf("backoff bypass: %+v calls=%d", status, calls)
			}
			now = now.Add(35 * time.Second)
			token, err = c.AccessToken(t.Context(), a.ID())
			if err != nil || token != "new" || calls != 2 {
				t.Fatalf("recovery failed: %q %v", token, err)
			}
		})
	}
}
func TestRequestRejectionNeverDeletesTokensAndLateErrorsCannotRejectNewLogin(t *testing.T) {
	c := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) { tokenReply(w, "new", "rotated") })
	a := savedAccount(t, c, time.Now().Add(time.Hour))
	c.ObserveRequestFailure(t.Context(), a.ID(), "old", &RequestError{Status: 401, Code: "subscription_sharing_invalid_user", RequestID: "request-1"})
	stored, _, _ := c.Store.ChatGPTAccount(a.ID())
	if stored.AccessToken != "old" || stored.RefreshToken != "refresh" || stored.Lifecycle != "review_required" {
		t.Fatalf("401 deleted session: %+v", status(stored))
	}
	next := a
	next.SessionRevision++
	next.AccessToken = "login-new"
	next.RefreshToken = "login-refresh"
	if err := c.Store.InstallChatGPTAccounts(t.Context(), []settings.ChatGPTAccount{next}); err != nil {
		t.Fatal(err)
	}
	c.ObserveRequestFailure(t.Context(), a.ID(), "old", &RequestError{Status: 401, Code: "unauthorized"})
	s, _ := c.Status(a.ID())
	if s.State != "ready" {
		t.Fatalf("late failure rejected new session: %+v", s)
	}
}
func TestSignOutWaitsForRotationAndRevokesLatestToken(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	revoked := make(chan string, 2)
	c := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.URL.Path == "/token" {
			close(entered)
			<-release
			tokenReply(w, "new", "rotated")
			return
		}
		revoked <- r.Form.Get("token")
		w.WriteHeader(200)
	})
	a := savedAccount(t, c, time.Now().Add(-time.Minute))
	refreshed := make(chan error, 1)
	go func() { _, err := c.AccessToken(t.Context(), a.ID()); refreshed <- err }()
	<-entered
	stopped := make(chan error, 1)
	watch, err := c.WatchSession(t.Context(), a.ID(), func(err error) { stopped <- err })
	if err != nil {
		t.Fatal(err)
	}
	defer watch()
	signed := make(chan SignOutResult, 1)
	go func() {
		r, e := c.SignOutAccount(t.Context(), a.ID())
		if e != nil {
			t.Error(e)
		}
		signed <- r
	}()
	awaitAccount(t, c, a.ID(), func(a settings.ChatGPTAccount) bool { return a.Lifecycle == "signing_out" })
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("logout did not immediately stop session")
	}
	if _, err := c.AccessToken(t.Context(), a.ID()); err == nil {
		t.Fatal("dispatch allowed during logout")
	}
	close(release)
	<-refreshed
	result := <-signed
	if !result.LocalCleanupComplete || !result.RevocationConfirmed {
		t.Fatalf("logout result=%+v", result)
	}
	if token := <-revoked; token != "rotated" {
		t.Fatalf("revoked stale token %q", token)
	}
	second, err := c.SignOutAccount(t.Context(), a.ID())
	if err != nil || second != result {
		t.Fatalf("logout not idempotent: %+v %v", second, err)
	}
	stored, _, _ := c.Store.ChatGPTAccount(a.ID())
	if stored.ClientID != "issued" || stored.AccessToken != "" || stored.RefreshToken != "" || stored.IDToken != "" || len(stored.Scopes) != 0 {
		t.Fatal("logout lost registration or retained tokens")
	}
}
func TestUnconfirmedRevocationStillClearsLocalSession(t *testing.T) {
	var calls int
	c := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(503) })
	a := savedAccount(t, c, time.Now().Add(time.Hour))
	result, err := c.SignOutAccount(t.Context(), a.ID())
	if err != nil || !result.LocalCleanupComplete || result.RevocationConfirmed || calls != 3 {
		t.Fatalf("inaccurate logout result: %+v %v calls=%d", result, err, calls)
	}
	s, _ := c.Status(a.ID())
	if s.State != "signed_out" || s.RevocationConfirmed == nil || *s.RevocationConfirmed {
		t.Fatalf("missing disconnect warning: %+v", s)
	}
}
func TestMaintenanceDoesNotRecoverLiveSignOut(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	c := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) { close(entered); <-release; w.WriteHeader(200) })
	a := savedAccount(t, c, time.Now().Add(time.Hour))
	stop := c.Maintain(t.Context())
	defer stop()
	// Ensure startup recovery has completed before accepting a new logout.
	time.Sleep(25 * time.Millisecond)
	done := make(chan SignOutResult, 1)
	go func() { result, _ := c.SignOutAccount(t.Context(), a.ID()); done <- result }()
	<-entered
	time.Sleep(1100 * time.Millisecond)
	stored, _, _ := c.Store.ChatGPTAccount(a.ID())
	if stored.Lifecycle != "signing_out" || stored.RefreshToken == "" {
		t.Fatal("maintenance cleared a live logout")
	}
	close(release)
	if r := <-done; !r.RevocationConfirmed {
		t.Fatal("live revocation not completed")
	}
}

func TestRotatedCredentialSaveFailureStopsUseAndRetriesLatestOnly(t *testing.T) {
	var c *Client
	var calls int
	c = lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if err := os.Chmod(filepath.Dir(c.Store.Path()), 0500); err != nil {
			t.Error(err)
		}
		tokenReply(w, "new", "rotated")
	})
	directory := filepath.Dir(c.Store.Path())
	defer os.Chmod(directory, 0700)
	a := savedAccount(t, c, time.Now().Add(-time.Minute))
	if _, err := c.AccessToken(t.Context(), a.ID()); err == nil {
		t.Fatal("save failure permitted account use")
	}
	status, _ := c.Status(a.ID())
	if status.State != "storage_unavailable" {
		t.Fatalf("storage failure hidden: %+v", status)
	}
	peer := New(settings.NewSecretsStore(c.Store.Path()))
	if _, err := peer.AccessToken(t.Context(), a.ID()); err == nil {
		t.Fatal("peer reused old refresh token")
	}
	if err := os.Chmod(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := c.RetryAccount(t.Context(), a.ID()); err != nil {
		t.Fatal(err)
	}
	stored, _, _ := c.Store.ChatGPTAccount(a.ID())
	if stored.RefreshToken != "rotated" || calls != 1 {
		t.Fatalf("rotation was repeated or lost: calls=%d", calls)
	}
}
func TestSignOutReportsLocalCleanupFailureAndCanRetry(t *testing.T) {
	var c *Client
	c = lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) {
		if err := os.Chmod(filepath.Dir(c.Store.Path()), 0500); err != nil {
			t.Error(err)
		}
		w.WriteHeader(200)
	})
	directory := filepath.Dir(c.Store.Path())
	defer os.Chmod(directory, 0700)
	a := savedAccount(t, c, time.Now().Add(time.Hour))
	result, err := c.SignOutAccount(t.Context(), a.ID())
	if err == nil || result.LocalCleanupComplete || !result.RevocationConfirmed || result.ErrorCode != "logout_cleanup_failed" {
		t.Fatalf("false logout success: %+v %v", result, err)
	}
	if _, err := c.AccessToken(t.Context(), a.ID()); err == nil {
		t.Fatal("failed cleanup restored account use")
	}
	if err := os.Chmod(directory, 0700); err != nil {
		t.Fatal(err)
	}
	// Do not inject another write failure during the second revocation.
	c.http = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}}, nil
	})}
	result, err = c.SignOutAccount(t.Context(), a.ID())
	if err != nil || !result.LocalCleanupComplete || !result.RevocationConfirmed {
		t.Fatalf("cleanup retry failed: %+v %v", result, err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestLateUnboundOAuthDraftCannotUndoLogout(t *testing.T) {
	c, address, _, _ := testClient(t)
	a := savedAccount(t, c, time.Now().Add(time.Hour))
	if _, err := c.SignOutAccount(t.Context(), a.ID()); err != nil {
		t.Fatal(err)
	}
	callback, _ := url.Parse(address.Query().Get("redirect_uri"))
	callback.RawQuery = url.Values{"state": {address.Query().Get("state")}, "code": {"code"}, "client_id": {"issued"}}.Encode()
	response, err := http.Get(callback.String())
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 400 {
		t.Fatalf("late draft revived signed-out account: %d", response.StatusCode)
	}
	s, _ := c.Status(a.ID())
	if s.State != "signed_out" {
		t.Fatalf("logout fact lost: %+v", s)
	}
	// A new intentional attempt reuses the retained issued registration.
	attempt, err := c.Start("owner", a.ID(), false)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Cancel("owner", attempt.ID)
	c.mu.Lock()
	registration := c.attempts[attempt.ID].clientID
	c.mu.Unlock()
	if registration != "issued" {
		t.Fatal("new sign-in discarded the registration")
	}
}

func TestWaitingProcessObservesSharedBackoffBeforeRefreshing(t *testing.T) {
	var requests atomic.Int32
	c := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) { requests.Add(1); tokenReply(w, "new", "rotated") })
	a := savedAccount(t, c, time.Now().Add(-time.Minute))
	unlock, err := c.Store.LockChatGPTAccountOperation(t.Context(), a.ID())
	if err != nil {
		t.Fatal(err)
	}
	peer := New(settings.NewSecretsStore(c.Store.Path()))
	peer.issuer, peer.tokenURL = c.issuer, c.tokenURL
	// A separate coordinator models another process; the OS operation lock is real.
	peer.coordination = &accountCoordinator{accounts: map[string]accountMemory{}, listeners: map[uint64]func(string){}}
	entered := make(chan struct{})
	peer.now = func() time.Time {
		select {
		case <-entered:
		default:
			close(entered)
		}
		return time.Now()
	}
	done := make(chan error, 1)
	go func() { _, err := peer.AccessToken(t.Context(), a.ID()); done <- err }()
	<-entered
	if err := c.Store.UpdateChatGPTAccount(t.Context(), a.ID(), func(a *settings.ChatGPTAccount) error {
		a.RetryAt = time.Now().Add(time.Minute)
		a.ErrorCode = "rate_limited"
		return nil
	}); err != nil {
		unlock()
		t.Fatal(err)
	}
	unlock()
	if err := <-done; err == nil || requests.Load() != 0 {
		t.Fatalf("waiting process bypassed backoff: requests=%d error=%v", requests.Load(), err)
	}
}

func TestMaintenanceHonorsEarliestRefreshAndTerminalFailure(t *testing.T) {
	now := time.Now()
	var requests atomic.Int32
	c := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(400)
		fmt.Fprint(w, `{"error":"refresh_token_reused"}`)
	})
	c.now = func() time.Time { return now }
	a := savedAccount(t, c, now.Add(time.Minute))
	if err := c.Store.UpdateChatGPTAccount(t.Context(), a.ID(), func(a *settings.ChatGPTAccount) error { a.EarliestRefreshAt = now.Add(2 * time.Minute); return nil }); err != nil {
		t.Fatal(err)
	}
	if token, err := c.AccessToken(t.Context(), a.ID()); err != nil || token != "old" {
		t.Fatalf("valid token: %v", err)
	}
	now = now.Add(61 * time.Second)
	if _, err := c.AccessToken(t.Context(), a.ID()); err == nil || requests.Load() != 0 {
		t.Fatal("refreshed before earliest_refresh_at")
	}
	now = now.Add(time.Minute)
	if _, err := c.AccessToken(t.Context(), a.ID()); err == nil {
		t.Fatal("terminal failure hidden")
	}
	stored, _, _ := c.Store.ChatGPTAccount(a.ID())
	if stored.AccessToken != "" || stored.RefreshToken != "" || stored.ClientID != "issued" || stored.Lifecycle != "authorization_required" {
		t.Fatal("terminal refresh did not preserve registration and clear tokens")
	}
}

func TestFailedLogoutIntentCannotBeUndoneByInFlightRefresh(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	c := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		tokenReply(w, "new", "rotated")
	})
	a := savedAccount(t, c, time.Now().Add(-time.Minute))
	done := make(chan error, 1)
	go func() { _, err := c.AccessToken(t.Context(), a.ID()); done <- err }()
	<-entered
	directory := filepath.Dir(c.Store.Path())
	if err := os.Chmod(directory, 0500); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(directory, 0700)
	result, err := c.SignOutAccount(t.Context(), a.ID())
	if err == nil || result.LocalCleanupComplete {
		t.Fatal("failed logout intent reported success")
	}
	if err := os.Chmod(directory, 0700); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-done; err == nil {
		t.Fatal("late refresh restored a stopped account")
	}
	state, _ := c.Status(a.ID())
	if state.State != "storage_unavailable" || state.ErrorCode != "logout_cleanup_failed" {
		t.Fatalf("logout failure lost: %+v", state)
	}
}

func TestInvalidClientRequiresReviewWhileOrdinaryUnauthorizedCanRenew(t *testing.T) {
	var calls atomic.Int32
	c := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(400)
		fmt.Fprint(w, `{"error":"invalid_client"}`)
	})
	a := savedAccount(t, c, time.Now().Add(-time.Minute))
	if _, err := c.AccessToken(t.Context(), a.ID()); err == nil {
		t.Fatal("invalid client admitted")
	}
	peer := New(settings.NewSecretsStore(c.Store.Path()))
	peer.issuer, peer.tokenURL = c.issuer, c.tokenURL
	peer.now = func() time.Time { return time.Now().Add(time.Hour) }
	if _, err := peer.accessToken(t.Context(), a.ID(), true); err == nil || calls.Load() != 1 {
		t.Fatal("client rejection was automatically retried")
	}
	stored, _, _ := c.Store.ChatGPTAccount(a.ID())
	if stored.RefreshToken == "" || stored.ClientID != "issued" {
		t.Fatal("client review deleted registration")
	}
	// An ordinary inference 401 keeps its HTTP evidence and permits normal due renewal.
	if err := c.Store.UpdateChatGPTAccount(t.Context(), a.ID(), func(p *settings.ChatGPTAccount) error {
		p.Lifecycle = ""
		p.ErrorCode = ""
		p.RetryAt = time.Time{}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	c.resetMemory(a.ID())
	c.ObserveRequestFailure(t.Context(), a.ID(), a.AccessToken, &RequestError{Status: 401, Code: "subscription_sharing_invalid_user", RequestID: "request-evidence"})
	c.http = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"access_token":"new","refresh_token":"rotated","token_type":"Bearer","expires_in":3600,"scope":"resource.invoke chatgpt.tokens.use.direct offline_access"}`))}, nil
	})}
	if _, err := c.accessToken(t.Context(), a.ID(), true); err != nil {
		t.Fatal(err)
	}
	status, _ := c.Status(a.ID())
	if status.State != "ready" {
		t.Fatalf("normal due refresh could not recover: %+v", status)
	}
}

func TestInterruptedLogoutIsNeverRestoredAtStartup(t *testing.T) {
	c := lifecycleClient(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) })
	a := savedAccount(t, c, time.Now().Add(time.Hour))
	if err := c.Store.UpdateChatGPTAccount(t.Context(), a.ID(), func(p *settings.ChatGPTAccount) error {
		p.Lifecycle = "signing_out"
		p.SessionRevision++
		p.SignedOutAt = time.Now()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// A fresh process sees only canonical facts, not the prior process's watches.
	c.coordination = &accountCoordinator{accounts: map[string]accountMemory{}, listeners: map[uint64]func(string){}}
	c.recoverSignOuts(t.Context())
	stored, _, _ := c.Store.ChatGPTAccount(a.ID())
	if stored.AccessToken != "" || stored.RefreshToken != "" || stored.Lifecycle != "signed_out" || stored.RevocationConfirmed == nil || *stored.RevocationConfirmed {
		t.Fatal("interrupted logout restored login or hid unconfirmed revocation")
	}
}
