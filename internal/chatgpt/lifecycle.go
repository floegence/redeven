package chatgpt

import (
	"context"
	"crypto/sha256"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/settings"
)

// Only short-lived coordination lives here. The protected registration is the
// authority for logout, token rotation and terminal authorization failure.
type accountMemory struct {
	revision      uint64
	token         string
	state, code   string
	retryAt       time.Time
	failures      int
	refreshing    bool
	stopRequested bool
	repairMu      *sync.Mutex
	pending       *settings.ChatGPTAccount
	release       func()
}
type accountCoordinator struct {
	mu        sync.Mutex
	accounts  map[string]accountMemory
	listeners map[uint64]func(string)
	sequence  uint64
}

var coordinators sync.Map

func coordinator(path string) *accountCoordinator {
	v, _ := coordinators.LoadOrStore(path, &accountCoordinator{accounts: map[string]accountMemory{}, listeners: map[uint64]func(string){}})
	return v.(*accountCoordinator)
}
func (c *Client) nowTime() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now()
}
func (c *Client) memory(id string) accountMemory {
	c.coordination.mu.Lock()
	defer c.coordination.mu.Unlock()
	return c.coordination.accounts[id]
}
func (c *Client) setMemory(id string, m accountMemory) {
	c.coordination.mu.Lock()
	previous := c.coordination.accounts[id]
	if previous.stopRequested && !m.stopRequested {
		m.stopRequested = true
		if m.code != "logout_cleanup_failed" {
			m.state, m.code = previous.state, previous.code
		}
	}
	if previous.pending != nil && m.pending == nil && m.state != "" {
		m.pending, m.release, m.repairMu = previous.pending, previous.release, previous.repairMu
	}
	c.coordination.accounts[id] = m
	c.coordination.mu.Unlock()
	c.changed(id)
}
func (c *Client) resetMemory(id string) {
	c.coordination.mu.Lock()
	delete(c.coordination.accounts, id)
	c.coordination.mu.Unlock()
	c.changed(id)
}
func (c *Client) changed(id string) {
	c.coordination.mu.Lock()
	listeners := make([]func(string), 0, len(c.coordination.listeners))
	for _, fn := range c.coordination.listeners {
		listeners = append(listeners, fn)
	}
	c.coordination.mu.Unlock()
	for _, fn := range listeners {
		fn(id)
	}
}
func (c *Client) Subscribe(fn func(string)) func() {
	c.coordination.mu.Lock()
	c.coordination.sequence++
	id := c.coordination.sequence
	c.coordination.listeners[id] = fn
	c.coordination.mu.Unlock()
	return func() { c.coordination.mu.Lock(); delete(c.coordination.listeners, id); c.coordination.mu.Unlock() }
}
func sameToken(a, b settings.ChatGPTAccount) bool {
	return a.SessionRevision == b.SessionRevision && a.AccessToken == b.AccessToken && a.RefreshToken == b.RefreshToken
}
func (c *Client) refreshAt(a settings.ChatGPTAccount) time.Time {
	hash := sha256.Sum256([]byte(a.ID()))
	jitter := time.Duration(hash[0]%31) * time.Second
	at := a.ExpiresAt.Add(-2*time.Minute - jitter)
	if a.EarliestRefreshAt.After(at) {
		at = a.EarliestRefreshAt
	}
	return at
}
func accountState(a settings.ChatGPTAccount, now time.Time) string {
	switch a.Lifecycle {
	case "":
	case "authorization_required", "plan_permission_required", "review_required", "signing_out", "signed_out":
		return a.Lifecycle
	default:
		return "storage_unavailable"
	}
	if a.AccessToken == "" {
		return "authorization_required"
	}
	if !a.PlanEnabled() {
		return "plan_permission_required"
	}
	if !now.Before(a.ExpiresAt) {
		if a.RefreshToken == "" {
			return "authorization_required"
		}
		return "renewing"
	}
	return "ready"
}

type AccountSnapshot struct {
	Status          AccountStatus
	SessionRevision uint64
}

