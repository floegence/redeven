package accessgate

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/floegence/redeven/internal/session"
	"golang.org/x/crypto/bcrypt"
)

const (
	DefaultResumeTTL       = 12 * time.Hour
	DefaultLocalSessionTTL = 12 * time.Hour
	LocalSessionCookieName = "redeven_local_access"
)

type Options struct {
	Logger          *slog.Logger
	Password        string
	ResumeTTL       time.Duration
	LocalSessionTTL time.Duration
	AttemptPolicy   AttemptPolicy
}

type Status struct {
	PasswordRequired  bool   `json:"password_required"`
	TwoFactorRequired bool   `json:"two_factor_required"`
	Unlocked          bool   `json:"unlocked"`
	FloeApp           string `json:"floe_app,omitempty"`
	CodeSpaceID       string `json:"code_space_id,omitempty"`
	SessionKind       string `json:"session_kind,omitempty"`
}

type UnlockResult struct {
	SecondFactorRequired bool   `json:"second_factor_required,omitempty"`
	ChallengeID          string `json:"challenge_id,omitempty"`
	Unlocked             bool   `json:"unlocked"`
	ResumeToken          string `json:"resume_token,omitempty"`
	ResumeExpiresAtUnix  int64  `json:"resume_expires_at_unix_ms,omitempty"`
}

type LocalSessionResult struct {
	SecondFactorRequired bool   `json:"second_factor_required,omitempty"`
	ChallengeID          string `json:"challenge_id,omitempty"`
	Unlocked             bool   `json:"unlocked"`
	SessionToken         string `json:"-"`
	AccessSessionID      string `json:"-"`
	SessionExpiresAtUnix int64  `json:"session_expires_at_unix_ms,omitempty"`
	ResumeToken          string `json:"resume_token,omitempty"`
	ResumeExpiresAtUnix  int64  `json:"resume_expires_at_unix_ms,omitempty"`
}

type RegisterChannelOptions struct {
	// Cancel closes the channel on revocation or expiry. It must not call back into Gate.
	Cancel          func()
	Trusted         bool
	AccessSessionID string
}

type channelState struct {
	trusted         bool
	cancel          func()
	expiryTimer     *time.Timer
	expiresAt       time.Time
	accessSessionID string
	meta            session.Meta
	unlocked        bool
	unlockedAt      time.Time
}

type resumeTokenState struct {
	accessSessionID string
	userPublicID    string
	endpointID      string
	floeApp         string
	codeSpaceID     string
	sessionKind     string
	expiresAt       time.Time
}

type localSessionState struct {
	accessSessionID string
	expiresAt       time.Time
}

type ExpiredLocalSession struct {
	AccessSessionID string
}

type failedAttemptState struct {
	failures      int
	lastFailedAt  time.Time
	cooldownUntil time.Time
}

type Gate struct {
	log             *slog.Logger
	enabled         atomic.Bool
	passwordHash    []byte
	resumeTTL       time.Duration
	localSessionTTL time.Duration
	attemptPolicy   AttemptPolicy

	authMu         sync.Mutex
	store          *authStore
	auth           authState
	challenges     map[string]*authChallenge
	management     map[string]*managementOperation
	delegations    map[string]*childDelegation
	revoked        []ExpiredLocalSession
	mu             sync.Mutex
	channels       map[string]*channelState
	resumeTokens   map[string]*resumeTokenState
	localSessions  map[string]*localSessionState
	failedAttempts map[string]*failedAttemptState
}

