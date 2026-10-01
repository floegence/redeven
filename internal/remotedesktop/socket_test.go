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
	native.media <- nativeapps.HostDesktopMessage{Version: 1, Type: "frame", Codec: "png", Generation: 2, FrameID: 1, Width: 2, Height: 2, Data: []byte{1, 2, 3}}
	native.control <- nativeapps.HostDesktopMessage{Version: 1, Type: "state", State: "authorizing", Mode: "view"}
	native.control <- nativeapps.HostDesktopMessage{Version: 1, Type: "state", State: "active", Mode: "control", Generation: 2}
	control.SetReadDeadline(time.Now().Add(time.Second))
	media.SetReadDeadline(time.Now().Add(time.Second))
	var state nativeapps.HostDesktopMessage
	if err = control.ReadJSON(&state); err != nil || state.State != "authorizing" {
		t.Fatal(state, err)
	}
	if err = control.ReadJSON(&state); err != nil || state.Generation != 2 {
		t.Fatal(state, err)
	}
	kind, packet, err := media.ReadMessage()
	if err != nil || kind != websocket.BinaryMessage {
		t.Fatal(kind, err)
	}
	frame, err := nativeapps.ReadHostDesktopMessage(bytes.NewReader(packet))
	if err != nil || frame.FrameID != 1 {
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
	m.Disconnect("alice", s.view.ID)
}
