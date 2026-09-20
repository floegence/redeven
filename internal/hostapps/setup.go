package hostapps

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"

	nativeapps "github.com/floegence/floe-native-apps"
)

type SetupPackage struct {
	ID             string `json:"id"`
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
	pkg, err := nativeapps.NativePackage()
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
	return SetupStatus{Status: manager.Snapshot(owner), Package: &SetupPackage{pkg.ID, pkg.Architecture, pkg.SizeBytes, pkg.InstalledBytes}}
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
func (m *Manager) StartSetup(owner, requestID, source string, size int64) (SetupStatus, error) {
	manager, err := m.setupManager()
	if err != nil {
		return SetupStatus{}, err
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
func (m *Manager) tools(ctx context.Context) (Availability, hostTools) {
	if runtime.GOOS == "linux" {
		manager, err := m.setupManager()
		if err == nil {
			root, err := manager.Directory()
			if err == nil {
				tools, err := nativeapps.ResolveTools(root)
				if err == nil {
					return Availability{Supported: true, Ready: true}, hostTools{xpra: tools.Xpra, python: tools.Python, xvfb: tools.Xvfb, dbus: tools.DBus, html: tools.HTML, managed: &tools}
				}
			}
		}
	}
	return detectDependencies(ctx, runtime.GOOS, os.Environ())
}
func (t hostTools) environment(base []string) []string {
	if t.managed != nil {
		return t.managed.Environment(base)
	}
	return base
}
