//go:build linux

package hostapps

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/gorilla/websocket"
)

// This wire peer tests product authentication and attachment ownership, not the
// native input implementation. Installed acceptance asserts real widget results.
func desktopTransportFixture(t *testing.T) (*Manager, *linuxApplication, Session, *atomic.Uint64) {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	endpoint := nativeapps.DesktopEndpoint{SocketPath: filepath.Join(dir, "control.sock"), Instance: "owned-fixture", Token: strings.Repeat("a", 64)}
	listener, err := net.Listen("unix", endpoint.SocketPath)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(endpoint.SocketPath, 0600); err != nil {
		t.Fatal(err)
	}
	var count atomic.Uint64
	var workers sync.WaitGroup
	var peers sync.Map
	write := func(conn net.Conn, value any) error {
		body, err := json.Marshal(value)
		if err != nil {
			return err
		}
		header := make([]byte, 5)
		header[0] = 1
		binary.BigEndian.PutUint32(header[1:], uint32(len(body)))
		_, err = conn.Write(append(header, body...))
		return err
	}
	read := func(conn net.Conn, value any) error {
		header := make([]byte, 5)
		if _, err := io.ReadFull(conn, header); err != nil {
			return err
		}
		size := binary.BigEndian.Uint32(header[1:])
		if header[0] != 1 || size > 128*1024 {
			return nativeapps.ErrDesktopProtocol
		}
		body := make([]byte, size)
		if _, err := io.ReadFull(conn, body); err != nil {
			return err
		}
		return json.Unmarshal(body, value)
	}
	workers.Add(1)
	go func() {
		defer workers.Done()
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			peers.Store(conn, true)
			workers.Add(1)
			go func() {
				defer workers.Done()
				defer conn.Close()
				defer peers.Delete(conn)
				var auth struct {
					Version  int    `json:"version"`
					Instance string `json:"instance"`
					Token    string `json:"token"`
				}
				if read(conn, &auth) != nil || auth.Version != 1 || auth.Instance != endpoint.Instance || auth.Token != endpoint.Token {
					return
				}
				epoch := count.Add(1)
				state := nativeapps.DesktopState{State: "waiting", Windows: []nativeapps.DesktopWindow{}}
				if write(conn, nativeapps.DesktopEvent{Event: "attached", Version: 1, Connection: epoch, State: &state}) != nil {
					return
				}
				for {
					var request struct {
						ID     uint64 `json:"id"`
						Method string `json:"method"`
					}
					if read(conn, &request) != nil {
						return
					}
					result, _ := json.Marshal(state)
					if write(conn, nativeapps.DesktopEvent{ID: request.ID, Result: result}) != nil {
						return
					}
				}
			}()
		}
	}()
	t.Cleanup(func() {
		listener.Close()
		peers.Range(func(key, value any) bool { key.(net.Conn).Close(); return true })
		workers.Wait()
	})
	m := macFixture(t)
	app := &linuxApplication{record: linuxApplicationRecord{ID: strings.Repeat("b", 64), Backend: "wayland", Application: Application{ID: "fixture.desktop"}, Endpoint: &endpoint}, ready: true, prepared: make(chan struct{})}
	close(app.prepared)
	view, err := m.shareDesktopApplication(context.Background(), "alice", app, Presentation{})
	if err != nil {
		t.Fatal(err)
	}
	return m, app, view, &count
}

func desktopTestViewer(t *testing.T, m *Manager, view Session) (*websocket.Conn, nativeapps.DesktopEvent) {
	t.Helper()
	dialer := websocket.Dialer{Subprotocols: []string{"redeven-host-application-v1", m.Password(view.ID)}, HandshakeTimeout: 2 * time.Second}
	ws, _, err := dialer.Dial("ws://"+m.sessions[view.ID].proxy.Addr().String()+"/_redeven_host_app/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ws.Close() })
	ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	var attached nativeapps.DesktopEvent
	if err = ws.ReadJSON(&attached); err != nil {
		t.Fatal(err)
	}
	if attached.Event != "attached" || attached.Version != 1 {
		t.Fatal("missing native handshake", attached)
	}
	return ws, attached
}

func TestDesktopTransportRejectsUnauthenticatedAndForceQuitPackets(t *testing.T) {
	m, _, view, connections := desktopTransportFixture(t)
	url := "ws://" + m.sessions[view.ID].proxy.Addr().String() + "/_redeven_host_app/stream"
	for _, protocols := range [][]string{nil, {"redeven-host-application-v1", "wrong"}, {"future", m.Password(view.ID)}} {
		dialer := websocket.Dialer{Subprotocols: protocols, HandshakeTimeout: time.Second}
		ws, response, err := dialer.Dial(url, nil)
		if ws != nil {
			ws.Close()
		}
		if response != nil {
			response.Body.Close()
		}
		if err == nil || response == nil || response.StatusCode != http.StatusForbidden {
			t.Fatal("unauthenticated viewer accepted", err)
		}
	}
	if connections.Load() != 0 {
		t.Fatal("invalid viewer reached the native helper")
	}
	ws, _ := desktopTestViewer(t, m, view)
	if err := ws.WriteJSON(map[string]any{"id": 1, "method": "terminate_application"}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ws.ReadMessage(); err == nil {
		t.Fatal("viewer force quit was forwarded")
	}
}

func TestDesktopTransportTakeoverAndControlsShareOneReader(t *testing.T) {
	m, app, view, connections := desktopTransportFixture(t)
	first, old := desktopTestViewer(t, m, view)
	second, current := desktopTestViewer(t, m, view)
	if current.Connection <= old.Connection {
		t.Fatal("takeover reused native connection identity")
	}
	if _, _, err := first.ReadMessage(); err == nil {
		t.Fatal("old viewer retained input authority")
	}
	// A control request and browser request have independent correlation IDs on
	// the same native reader. No passive/control probe replaces the viewer.
	control := make(chan error, 1)
	go func() { control <- m.controlDesktopApplication(context.Background(), app, false) }()
	if err := second.WriteJSON(map[string]any{"id": 41, "method": "status"}); err != nil {
		t.Fatal(err)
	}
	var reply nativeapps.DesktopEvent
	if err := second.ReadJSON(&reply); err != nil || reply.ID != 41 {
		t.Fatal("request correlation changed", reply, err)
	}
	if err := <-control; err != nil {
		t.Fatal(err)
	}
	if connections.Load() != 2 {
		t.Fatal("application controls stole the viewer attachment")
	}
	if err := m.Detach(context.Background(), "alice", view.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := second.ReadMessage(); err == nil {
		t.Fatal("detached viewer remains connected")
	}
	if app.ended {
		t.Fatal("detaching the viewer ended the application")
	}
}

func TestDesktopTransportDuplicateRequestClosesOnlyThatViewer(t *testing.T) {
	m, app, view, _ := desktopTransportFixture(t)
	ws, _ := desktopTestViewer(t, m, view)
	request := map[string]any{"id": 7, "method": "status"}
	if err := ws.WriteJSON(request); err != nil {
		t.Fatal(err)
	}
	var reply nativeapps.DesktopEvent
	if err := ws.ReadJSON(&reply); err != nil {
		t.Fatal(err)
	}
	if err := ws.WriteJSON(request); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ws.ReadMessage(); err == nil {
		t.Fatal("duplicate request replay accepted")
	}
	if app.ended {
		t.Fatal("protocol error ended application")
	}
	_, _ = desktopTestViewer(t, m, view)
}
