package remotedesktop

import (
	"context"
	"testing"

	nativeapps "github.com/floegence/floe-native-apps"
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
