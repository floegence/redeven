package hostapps

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/floegence/redeven/internal/portforward"
	"github.com/floegence/redeven/internal/portforward/registry"
	"github.com/gorilla/websocket"
)

// Opt-in native receipt test. All documents, processes and Runtime state belong
// to this invocation. Browser paint/clipboard checks are a separate acceptance.
func TestInstalledDesktopApplicationTransport(t *testing.T) {
	components := os.Getenv("REDEVEN_TEST_DESKTOP_COMPONENT_STATE")
	if runtime.GOOS != "linux" || components == "" {
		t.Skip("requires a task-owned native desktop component installation")
	}
	state := t.TempDir()
	ctx := context.Background()
	reg, err := registry.Open(filepath.Join(state, "forwards.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	forwards, err := portforward.New(reg)
	if err != nil {
		t.Fatal(err)
	}
	defer forwards.Close()
	pkg, err := nativeapps.DesktopForPlatform(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		t.Fatal(err)
	}
	newManager := func() *Manager {
		m := New(state, state, forwards)
		var err error
		m.setup, err = nativeapps.New(components, pkg, nil)
		if err != nil {
			t.Fatal(err)
		}
		return m
	}
	m := newManager()
	defer func() { m.Close() }()
	saved := filepath.Join(state, "saved.txt")
	fixture := filepath.Join(state, "editor.py")

	// GTK's normal key handler saves through the actual application interaction.
	if err := os.WriteFile(fixture, []byte(`import gi,pathlib,sys
gi.require_version('Gtk','3.0')
from gi.repository import Gtk,Gdk
window=Gtk.Window(title='Redeven native integration fixture')
window.set_default_size(640,480)
editor=Gtk.TextView()
window.add(editor)
def key(w,event):
    if event.state & Gdk.ModifierType.CONTROL_MASK and event.keyval == Gdk.KEY_s:
        b=editor.get_buffer();pathlib.Path(sys.argv[1]).write_text(b.get_text(b.get_start_iter(),b.get_end_iter(),True),encoding='utf-8');return True
    return False
window.connect('key-press-event',key)
window.connect('destroy',Gtk.main_quit)
window.show_all()
editor.grab_focus()
Gtk.main()
`), 0600); err != nil {
		t.Fatal(err)
	}
	if err = m.Add(ctx, AddRequest{Name: "Redeven native integration fixture", Executable: "/usr/bin/python3", Arguments: quoteArgv([]string{fixture, saved})}); err != nil {
		t.Fatal(err)
	}
	catalog, err := m.Catalog(ctx, "fixture", "en-US")
	if err != nil || !catalog.Availability.Ready {
		t.Fatal(catalog.Availability, err)
	}
	var appID string
	for _, app := range catalog.Applications {
		if app.Name == "Redeven native integration fixture" {
			appID = app.ID
		}
	}
	if appID == "" {
		t.Fatal("fixture desktop entry missing")
	}
	req := LaunchRequest{ApplicationID: appID, Locale: "en-US", Presentation: Presentation{Locale: "en-US", Starting: "Starting", Failed: "Failed", Ended: "Ended", Retry: "Retry", Connecting: "Connecting", Reconnecting: "Reconnecting", Disconnected: "Disconnected", ConnectionHint: "Reconnect", Reconnect: "Reconnect"}}
	share, err := m.Launch(ctx, "fixture", req)
	if err != nil {
		t.Fatal(err)
	}
	app := m.sessions[share.ID].application
	defer func() {
		if app.record.Process.Alive() {
			_ = m.Terminate(ctx, "fixture", QuitRequest{ApplicationID: appID, Instances: []string{app.record.ID}})
		}
	}()
	identity := app.record.Process
	open := func(view Session) *websocket.Conn {
		target := "http://" + m.sessions[view.ID].proxy.Addr().String()
		dialer := websocket.Dialer{Subprotocols: []string{"redeven-host-application-v1", m.Password(view.ID)}, HandshakeTimeout: 30 * time.Second}
		ws, _, err := dialer.Dial("ws"+strings.TrimPrefix(target, "http")+"/_redeven_host_app/stream", nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { ws.Close() })
		return ws
	}
	ws := open(share)
	var seq uint64
	send := func(request nativeapps.DesktopRequest) {
		seq++
		if err := ws.WriteJSON(struct {
			ID uint64 `json:"id"`
			nativeapps.DesktopRequest
		}{seq, request}); err != nil {
			t.Fatal(err)
		}
	}
	read := func() nativeapps.DesktopEvent {
		_ = ws.SetReadDeadline(time.Now().Add(20 * time.Second))
		var event nativeapps.DesktopEvent
		if err := ws.ReadJSON(&event); err != nil {
			t.Fatal(err)
		}
		if event.Bytes > 0 {
			kind, pixels, err := ws.ReadMessage()
			if err != nil || kind != websocket.BinaryMessage || len(pixels) != event.Bytes {
				t.Fatal("invalid pixel payload", err)
			}
			event.Pixels = pixels
		}
		return event
	}
	awaitFrame := func() nativeapps.DesktopFrame {
		for {
			event := read()
			if event.Event == "frame" {
				send(nativeapps.DesktopRequest{Method: "frame_ack", Frame: event.Frame.Sequence})
				return *event.Frame
			}
		}
	}
	frame := awaitFrame()
	operation := func(value any) {
		raw, _ := json.Marshal(value)
		send(nativeapps.DesktopRequest{Method: "input", Connection: frame.Connection, Window: frame.Window, Generation: frame.Generation, Operation: raw})
	}
	// First-frame admission and ordered pointer/text/key delivery use the product
	// WebSocket and the published helper, never a direct toolkit setter.
	operation(map[string]any{"kind": "button", "x": 150, "y": 150, "button": 0, "pressed": true})
	operation(map[string]any{"kind": "button", "x": 150, "y": 150, "button": 0, "pressed": false})
	text := "Redeven 中文 日本語 한국어 😀 𐐷 e\u0301 👩‍💻\nrepeat repeat"
	operation(map[string]any{"kind": "text", "text": text})
	for _, key := range []struct {
		code    int
		pressed bool
	}{{29, true}, {31, true}, {31, false}, {29, false}} {
		operation(map[string]any{"kind": "key", "code": key.code, "pressed": key.pressed})
	}
	last := seq
	for {
		event := read()
		if event.Error != "" {
			t.Fatal("native input failed", event.Error)
		}
		if event.Event == "frame" {
			send(nativeapps.DesktopRequest{Method: "frame_ack", Frame: event.Frame.Sequence})
		}
		if event.ID == last {
			break
		}
	}
	waitUntil(t, func() bool { bytes, err := os.ReadFile(saved); return err == nil && string(bytes) == text }, 5*time.Second)
	// A passive status read must never take over this attachment.
	if _, err = m.desktopReceipt(app); err != nil {
		t.Fatal(err)
	}
	send(nativeapps.DesktopRequest{Method: "status"})
	last = seq
	for {
		event := read()
		if event.ID == last {
			break
		}
	}
	// A rejected clipboard publication cancels its dependent paste and later
	// input in the upstream scheduler. Do not add a product retry/ordering queue.
	operation(map[string]any{"kind": "clipboard", "text": "invalid\x00selection"})
	invalid := seq
	operation(map[string]any{"kind": "key", "code": 29, "pressed": true})
	operation(map[string]any{"kind": "key", "code": 47, "pressed": true})
	operation(map[string]any{"kind": "key", "code": 47, "pressed": false})
	operation(map[string]any{"kind": "key", "code": 29, "pressed": false})
	operation(map[string]any{"kind": "text", "text": "must remain cancelled"})
	last = seq
	for {
		event := read()
		if event.ID == invalid && event.Error != "CLIPBOARD_TEXT_INVALID" {
			t.Fatal("invalid clipboard was accepted", event.Error)
		}
		if event.ID > invalid && event.ID <= last && event.Error != "INPUT_TARGET_UNAVAILABLE" {
			t.Fatal("dependent input escaped failed publication", event)
		}
		if event.ID == last {
			break
		}
	}
	ws.Close()
	if err = m.Close(); err != nil {
		t.Fatal(err)
	}
	if !identity.Alive() {
		t.Fatal("Runtime close terminated application")
	}
	m = newManager()
	resumed, err := m.Launch(ctx, "fixture", req)
	if err != nil {
		t.Fatal(err)
	}
	restored := m.sessions[resumed.ID].application
	if restored.record.Process != identity || restored.record.Backend != "wayland" {
		t.Fatal("Runtime recovery changed application identity")
	}
	ws = open(resumed)
	seq = 0
	frame = awaitFrame()
	for _, key := range []struct {
		code    int
		pressed bool
	}{{29, true}, {31, true}, {31, false}, {29, false}} {
		operation(map[string]any{"kind": "key", "code": key.code, "pressed": key.pressed})
	}
	last = seq
	for {
		event := read()
		if event.ID == last {
			if event.Error != "" {
				t.Fatal(event.Error)
			}
			break
		}
		if event.Event == "frame" {
			send(nativeapps.DesktopRequest{Method: "frame_ack", Frame: event.Frame.Sequence})
		}
	}
	waitUntil(t, func() bool { bytes, err := os.ReadFile(saved); return err == nil && string(bytes) == text }, 5*time.Second)
	send(nativeapps.DesktopRequest{Method: "close_window", Window: frame.Window})
	waitUntil(t, func() bool { return !identity.Alive() }, 10*time.Second)
	t.Logf("native product input/save and Runtime restart passed: component=%s helper_pid=%d start_ticks=%s saved_bytes=%d", pkg.Digest(), identity.PID, identity.Started, len(text))
}
