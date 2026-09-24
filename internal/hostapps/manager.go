package hostapps

import (
	"bytes"
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
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
	application *linuxApplication
	proxy       *applicationProxy
	finishOnce  sync.Once
	native      *macSession
	view        Session
	owner       string
	password    string
	done        chan struct{}
	stopping    bool
	socketDir   string
	tools       hostTools
}

type Manager struct {
	appsMu                      sync.Mutex
	applications                map[string]*linuxApplication
	appsLock                    *os.File
	appsStop                    chan struct{}
	appsDone                    sync.WaitGroup
	launcher                    string
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
	nativeMu                    sync.Mutex
	nativeHost                  *macHost
}

func New(state, home string, forwards *portforward.Service) *Manager {
	root := filepath.Join(state, "host-applications")
	return &Manager{state: root, home: home, helper: filepath.Join(root, "desktop.py"), custom: filepath.Join(root, "applications"), forwards: forwards, sessions: make(map[string]*ownedSession), applications: make(map[string]*linuxApplication), appsStop: make(chan struct{})}
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
		if m.prepareErr == nil {
			m.launcher, m.prepareErr = nativeapps.WriteApplicationLauncher(m.state)
		}
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
	if err == nil && catalog.Availability.Ready {
		catalog.Running, err = m.linuxRunning(ctx, owner)
		// A removed desktop entry must not make a still-running owned instance
		// disappear from management. Retain its admitted identity until it exits.
		if err == nil {
			seen := make(map[string]bool)
			for _, app := range catalog.Applications {
				seen[app.ID] = true
			}
			m.appsMu.Lock()
			for _, a := range m.applications {
				if !a.ended && a.record.Owner == owner && a.record.Process.Alive() && !seen[a.record.Application.ID] {
					catalog.Applications = append(catalog.Applications, a.record.Application)
					seen[a.record.Application.ID] = true
				}
			}
			m.appsMu.Unlock()
		}
	}
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
	if owner == "" {
		return Session{}, ErrInvalid
	}
	for _, s := range []string{req.Presentation.Starting, req.Presentation.Failed, req.Presentation.Ended, req.Presentation.Retry, req.Presentation.Connecting, req.Presentation.Reconnecting, req.Presentation.Disconnected, req.Presentation.ConnectionHint, req.Presentation.Reconnect, req.Presentation.Locale} {
		if strings.TrimSpace(s) == "" || len(s) > 1024 {
			return Session{}, ErrInvalid
		}
	}
	for _, value := range []string{req.Presentation.TouchHelp, req.Presentation.TouchHelpTitle, req.Presentation.TouchHelpDescription, req.Presentation.Checking, req.Presentation.ApplicationExited, req.Presentation.ApplicationExitedHint, req.Presentation.WindowsClosed, req.Presentation.WindowsClosedHint, req.Presentation.SharingStopped, req.Presentation.SharingStoppedHint, req.Presentation.EndedHint, req.Presentation.SessionMissing, req.Presentation.SessionMissingHint, req.Presentation.AccessRequired, req.Presentation.AccessHint, req.Presentation.Dismiss, req.Presentation.SessionFailed, req.Presentation.ReopenHint, req.Presentation.PermissionRequired, req.Presentation.PermissionHint, req.Presentation.SessionUnavailable, req.Presentation.SessionHint, req.Presentation.CaptureHint, req.Presentation.VideoDecoding, req.Presentation.VideoAvailable, req.Presentation.VideoUnavailable, req.Presentation.HttpsPerformanceHint} {
		if len(value) > 1024 {
			return Session{}, ErrInvalid
		}
	}
	if runtime.GOOS == "darwin" {
		for _, value := range []string{req.Presentation.Quit, req.Presentation.QuitTitle, req.Presentation.QuitDescription, req.Presentation.QuitPending, req.Presentation.QuitFailed, req.Presentation.Cancel, req.Presentation.Controls, req.Presentation.Menu, req.Presentation.Input, req.Presentation.Windows, req.Presentation.CloseWindow, req.Presentation.SharedControl, req.Presentation.OperationFailed, req.Presentation.Waiting, req.Presentation.WaitingHint, req.Presentation.CaptureUnavailable, req.Presentation.Picture, req.Presentation.PictureAuto, req.Presentation.PictureClarity, req.Presentation.PictureSmooth, req.Presentation.PictureData, req.Presentation.PictureHint, req.Presentation.PictureReopenHint, req.Presentation.PictureAdvanced, req.Presentation.PicturePixels, req.Presentation.PictureResolution, req.Presentation.PictureFrameRate, req.Presentation.PictureActualRate, req.Presentation.PictureBandwidth, req.Presentation.PictureTransport, req.Presentation.PictureVideo, req.Presentation.PictureImages} {
			if strings.TrimSpace(value) == "" || len(value) > 1024 {
				return Session{}, ErrInvalid
			}
		}
		return m.macLaunch(ctx, owner, req)
	}
	if req.Mode != "" && req.Mode != "stream" {
		return Session{}, ErrInvalid
	}
	return m.launchLinux(ctx, owner, req)
}

