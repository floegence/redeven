package hostapps

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/portforward"
	"github.com/floegence/redeven/internal/portforward/registry"
	"github.com/gorilla/websocket"
)

func macFixture(t *testing.T) *Manager {
	t.Helper()
	root := t.TempDir()
	helper := filepath.Join(root, "helper")
	script := `#!/bin/sh
while IFS= read -r request; do
 case "$request" in
 *'"action":"catalog"'*) printf '%s\n' '{"type":"catalog","availability":{"backend":"macos","supported":true,"ready":true,"native_ready":true},"applications":[{"id":"macos-fixture","name":"Host Name","categories":[],"icon":""}]}' ;;
 *'"action":"native"'*) printf '%s\n' '{"type":"opened"}' ;;
 *'"action":"launch"'*|*'"action":"resume"'*) printf '%s\n' '{"type":"window","window":"window-one","generation":1,"width":640,"height":480}' '{"type":"frame","generation":1,"data":"ZnJhbWU="}' ;;
 *'"action":"stop"'*) printf '%s\n' '{"type":"ended"}'; exit 0 ;;
 esac
done
`
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
	for range 2 {
		c, _, err := dialer.Dial(endpoint, nil)
		if err != nil {
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
		if err != nil || kind != websocket.BinaryMessage || string(data) != "frame" {
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
}
func TestMacClosedManagerCannotStartAnApplication(t *testing.T) {
	m := macFixture(t)
	_ = m.Close()
	if _, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"}); err != ErrUnavailable {
		t.Fatal("closed manager accepted launch")
	}
}
