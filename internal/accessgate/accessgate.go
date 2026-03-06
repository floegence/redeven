package accessgate

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven-agent/internal/session"
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
}

type Status struct {
	PasswordRequired bool   `json:"password_required"`
	Unlocked         bool   `json:"unlocked"`
	FloeApp          string `json:"floe_app,omitempty"`
	CodeSpaceID      string `json:"code_space_id,omitempty"`
	SessionKind      string `json:"session_kind,omitempty"`
}

type UnlockResult struct {
	Unlocked            bool   `json:"unlocked"`
	ResumeToken         string `json:"resume_token,omitempty"`
	ResumeExpiresAtUnix int64  `json:"resume_expires_at_unix_ms,omitempty"`
}

type LocalSessionResult struct {
	Unlocked             bool   `json:"unlocked"`
	SessionToken         string `json:"-"`
	SessionExpiresAtUnix int64  `json:"session_expires_at_unix_ms,omitempty"`
	ResumeToken          string `json:"resume_token,omitempty"`
	ResumeExpiresAtUnix  int64  `json:"resume_expires_at_unix_ms,omitempty"`
}

type channelState struct {
	meta       session.Meta
	unlocked   bool
	unlockedAt time.Time
}

type resumeTokenState struct {
	userPublicID string
	endpointID   string
	floeApp      string
	codeSpaceID  string
	sessionKind  string
	expiresAt    time.Time
}

type localSessionState struct {
	expiresAt time.Time
}

type Gate struct {
	log             *slog.Logger
	enabled         bool
	passwordDigest  [32]byte
	resumeTTL       time.Duration
	localSessionTTL time.Duration

	mu            sync.Mutex
	channels      map[string]*channelState
	resumeTokens  map[string]*resumeTokenState
	localSessions map[string]*localSessionState
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
	digest := sha256.Sum256([]byte(password))

	return &Gate{
		log:             logger,
		enabled:         enabled,
		passwordDigest:  digest,
		resumeTTL:       resumeTTL,
		localSessionTTL: localSessionTTL,
		channels:        make(map[string]*channelState),
		resumeTokens:    make(map[string]*resumeTokenState),
		localSessions:   make(map[string]*localSessionState),
	}
}

func (g *Gate) Enabled() bool {
	return g != nil && g.enabled
}

func (g *Gate) VerifyPassword(password string) bool {
	if g == nil || !g.enabled {
		return true
	}
	candidate := sha256.Sum256([]byte(password))
	return subtle.ConstantTimeCompare(candidate[:], g.passwordDigest[:]) == 1
}

func (g *Gate) RegisterChannel(meta session.Meta) {
	if g == nil || !g.enabled {
		return
	}
	channelID := strings.TrimSpace(meta.ChannelID)
	if channelID == "" {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupExpiredLocked(time.Now())
	metaCopy := meta
	g.channels[channelID] = &channelState{meta: metaCopy}
}

func (g *Gate) UnregisterChannel(channelID string) {
	if g == nil || !g.enabled {
		return
	}
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return
	}
	g.mu.Lock()
	delete(g.channels, channelID)
	g.mu.Unlock()
}

func (g *Gate) Status(channelID string) Status {
	if g == nil || !g.enabled {
		return Status{PasswordRequired: false, Unlocked: true}
	}
	channelID = strings.TrimSpace(channelID)
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupExpiredLocked(time.Now())
	st := g.channels[channelID]
	if st == nil {
		return Status{PasswordRequired: true, Unlocked: false}
	}
	return Status{
		PasswordRequired: true,
		Unlocked:         st.unlocked,
		FloeApp:          strings.TrimSpace(st.meta.FloeApp),
		CodeSpaceID:      strings.TrimSpace(st.meta.CodeSpaceID),
		SessionKind:      strings.TrimSpace(st.meta.SessionKind),
	}
}

func (g *Gate) IsChannelUnlocked(channelID string) bool {
	return g.Status(channelID).Unlocked
}

func (g *Gate) UnlockChannel(channelID string, password string) (*UnlockResult, error) {
	if g == nil || !g.enabled {
		return &UnlockResult{Unlocked: true}, nil
	}
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return nil, errors.New("missing channel_id")
	}
	if !g.VerifyPassword(password) {
		return nil, errors.New("invalid password")
	}

	now := time.Now()
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupExpiredLocked(now)
	st := g.channels[channelID]
	if st == nil {
		return nil, errors.New("channel not found")
	}
	st.unlocked = true
	st.unlockedAt = now

	out := &UnlockResult{Unlocked: true}
	if shouldMintResumeTokenLocked(st.meta) {
		resumeToken, expiresAt, err := g.mintResumeTokenLocked(now, st.meta)
		if err != nil {
			return nil, err
		}
		out.ResumeToken = resumeToken
		out.ResumeExpiresAtUnix = expiresAt.UnixMilli()
	}
	return out, nil
}