func New(opts Options) *Gate {
	resumeTTL := opts.ResumeTTL
	if resumeTTL <= 0 {
		resumeTTL = DefaultResumeTTL
	}
	localSessionTTL := opts.LocalSessionTTL
	if localSessionTTL <= 0 {
		localSessionTTL = DefaultLocalSessionTTL
	}

	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}

	password := opts.Password
	enabled := password != ""
	var passwordHash []byte
	if enabled {
		// An unusable credential must deny access, never disable authentication.
		passwordHash, _ = bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	}
	attemptPolicy := normalizeAttemptPolicy(opts.AttemptPolicy)

	gate := &Gate{
		log: logger,

		passwordHash:    passwordHash,
		resumeTTL:       resumeTTL,
		localSessionTTL: localSessionTTL,
		attemptPolicy:   attemptPolicy,
		channels:        make(map[string]*channelState),
		resumeTokens:    make(map[string]*resumeTokenState),
		localSessions:   make(map[string]*localSessionState),
		failedAttempts:  make(map[string]*failedAttemptState),
	}
	gate.enabled.Store(enabled)
	gate.auth = authState{PasswordHash: passwordHash, Revision: 1, LastStep: -1}
	gate.challenges = make(map[string]*authChallenge)
	gate.management = make(map[string]*managementOperation)
	gate.delegations = make(map[string]*childDelegation)
	return gate
}

// NewWithPasswordHash restores server-owned authentication without retaining a
// plaintext password. An empty hash explicitly disables the gate.
func NewWithPasswordHash(hash []byte) (*Gate, error) {
	if len(hash) > 0 {
		if _, err := bcrypt.Cost(hash); err != nil {
			return nil, errors.New("invalid stored environment password hash")
		}
	}
	gate := New(Options{})
	gate.enabled.Store(len(hash) > 0)
	gate.auth.PasswordHash = append([]byte(nil), hash...)
	gate.passwordHash = append([]byte(nil), hash...)
	return gate, nil
}

func (g *Gate) Enabled() bool {
	return g != nil && g.enabled.Load()
}

func (g *Gate) VerifyPassword(password string) bool {
	if g == nil {
		return true
	}
	g.authMu.Lock()
	defer g.authMu.Unlock()
	return g.verifyPasswordLocked(password)
}

func (g *Gate) verifyPasswordLocked(password string) bool {
	if g == nil || !g.enabled.Load() {
		return true
	}
	if len(g.passwordHash) == 0 {
		return false
	}
	return bcrypt.CompareHashAndPassword(g.passwordHash, []byte(password)) == nil
}

func (g *Gate) RegisterChannel(meta session.Meta) {
	g.RegisterChannelWithOptions(meta, RegisterChannelOptions{})
}

func (g *Gate) RegisterChannelWithOptions(meta session.Meta, opts RegisterChannelOptions) {
	if g == nil {
		return
	}
	channelID := strings.TrimSpace(meta.ChannelID)
	if channelID == "" {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	now := time.Now()
	g.cleanupExpiredLocked(now)
	state := &channelState{
		meta:            meta,
		cancel:          opts.Cancel,
		trusted:         opts.Trusted,
		accessSessionID: opts.AccessSessionID,
		unlocked:        opts.Trusted || !g.enabled.Load(),
	}
	if !state.unlocked && opts.AccessSessionID != "" {
		for _, local := range g.localSessions {
			if local.accessSessionID == opts.AccessSessionID && now.Before(local.expiresAt) {
				state.unlocked = true
				state.expiresAt = local.expiresAt
				break
			}
		}
	}
	if state.unlocked {
		state.unlockedAt = now
	}
	if old := g.channels[channelID]; old != nil && old.expiryTimer != nil {
		old.expiryTimer.Stop()
	}
	g.channels[channelID] = state
	g.scheduleChannelExpiryLocked(channelID, state)
}

func (g *Gate) UnregisterChannel(channelID string) {
	if g == nil {
		return
	}
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return
	}
	g.mu.Lock()
	if st := g.channels[channelID]; st != nil && st.expiryTimer != nil {
		st.expiryTimer.Stop()
	}
	delete(g.channels, channelID)
	g.mu.Unlock()
}

func (g *Gate) Status(channelID string) Status {
	if g == nil || !g.enabled.Load() {
		return Status{PasswordRequired: false, Unlocked: true}
	}
	mfa := g.TwoFactorEnabled()
	channelID = strings.TrimSpace(channelID)
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupExpiredLocked(time.Now())
	st := g.channels[channelID]
	if st == nil {
		return Status{PasswordRequired: true, TwoFactorRequired: mfa, Unlocked: false}
	}
	return Status{
		PasswordRequired:  true,
		TwoFactorRequired: mfa, Unlocked: st.unlocked,
		FloeApp:     strings.TrimSpace(st.meta.FloeApp),
		CodeSpaceID: strings.TrimSpace(st.meta.CodeSpaceID),
		SessionKind: strings.TrimSpace(st.meta.SessionKind),
	}
}

