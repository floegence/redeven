package hostapps

import (
	"bytes"
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/floegence/redeven/internal/portforward"
)

//go:embed desktop.py
var desktopHelper []byte

type ownedSession struct {
	native    *macSession
	view      Session
	owner     string
	password  string
	cmd       *exec.Cmd
	done      chan struct{}
	stopping  bool
	socketDir string
	tools     hostTools
}

type Manager struct {
	setupMu                     sync.Mutex
	setup                       *nativeapps.Manager
	setupClosed                 bool
	mu                          sync.Mutex
	state, home, helper, custom string
	forwards                    *portforward.Service
	sessions                    map[string]*ownedSession
	closed                      bool
	prepareOnce                 sync.Once
	prepareErr                  error
	nativePrepare               sync.Once
	nativePath                  string
}

func New(state, home string, forwards *portforward.Service) *Manager {
	root := filepath.Join(state, "host-applications")
	return &Manager{state: root, home: home, helper: filepath.Join(root, "desktop.py"), custom: filepath.Join(root, "applications"), forwards: forwards, sessions: make(map[string]*ownedSession)}
}

func (m *Manager) prepare() error {
	if runtime.GOOS != "linux" {
		return ErrUnavailable
	}
	m.prepareOnce.Do(func() {
		if err := os.MkdirAll(m.custom, 0o700); err != nil {
			m.prepareErr = err
			return
		}
		m.prepareErr = os.WriteFile(m.helper, desktopHelper, 0o600)
	})
	return m.prepareErr
}

func helperCommand(ctx context.Context, python, helper, custom, action, locale string, extra ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, python, append([]string{helper, action, custom}, extra...)...)
	cmd.Env = os.Environ()
	if locale != "" {
		cmd.Env = append(cmd.Env, "LANGUAGE="+strings.ReplaceAll(locale, "-", "_"))
	}
	return cmd
}

func (m *Manager) Sessions(owner string) []Session {
	result := []Session{}
	m.mu.Lock()
	for _, s := range m.sessions {
		if s.owner == owner {
			result = append(result, cloneSession(s.view))
		}
	}
	m.mu.Unlock()
	sort.Slice(result, func(i, j int) bool { return result[i].StartedAt > result[j].StartedAt })
	return result
}

func (m *Manager) Catalog(ctx context.Context, owner, locale string) (Catalog, error) {
	if runtime.GOOS == "darwin" {
		return m.macCatalog(ctx, owner)
	}
	catalog, _, err := m.catalog(ctx, owner, locale)
	return catalog, err
}

