package hostapps

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
)

type SetupPackage struct {
	ID             string `json:"id"`
	Digest         string `json:"digest"`
	Architecture   string `json:"architecture"`
	SizeBytes      int64  `json:"size_bytes"`
	InstalledBytes int64  `json:"installed_bytes"`
}
type SetupStatus struct {
	nativeapps.Status
	Package *SetupPackage `json:"package,omitempty"`
}

func (m *Manager) setupManager() (*nativeapps.Manager, error) {
	m.setupMu.Lock()
	defer m.setupMu.Unlock()
	if m.setupClosed {
		return nil, ErrUnavailable
	}
	if m.setup != nil {
		return m.setup, nil
	}
	pkg, err := nativeapps.DesktopForPlatform(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return nil, err
	}
	setup, err := nativeapps.New(filepath.Join(m.state, "native-components"), pkg, nil)
	if err != nil {
		return nil, err
	}
	m.setup = setup
	return setup, nil
}
func setupView(manager *nativeapps.Manager, owner string) SetupStatus {
	pkg := manager.Package()
	return SetupStatus{Status: manager.Snapshot(owner), Package: &SetupPackage{pkg.ID, pkg.Digest(), pkg.Architecture, pkg.SizeBytes, pkg.InstalledBytes}}
}
func (m *Manager) SetupStatus(owner string) (SetupStatus, error) {
	manager, err := m.setupManager()
	if errors.Is(err, nativeapps.ErrUnsupported) {
		return SetupStatus{Status: nativeapps.Status{State: "unsupported"}}, nil
	}
	if err != nil {
		return SetupStatus{}, err
	}
	return setupView(manager, owner), nil
}
func (m *Manager) WatchSetup() (<-chan struct{}, func(), error) {
	manager, err := m.setupManager()
	if err != nil {
		return nil, nil, err
	}
	changes, stop := manager.Watch()
	return changes, stop, nil
}
func (m *Manager) StartSetup(owner, requestID, source string, size int64, digest string) (SetupStatus, error) {
	manager, err := m.setupManager()
	if err != nil {
		return SetupStatus{}, err
	}
	if digest != "" && digest != manager.Package().Digest() {
		return setupView(manager, owner), ErrInvalid
	}
	_, err = manager.Start(owner, requestID, source, size)
	return setupView(manager, owner), err
}
func (m *Manager) CancelSetup(owner, id string) (SetupStatus, error) {
	manager, err := m.setupManager()
	if err != nil {
		return SetupStatus{}, err
	}
	_, err = manager.Cancel(owner, id)
	return setupView(manager, owner), err
}
func (m *Manager) WriteSetup(owner, id string, offset int64, data []byte) (SetupStatus, error) {
	manager, err := m.setupManager()
	if err != nil {
		return SetupStatus{}, err
	}
	_, err = manager.WriteChunk(owner, id, offset, data)
	return setupView(manager, owner), err
}
func (m *Manager) CompleteSetup(owner, id string) (SetupStatus, error) {
	manager, err := m.setupManager()
	if err != nil {
		return SetupStatus{}, err
	}
	_, err = manager.CompleteUpload(owner, id)
	return setupView(manager, owner), err
}

type SetupTransferPlan = nativeapps.TransferPlan

func (m *Manager) SetupPlan(ctx context.Context, _ string) (SetupTransferPlan, error) {
	manager, err := m.setupManager()
	if err != nil {
		return SetupTransferPlan{}, err
	}
	return manager.Plan(ctx)
}

func resolveManagedTools(manager *nativeapps.Manager, digest string) (hostTools, error) {
	root, err := manager.DirectoryFor(digest)
	if err != nil {
		return hostTools{}, err
	}
	tools, err := nativeapps.ResolveTools(root)
	if err != nil {
		return hostTools{}, err
	}
	return hostTools{xpra: tools.Xpra, python: tools.Python, xvfb: tools.Xvfb, dbus: tools.DBus, html: tools.HTML, managed: &tools, componentDigest: digest}, nil
}

