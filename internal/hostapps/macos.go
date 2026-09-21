package hostapps

import (
	"bufio"
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/browserinstall"
	"github.com/gorilla/websocket"
)

// The packaged helper is shared with Computer Use; this explicit mode exposes
// human-operated, process-bound application sessions, not automation tools.
func (m *Manager) macHelper() string {
	if configured := os.Getenv("REDEVEN_COMPUTER_NATIVE_HELPER_PATH"); configured != "" {
		return configured
	}
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return ""
	}
	root := filepath.Dir(executable)
	for _, path := range []string{filepath.Join(root, "computer", "redeven-computer-host"), filepath.Join(root, "redeven-computer-host"), filepath.Join(root, "..", "computer", "redeven-computer-host"), filepath.Join(filepath.Dir(m.state), "computer", "redeven-computer-host")} {
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0111 != 0 {
			return path
		}
	}
	m.nativePrepare.Do(func() {
		path, err := browserinstall.PrepareComputerHelpers(filepath.Join(root, "computer.zip"), filepath.Join(filepath.Dir(m.state), "computer"))
		if err == nil {
			m.nativePath = filepath.Join(filepath.Dir(path), "redeven-computer-host")
		}
	})
	return m.nativePath
}

type macMessage struct {
	EndReason           string               `json:"end_reason,omitempty"`
	Running             []RunningApplication `json:"running,omitempty"`
	ExistingApplication bool                 `json:"existing_application,omitempty"`
	Action              string               `json:"action,omitempty"`
	Type                string               `json:"type"`
	Code                string               `json:"code,omitempty"`
	Availability        Availability         `json:"availability,omitempty"`
	Applications        []Application        `json:"applications,omitempty"`
	Data                string               `json:"data,omitempty"`
	Generation          int                  `json:"generation,omitempty"`
}