func (g *Gate) IsChannelUnlocked(channelID string) bool {
	return g.Status(channelID).Unlocked
}

func (g *Gate) UnlockChannel(channelID string, password string) (*UnlockResult, error) {
	return g.UnlockChannelWithSubject(channelID, password, "")
}

func (g *Gate) issueChannel(channelID string) (*UnlockResult, error) {
	if g == nil || !g.enabled.Load() {
		return &UnlockResult{Unlocked: true}, nil
	}
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return nil, errors.New("missing channel_id")
	}

	now := time.Now()
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupExpiredLocked(now)
	st := g.channels[channelID]
	if st == nil {
		return nil, errors.New("channel not found")
	}
	accessSessionID, err := randomToken(24)
	if err != nil {
		return nil, err
	}

	out := &UnlockResult{Unlocked: true}
	if shouldMintResumeTokenLocked(st.meta) {
		resumeToken, expiresAt, err := g.mintResumeTokenLocked(now, st.meta, accessSessionID)
		if err != nil {
			return nil, err
		}
		out.ResumeToken = resumeToken
		out.ResumeExpiresAtUnix = expiresAt.UnixMilli()
	}
	st.unlocked = true
	st.unlockedAt = now
	st.expiresAt = now.Add(g.resumeTTL)
	st.accessSessionID = accessSessionID
	g.scheduleChannelExpiryLocked(channelID, st)
	return out, nil
}

func (g *Gate) MintLocalSession(password string) (*LocalSessionResult, error) {
	return g.MintLocalSessionWithSubject(password, "")
}

func (g *Gate) issueLocalSession() (*LocalSessionResult, error) {
	if g == nil || !g.enabled.Load() {
		return &LocalSessionResult{Unlocked: true}, nil
	}
	now := time.Now()
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupExpiredLocked(now)

	lineageExpiresAt := now.Add(g.resumeTTL)
	sessionToken, accessSessionID, expiresAt, err := g.mintLocalSessionLocked(now, "", lineageExpiresAt)
	if err != nil {
		return nil, err
	}

	resumeToken, resumeExpiresAt, err := g.mintResumeTokenLocked(now, session.Meta{
		ChannelID:         "local-ui",
		EndpointID:        "env_local",
		FloeApp:           "com.floegence.redeven.agent",
		CodeSpaceID:       "env-ui",
		SessionKind:       "envapp_rpc",
		UserPublicID:      "user_local",
		UserEmail:         "local@redeven",
		NamespacePublicID: "ns_local",
	}, accessSessionID)
	if err != nil {
		return nil, err
	}

	return &LocalSessionResult{
		Unlocked:             true,
		SessionToken:         sessionToken,
		AccessSessionID:      accessSessionID,
		SessionExpiresAtUnix: expiresAt.UnixMilli(),
		ResumeToken:          resumeToken,
		ResumeExpiresAtUnix:  resumeExpiresAt.UnixMilli(),
	}, nil
}

func (g *Gate) MintLocalSessionFromResumeToken(resumeToken string, meta session.Meta) (*LocalSessionResult, error) {
	if g == nil || !g.enabled.Load() {
		return &LocalSessionResult{Unlocked: true}, nil
	}
	resumeToken = strings.TrimSpace(resumeToken)
	if resumeToken == "" {
		return nil, errors.New("missing resume token")
	}

	now := time.Now()
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupExpiredLocked(now)

	if err := g.validateResumeTokenLocked(now, resumeToken, meta); err != nil {
		return nil, err
	}
	resume := g.resumeTokens[resumeToken]
	if resume == nil || strings.TrimSpace(resume.accessSessionID) == "" {
		return nil, errors.New("resume token access session is unavailable")
	}

	sessionToken, accessSessionID, expiresAt, err := g.mintLocalSessionLocked(now, resume.accessSessionID, resume.expiresAt)
	if err != nil {
		return nil, err
	}

	return &LocalSessionResult{
		Unlocked:             true,
		SessionToken:         sessionToken,
		AccessSessionID:      accessSessionID,
		SessionExpiresAtUnix: expiresAt.UnixMilli(),
	}, nil
}

