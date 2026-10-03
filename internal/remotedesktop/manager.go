package remotedesktop

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"runtime"
	"strings"
	"sync"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/floegence/redeven/internal/portforward"
	"github.com/gorilla/websocket"
)

const ViewerPath = "/_redeven_desktop/"

var (
	ErrAuthorizationBusy = errors.New("desktop authorization is in use")
	ErrUnavailable       = errors.New("remote desktop unavailable")
	ErrInvalid           = errors.New("invalid remote desktop request")
	ErrForbidden         = errors.New("remote desktop owner required")
	ErrNotFound          = errors.New("remote desktop session not found")
	ErrControlInUse      = errors.New("remote desktop control requires takeover")
)

type CreateRequest struct {
	Mode      string `json:"mode"`
	DisplayID string `json:"display_id"`
	Locale    string `json:"locale"`
	Theme     string `json:"theme"`
	HostName  string `json:"host_name"`
	Takeover  bool   `json:"takeover"`
}
type Session struct {
	ID        string `json:"id"`
	ForwardID string `json:"forward_id"`
	TargetURL string `json:"target_url"`
	Mode      string `json:"mode"`
	DisplayID string `json:"display_id"`
	Locale    string `json:"locale"`
	Theme     string `json:"theme"`
	HostName  string `json:"host_name"`
}
type Status struct {
	ApprovalPolicy string                             `json:"approval_policy"`
	Capabilities   nativeapps.HostDesktopCapabilities `json:"capabilities"`
	Setup          *nativeapps.Status                 `json:"setup,omitempty"`
	Unattended     bool                               `json:"unattended"`
	ControlInUse   bool                               `json:"control_in_use"`
	LastDisplayID  string                             `json:"last_display_id"`
}
type ownedSession struct {
	view       Session
	owner      string
	unattended bool
	takeover   bool
	server     *http.Server
	pair       *attachment
	expires    time.Time
}
type Manager struct {
	audit           func(owner, id, event, reason string)
	displaySelected func(id string)
	allowed         func(owner string) bool
	mu              sync.Mutex
	sessions        map[string]*ownedSession
	controller      string
	closed          bool
	forwards        *portforward.Service
	factory         Factory
	setupMu         sync.Mutex
	setup           *nativeapps.Manager
	state           string
	stop            chan struct{}
}