func macCommand(helper string) (*exec.Cmd, io.WriteCloser, io.ReadCloser, error) {
	if helper == "" {
		return nil, nil, nil, ErrUnavailable
	}
	cmd := exec.Command(helper, "--host-applications")
	input, err := cmd.StdinPipe()
	if err != nil {
		return nil, nil, nil, err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		_ = input.Close()
		return nil, nil, nil, err
	}
	if err = cmd.Start(); err != nil {
		_ = input.Close()
		_ = output.Close()
		return nil, nil, nil, err
	}
	return cmd, input, output, nil
}
func macSend(input io.Writer, value map[string]any) error {
	if pipe, ok := input.(interface{ SetWriteDeadline(time.Time) error }); ok {
		_ = pipe.SetWriteDeadline(time.Now().Add(5 * time.Second))
	}
	value["protocol_version"] = 1
	return json.NewEncoder(input).Encode(value)
}
func macScanner(output io.Reader) *bufio.Scanner {
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 65536), 128<<20)
	return scanner
}
func macOnce(ctx context.Context, helper string, request map[string]any) (macMessage, error) {
	cmd, input, output, err := macCommand(helper)
	if err != nil {
		return macMessage{}, err
	}
	defer func() { _ = input.Close(); _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	if err = macSend(input, request); err != nil {
		return macMessage{}, err
	}
	result := make(chan macMessage, 1)
	go func() {
		var msg macMessage
		scanner := macScanner(output)
		if scanner.Scan() {
			_ = json.Unmarshal(scanner.Bytes(), &msg)
		}
		result <- msg
	}()
	select {
	case <-ctx.Done():
		return macMessage{}, ctx.Err()
	case msg := <-result:
		if msg.Type == "error" || msg.Type == "" {
			return msg, ErrUnavailable
		}
		return msg, nil
	}
}
func (m *Manager) macPaths() []string {
	paths := []string{}
	entries, _ := os.ReadDir(m.custom)
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(m.custom, entry.Name()))
		var path string
		if err == nil && json.Unmarshal(data, &path) == nil {
			paths = append(paths, path)
		}
	}
	return paths
}
func (m *Manager) macCatalog(ctx context.Context, owner string) (Catalog, error) {
	result := Catalog{Availability: Availability{Supported: true, Backend: "macos", Reason: "native_helper_missing"}, Applications: []Application{}, Sessions: m.Sessions(owner)}
	helper := m.macHelper()
	if helper == "" {
		return result, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	msg, err := macOnce(ctx, helper, map[string]any{"action": "catalog", "paths": m.macPaths()})
	if err != nil {
		result.Availability.Reason = "catalog_unavailable"
		return result, nil
	}
	result.Availability = msg.Availability
	result.Applications = msg.Applications
	result.Running = msg.Running
	return result, nil
}

// Running is a lightweight OS snapshot, independent of viewer/session lifetime.
func (m *Manager) Running(ctx context.Context) ([]RunningApplication, error) {
	if runtime.GOOS != "darwin" {
		return nil, ErrUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	msg, err := macOnce(ctx, m.macHelper(), map[string]any{"action": "running"})
	if err != nil {
		return nil, err
	}
	if msg.Type != "running" {
		return nil, ErrUnavailable
	}
	return msg.Running, nil
}

func (m *Manager) Quit(ctx context.Context, owner string, req QuitRequest) error {
	m.mu.Lock()
	closed := m.closed
	m.mu.Unlock()
	if closed || owner == "" || runtime.GOOS != "darwin" {
		return ErrUnavailable
	}
	if req.ApplicationID == "" || len(req.ApplicationID) > 160 || len(req.Instances) == 0 || len(req.Instances) > 64 {
		return ErrInvalid
	}
	seen := make(map[string]bool)
	for _, id := range req.Instances {
		if len(id) != 64 || seen[id] {
			return ErrInvalid
		}
		seen[id] = true
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	msg, err := macOnce(ctx, m.macHelper(), map[string]any{"action": "quit", "application_id": req.ApplicationID, "instances": req.Instances})
	switch msg.Code {
	case "APPLICATION_NOT_FOUND":
		return ErrNotFound
	case "QUIT_REJECTED":
		return ErrQuitRejected
	}
	if err != nil {
		return err
	}
	if msg.Type != "quit_requested" {
		return ErrUnavailable
	}
	// Acceptance is not termination. System inventory and live sessions observe
	// the outcome; a save dialog or cancelled quit must keep the application open.
	return nil
}

func (m *Manager) Detach(ctx context.Context, owner, id string) error {
	m.mu.Lock()
	s := m.sessions[id]
	m.mu.Unlock()
	if s == nil || s.owner != owner {
		return ErrNotFound
	}
	if s.native == nil {
		return ErrInvalid
	}
	return m.Stop(ctx, owner, id)
}

func (m *Manager) macAdd(ctx context.Context, req AddRequest) error {
	path := strings.TrimSpace(req.Executable)
	if !filepath.IsAbs(path) || !strings.HasSuffix(path, ".app") || req.Arguments != "" {
		return ErrInvalid
	}
	info, err := os.Stat(filepath.Join(path, "Contents", "Info.plist"))
	if err != nil || !info.Mode().IsRegular() {
		return ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	msg, err := macOnce(ctx, m.macHelper(), map[string]any{"action": "validate", "path": path})
	if err != nil || msg.Type != "validated" {
		return ErrInvalid
	}
	if err = os.MkdirAll(m.custom, 0700); err != nil {
		return err
	}
	data, _ := json.Marshal(path)
	return os.WriteFile(filepath.Join(m.custom, randomID()+".json"), data, 0600)
}
func (m *Manager) Permissions(ctx context.Context, permission string) error {
	if m.macHelper() == "" {
		return ErrUnavailable
	}
	if permission != "screen_recording" && permission != "accessibility" {
		return ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	_, err := macOnce(ctx, m.macHelper(), map[string]any{"action": "permissions", "permission": permission})
	return err
}

// Latest-frame delivery bounds memory when a viewer is slow or disconnected.
// One WebSocket owns input at a time; replacement revokes the previous viewer.
type macSession struct {
	viewers     sync.WaitGroup
	stopped     <-chan struct{}
	mu          sync.Mutex
	controlMu   sync.Mutex
	writeMu     sync.Mutex
	ready       chan struct{}
	input       io.WriteCloser
	cancel      context.CancelFunc
	server      *http.Server
	latest      []byte
	window      []byte
	windows     []byte
	notices     [][]byte
	generation  int
	revision    uint64
	connection  *websocket.Conn
	changed     chan struct{}
	connectedAt time.Time
}

// Called with mu held. Immutable packet slices already owned by a writer
// remain valid; the session no longer retains them after this boundary.
func (s *macSession) clearPlaybackLocked() {
	s.latest, s.window, s.notices = nil, nil, nil
	s.generation = 0
	s.connectedAt = time.Time{}
}

// Frames are replaceable snapshots; operation results are ordered events.
// A stalled viewer is disconnected at the bound instead of losing feedback or
// accumulating an unbounded queue. The host application remains running.
func (s *macSession) enqueueNotice(raw []byte) {
	s.mu.Lock()
	changed := s.changed
	if changed == nil {
		s.mu.Unlock()
		return
	}
	if len(s.notices) < 128 {
		s.notices = append(s.notices, raw)
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()
	s.controlMu.Lock()
	s.mu.Lock()
	current := s.changed == changed
	s.mu.Unlock()
	if current && s.connection != nil {
		_ = s.connection.Close()
	}
	s.controlMu.Unlock()
}

func (s *macSession) send(request map[string]any) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	if s.input == nil {
		return ErrUnavailable
	}
	return macSend(s.input, request)
}
func (m *Manager) macLaunch(ctx context.Context, owner string, req LaunchRequest) (Session, error) {
	m.mu.Lock()
	closed := m.closed
	m.mu.Unlock()
	if closed || owner == "" {
		return Session{}, ErrUnavailable
	}
	if req.Mode != "" && req.Mode != "native" && req.Mode != "stream" {
		return Session{}, ErrInvalid
	}
	resolveCtx, cancelResolve := context.WithTimeout(ctx, 15*time.Second)
	defer cancelResolve()
	catalog, err := macOnce(resolveCtx, m.macHelper(), map[string]any{"action": "catalog", "application_id": req.ApplicationID, "paths": m.macPaths()})
	if err != nil {
		return Session{}, err
	}
	if (req.Mode == "native" && !catalog.Availability.NativeReady) || (req.Mode != "native" && !catalog.Availability.Ready) {
		return Session{}, ErrUnavailable
	}
	var app Application
	for _, candidate := range catalog.Applications {
		if candidate.ID == req.ApplicationID {
			app = candidate
			break
		}
	}
	if app.ID == "" {
		return Session{}, ErrNotFound
	}
	if req.Mode == "native" {
		ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		_, err := macOnce(ctx, m.macHelper(), map[string]any{"action": "native", "application_id": app.ID, "paths": m.macPaths()})
		return Session{ID: randomID(), Application: app, State: "opened", Backend: "macos", Mode: "native", StartedAt: time.Now().UnixMilli()}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return Session{}, ErrUnavailable
	}
	active := 0
	for _, s := range m.sessions {
		if s.view.State != "running" && s.view.State != "starting" {
			continue
		}
		active++
		if !s.stopping && s.owner == owner && s.view.Application.ID == app.ID {
			return cloneSession(s.view), nil
		}
	}
	if active >= 12 {
		return Session{}, ErrLimit
	}
	m.trimCompletedLocked()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return Session{}, err
	}
	forward, err := m.forwards.OpenOwnedForwardSession(ctx, "http://"+listener.Addr().String()+"/_redeven_host_app/")
	if err != nil {
		_ = listener.Close()
		return Session{}, err
	}
	life, cancel := context.WithCancel(context.Background())
	native := &macSession{cancel: cancel, ready: make(chan struct{}), stopped: life.Done()}
	s := &ownedSession{view: Session{ID: randomID(), Application: app, State: "starting", Backend: "macos", Mode: "stream", StartedAt: time.Now().UnixMilli(), Forward: forward, Presentation: req.Presentation}, owner: owner, password: randomID() + randomID(), done: make(chan struct{}), native: native}
	native.server = &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { m.serveMacSession(w, r, s) })}
	m.sessions[s.view.ID] = s
	go func() { _ = native.server.Serve(listener) }()
	go m.runMac(life, s)
	return cloneSession(s.view), nil
}
func (m *Manager) runMac(ctx context.Context, s *ownedSession) {
	n := s.native
	code := ""
	var cmd *exec.Cmd
	var input io.WriteCloser
	defer func() {
		n.cancel()
		m.mu.Lock()
		if s.stopping {
			code = ""
			if s.view.EndReason == "" {
				s.view.EndReason = "sharing_stopped"
			}
		}
		m.mu.Unlock()
		m.finish(s, code, func() {
			if input != nil {
				_ = input.Close()
			}
			if cmd != nil {
				_ = cmd.Process.Kill()
				_ = cmd.Wait()
			}
			_ = n.server.Close()
			n.controlMu.Lock()
			if n.connection != nil {
				_ = n.connection.Close()
				n.connection = nil
			}
			n.mu.Lock()
			n.clearPlaybackLocked()
			n.windows = nil
			n.changed = nil
			n.mu.Unlock()
			n.controlMu.Unlock()
			n.writeMu.Lock()
			n.input = nil
			n.writeMu.Unlock()
			n.viewers.Wait()
		})
	}()
	if ctx.Err() != nil {
		return
	}
	var output io.ReadCloser
	var err error
	cmd, input, output, err = macCommand(m.macHelper())
	if err != nil {
		code = "launch_failed"
		return
	}
	go func() {
		select {
		case <-ctx.Done():
			// EOF releases held input. Bound an unresponsive helper without
			// transferring application ownership to its transport process.
			_ = input.Close()
			select {
			case <-s.done:
			case <-time.After(2 * time.Second):
				_ = cmd.Process.Kill()
			}
		case <-s.done:
		}
	}()
	n.writeMu.Lock()
	err = macSend(input, map[string]any{"action": "launch", "application_id": s.view.Application.ID, "paths": m.macPaths(), "defer_capture": true})
	n.input = input
	n.writeMu.Unlock()
	close(n.ready)
	startup := time.AfterFunc(40*time.Second, n.cancel)
	defer startup.Stop()
	if err != nil {
		code = "launch_failed"
		return
	}
	scanner := macScanner(output)
	started := false
	for scanner.Scan() {
		raw := append([]byte(nil), scanner.Bytes()...)
		var msg macMessage
		if json.Unmarshal(raw, &msg) != nil {
			code = "invalid_native_response"
			return
		}
		switch msg.Type {
		case "launched":
			// Launch readiness is independent of the first shareable window.
			startup.Stop()
			m.mu.Lock()
			s.view.ExistingApplication = msg.ExistingApplication
			m.mu.Unlock()
			slog.Info("native application attached", "session", s.view.ID, "existing_application", msg.ExistingApplication)
		case "frame":
			frame, err := base64.StdEncoding.DecodeString(msg.Data)
			if err != nil {
				continue
			}
			n.mu.Lock()
			if msg.Generation != n.generation || n.generation == 0 {
				n.mu.Unlock()
				continue
			}
			var metadata map[string]json.RawMessage
			if err := json.Unmarshal(raw, &metadata); err != nil {
				n.mu.Unlock()
				continue
			}
			delete(metadata, "data")
			header, _ := json.Marshal(metadata)
			packet := binary.BigEndian.AppendUint32(nil, uint32(len(header)))
			packet = append(packet, header...)
			if n.latest == nil && !n.connectedAt.IsZero() {
				slog.Info("native application first frame", "session", s.view.ID, "generation", msg.Generation, "duration_ms", time.Since(n.connectedAt).Milliseconds())
			}
			n.latest = append(packet, frame...)
			n.revision++
			n.mu.Unlock()
			m.mu.Lock()
			if s.view.State == "starting" {
				s.view.State = "running"
			}
			m.mu.Unlock()
			started = true
			startup.Stop()
		case "window":
			n.mu.Lock()
			n.window = raw
			n.generation = msg.Generation
			n.latest = nil
			n.revision++
			n.mu.Unlock()
		case "suspended":
			n.mu.Lock()
			n.clearPlaybackLocked()
			n.mu.Unlock()
		case "windows":
			n.mu.Lock()
			n.windows = raw
			n.mu.Unlock()
		case "ended":
			m.mu.Lock()
			switch msg.EndReason {
			case "application_exited", "windows_closed", "sharing_stopped":
				s.view.EndReason = msg.EndReason
			}
			m.mu.Unlock()
			// Explicit sharing termination is normal even before the first frame.
			// A failed application launch arrives as a separate native error.
			return
		case "menu", "operation_error", "operation_complete":
			n.enqueueNotice(raw)
		case "error":
			slog.Warn("native application error", "session", s.view.ID, "code", msg.Code)
			n.enqueueNotice(raw)
			if !started {
				code = strings.ToLower(msg.Code)
				return
			}
		case "blocked", "capture_error", "waiting":
			if msg.Type != "waiting" {
				slog.Warn("native application capture unavailable", "session", s.view.ID, "type", msg.Type, "code", msg.Code)
			}
			n.mu.Lock()
			n.generation = 0
			n.latest = nil
			n.window = raw
			n.revision++
			n.mu.Unlock()
		}
		n.mu.Lock()
		select {
		case n.changed <- struct{}{}:
		default:
		}
		n.mu.Unlock()
	}
	if err := scanner.Err(); err != nil {
		slog.Warn("native application helper stream ended", "session", s.view.ID, "error", err)
	}
	if !started {
		code = "launch_failed"
	} else {
		code = "native_helper_unavailable"
	}
}
func (m *Manager) serveMacSession(w http.ResponseWriter, r *http.Request, s *ownedSession) {
	if r.URL.Path != "/_redeven_host_app/stream" {
		http.NotFound(w, r)
		return
	}
	// The application forward enforces user ownership. The private listener also
	// authenticates independently, including direct host-local connection attempts.
	protocols := websocket.Subprotocols(r)
	m.mu.Lock()
	password := s.password
	stopping := s.stopping
	m.mu.Unlock()
	if len(protocols) != 2 || protocols[0] != "redeven-host-application-v1" || password == "" || stopping || subtle.ConstantTimeCompare([]byte(protocols[1]), []byte(password)) != 1 {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	upgrader := websocket.Upgrader{Subprotocols: []string{"redeven-host-application-v1"}, CheckOrigin: func(*http.Request) bool { return true }}
	connection, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer connection.Close()
	connection.SetReadLimit(65536)
	_ = connection.SetReadDeadline(time.Now().Add(45 * time.Second))
	connection.SetPongHandler(func(string) error { return connection.SetReadDeadline(time.Now().Add(45 * time.Second)) })
	n := s.native
	// Each viewer owns its wakeup channel: a closing predecessor must never
	// consume the successor's only notification for an unchanged window.
	changed := make(chan struct{}, 1)
	n.controlMu.Lock()
	m.mu.Lock()
	stopping = s.stopping
	m.mu.Unlock()
	if stopping {
		n.controlMu.Unlock()
		return
	}
	n.viewers.Add(1)
	defer n.viewers.Done()
	previous := n.connection
	n.connection = connection
	n.mu.Lock()
	n.changed = changed
	n.clearPlaybackLocked()
	n.connectedAt = time.Now()
	n.mu.Unlock()
	_ = n.send(map[string]any{"action": "suspend"})
	n.controlMu.Unlock()
	if previous != nil {
		_ = previous.Close()
	}
	defer func() {
		n.controlMu.Lock()
		current := n.connection == connection
		if current {
			n.connection = nil
			n.mu.Lock()
			n.clearPlaybackLocked()
			n.changed = nil
			n.mu.Unlock()
			_ = n.send(map[string]any{"action": "suspend"})
		}
		n.controlMu.Unlock()
	}()
	done := make(chan struct{})
	defer func() { _ = connection.Close(); <-done }()
	go func() {
		defer close(done)
		resumed := false
		for {
			var request map[string]any
			if connection.ReadJSON(&request) != nil {
				return
			}
			action, _ := request["action"].(string)
			if action == "resume" {
				if resumed {
					return
				}
				resumed = true
			} else if !resumed {
				return
			}
			if action != "resume" && action != "input" && action != "resize" && action != "close" && action != "quit_application" && action != "select" && action != "release" && action != "menu" && action != "menu_action" && action != "configure" && action != "frame_ack" {
				return
			}
			if n.ready != nil {
				select {
				case <-n.ready:
				case <-s.done:
					return
				case <-n.stopped:
					return
				case <-r.Context().Done():
					return
				}
			}
			n.controlMu.Lock()
			current := n.connection == connection
			if !current {
				n.controlMu.Unlock()
				return
			}
			sendErr := n.send(request)
			n.controlMu.Unlock()
			if sendErr != nil {
				return
			}
		}
	}()
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	var revision uint64
	var window, windows string
	for {
		select {
		case <-done:
			return
		case <-s.done:
			return
		case <-ping.C:
			if connection.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
				return
			}
		case <-changed:
			n.controlMu.Lock()
			if n.connection != connection {
				n.controlMu.Unlock()
				return
			}
			n.mu.Lock()
			frame := n.latest
			nextRevision := n.revision
			nextWindow := string(n.window)
			nextWindows := string(n.windows)
			notices := n.notices
			n.notices = nil
			n.mu.Unlock()
			n.controlMu.Unlock()
			_ = connection.SetWriteDeadline(time.Now().Add(5 * time.Second))

			if nextWindows != "" && nextWindows != windows {
				if connection.WriteMessage(websocket.TextMessage, []byte(nextWindows)) != nil {
					return
				}
				windows = nextWindows
			}
			if nextWindow != "" && nextWindow != window {
				if connection.WriteMessage(websocket.TextMessage, []byte(nextWindow)) != nil {
					return
				}
				window = nextWindow
			}
			for _, notice := range notices {
				if connection.WriteMessage(websocket.TextMessage, notice) != nil {
					return
				}
			}
			if len(frame) > 0 && nextRevision != revision {
				if connection.WriteMessage(websocket.BinaryMessage, frame) != nil {
					return
				}
				revision = nextRevision
			}
		}
	}
}