func (m *Manager) catalog(ctx context.Context, owner, locale string) (Catalog, hostTools, error) {
	availability, tools := m.tools(ctx)
	result := Catalog{Availability: availability, Applications: []Application{}, Sessions: m.Sessions(owner)}
	if !availability.Supported || tools.python == "" {
		return result, tools, nil
	}
	if err := m.prepare(); err != nil {
		return result, tools, err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd := helperCommand(ctx, tools.python, m.helper, m.custom, "catalog", locale)
	cmd.Env = tools.environment(cmd.Env)
	data, err := cmd.Output()
	if err != nil {
		result.Availability.Ready = false
		result.Availability.Reason = "catalog_unavailable"
		return result, tools, nil
	}
	if err := json.Unmarshal(data, &result.Applications); err != nil {
		return result, tools, err
	}
	return result, tools, nil
}

func (m *Manager) Add(ctx context.Context, req AddRequest) error {
	if runtime.GOOS == "darwin" {
		return m.macAdd(ctx, req)
	}
	if strings.TrimSpace(req.Name) == "" || len(req.Name) > 120 || len(req.Executable) > 4096 || len(req.Arguments) > 8192 || strings.ContainsAny(req.Name+req.Executable+req.Arguments, "\x00\r\n") {
		return ErrInvalid
	}
	if err := m.prepare(); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_, tools := m.tools(ctx)
	if tools.python == "" {
		return ErrUnavailable
	}
	cmd := helperCommand(ctx, tools.python, m.helper, m.custom, "add", "", randomID())
	cmd.Env = tools.environment(cmd.Env)
	data, _ := json.Marshal(req)
	cmd.Stdin = bytes.NewReader(data)
	if err := cmd.Run(); err != nil {
		return ErrInvalid
	}
	return nil
}

func (m *Manager) Launch(ctx context.Context, owner string, req LaunchRequest) (Session, error) {
	appID, locale := req.ApplicationID, req.Locale
	if owner == "" {
		return Session{}, ErrInvalid
	}
	for _, s := range []string{req.Presentation.Starting, req.Presentation.Failed, req.Presentation.Ended, req.Presentation.Retry, req.Presentation.Connecting, req.Presentation.Reconnecting, req.Presentation.Disconnected, req.Presentation.ConnectionHint, req.Presentation.Reconnect, req.Presentation.Locale} {
		if strings.TrimSpace(s) == "" || len(s) > 1024 {
			return Session{}, ErrInvalid
		}
	}
	if runtime.GOOS == "darwin" {
		for _, value := range []string{req.Presentation.Controls, req.Presentation.Menu, req.Presentation.Input, req.Presentation.Windows, req.Presentation.CloseWindow, req.Presentation.SharedControl, req.Presentation.OperationFailed, req.Presentation.Waiting, req.Presentation.WaitingHint, req.Presentation.CaptureUnavailable, req.Presentation.Picture, req.Presentation.PictureAuto, req.Presentation.PictureClarity, req.Presentation.PictureSmooth, req.Presentation.PictureData, req.Presentation.PictureHint, req.Presentation.PictureAdvanced, req.Presentation.PicturePixels, req.Presentation.PictureResolution, req.Presentation.PictureFrameRate, req.Presentation.PictureActualRate, req.Presentation.PictureBandwidth, req.Presentation.PictureTransport, req.Presentation.PictureVideo, req.Presentation.PictureImages} {
			if strings.TrimSpace(value) == "" || len(value) > 1024 {
				return Session{}, ErrInvalid
			}
		}
		return m.macLaunch(ctx, owner, req)
	}
	if req.Mode != "" && req.Mode != "stream" {
		return Session{}, ErrInvalid
	}
	m.mu.Lock()
	for _, s := range m.sessions {
		if !s.stopping && s.owner == owner && s.view.Application.ID == appID && (s.view.State == "starting" || s.view.State == "running") {
			view := cloneSession(s.view)
			m.mu.Unlock()
			return view, nil
		}
	}
	m.mu.Unlock()
	catalog, tools, err := m.catalog(ctx, owner, locale)
	if err != nil {
		return Session{}, err
	}
	if !catalog.Availability.Ready {
		return Session{}, ErrUnavailable
	}
	var app Application
	for _, candidate := range catalog.Applications {
		if candidate.ID == appID {
			app = candidate
			break
		}
	}
	if app.ID == "" {
		return Session{}, ErrNotFound
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return Session{}, ErrUnavailable
	}
	active := 0
	for _, s := range m.sessions {
		if s.view.State != "starting" && s.view.State != "running" {
			continue
		}
		active++
		if !s.stopping && s.owner == owner && s.view.Application.ID == appID {
			return cloneSession(s.view), nil
		}
	}
	if active >= 12 {
		return Session{}, ErrLimit
	}
	m.trimCompletedLocked()
	id := randomID()
	dir := filepath.Join(m.state, "sessions", id)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return Session{}, err
	}
	password := randomID() + randomID()
	if err := os.WriteFile(filepath.Join(dir, "password"), []byte(password), 0o600); err != nil {
		return Session{}, err
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return Session{}, err
	}
	address := listener.Addr().String()
	forward, err := m.forwards.OpenOwnedForwardSession(ctx, "http://"+address+"/_redeven_host_app/")
	if err != nil {
		_ = listener.Close()
		return Session{}, err
	}
	socketDir, err := os.MkdirTemp("", "redeven-xpra-")
	if err != nil {
		_ = listener.Close()
		m.forwards.ReleaseOwnedForwardSession(forward.Forward.ForwardID)
		return Session{}, err
	}
	if err := os.Mkdir(filepath.Join(socketDir, "xpra"), 0700); err != nil {
		_ = listener.Close()
		_ = os.RemoveAll(socketDir)
		m.forwards.ReleaseOwnedForwardSession(forward.Forward.ForwardID)
		return Session{}, err
	}
	view := Session{ID: id, Application: app, State: "starting", StartedAt: time.Now().UnixMilli(), Forward: forward, Presentation: req.Presentation}
	s := &ownedSession{view: view, owner: owner, password: password, socketDir: socketDir, tools: tools, done: make(chan struct{})}
	m.sessions[id] = s
	_ = listener.Close()
	go m.run(s, dir, address)
	return cloneSession(view), nil
}

