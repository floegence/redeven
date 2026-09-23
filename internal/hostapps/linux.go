package hostapps

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
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
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
)

// Application instances outlive temporary, authorized sharing sessions. The
// record locates an owned backend; live kernel identity and Xpra's identity must
// both match before a restarted Runtime can expose it again.
type linuxApplicationRecord struct {
	Version     int                        `json:"version"`
	Component   string                     `json:"component,omitempty"`
	ID          string                     `json:"id"`
	Owner       string                     `json:"owner"`
	Application Application                `json:"application"`
	Address     string                     `json:"address"`
	Process     nativeapps.ProcessIdentity `json:"process"`
	StartedAt   int64                      `json:"started_at_unix_ms"`
}
type linuxApplication struct {
	record               linuxApplicationRecord
	tools                hostTools
	input                nativeapps.ClientInput
	assets               *nativeapps.ClientAssets // protected by Manager.appsMu
	ready, ended         bool                     // protected by Manager.appsMu
	terminationRequested bool
}

var applicationInstanceID = regexp.MustCompile(`^[a-f0-9]{64}$`)

func (m *Manager) applicationDir(id string) string { return filepath.Join(m.state, "instances", id) }
func applicationSocketDir(id string) string {
	return filepath.Join(os.TempDir(), "redeven-app-"+id[:32])
}
func (m *Manager) writeApplication(a *linuxApplication) error {
	data, err := json.Marshal(a.record)
	if err != nil {
		return err
	}
	dir := m.applicationDir(a.record.ID)
	if err = os.WriteFile(filepath.Join(dir, "instance.json.tmp"), data, 0600); err != nil {
		return err
	}
	return os.Rename(filepath.Join(dir, "instance.json.tmp"), filepath.Join(dir, "instance.json"))
}

func decodeApplicationRecord(data []byte, id string) (linuxApplicationRecord, error) {
	var r linuxApplicationRecord
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if len(data) > 1<<20 || decoder.Decode(&r) != nil || decoder.Decode(new(any)) != io.EOF ||
		!applicationInstanceID.MatchString(id) || (r.Version != 1 && r.Version != 2) || r.ID != id || r.Owner == "" ||
		r.Application.ID == "" || r.Process.PID <= 0 || r.Process.Boot == "" || r.Process.Started == "" || r.StartedAt <= 0 {
		return r, fmt.Errorf("unsupported or incomplete host application instance")
	}
	if (r.Version == 1 && r.Component != "") || (r.Version == 2 && r.Component != "system" && !applicationInstanceID.MatchString(r.Component)) {
		return r, fmt.Errorf("invalid host application component identity")
	}
	host, port, err := net.SplitHostPort(r.Address)
	p, portErr := strconv.Atoi(port)
	if err != nil || portErr != nil || host != "127.0.0.1" || p <= 0 || p > 65535 {
		return r, fmt.Errorf("invalid host application address")
	}
	return r, nil
}

func (m *Manager) ensureApplications(ctx context.Context) error {
	if err := m.prepare(); err != nil {
		return err
	}
	m.appsMu.Lock()
	defer m.appsMu.Unlock()
	if m.appsLock != nil {
		return nil
	}
	m.mu.Lock()
	closed := m.closed
	m.mu.Unlock()
	if closed {
		return ErrUnavailable
	}
	lock, err := lockApplicationStore(filepath.Join(m.state, "instances.lock"))
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = lock.Close()
		}
	}()
	root := filepath.Join(m.state, "instances")
	if err = os.MkdirAll(root, 0700); err != nil {
		return err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	var recovered []*linuxApplication
	for _, entry := range entries {
		if !entry.IsDir() || !applicationInstanceID.MatchString(entry.Name()) {
			return fmt.Errorf("invalid host application instance directory")
		}
		data, err := os.ReadFile(filepath.Join(root, entry.Name(), "instance.json"))
		if err != nil {
			return fmt.Errorf("host application instance requires recovery: %w", err)
		}
		r, err := decodeApplicationRecord(data, entry.Name())
		if err != nil {
			return err
		}
		if !r.Process.Alive() {
			continue
		}
		legacy := r.Version == 1
		tools, err := m.recoverApplicationTools(ctx, &r)
		if err != nil {
			return fmt.Errorf("host application component recovery: %w", err)
		}
		a := &linuxApplication{record: r, tools: tools}
		identity, err := m.applicationCommand(ctx, a, "id")
		if err != nil || !strings.Contains("\n"+string(identity), "\nsession-name="+r.ID+"\n") {
			return fmt.Errorf("cannot verify surviving host application backend: %w", ErrUnavailable)
		}
		if legacy {
			if err := m.writeApplication(a); err != nil {
				return err
			}
		}
		recovered = append(recovered, a)
	}
	m.appsLock = lock
	committed = true
	for _, a := range recovered {
		m.applications[a.record.ID] = a
		m.watchApplication(a, nil)
	}
	return nil
}