func New(state string, forwards *portforward.Service, mac Factory) *Manager {
	m := &Manager{sessions: map[string]*ownedSession{}, state: state, forwards: forwards, stop: make(chan struct{})}
	switch runtime.GOOS {
	case "darwin":
		m.factory = mac
	case "linux":
		m.factory = m.openLinux
	}
	go m.expire()
	return m
}
func randomID() string {
	var data [24]byte
	if _, err := rand.Read(data[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(data[:])
}

func (m *Manager) Status(ctx context.Context, owner string) (Status, error) {
	status := Status{Capabilities: nativeapps.HostDesktopCapabilities{State: "unsupported", Displays: []nativeapps.HostDesktopDisplay{}}}
	m.mu.Lock()
	status.ControlInUse = m.controller != ""
	closed := m.closed
	m.mu.Unlock()
	if closed || m.factory == nil {
		return status, nil
	}
	if runtime.GOOS == "linux" {
		setup, err := m.SetupStatus(owner)
		if err != nil {
			return status, err
		}
		status.Setup = &setup
		if setup.Installed == nil || !setup.Installed.Ready || setup.UpdateAvailable {
			status.Capabilities.State = "setup_required"
			return status, nil
		}
	}
	connection, err := m.factory(ctx)
	if err != nil {
		status.Capabilities.State = "unavailable"
		return status, nil
	}
	defer connection.Close()
	if err = connection.Send(nativeapps.HostDesktopCommand{Version: 1, ID: 1, Method: "probe"}, false); err != nil {
		return status, err
	}
	select {
	case message := <-connection.Control():
		if message.Capabilities != nil {
			status.Capabilities = *message.Capabilities
		} else {
			status.Capabilities.State = "unavailable"
		}
	case <-connection.Done():
		status.Capabilities.State = "unavailable"
	case <-ctx.Done():
		return status, ctx.Err()
	}
	return status, nil
}

func (m *Manager) Create(ctx context.Context, owner string, req CreateRequest, unattended bool) (Session, error) {
	if owner == "" || req.Mode != "view" && req.Mode != "control" || len(req.Locale) > 32 || len(req.Theme) > 80 || len(req.HostName) > 256 || len(req.DisplayID) > 128 {
		return Session{}, ErrInvalid
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.allowed != nil && !m.allowed(owner) {
		return Session{}, ErrForbidden
	}
	if m.closed || len(m.sessions) >= 8 || m.factory == nil || m.forwards == nil {
		return Session{}, ErrUnavailable
	}
	if req.Mode == "control" && m.controller != "" && !req.Takeover {
		return Session{}, ErrControlInUse
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return Session{}, err
	}
	target := "http://" + listener.Addr().String() + ViewerPath
	forward, err := m.forwards.OpenOwnedForwardSession(ctx, target)
	if err != nil {
		_ = listener.Close()
		return Session{}, err
	}
	// Desktop window admission and target ownership use the registered origin;
	// the viewer path belongs to navigation, not to the service identity.
	session := &ownedSession{view: Session{ID: randomID(), ForwardID: forward.Forward.ForwardID, TargetURL: forward.Forward.TargetURL, Mode: req.Mode, DisplayID: req.DisplayID, Locale: req.Locale, Theme: req.Theme, HostName: req.HostName}, owner: owner, unattended: unattended, takeover: req.Takeover, expires: time.Now().Add(2 * time.Minute)}
	m.sessions[session.view.ID] = session
	if req.Mode == "control" {
		if err := m.claimLocked(session); err != nil {
			m.removeLocked(session)
			_ = listener.Close()
			return Session{}, err
		}
	}
	session.server = &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { m.serveSocket(w, r, session) })}
	go func() { _ = session.server.Serve(listener) }()
	return session.view, nil
}
func (m *Manager) claimLocked(session *ownedSession) error {
	if previous := m.sessions[m.controller]; previous != nil && previous != session {
		previous.view.Mode = "view"
		previous.takeover = false
		m.auditLocked(previous, "revoke", "takeover")
		// Retire the native attachment before granting the successor. Reconnect
		// starts in view mode and cannot replay any previously queued commands.
		if previous.pair != nil {
			if err := previous.pair.retire(); err != nil {
				m.controller = ""
				return err
			}
		}
	}
	m.controller = session.view.ID
	m.auditLocked(session, "control", "granted")
	return nil
}
func (m *Manager) ForForward(id string) (Session, string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		if s.view.ForwardID == id {
			return s.view, s.owner, true
		}
	}
	return Session{}, "", false
}
func (m *Manager) ForTarget(target string) (Session, string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		if strings.TrimRight(s.view.TargetURL, "/") == strings.TrimRight(target, "/") {
			return s.view, s.owner, true
		}
	}
	return Session{}, "", false
}
func (m *Manager) Get(owner, id string) (Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, err := m.ownedLocked(owner, id)
	if err != nil {
		return Session{}, err
	}
	return s.view, nil
}
func (m *Manager) ownedLocked(owner, id string) (*ownedSession, error) {
	s := m.sessions[id]
	if s == nil {
		return nil, ErrNotFound
	}
	if owner == "" || owner != s.owner {
		return nil, ErrForbidden
	}
	return s, nil
}
func (m *Manager) Disconnect(owner, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, err := m.ownedLocked(owner, id)
	if err != nil {
		return err
	}
	m.removeLocked(s)
	return nil
}
func (m *Manager) removeLocked(s *ownedSession) {
	m.auditLocked(s, "disconnect", "session_ended")
	delete(m.sessions, s.view.ID)
	if m.controller == s.view.ID {
		m.controller = ""
	}
	if s.pair != nil {
		s.pair.close()
	}
	if s.server != nil {
		_ = s.server.Close()
	}
	if m.forwards != nil {
		m.forwards.ReleaseOwnedForwardSession(s.view.ForwardID)
	}
}
func (m *Manager) expire() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-m.stop:
			return
		case <-ticker.C:
			m.mu.Lock()
			for _, s := range m.sessions {
				if !s.expires.IsZero() && time.Now().After(s.expires) {
					m.removeLocked(s)
				}
			}
			m.mu.Unlock()
		}
	}
}
func (m *Manager) Close() error {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil
	}
	m.closed = true
	close(m.stop)
	for _, s := range m.sessions {
		m.removeLocked(s)
	}
	m.mu.Unlock()
	m.setupMu.Lock()
	defer m.setupMu.Unlock()
	if m.setup != nil {
		m.setup.Close()
	}
	return nil
}

