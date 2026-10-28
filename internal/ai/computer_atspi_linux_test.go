package ai

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
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

func TestATSPIWaitDuringObjectReplacement(t *testing.T) {
	if os.Getenv("REDEVEN_XVFB_INTEGRATION") != "1" {
		t.Skip("set REDEVEN_XVFB_INTEGRATION=1 in the Linux qualification image")
	}
	e := NewXvfbTargetExecutor(t.TempDir())
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	if err := e.EnsureTargetReady(ctx, "xvfb-main"); err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	c := e.atspi
	bus := c.connection.Names()[0]
	root := atspiObject{bus, "/fixture/root"}
	transient := atspiObject{bus, "/fixture/transient"}
	ready := atspiObject{bus, "/fixture/ready"}
	c.root = root
	for _, phase := range []string{"tree", "selected_state"} {
		for _, state := range []string{"visible", "enabled", "hidden", "bus_failure"} {
			t.Run(phase+"/"+state, func(t *testing.T) {
				var replaced atomic.Bool
				var reads atomic.Int32
				for _, object := range []atspiObject{root, transient, ready} {
					role, name := "panel", ""
					if object == ready {
						role, name = "button", "Ready"
					}
					methods := map[string]interface{}{
						"GetRoleName":   func() (string, *dbus.Error) { return role, nil },
						"GetInterfaces": func() ([]string, *dbus.Error) { return nil, nil },
						"GetChildren": func() ([]atspiObject, *dbus.Error) {
							if object != root {
								return nil, nil
							}
							if phase == "tree" && !replaced.Load() {
								return []atspiObject{transient, ready}, nil
							}
							return []atspiObject{ready}, nil
						},
						"GetState": func() ([]uint32, *dbus.Error) {
							invalidate := phase == "tree" && object == transient
							if phase == "selected_state" && object == ready {
								invalidate = reads.Add(1) == 2
							}
							if invalidate && replaced.CompareAndSwap(false, true) {
								if state == "bus_failure" {
									return nil, dbus.NewError("org.freedesktop.DBus.Error.Failed", []interface{}{"fixture bus failure"})
								}
								if err := c.connection.Emit(root.Path, "org.a11y.atspi.Event.Object.ChildrenChanged", "remove"); err != nil {
									return nil, dbus.MakeFailedError(err)
								}
								return nil, dbus.NewError("org.freedesktop.DBus.Error.UnknownObject", []interface{}{"fixture object was replaced"})
							}
							return []uint32{1<<8 | 1<<25 | 1<<30, 0}, nil
						},
					}
					if err := c.connection.ExportMethodTable(methods, object.Path, atspiAccessible); err != nil {
						t.Fatal(err)
					}
					if err := c.connection.ExportMethodTable(map[string]interface{}{
						"Get": func(string, string) (dbus.Variant, *dbus.Error) { return dbus.MakeVariant(name), nil },
					}, object.Path, "org.freedesktop.DBus.Properties"); err != nil {
						t.Fatal(err)
					}
				}
				requested := state
				if state == "bus_failure" {
					requested = "visible"
				}
				result, err := c.wait(ctx, map[string]any{"role": "button", "name": "Ready"}, map[string]any{"state": requested, "timeout_ms": float64(300)})
				if state == "bus_failure" {
					if failure, ok := err.(dbus.Error); !ok || failure.Name != "org.freedesktop.DBus.Error.Failed" {
						t.Fatalf("bus failure was not preserved: result=%+v, err=%v", result, err)
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				want := state
				if state == "hidden" {
					want = "timeout"
				}
				if !replaced.Load() || result["state"] != want {
					t.Fatalf("replacement=%v, result=%+v; want %s", replaced.Load(), result, want)
				}
			})
		}
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
entry.get_accessible().set_description('Enter the search query')
box.pack_start(entry, False, False, 0)
box.pack_start(Gtk.Label(label='CAPTCHA documentation; one-time verification code; authenticator'), False, False, 0)
result = Gtk.Label(label='Empty')
result.get_accessible().set_name('Result')
box.pack_start(result, False, False, 0)
apply = Gtk.Button(label='Apply')
apply.connect('clicked', lambda _: result.set_text(entry.get_text()))
box.pack_start(apply, False, False, 0)
choice = Gtk.CheckButton(label='Include archived')
choice.set_inconsistent(True)
choice.set_sensitive(False)
box.pack_start(choice, False, False, 0)
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
	normalized, err := normalizeComputerObservation(payload)
	if err != nil {
		t.Fatalf("native tree normalization: %v", err)
	}
	if normalized["semantic_schema_version"] != float64(2) || len(normalized["roots"].([]any)) == 0 {
		t.Fatal("native tree roots missing")
	}
	var mixedFound, descriptionFound bool
	for _, raw := range normalized["nodes"].([]any) {
		node := raw.(map[string]any)
		if node["name"] == "Query" {
			descriptionFound = node["description"] == "Enter the search query" && node["canonical_role"] == "textbox"
		}
		if node["name"] == "Include archived" {
			states := node["states"].(map[string]any)
			mixedFound = node["canonical_role"] == "checkbox" && states["checked"] == "mixed" && states["disabled"] == true
		}
	}
	if !mixedFound || !descriptionFound {
		t.Fatal("native mixed state or description missing")
	}

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

func TestATSPIFieldIntegrityAndFullNameIdentity(t *testing.T) {
	if os.Getenv("REDEVEN_XVFB_INTEGRATION") != "1" {
		t.Skip("requires isolated Linux qualification image")
	}
	e := NewXvfbTargetExecutor(t.TempDir())
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	if err := e.EnsureTargetReady(ctx, "xvfb-main"); err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	c := e.atspi
	object := atspiObject{c.connection.Names()[0], "/fixture/integrity"}
	c.root = object
	var current atomic.Value
	current.Store("")
	for iface, methods := range map[string]map[string]interface{}{
		atspiAccessible: {
			"GetRoleName":   func() (string, *dbus.Error) { return "button", nil },
			"GetInterfaces": func() ([]string, *dbus.Error) { return []string{"org.a11y.atspi.Text"}, nil },
			"GetChildren":   func() ([]atspiObject, *dbus.Error) { return nil, nil },
			"GetState":      func() ([]uint32, *dbus.Error) { return []uint32{1<<8 | 1<<25 | 1<<30, 0}, nil },
		},
		"org.freedesktop.DBus.Properties": {
			"Get": func(_ string, property string) (dbus.Variant, *dbus.Error) {
				full := current.Load().(string)
				if property == "CharacterCount" {
					return dbus.MakeVariant(int32(len([]rune(full)))), nil
				}
				return dbus.MakeVariant(full), nil
			},
		},
		"org.a11y.atspi.Text": {
			"GetText": func(start, end int32) (string, *dbus.Error) {
				return string([]rune(current.Load().(string))[start:end]), nil
			},
		},
	} {
		if err := c.connection.ExportMethodTable(methods, object.Path, iface); err != nil {
			t.Fatal(err)
		}
	}
	for _, character := range []string{"x", "中", "🙂"} {
		for _, length := range []int{1999, 2000, 2100} {
			full := strings.Repeat(character, length)
			current.Store(full)
			node, err := c.describe(ctx, object)
			if err != nil {
				t.Fatal(err)
			}
			for _, field := range []string{"name", "description", "value"} {
				if node[field] != strings.Repeat(character, min(length, 2000)) || (node[field+"_truncated"] == true) != (length > 2000) {
					t.Fatalf("incorrect %s budget at %d", field, length)
				}
			}
			if _, err := c.resolve(ctx, map[string]any{"ref": node["ref"]}); err != nil {
				t.Fatal(err)
			}
			if _, err := c.resolve(ctx, map[string]any{"role": "button", "name": full, "exact": true}); err != nil {
				t.Fatal(err)
			}
			if length > 2000 {
				if _, err := c.resolve(ctx, map[string]any{"role": "button", "name": node["name"], "exact": true}); err == nil || err.Error() != "ELEMENT_NOT_FOUND" {
					t.Fatalf("prefix matched full name: %v", err)
				}
				current.Store(full + "changed")
				if _, err := c.describe(ctx, object); err != nil {
					t.Fatal(err)
				}
				if _, err := c.resolve(ctx, map[string]any{"ref": node["ref"]}); err == nil || err.Error() != "STALE_REFERENCE" {
					t.Fatalf("accepted changed tail: %v", err)
				}
			}
		}
	}
}