// Each backend retains its own component identity across updates and Runtime
// restarts. Legacy records are migrated only after live backend verification.
func (m *Manager) recoverApplicationTools(ctx context.Context, r *linuxApplicationRecord) (hostTools, error) {
	manager, err := m.setupManager()
	if err != nil {
		return hostTools{}, err
	}
	if r.Version == 1 {
		installed, err := manager.InstallationForProcess(r.Process)
		if err != nil {
			return hostTools{}, err
		}
		r.Component = "system"
		if installed != nil {
			r.Component = installed.Digest
		}
		r.Version = 2
	}
	if r.Component != "system" {
		return resolveManagedTools(manager, r.Component)
	}
	availability, tools := detectDependencies(ctx, "linux", os.Environ())
	if !availability.Ready {
		return hostTools{}, ErrUnavailable
	}
	return tools, nil
}

func (m *Manager) launchLinux(ctx context.Context, owner string, req LaunchRequest) (Session, error) {
	if err := m.ensureApplications(ctx); err != nil {
		return Session{}, err
	}
	m.appsMu.Lock()
	defer m.appsMu.Unlock()
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return Session{}, ErrUnavailable
	}
	for _, s := range m.sessions {
		if !s.stopping && s.owner == owner && s.view.Application.ID == req.ApplicationID && (s.view.State == "starting" || s.view.State == "running") {
			view := cloneSession(s.view)
			m.mu.Unlock()
			return view, nil
		}
	}
	m.mu.Unlock()
	var application *linuxApplication
	active := 0
	for _, a := range m.applications {
		if a.ended || !a.record.Process.Alive() {
			continue
		}
		active++
		if a.record.Owner == owner && a.record.Application.ID == req.ApplicationID {
			application = a
		}
	}
	if application == nil {
		if active >= 12 {
			return Session{}, ErrLimit
		}
		catalog, tools, err := m.catalog(ctx, owner, req.Locale)
		if err != nil {
			return Session{}, err
		}
		if !catalog.Availability.Ready {
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
		application, err = m.startApplication(owner, app, tools)
		if err != nil {
			return Session{}, err
		}
		m.applications[application.record.ID] = application
	}
	return m.shareApplication(ctx, owner, application, req.Presentation)
}

func (m *Manager) shareApplication(ctx context.Context, owner string, a *linuxApplication, presentation Presentation) (Session, error) {
	// Snapshot once for this application's lifetime, including recovered instances.
	// Detaching a viewer preserves the exact resource version for the next share.
	if a.assets == nil {
		assets, err := nativeapps.OpenClientAssets(filepath.Join(m.applicationDir(a.record.ID), "www"))
		if err != nil {
			return Session{}, fmt.Errorf("prepare application resources: %w", err)
		}
		a.assets = assets
	}
	password := randomID() + randomID()
	path := filepath.Join(m.applicationDir(a.record.ID), "password")
	if err := os.WriteFile(path+".tmp", []byte(password), 0600); err != nil {
		return Session{}, err
	}
	if err := os.Rename(path+".tmp", path); err != nil {
		return Session{}, err
	}
	proxy, address, err := newApplicationProxy("http://"+a.record.Address, a.assets)
	if err != nil {
		return Session{}, err
	}
	forward, err := m.forwards.OpenOwnedForwardSession(ctx, "http://"+address+"/_redeven_host_app/")
	if err != nil {
		proxy.Close()
		return Session{}, err
	}
	state := "starting"
	if a.ready {
		state = "running"
	}
	s := &ownedSession{application: a, proxy: proxy, tools: a.tools, socketDir: applicationSocketDir(a.record.ID), owner: owner, password: password, done: make(chan struct{}),
		view: Session{ID: randomID(), Application: a.record.Application, State: state, Backend: "linux", Mode: "stream", StartedAt: time.Now().UnixMilli(), Forward: forward, Presentation: presentation}}
	m.mu.Lock()
	m.trimCompletedLocked()
	m.sessions[s.view.ID] = s
	view := cloneSession(s.view)
	m.mu.Unlock()
	return view, nil
}

