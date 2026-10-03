package remotedesktop

import (
	"context"
	"errors"
	"testing"

	nativeapps "github.com/floegence/floe-native-apps"
)

func TestForgetAuthorizationReleasesPrivateTransportWithoutTouchingSharing(t *testing.T) {
	for _, test := range []struct {
		name    string
		message nativeapps.HostDesktopMessage
		want    error
	}{
		{"success", nativeapps.HostDesktopMessage{Type: "result", ID: 1}, nil},
		{"busy", nativeapps.HostDesktopMessage{Type: "error", Code: "AUTHORIZATION_PENDING"}, ErrAuthorizationBusy},
		{"storage rejected", nativeapps.HostDesktopMessage{Type: "error", Code: "RESTORE_TOKEN_INVALID"}, ErrUnavailable},
		{"wrong receipt", nativeapps.HostDesktopMessage{Type: "result", ID: 2}, ErrUnavailable},
	} {
		t.Run(test.name, func(t *testing.T) {
			native := &socketTransport{fakeTransport: fakeTransport{done: make(chan struct{})}, control: make(chan nativeapps.HostDesktopMessage, 1)}
			native.control <- test.message
			m := &Manager{sessions: map[string]*ownedSession{}, factory: func(context.Context) (Transport, error) { return native, nil }}
			s, active := testSession(m, "sharing", "control")
			if err := m.ForgetAuthorization(context.Background()); !errors.Is(err, test.want) {
				t.Fatal(err)
			}
			if len(native.commands) != 1 || native.commands[0].Method != "forget_authorization" {
				t.Fatal("forget requested capture or input")
			}
			select {
			case <-native.Done():
			default:
				t.Fatal("private transport leaked")
			}
			select {
			case <-active.Done():
				t.Fatal("forget ended active sharing")
			default:
			}
			if m.sessions[s.view.ID] != s || m.controller != s.view.ID {
				t.Fatal("forget changed live ownership")
			}
		})
	}
}

func TestForgetAuthorizationCancellationClosesNativeRequest(t *testing.T) {
	native := &socketTransport{fakeTransport: fakeTransport{done: make(chan struct{})}, control: make(chan nativeapps.HostDesktopMessage)}
	m := &Manager{factory: func(context.Context) (Transport, error) { return native, nil }}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := m.ForgetAuthorization(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	select {
	case <-native.Done():
	default:
		t.Fatal("canceled request leaked")
	}
}

func TestViewerCannotForgetHostAuthorization(t *testing.T) {
	m := &Manager{sessions: map[string]*ownedSession{}}
	s, native := testSession(m, "desktop", "control")
	s.pair.painted = true
	if err := m.send(s, s.pair, nativeapps.HostDesktopCommand{Version: 1, ID: 1, Method: "forget_authorization", Generation: 3}, false); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	if len(native.commands) != 0 {
		t.Fatal("viewer changed host authorization preference")
	}
}