func resolveDesktopTools(manager *nativeapps.Manager, digest string) (hostTools, error) {
	root, err := manager.DirectoryFor(digest)
	if err != nil {
		return hostTools{}, err
	}
	tools, err := nativeapps.ResolveDesktopTools(root, runtime.GOARCH)
	if err != nil {
		return hostTools{}, err
	}
	return hostTools{python: tools.Python, desktop: &tools, componentDigest: digest}, nil
}

// Only an explicit upstream desktop-entry contract can select these resources.
// Missing Xpra support never changes the combined default or triggers a retry.
func (m *Manager) xpraLaunchTools(ctx context.Context, manager *nativeapps.Manager) hostTools {
	if pkg, err := nativeapps.ForPlatform(runtime.GOOS, runtime.GOARCH); err == nil {
		if tools, err := resolveManagedTools(manager, pkg.Digest()); err == nil {
			return tools
		}
	}
	if installed := manager.Snapshot("").Installed; installed != nil && installed.Ready && installed.Contract == "xpra-6-private-v1" {
		if tools, err := resolveManagedTools(manager, installed.Digest); err == nil {
			return tools
		}
	}
	availability, tools := detectDependencies(ctx, runtime.GOOS, os.Environ())
	if availability.Ready {
		return tools
	}
	return hostTools{}
}

func (t hostTools) componentIdentity() string {
	if t.componentDigest != "" {
		return t.componentDigest
	}
	return "system"
}

func (m *Manager) tools(ctx context.Context) (Availability, hostTools) {
	availability, tools := m.installedTools(ctx)
	if tools.desktop != nil {
		return availability, tools
	}
	// Retained Xpra resources remain usable by existing instances. New default
	// launches require the combined capability; missing preparation is not a
	// reason to silently execute the application in another graphical backend.
	availability.Ready = false
	if availability.Supported {
		availability.Reason = "missing_dependencies"
	}
	return availability, tools
}

// Resolve current resources independently of a retained application's backend.
func (m *Manager) installedTools(ctx context.Context) (Availability, hostTools) {
	if runtime.GOOS == "linux" {
		manager, err := m.setupManager()
		if err == nil {
			if backend, err := manager.DesktopBackend(); err == nil {
				if tools, err := resolveDesktopTools(manager, backend.Component); err == nil {
					return Availability{Supported: true, Ready: true, Backend: "wayland"}, tools
				}
			}
			if installed := manager.Snapshot("").Installed; installed != nil && installed.Ready {
				if tools, err := resolveManagedTools(manager, installed.Digest); err == nil {
					return Availability{Supported: true, Ready: true}, tools
				}
			}
		}
	}
	return detectDependencies(ctx, runtime.GOOS, os.Environ())
}

// Only new launches require the input capability. Recovery retains the exact
// old backend and its component identity without changing or ending its app.
func clientInputTools(ctx context.Context, availability Availability, tools hostTools) (Availability, hostTools) {
	if !availability.Ready {
		return availability, tools
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	var err error
	if tools.managed != nil {
		tools.inputPython = tools.managed.Python
		_, err = nativeapps.ProbeClientInput(ctx, tools.inputPython, tools.environment(os.Environ()))
	} else {
		tools.inputPython, err = nativeapps.SystemClientInputPython(ctx, tools.xpra, os.Environ())
	}
	if err != nil {
		availability.Ready = false
		availability.Reason = "missing_dependencies"
		availability.Requirements = append(availability.Requirements, "Xpra client input v1 (GIO, xcb-imdkit)")
	}
	return availability, tools
}
func (t hostTools) environment(base []string) []string {
	if t.desktop != nil {
		return t.desktop.Environment(base)
	}
	if t.managed != nil {
		return t.managed.Environment(base)
	}
	return base
}
