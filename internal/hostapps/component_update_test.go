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
)

func TestApplicationComponentRecordValidation(t *testing.T) {
	r := linuxApplicationRecord{Version: 2, Component: strings.Repeat("a", 64), ID: strings.Repeat("b", 64), Owner: "owner", Application: Application{ID: "fixture.desktop"}, Address: "127.0.0.1:43210", Process: nativeapps.ProcessIdentity{PID: 123, Boot: "boot", Started: "123"}, StartedAt: 1}
	for _, component := range []string{r.Component, "system", "", "../escape", "future"} {
		r.Component = component
		data, _ := json.Marshal(r)
		_, err := decodeApplicationRecord(data, r.ID)
		if (err == nil) != (component == "system" || component == strings.Repeat("a", 64)) {
			t.Fatalf("component identity %q: %v", component, err)
		}
	}
}

// Qualification operates only on a caller-provided disposable r1 state. The
// application data, sessions and forwards are independently owned by this test.
func TestInstalledComponentUpdatePreservesApplications(t *testing.T) {
	components := os.Getenv("REDEVEN_TEST_LEGACY_COMPONENT_STATE")
	if runtime.GOOS != "linux" || components == "" {
		t.Skip("requires a disposable published r1 component state")
	}
	ctx := context.Background()
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
	newManager := func() *Manager {
		m := New(state, state, forwards)
		pkg, err := nativeapps.DesktopForPlatform(runtime.GOOS, runtime.GOARCH)
		if err != nil {
			t.Fatal(err)
		}
		m.setup, err = nativeapps.New(components, pkg, nil)
		if err != nil {
			t.Fatal(err)
		}
		return m
	}
	m := newManager()
	defer func() { _ = m.Close() }()
	status, err := m.SetupStatus("owner")
	if err != nil || status.Installed == nil || !status.Installed.Ready || !status.UpdateAvailable {
		t.Fatal(status, err)
	}
	oldDigest := status.Installed.Digest
	lookupStart := time.Now()
	for range 50 {
		availability, tools := m.installedTools(ctx)
		if !availability.Ready || tools.componentDigest != oldDigest {
			t.Fatal("compatible installation is unavailable before any update")
		}
	}
	t.Logf("compatible component selection averages %s; test Runtime PID %d, isolated state %s", time.Since(lookupStart)/50, os.Getpid(), state)
	fixture := filepath.Join(state, "application.py")
	if err := os.WriteFile(fixture, []byte(`import gi,os,pathlib,sys
gi.require_version("Gtk","3.0")
from gi.repository import Gtk
pathlib.Path(sys.argv[1]).write_text(str(os.getpid()))
w=Gtk.Window(title="Component update acceptance")
w.set_default_size(480,320)
w.add(Gtk.Label(label="Keep this application alive during the component update"))
w.connect("destroy",Gtk.main_quit)
w.show_all()
Gtk.main()
`), 0600); err != nil {
		t.Fatal(err)
	}
	presentation := Presentation{Starting: "Starting", Failed: "Failed", Ended: "Ended", Retry: "Retry", Connecting: "Connecting", Reconnecting: "Reconnecting", Disconnected: "Disconnected", ConnectionHint: "Reconnect", Reconnect: "Reconnect", Locale: "en-US"}
	var apps []*linuxApplication
	defer func() {
		for _, a := range apps {
			if a.record.Process.Alive() {
				if err := m.Terminate(ctx, "owner", QuitRequest{ApplicationID: a.record.Application.ID, Instances: []string{a.record.ID}}); err != nil {
					t.Error("terminate owned component fixture:", err)
					continue
				}
				// Keep the receipt directory alive until the helper finishes its
				// asynchronous graphical-service cleanup after application exit.
				waitUntil(t, func() bool { return !a.record.Process.Alive() }, 10*time.Second)
			}
		}
	}()
	launch := func(name string) (Session, *linuxApplication, time.Duration) {
		_, tools := m.installedTools(ctx)
		if err := m.Add(ctx, AddRequest{Name: name, Executable: "/usr/bin/python3", Arguments: quoteArgv([]string{fixture, filepath.Join(state, name+".pid")})}); err != nil {
			t.Fatal(err)
		}
		catalog, err := m.Catalog(ctx, "owner", "en-US")
		if err != nil {
			t.Fatal(catalog.Availability, err)
		}
		id := ""
		var application Application
		for _, app := range catalog.Applications {
			if app.Name == name {
				id = app.ID
				application = app
			}
		}
		start := time.Now()
		var s Session
		if tools.desktop == nil {
			// Seed the already-running Xpra instance that a previous Runtime
			// would have left. New product launches require combined preparation.
			useXpraFixture(t, m, id)
			if err := m.ensureApplications(ctx); err != nil {
				t.Fatal(err)
			}
			available, selected := clientInputTools(ctx, Availability{Ready: true}, tools)
			if !available.Ready {
				t.Fatal(available)
			}
			plan, planErr := nativeapps.PlanApplication(ctx, nativeapps.ApplicationPlanOptions{Python: tools.python, Environment: tools.environment(os.Environ()), DesktopFile: filepath.Join(m.custom, strings.TrimPrefix(id, "custom:")), Backends: []nativeapps.BackendCapability{{ID: "xpra", Component: oldDigest, Protocols: []string{"x11"}}}})
			if planErr != nil {
				t.Fatal(planErr)
			}
			old, startErr := m.startApplication("owner", application, selected, plan)
			if startErr != nil {
				t.Fatal(startErr)
			}
			m.applications[old.record.ID] = old
		}
		s, err = m.Launch(ctx, "owner", LaunchRequest{ApplicationID: id, Locale: "en-US", Presentation: presentation})
		if err != nil {
			t.Fatal(err)
		}
		a := m.sessions[s.ID].application
		apps = append(apps, a)
		waitUntil(t, func() bool {
			for _, view := range m.Sessions("owner") {
				if view.ID == s.ID {
					return view.State == "running"
				}
			}
			return false
		}, 30*time.Second)
		assertResponsiveWindowInventory(t, m.sessions[s.ID])
		return s, a, time.Since(start)
	}
	first, old, oldTime := launch("Old components")
	identity := old.record.Process
	t.Logf("isolated backend address %s", old.record.Address)
	if old.record.Component != oldDigest {
		t.Fatal("new instance did not bind the active component")
	}
	plan, err := m.SetupPlan(ctx, "owner")
	if err != nil || plan.MissingBytes != 0 {
		t.Fatal(plan, err)
	}
	if _, err = m.StartSetup("owner", "mismatched", "cache", 0, strings.Repeat("f", 64)); err == nil {
		t.Fatal("accepted a stale component plan")
	}
	if _, err = m.StartSetup("owner", "update", "cache", 0, plan.PackageDigest); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(90 * time.Second)
	for {
		status, err = m.SetupStatus("owner")
		if err != nil {
			t.Fatal(err)
		}
		if status.State == "ready" {
			break
		}
		if !status.Active() || time.Now().After(deadline) {
			t.Fatal(status)
		}
		if !status.Installed.Ready || status.Installed.Digest != oldDigest || !identity.Alive() {
			t.Fatal("update interrupted the old application")
		}
		time.Sleep(50 * time.Millisecond)
	}
	if status.UpdateAvailable || status.Installed.Digest == oldDigest {
		t.Fatal(status)
	}
	if old.record.Process != identity || old.tools.componentDigest != oldDigest || !identity.Alive() {
		t.Fatal("update rebound a live backend")
	}
	if _, err := m.applicationCommand(ctx, old, "info"); err != nil {
		t.Fatal("old backend lost control after update", err)
	}
	// Simulate the last published product record, then recover it with the new
	// component selected. Kernel evidence must recover r1, not the new default.
	old.record.Version = 1
	old.record.Component = ""
	old.record.Backend = ""
	if err := m.writeApplication(old); err != nil {
		t.Fatal(err)
	}
	if err := m.Close(); err != nil {
		t.Fatal(err)
	}
	m = newManager()
	running, err := m.Running(ctx, "owner")
	if err != nil || len(running) != 1 {
		t.Fatal(running, err)
	}
	recovered := m.applications[old.record.ID]
	if recovered == nil || recovered.record.Version != 3 || recovered.record.Backend != "xpra" || recovered.record.Component != oldDigest || recovered.tools.componentDigest != oldDigest || recovered.record.Process != identity {
		t.Fatal("legacy recovery used the new component")
	}
	apps[0] = recovered
	resumed, err := m.Launch(ctx, "owner", LaunchRequest{ApplicationID: old.record.Application.ID, Locale: "en-US", Presentation: presentation})
	if err != nil || resumed.ID == first.ID || m.sessions[resumed.ID].application != recovered {
		t.Fatal("did not resume the surviving application", err)
	}
	_, fresh, newTime := launch("New components")
	if fresh.record.Backend != "wayland" || fresh.record.Component != status.Installed.Digest || fresh.tools.componentDigest == oldDigest {
		t.Fatal("fresh application did not use the update")
	}
	t.Logf("same backend PID %d survived component update and Runtime restart; old/new launch to window: %s / %s", identity.PID, oldTime, newTime)
}