func (m *Manager) applicationArgs(a *linuxApplication) []string {
	dir, socketDir := m.applicationDir(a.record.ID), applicationSocketDir(a.record.ID)
	t := a.tools
	args := []string{t.inputPython, a.input.Launcher, "start", "--daemon=no", "--systemd-run=no", "--attach=no", "--use-display=no", "--bind-ws=" + a.record.Address,
		"--ws-auth=file:filename=" + filepath.Join(dir, "password"), "--html=" + filepath.Join(dir, "www"), "--sessions-dir=" + filepath.Join(socketDir, "sessions"), "--socket-dir=" + socketDir, "--socket-dirs=" + socketDir,
		"--bind=" + filepath.Join(socketDir, "control"), "--terminate-children=yes", "--start-new-commands=no", "--sharing=no", "--mdns=no", "--source=", "--source-start=",
		"--webcam=no", "--printing=no", "--file-transfer=no", "--notifications=no", "--dbus-launch=", "--session-name=" + a.record.ID,
		"--xvfb=" + quoteArgv([]string{t.xvfb, "-screen", "0", "3840x2160x24", "-nolisten", "tcp", "-noreset", "+extension", "Composite", "-auth", "$XAUTHORITY"}),
		"--start-child=" + quoteArgv([]string{t.python, m.helper, "launch", m.custom, a.record.Application.ID, filepath.Join(dir, "launch.json"), m.launcher})}
	args = append(args, nativeapps.XpraNoAudioArgs()...)
	args = append(args, a.input.XpraArgs(os.Environ())...)
	return append(args, nativeapps.XpraApplicationLifetimeArgs()...)
}