// AccountSnapshots projects one canonical read for multi-account observers.
func (c *Client) AccountSnapshots(ctx context.Context) (map[string]AccountSnapshot, error) {
	accounts, err := c.Store.ChatGPTAccounts(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]AccountSnapshot, len(accounts))
	for id, account := range accounts {
		out[id] = AccountSnapshot{Status: c.accountStatus(account), SessionRevision: account.SessionRevision}
	}
	return out, nil
}
func (c *Client) accountStatus(a settings.ChatGPTAccount) AccountStatus {
	s := AccountStatus{AccountID: a.ID(), Email: a.Email, State: accountState(a, c.nowTime()), WelcomeAcknowledged: a.WelcomeAcknowledged, ErrorCode: a.ErrorCode, RevocationConfirmed: a.RevocationConfirmed, HTTPStatus: a.HTTPStatus, RequestID: a.RequestID}
	if a.RetryAt.After(c.nowTime()) {
		s.RetryAt = &a.RetryAt
		if !c.nowTime().Before(a.ExpiresAt) && transient(Failure(a.ErrorCode)) {
			s.State = "temporarily_unavailable"
		}
	}
	m := c.memory(a.ID())
	if a.Lifecycle != "signed_out" && ((m.revision == a.SessionRevision && m.token == a.AccessToken) || m.stopRequested && m.revision == a.SessionRevision) {
		if m.state != "" {
			s.State = m.state
			s.ErrorCode = m.code
		}
		if !m.retryAt.IsZero() {
			s.RetryAt = &m.retryAt
		}
		if m.retryAt.After(c.nowTime()) && !c.nowTime().Before(a.ExpiresAt) && transient(Failure(m.code)) {
			s.State = "temporarily_unavailable"
		}
		if m.refreshing && !c.nowTime().Before(a.ExpiresAt) && a.Lifecycle == "" && m.state == "" {
			s.State = "renewing"
		}
	}
	return s
}
func transient(err error) bool {
	var e *Error
	return errors.As(err, &e) && (e.Code == "temporarily_unavailable" || e.Code == "rate_limited")
}
func (c *Client) failureMemory(a settings.ChatGPTAccount, err error) accountMemory {
	m := c.memory(a.ID())
	if m.revision != a.SessionRevision || m.token != a.AccessToken {
		m = accountMemory{revision: a.SessionRevision, token: a.AccessToken}
	}
	m.refreshing = false
	m.failures++
	var failure *Error
	if errors.As(err, &failure) {
		m.code = failure.Code
	}
	if transient(err) {
		delays := []time.Duration{15 * time.Second, 30 * time.Second, time.Minute, 2 * time.Minute, 5 * time.Minute}
		index := min(m.failures-1, len(delays)-1)
		m.retryAt = c.nowTime().Add(delays[index])
		if failure.RetryAt.After(m.retryAt) {
			m.retryAt = failure.RetryAt
		}
		if c.nowTime().Before(a.ExpiresAt) && a.PlanEnabled() {
			m.state = ""
		} else {
			m.state = "temporarily_unavailable"
		}
	} else {
		m.state = "review_required"
		m.retryAt = c.nowTime().Add(5 * time.Minute)
	}
	return m
}
func waitContext(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func (c *Client) accessToken(ctx context.Context, id string, maintenance bool) (string, error) {
	a, ok, err := c.Store.ChatGPTAccount(id)
	if err != nil {
		return "", Failure("storage_unavailable")
	}
	if !ok {
		return "", Failure("authorization_required")
	}
	state := c.accountStatus(a).State
	switch state {
	case "signing_out", "signed_out", "authorization_required":
		return "", Failure("authorization_required")
	case "storage_unavailable":
		if !maintenance || accountState(a, c.nowTime()) == "storage_unavailable" {
			return "", Failure("storage_unavailable")
		}
	}
	if a.AccessToken == "" {
		return "", Failure("authorization_required")
	}
	if state == "review_required" && (!maintenance || a.HTTPStatus == 0) {
		return "", Failure("review_required")
	}
	if !maintenance && (state == "plan_permission_required" || !a.PlanEnabled()) {
		return "", Failure("plan_permission_required")
	}
	m := c.memory(id)
	if m.stopRequested && m.revision == a.SessionRevision {
		return "", Failure("storage_unavailable")
	}
	if a.RetryAt.After(c.nowTime()) {
		if a.Lifecycle == "" && c.nowTime().Before(a.ExpiresAt) && a.PlanEnabled() {
			return a.AccessToken, nil
		}
		return "", Failure("temporarily_unavailable")
	}
	if m.revision == a.SessionRevision && m.token == a.AccessToken && c.nowTime().Before(m.retryAt) {
		if c.nowTime().Before(a.ExpiresAt) && a.PlanEnabled() && m.state == "" && m.pending == nil {
			return a.AccessToken, nil
		}
		if m.state == "review_required" {
			return "", Failure("review_required")
		}
		return "", Failure("temporarily_unavailable")
	}
	if m.pending == nil && c.nowTime().Before(c.refreshAt(a)) {
		if c.nowTime().Before(a.ExpiresAt) {
			return a.AccessToken, nil
		}
		return "", Failure("temporarily_unavailable")
	}
	if a.RefreshToken == "" {
		return "", Failure("authorization_required")
	}
	if m.pending != nil && m.revision == a.SessionRevision && m.token == a.AccessToken {
		m.repairMu.Lock()
		defer m.repairMu.Unlock()
		latest := c.memory(id)
		if latest.stopRequested {
			return "", Failure("authorization_required")
		}
		if latest.pending == nil {
			stored, _, err := c.Store.ChatGPTAccount(id)
			if err != nil {
				return "", Failure("storage_unavailable")
			}
			return c.tokenAfterChange(stored, maintenance)
		}
		if err := c.installRefresh(ctx, a, *m.pending); err != nil {
			m.retryAt = c.nowTime().Add(15 * time.Second)
			c.setMemory(id, m)
			return "", Failure("storage_unavailable")
		}
		if m.release != nil {
			m.release()
		}
		c.setMemory(id, accountMemory{})
		stored, _, err := c.Store.ChatGPTAccount(id)
		if err != nil {
			return "", Failure("storage_unavailable")
		}
		return c.tokenAfterChange(stored, maintenance)
	}
	unlock, err := c.Store.LockChatGPTAccountOperation(ctx, id)
	if err != nil {
		return "", err
	}
	releaseOnReturn := true
	defer func() {
		if releaseOnReturn {
			unlock()
		}
	}()
	// Another process may already have rotated or signed out while we waited.
	current, ok, err := c.Store.ChatGPTAccount(id)
	if err != nil || !ok {
		return "", Failure("storage_unavailable")
	}
	if !sameToken(a, current) {
		return c.tokenAfterChange(current, maintenance)
	}
	if current.Lifecycle == "signing_out" || current.Lifecycle == "signed_out" {
		return "", Failure("authorization_required")
	}
	if accountState(current, c.nowTime()) == "storage_unavailable" {
		return "", Failure("storage_unavailable")
	}
	if current.Lifecycle == "review_required" && (!maintenance || current.HTTPStatus == 0) {
		return "", Failure("review_required")
	}
	if !maintenance && (current.Lifecycle == "plan_permission_required" || !current.PlanEnabled()) {
		return "", Failure("plan_permission_required")
	}
	if current.RetryAt.After(c.nowTime()) {
		if current.Lifecycle == "" && c.nowTime().Before(current.ExpiresAt) && current.PlanEnabled() {
			return current.AccessToken, nil
		}
		return "", Failure("temporarily_unavailable")
	}
	m = c.memory(id)
	if m.stopRequested && m.revision == a.SessionRevision {
		return "", Failure("storage_unavailable")
	}

	if m.revision == a.SessionRevision && m.token == a.AccessToken && c.nowTime().Before(m.retryAt) {
		return "", Failure("temporarily_unavailable")
	}
	m = accountMemory{revision: a.SessionRevision, token: a.AccessToken, failures: m.failures, refreshing: true}
	c.setMemory(id, m)
	t, err := c.exchange(ctx, url.Values{"grant_type": {"refresh_token"}, "client_id": {a.ClientID}, "refresh_token": {a.RefreshToken}, "resource": {Resource}})
	if err != nil {
		var failure *Error
		if errors.As(err, &failure) && unusable(failure.Code) {
			err = c.Store.UpdateChatGPTAccount(context.WithoutCancel(ctx), id, func(p *settings.ChatGPTAccount) error {
				if sameToken(a, *p) && p.Lifecycle != "signing_out" {
					clearTokens(p)
					p.Lifecycle = "authorization_required"
					p.ErrorCode = failure.Code
				}
				return nil
			})
			if err != nil {
				c.setMemory(id, accountMemory{revision: a.SessionRevision, token: a.AccessToken, state: "storage_unavailable", code: "storage_unavailable"})
				return "", Failure("storage_unavailable")
			}
			c.setMemory(id, accountMemory{})
			return "", failure
		}
		if ctx.Err() != nil {
			m.refreshing = false
			c.setMemory(id, m)
			return "", ctx.Err()
		}
		failed := c.failureMemory(a, err)
		if writeErr := c.Store.UpdateChatGPTAccount(context.WithoutCancel(ctx), id, func(current *settings.ChatGPTAccount) error {
			if sameToken(a, *current) && current.Lifecycle != "signing_out" {
				current.RetryAt, current.ErrorCode = failed.retryAt, failed.code
				if !transient(err) {
					current.Lifecycle = "review_required"
					current.HTTPStatus, current.RequestID = 0, ""
				}
			}
			return nil
		}); writeErr != nil {
			failed.state, failed.code = "storage_unavailable", "storage_unavailable"
		}
		c.setMemory(id, failed)
		if failed.state == "storage_unavailable" {
			return "", Failure("storage_unavailable")
		}
		if transient(err) && c.nowTime().Before(a.ExpiresAt) && a.PlanEnabled() {
			return a.AccessToken, nil
		}
		return "", err
	}
	next := a
	var validationErr error
	if t.RefreshToken == "" {
		c.setMemory(id, c.failureMemory(a, Failure("invalid_token_response")))
		return "", Failure("invalid_token_response")
	}
	next.AccessToken, next.RefreshToken = t.AccessToken, t.RefreshToken
	next.Scopes = strings.Fields(t.Scope)
	next.ExpiresAt = c.nowTime().Add(time.Duration(t.ExpiresIn) * time.Second)
	next.EarliestRefreshAt = time.Unix(t.EarliestRefreshAt, 0)
	next.Lifecycle, next.ErrorCode = "", ""
	next.RetryAt = time.Time{}
	next.HTTPStatus, next.RequestID = 0, ""
	next.RevocationConfirmed = nil
	if t.IDToken != "" {
		verified, verifyErr := c.validate(ctx, a.ClientID, "", t, a)
		if verifyErr != nil {
			// Preserve the latest refresh token for revocation, while denying use of
			// a credential set whose new identity assertion failed verification.
			next.Lifecycle, next.ErrorCode = "review_required", "identity_validation_failed"
			validationErr = verifyErr
		} else {
			next = verified
		}
	}
	if err = c.installRefresh(context.WithoutCancel(ctx), a, next); err != nil {
		m = accountMemory{revision: a.SessionRevision, token: a.AccessToken, state: "storage_unavailable", code: "storage_unavailable", pending: &next, retryAt: c.nowTime().Add(15 * time.Second), release: sync.OnceFunc(unlock), repairMu: &sync.Mutex{}}
		c.setMemory(id, m)
		current, _, readErr := c.Store.ChatGPTAccount(id)
		// Retain the operation lock while the only valid rotation is in memory.
		// A sign-out takes over revocation of that replacement instead.
		releaseOnReturn = readErr == nil && current.Lifecycle == "signing_out"
		return "", Failure("storage_unavailable")
	}
	c.setMemory(id, accountMemory{})
	stored, _, err := c.Store.ChatGPTAccount(id)
	if err != nil {
		return "", Failure("storage_unavailable")
	}
	if validationErr != nil {
		return "", validationErr
	}
	return c.tokenAfterChange(stored, maintenance)
}
func (c *Client) tokenAfterChange(a settings.ChatGPTAccount, maintenance bool) (string, error) {
	state := c.accountStatus(a).State
	if state == "storage_unavailable" {
		return "", Failure("storage_unavailable")
	}
	if state == "signing_out" || state == "signed_out" || state == "authorization_required" {
		return "", Failure("authorization_required")
	}
	if a.Lifecycle == "signing_out" || a.Lifecycle == "signed_out" || a.AccessToken == "" {
		return "", Failure("authorization_required")
	}
	if state == "review_required" && !maintenance {
		return "", Failure("review_required")
	}
	if !maintenance && (state == "plan_permission_required" || !a.PlanEnabled()) {
		return "", Failure("plan_permission_required")
	}
	if !c.nowTime().Before(a.ExpiresAt) {
		return "", Failure("temporarily_unavailable")
	}
	return a.AccessToken, nil
}
func (c *Client) installRefresh(ctx context.Context, previous, next settings.ChatGPTAccount) error {
	var err error
	for _, delay := range []time.Duration{0, 50 * time.Millisecond, 150 * time.Millisecond} {
		if delay > 0 {
			if err = waitContext(ctx, delay); err != nil {
				return err
			}
		}
		err = c.Store.UpdateChatGPTAccount(ctx, previous.ID(), func(a *settings.ChatGPTAccount) error {
			if !sameToken(previous, *a) && !(a.Lifecycle == "signing_out" && a.AccessToken == previous.AccessToken && a.RefreshToken == previous.RefreshToken) {
				return Failure("credential_changed")
			}
			lifecycle, code, revision, signedOutAt := a.Lifecycle, a.ErrorCode, a.SessionRevision, a.SignedOutAt
			*a = next
			if lifecycle == "signing_out" {
				a.Lifecycle = lifecycle
				a.ErrorCode = code
				a.SessionRevision = revision
				a.SignedOutAt = signedOutAt
			}
			return nil
		})
		if err == nil {
			return nil
		}
	}
	return err
}

// ObserveRequestFailure binds diagnostics to the exact token sent. An old
// response can never reject a newer credential set, and 401 never deletes it.
func (c *Client) ObserveRequestFailure(ctx context.Context, id, bearer string, err error) {
	var request *RequestError
	if !errors.As(err, &request) {
		return
	}
	state := ""
	switch {
	case request.Status == http.StatusUnauthorized:
		state = "review_required"
	case request.Status == http.StatusForbidden:
		state = "review_required"
		if request.Code == "chatpass_v2_scope_not_authorized" {
			state = "plan_permission_required"
		}
	}
	if state == "" {
		return
	}
	code := safeEvidence(request.Code)
	if code == "" {
		if request.Status == 401 {
			code = "identity_not_accepted"
		} else {
			code = "permission_not_accepted"
		}
	}
	writeErr := c.Store.UpdateChatGPTAccount(ctx, id, func(a *settings.ChatGPTAccount) error {
		if a.AccessToken == bearer && a.Lifecycle != "signing_out" && a.Lifecycle != "signed_out" {
			a.Lifecycle = state
			a.ErrorCode = code
			a.HTTPStatus = request.Status
			a.RequestID = safeEvidence(request.RequestID)
		}
		return nil
	})
	if writeErr != nil {
		current, ok, _ := c.Store.ChatGPTAccount(id)
		if ok && current.AccessToken == bearer {
			c.setMemory(id, accountMemory{revision: current.SessionRevision, token: bearer, state: "storage_unavailable", code: "storage_unavailable"})
		}
	}
	c.changed(id)
}

func safeEvidence(value string) string {
	if len(value) > 128 {
		return ""
	}
	for _, ch := range value {
		if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '_' || ch == '-' || ch == '.') {
			return ""
		}
	}
	return value
}

