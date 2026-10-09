package remotedesktop

import (
	"path/filepath"
	"runtime"

	nativeapps "github.com/floegence/floe-native-apps"
)

func (m *Manager) ServiceMediaCache() string {
	return filepath.Join(m.state, "remote-desktop", "components")
}

func (m *Manager) setupManager() (*nativeapps.Manager, error) {
	m.setupMu.Lock()
	defer m.setupMu.Unlock()
	select {
	case <-m.stop:
		return nil, ErrUnavailable
	default:
	}
	if m.setup != nil {
		return m.setup, nil
	}
	pkg, err := nativeapps.HostDesktopForPlatform(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return nil, err
	}
	m.setup, err = nativeapps.New(m.ServiceMediaCache(), pkg, nil)
	return m.setup, err
}
func (m *Manager) SetupStatus(owner string) (nativeapps.Status, error) {
	manager, err := m.setupManager()
	if err != nil {
		return nativeapps.Status{}, err
	}
	return manager.Snapshot(owner), nil
}
func (m *Manager) StartSetup(owner, requestID string) (nativeapps.Status, error) {
	manager, err := m.setupManager()
	if err != nil {
		return nativeapps.Status{}, err
	}
	return manager.Start(owner, requestID, "download", 0)
}
func (m *Manager) CancelSetup(owner, id string) (nativeapps.Status, error) {
	manager, err := m.setupManager()
	if err != nil {
		return nativeapps.Status{}, err
	}
	return manager.Cancel(owner, id)
}
