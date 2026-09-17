package ai

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPrivateDesktopEnvironmentDropsOtherSessionAddresses(t *testing.T) {
	got := privateDesktopEnvironment([]string{"DISPLAY=:0", "WAYLAND_DISPLAY=wayland-1", "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1/bus", "DBUS_STARTER_ADDRESS=wrong", "AT_SPI_BUS_ADDRESS=wrong", "PATH=/usr/bin", "LANG=C.UTF-8"})
	if strings.Join(got, "\n") != "PATH=/usr/bin\nLANG=C.UTF-8" {
		t.Fatalf("inherited another desktop: %v", got)
	}
}

func TestATSPISocketCannotEscapePrivateDesktop(t *testing.T) {
	for _, address := range []string{"unix:abstract=foreign", "unix:path=/tmp/owned/../foreign", "unix:path=/tmp/owned/%2e%2e/foreign", "unix:path=/tmp/owned/socket;unix:path=/tmp/foreign", "unix:path=/tmp/owned-other/socket", "tcp:host=localhost,port=123"} {
		if validatePrivateATSPISocket(address, "/tmp/owned") == nil {
			t.Fatalf("accepted %s", address)
		}
	}
	if err := validatePrivateATSPISocket("unix:path=/tmp/owned/a11y/socket,guid=123", "/tmp/owned"); err != nil {
		t.Fatal(err)
	}
}

func TestATSPISemanticActionsOnPrivateDisplay(t *testing.T) {
	if os.Getenv("REDEVEN_XVFB_INTEGRATION") != "1" {
		t.Skip("set REDEVEN_XVFB_INTEGRATION=1 in the Linux qualification image")
	}
	e := NewXvfbTargetExecutor(t.TempDir())
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	if err := e.EnsureTargetReady(ctx, "xvfb-main"); err != nil {
		t.Fatalf("%#v", err)
	}
	defer e.Close()
	fixture := filepath.Join(e.sessionDirectory, "fixture.py")
	if err := os.WriteFile(fixture, []byte(`import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib
window = Gtk.Window(title='Flower AT-SPI Fixture')
window.set_default_size(420, 320)
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
window.add(box)
entry = Gtk.Entry()
entry.get_accessible().set_name('Query')
box.pack_start(entry, False, False, 0)
result = Gtk.Label(label='Empty')
result.get_accessible().set_name('Result')
box.pack_start(result, False, False, 0)
apply = Gtk.Button(label='Apply')
apply.connect('clicked', lambda _: result.set_text(entry.get_text()))
box.pack_start(apply, False, False, 0)
for i in range(2): box.pack_start(Gtk.Button(label='Duplicate'), False, False, 0)
def ready():
    global entry
    box.remove(entry)
    entry.destroy()
    entry = Gtk.Entry()
    entry.get_accessible().set_name('Query')
    box.pack_start(entry, False, False, 0)
    button = Gtk.Button(label='Ready')
    box.pack_start(button, False, False, 0)
    window.show_all()
    return False
load = Gtk.Button(label='Load')
load.connect('clicked', lambda _: GLib.timeout_add(150, ready))
box.pack_start(load, False, False, 0)
def private(_):
    entry.set_visibility(False)
    entry.set_text('fixture-private-value')
    entry.get_accessible().set_name('Password')
secret = Gtk.Button(label='Private')
secret.connect('clicked', private)
box.pack_start(secret, False, False, 0)
window.show_all()
Gtk.main()
`), 0600); err != nil {
		t.Fatalf("%#v", err)
	}
	process := exec.CommandContext(ctx, "/usr/bin/python3", fixture)
	process.Env = e.environment
	process.Stderr = os.Stderr
	if err := process.Start(); err != nil {
		t.Fatalf("%#v", err)
	}
	defer func() { _ = process.Process.Kill(); _ = process.Wait() }()
	if _, err := e.atspi.wait(ctx, map[string]any{"role": "button", "name": "Apply"}, map[string]any{"timeout_ms": float64(10000)}); err != nil {
		observed, observeErr := e.atspi.observe(ctx, nil)
		t.Fatalf("wait: %v; observed: %+v; observation error: %v", err, observed, observeErr)
	}
	call := func(tool string, args map[string]any) (TargetToolResult, error) {
		body, _ := json.Marshal(args)
		return e.ExecuteTargetTool(ctx, TargetToolCall{TargetID: "xvfb-main", ToolName: tool, Arguments: body, scriptOperation: true})
	}
	observed, err := call("computer.observe", nil)
	if err != nil || len(observed.Attachments) != 0 {
		t.Fatalf("observation: %+v %v", observed, err)
	}
	payload := observed.Result.(map[string]any)["observation"].(map[string]any)
	var inputRef string
	for _, node := range payload["nodes"].([]map[string]any) {
		if node["name"] == "Query" {
			inputRef = node["ref"].(string)
		}
	}
	if inputRef == "" {
		t.Fatalf("query field missing: %+v", payload)
	}
	filled, err := call("computer.action", map[string]any{"action": "fill", "selector": map[string]any{"ref": inputRef}, "text": "Completed"})
	if err != nil || len(filled.Attachments) != 0 {
		t.Fatalf("fill: %+v %v", filled, err)
	}
	read, err := call("computer.action", map[string]any{"action": "read", "selector": map[string]any{"role": "text", "name": "Query"}})
	if err != nil || read.Result.(map[string]any)["node"].(map[string]any)["value"] != "Completed" {
		t.Fatalf("read: %+v %v", read, err)
	}
	if _, err := call("computer.action", map[string]any{"action": "click", "selector": map[string]any{"role": "button", "name": "Duplicate"}}); err == nil {
		t.Fatal("ambiguous button was clicked")
	}
	if _, err := call("computer.action", map[string]any{"action": "click", "selector": map[string]any{"role": "button", "name": "Load"}}); err != nil {
		t.Fatalf("%#v", err)
	}
	if _, err := call("computer.action", map[string]any{"action": "wait", "selector": map[string]any{"role": "button", "name": "Ready"}, "timeout_ms": float64(3000)}); err != nil {
		t.Fatalf("%#v", err)
	}
	if _, err := call("computer.action", map[string]any{"action": "read", "selector": map[string]any{"ref": inputRef}}); err == nil {
		t.Fatal("reference to a destroyed control survived replacement")
	}
	if _, err := call("computer.action", map[string]any{"action": "click", "selector": map[string]any{"role": "button", "name": "Private"}}); err != nil {
		t.Fatalf("%#v", err)
	}
	private, err := call("computer.observe", map[string]any{"screenshot": true})
	if err != nil || private.Safety == nil || private.Safety.Level != "takeover" || len(private.Attachments) != 0 {
		t.Fatalf("private screen leaked: %+v %v", private, err)
	}
	body, _ := json.Marshal(private)
	if strings.Contains(string(body), "fixture-private-value") {
		t.Fatal("private value entered the result")
	}
}
