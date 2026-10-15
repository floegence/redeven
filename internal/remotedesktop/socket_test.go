package remotedesktop

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/gorilla/websocket"
)

type socketTransport struct {
	fakeTransport
	control chan nativeapps.HostDesktopMessage
	media   chan nativeapps.HostDesktopMessage
}

func (t *socketTransport) Control() <-chan nativeapps.HostDesktopMessage { return t.control }
func (t *socketTransport) Media() <-chan nativeapps.HostDesktopMessage   { return t.media }

func TestRemoteDesktopSocketsEnforceNegotiatedFrameWindow(t *testing.T) {
	for _, tc := range []struct {
		name              string
		offered, selected int
	}{
		{"legacy", 0, 0},
		{"extended", 6, 6},
		{"legacy-client", 6, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			native := &socketTransport{fakeTransport: fakeTransport{done: make(chan struct{})}, control: make(chan nativeapps.HostDesktopMessage, 2), media: make(chan nativeapps.HostDesktopMessage, 7)}
			m := &Manager{sessions: map[string]*ownedSession{}, factory: func(context.Context) (Transport, error) { return native, nil }}
			s := &ownedSession{owner: "alice", view: Session{ID: "window", Mode: "control"}}
			m.sessions[s.view.ID], m.controller = s, s.view.ID
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { m.serveSocket(w, r, s) }))
			defer server.Close()
			ticket, err := m.Ticket("alice", s.view.ID)
			if err != nil {
				t.Fatal(err)
			}
			dial := func(channel string) *websocket.Conn {
				t.Helper()
				d := websocket.Dialer{Subprotocols: []string{"redeven-desktop-v1", ticket.Token}}
				c, _, err := d.Dial("ws"+strings.TrimPrefix(server.URL, "http")+ViewerPath+channel, nil)
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = c.Close() })
				_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
				return c
			}
			control, media := dial("control"), dial("media")
			native.control <- nativeapps.HostDesktopMessage{Version: 1, Type: "capabilities", Capabilities: &nativeapps.HostDesktopCapabilities{Backend: "x11", FrameWindow: tc.offered}}
			var message nativeapps.HostDesktopMessage
			if err := control.ReadJSON(&message); err != nil || message.Capabilities == nil || message.Capabilities.FrameWindow != tc.offered {
				t.Fatal("native window offer lost", message, err)
			}
			picture := &nativeapps.HostDesktopPicture{Mode: "smooth", MaxDimension: 2560, FrameRate: 60, FrameWindow: tc.selected}
			if err := m.send(s, s.pair, nativeapps.HostDesktopCommand{Version: 1, Method: "connect", Mode: "control", Picture: picture}, false); err != nil {
				t.Fatal(err)
			}
			native.control <- nativeapps.HostDesktopMessage{Version: 1, Type: "state", State: "active", Mode: "control", Generation: 1}
			if err := control.ReadJSON(&message); err != nil {
				t.Fatal(err)
			}
			for id := 1; id <= picture.FrameCapacity(); id++ {
				native.media <- nativeapps.HostDesktopMessage{Version: 1, Type: "frame", Codec: "png", Generation: 1, FrameID: uint64(id), Width: 2, Height: 2, Data: []byte{1}}
				if _, _, err := media.ReadMessage(); err != nil {
					t.Fatalf("allowed frame %d rejected: %v", id, err)
				}
			}
			s.pair.mu.Lock()
			painted, outstanding := s.pair.painted, len(s.pair.sent)
			s.pair.mu.Unlock()
			if painted || outstanding != picture.FrameCapacity() {
				t.Fatalf("delivery granted paint or lost capacity: painted=%v outstanding=%d", painted, outstanding)
			}
			native.media <- nativeapps.HostDesktopMessage{Version: 1, Type: "frame", Codec: "png", Generation: 1, FrameID: uint64(picture.FrameCapacity() + 1), Width: 2, Height: 2, Data: []byte{1}}
			if _, _, err := media.ReadMessage(); err == nil {
				t.Fatal("frame beyond negotiated capacity reached the client")
			}
			select {
			case <-native.Done():
			case <-time.After(time.Second):
				t.Fatal("overflow retained native input/media")
			}
		})
	}
}

