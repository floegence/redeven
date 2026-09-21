package hostapps

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestMacDisconnectedViewerSuspendsCaptureAndKeepsApplicationSession(t *testing.T) {
	requests := filepath.Join(t.TempDir(), "requests")
	m := macFixtureScript(t, `#!/bin/sh
while IFS= read -r request; do
 printf '%s\n' "$request" >> '`+requests+`'
 case "$request" in
 *'"action":"catalog"'*) printf '%s\n' '{"type":"catalog","availability":{"ready":true},"applications":[{"id":"macos-fixture","name":"Fixture"}]}' ;;
 *'"action":"launch"'*) printf '%s\n' '{"type":"launched"}' ;;
 *'"action":"resume"'*) printf '%s\n' '{"type":"window","generation":1}' '{"type":"frame","generation":1,"data":"ZnJhbWU="}' ;;
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
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { m.serveMacSession(w, r, s) }))
	defer server.Close()
	dialer := websocket.Dialer{Subprotocols: []string{"redeven-host-application-v1", m.Password(view.ID)}}
	c, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/_redeven_host_app/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if err := c.WriteJSON(map[string]any{"action": "resume"}); err != nil {
		t.Fatal(err)
	}
	_ = c.SetReadDeadline(time.Now().Add(time.Second))
	for range 2 {
		if _, _, err = c.ReadMessage(); err != nil {
			t.Fatal(err)
		}
	}
	before, _ := os.ReadFile(requests)
	_ = c.Close()
	deadline := time.Now().Add(time.Second)
	for {
		after, _ := os.ReadFile(requests)
		if len(after) > len(before) && strings.Contains(string(after[len(before):]), `"action":"suspend"`) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("closing a viewer did not suspend native capture")
		}
		time.Sleep(time.Millisecond)
	}
	s.native.mu.Lock()
	buffered := len(s.native.latest)
	s.native.mu.Unlock()
	if buffered != 0 {
		t.Fatal("disconnected viewer retained its captured pixels")
	}
	if m.Sessions("alice")[0].State != "running" || m.Password(view.ID) == "" {
		t.Fatal("viewer disconnection ended the application session")
	}
}

func TestMacClosingManagerReleasesSessionResourcesBeforeReturning(t *testing.T) {
	m := macFixture(t)
	view, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	waitMac(t, m, view.ID, "running")
	m.mu.Lock()
	s := m.sessions[view.ID]
	m.mu.Unlock()
	if err = m.Close(); err != nil {
		t.Fatal(err)
	}
	s.native.writeMu.Lock()
	input := s.native.input
	s.native.writeMu.Unlock()
	s.native.mu.Lock()
	retained := len(s.native.latest) + len(s.native.window) + len(s.native.windows)
	s.native.mu.Unlock()
	if input != nil || retained != 0 {
		t.Fatalf("completed session retained helper input or pixels: input=%v bytes=%d", input != nil, retained)
	}
	if got := m.Sessions("alice")[0]; got.State != "ended" || got.EndReason != "sharing_stopped" {
		t.Fatalf("manager shutdown misreported application failure: %+v", got)
	}
}

func TestMacLaunchCannotReuseStoppingSession(t *testing.T) {
	m := macFixture(t)
	original, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	waitMac(t, m, original.ID, "running")
	m.mu.Lock()
	m.sessions[original.ID].stopping = true
	m.mu.Unlock()
	replacement, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
	if err != nil {
		t.Fatal(err)
	}
	if replacement.ID == original.ID {
		t.Fatal("launch reused a session already committed to stopping")
	}
}

func TestMacDetachBeforeHelperAdmissionCompletesWithoutRetry(t *testing.T) {
	m := macFixture(t)
	for i := 0; i < 12; i++ {
		view, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		err = m.Detach(ctx, "alice", view.ID)
		cancel()
		if err != nil {
			t.Fatalf("immediate detach %d: %v", i, err)
		}
		m.mu.Lock()
		s := m.sessions[view.ID]
		m.mu.Unlock()
		select {
		case <-s.done:
		default:
			t.Fatal("detach returned before resources were reclaimed")
		}
		if got := m.Sessions("alice"); len(got) != i+1 {
			t.Fatal(fmt.Sprint("ended session was reused: ", got))
		}
	}
}

func TestMacOperationBurstPreservesEveryResultInOrder(t *testing.T) {
	var events strings.Builder
	for i := 0; i < 64; i++ {
		fmt.Fprintf(&events, " '{\"type\":\"operation_error\",\"code\":\"RESULT_%02d\"}'", i)
	}
	m := macFixtureScript(t, `#!/bin/sh
while IFS= read -r request; do
 case "$request" in
 *'"action":"catalog"'*) printf '%s\n' '{"type":"catalog","availability":{"ready":true},"applications":[{"id":"macos-fixture","name":"Fixture"}]}' ;;
 *'"action":"launch"'*) printf '%s\n' '{"type":"launched"}' ;;
 *'"action":"resume"'*) printf '%s\n' '{"type":"window","generation":1}' `+events.String()+` ;;
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
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { m.serveMacSession(w, r, s) }))
	defer server.Close()
	dialer := websocket.Dialer{Subprotocols: []string{"redeven-host-application-v1", m.Password(view.ID)}}
	c, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/_redeven_host_app/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if err = c.WriteJSON(map[string]any{"action": "resume"}); err != nil {
		t.Fatal(err)
	}
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg macMessage
	if err = c.ReadJSON(&msg); err != nil || msg.Type != "window" {
		t.Fatalf("window before result: %+v %v", msg, err)
	}
	for i := 0; i < 64; i++ {
		if err = c.ReadJSON(&msg); err != nil {
			t.Fatal(err)
		}
		if msg.Code != fmt.Sprintf("RESULT_%02d", i) {
			t.Fatalf("operation result was overwritten: expected %d, got %+v", i, msg)
		}
	}
}