func (c *Client) SignOut(ctx context.Context, id string) (bool, error) {
	result, err := c.SignOutAccount(ctx, id)
	return result.RevocationConfirmed, err
}

type SignOutResult struct {
	AccountID            string `json:"account_id"`
	LocalCleanupComplete bool   `json:"local_cleanup_complete"`
	RevocationConfirmed  bool   `json:"revocation_confirmed"`
	ErrorCode            string `json:"error_code,omitempty"`
}

func (c *Client) SignOutAccount(ctx context.Context, id string) (SignOutResult, error) {
	result := SignOutResult{AccountID: id}
	a, ok, err := c.Store.ChatGPTAccount(id)
	if err != nil || !ok {
		return result, Failure("storage_unavailable")
	}
	if a.Lifecycle == "signed_out" {
		result.LocalCleanupComplete = true
		result.RevocationConfirmed = a.RevocationConfirmed != nil && *a.RevocationConfirmed
		return result, nil
	}
	m := c.memory(id)
	m.revision, m.token, m.state, m.stopRequested = a.SessionRevision, a.AccessToken, "signing_out", true
	c.setMemory(id, m)
	err = c.Store.UpdateChatGPTAccount(ctx, id, func(p *settings.ChatGPTAccount) error {
		if p.Lifecycle != "signing_out" && p.Lifecycle != "signed_out" {
			p.SessionRevision++
			p.SignedOutAt = c.nowTime()
			p.Lifecycle = "signing_out"
			p.ErrorCode = ""
		}
		return nil
	})
	if err != nil {
		c.setMemory(id, accountMemory{revision: a.SessionRevision, token: a.AccessToken, state: "storage_unavailable", code: "logout_cleanup_failed"})
		return result, Failure("storage_unavailable")
	}
	c.changed(id)
	if pending := c.memory(id); pending.pending != nil && pending.release != nil {
		pending.repairMu.Lock()
		pending.release()
		pending.repairMu.Unlock()
	}
	unlock, err := c.Store.LockChatGPTAccountOperation(ctx, id)
	if err != nil {
		return result, err
	}
	defer unlock()
	a, ok, err = c.Store.ChatGPTAccount(id)
	if err != nil || !ok {
		return result, Failure("storage_unavailable")
	}
	// A refresh accepted before logout may have returned a replacement that could
	// not be saved. Revoke that latest token as well as the canonical token.
	if a.Lifecycle == "signed_out" {
		result.LocalCleanupComplete = true
		result.RevocationConfirmed = a.RevocationConfirmed != nil && *a.RevocationConfirmed
		c.resetMemory(id)
		return result, nil
	}
	m = c.memory(id)
	revokeCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if m.pending != nil {
		result.RevocationConfirmed = c.revoke(revokeCtx, *m.pending)
	} else {
		result.RevocationConfirmed = c.revoke(revokeCtx, a)
	}
	cleanupCtx, cleanupCancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cleanupCancel()
	err = c.Store.UpdateChatGPTAccount(cleanupCtx, id, func(p *settings.ChatGPTAccount) error {
		clearTokens(p)
		p.Lifecycle = "signed_out"
		p.ErrorCode = ""
		p.RevocationConfirmed = &result.RevocationConfirmed
		return nil
	})
	if err != nil {
		c.setMemory(id, accountMemory{revision: a.SessionRevision, token: a.AccessToken, state: "storage_unavailable", code: "logout_cleanup_failed"})
		result.ErrorCode = "logout_cleanup_failed"
		return result, Failure("storage_unavailable")
	}
	result.LocalCleanupComplete = true
	c.resetMemory(id)
	return result, nil
}
func (c *Client) revoke(ctx context.Context, a settings.ChatGPTAccount) bool {
	if a.RefreshToken == "" {
		return true
	}
	p, err := c.oidcProvider(ctx)
	if err != nil {
		return false
	}
	var meta struct {
		RevocationEndpoint string `json:"revocation_endpoint"`
	}
	if p.Claims(&meta) != nil {
		return false
	}
	endpoint, err := url.Parse(meta.RevocationEndpoint)
	issuer, e := url.Parse(c.issuer)
	if err != nil || e != nil || endpoint.Host != issuer.Host || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" || !strings.HasPrefix(endpoint.Path, issuer.Path+"/") || endpoint.Scheme != issuer.Scheme || endpoint.Scheme != "https" && c.issuer == Issuer {
		return false
	}
	form := url.Values{"token": {a.RefreshToken}, "token_type_hint": {"refresh_token"}, "client_id": {a.ClientID}}
	for _, delay := range []time.Duration{0, 500 * time.Millisecond, 1500 * time.Millisecond} {
		if waitContext(ctx, delay) != nil {
			return false
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), strings.NewReader(form.Encode()))
		if err != nil {
			return false
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		response, err := c.http.Do(req)
		if err != nil {
			continue
		}
		response.Body.Close()
		if response.StatusCode == 200 {
			return true
		}
		if response.StatusCode < 500 {
			return false
		}
	}
	return false
}
func retryAfter(value string, now time.Time) time.Time {
	if seconds, err := strconv.Atoi(value); err == nil && seconds >= 0 {
		return now.Add(time.Duration(seconds) * time.Second)
	}
	at, _ := http.ParseTime(value)
	return at
}