func (m *Manager) startApplication(owner string, app Application, tools hostTools) (*linuxApplication, error) {
	id := randomID() + randomID()
	dir, socketDir := m.applicationDir(id), applicationSocketDir(id)
	if err := os.Mkdir(dir, 0700); err != nil {
		return nil, err
	}
	admitted := false
	defer func() {
		if !admitted {
			_ = os.RemoveAll(dir)
			_ = os.RemoveAll(socketDir)
		}
	}()
	if err := os.Mkdir(socketDir, 0700); err != nil {
		return nil, err
	}
	if err := os.Mkdir(filepath.Join(socketDir, "xpra"), 0700); err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	address := listener.Addr().String()
	_ = listener.Close()
	component := tools.componentDigest
	if component == "" {
		component = "system"
	}
	a := &linuxApplication{record: linuxApplicationRecord{Version: 2, Component: component, ID: id, Owner: owner, Application: app, Address: address, StartedAt: time.Now().UnixMilli()}, tools: tools}
	a.input, err = nativeapps.PrepareClientInput(filepath.Join(dir, "input"), runtime.GOARCH)
	if err != nil {
		return nil, err
	}
	if err = nativeapps.PrepareInputClient(tools.html, filepath.Join(dir, "www")); err != nil {
		return nil, err
	}
	a.assets, err = nativeapps.OpenClientAssets(filepath.Join(dir, "www"))
	if err != nil {
		return nil, err
	}
	if err = os.WriteFile(filepath.Join(dir, "password"), []byte(randomID()+randomID()), 0600); err != nil {
		return nil, err
	}
	if err = m.writeApplication(a); err != nil {
		return nil, err
	}
	launcher := []string{"--", "/bin/sh", "-c", `exec "$@" --dbus=no --dbus-control=no "--start-env=DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"`, "redeven-xpra"}
	cmd := exec.Command(tools.dbus, append(launcher, m.applicationArgs(a)...)...)
	cmd.Dir = m.home
	cmd.Env = append(xpraEnvironment(tools.environment(applicationEnvironment(os.Environ()))), "XDG_RUNTIME_DIR="+socketDir)
	configureIndependentProcess(cmd)
	log, err := os.OpenFile(filepath.Join(dir, "session.log"), os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	cmd.Stdout, cmd.Stderr = log, log
	err = cmd.Start()
	_ = log.Close()
	if err != nil {
		_ = os.RemoveAll(dir)
		_ = os.RemoveAll(socketDir)
		return nil, err
	}
	a.record.Process, err = nativeapps.ObserveProcess(cmd.Process.Pid)
	if err == nil {
		err = m.writeApplication(a)
	}
	if err != nil {
		_ = killProcess(cmd)
		_ = cmd.Wait()
		return nil, err
	}
	admitted = true
	done := make(chan error, 1)
	go func() { err := cmd.Wait(); _ = killProcess(cmd); done <- err }()
	m.watchApplication(a, done)
	return a, nil
}

func applicationReceipt(path string) string {
	data, err := os.ReadFile(path)
	var receipt struct {
		State string `json:"state"`
	}
	if err != nil || json.Unmarshal(data, &receipt) != nil {
		return ""
	}
	return receipt.State
}

func (m *Manager) watchApplication(a *linuxApplication, done <-chan error) {
	m.appsDone.Add(1)
	go func() {
		defer m.appsDone.Done()
		tick := time.NewTicker(250 * time.Millisecond)
		defer tick.Stop()
		client := http.Client{Timeout: time.Second}
		observedAt := time.Now()
		phase := "launch"
		if done == nil {
			phase = "recovery"
		}
		for {
			select {
			case <-m.appsStop:
				return
			case <-tick.C:
			case <-done:
			}
			receipt := applicationReceipt(filepath.Join(m.applicationDir(a.record.ID), "launch.json"))
			alive := a.record.Process.Alive()
			m.appsMu.Lock()
			ready := a.ready
			m.appsMu.Unlock()
			if !alive {
				m.appsMu.Lock()
				a.ended = true
				a.assets = nil
				m.appsMu.Unlock()
				code, reason := "capture_failed", ""
				m.appsMu.Lock()
				terminated := a.terminationRequested
				m.appsMu.Unlock()
				if receipt == "exited" || terminated {
					code, reason = "", "application_exited"
				} else if receipt == "failed" {
					code = "launch_failed"
				}
				if code != "" {
					slog.Warn("host application backend ended", "instance", a.record.ID, "error_code", code)
				}
				m.finishApplicationShares(a, code, reason)
				return
			}
			if !ready && receipt == "running" {
				res, err := client.Get("http://" + a.record.Address + "/index.html")
				if err == nil {
					_ = res.Body.Close()
					if res.StatusCode == http.StatusOK {
						ready = true
						m.appsMu.Lock()
						a.ready = true
						m.appsMu.Unlock()
						m.mu.Lock()
						for _, s := range m.sessions {
							if s.application == a && !s.stopping {
								s.view.State = "running"
							}
						}
						m.mu.Unlock()
						tick.Reset(time.Second)
						slog.Info("host application ready", "instance", a.record.ID, "backend", "xpra", "phase", phase, "duration_ms", time.Since(observedAt).Milliseconds())
					}
				}
			}
			if !ready && time.Since(observedAt) > 40*time.Second {
				// Unconfirmed startup cannot spin forever or authorize killing
				// an application whose launch receipt may have been interrupted.
				tick.Reset(time.Second)
				code := "launch_failed"
				if receipt == "running" {
					code = "capture_failed"
				}
				m.finishApplicationShares(a, code, "")
			}
		}
	}()
}

func (m *Manager) finishApplicationShares(a *linuxApplication, code, reason string) {
	m.mu.Lock()
	var shares []*ownedSession
	for _, s := range m.sessions {
		if s.application == a && !s.stopping {
			s.view.EndReason = reason
			shares = append(shares, s)
		}
	}
	m.mu.Unlock()
	for _, s := range shares {
		m.finish(s, code, nil)
	}
}

func (m *Manager) applicationCommand(ctx context.Context, a *linuxApplication, action string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, a.tools.xpra, append([]string{action, "socket://" + filepath.Join(applicationSocketDir(a.record.ID), "control")}, args...)...)
	command.Env = xpraEnvironment(a.tools.environment(os.Environ()))
	configureProcess(command)
	command.Cancel = func() error { return killProcess(command) }
	command.WaitDelay = time.Second
	return command.Output()
}