func (m *Manager) run(s *ownedSession, dir, address string) {
	args := []string{s.tools.xpra, "start", "--daemon=no", "--systemd-run=no", "--attach=no", "--use-display=no", "--bind-ws=" + address,
		"--ws-auth=file:filename=" + filepath.Join(dir, "password"), "--html=" + s.tools.html, "--sessions-dir=" + filepath.Join(s.socketDir, "sessions"), "--socket-dir=" + s.socketDir,
		"--socket-dirs=" + s.socketDir, "--exit-with-client=no", "--exit-with-windows=yes", "--exit-with-children=no",
		"--terminate-children=yes", "--start-new-commands=no", "--sharing=no", "--mdns=no", "--pulseaudio=no",
		"--source=", "--source-start=", "--input-method=none", "--speaker=off", "--microphone=off", "--webcam=no", "--printing=no", "--file-transfer=no",
		"--notifications=no", "--dbus-launch=", "--session-name=" + s.view.Application.Name,
		"--xvfb=" + quoteArgv([]string{s.tools.xvfb, "-screen", "0", "3840x2160x24", "-nolisten", "tcp", "-noreset", "+extension", "Composite", "-auth", "$XAUTHORITY"}),
		"--start-child=" + quoteArgv([]string{s.tools.python, m.helper, "launch", m.custom, s.view.Application.ID, filepath.Join(dir, "launch.json")}),
	}
	// Xpra clears inherited DBUS_* variables before configuring its session.
	// Pass our newly created private bus through its explicit child environment;
	// dbus-run-session remains the lifetime owner of both the bus and Xpra.
	launcher := []string{"--", "/bin/sh", "-c", `exec "$@" --dbus=no --dbus-control=no "--start-env=DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"`, "redeven-xpra"}
	cmd := exec.Command(s.tools.dbus, append(launcher, args...)...)
	cmd.Dir = m.home
	cmd.Env = append(xpraEnvironment(s.tools.environment(applicationEnvironment(os.Environ()))), "XDG_RUNTIME_DIR="+s.socketDir)
	configureProcess(cmd)
	log, err := os.OpenFile(filepath.Join(dir, "session.log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		m.finish(s, "launch_failed")
		return
	}
	defer log.Close()
	cmd.Stdout, cmd.Stderr = log, log
	m.mu.Lock()
	if s.stopping || m.closed {
		m.mu.Unlock()
		m.finish(s, "")
		return
	}
	err = cmd.Start()
	if err == nil {
		s.cmd = cmd
	}
	m.mu.Unlock()
	if err != nil {
		m.finish(s, "launch_failed")
		return
	}
	readyDone := make(chan struct{})
	go func() { defer close(readyDone); m.waitReady(s, dir, address) }()
	err = cmd.Wait()
	code := ""
	m.mu.Lock()
	if err != nil && !s.stopping {
		code = "application_exited"
	}
	m.mu.Unlock()
	m.finish(s, code)
	<-readyDone
}

func (m *Manager) waitReady(s *ownedSession, dir, address string) {
	timer := time.NewTimer(40 * time.Second)
	defer timer.Stop()
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	client := http.Client{Timeout: time.Second}
	for {
		select {
		case <-s.done:
			return
		case <-timer.C:
			m.mu.Lock()
			s.view.ErrorCode = "launch_timeout"
			m.mu.Unlock()
			_ = m.Stop(context.Background(), s.owner, s.view.ID)
			return
		case <-tick.C:
			data, err := os.ReadFile(filepath.Join(dir, "launch.json"))
			if err != nil {
				continue
			}
			var receipt struct {
				OK bool `json:"ok"`
			}
			if json.Unmarshal(data, &receipt) != nil {
				continue
			}
			if !receipt.OK {
				m.mu.Lock()
				s.view.ErrorCode = "launch_failed"
				m.mu.Unlock()
				_ = m.Stop(context.Background(), s.owner, s.view.ID)
				return
			}
			res, err := client.Get("http://" + address + "/index.html")
			if err != nil {
				continue
			}
			_ = res.Body.Close()
			if res.StatusCode != http.StatusOK {
				continue
			}
			// A successful GIO launch alone can still redirect a singleton to
			// another display. Read Xpra's own inventory before reporting ready.
			if !sessionHasWindows(s.tools.xpra, s.socketDir) {
				continue
			}
			m.mu.Lock()
			if s.view.State == "starting" && !s.stopping {
				s.view.State = "running"
			}
			m.mu.Unlock()
			return
		}
	}
}

func sessionHasWindows(xpra, socketDir string) bool {
	entries, err := os.ReadDir(socketDir)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if entry.Type()&os.ModeSocket == 0 {
			continue
		}
		// Xpra 6.2 can spend five seconds collecting optional codec information
		// even on an otherwise ready server. Keep the probe bounded while allowing
		// the supported 6.x versions to return their actual window inventory.
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		out, err := commandOutput(ctx, xpraEnvironment(os.Environ()), xpra, "info", "socket://"+filepath.Join(socketDir, entry.Name()))
		cancel()
		if err == nil && infoHasWindows(string(out)) {
			return true
		}
	}
	return false
}

func infoHasWindows(info string) bool {
	for _, line := range strings.Split(info, "\n") {
		if value, ok := strings.CutPrefix(line, "state.windows="); ok {
			count, err := strconv.Atoi(strings.TrimSpace(value))
			return err == nil && count > 0
		}
	}
	return false
}