// Maintain owns no credentials or execution state; it schedules the shared
// resolver for every saved sign-in while the Runtime is alive, including accounts
// not yet bound to a connection and grants without plan permission.
func (c *Client) Maintain(ctx context.Context) func() {
	ctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		busy := map[string]bool{}
		observedStates := map[string]string{}
		finished := make(chan string, 32)
		ticks := c.maintenanceTick
		if ticks == nil {
			ticker := time.NewTicker(time.Second)
			defer ticker.Stop()
			ticks = ticker.C
		}
		var workers sync.WaitGroup
		defer workers.Wait()
		scan := func() {
			accounts, err := c.Store.ChatGPTAccounts(ctx)
			if err != nil {
				return
			}
			for id, a := range accounts {
				state := c.accountStatus(a).State
				if previous, observed := observedStates[id]; !observed || previous != state {
					observedStates[id] = state
					c.changed(id)
				}
				if busy[id] {
					continue
				}
				if accountState(a, c.nowTime()) == "storage_unavailable" || a.Lifecycle == "signing_out" || a.Lifecycle == "signed_out" || a.Lifecycle == "review_required" && a.HTTPStatus == 0 {
					continue
				}
				m := c.memory(id)
				if m.stopRequested || a.RetryAt.After(c.nowTime()) || a.AccessToken == "" || a.RefreshToken == "" || c.nowTime().Before(c.refreshAt(a)) && m.pending == nil || m.revision == a.SessionRevision && c.nowTime().Before(m.retryAt) {
					continue
				}
				busy[id] = true
				workers.Add(1)
				go func(id string) {
					defer workers.Done()
					_, _ = c.accessToken(ctx, id, true)
					select {
					case finished <- id:
					case <-ctx.Done():
					}
				}(id)
			}
		}
		c.recoverSignOuts(ctx)
		scan()
		for {
			select {
			case <-ctx.Done():
				return
			case id := <-finished:
				delete(busy, id)
				scan()
			case <-ticks:
				scan()
			}
		}
	}()
	return func() { cancel(); <-done }
}