func (m *Manager) linuxRunning(ctx context.Context, owner string) ([]RunningApplication, error) {
	if err := m.ensureApplications(ctx); err != nil {
		return nil, err
	}
	m.appsMu.Lock()
	defer m.appsMu.Unlock()
	result := []RunningApplication{}
	for _, a := range m.applications {
		if !a.ended && a.record.Owner == owner && a.record.Process.Alive() {
			result = append(result, RunningApplication{ApplicationID: a.record.Application.ID, Instances: []string{a.record.ID}})
		}
	}
	return result, nil
}

func (m *Manager) controlLinuxApplication(ctx context.Context, owner string, req QuitRequest, force bool) error {
	if err := m.ensureApplications(ctx); err != nil {
		return err
	}
	m.appsMu.Lock()
	defer m.appsMu.Unlock()
	m.mu.Lock()
	closed := m.closed
	m.mu.Unlock()
	if closed {
		return ErrUnavailable
	}
	if len(req.Instances) != 1 {
		return ErrInvalid
	}
	a := m.applications[req.Instances[0]]
	if a == nil || a.ended || a.record.Owner != owner || a.record.Application.ID != req.ApplicationID || !a.record.Process.Alive() {
		return ErrNotFound
	}
	if force {
		identity, err := m.applicationCommand(ctx, a, "id")
		if err != nil || !strings.Contains("\n"+string(identity), "\nsession-name="+a.record.ID+"\n") {
			return ErrUnavailable
		}
		_, err = m.applicationCommand(ctx, a, "stop")
		if err == nil {
			a.terminationRequested = true
		}
		return err
	}
	info, err := m.applicationCommand(ctx, a, "info")
	if err != nil {
		return err
	}
	// Xpra exports one property per managed X11 window. Request normal closure;
	// never substitute a signal when an application keeps running without windows.
	ids := applicationWindowCloseTargets(string(info))
	for _, id := range ids {
		if _, err := m.applicationCommand(ctx, a, "control", "close", id); err != nil {
			return err
		}
	}
	return nil
}

func applicationWindowCloseTargets(info string) []string {
	// Snapshot top-level windows only. Sending close to a save dialog as well
	// could discard/cancel the very prompt produced by the parent's close request.
	windows := map[string]map[string]string{}
	for _, line := range strings.Split(string(info), "\n") {
		if !strings.HasPrefix(line, "windows.") {
			continue
		}
		id, field, ok := strings.Cut(strings.TrimPrefix(line, "windows."), ".")
		if n, err := strconv.Atoi(id); ok && err == nil && n > 0 {
			key, value, valid := strings.Cut(field, "=")
			if valid {
				if windows[id] == nil {
					windows[id] = map[string]string{}
				}
				windows[id][key] = strings.TrimSpace(value)
			}
		}
	}
	ids := []string{}
	for id, fields := range windows {
		isTrue := func(key string) bool { return strings.EqualFold(fields[key], "true") || fields[key] == "1" }
		transient, _ := strconv.Atoi(fields["transient-for"])
		if isTrue("override-redirect") || isTrue("tray") || isTrue("modal") || transient > 0 || strings.Contains(fields["window-type"], "DIALOG") {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// ClientAssets selects public bytes for an authenticated owner. The caller must
// separately authorize session documents and live control, even on cache hits.
func (m *Manager) ClientAssets(owner, digest string) *nativeapps.ClientAssets {
	m.appsMu.Lock()
	defer m.appsMu.Unlock()
	for _, a := range m.applications {
		if !a.ended && a.record.Owner == owner && a.assets != nil && a.assets.Digest() == digest {
			return a.assets
		}
	}
	return nil
}
