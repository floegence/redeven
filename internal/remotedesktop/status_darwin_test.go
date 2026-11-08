package remotedesktop

import (
	"context"
	"errors"
	"testing"

	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/floegence/floe-native-apps/hostdesktop"
)

// The macOS adapter is injectable without provisioning native components.
// These responses exercise the shared status path used by both platforms.
func TestStatusPreservesNativeReadinessAndAuthorization(t *testing.T) {
	for _, test := range []struct {
		name                         string
		message                      nativeapps.HostDesktopMessage
		state, authorization, reason string
	}{
		{"login required", nativeapps.HostDesktopMessage{Type: "error", Code: "DESKTOP_SESSION_UNAVAILABLE"}, "session_unavailable", "", "DESKTOP_SESSION_UNAVAILABLE"},
		{"uncertain credentials", nativeapps.HostDesktopMessage{Type: "error", Code: "RESTORE_TOKEN_INVALID", Authorization: "unknown"}, "unavailable", "unknown", "RESTORE_TOKEN_INVALID"},
		{"saved native grant", nativeapps.HostDesktopMessage{Type: "capabilities", Capabilities: &nativeapps.HostDesktopCapabilities{State: "ready", Authorization: "saved"}}, "ready", "saved", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			native := &socketTransport{fakeTransport: fakeTransport{done: make(chan struct{})}, control: make(chan nativeapps.HostDesktopMessage, 1)}
			native.control <- test.message
			m := New(t.TempDir(), nil, func(context.Context) (Transport, error) { return native, nil })
			defer m.Close()
			status, err := m.Status(context.Background(), "alice")
			if err != nil {
				t.Fatal(err)
			}
			if status.Capabilities.State != test.state || status.Capabilities.Authorization != test.authorization || status.Capabilities.Reason != test.reason {
				t.Fatalf("lost native status: %+v", status.Capabilities)
			}
			if len(native.commands) != 1 || native.commands[0].Method != "probe" {
				t.Fatal("readiness query requested sharing")
			}
			select {
			case <-native.Done():
			default:
				t.Fatal("readiness transport leaked")
			}
		})
	}
}

func TestStatusIdentifiesPermissionAppOnlyForMacOS(t *testing.T) {
	for _, name := range []string{"", "Redeven Desktop Dev"} {
		for _, backend := range []string{"macos", "x11"} {
			t.Setenv("REDEVEN_HOST_PERMISSION_APP_NAME", "Untrusted parent name")
			native := &socketTransport{fakeTransport: fakeTransport{done: make(chan struct{})}, control: make(chan nativeapps.HostDesktopMessage, 1)}
			native.control <- nativeapps.HostDesktopMessage{Type: "capabilities", Capabilities: &nativeapps.HostDesktopCapabilities{Backend: backend, State: "ready", PermissionApplication: &hostdesktop.HostDesktopPermissionApplication{Name: name, Identifier: "com.example.fixture"}}}
			m := New(t.TempDir(), nil, func(context.Context) (Transport, error) { return native, nil })
			status, err := m.Status(context.Background(), "alice")
			m.Close()
			want := ""
			if backend == "macos" {
				want = name
			}
			if err != nil || status.PermissionAppName != want {
				t.Fatalf("permission identity: %+v, %v", status, err)
			}
		}
	}
}

func TestLoginServiceStatusAndAuthorizationAreExplicit(t *testing.T) {
	first := &socketTransport{fakeTransport: fakeTransport{done: make(chan struct{})}, control: make(chan nativeapps.HostDesktopMessage, 1)}
	first.control <- nativeapps.HostDesktopMessage{Type: "service_status", Service: nativeapps.LoginScreenService,
		ServiceStatus: &nativeapps.ServiceStatus{State: nativeapps.ServiceNotInstalled, Backend: "darwin"}}
	second := &socketTransport{fakeTransport: fakeTransport{done: make(chan struct{})}, control: make(chan nativeapps.HostDesktopMessage, 1)}
	second.control <- nativeapps.HostDesktopMessage{Type: "service_status", Service: nativeapps.LoginScreenService,
		ServiceStatus: &nativeapps.ServiceStatus{State: nativeapps.ServiceAuthorization, Backend: "darwin"}, Code: "ADMIN_AUTHORIZATION_REQUIRED"}
	connections := []Transport{first, second}
	m := New(t.TempDir(), nil, func(context.Context) (Transport, error) {
		n := connections[0]
		connections = connections[1:]
		return n, nil
	})
	defer m.Close()
	status, err := m.SystemServiceStatus(context.Background(), "alice")
	if err != nil || status.State != nativeapps.ServiceNotInstalled {
		t.Fatalf("service status: %+v, %v", status, err)
	}
	status, err = m.SystemServiceStatus(context.Background(), "alice")
	if status.State != nativeapps.ServiceAuthorization || !errors.Is(err, nativeapps.ErrServiceAuthorization) {
		t.Fatalf("authorization result: %+v, %v", status, err)
	}
}
