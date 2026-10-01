package remotedesktop

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
)

type fakeTransport struct {
	mu       sync.Mutex
	commands []nativeapps.HostDesktopCommand
	done     chan struct{}
	once     sync.Once
}

func (f *fakeTransport) Send(c nativeapps.HostDesktopCommand, _ bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.commands = append(f.commands, c)
	return nil
}
func (f *fakeTransport) Control() <-chan nativeapps.HostDesktopMessage { return nil }
func (f *fakeTransport) Media() <-chan nativeapps.HostDesktopMessage   { return nil }
func (f *fakeTransport) Done() <-chan struct{}                         { return f.done }
func (f *fakeTransport) Close() error                                  { f.once.Do(func() { close(f.done) }); return nil }
func testSession(m *Manager, id, mode string) (*ownedSession, *fakeTransport) {
	native := &fakeTransport{done: make(chan struct{})}
	s := &ownedSession{owner: "alice", view: Session{ID: id, Mode: mode}, pair: &attachment{done: make(chan struct{}), native: native, generation: 3, state: "active", sent: map[uint64]bool{8: true}, stateChanged: make(chan struct{})}}
	m.sessions[id] = s
	if mode == "control" {
		m.controller = id
	}
	return s, native
}
func TestInputRequiresOwnerCurrentPaintAndControl(t *testing.T) {
	m := &Manager{sessions: map[string]*ownedSession{}}
	s, native := testSession(m, "first", "control")
	if _, err := m.Get("mallory", s.view.ID); !errors.Is(err, ErrForbidden) {
		t.Fatal("another owner read desktop", err)
	}
	command := nativeapps.HostDesktopCommand{Version: 1, ID: 1, Method: "input", Generation: 3, Input: &nativeapps.HostDesktopInput{Kind: "key", Key: "x", Code: "KeyX", Pressed: true}}
	if err := m.send(s, s.pair, command, false); !errors.Is(err, ErrForbidden) {
		t.Fatal("unpainted desktop accepted input", err)
	}
	ack := nativeapps.HostDesktopCommand{Version: 1, ID: 2, Method: "frame_ack", Generation: 3, FrameID: 9}
	if err := m.send(s, s.pair, ack, false); !errors.Is(err, ErrInvalid) {
		t.Fatal("unoffered frame authorized input", err)
	}
	ack.FrameID = 8
	if err := m.send(s, s.pair, ack, false); err != nil {
		t.Fatal(err)
	}
	if err := m.send(s, s.pair, command, false); err != nil {
		t.Fatal(err)
	}
	command.Generation = 2
	if err := m.send(s, s.pair, command, false); !errors.Is(err, ErrForbidden) {
		t.Fatal("stale generation accepted", err)
	}
	command.Generation = 3
	s.view.Mode = "view"
	for _, method := range []string{"input", "get_clipboard", "set_clipboard", "lock"} {
		command.Method = method
		if err := m.send(s, s.pair, command, false); !errors.Is(err, ErrForbidden) {
			t.Fatalf("view-only accepted %s: %v", method, err)
		}
	}
	if len(native.commands) != 2 {
		t.Fatalf("unauthorized commands reached native: %d", len(native.commands))
	}
}

func TestDesktopConnectMayDowngradeAfterNativeControlConflict(t *testing.T) {
	m := &Manager{sessions: map[string]*ownedSession{}}
	s, native := testSession(m, "desktop", "control")
	command := nativeapps.HostDesktopCommand{Version: 1, ID: 1, Method: "connect", Mode: "view"}
	if err := m.send(s, s.pair, command, false); err != nil {
		t.Fatal(err)
	}
	if s.view.Mode != "view" || m.controller != "" || native.commands[0].Mode != "view" {
		t.Fatal("declining native takeover did not release the product control lease")
	}
	command.Mode = "control"
	if err := m.send(s, s.pair, command, false); err != nil {
		t.Fatal(err)
	}
	if s.view.Mode != "view" || m.controller != "" || native.commands[1].Mode != "view" {
		t.Fatal("connect bypassed explicit control admission")
	}
}
func TestTakeoverRetiresHeldInputBeforeSuccessorAndDoesNotReplay(t *testing.T) {
	m := &Manager{sessions: map[string]*ownedSession{}}
	old, native := testSession(m, "old", "control")
	next, _ := testSession(m, "next", "view")
	mode := nativeapps.HostDesktopCommand{Version: 1, ID: 1, Method: "set_mode", Mode: "control", Generation: 3}
	if err := m.send(next, next.pair, mode, false); !errors.Is(err, ErrControlInUse) {
		t.Fatal("implicit takeover", err)
	}
	if err := m.send(next, next.pair, mode, true); err != nil {
		t.Fatal(err)
	}
	select {
	case <-native.done:
	default:
		t.Fatal("old native attachment retained held input")
	}
	if old.view.Mode != "view" || m.controller != "next" || next.pair.painted {
		t.Fatal("takeover did not revoke old authority and paint")
	}
	if err := m.send(old, old.pair, nativeapps.HostDesktopCommand{Version: 1, ID: 2, Method: "probe"}, false); !errors.Is(err, ErrUnavailable) {
		t.Fatal("retired connection accepted command", err)
	}
	ticket, err := m.Ticket("alice", "old")
	if err != nil {
		t.Fatal(err)
	}
	if ticket.Session.Mode != "view" || old.pair.painted || old.pair.generation != 0 {
		t.Fatal("reconnect restored stale input")
	}
}
func TestDisconnectAndRestartDoNotPersistDesktopCredentials(t *testing.T) {
	m := &Manager{sessions: map[string]*ownedSession{}, stop: make(chan struct{})}
	s, native := testSession(m, "first", "control")
	if err := m.Disconnect("mallory", s.view.ID); !errors.Is(err, ErrForbidden) {
		t.Fatal(err)
	}
	if err := m.Disconnect("alice", s.view.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-native.done:
	default:
		t.Fatal("native not retired")
	}
	if len(m.sessions) != 0 || m.controller != "" {
		t.Fatal("session or lease leaked")
	}
	if err := m.Close(); err != nil {
		t.Fatal(err)
	}
	restarted := &Manager{sessions: map[string]*ownedSession{}}
	if _, err := restarted.Ticket("alice", s.view.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("credentials survived Runtime restart", err)
	}
}

