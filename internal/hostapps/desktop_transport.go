package hostapps

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/gorilla/websocket"
)

// Native application state is process-owned. Each lease keeps an independent
// attachment and route; the helper applies the single-controller takeover rule.
type desktopAttachmentOwner struct {
	sync.Mutex
	attachments map[*desktopAttachment]struct{}
	current     *desktopAttachment
}
type desktopReply struct {
	viewerID uint64
	result   chan nativeapps.DesktopEvent
}
type desktopAttachment struct {
	conn    *nativeapps.DesktopConnection
	mu      sync.Mutex
	pending map[uint64]desktopReply
	events  chan nativeapps.DesktopEvent
	done    chan struct{}
	once    sync.Once
}

func newDesktopAttachment(conn *nativeapps.DesktopConnection, viewer bool) *desktopAttachment {
	a := &desktopAttachment{conn: conn, pending: make(map[uint64]desktopReply), done: make(chan struct{})}
	if viewer {
		a.events = make(chan nativeapps.DesktopEvent, 16)
	}
	go a.read()
	return a
}
func (a *desktopAttachment) close() { a.once.Do(func() { _ = a.conn.Close(); close(a.done) }) }
func (a *desktopAttachment) emit(event nativeapps.DesktopEvent) bool {
	if a.events == nil {
		return true
	}
	select {
	case a.events <- event:
		return true
	case <-a.done:
		return false
	default:
		// A viewer that cannot drain its own bounded queue must not hold up
		// capture delivery for other attachments. Its reader closes only this
		// attachment and the native process remains shared.
		return false
	}
}
func (a *desktopAttachment) read() {
	defer a.close()
	for {
		event, err := a.conn.Read(context.Background())
		if err != nil {
			return
		}
		if event.ID != 0 {
			a.mu.Lock()
			pending, ok := a.pending[event.ID]
			delete(a.pending, event.ID)
			a.mu.Unlock()
			if !ok {
				return
			}
			if pending.result != nil {
				pending.result <- event
				continue
			}
			event.ID = pending.viewerID
		}
		if !a.emit(event) {
			return
		}
	}
}
func (a *desktopAttachment) send(ctx context.Context, request nativeapps.DesktopRequest, pending desktopReply) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	select {
	case <-a.done:
		return net.ErrClosed
	default:
	}
	if len(a.pending) >= 256 {
		return ErrLimit
	}
	id, err := a.conn.Send(ctx, request)
	if err == nil {
		a.pending[id] = pending
	}
	return err
}
func (a *desktopAttachment) call(ctx context.Context, request nativeapps.DesktopRequest) (nativeapps.DesktopEvent, error) {
	reply := make(chan nativeapps.DesktopEvent, 1)
	if err := a.send(ctx, request, desktopReply{result: reply}); err != nil {
		return nativeapps.DesktopEvent{}, err
	}
	select {
	case event := <-reply:
		if event.Error != "" {
			return event, ErrUnavailable
		}
		return event, nil
	case <-ctx.Done():
		return nativeapps.DesktopEvent{}, ctx.Err()
	case <-a.done:
		return nativeapps.DesktopEvent{}, net.ErrClosed
	}
}

func (m *Manager) shareDesktopApplication(ctx context.Context, owner string, a *linuxApplication, presentation Presentation, clientID ...string) (Session, error) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return Session{}, err
	}
	proxy := &applicationProxy{Listener: listener, connections: make(map[*applicationConnection]struct{})}
	forward, err := m.forwards.OpenOwnedForwardSession(ctx, "http://"+listener.Addr().String()+"/_redeven_host_app/")
	if err != nil {
		_ = proxy.Close()
		return Session{}, err
	}
	state := "starting"
	if a.ready {
		state = "running"
	}
	client := ""
	if len(clientID) > 0 {
		client = clientID[0]
	}
	s := &ownedSession{application: a, proxy: proxy, owner: owner, clientID: client, password: randomID() + randomID(), done: make(chan struct{}),
		view: Session{ID: randomID(), Application: a.record.Application, State: state, Backend: "wayland", Mode: "stream", StartedAt: time.Now().UnixMilli(), Forward: forward, Presentation: presentation}}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { m.serveDesktopSession(w, r, s) }), ReadHeaderTimeout: 10 * time.Second}
	m.mu.Lock()
	m.trimCompletedLocked()
	m.sessions[s.view.ID] = s
	view := cloneSession(s.view)
	m.mu.Unlock()
	go func() { _ = server.Serve(proxy) }()
	return view, nil
}