func (g *Gate) MintLocalSession(password string) (*LocalSessionResult, error) {
	if g == nil || !g.enabled {
		return &LocalSessionResult{Unlocked: true}, nil
	}
	if !g.VerifyPassword(password) {
		return nil, errors.New("invalid password")
	}
	now := time.Now()
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupExpiredLocked(now)

	sessionToken, err := randomToken(24)
	if err != nil {
		return nil, err
	}
	expiresAt := now.Add(g.localSessionTTL)
	g.localSessions[sessionToken] = &localSessionState{expiresAt: expiresAt}

	resumeToken, resumeExpiresAt, err := g.mintResumeTokenLocked(now, session.Meta{
		ChannelID:         "local-ui",
		EndpointID:        "env_local",
		FloeApp:           "com.floegence.redeven.agent",
		CodeSpaceID:       "env-ui",
		SessionKind:       "envapp_rpc",
		UserPublicID:      "user_local",
		UserEmail:         "local@redeven",
		NamespacePublicID: "ns_local",
	})
	if err != nil {
		return nil, err
	}

	return &LocalSessionResult{
		Unlocked:             true,
		SessionToken:         sessionToken,
		SessionExpiresAtUnix: expiresAt.UnixMilli(),
		ResumeToken:          resumeToken,
		ResumeExpiresAtUnix:  resumeExpiresAt.UnixMilli(),
	}, nil
}

func (g *Gate) IsLocalSessionValid(token string) bool {
	if g == nil || !g.enabled {
		return true
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return false
	}
	now := time.Now()
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cleanupExpiredLocked(now)
	st := g.localSessions[token]
	return st != nil && !now.After(st.expiresAt)
}

func (g *Gate) RevokeLocalSession(token string) {
	if g == nil || !g.enabled {
		return
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return
	}
	g.mu.Lock()
	delete(g.localSessions, token)
	g.mu.Unlock()
}

func (g *Gate) ResumeChannel(channelID string, resumeToken string) error {
	if g == nil || !g.enabled {
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
	tok := g.resumeTokens[resumeToken]
	if tok == nil || now.After(tok.expiresAt) {
		return errors.New("invalid resume token")
	}
	if tok.userPublicID != strings.TrimSpace(st.meta.UserPublicID) ||
		tok.endpointID != strings.TrimSpace(st.meta.EndpointID) ||
		tok.floeApp != strings.TrimSpace(st.meta.FloeApp) ||
		tok.codeSpaceID != strings.TrimSpace(st.meta.CodeSpaceID) ||
		tok.sessionKind != strings.TrimSpace(st.meta.SessionKind) {
		return errors.New("resume token binding mismatch")
	}
	st.unlocked = true
	st.unlockedAt = now
	return nil
}

func (g *Gate) cleanupExpiredLocked(now time.Time) {
	for token, st := range g.resumeTokens {
		if st == nil || now.After(st.expiresAt) {
			delete(g.resumeTokens, token)
		}
	}
	for token, st := range g.localSessions {
		if st == nil || now.After(st.expiresAt) {
			delete(g.localSessions, token)
		}
	}
}

func shouldMintResumeTokenLocked(meta session.Meta) bool {
	return strings.TrimSpace(meta.FloeApp) == "com.floegence.redeven.agent" &&
		strings.TrimSpace(meta.CodeSpaceID) == "env-ui"
}

func (g *Gate) mintResumeTokenLocked(now time.Time, meta session.Meta) (string, time.Time, error) {
	resumeToken, err := randomToken(32)
	if err != nil {
		return "", time.Time{}, err
	}
	sessionKind := strings.TrimSpace(meta.SessionKind)
	if sessionKind == "" || sessionKind == "envapp_proxy" {
		sessionKind = "envapp_rpc"
	}
	expiresAt := now.Add(g.resumeTTL)
	g.resumeTokens[resumeToken] = &resumeTokenState{
		userPublicID: strings.TrimSpace(meta.UserPublicID),
		endpointID:   strings.TrimSpace(meta.EndpointID),
		floeApp:      strings.TrimSpace(meta.FloeApp),
		codeSpaceID:  strings.TrimSpace(meta.CodeSpaceID),
		sessionKind:  sessionKind,
		expiresAt:    expiresAt,
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
