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

func TestLinuxRuntimeRejectsPrivilegedServiceMutation(t *testing.T) {
	m := New(t.TempDir(), nil, nil)
	defer m.Close()
	m.factory = func(context.Context) (Transport, error) {
		t.Fatal("Runtime launched a helper to request authority")
		return nil, ErrUnavailable
	}
	m.allowed = func(owner string) bool { return owner == "alice" }
	for _, operation := range []func(context.Context, string) (nativeapps.ServiceStatus, error){m.InstallLoginService, m.UninstallLoginService} {
		status, err := operation(context.Background(), "alice")
		if status.State != nativeapps.ServiceAuthorization || !errors.Is(err, ErrServiceAuthorization) {
			t.Fatalf("unexpected authorization: %+v %v", status, err)
		}
		if _, err := operation(context.Background(), "bob"); !errors.Is(err, ErrForbidden) {
			t.Fatal("service mutation escaped owner permission")
		}
	}
}