func TestRemoteDesktopPermissionRevocationClosesOnlyAffectedOwners(t *testing.T) {
	m := &Manager{sessions: map[string]*ownedSession{}}
	alice, native := testSession(m, "alice-desktop", "control")
	bob, other := testSession(m, "bob-desktop", "view")
	bob.owner = "bob"
	var events []string
	m.SetAudit(func(owner, id, event, reason string) { events = append(events, owner+":"+event+":"+reason) })
	m.RevokeDisallowed(func(owner string) bool { return owner == "bob" })
	if _, err := m.Get("alice", alice.view.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("revoked session survived", err)
	}
	select {
	case <-native.Done():
	default:
		t.Fatal("revoked input/media remained attached")
	}
	select {
	case <-other.Done():
		t.Fatal("unrelated owner disconnected")
	default:
	}
	if len(events) != 2 || events[0] != "alice:revoke:permission_changed" || m.controller != "" {
		t.Fatal("revocation lost audit or controller release", events)
	}
	if _, err := m.Create(context.Background(), "alice", CreateRequest{Mode: "view"}, false); !errors.Is(err, ErrForbidden) {
		t.Fatal("a request authorized before revocation could create a successor", err)
	}
	other.Close()
}

type delayedCloseTransport struct{ fakeTransport }

func (f *delayedCloseTransport) Close() error { return nil }

func TestReplacementTicketWaitsForNativeInputAndGrantRelease(t *testing.T) {
	m := &Manager{sessions: map[string]*ownedSession{}}
	s, _ := testSession(m, "desktop", "control")
	native := &delayedCloseTransport{fakeTransport{done: make(chan struct{})}}
	s.pair.native = native
	retired := s.pair
	result := make(chan error, 1)
	go func() { _, err := m.Ticket("alice", s.view.ID); result <- err }()
	<-retired.done
	select {
	case err := <-result:
		t.Fatal("replacement became usable before the previous native attachment exited", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(native.done)
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("replacement did not continue after native teardown")
	}
}
func TestMediaMayPrecedeItsActiveControlState(t *testing.T) {
	a := &attachment{done: make(chan struct{}), stateChanged: make(chan struct{})}
	result := make(chan bool, 1)
	go func() { result <- a.awaitMediaState(1) }()
	select {
	case <-result:
		t.Fatal("first keyframe discarded before control pipe caught up")
	case <-time.After(10 * time.Millisecond):
	}
	a.mu.Lock()
	a.generation = 1
	a.state = "active"
	close(a.stateChanged)
	a.stateChanged = make(chan struct{})
	a.mu.Unlock()
	select {
	case valid := <-result:
		if !valid {
			t.Fatal("first keyframe rejected")
		}
	case <-time.After(time.Second):
		t.Fatal("keyframe blocked")
	}
	a.mu.Lock()
	a.generation = 2
	a.mu.Unlock()
	if a.awaitMediaState(1) {
		t.Fatal("old media accepted after display change")
	}
}

func TestDelayedPaintReceiptCannotAuthorizeOrDisconnectNewDisplay(t *testing.T) {
	m := &Manager{sessions: map[string]*ownedSession{}}
	s, native := testSession(m, "desktop", "control")
	old := nativeapps.HostDesktopCommand{Version: 1, ID: 1, Method: "frame_ack", Generation: 2, FrameID: 8}
	if err := m.send(s, s.pair, old, false); err != nil {
		t.Fatal("in-flight receipt disconnected a new display", err)
	}
	if s.pair.painted || len(native.commands) != 0 {
		t.Fatal("retired picture authorized the successor")
	}
}
