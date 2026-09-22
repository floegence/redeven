package hostapps

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/portforward"
	"github.com/floegence/redeven/internal/portforward/registry"
)

func TestManagedSetupAdapterDoesNotDownloadOnRead(t *testing.T) {
	m := New(t.TempDir(), t.TempDir(), nil)
	defer m.Close()
	status, err := m.SetupStatus("alice")
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "linux" {
		if status.State != "unsupported" {
			t.Fatal(status)
		}
		return
	}
	if status.State != "available" || status.Package == nil || status.ReceivedBytes != 0 {
		t.Fatal(status)
	}
	if _, err = m.StartSetup("alice", "request", "upload", status.Package.SizeBytes+1000); err != nil {
		t.Fatal(err)
	}
	s, err := m.SetupStatus("bob")
	if err != nil || s.CanCancel {
		t.Fatal(s, err)
	}
	if _, err = m.CancelSetup("bob", s.OperationID); err == nil {
		t.Fatal("foreign cancellation accepted")
	}
	if _, err = m.CancelSetup("alice", s.OperationID); err != nil {
		t.Fatal(err)
	}
}

// Opt-in acceptance exercises the released installer and a real host application.
// The bundle contains only original catalog archives; the product verifies it.
func TestManagedPreparationAndHostApplication(t *testing.T) {
	bundle := os.Getenv("REDEVEN_TEST_NATIVE_BUNDLE")
	if bundle == "" {
		t.Skip("requires a pinned native component ZIP and host Python GTK")
	}
	if runtime.GOOS != "linux" {
		t.Fatal("Linux qualification required")
	}
	state := t.TempDir()
	reg, err := registry.Open(filepath.Join(state, "forwards.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	forwards, err := portforward.New(reg)
	if err != nil {
		t.Fatal(err)
	}
	defer forwards.Close()
	m := New(state, state, forwards)
	defer m.Close()
	file, err := os.Open(bundle)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	status, err := m.StartSetup("alice", "acceptance", "upload", info.Size())
	if err != nil {
		t.Fatal(err)
	}
	chunk := make([]byte, 256<<10)
	for offset := int64(0); offset < info.Size(); {
		n, err := file.Read(chunk)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = m.WriteSetup("alice", status.OperationID, offset, chunk[:n]); err != nil {
			t.Fatal(err)
		}
		offset += int64(n)
	}
	if _, err = m.CompleteSetup("alice", status.OperationID); err != nil {
		t.Fatal(err)
	}
	changes, stop, err := m.WatchSetup()
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	timeout := time.NewTimer(90 * time.Second)
	defer timeout.Stop()
ready:
	for {
		select {
		case <-changes:
			status, err = m.SetupStatus("alice")
			if err != nil {
				t.Fatal(err)
			}
			if status.State == "ready" {
				break ready
			}
			if !status.Active() {
				t.Fatal(status)
			}
		case <-timeout.C:
			t.Fatal("preparation timed out")
		}
	}
	receipt := filepath.Join(state, "host-environment.json")
	fixture := filepath.Join(state, "application.py")
	source := `import os,json,gi
from pathlib import Path
gi.require_version("Gtk","3.0")
from gi.repository import Gtk
Path(` + quotePython(receipt) + `).write_text(json.dumps(dict(os.environ)))
w=Gtk.Window(title="Redeven managed application acceptance")
w.add(Gtk.Label(label="This application runs with the host Python"))
w.set_default_size(480,240)
w.connect("destroy",Gtk.main_quit)
w.show_all()
Gtk.main()
`
	if err = os.WriteFile(fixture, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	if err = m.Add(context.Background(), AddRequest{Name: "Native acceptance", Executable: "/usr/bin/python3", Arguments: quoteArgv([]string{fixture})}); err != nil {
		t.Fatal(err)
	}
	catalog, err := m.Catalog(context.Background(), "alice", "en-US")
	if err != nil || !catalog.Availability.Ready {
		t.Fatal(catalog.Availability, err)
	}
	appID := ""
	for _, app := range catalog.Applications {
		if app.Name == "Native acceptance" {
			appID = app.ID
		}
	}
	if appID == "" {
		t.Fatal("host application absent")
	}
	req := LaunchRequest{ApplicationID: appID, Locale: "en-US", Presentation: Presentation{Locale: "en-US", Starting: "Starting", Failed: "Failed", Ended: "Ended", Retry: "Retry", Connecting: "Connecting", Reconnecting: "Reconnecting", Disconnected: "Disconnected", ConnectionHint: "Reconnect", Reconnect: "Reconnect"}}
	started := time.Now()
	session, err := m.Launch(context.Background(), "alice", req)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(45 * time.Second)
	for {
		sessions := m.Sessions("alice")
		if len(sessions) != 1 {
			t.Fatal(sessions)
		}
		current := sessions[0]
		if current.State == "running" {
			t.Logf("managed application launch to window readiness: %d ms", time.Since(started).Milliseconds())
			break
		}
		if time.Now().After(deadline) || current.State == "failed" || current.State == "ended" {
			log, _ := os.ReadFile(filepath.Join(m.state, "sessions", session.ID, "session.log"))
			t.Fatalf("host launch: %+v\n%s", current, log)
		}
		time.Sleep(100 * time.Millisecond)
	}
	assertResponsiveWindowInventory(t, m.sessions[session.ID])
	var environment map[string]string
	data, err := os.ReadFile(receipt)
	if err != nil || json.Unmarshal(data, &environment) != nil {
		t.Fatal("missing host receipt", err)
	}
	for _, key := range []string{"PYTHONHOME", "PYTHONPATH", "GI_TYPELIB_PATH", "LD_LIBRARY_PATH", "FLOE_NATIVE_ROOT", "FLOE_NATIVE_APPLICATION_ENV"} {
		if environment[key] != os.Getenv(key) {
			t.Fatalf("support environment leaked into host application: %s", key)
		}
	}
	if environment["DISPLAY"] == "" || environment["DBUS_SESSION_BUS_ADDRESS"] == "" {
		t.Fatalf("private graphical session missing: DISPLAY=%q DBUS_SESSION_BUS_ADDRESS=%q", environment["DISPLAY"], environment["DBUS_SESSION_BUS_ADDRESS"])
	}
	again, err := m.Launch(context.Background(), "alice", req)
	if err != nil || again.ID != session.ID {
		t.Fatal("resume changed session", err)
	}
	if err = m.Stop(context.Background(), "alice", session.ID); err != nil {
		t.Fatal(err)
	}
}
func quotePython(value string) string { data, _ := json.Marshal(value); return string(data) }