func (m *Manager) serveDesktopSession(w http.ResponseWriter, r *http.Request, s *ownedSession) {
	if r.URL.Path != "/_redeven_host_app/stream" {
		http.NotFound(w, r)
		return
	}
	protocols := websocket.Subprotocols(r)
	m.mu.Lock()
	password, stopping := s.password, s.stopping
	m.mu.Unlock()
	if len(protocols) != 2 || protocols[0] != "redeven-host-application-v1" || password == "" || stopping || subtle.ConstantTimeCompare([]byte(protocols[1]), []byte(password)) != 1 {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	select {
	case <-s.application.prepared:
	case <-s.done:
		return
	case <-r.Context().Done():
		return
	}
	upgrader := websocket.Upgrader{Subprotocols: []string{"redeven-host-application-v1"}, CheckOrigin: func(*http.Request) bool { return true }}
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()
	ws.SetReadLimit(128 * 1024)
	_ = ws.SetReadDeadline(time.Now().Add(45 * time.Second))
	ws.SetPongHandler(func(string) error { return ws.SetReadDeadline(time.Now().Add(45 * time.Second)) })

	owner := &s.application.desktop
	owner.Lock()
	m.mu.Lock()
	stopping = s.stopping
	m.mu.Unlock()
	if stopping {
		owner.Unlock()
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	conn, state, err := nativeapps.DialDesktop(ctx, *s.application.record.Endpoint)
	cancel()
	if err != nil {
		owner.Unlock()
		_ = ws.WriteJSON(map[string]any{"event": "unavailable", "code": "capture_failed"})
		return
	}
	if owner.attachments == nil {
		owner.attachments = make(map[*desktopAttachment]struct{})
	}
	attached := newDesktopAttachment(conn, true)
	owner.attachments[attached] = struct{}{}
	owner.current = attached
	owner.Unlock()
	defer func() {
		owner.Lock()
		delete(owner.attachments, attached)
		if owner.current == attached {
			owner.current = nil
			for candidate := range owner.attachments {
				owner.current = candidate
				break
			}
		}
		attached.close()
		owner.Unlock()
	}()
	_ = ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if ws.WriteJSON(nativeapps.DesktopEvent{Event: "attached", Version: 1, StreamVersion: conn.StreamVersion(), Connection: conn.Connection(), State: &state}) != nil {
		return
	}
	readerDone := make(chan struct{})
	defer func() { _ = ws.Close(); <-readerDone }()
	go func() {
		defer close(readerDone)
		var last uint64
		for {
			var request struct {
				ID uint64 `json:"id"`
				nativeapps.DesktopRequest
			}
			if ws.ReadJSON(&request) != nil || request.ID <= last || request.ID > 1<<53-1 {
				return
			}
			last = request.ID
			// Force quit is an authorized product operation, never an input packet.
			if request.Method == "terminate_application" {
				return
			}
			owner.Lock()
			if owner.current != attached {
				owner.Unlock()
				// The native helper broadcasts control revocation to this
				// attachment. Keep the viewer subscribed for frames while it is
				// read-only; a stale input packet is intentionally ignored.
				continue
			}
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			err := attached.send(ctx, request.DesktopRequest, desktopReply{viewerID: request.ID})
			cancel()
			owner.Unlock()
			if err != nil {
				return
			}
		}
	}()
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-s.done:
			return
		case <-readerDone:
			return
		case <-attached.done:
			return
		case <-ping.C:
			if ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
				return
			}
		case event := <-attached.events:
			_ = ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if ws.WriteJSON(event) != nil {
				return
			}
			if len(event.Pixels) > 0 && ws.WriteMessage(websocket.BinaryMessage, event.Pixels) != nil {
				return
			}
		}
	}
}

func (m *Manager) controlDesktopApplication(ctx context.Context, a *linuxApplication, force bool) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	owner := &a.desktop
	owner.Lock()
	defer owner.Unlock()
	attached := owner.current
	if attached == nil {
		conn, _, err := nativeapps.DialDesktop(ctx, *a.record.Endpoint)
		if err != nil {
			return err
		}
		attached = newDesktopAttachment(conn, false)
		defer attached.close()
	}
	if force {
		_, err := attached.call(ctx, nativeapps.DesktopRequest{Method: "terminate_application"})
		return err
	}
	// The helper can report sharing readiness before the first top-level window
	// is discoverable. Keep probing briefly so an immediate Close all windows
	// request cannot be accepted as a no-op during that startup gap.
	deadline := time.Now().Add(2 * time.Second)
	for {
		event, err := attached.call(ctx, nativeapps.DesktopRequest{Method: "status"})
		if err != nil {
			return err
		}
		var state nativeapps.DesktopState
		if json.Unmarshal(event.Result, &state) != nil {
			return errors.New("invalid native desktop status")
		}
		// Snapshot only top-level windows. A close-generated save prompt must
		// remain visible and interactive until the user decides whether to save
		// or cancel.
		windows := desktopTopLevelWindowIDs(state.Windows)
		if len(windows) > 0 {
			for _, window := range windows {
				if _, err := attached.call(ctx, nativeapps.DesktopRequest{Method: "close_window", Window: window}); err != nil {
					return err
				}
			}
			return nil
		}
		if time.Now().After(deadline) {
			return nil
		}
		timer := time.NewTimer(50 * time.Millisecond)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func desktopTopLevelWindowIDs(windows []nativeapps.DesktopWindow) []uint64 {
	ids := make([]uint64, 0, len(windows))
	for _, window := range windows {
		if window.Window != 0 && window.Parent == 0 {
			ids = append(ids, window.Window)
		}
	}
	return ids
}