func sessionHasWindows(parent context.Context, xpra, socketDir string) bool {
	entries, err := os.ReadDir(socketDir)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if entry.Type()&os.ModeSocket == 0 {
			continue
		}
		// Bound the subprocess while allowing a loaded host to report its actual
		// window inventory. Session cancellation also terminates probe children.
		ctx, cancel := context.WithTimeout(parent, 8*time.Second)
		cmd := exec.CommandContext(ctx, xpra, "info", "socket://"+filepath.Join(socketDir, entry.Name()))
		cmd.Env = xpraEnvironment(os.Environ())
		configureProcess(cmd)
		cmd.Cancel = func() error { return killProcess(cmd) }
		cmd.WaitDelay = time.Second
		out, err := cmd.Output()
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

func (m *Manager) finish(s *ownedSession, code string, release func()) {
	s.finishOnce.Do(func() {
		m.mu.Lock()
		wasRunning := s.view.State == "running"
		if s.view.ErrorCode == "" {
			s.view.ErrorCode = code
		}
		s.view.State = "ended"
		// A capture failure must remain visible for recovery instead of triggering
		// the viewer's normal application-ended dismissal.
		if s.view.ErrorCode != "" && (!wasRunning || s.native != nil || s.view.ErrorCode == "capture_failed") {
			s.view.State = "failed"
		}
		s.stopping = true
		s.password = ""
		m.forwards.ReleaseOwnedForwardSession(s.view.Forward.Forward.ForwardID)
		_ = os.Remove(filepath.Join(m.state, "sessions", s.view.ID, "password"))
		if s.application == nil {
			_ = os.RemoveAll(s.socketDir)
		}
		m.mu.Unlock()
		// Publish the terminal state before closing transport, but report completion
		// only after the supervisor has reclaimed every process and connection.
		if release != nil {
			release()
		}
		if s.proxy != nil {
			s.proxy.Close()
		}
		close(s.done)
	})
}

// requestStop commits a single stop independently of the request's lifetime.
// Cancelling an HTTP request may stop waiting, but cannot retain shared input.
func (m *Manager) requestStop(s *ownedSession) {
	if s.application != nil {
		m.mu.Lock()
		if s.stopping {
			m.mu.Unlock()
			return
		}
		s.stopping = true
		s.view.EndReason = "sharing_stopped"
		m.mu.Unlock()
		m.finish(s, "", nil)
		return
	}
	m.mu.Lock()
	s.stopping = true
	native := s.native
	m.mu.Unlock()
	if native != nil {
		native.cancel()
	}
}

func (m *Manager) Stop(ctx context.Context, owner, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	s := m.sessions[id]
	m.mu.Unlock()
	if s == nil || s.owner != owner {
		return ErrNotFound
	}
	m.requestStop(s)
	select {
	case <-s.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (m *Manager) Close() error {
	// Admission holds appsMu until its share is registered. Shutdown must take
	// its snapshot after that admission, including a slow native backend launch.
	m.appsMu.Lock()
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		m.appsMu.Unlock()
		return nil
	}
	m.closed = true
	m.mu.Unlock()
	m.appsMu.Unlock()
	m.setupMu.Lock()
	m.setupClosed = true
	if m.setup != nil {
		m.setup.Close()
	}
	m.setupMu.Unlock()
	m.mu.Lock()
	m.closed = true
	all := make([]*ownedSession, 0, len(m.sessions))
	for _, s := range m.sessions {
		all = append(all, s)
	}
	m.mu.Unlock()
	for _, s := range all {
		m.requestStop(s)
	}
	for _, s := range all {
		<-s.done
	}
	m.closeMacHost()
	m.appsMu.Lock()
	close(m.appsStop)
	if m.appsLock != nil {
		_ = m.appsLock.Close()
		m.appsLock = nil
	}
	m.appsMu.Unlock()
	m.appsDone.Wait()
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