// WatchSession observes canonical logout/terminal facts across processes. The
// caller owns cancellation; this does not rebuild the engine's lifecycle.
func (c *Client) WatchSession(ctx context.Context, id string, stop func(error)) (func(), error) {
	a, ok, err := c.Store.ChatGPTAccount(id)
	if err != nil || !ok {
		return nil, Failure("authorization_required")
	}
	if err := sessionFailure(a, a.SessionRevision); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(ctx)
	wake := make(chan struct{}, 1)
	unsubscribe := c.Subscribe(func(changed string) {
		if changed == id {
			select {
			case wake <- struct{}{}:
			default:
			}
		}
	})
	wake <- struct{}{} // Close the read/subscription race before the next timer.
	go func() {
		defer unsubscribe()
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			case <-wake:
			}
			current, ok, err := c.Store.ChatGPTAccount(id)
			if err != nil || !ok {
				stop(Failure("storage_unavailable"))
				return
			}
			if err := sessionFailure(current, a.SessionRevision); err != nil {
				stop(err)
				return
			}
			state := c.accountStatus(current).State
			if state == "signing_out" || state == "signed_out" {
				stop(Failure("authorization_required"))
				return
			}
			if state == "storage_unavailable" {
				stop(Failure("storage_unavailable"))
				return
			}
		}
	}()
	return cancel, nil
}
func sessionFailure(a settings.ChatGPTAccount, revision uint64) error {
	if a.SessionRevision != revision || a.Lifecycle == "signing_out" || a.Lifecycle == "signed_out" || a.AccessToken == "" {
		return Failure("authorization_required")
	}
	return nil
}

// Startup recovery is separate from ordinary scans, which must never interfere
// with a live sign-out. The operation lock waits for any peer's accepted work.
func (c *Client) recoverSignOuts(ctx context.Context) {
	accounts, err := c.Store.ChatGPTAccounts(ctx)
	if err != nil {
		return
	}
	for id, a := range accounts {
		if a.Lifecycle == "signing_out" {
			_, _ = c.SignOutAccount(ctx, id)
		}
	}
}

// RetryAccount clears only transient scheduling, never logout or a terminal
// authorization fact. All request entrances still share the next attempt.
func (c *Client) RetryAccount(ctx context.Context, id string) error {
	a, ok, err := c.Store.ChatGPTAccount(id)
	if err != nil || !ok {
		return Failure("storage_unavailable")
	}
	if err := c.Store.UpdateChatGPTAccount(ctx, id, func(current *settings.ChatGPTAccount) error { current.RetryAt = time.Time{}; return nil }); err != nil {
		return Failure("storage_unavailable")
	}
	m := c.memory(id)
	if m.revision == a.SessionRevision && m.token == a.AccessToken {
		m.retryAt = time.Time{}
		c.setMemory(id, m)
	}
	_, err = c.accessToken(ctx, id, true)
	return err
}
