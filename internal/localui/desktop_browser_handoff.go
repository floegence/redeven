package localui

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/portforward"
)

const (
	desktopBrowserHandoffMintPath  = "/_redeven_desktop/web-service-browser-handoff"
	desktopBrowserHandoffQueryName = "__redeven_browser_handoff_v1"

	desktopBrowserHandoffTTL    = time.Minute
	desktopBrowserSessionTTL    = 12 * time.Hour
	desktopBrowserPendingLimit  = 128
	desktopBrowserSessionLimit  = 256
	desktopBrowserMintBodyLimit = 16 << 10
)

type desktopBrowserHandoffMintRequest struct {
	ForwardID string `json:"forward_id"`
	AppPath   string `json:"app_path"`
}

type desktopBrowserHandoffMintResponse struct {
	EntryURL        string `json:"entry_url"`
	ExpiresAtUnixMS int64  `json:"expires_at_unix_ms"`
}

type desktopBrowserPendingHandoff struct {
	authority string
	forwardID string
	entryPath string
	cleanPath string
	createdAt time.Time
	expiresAt time.Time
}

type desktopBrowserSession struct {
	authority string
	forwardID string
	value     string
	createdAt time.Time
	expiresAt time.Time
}

type desktopBrowserHandoffStore struct {
	mu       sync.Mutex
	now      func() time.Time
	pending  map[string]desktopBrowserPendingHandoff
	sessions map[string]desktopBrowserSession
}

func (s *desktopBrowserHandoffStore) reset() {
	s.mu.Lock()
	s.pending = nil
	s.sessions = nil
	s.mu.Unlock()
}

func (s *desktopBrowserHandoffStore) currentTime() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

func (s *desktopBrowserHandoffStore) ensureMapsLocked() {
	if s.pending == nil {
		s.pending = make(map[string]desktopBrowserPendingHandoff)
	}
	if s.sessions == nil {
		s.sessions = make(map[string]desktopBrowserSession)
	}
}

func desktopBrowserSessionKey(authority, forwardID string) string {
	return authority + "\x00" + forwardID
}

func (s *desktopBrowserHandoffStore) cleanupLocked(now time.Time) {
	for token, pending := range s.pending {
		if !now.Before(pending.expiresAt) {
			delete(s.pending, token)
		}
	}
	for key, session := range s.sessions {
		if !now.Before(session.expiresAt) {
			delete(s.sessions, key)
		}
	}
}

func evictOldestPending(pending map[string]desktopBrowserPendingHandoff, limit int) {
	if len(pending) < limit {
		return
	}
	tokens := make([]string, 0, len(pending))
	for token := range pending {
		tokens = append(tokens, token)
	}
	sort.Slice(tokens, func(i, j int) bool {
		return pending[tokens[i]].createdAt.Before(pending[tokens[j]].createdAt)
	})
	delete(pending, tokens[0])
}

func evictOldestSession(sessions map[string]desktopBrowserSession, limit int) {
	if len(sessions) < limit {
		return
	}
	keys := make([]string, 0, len(sessions))
	for key := range sessions {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		return sessions[keys[i]].createdAt.Before(sessions[keys[j]].createdAt)
	})
	delete(sessions, keys[0])
}

func normalizeDesktopBrowserAppPath(raw string) (*url.URL, string, error) {
	value := strings.TrimSpace(raw)
	if value == "" || len(value) > desktopBrowserMintBodyLimit || !strings.HasPrefix(value, "/") {
		return nil, "", errors.New("invalid Web Service application path")
	}
	u, err := url.Parse(value)
	if err != nil || u == nil || u.IsAbs() || u.Host != "" || u.User != nil || u.Opaque != "" || strings.HasPrefix(value, "//") {
		return nil, "", errors.New("invalid Web Service application path")
	}
	if _, reserved := u.Query()[desktopBrowserHandoffQueryName]; reserved {
		return nil, "", errors.New("web Service application path uses a reserved query parameter")
	}
	cleanPath := u.EscapedPath()
	if cleanPath == "" {
		cleanPath = "/"
	}
	if u.RawQuery != "" {
		cleanPath += "?" + u.RawQuery
	}
	if u.Fragment != "" {
		cleanPath += "#" + u.EscapedFragment()
	}
	return u, cleanPath, nil
}

func desktopBrowserPortForwardAuthority(loopbackAuthority, forwardID string) (string, error) {
	_, port, err := net.SplitHostPort(loopbackAuthority)
	if err != nil || port == "" || !portforward.IsValidForwardID(forwardID) {
		return "", errors.New("invalid Desktop bridge authority")
	}
	return net.JoinHostPort("pf-"+strings.ToLower(forwardID)+".localhost", port), nil
}

