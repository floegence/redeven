//go:build linux

package hostapps

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

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
	fixture := filepath.Join(root, "fixture.py")
	source := `import json, os, gi
from pathlib import Path
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk
root = Path(` + quotePython(root) + `)
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
w.set_default_size(640, 480)
w.connect('destroy', Gtk.main_quit)
w.show_all()
fields[0].grab_focus()
save()
(root / 'environment.json').write_text(json.dumps({key:os.environ.get(key) for key in ['DISPLAY','DBUS_SESSION_BUS_ADDRESS','GTK_IM_MODULE','QT_IM_MODULE','XMODIFIERS']}))
Gtk.main()
`
	if err := os.WriteFile(fixture, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	if err := m.Add(context.Background(), AddRequest{Name: "Client input acceptance", Executable: "/usr/bin/python3", Arguments: quoteArgv([]string{fixture})}); err != nil {
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
			_ = m.Terminate(context.Background(), "fixture", QuitRequest{ApplicationID: appID, Instances: []string{a.record.ID}})
			waitUntil(t, func() bool { return !a.record.Process.Alive() }, 8*time.Second)
		}
	})
	waitUntil(t, func() bool { return m.Sessions("fixture")[0].State == "running" }, 45*time.Second)
	metadata, _ := json.Marshal(map[string]any{"address": a.record.Address, "password": m.sessions[session.ID].password,
		"pid": a.record.Process.PID, "state": state, "component": a.record.Component, "input_version": 1})
	if err := os.WriteFile(filepath.Join(root, "connection.json"), metadata, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("owned input fixture ready: pid=%d address=%s state=%s", a.record.Process.PID, a.record.Address, state)
	waitUntil(t, func() bool { _, err := os.Stat(filepath.Join(root, "done.json")); return err == nil }, 180*time.Second)
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
