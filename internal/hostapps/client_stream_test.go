//go:build linux

package hostapps

import (
	"context"
	_ "embed"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

//go:embed testdata/client_stream.html
var clientStreamHTML string

// The browser driver owns measurement; this fixture uses the real product
// inventory, profile selection, launch, transport, and explicit termination.
func TestInstalledClientStreamViewer(t *testing.T) {
	root := os.Getenv("REDEVEN_TEST_CLIENT_STREAM_EVIDENCE")
	if root == "" {
		t.Skip("requires an isolated Linux component installation and browser driver")
	}
	if !filepath.IsAbs(root) {
		t.Fatal("absolute fixture directory required")
	}
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(root, "state")
	if err := os.Mkdir(state, 0700); err != nil {
		t.Fatal(err)
	}
	m := installedLifecycleManager(t, state)
	browser := os.Getenv("REDEVEN_TEST_CLIENT_STREAM_TARGET")
	executable := map[string]string{"chrome": "/usr/bin/google-chrome-stable", "firefox": "/usr/bin/firefox"}[browser]
	if executable == "" {
		t.Fatal("choose chrome or firefox")
	}
	document := filepath.Join(root, "document.html")
	if err := os.WriteFile(document, []byte(clientStreamHTML), 0600); err != nil {
		t.Fatal(err)
	}
	arguments := []string{"file://" + document}
	if browser == "chrome" {
		arguments = []string{"--app=file://" + document, "--window-size=1280,720"}
	}
	ctx := context.Background()
	if err := m.Add(ctx, AddRequest{Name: "Remote application performance", Executable: executable, Arguments: quoteArgv(arguments)}); err != nil {
		t.Fatal(err)
	}
	catalog, err := m.Catalog(ctx, "fixture", "en-US")
	if err != nil || !catalog.Availability.Ready {
		t.Fatal("native component unavailable", err)
	}
	var appID string
	for _, app := range catalog.Applications {
		if app.Custom && app.Name == "Remote application performance" {
			appID = app.ID
		}
	}
	if appID == "" {
		t.Fatal("fixture entry missing")
	}
	profile, err := m.browserProfileDirectory("fixture", appID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(profile, 0700); err != nil {
		t.Fatal(err)
	}
	if browser == "firefox" {
		// Fixture-only welcome suppression does not alter product browser policy.
		preferences := `user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("termsofuse.bypassNotification", true);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
`
		if err := os.WriteFile(filepath.Join(profile, "user.js"), []byte(preferences), 0600); err != nil {
			t.Fatal(err)
		}
	}
	session, err := m.Launch(ctx, "fixture", LaunchRequest{ApplicationID: appID, Locale: "en-US", Presentation: Presentation{Locale: "en-US", Starting: "Starting", Failed: "Failed", Ended: "Ended", Retry: "Retry", Connecting: "Connecting", Reconnecting: "Reconnecting", Disconnected: "Disconnected", ConnectionHint: "Reconnect", Reconnect: "Reconnect"}})
	if err != nil {
		t.Fatal(err)
	}
	app := m.sessions[session.ID].application
	t.Cleanup(func() {
		if app.record.Process.Alive() {
			if err := m.Terminate(ctx, "fixture", QuitRequest{ApplicationID: appID, Instances: []string{app.record.ID}}); err != nil {
				t.Error(err)
			}
			waitUntil(t, func() bool { return !app.record.Process.Alive() }, 10*time.Second)
		}
	})
	waitUntil(t, func() bool { return m.Sessions("fixture")[0].State == "running" }, 45*time.Second)
	publishClientInputFixture(t, m, session, root, state, "stream-"+browser, nil)
	t.Logf("stream fixture ready: helper_pid=%d state=%s", app.record.Process.PID, state)
	waitUntil(t, func() bool { _, err := os.Stat(filepath.Join(root, "done.json")); return err == nil }, 300*time.Second)
	var done struct {
		Passed bool `json:"passed"`
	}
	data, err := os.ReadFile(filepath.Join(root, "done.json"))
	if err != nil || json.Unmarshal(data, &done) != nil || !done.Passed {
		t.Fatal("browser performance acceptance failed")
	}
	if !app.record.Process.Alive() {
		t.Fatal("quality changes replaced or stopped the application")
	}
}
