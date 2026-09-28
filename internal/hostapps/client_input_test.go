//go:build linux

package hostapps

import (
	"context"
	_ "embed"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
)

//go:embed testdata/client_pointer.py
var clientPointerPython string

//go:embed testdata/client_pointer.html
var clientPointerHTML string

//go:embed testdata/client_input_gtk4.py
var clientGTK4Python string

// This opt-in fixture uses the released components and the real product launch
// path. An external browser drives the product viewer, then writes done.json.
// Only task-owned directories, listeners and applications are created.
func TestInstalledClientInputViewer(t *testing.T) {
	root := os.Getenv("REDEVEN_TEST_CLIENT_INPUT_EVIDENCE")
	if root == "" {
		t.Skip("requires a task-owned Linux evidence directory and browser driver")
	}
	if runtime.GOOS != "linux" || !filepath.IsAbs(root) {
		t.Fatal("requires an absolute Linux evidence directory")
	}
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(root, "state")
	if err := os.Mkdir(state, 0700); err != nil {
		t.Fatal(err)
	}
	m := installedLifecycleManager(t, state)
	// A known custom cursor qualifies the real PNG transport and click hotspot
	// alongside input. Rendering and normalization remain owned by the SDK.
	cursor := image.NewNRGBA(image.Rect(0, 0, 48, 48))
	for y := 0; y < 48; y++ {
		for x := 0; x < 48; x++ {
			value := color.NRGBA{R: 255, A: 255}
			if x >= 24 {
				value = color.NRGBA{B: 255, A: 255}
			}
			cursor.SetNRGBA(x, y, value)
		}
	}
	cursorFile, err := os.Create(filepath.Join(root, "cursor.png"))
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(cursorFile, cursor); err != nil {
		_ = cursorFile.Close()
		t.Fatal(err)
	}
	if err := cursorFile.Close(); err != nil {
		t.Fatal(err)
	}
	fixture := filepath.Join(root, "fixture.py")
	source := `import json, os, gi
from pathlib import Path
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gdk, GdkPixbuf
root = Path(` + quotePython(root) + `)
cursor = Gdk.Cursor.new_from_pixbuf(Gdk.Display.get_default(), GdkPixbuf.Pixbuf.new_from_file(str(root / 'cursor.png')), 22, 24)
def move(field, event):
    event.window.set_cursor(cursor)
    return False
def clicked(field, event):
    pending = root / 'pointer.tmp'
    pending.write_text(json.dumps([event.x_root, event.y_root]))
    pending.replace(root / 'pointer.json')
    return False
w = Gtk.Window(title="Client input acceptance")
b = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
w.add(b)
fields = [Gtk.Entry(), Gtk.Entry()]
def save(*args):
    pending = root / 'receipt.tmp'
    pending.write_text(json.dumps([field.get_text() for field in fields]))
    pending.replace(root / 'receipt.json')
for field in fields:
    field.set_size_request(400, 140)
    b.pack_start(field, True, True, 0)
    field.connect('changed', save)
    field.add_events(Gdk.EventMask.POINTER_MOTION_MASK | Gdk.EventMask.BUTTON_PRESS_MASK)
    field.connect('motion-notify-event', move)
    field.connect('button-press-event', clicked)
w.set_default_size(640, 480)
w.connect('destroy', Gtk.main_quit)
w.show_all()
fields[0].grab_focus()
save()
(root / 'environment.json').write_text(json.dumps({key:os.environ.get(key) for key in ['DISPLAY','DBUS_SESSION_BUS_ADDRESS','GTK_IM_MODULE','QT_IM_MODULE','XMODIFIERS']}))
Gtk.main()
`
	target := os.Getenv("REDEVEN_TEST_CLIENT_INPUT_TARGET")
	if target == "window-lifecycle" {
		// The native event loop deliberately outlives its only window. Closing
		// sharing must not be confused with application-process termination.
		source = strings.Replace(source, "w.connect('destroy', Gtk.main_quit)", "w.connect('destroy', lambda *args: (root / 'window-closed.json').write_text(json.dumps({'pid':os.getpid(), 'closed':True})))", 1)
	}
	if target != "" && target != "window-lifecycle" && !strings.HasPrefix(target, "pointer-") {
		if target != "firefox" && target != "gtk4" && target != "gtk4-entry" && target != "gnome" {
			t.Fatal("unsupported input fixture target", target)
		}
		source = `import json, os, subprocess, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
root = Path(` + quotePython(root) + `)
class Page(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/cursor.png':
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.end_headers()
            self.wfile.write((root/'cursor.png').read_bytes())
            return
        page = b'''<!doctype html><title>Client input acceptance</title>
<style>body{margin:0;height:100vh;display:flex;flex-direction:column}textarea{flex:1;min-height:0;font:24px system-ui;resize:none;cursor:url(/cursor.png) 22 24,text}</style>
<textarea autofocus></textarea><textarea></textarea>
<script>const fields=[...document.querySelectorAll('textarea')];let pending=Promise.resolve();
const save=()=>{const body=JSON.stringify(fields.map(f=>f.value));pending=pending.then(()=>fetch('/receipt',{method:'POST',body}));};
fields.forEach(f=>f.addEventListener('input',save));
fields.forEach(f=>f.addEventListener('pointerdown',e=>fetch('/pointer',{method:'POST',body:JSON.stringify([e.screenX,e.screenY])})));save();</script>'''
        self.send_response(200)
        self.send_header('Content-Type','text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(page)
    def do_POST(self):
        values = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        name = 'pointer' if self.path == '/pointer' else 'receipt'
        pending = root / (name + '.tmp')
        pending.write_text(json.dumps(values))
        pending.replace(root / (name + '.json'))
        self.send_response(204)
        self.end_headers()
    def log_message(self, *args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),Page)
threading.Thread(target=server.serve_forever,daemon=True).start()
profile=root/'firefox-profile'
profile.mkdir()
(profile/'user.js').write_text('user_pref("browser.shell.checkDefaultBrowser", false);\nuser_pref("browser.aboutwelcome.enabled", false);\nuser_pref("termsofuse.bypassNotification", true);\nuser_pref("datareporting.healthreport.uploadEnabled", false);\nuser_pref("browser.startup.homepage_override.mstone", "ignore");\n')
(root/'environment.json').write_text(json.dumps({key:os.environ.get(key) for key in ['DISPLAY','DBUS_SESSION_BUS_ADDRESS','GTK_IM_MODULE','QT_IM_MODULE','XMODIFIERS']}))
try:
    subprocess.run(['/usr/bin/firefox','--no-remote','--profile',str(profile),'http://127.0.0.1:'+str(server.server_port)],check=True)
finally:
    server.shutdown()
`
	}
	if target == "gtk4" || target == "gtk4-entry" || target == "gnome" {
		source = clientGTK4Python
	}
	if strings.HasPrefix(target, "pointer-") {
		if target != "pointer-gtk" && target != "pointer-firefox" {
			t.Fatal("unsupported pointer fixture", target)
		}
		source = clientPointerPython
		if err := os.WriteFile(filepath.Join(root, "pointer.html"), []byte(clientPointerHTML), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(fixture, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	if err := m.Add(context.Background(), AddRequest{Name: "Client input acceptance", Executable: "/usr/bin/python3", Arguments: quoteArgv([]string{fixture, root, target})}); err != nil {
		t.Fatal(err)
	}
	catalog, err := m.Catalog(context.Background(), "fixture", "en-US")
	if err != nil || !catalog.Availability.Ready {
		t.Fatalf("input capability unavailable: %+v %v", catalog.Availability, err)
	}
	var appID string
	for _, app := range catalog.Applications {
		if app.Custom && app.Name == "Client input acceptance" {
			appID = app.ID
		}
	}
	session, err := m.Launch(context.Background(), "fixture", LaunchRequest{ApplicationID: appID, Locale: "en-US", Presentation: Presentation{Locale: "en-US", Starting: "Starting", Failed: "Failed", Ended: "Ended", Retry: "Retry", Connecting: "Connecting", Reconnecting: "Reconnecting", Disconnected: "Disconnected", ConnectionHint: "Reconnect", Reconnect: "Reconnect"}})
	if err != nil {
		t.Fatal(err)
	}
	a := m.sessions[session.ID].application
	t.Cleanup(func() {
		if a.record.Process.Alive() {
			if err := m.Terminate(context.Background(), "fixture", QuitRequest{ApplicationID: appID, Instances: []string{a.record.ID}}); err != nil {
				t.Fatal("terminate owned input fixture:", err)
			}
			waitUntil(t, func() bool { return !a.record.Process.Alive() }, 8*time.Second)
		}
	})
	waitUntil(t, func() bool { return m.Sessions("fixture")[0].State == "running" }, 45*time.Second)
	publishClientInputFixture(t, m, session, root, state, target, nil)
	t.Logf("owned input fixture ready: pid=%d address=%s state=%s", a.record.Process.PID, a.record.Address, state)
	waitUntil(t, func() bool { _, err := os.Stat(filepath.Join(root, "done.json")); return err == nil }, 180*time.Second)
	if target == "window-lifecycle" {
		var completion struct {
			Passed bool `json:"passed"`
		}
		completed, err := os.ReadFile(filepath.Join(root, "done.json"))
		if err != nil || json.Unmarshal(completed, &completion) != nil || !completion.Passed {
			t.Fatal("browser did not confirm final-window closure")
		}
		var receipt struct {
			PID    int  `json:"pid"`
			Closed bool `json:"closed"`
		}
		data, err := os.ReadFile(filepath.Join(root, "window-closed.json"))
		if err != nil || json.Unmarshal(data, &receipt) != nil || !receipt.Closed || receipt.PID <= 0 || !a.record.Process.Alive() {
			t.Fatal("window closure did not retain its application", err)
		}
		if err := syscall.Kill(receipt.PID, 0); err != nil {
			t.Fatal("windowless application event loop exited", err)
		}
		t.Logf("last window destroyed, browser closed, application pid=%d and helper pid=%d remain alive", receipt.PID, a.record.Process.PID)
		return
	}
	if target == "gnome" {
		var expected struct {
			Document string `json:"document"`
		}
		data, err := os.ReadFile(filepath.Join(root, "done.json"))
		if err != nil || json.Unmarshal(data, &expected) != nil || expected.Document == "" {
			t.Fatal("invalid editor completion receipt")
		}
		data, err = os.ReadFile(filepath.Join(root, "document.txt"))
		if err != nil || string(data) != expected.Document {
			t.Fatal("editor did not save the exact expected UTF-8 bytes")
		}
		return
	}
	if strings.HasPrefix(target, "pointer-") {
		var done struct {
			Passed bool `json:"passed"`
		}
		data, err := os.ReadFile(filepath.Join(root, "done.json"))
		if err != nil || json.Unmarshal(data, &done) != nil || !done.Passed {
			t.Fatal("invalid pointer completion receipt")
		}
		var receipt struct {
			Clicks  int       `json:"clicks"`
			Doubles int       `json:"doubles"`
			Rights  int       `json:"rights"`
			Drag    float64   `json:"drag"`
			Inner   []float64 `json:"inner"`
		}
		data, err = os.ReadFile(filepath.Join(root, "receipt.json"))
		if err != nil || json.Unmarshal(data, &receipt) != nil || receipt.Clicks != 3 || receipt.Doubles < 1 || receipt.Rights < 1 || receipt.Drag <= 30 || len(receipt.Inner) != 2 || receipt.Inner[0] <= 0 || receipt.Inner[1] <= 0 {
			t.Fatalf("invalid application pointer receipt: %s", data)
		}
		return
	}
	var expected, actual []string
	data, err := os.ReadFile(filepath.Join(root, "done.json"))
	if err != nil || json.Unmarshal(data, &expected) != nil || len(expected) != 2 {
		t.Fatal("invalid browser completion receipt", err)
	}
	data, err = os.ReadFile(filepath.Join(root, "receipt.json"))
	if err != nil || json.Unmarshal(data, &actual) != nil || len(actual) != 2 || actual[0] != expected[0] || actual[1] != expected[1] {
		t.Fatal("application did not receive the exact expected strings")
	}
}

// Reattach a task-owned application left by the previous Runtime executable.
// The driver kills only that fixture Runtime after entering unsaved text; this
// process opens its original database and never rewrites the instance modules.
func TestInstalledClientInputViewerResume(t *testing.T) {
	root := os.Getenv("REDEVEN_TEST_CLIENT_INPUT_RESUME_EVIDENCE")
	if root == "" {
		t.Skip("requires a surviving task-owned legacy application")
	}
	state := filepath.Join(root, "state")
	before, err := os.ReadFile(filepath.Join(root, "connection.json"))
	if err != nil {
		t.Fatal(err)
	}
	var legacy struct {
		PID int `json:"pid"`
	}
	if err := json.Unmarshal(before, &legacy); err != nil {
		t.Fatal(err)
	}
	var retained []string
	data, err := os.ReadFile(filepath.Join(root, "receipt.json"))
	if err != nil || json.Unmarshal(data, &retained) != nil || len(retained) != 2 || retained[0] == "" {
		t.Fatal("missing retained unsaved input")
	}
	m := installedLifecycleManager(t, state)
	running, err := m.Running(context.Background(), "fixture")
	if err != nil || len(running) != 1 {
		t.Fatal("legacy application recovery failed", running, err)
	}
	appID := running[0].ApplicationID
	instance := running[0].Instances[0]
	a := m.applications[instance]
	if a.record.Process.PID != legacy.PID {
		t.Fatal("recovery replaced the backend")
	}
	t.Cleanup(func() {
		if a.record.Process.Alive() {
			if err := m.Terminate(context.Background(), "fixture", QuitRequest{ApplicationID: appID, Instances: []string{instance}}); err != nil {
				t.Fatal("terminate owned upgrade fixture:", err)
			}
			waitUntil(t, func() bool { return !a.record.Process.Alive() }, 8*time.Second)
		}
	})
	session, err := m.Launch(context.Background(), "fixture", LaunchRequest{ApplicationID: appID, Locale: "en-US", Presentation: Presentation{Locale: "en-US", Starting: "Starting", Failed: "Failed", Ended: "Ended", Retry: "Retry", Connecting: "Connecting", Reconnecting: "Reconnecting", Disconnected: "Disconnected", ConnectionHint: "Reconnect", Reconnect: "Reconnect"}})
	if err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool { return m.Sessions("fixture")[0].State == "running" }, 45*time.Second)
	if err := os.WriteFile(filepath.Join(root, "legacy-connection.json"), before, 0600); err != nil {
		t.Fatal(err)
	}
	publishClientInputFixture(t, m, session, root, state, "", retained)
	t.Logf("same backend PID %d recovered with current viewer %s", legacy.PID, m.sessions[session.ID].viewer.Assets().Digest())
	waitUntil(t, func() bool { _, err := os.Stat(filepath.Join(root, "done.json")); return err == nil }, 180*time.Second)
	var expected, actual []string
	done, err := os.ReadFile(filepath.Join(root, "done.json"))
	if err != nil || json.Unmarshal(done, &expected) != nil {
		t.Fatal("invalid upgrade receipt")
	}
	data, err = os.ReadFile(filepath.Join(root, "receipt.json"))
	if err != nil || json.Unmarshal(data, &actual) != nil || len(actual) != 2 || len(expected) != 2 || actual[0] != expected[0] || actual[1] != expected[1] || !strings.HasPrefix(actual[0], retained[0]) || actual[0] == retained[0] {
		t.Fatal("upgrade lost contents or input")
	}
	if !a.record.Process.Alive() {
		t.Fatal("upgrade replaced the live application")
	}
}

func publishClientInputFixture(t *testing.T, m *Manager, session Session, root, state, target string, retained []string) {
	t.Helper()
	a := m.sessions[session.ID].application
	share := m.sessions[session.ID]
	backendURL, err := url.Parse("http://" + share.proxy.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(backendURL)
	// The fixture supplies one fixed admitted owner. Production origin and
	// permission guards are exercised by the appserver authorization tests.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/_redeven_host_app/state" {
			for _, current := range m.Sessions("fixture") {
				if current.ID == session.ID {
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(map[string]any{"state": current.State, "error_code": current.ErrorCode, "end_reason": current.EndReason, "password": m.Password(current.ID), "launch_diagnostic": current.LaunchDiagnostic})
					return
				}
			}
			http.NotFound(w, r)
			return
		}
		if r.URL.Path == "/cursor.js" && session.Backend == "wayland" {
			w.Header().Set("Content-Type", "text/javascript")
			_, _ = w.Write(nativeapps.CursorClientSource())
			return
		}
		if strings.HasPrefix(r.URL.Path, ClientAssetsPath) {
			digest, resource, ok := strings.Cut(strings.TrimPrefix(r.URL.Path, ClientAssetsPath), "/")
			assets := m.ClientAssets("fixture", digest)
			if !ok || assets == nil {
				http.NotFound(w, r)
				return
			}
			r.URL.Path = "/" + resource
			assets.ServeHTTP(w, r)
			return
		}
		proxy.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	digest := ""
	if share.viewer != nil {
		digest = share.viewer.Assets().Digest()
	}
	metadata, _ := json.Marshal(map[string]any{"address": server.Listener.Addr().String(), "backend": session.Backend, "backend_address": a.record.Address, "password": share.password,
		"pid": a.record.Process.PID, "process": a.record.Process, "state": state, "component": a.record.Component,
		"input_version": 1, "viewer_version": 1, "assets_digest": digest, "kind": target, "retained": retained})
	if err := os.WriteFile(filepath.Join(root, "connection.json"), metadata, 0600); err != nil {
		t.Fatal(err)
	}
}
