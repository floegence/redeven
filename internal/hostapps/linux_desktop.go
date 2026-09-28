package hostapps

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
)

// The helper is an application resource, not a child of a viewer or HTTP request.
func (m *Manager) startDesktopApplication(ctx context.Context, owner string, app Application, tools hostTools) (*linuxApplication, error) {
	if tools.desktop == nil {
		return nil, ErrUnavailable
	}
	command := helperCommand(ctx, tools.python, m.helper, m.custom, "resolve", "", app.ID)
	command.Env = tools.environment(command.Env)
	data, err := command.Output()
	if err != nil {
		return nil, ErrNotFound
	}
	var resolved struct {
		DesktopFile string `json:"desktop_file"`
	}
	if json.Unmarshal(data, &resolved) != nil || !filepath.IsAbs(resolved.DesktopFile) {
		return nil, ErrInvalid
	}
	manager, err := m.setupManager()
	if err != nil {
		return nil, err
	}
	environment := os.Environ()
	backend, err := manager.DesktopBackend()
	if err != nil {
		return nil, err
	}
	backends := []nativeapps.BackendCapability{backend}
	xpra := m.xpraLaunchTools(ctx, manager)
	if xpra.xpra != "" {
		backends = append(backends, nativeapps.BackendCapability{ID: "xpra", Component: xpra.componentIdentity(), Protocols: []string{"x11"}})
	}
	profile, err := m.browserProfileDirectory(owner, app.ID)
	if err != nil {
		return nil, err
	}
	plan, err := nativeapps.PlanApplication(ctx, nativeapps.ApplicationPlanOptions{
		Python: tools.python, Environment: tools.environment(environment), DesktopFile: resolved.DesktopFile, Backends: backends, BrowserProfileDirectory: profile,
	})
	if err != nil {
		return nil, err
	}
	if plan.Description().Backend.ID == "xpra" {
		availability, selected := clientInputTools(ctx, Availability{Supported: true, Ready: true}, xpra)
		if !availability.Ready {
			return nil, &nativeapps.LaunchUnavailable{Code: "GRAPHICAL_BACKEND_UNAVAILABLE", Stage: "preparation"}
		}
		return m.startApplication(owner, app, selected, plan)
	}
	id := randomID() + randomID()
	dir, socketDir := m.applicationDir(id), applicationSocketDir(id)
	if err := os.Mkdir(socketDir, 0700); err != nil {
		return nil, err
	}
	admitted := false
	defer func() {
		if !admitted {
			_ = os.RemoveAll(dir)
			_ = os.RemoveAll(socketDir)
		}
	}()
	prepared, err := manager.PrepareDesktopSession(ctx, nativeapps.DesktopSessionOptions{
		Directory: dir, Runtime: socketDir, Instance: id, Plan: plan, Environment: environment, HostBus: os.Getenv("DBUS_SESSION_BUS_ADDRESS"),
	})
	if err != nil {
		return nil, err
	}
	a := &linuxApplication{record: linuxApplicationRecord{Version: 3, Backend: "wayland", Component: prepared.Component, ID: id, Owner: owner,
		Application: app, Endpoint: &prepared.Endpoint, StartedAt: time.Now().UnixMilli()}, tools: tools, prepared: make(chan struct{})}
	cmd := exec.Command(prepared.Executable, prepared.Configuration)
	cmd.Dir = m.home
	cmd.Env = environment
	configureIndependentProcess(cmd)
	log, err := os.OpenFile(filepath.Join(dir, "session.log"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	cmd.Stdout, cmd.Stderr = log, log
	err = cmd.Start()
	_ = log.Close()
	if err != nil {
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
	go func() { done <- cmd.Wait() }()
	m.watchApplication(a, done)
	return a, nil
}

type desktopLifecycleObservation struct {
	Ready                bool
	ErrorCode, EndReason string
	Diagnostic           *LaunchDiagnostic
}

var launchDiagnosticCode = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,100}$`)
var launchDiagnosticStage = regexp.MustCompile(`^[a-z][a-z0-9_]{0,48}$`)

// Status queries read the supervisor's atomic receipt. DialDesktop is only for
// intentional control/sharing: using it here would take over an active viewer.
func (m *Manager) desktopReceipt(a *linuxApplication) (desktopLifecycleObservation, error) {
	path := filepath.Join(m.applicationDir(a.record.ID), "desktop-status.json")
	info, err := os.Lstat(path)
	if err != nil {
		return desktopLifecycleObservation{}, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() > 65536 {
		return desktopLifecycleObservation{}, ErrInvalid
	}
	f, err := os.Open(path)
	if err != nil {
		return desktopLifecycleObservation{}, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return desktopLifecycleObservation{}, ErrInvalid
	}
	data, err := io.ReadAll(io.LimitReader(f, 65537))
	if err != nil {
		return desktopLifecycleObservation{}, err
	}
	return decodeDesktopReceipt(data, a.record)
}

func decodeDesktopReceipt(data []byte, record linuxApplicationRecord) (desktopLifecycleObservation, error) {
	var receipt struct {
		Version     int    `json:"version"`
		Instance    string `json:"instance"`
		PID         int    `json:"helper_pid"`
		Started     uint64 `json:"helper_start_ticks"`
		Transitions []struct {
			State    string `json:"state"`
			Phase    string `json:"phase"`
			Code     string `json:"error_code"`
			ExitCode *int   `json:"exit_code"`
		} `json:"transitions"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	if len(data) > 65536 || decoder.Decode(&receipt) != nil || decoder.Decode(new(any)) != io.EOF || receipt.Version != 1 ||
		receipt.Instance != record.ID || receipt.PID != record.Process.PID || strconv.FormatUint(receipt.Started, 10) != record.Process.Started || len(receipt.Transitions) > 32 {
		return desktopLifecycleObservation{}, fmt.Errorf("invalid native application receipt")
	}
	result := desktopLifecycleObservation{}
	for _, transition := range receipt.Transitions {
		switch transition.State {
		case "starting", "terminating":
		case "prepared":
			result.Ready = true
		case "failed":
			if result.EndReason == "" && result.ErrorCode == "" {
				if !launchDiagnosticCode.MatchString(transition.Code) || !launchDiagnosticStage.MatchString(transition.Phase) {
					return desktopLifecycleObservation{}, ErrInvalid
				}
				result.Diagnostic = &LaunchDiagnostic{Stage: transition.Phase, Code: transition.Code, ExitCode: transition.ExitCode}
				result.ErrorCode = LaunchFailureCode(transition.Code)
				if result.ErrorCode == "launch_failed" && result.Ready && transition.Phase != "application" && transition.Phase != "application_start" {
					result.ErrorCode = "capture_failed"
				}
			}
		case "exited":
			if result.ErrorCode == "" {
				result.EndReason = "application_exited"
			}
		default:
			return desktopLifecycleObservation{}, ErrInvalid
		}
	}
	return result, nil
}

// Browser data survives viewer detach and application restarts. Only the released
// planner decides whether this product-owned location applies to the launcher.
func (m *Manager) browserProfileDirectory(owner, application string) (string, error) {
	root, err := filepath.EvalSymlinks(m.state)
	if err != nil {
		return "", err
	}
	id := sha256.Sum256([]byte(owner + "\x00" + application))
	return filepath.Join(root, "browser-profiles", fmt.Sprintf("%x", id)), nil
}