func TestRemoteDesktopSocketsBindBothChannelsAndRetireTogether(t *testing.T) {
	native := &socketTransport{fakeTransport: fakeTransport{done: make(chan struct{})}, control: make(chan nativeapps.HostDesktopMessage, 4), media: make(chan nativeapps.HostDesktopMessage, 4)}
	m := &Manager{sessions: map[string]*ownedSession{}, factory: func(context.Context) (Transport, error) { return native, nil }}
	s := &ownedSession{owner: "alice", view: Session{ID: "desktop", Mode: "control"}}
	m.sessions[s.view.ID] = s
	m.controller = s.view.ID
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { m.serveSocket(w, r, s) }))
	defer server.Close()
	ticket, err := m.Ticket("alice", s.view.ID)
	if err != nil {
		t.Fatal(err)
	}
	dial := func(channel, token string) (*websocket.Conn, *http.Response, error) {
		d := websocket.Dialer{Subprotocols: []string{"redeven-desktop-v1", token}}
		return d.Dial("ws"+strings.TrimPrefix(server.URL, "http")+ViewerPath+channel, nil)
	}
	if c, r, err := dial("media", "wrong"); err == nil {
		c.Close()
		t.Fatal("media accepted another ticket")
	} else if r.StatusCode != 403 {
		t.Fatal(r.StatusCode)
	}
	control, _, err := dial("control", ticket.Token)
	if err != nil {
		t.Fatal(err)
	}
	defer control.Close()
	if c, r, err := dial("control", ticket.Token); err == nil {
		c.Close()
		t.Fatal("duplicate control replaced attachment")
	} else if r.StatusCode != 409 {
		t.Fatal(r.StatusCode)
	}
	media, _, err := dial("media", ticket.Token)
	if err != nil {
		t.Fatal(err)
	}
	defer media.Close()
	// Independent native pipes may publish the keyframe before active state.
	native.media <- nativeapps.HostDesktopMessage{Version: 1, Type: "frame", Codec: "png", Cursor: "separate", Generation: 2, FrameID: 1, Width: 2, Height: 2, Data: []byte{1, 2, 3}}
	native.control <- nativeapps.HostDesktopMessage{Version: 1, Type: "state", State: "authorizing", Authorization: "restoring", Mode: "view"}
	native.control <- nativeapps.HostDesktopMessage{Version: 1, Type: "state", State: "active", Authorization: "saved", Mode: "control", Generation: 2}
	if err := control.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := media.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	var state nativeapps.HostDesktopMessage
	if err = control.ReadJSON(&state); err != nil || (state.State != "authorizing" || state.Authorization != "restoring") {
		t.Fatal(state, err)
	}
	if err = control.ReadJSON(&state); err != nil || (state.Generation != 2 || state.Authorization != "saved") {
		t.Fatal(state, err)
	}
	kind, packet, err := media.ReadMessage()
	if err != nil || kind != websocket.BinaryMessage {
		t.Fatal(kind, err)
	}
	frame, err := nativeapps.ReadHostDesktopMessage(bytes.NewReader(packet))
	if err != nil || frame.FrameID != 1 || frame.Cursor != "separate" {
		t.Fatal(frame, err)
	}
	command := func(method string, values map[string]any) {
		c := map[string]any{"version": 1, "id": 1, "method": method, "generation": 2}
		for k, v := range values {
			c[k] = v
		}
		if err := control.WriteJSON(map[string]any{"command": c}); err != nil {
			t.Fatal(err)
		}
	}
	command("frame_ack", map[string]any{"frame_id": 1})
	command("input", map[string]any{"input": map[string]any{"kind": "key", "code": "KeyX", "pressed": true}})
	deadline := time.Now().Add(time.Second)
	for {
		native.mu.Lock()
		n := len(native.commands)
		native.mu.Unlock()
		if n == 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("painted input did not reach native")
		}
		time.Sleep(time.Millisecond)
	}
	control.Close()
	select {
	case <-native.Done():
	case <-time.After(time.Second):
		t.Fatal("closing control retained native input/media")
	}
	if _, _, err = media.ReadMessage(); err == nil {
		t.Fatal("media survived control disconnect")
	}
	next, err := m.Ticket("alice", s.view.ID)
	if err != nil || next.Token == ticket.Token {
		t.Fatal("ticket not rotated", err)
	}
	if c, r, err := dial("media", ticket.Token); err == nil {
		c.Close()
		t.Fatal("old ticket revived attachment")
	} else if r.StatusCode != 403 {
		t.Fatal(r.StatusCode)
	}
	if s.pair.painted || s.pair.generation != 0 {
		t.Fatal("new attachment inherited painted authority")
	}
	// Ticket responses contain secrets only in private JSON, never in URLs.
	raw, _ := json.Marshal(next.Session)
	if bytes.Contains(raw, []byte(next.Token)) {
		t.Fatal("session metadata leaked the attachment secret")
	}
	if err := m.Disconnect("alice", s.view.ID); err != nil {
		t.Fatal(err)
	}
}
