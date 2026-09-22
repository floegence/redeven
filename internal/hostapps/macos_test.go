package hostapps

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/portforward"
	"github.com/floegence/redeven/internal/portforward/registry"
	"github.com/gorilla/websocket"
)

func macFixture(t *testing.T) *Manager {
	t.Helper()
	return macFixtureScript(t, `#!/bin/sh
while IFS= read -r request; do
 case "$request" in
 *'"action":"catalog"'*) printf '%s\n' '{"type":"catalog","availability":{"backend":"macos","supported":true,"ready":true,"native_ready":true},"applications":[{"id":"macos-fixture","name":"Host Name","categories":[],"icon":""}]}' ;;
 *'"action":"native"'*) printf '%s\n' '{"type":"opened"}' ;;
 *'"action":"launch"'*|*'"action":"resume"'*) printf '%s\n' '{"type":"window","window":"window-one","generation":1,"width":640,"height":480}' '{"type":"frame","generation":1,"data":"ZnJhbWU="}' ;;
 *'"action":"stop"'*) printf '%s\n' '{"type":"ended"}'; exit 0 ;;
 esac
done
`)
}
func macFixtureScript(t *testing.T, script string) *Manager {
	t.Helper()
	// Fixtures model the multiplexed native protocol while keeping each test's
	// application behavior explicit. Ending one channel never exits the host.
	script = strings.ReplaceAll(script, "printf ", "emit ")
	script = strings.ReplaceAll(script, "; exit 0", "")
	script = strings.ReplaceAll(script, "while IFS= read -r request; do\n", `while IFS= read -r request; do
 session_id=$(command printf '%s' "$request" | sed -n 's/.*"session_id":"\([a-f0-9]*\)".*/\1/p')
`)
	script = strings.Replace(script, "#!/bin/sh\n", `#!/bin/sh
emit() { command printf "$@" | sed 's/^{/{"session_id":"'"$session_id"'",/'; }
`, 1)
	root := t.TempDir()
	helper := filepath.Join(root, "helper")
	if err := os.WriteFile(helper, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("REDEVEN_COMPUTER_NATIVE_HELPER_PATH", helper)
	reg, err := registry.Open(filepath.Join(root, "forwards.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	forwards, err := portforward.New(reg)
	if err != nil {
		t.Fatal(err)
	}
	m := New(root, root, forwards)
	t.Cleanup(func() { _ = m.Close(); _ = forwards.Close() })
	return m
}
func waitMac(t *testing.T, m *Manager, id, state string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		for _, s := range m.Sessions("alice") {
			if s.ID == id && s.State == state {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("session did not become %s: %+v", state, m.Sessions("alice"))
}

func TestMacSessionsShareNativeProcessAcrossSuspendAndStop(t *testing.T) {
	starts := filepath.Join(t.TempDir(), "starts")
	m := macFixtureScript(t, `#!/bin/sh
echo $$ >> '`+starts+`'
while IFS= read -r request; do
 case "$request" in
 *'"action":"catalog"'*) printf '%s\n' '{"type":"catalog","availability":{"ready":true},"applications":[{"id":"macos-fixture","name":"Fixture"}]}' ;;
 *'"action":"launch"'*|*'"action":"resume"'*) printf '%s\n' '{"type":"window","window":"one","generation":1}' '{"type":"frame","generation":1,"data":"ZnJhbWU="}' ;;
 *'"action":"suspend"'*) printf '%s\n' '{"type":"suspended"}' ;;
 *'"action":"detach"'*) printf '%s\n' '{"type":"ended","end_reason":"sharing_stopped"}' ;;
 esac
done
`)
	first, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	waitMac(t, m, first.ID, "running")
	if err := m.sessions[first.ID].native.send(map[string]any{"action": "suspend"}); err != nil {
		t.Fatal(err)
	}
	second, err := m.macLaunch(context.Background(), "bob", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Stop(context.Background(), "alice", first.ID); err != nil {
		t.Fatal(err)
	}
	<-m.sessions[second.ID].native.ready
	if err := m.sessions[second.ID].native.send(map[string]any{"action": "resume"}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.macCatalog(context.Background(), "bob"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(starts)
	if err != nil {
		t.Fatal(err)
	}
	if lines := strings.Fields(string(data)); len(lines) != 1 {
		t.Fatalf("suspended/active sessions and catalog must share one native capture owner; helper starts: %v", lines)
	}
}
func TestMacNativeLaunchDoesNotCreateViewerOrOwnedSession(t *testing.T) {
	m := macFixture(t)
	session, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture", Mode: "native"})
	if err != nil {
		t.Fatal(err)
	}
	if session.Mode != "native" || session.Forward != nil || session.State != "opened" || len(m.Sessions("alice")) != 0 {
		t.Fatalf("native launch created a streaming session: %+v", session)
	}
	if _, err = m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-other", Mode: "native"}); err != ErrNotFound {
		t.Fatal("unlisted application was accepted")
	}
}
func TestMacStreamAuthenticatesAndResumesWithoutRelaunch(t *testing.T) {
	m := macFixture(t)
	view, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	waitMac(t, m, view.ID, "running")
	m.mu.Lock()
	s := m.sessions[view.ID]
	m.mu.Unlock()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { m.serveMacSession(w, r, s) }))
	defer server.Close()
	endpoint := "ws" + strings.TrimPrefix(server.URL, "http") + "/_redeven_host_app/stream"
	bad := websocket.Dialer{Subprotocols: []string{"redeven-host-application-v1", "wrong"}}
	if c, res, err := bad.Dial(endpoint, nil); err == nil {
		_ = c.Close()
		t.Fatal("unauthenticated listener accepted a viewer")
	} else if res.StatusCode != 403 {
		t.Fatal(res.StatusCode)
	}
	dialer := websocket.Dialer{Subprotocols: []string{"redeven-host-application-v1", m.Password(view.ID)}}
	var previous *websocket.Conn
	for range 8 {
		c, _, err := dialer.Dial(endpoint, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := c.WriteJSON(map[string]any{"action": "resume", "mode": "auto", "width": 800, "height": 550, "video": true}); err != nil {
			t.Fatal(err)
		}
		if previous != nil {
			_ = previous.SetReadDeadline(time.Now().Add(time.Second))
			if _, _, err := previous.ReadMessage(); err == nil {
				t.Fatal("replaced viewer retained its input connection")
			}
			_ = previous.Close()
		}
		_ = c.SetReadDeadline(time.Now().Add(time.Second))
		kind, data, err := c.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		var window map[string]any
		if kind != websocket.TextMessage || json.Unmarshal(data, &window) != nil || window["type"] != "window" {
			t.Fatalf("missing bound window: %s", data)
		}
		kind, data, err = c.ReadMessage()
		if err != nil || kind != websocket.BinaryMessage || string(macFramePayload(t, data)) != "frame" {
			t.Fatalf("frame not delivered: %s %v", data, err)
		}
		previous = c
	}
	// A viewer cannot reuse the helper transport to launch arbitrary applications.
	if err := previous.WriteJSON(map[string]any{"action": "launch", "application_id": "foreign"}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := previous.ReadMessage(); err == nil {
		t.Fatal("viewer was allowed to issue an unscoped helper command")
	}
	_ = previous.Close()
	resumed, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil || resumed.ID != view.ID {
		t.Fatal("resume relaunched application")
	}
	if err = m.Stop(context.Background(), "bob", view.ID); err != ErrNotFound {
		t.Fatal("foreign user stopped application")
	}
	if err = m.Stop(context.Background(), "alice", view.ID); err != nil {
		t.Fatal(err)
	}
	waitMac(t, m, view.ID, "ended")
	if m.Password(view.ID) != "" {
		t.Fatal("ended application retained credentials")
	}
	retained, owner, found := m.ForForward(view.Forward.Forward.ForwardID)
	if !found || retained.State != "ended" || retained.ID != view.ID || owner != "alice" {
		t.Fatal("ended session lost its authoritative forward identity")
	}
	if _, _, found := m.ForTarget(view.Forward.Forward.TargetURL); found {
		t.Fatal("ended session claimed a reusable loopback address")
	}
	if forward, err := m.forwards.GetForward(context.Background(), view.Forward.Forward.ForwardID); err != nil || forward != nil {
		t.Fatal("terminal presentation retained the network forward")
	}
}
func TestMacClosedManagerCannotStartAnApplication(t *testing.T) {
	m := macFixture(t)
	_ = m.Close()
	if _, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"}); err != ErrUnavailable {
		t.Fatal("closed manager accepted launch")
	}
}

func TestMacRecoverableOperationsAndWindowReplacementPreserveSession(t *testing.T) {
	m := macFixtureScript(t, `#!/bin/sh
while IFS= read -r request; do
 case "$request" in
 *'"action":"catalog"'*) printf '%s\n' '{"type":"catalog","availability":{"backend":"macos","supported":true,"ready":true},"applications":[{"id":"macos-fixture","name":"Host App"}]}' ;;
 *'"action":"launch"'*) printf '%s\n' '{"type":"launched","existing_application":true}' '{"type":"operation_error","code":"WINDOW_NOT_FOCUSED"}' '{"type":"window","window":"one","generation":1}' '{"type":"frame","generation":1,"data":"ZnJhbWU="}' ;;
 *'"action":"resume"'*) printf '%s\n' '{"type":"window","window":"one","generation":1}' '{"type":"frame","generation":1,"data":"ZnJhbWU="}' ;;
 *'"action":"input"'*) printf '%s\n' '{"type":"operation_error","action":"input","code":"WINDOW_NOT_FOCUSED"}' ;;
 *'"action":"menu"'*) printf '%s\n' '{"type":"menu","items":[]}' ;;
 *'"action":"quit_application"'*) printf '%s\n' '{"type":"operation_complete","action":"quit_application"}' ;;
 *'"action":"select"'*) printf '%s\n' '{"type":"waiting","generation":2}' '{"type":"frame","generation":1,"data":"c3RhbGU="}' ;;
 *'"action":"resize"'*) printf '%s\n' '{"type":"window","window":"replacement","generation":3}' '{"type":"frame","generation":3,"data":"bmV3"}' ;;
 esac
done
`)
	view, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	waitMac(t, m, view.ID, "running")
	if sessions := m.Sessions("alice"); len(sessions) != 1 || !sessions[0].ExistingApplication {
		t.Fatalf("existing application ownership was lost: %+v", sessions)
	}
	m.mu.Lock()
	s := m.sessions[view.ID]
	m.mu.Unlock()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { m.serveMacSession(w, r, s) }))
	defer server.Close()
	dialer := websocket.Dialer{Subprotocols: []string{"redeven-host-application-v1", m.Password(view.ID)}}
	c, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/_redeven_host_app/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if err := c.WriteJSON(map[string]any{"action": "resume", "mode": "auto", "width": 800, "height": 550, "video": true}); err != nil {
		t.Fatal(err)
	}
	read := func(kind int, expected string) {
		t.Helper()
		_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
		actual, data, err := c.ReadMessage()
		if err == nil && kind == websocket.BinaryMessage {
			data = macFramePayload(t, data)
		}
		if err != nil || actual != kind || !strings.Contains(string(data), expected) {
			t.Fatalf("expected %q, got %s (%v)", expected, data, err)
		}
	}
	send := func(action string) {
		t.Helper()
		if err := c.WriteJSON(map[string]any{"action": action}); err != nil {
			t.Fatal(err)
		}
	}
	read(websocket.TextMessage, `"window":"one"`)
	read(websocket.BinaryMessage, "frame")
	// Identical failures from separate user actions must each reach the viewer.
	for range 2 {
		send("input")
		read(websocket.TextMessage, "operation_error")
	}
	send("quit_application")
	read(websocket.TextMessage, `"action":"quit_application"`)
	send("menu")
	read(websocket.TextMessage, `"type":"menu"`)
	send("select")
	read(websocket.TextMessage, `"type":"waiting"`)
	send("resize")
	read(websocket.TextMessage, `"window":"replacement"`)
	read(websocket.BinaryMessage, "new")
	waitMac(t, m, view.ID, "running")
}

func macFramePayload(t *testing.T, data []byte) []byte {
	t.Helper()
	if len(data) < 4 {
		t.Fatal("missing frame metadata")
	}
	length := int(binary.BigEndian.Uint32(data[:4]))
	if length > len(data)-4 {
		t.Fatal("truncated frame metadata")
	}
	var metadata map[string]any
	if err := json.Unmarshal(data[4:4+length], &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata["type"] != "frame" || metadata["generation"] == nil {
		t.Fatalf("missing frame identity: %s", data[:4+length])
	}
	return data[4+length:]
}

func TestMacPictureSettingsAndFrameCreditUseAuthenticatedConnection(t *testing.T) {
	m := macFixtureScript(t, `#!/bin/sh
while IFS= read -r request; do
 case "$request" in
 *'"action":"catalog"'*) printf '%s\n' '{"type":"catalog","availability":{"backend":"macos","supported":true,"ready":true},"applications":[{"id":"macos-fixture","name":"Host App"}]}' ;;
 *'"action":"launch"'*|*'"action":"resume"'*) printf '%s\n' '{"type":"window","window":"one","generation":1}' '{"type":"frame","generation":1,"codec":"jpeg","frame_id":1,"data":"ZnJhbWU="}' ;;
 *'"action":"configure"'*) printf '{"type":"operation_complete","request":%s}\n' "$request" ;;
 *'"action":"frame_ack"'*) printf '{"type":"operation_complete","request":%s}\n' "$request" ;;
 esac
done
`)
	view, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	waitMac(t, m, view.ID, "running")
	m.mu.Lock()
	s := m.sessions[view.ID]
	m.mu.Unlock()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { m.serveMacSession(w, r, s) }))
	defer server.Close()
	dialer := websocket.Dialer{Subprotocols: []string{"redeven-host-application-v1", m.Password(view.ID)}}
	c, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/_redeven_host_app/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if err := c.WriteJSON(map[string]any{"action": "resume", "mode": "auto", "width": 800, "height": 550, "video": true}); err != nil {
		t.Fatal(err)
	}
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	for range 2 {
		if _, _, err := c.ReadMessage(); err != nil {
			t.Fatal(err)
		}
	}
	for _, request := range []map[string]any{
		{"action": "configure", "mode": "smooth", "pixel_ratio": 2, "max_dimension": 2560, "frame_rate": 60, "video": true},
		{"action": "frame_ack", "generation": 1, "frame_id": 7},
	} {
		if err := c.WriteJSON(request); err != nil {
			t.Fatal(err)
		}
		var received struct {
			Request map[string]any `json:"request"`
		}
		if err := c.ReadJSON(&received); err != nil {
			t.Fatal(err)
		}
		request["protocol_version"] = 2
		if received.Request["session_id"] == "" {
			t.Fatal("native request lost its application channel")
		}
		delete(received.Request, "session_id")
		want, _ := json.Marshal(request)
		got, _ := json.Marshal(received.Request)
		if string(got) != string(want) {
			t.Fatalf("helper request changed: got %s, want %s", got, want)
		}
	}
}

func TestMacLiveApplicationCanWaitForItsFirstWindowBeyondStartupDeadline(t *testing.T) {
	m := macFixtureScript(t, `#!/bin/sh
while IFS= read -r request; do
 case "$request" in
 *'"action":"catalog"'*) printf '%s\n' '{"type":"catalog","availability":{"ready":true},"applications":[{"id":"macos-fixture","name":"Delayed App"}]}' ;;
 *'"action":"launch"'*) printf '%s\n' '{"type":"launched","existing_application":true}' '{"type":"waiting","generation":1}' ;;
 *'"action":"resume"'*) printf '%s\n' '{"type":"window","window":"one","generation":2}' '{"type":"frame","generation":2,"data":"ZnJhbWU="}' ;;
 esac
done
`)
	view, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	s := m.sessions[view.ID]
	m.mu.Unlock()
	select {
	case <-s.done:
		t.Fatal("a live application was ended by the first-frame deadline")
	case <-time.After(41 * time.Second):
	}
	if err := s.native.send(map[string]any{"action": "resume"}); err != nil {
		t.Fatal(err)
	}
	waitMac(t, m, view.ID, "running")
	resumed, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil || resumed.ID != view.ID {
		t.Fatal("waiting recovery relaunched the app")
	}
}

func TestMacUnexpectedHelperExitDoesNotConfirmApplicationClosure(t *testing.T) {
	m := macFixture(t)
	view, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	waitMac(t, m, view.ID, "running")
	m.mu.Lock()
	s := m.sessions[view.ID]
	m.mu.Unlock()
	s.native.writeMu.Lock()
	_ = s.native.input.Close()
	s.native.writeMu.Unlock()
	waitMac(t, m, view.ID, "failed")
}

func TestMacStopSharingBeforeFirstFrameEndsNormally(t *testing.T) {
	m := macFixtureScript(t, `#!/bin/sh
while IFS= read -r request; do
 case "$request" in
 *'"action":"catalog"'*) printf '%s\n' '{"type":"catalog","availability":{"ready":true},"applications":[{"id":"macos-fixture","name":"Background App"}]}' ;;
 *'"action":"launch"'*) printf '%s\n' '{"type":"launched","existing_application":true}' '{"type":"waiting","generation":1}' ;;
 *'"action":"stop"'*) printf '%s\n' '{"type":"ended"}'; exit 0 ;;
 esac
done
`)
	view, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for !m.Sessions("alice")[0].ExistingApplication {
		if time.Now().After(deadline) {
			t.Fatal("fixture did not attach to its background app")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err = m.Stop(context.Background(), "alice", view.ID); err != nil {
		t.Fatal(err)
	}
	waitMac(t, m, view.ID, "ended")
	if got := m.Sessions("alice")[0]; got.ErrorCode != "" {
		t.Fatalf("explicit stop became a launch failure: %+v", got)
	}
}

func TestMacNativeLaunchErrorRemainsFailed(t *testing.T) {
	m := macFixtureScript(t, `#!/bin/sh
while IFS= read -r request; do
 case "$request" in
 *'"action":"catalog"'*) printf '%s\n' '{"type":"catalog","availability":{"ready":true},"applications":[{"id":"macos-fixture","name":"Exiting App"}]}' ;;
 *'"action":"launch"'*) printf '%s\n' '{"type":"error","code":"LAUNCH_FAILED"}' '{"type":"ended"}'; exit 0 ;;
 esac
done
`)
	view, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	waitMac(t, m, view.ID, "failed")
	if m.Sessions("alice")[0].ErrorCode != "launch_failed" {
		t.Fatal("native launch diagnostic was lost")
	}
}

// A resumed helper may publish a window and its menu before the socket writer
// wakes. The new generation must reach the viewer before its dependent menu.
type macPlaybackInput struct{ write func([]byte) }

func (p macPlaybackInput) Write(data []byte) (int, error) { p.write(data); return len(data), nil }
func (p macPlaybackInput) Close() error                   { return nil }

func TestMacSnapshotDeliversWindowBeforeGenerationBoundMenu(t *testing.T) {
	m := &Manager{}
	n := &macSession{}
	s := &ownedSession{password: "test-credential", native: n, done: make(chan struct{})}
	n.input = macPlaybackInput{write: func(data []byte) {
		if !strings.Contains(string(data), `"action":"resume"`) {
			return
		}
		n.mu.Lock()
		n.window = []byte(`{"type":"window","window":"second","generation":2}`)
		n.notices = [][]byte{[]byte(`{"type":"menu","generation":2,"items":[]}`)}
		n.changed <- struct{}{}
		n.mu.Unlock()
	}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { m.serveMacSession(w, r, s) }))
	defer server.Close()
	dialer := websocket.Dialer{Subprotocols: []string{"redeven-host-application-v1", "test-credential"}}
	c, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/_redeven_host_app/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if err := c.WriteJSON(map[string]any{"action": "resume", "mode": "auto", "width": 800, "height": 550, "video": true}); err != nil {
		t.Fatal(err)
	}
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	for _, want := range []string{"window", "menu"} {
		var message macMessage
		if err := c.ReadJSON(&message); err != nil {
			t.Fatal(err)
		}
		if message.Type != want {
			t.Fatalf("expected %s before dependent events, got %s", want, message.Type)
		}
	}
}

func TestMacQuitUsesExactInstancesAndDoesNotEndSharingOptimistically(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("native process control is macOS-only")
	}
	m := macFixtureScript(t, `#!/bin/sh
while IFS= read -r request; do
 case "$request" in
 *'"action":"catalog"'*) printf '%s\n' '{"type":"catalog","availability":{"ready":true},"applications":[{"id":"macos-fixture","name":"Host App"}]}' ;;
 *'"action":"launch"'*) printf '%s\n' '{"type":"launched","existing_application":true}' '{"type":"window","generation":1}' '{"type":"frame","generation":1,"data":"ZnJhbWU="}' ;;
 *'"action":"quit"'*) case "$request" in
  *'"application_id":"macos-fixture"'*'"instances":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]'*) printf '%s\n' '{"type":"quit_requested"}' ;;
  *) printf '%s\n' '{"type":"error","code":"APPLICATION_NOT_FOUND"}' ;;
  esac ;;
 *'"action":"detach"'*) printf '%s\n' '{"type":"ended"}'; exit 0 ;;
 esac
done
`)
	view, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	waitMac(t, m, view.ID, "running")
	req := QuitRequest{ApplicationID: "macos-fixture", Instances: []string{strings.Repeat("a", 64)}}
	if err = m.Quit(context.Background(), "", req); err != ErrUnavailable {
		t.Fatal("anonymous quit was admitted")
	}
	for _, ids := range [][]string{nil, {"pid:123"}, {strings.Repeat("a", 64), strings.Repeat("a", 64)}} {
		if err = m.Quit(context.Background(), "alice", QuitRequest{ApplicationID: req.ApplicationID, Instances: ids}); err != ErrInvalid {
			t.Fatalf("invalid selection accepted: %v", err)
		}
	}
	stale := req
	stale.Instances = []string{strings.Repeat("b", 64)}
	if err = m.Quit(context.Background(), "alice", stale); err != ErrNotFound {
		t.Fatalf("stale selection: %v", err)
	}
	if err = m.Quit(context.Background(), "alice", req); err != nil {
		t.Fatal(err)
	}
	if m.Sessions("alice")[0].State != "running" {
		t.Fatal("quit request falsely confirmed termination")
	}
	if err = m.Detach(context.Background(), "bob", view.ID); err != ErrNotFound {
		t.Fatal("foreign owner detached session")
	}
	if err = m.Detach(context.Background(), "alice", view.ID); err != nil {
		t.Fatal(err)
	}
	waitMac(t, m, view.ID, "ended")
}

func TestMacExplicitQuitBeforeFirstWindowEndsSharingNormally(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("native process control is macOS-only")
	}
	marker := filepath.Join(t.TempDir(), "quit")
	m := macFixtureScript(t, `#!/bin/sh
while IFS= read -r request; do
 case "$request" in
 *'"action":"catalog"'*) printf '%s\n' '{"type":"catalog","availability":{"ready":true},"applications":[{"id":"macos-fixture","name":"Background App"}]}' ;;
 *'"action":"launch"'*) printf '%s\n' '{"type":"launched","instance":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}' '{"type":"waiting","generation":1}'
 (while [ ! -f '`+marker+`' ]; do sleep 0.02; done
 printf '%s\n' '{"type":"ended","end_reason":"application_exited"}') & ;;
 *'"action":"quit"'*) touch '`+marker+`'; printf '%s\n' '{"type":"quit_requested"}' ;;
 esac
done
`)
	view, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		m.mu.Lock()
		native := m.sessions[view.ID].native
		m.mu.Unlock()
		native.mu.Lock()
		attached := native.window != nil
		native.mu.Unlock()
		if attached {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("fixture did not attach")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err = m.Quit(context.Background(), "alice", QuitRequest{ApplicationID: "macos-fixture", Instances: []string{strings.Repeat("a", 64)}}); err != nil {
		t.Fatal(err)
	}
	waitMac(t, m, view.ID, "ended")
	if m.Sessions("alice")[0].ErrorCode != "" {
		t.Fatal("explicit quit was classified as a failed launch")
	}
}

func TestMacTerminalReasonSurvivesForwardRelease(t *testing.T) {
	for _, reason := range []string{"application_exited", "windows_closed", "sharing_stopped"} {
		for _, painted := range []bool{false, true} {
			t.Run(reason+fmt.Sprint(painted), func(t *testing.T) {
				events := `'{"type":"waiting","generation":1}'`
				if painted {
					events = `'{"type":"window","window":"one","generation":1}' '{"type":"frame","generation":1,"data":"ZnJhbWU="}'`
				}
				m := macFixtureScript(t, `#!/bin/sh
while IFS= read -r request; do
 case "$request" in
 *'"action":"catalog"'*) printf '%s\n' '{"type":"catalog","availability":{"ready":true},"applications":[{"id":"macos-fixture","name":"Fixture"}]}' ;;
 *'"action":"launch"'*) printf '%s\n' '{"type":"launched"}' `+events+` ;;
 *'"action":"detach"'*) printf '%s\n' '{"type":"ended","end_reason":"`+reason+`"}'; exit 0 ;;
 esac
done
`)
				view, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
				if err != nil {
					t.Fatal(err)
				}
				if painted {
					waitMac(t, m, view.ID, "running")
				}
				// Ask the fixture to emit authoritative native lifecycle evidence.
				// Product detachment itself always means sharing_stopped.
				m.mu.Lock()
				native := m.sessions[view.ID].native
				m.mu.Unlock()
				<-native.ready
				if err = native.send(map[string]any{"action": "detach"}); err != nil {
					t.Fatal(err)
				}
				waitMac(t, m, view.ID, "ended")
				terminal, owner, found := m.ForForward(view.Forward.Forward.ForwardID)
				if !found || owner != "alice" || terminal.EndReason != reason || terminal.ErrorCode != "" || m.Password(view.ID) != "" {
					t.Fatalf("lost terminal evidence: %+v", terminal)
				}
				if forward, _ := m.forwards.GetForward(context.Background(), view.Forward.Forward.ForwardID); forward != nil {
					t.Fatal("terminal session retained its network route")
				}
			})
		}
	}
}

func TestMacViewerNegotiatesOnceBeforeControlAndWaitsForHelper(t *testing.T) {
	m := &Manager{}
	requests := make(chan map[string]any, 16)
	n := &macSession{ready: make(chan struct{})}
	s := &ownedSession{password: "credential", native: n, done: make(chan struct{})}
	n.input = macPlaybackInput{write: func(data []byte) {
		var request map[string]any
		if err := json.Unmarshal(data, &request); err != nil {
			t.Error(err)
			return
		}
		if request["action"] != "release" && request["action"] != "suspend" {
			requests <- request
		}
	}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { m.serveMacSession(w, r, s) }))
	defer server.Close()
	dialer := websocket.Dialer{Subprotocols: []string{"redeven-host-application-v1", "credential"}}
	connect := func() *websocket.Conn {
		c, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/_redeven_host_app/stream", nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = c.Close() })
		return c
	}
	c := connect()
	if err := c.WriteJSON(map[string]any{"action": "input", "kind": "key", "key": "Enter"}); err != nil {
		t.Fatal(err)
	}
	_ = c.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := c.ReadMessage(); err == nil {
		t.Fatal("control before negotiation was accepted")
	}
	select {
	case request := <-requests:
		t.Fatalf("capture started before viewer configuration: %v", request)
	default:
	}
	c = connect()
	if err := c.WriteJSON(map[string]any{"action": "resume", "mode": "clarity", "pixel_ratio": 2, "width": 900, "height": 600, "video": true}); err != nil {
		t.Fatal(err)
	}
	select {
	case request := <-requests:
		t.Fatalf("command raced helper launch: %v", request)
	case <-time.After(20 * time.Millisecond):
	}
	close(n.ready)
	select {
	case request := <-requests:
		if request["action"] != "resume" || request["mode"] != "clarity" || request["width"] != float64(900) || request["height"] != float64(600) || request["video"] != true {
			t.Fatalf("initial capture lost viewer settings: %v", request)
		}
	case <-time.After(time.Second):
		t.Fatal("viewer configuration did not reach ready helper")
	}
	if err := c.WriteJSON(map[string]any{"action": "resume"}); err != nil {
		t.Fatal(err)
	}
	_ = c.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := c.ReadMessage(); err == nil {
		t.Fatal("duplicate negotiation retained control")
	}
}
