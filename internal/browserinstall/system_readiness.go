package browserinstall

import (
	"errors"
	"runtime"
	"time"
)

var ErrSystemPreparationRequired = errors.New("browser system preparation required")
var ErrDependenciesMissing = errors.New("browser system dependencies missing")
var ErrLaunchUnavailable = errors.New("browser executable could not start")

func (m *Manager) launchExecutableLocked(recheck bool) (string, error) {
	if m.sandboxUnavailable {
		return "", ErrSystemPreparationRequired
	}
	executable, err := systemBrowserExecutable(m.status.Package, m.status.Directory)
	if err != nil {
		return "", err
	}
	if recheck || m.dependenciesPath != executable || time.Now().After(m.dependenciesUntil) {
		m.dependenciesError = systemBrowserDependencies(m.status.Package, executable)
		m.dependenciesPath = executable
		m.dependenciesUntil = time.Now().Add(5 * time.Second)
	}
	return executable, m.dependenciesError
}

type LaunchReadiness struct {
	State  string `json:"state"`
	Reason string `json:"reason,omitempty"`
	Action string `json:"action,omitempty"`
}

func (m *Manager) snapshotLocked() Status {
	status := m.status
	status.StorageBytes = status.Package.InstalledBytes
	if runtime.GOOS == "linux" {
		status.StorageBytes += status.Package.SizeBytes
		if requiresSystemBrowser(status.Package) {
			status.StorageBytes += status.Package.InstalledBytes
		}
	}
	switch {
	case !status.Enabled:
		status.Launch = LaunchReadiness{State: "disabled", Reason: "browser_disabled", Action: "enable"}
	case !m.installed():
		status.Launch = LaunchReadiness{State: "installation_required", Reason: "browser_install_required", Action: "install"}
	default:
		_, err := m.launchExecutableLocked(false)
		if errors.Is(err, ErrSystemPreparationRequired) {
			status.Launch = LaunchReadiness{State: "system_preparation_required", Reason: "browser_sandbox_unavailable", Action: "prepare_system"}
		} else if errors.Is(err, ErrDependenciesMissing) {
			status.Launch = LaunchReadiness{State: "unavailable", Reason: "browser_dependencies_missing", Action: "repair_system"}
		} else if err != nil {
			status.Launch = LaunchReadiness{State: "unavailable", Reason: "browser_launch_unavailable", Action: "inspect"}
		} else {
			status.Launch = LaunchReadiness{State: "ready"}
		}
	}
	return status
}

// Preserve an observed sandbox failure even if the trusted policy file remains
// on disk but its kernel policy has been unloaded. Only successful preparation
// clears this condition; the UI cannot infer or override launch readiness.
func (m *Manager) RequireSystemPreparation() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.status.Package.Platform == "linux" {
		m.sandboxUnavailable = true
	}
}