func (s *desktopBrowserHandoffStore) mint(loopbackAuthority, forwardID, appPath string) (desktopBrowserHandoffMintResponse, error) {
	cleanForwardID := strings.TrimSpace(forwardID)
	appURL, cleanPath, err := normalizeDesktopBrowserAppPath(appPath)
	if err != nil {
		return desktopBrowserHandoffMintResponse{}, err
	}
	authority, err := desktopBrowserPortForwardAuthority(loopbackAuthority, cleanForwardID)
	if err != nil {
		return desktopBrowserHandoffMintResponse{}, err
	}
	token, err := randomB64u(32)
	if err != nil {
		return desktopBrowserHandoffMintResponse{}, fmt.Errorf("generate browser handoff: %w", err)
	}
	entryURL := *appURL
	entryURL.Scheme = "http"
	entryURL.Host = authority
	query := entryURL.Query()
	query.Set(desktopBrowserHandoffQueryName, token)
	entryURL.RawQuery = query.Encode()
	entryPath := entryURL.EscapedPath()
	if entryURL.RawQuery != "" {
		entryPath += "?" + entryURL.RawQuery
	}
	now := s.currentTime()
	pending := desktopBrowserPendingHandoff{
		authority: authority,
		forwardID: cleanForwardID,
		entryPath: entryPath,
		cleanPath: cleanPath,
		createdAt: now,
		expiresAt: now.Add(desktopBrowserHandoffTTL),
	}
	s.mu.Lock()
	s.ensureMapsLocked()
	s.cleanupLocked(now)
	evictOldestPending(s.pending, desktopBrowserPendingLimit)
	s.pending[token] = pending
	s.mu.Unlock()
	return desktopBrowserHandoffMintResponse{
		EntryURL:        entryURL.String(),
		ExpiresAtUnixMS: pending.expiresAt.UnixMilli(),
	}, nil
}

func (s *desktopBrowserHandoffStore) redeem(authority, forwardID, token, entryPath string) (desktopBrowserSession, string, bool) {
	now := s.currentTime()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureMapsLocked()
	s.cleanupLocked(now)
	pending, ok := s.pending[token]
	if !ok {
		return desktopBrowserSession{}, "", false
	}
	delete(s.pending, token)
	if pending.authority != authority || pending.forwardID != forwardID || pending.entryPath != entryPath || !now.Before(pending.expiresAt) {
		return desktopBrowserSession{}, "", false
	}
	value, err := randomB64u(32)
	if err != nil {
		return desktopBrowserSession{}, "", false
	}
	session := desktopBrowserSession{
		authority: authority,
		forwardID: forwardID,
		value:     value,
		createdAt: now,
		expiresAt: now.Add(desktopBrowserSessionTTL),
	}
	key := desktopBrowserSessionKey(authority, forwardID)
	if _, exists := s.sessions[key]; !exists {
		evictOldestSession(s.sessions, desktopBrowserSessionLimit)
	}
	s.sessions[key] = session
	return session, pending.cleanPath, true
}

func (s *desktopBrowserHandoffStore) authorize(authority, forwardID string, cookies []*http.Cookie) bool {
	now := s.currentTime()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureMapsLocked()
	s.cleanupLocked(now)
	session, ok := s.sessions[desktopBrowserSessionKey(authority, forwardID)]
	if !ok || !now.Before(session.expiresAt) {
		return false
	}
	for _, cookie := range cookies {
		if cookie == nil || cookie.Name != appserver.LocalUIPortForwardBrowserSessionCookieName || len(cookie.Value) != len(session.value) {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(session.value)) == 1 {
			return true
		}
	}
	return false
}

func (s *Server) handleDesktopBrowserHandoffMint(w http.ResponseWriter, r *http.Request, loopbackAuthority string) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, desktopBrowserMintBodyLimit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var request desktopBrowserHandoffMintRequest
	if err := decoder.Decode(&request); err != nil {
		http.Error(w, "invalid browser handoff request", http.StatusBadRequest)
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		http.Error(w, "invalid browser handoff request", http.StatusBadRequest)
		return
	}
	response, err := s.desktopBrowserHandoffs.mint(loopbackAuthority, request.ForwardID, request.AppPath)
	if err != nil {
		http.Error(w, "invalid browser handoff request", http.StatusBadRequest)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	encoder := json.NewEncoder(w)
	if err := encoder.Encode(response); err != nil {
		s.log.Error("write Desktop browser handoff response", "error", err)
	}
}

func desktopBrowserHandoffEntryPath(r *http.Request) (string, string, bool) {
	if r == nil || r.URL == nil {
		return "", "", false
	}
	values, ok := r.URL.Query()[desktopBrowserHandoffQueryName]
	if !ok {
		return "", "", false
	}
	if len(values) != 1 || strings.TrimSpace(values[0]) == "" {
		return "", "", true
	}
	entryPath := r.URL.EscapedPath()
	if entryPath == "" {
		entryPath = "/"
	}
	if r.URL.RawQuery != "" {
		entryPath += "?" + r.URL.RawQuery
	}
	return values[0], entryPath, true
}

func (s *Server) redeemDesktopBrowserHandoff(w http.ResponseWriter, r *http.Request, authority, forwardID string) bool {
	token, entryPath, present := desktopBrowserHandoffEntryPath(r)
	if !present {
		return false
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if r.Method != http.MethodGet || token == "" {
		http.Error(w, "invalid browser handoff", http.StatusUnauthorized)
		return true
	}
	session, cleanPath, ok := s.desktopBrowserHandoffs.redeem(authority, forwardID, token, entryPath)
	if !ok {
		http.Error(w, "invalid or expired browser handoff", http.StatusUnauthorized)
		return true
	}
	http.SetCookie(w, &http.Cookie{
		Name:     appserver.LocalUIPortForwardBrowserSessionCookieName,
		Value:    session.value,
		Path:     "/",
		Expires:  session.expiresAt,
		MaxAge:   int(desktopBrowserSessionTTL / time.Second),
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
	http.Redirect(w, r, cleanPath, http.StatusSeeOther)
	return true
}