func TestMacConcurrentLaunchHasOneAuthoritativeSession(t *testing.T) {
	m := macFixture(t)
	results := make(chan Session, 12)
	errs := make(chan error, 12)
	for range 12 {
		go func() {
			s, err := m.macLaunch(context.Background(), "alice", LaunchRequest{ApplicationID: "macos-fixture"})
			results <- s
			errs <- err
		}()
	}
	var id string
	for range 12 {
		s := <-results
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
		if id == "" {
			id = s.ID
		}
		if id != s.ID {
			t.Fatal("concurrent opens allocated competing sessions")
		}
	}
	if len(m.Sessions("alice")) != 1 {
		t.Fatal("concurrent opens leaked a session")
	}
}

func TestMacSlowViewerOverflowDisconnectsWithoutUnboundedFeedback(t *testing.T) {
	m := &Manager{}
	ready := make(chan struct{})
	n := &macSession{input: macPlaybackInput{write: func(data []byte) {
		if strings.Contains(string(data), `"action":"resume"`) {
			close(ready)
		}
	}}}
	s := &ownedSession{password: "credential", native: n, done: make(chan struct{})}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { m.serveMacSession(w, r, s) }))
	defer server.Close()
	dialer := websocket.Dialer{Subprotocols: []string{"redeven-host-application-v1", "credential"}}
	c, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/_redeven_host_app/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if err = c.WriteJSON(map[string]any{"action": "resume"}); err != nil {
		t.Fatal(err)
	}
	<-ready
	// No writer notification: simulate a viewer that cannot drain its results.
	for range 129 {
		n.enqueueNotice([]byte(`{"type":"operation_complete","action":"input"}`))
	}
	n.mu.Lock()
	queued := len(n.notices)
	n.mu.Unlock()
	if queued > 128 {
		t.Fatalf("unbounded operation queue: %d", queued)
	}
	_ = c.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err = c.ReadMessage(); err == nil {
		t.Fatal("overflow retained a viewer with missing operation feedback")
	}
	if s.password == "" {
		t.Fatal("slow viewer retired the host session")
	}
}
