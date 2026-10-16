//go:build linux

package remotedesktop

import (
	"context"
	"errors"
	"testing"

	nativeapps "github.com/floegence/floe-native-apps"
)

func TestLinuxSystemServiceStatusSkipsUserDesktopPreparation(t *testing.T) {
	for _, state := range []string{nativeapps.ServiceActive, nativeapps.ServiceStopped, nativeapps.ServiceFailed} {
		t.Run(state, func(t *testing.T) {
			m := New(t.TempDir(), nil, nil)
			defer m.Close()
			m.serviceStatus = func(context.Context) (nativeapps.ServiceStatus, error) {
				return nativeapps.ServiceStatus{State: state, Backend: "linux-drm-kms"}, nil
			}
			native := &socketTransport{fakeTransport: fakeTransport{done: make(chan struct{})}, control: make(chan nativeapps.HostDesktopMessage, 1)}
			native.control <- nativeapps.HostDesktopMessage{Type: "capabilities", Capabilities: &nativeapps.HostDesktopCapabilities{State: "locked", Backend: "linux-drm-kms", Screen: true, Unlock: true}}
			opened := false
			m.factory = func(context.Context) (Transport, error) { opened = true; return native, nil }
			status, err := m.Status(context.Background(), "alice")
			if err != nil || status.Setup != nil || status.LoginService.State != state {
				t.Fatalf("unexpected service status: %+v %v", status, err)
			}
			if opened != (state == nativeapps.ServiceActive) {
				t.Fatal("stopped or failed system service selected a user desktop")
			}
			if state == nativeapps.ServiceActive && (!status.Capabilities.Unlock || status.Capabilities.State != "locked") {
				t.Fatal("system lock frame capability lost")
			}
		})
	}
}

func TestLinuxSSHPhysicalMissingServiceNeverSelectsPortal(t *testing.T) {
	m := New(t.TempDir(), nil, nil)
	defer m.Close()
	m.serviceStatus = func(context.Context) (nativeapps.ServiceStatus, error) {
		return nativeapps.ServiceStatus{State: nativeapps.ServiceNotInstalled, Backend: "linux-drm-kms"}, nativeapps.ErrServiceNotInstalled
	}
	m.factory = func(context.Context) (Transport, error) {
		t.Fatal("SSH physical target selected Portal")
		return nil, ErrUnavailable
	}
	status, err := m.StatusTarget(t.Context(), "alice", "ssh_physical")
	if err != nil || status.Setup != nil || status.LoginService.State != nativeapps.ServiceNotInstalled {
		t.Fatalf("physical target: %+v %v", status, err)
	}
	if _, err = m.openTarget(t.Context(), true); !errors.Is(err, nativeapps.ErrServiceNotInstalled) {
		t.Fatalf("physical open: %v", err)
	}
}

func TestLinuxServiceProtocolMismatchRequiresUpdateWithoutDesktopFallback(t *testing.T) {
	m := New(t.TempDir(), nil, nil)
	defer m.Close()
	m.serviceStatus = func(context.Context) (nativeapps.ServiceStatus, error) {
		return nativeapps.ServiceStatus{State: nativeapps.ServiceFailed, Backend: "linux-drm-kms", Reason: "SERVICE_UPDATE_REQUIRED"}, nativeapps.ErrServiceUpdateRequired
	}
	if _, err := m.openLinux(t.Context()); !errors.Is(err, nativeapps.ErrServiceUpdateRequired) {
		t.Fatalf("protocol mismatch lost update error: %v", err)
	}
	status, err := m.Status(t.Context(), "owner")
	if err != nil || status.Setup != nil || status.Capabilities.Reason != "SERVICE_UPDATE_REQUIRED" {
		t.Fatalf("protocol mismatch opened user components: %+v %v", status, err)
	}
}