type Ticket struct {
	Token   string  `json:"token"`
	Session Session `json:"session"`
}

func (m *Manager) Ticket(owner, id string) (Ticket, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, err := m.ownedLocked(owner, id)
	if err != nil {
		return Ticket{}, err
	}
	if s.pair != nil {
		if err := s.pair.retire(); err != nil {
			return Ticket{}, err
		}
	}
	s.pair = &attachment{done: make(chan struct{}), token: randomID(), expires: time.Now().Add(90 * time.Second)}
	s.expires = time.Now().Add(2 * time.Minute)
	return Ticket{Token: s.pair.token, Session: s.view}, nil
}
func (m *Manager) serveSocket(w http.ResponseWriter, r *http.Request, s *ownedSession) {
	kind := strings.TrimPrefix(r.URL.Path, ViewerPath)
	if kind != "control" && kind != "media" {
		http.NotFound(w, r)
		return
	}
	protocols := websocket.Subprotocols(r)
	m.mu.Lock()
	a := s.pair
	if m.sessions[s.view.ID] != s || a == nil || len(protocols) != 2 || protocols[0] != "redeven-desktop-v1" || subtle.ConstantTimeCompare([]byte(protocols[1]), []byte(a.token)) != 1 || time.Now().After(a.expires) {
		m.mu.Unlock()
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	a.mu.Lock()
	if a.closed || kind == "control" && a.control != nil || kind == "media" && a.media != nil {
		a.mu.Unlock()
		m.mu.Unlock()
		http.Error(w, "conflict", http.StatusConflict)
		return
	}
	upgrader := websocket.Upgrader{Subprotocols: []string{"redeven-desktop-v1"}, CheckOrigin: func(*http.Request) bool { return true }}
	connection, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		a.mu.Unlock()
		m.mu.Unlock()
		return
	}
	if kind == "control" {
		a.control = connection
	} else {
		a.media = connection
	}
	start := a.control != nil && a.media != nil
	if start {
		a.initialized = make(chan struct{})
	}
	a.mu.Unlock()
	m.mu.Unlock()
	if start {
		go m.runAttachment(s, a)
	}
	select {
	case <-a.done:
	case <-r.Context().Done():
		a.close()
	}
}

// SetAudit receives only lifecycle metadata, never media, text or input payloads.
func (m *Manager) SetAudit(audit func(owner, id, event, reason string)) {
	m.mu.Lock()
	m.audit = audit
	m.mu.Unlock()
}

func (m *Manager) SetDisplayPreference(save func(id string)) {
	m.mu.Lock()
	m.displaySelected = save
	m.mu.Unlock()
}
func (m *Manager) auditLocked(s *ownedSession, event, reason string) {
	if m.audit != nil {
		m.audit(s.owner, s.view.ID, event, reason)
	}
}

func (m *Manager) SetUnattended(enabled bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		s.unattended = enabled
		if !enabled && s.pair != nil {
			s.pair.close()
			s.expires = time.Now().Add(2 * time.Minute)
		}
	}
}

func (m *Manager) RevokeDisallowed(allowed func(owner string) bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	// Fence in-flight HTTP admission as well as existing sessions. A handler
	// authorized before a policy update cannot recreate the revoked desktop.
	m.allowed = allowed
	for _, s := range m.sessions {
		if !allowed(s.owner) {
			m.auditLocked(s, "revoke", "permission_changed")
			m.removeLocked(s)
		}
	}
}