func (m *Manager) finish(s *ownedSession, code string) {
	m.mu.Lock()
	wasRunning := s.view.State == "running"
	if s.view.ErrorCode == "" {
		s.view.ErrorCode = code
	}
	s.view.State = "ended"
	// Xpra cleanup errors retain its ended lifecycle. A native helper failure
	// cannot prove the host application closed and must retain viewer recovery.
	if s.view.ErrorCode != "" && (!wasRunning || s.native != nil) {
		s.view.State = "failed"
	}
	s.password = ""
	m.forwards.ReleaseOwnedForwardSession(s.view.Forward.Forward.ForwardID)
	_ = os.Remove(filepath.Join(m.state, "sessions", s.view.ID, "password"))
	_ = os.RemoveAll(s.socketDir)
	close(s.done)
	m.mu.Unlock()
}

func (m *Manager) Stop(ctx context.Context, owner, id string) error {
	m.mu.Lock()
	s := m.sessions[id]
	if s == nil || s.owner != owner {
		m.mu.Unlock()
		return ErrNotFound
	}
	if s.native != nil {
		ended := s.view.State == "ended" || s.view.State == "failed"
		m.mu.Unlock()
		if ended {
			return nil
		}
		return s.native.send(map[string]any{"action": "stop"})
	}
	s.stopping = true
	cmd := s.cmd
	m.mu.Unlock()
	if cmd != nil {
		return stopProcess(ctx, cmd, s.done)
	}
	return nil
}

func (m *Manager) Close() error {
	m.setupMu.Lock()
	m.setupClosed = true
	if m.setup != nil {
		m.setup.Close()
	}
	m.setupMu.Unlock()
	m.mu.Lock()
	m.closed = true
	var all []*ownedSession
	for _, s := range m.sessions {
		all = append(all, s)
	}
	m.mu.Unlock()
	for _, s := range all {
		if s.native != nil {
			s.native.cancel()
			select {
			case <-s.done:
			case <-time.After(5 * time.Second):
			}
			continue
		}
		_ = m.Stop(context.Background(), s.owner, s.view.ID)
	}
	return nil
}

func (m *Manager) ForTarget(target string) (Session, string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		if (s.view.State == "starting" || s.view.State == "running") && s.view.Forward != nil && s.view.Forward.Forward.TargetURL == target {
			return cloneSession(s.view), s.owner, true
		}
	}
	return Session{}, "", false
}

// ForForward keeps terminal presentation addressable after the network forward
// is released. Exact forward identity cannot reclaim a reused loopback address.
func (m *Manager) ForForward(id string) (Session, string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		if s.view.Forward != nil && s.view.Forward.Forward.ForwardID == id {
			return cloneSession(s.view), s.owner, true
		}
	}
	return Session{}, "", false
}

func (m *Manager) Password(id string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s := m.sessions[id]; s != nil {
		return s.password
	}
	return ""
}

func cloneSession(s Session) Session {
	if s.Forward != nil {
		f := *s.Forward
		s.Forward = &f
	}
	return s
}
func randomID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func quoteArgv(args []string) string {
	out := make([]string, len(args))
	for i, arg := range args {
		out[i] = "'" + strings.ReplaceAll(arg, "'", "'\"'\"'") + "'"
	}
	return strings.Join(out, " ")
}
func applicationEnvironment(env []string) []string {
	out := make([]string, 0, len(env)+3)
	for _, item := range env {
		key, _, _ := strings.Cut(item, "=")
		switch key {
		case "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "DESKTOP_STARTUP_ID", "DBUS_SESSION_BUS_ADDRESS", "SESSION_MANAGER", "PULSE_SERVER", "GDK_BACKEND", "QT_QPA_PLATFORM":
			continue
		}
		out = append(out, item)
	}
	return append(out, "GDK_BACKEND=x11", "QT_QPA_PLATFORM=xcb")
}

var xpraVersion = regexp.MustCompile(`(?i)xpra v?([0-9]+)\.`)

func supportedVersion(version string) bool {
	parts := xpraVersion.FindStringSubmatch(version)
	if len(parts) != 2 {
		return false
	}
	major, _ := strconv.Atoi(parts[1])
	return major == 6
}

func (m *Manager) trimCompletedLocked() {
	// Bound retained diagnostics to the most recent completed sessions.
	if len(m.sessions) >= 48 {
		var oldest *ownedSession
		for _, candidate := range m.sessions {
			if candidate.view.State != "ended" && candidate.view.State != "failed" {
				continue
			}
			if oldest == nil || candidate.view.StartedAt < oldest.view.StartedAt {
				oldest = candidate
			}
		}
		if oldest != nil {
			delete(m.sessions, oldest.view.ID)
			_ = os.RemoveAll(filepath.Join(m.state, "sessions", oldest.view.ID))
		}
	}
}