func (g *Gate) IsLocalSessionValid(token string) bool {
	if g == nil || !g.enabled.Load() {
		return true
	}
	_, ok := g.LocalSessionExpiresAt(token)
	return ok
}

// LocalSessionExpiresAt resolves the active deadline for an opaque Local UI
// session token without exposing any other session state to callers.
func (g *Gate) LocalSessionExpiresAt(token string) (time.Time, bool) {
	_, expiresAt, ok := g.ResolveLocalSession(token)
	return expiresAt, ok
}

func (g *Gate) ResolveLocalSession(token string) (string, time.Time, bool) {
	if g == nil || !g.enabled.Load() {
		return "", time.Time{}, false
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return "", time.Time{}, false
	}
	now := time.Now()
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupExpiredLocked(now)
	st := g.localSessions[token]
	if st == nil || now.After(st.expiresAt) {
		return "", time.Time{}, false
	}
	return st.accessSessionID, st.expiresAt, true
}

func (g *Gate) TakeLocalSession(token string) (string, bool) {
	if g == nil || !g.enabled.Load() {
		return "", false
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return "", false
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	st := g.localSessions[token]
	if st == nil || strings.TrimSpace(st.accessSessionID) == "" {
		return "", false
	}
	g.revokeAccessSessionLocked(st.accessSessionID)
	return st.accessSessionID, true
}

// TakeAccessSessionByResumeToken revokes the complete access-session lineage
// identified by an active resume token and returns its opaque internal ID.
func (g *Gate) TakeAccessSessionByResumeToken(resumeToken string) (string, bool) {
	if g == nil || !g.enabled.Load() {
		return "", false
	}
	resumeToken = strings.TrimSpace(resumeToken)
	if resumeToken == "" {
		return "", false
	}
	now := time.Now()
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupExpiredLocked(now)
	st := g.resumeTokens[resumeToken]
	if st == nil || strings.TrimSpace(st.accessSessionID) == "" || !now.Before(st.expiresAt) {
		return "", false
	}
	g.revokeAccessSessionLocked(st.accessSessionID)
	return st.accessSessionID, true
}

func (g *Gate) TakeExpiredLocalSessions(now time.Time) []ExpiredLocalSession {
	if g == nil || !g.enabled.Load() {
		return nil
	}
	if now.IsZero() {
		now = time.Now()
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	expiredIDs := make(map[string]struct{})
	for token, st := range g.localSessions {
		if st == nil || now.After(st.expiresAt) {
			delete(g.localSessions, token)
			if st != nil && strings.TrimSpace(st.accessSessionID) != "" {
				expiredIDs[st.accessSessionID] = struct{}{}
			}
		}
	}
	for _, st := range g.localSessions {
		if st != nil {
			delete(expiredIDs, st.accessSessionID)
		}
	}
	expired := append([]ExpiredLocalSession(nil), g.revoked...)
	g.revoked = nil
	for accessSessionID := range expiredIDs {
		expired = append(expired, ExpiredLocalSession{AccessSessionID: accessSessionID})
		for token, resume := range g.resumeTokens {
			if resume != nil && resume.accessSessionID == accessSessionID {
				delete(g.resumeTokens, token)
			}
		}
	}
	return expired
}

func (g *Gate) RevokeLocalSession(token string) {
	_, _ = g.TakeLocalSession(token)
}

func (g *Gate) RevokeResumeToken(resumeToken string) {
	if g == nil || !g.enabled.Load() {
		return
	}
	resumeToken = strings.TrimSpace(resumeToken)
	if resumeToken == "" {
		return
	}
	g.mu.Lock()
	delete(g.resumeTokens, resumeToken)
	g.mu.Unlock()
}

func (g *Gate) CanResumeMeta(resumeToken string, meta session.Meta) bool {
	if g == nil || !g.enabled.Load() {
		return true
	}
	resumeToken = strings.TrimSpace(resumeToken)
	if resumeToken == "" {
		return false
	}
	now := time.Now()
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupExpiredLocked(now)
	return g.validateResumeTokenLocked(now, resumeToken, meta) == nil
}

func (g *Gate) ResumeChannel(channelID string, resumeToken string) error {
	if g == nil || !g.enabled.Load() {
		return nil
	}
	channelID = strings.TrimSpace(channelID)
	resumeToken = strings.TrimSpace(resumeToken)
	if channelID == "" || resumeToken == "" {
		return errors.New("missing channel_id or resume_token")
	}
	now := time.Now()
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupExpiredLocked(now)

	st := g.channels[channelID]
	if st == nil {
		return errors.New("channel not found")
	}
	if err := g.validateResumeTokenLocked(now, resumeToken, st.meta); err != nil {
		return err
	}
	st.unlocked = true
	st.unlockedAt = now
	st.expiresAt = g.resumeTokens[resumeToken].expiresAt
	st.accessSessionID = g.resumeTokens[resumeToken].accessSessionID
	g.scheduleChannelExpiryLocked(channelID, st)
	return nil
}

func (g *Gate) cleanupExpiredLocked(now time.Time) {
	for _, st := range g.channels {
		if st.unlocked && !st.expiresAt.IsZero() && !now.Before(st.expiresAt) {
			st.unlocked = false
			if st.cancel != nil {
				st.cancel()
			}
		}
	}
	for token, st := range g.resumeTokens {
		if st == nil || now.After(st.expiresAt) {
			delete(g.resumeTokens, token)
		}
	}
	for subject, st := range g.failedAttempts {
		if st == nil {
			delete(g.failedAttempts, subject)
			continue
		}
		if !st.cooldownUntil.IsZero() && now.Before(st.cooldownUntil) {
			continue
		}
		if st.lastFailedAt.IsZero() || now.Sub(st.lastFailedAt) >= g.attemptPolicy.Retention {
			delete(g.failedAttempts, subject)
		}
	}
}

func shouldMintResumeTokenLocked(meta session.Meta) bool {
	switch strings.TrimSpace(meta.FloeApp) {
	case "com.floegence.redeven.agent":
		return strings.TrimSpace(meta.CodeSpaceID) == "env-ui"
	case "com.floegence.redeven.code", "com.floegence.redeven.portforward":
		return strings.TrimSpace(meta.CodeSpaceID) != ""
	default:
		return false
	}
}

func normalizeSessionKind(sessionKind string) string {
	normalized := strings.TrimSpace(sessionKind)
	if normalized == "" || normalized == "envapp_proxy" {
		return "envapp_rpc"
	}
	return normalized
}

func resumeTokenMatchesMeta(tok *resumeTokenState, meta session.Meta) bool {
	if tok == nil {
		return false
	}
	return tok.userPublicID == strings.TrimSpace(meta.UserPublicID) &&
		tok.endpointID == strings.TrimSpace(meta.EndpointID) &&
		tok.floeApp == strings.TrimSpace(meta.FloeApp) &&
		tok.codeSpaceID == strings.TrimSpace(meta.CodeSpaceID) &&
		tok.sessionKind == normalizeSessionKind(meta.SessionKind)
}

func (g *Gate) validateResumeTokenLocked(now time.Time, resumeToken string, meta session.Meta) error {
	tok := g.resumeTokens[resumeToken]
	if tok == nil || now.After(tok.expiresAt) {
		return errors.New("invalid resume token")
	}
	if !resumeTokenMatchesMeta(tok, meta) {
		return errors.New("resume token binding mismatch")
	}
	return nil
}

func (g *Gate) revokeAccessSessionLocked(accessSessionID string) {
	for token, d := range g.delegations {
		if d.parent.accessSessionID == accessSessionID {
			delete(g.delegations, token)
		}
	}
	for _, st := range g.channels {
		if st.accessSessionID == accessSessionID {
			st.unlocked = false
			if st.cancel != nil {
				st.cancel()
			}
		}
	}
	for candidate, local := range g.localSessions {
		if local != nil && local.accessSessionID == accessSessionID {
			delete(g.localSessions, candidate)
		}
	}
	for candidate, resume := range g.resumeTokens {
		if resume != nil && resume.accessSessionID == accessSessionID {
			delete(g.resumeTokens, candidate)
		}
	}
}

func (g *Gate) mintLocalSessionLocked(now time.Time, accessSessionID string, lineageExpiresAt time.Time) (string, string, time.Time, error) {
	sessionToken, err := randomToken(24)
	if err != nil {
		return "", "", time.Time{}, err
	}
	accessSessionID = strings.TrimSpace(accessSessionID)
	if accessSessionID == "" {
		accessSessionID, err = randomToken(24)
		if err != nil {
			return "", "", time.Time{}, err
		}
	}
	expiresAt := now.Add(g.localSessionTTL)
	if !lineageExpiresAt.IsZero() && lineageExpiresAt.Before(expiresAt) {
		expiresAt = lineageExpiresAt
	}
	g.localSessions[sessionToken] = &localSessionState{accessSessionID: accessSessionID, expiresAt: expiresAt}
	return sessionToken, accessSessionID, expiresAt, nil
}

func (g *Gate) mintResumeTokenLocked(now time.Time, meta session.Meta, accessSessionID string) (string, time.Time, error) {
	resumeToken, err := randomToken(32)
	if err != nil {
		return "", time.Time{}, err
	}
	sessionKind := normalizeSessionKind(meta.SessionKind)
	expiresAt := now.Add(g.resumeTTL)
	g.resumeTokens[resumeToken] = &resumeTokenState{
		accessSessionID: strings.TrimSpace(accessSessionID),
		userPublicID:    strings.TrimSpace(meta.UserPublicID),
		endpointID:      strings.TrimSpace(meta.EndpointID),
		floeApp:         strings.TrimSpace(meta.FloeApp),
		codeSpaceID:     strings.TrimSpace(meta.CodeSpaceID),
		sessionKind:     sessionKind,
		expiresAt:       expiresAt,
	}
	return resumeToken, expiresAt, nil
}

func randomToken(n int) (string, error) {
	if n <= 0 {
		return "", errors.New("invalid token length")
	}
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func (g *Gate) verifyPasswordForSubject(password string, subject string) error {
	if g == nil || !g.enabled.Load() {
		return nil
	}

	now := time.Now()
	subjectKey := normalizeAttemptSubject(subject)

	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupExpiredLocked(now)

	if retryAfter := g.retryAfterLocked(now, subjectKey); retryAfter > 0 {
		return &RateLimitError{RetryAfter: retryAfter}
	}
	if g.verifyPasswordLocked(password) {
		delete(g.failedAttempts, subjectKey)
		return nil
	}
	return g.recordFailedAttemptLocked(time.Now(), subjectKey)
}

func (g *Gate) retryAfterLocked(now time.Time, subject string) time.Duration {
	st := g.failedAttempts[subject]
	if st == nil || st.cooldownUntil.IsZero() || !now.Before(st.cooldownUntil) {
		return 0
	}
	return st.cooldownUntil.Sub(now)
}

func (g *Gate) recordFailedAttemptLocked(now time.Time, subject string) error {
	st := g.failedAttempts[subject]
	if st == nil {
		st = &failedAttemptState{}
		g.failedAttempts[subject] = st
	}
	st.failures++
	st.lastFailedAt = now

	cooldown := g.cooldownForFailuresLocked(st.failures)
	if cooldown <= 0 {
		st.cooldownUntil = time.Time{}
		return ErrInvalidPassword
	}
	st.cooldownUntil = now.Add(cooldown)
	return &RateLimitError{RetryAfter: cooldown}
}

func (g *Gate) cooldownForFailuresLocked(failures int) time.Duration {
	cooldown := time.Duration(0)
	for _, step := range g.attemptPolicy.Steps {
		if failures < step.Failures {
			break
		}
		cooldown = step.Cooldown
	}
	return cooldown
}
