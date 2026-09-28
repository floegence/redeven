//go:build linux

package hostapps

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// A genuine installed desktop entry retains its package metadata. Only the
// task's explicit arguments and document/profile change; the product planner
// still validates the installed package and performs the normal launch.
func TestInstalledPackageViewer(t *testing.T) {
	root, entry := os.Getenv("REDEVEN_TEST_CLIENT_INPUT_EVIDENCE"), os.Getenv("REDEVEN_TEST_PACKAGE_ENTRY")
	if root == "" || entry == "" {
		t.Skip("requires an isolated package fixture and browser driver")
	}
	if !filepath.IsAbs(root) || !filepath.IsAbs(entry) {
		t.Fatal("absolute fixture paths required")
	}
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(root, "state")
	if err := os.Mkdir(state, 0700); err != nil {
		t.Fatal(err)
	}
	m := installedLifecycleManager(t, state)
	if err := m.prepare(); err != nil {
		t.Fatal(err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	parent := filepath.Join(home, "Downloads")
	if os.Getenv("REDEVEN_TEST_PACKAGE_KIND") == "snap-firefox" {
		parent = filepath.Join(home, "snap/firefox/common")
	}
	if err := os.MkdirAll(parent, 0700); err != nil {
		t.Fatal(err)
	}
	documents, err := os.MkdirTemp(parent, "redeven-package-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(documents)
	document := filepath.Join(documents, "document.txt")
	defer func() {
		if data, err := os.ReadFile(document); err == nil {
			_ = os.WriteFile(filepath.Join(root, "saved-document.txt"), data, 0600)
		}
	}()
	if err := os.WriteFile(document, nil, 0600); err != nil {
		t.Fatal(err)
	}
	kind, command := "package-editor", strings.ReplaceAll(os.Getenv("REDEVEN_TEST_PACKAGE_COMMAND"), "{document}", document)
	var lock sync.Mutex
	if os.Getenv("REDEVEN_TEST_PACKAGE_KIND") == "snap-firefox" {
		kind = "firefox"
		profile := filepath.Join(documents, "profile")
		if err := os.Mkdir(profile, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(profile, "user.js"), []byte(`user_pref("browser.shell.checkDefaultBrowser",false);
user_pref("browser.aboutwelcome.enabled",false);
user_pref("termsofuse.bypassNotification",true);
user_pref("datareporting.healthreport.uploadEnabled",false);
user_pref("browser.startup.homepage_override.mstone","ignore");
`), 0600); err != nil {
			t.Fatal(err)
		}
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == "POST" && r.URL.Path == "/receipt" {
				body, err := io.ReadAll(io.LimitReader(r.Body, 65537))
				var values []string
				if err != nil || len(body) > 65536 || json.Unmarshal(body, &values) != nil || len(values) != 2 {
					http.Error(w, "invalid receipt", 400)
					return
				}
				lock.Lock()
				defer lock.Unlock()
				if err := os.WriteFile(filepath.Join(root, "receipt.tmp"), body, 0600); err != nil {
					http.Error(w, "receipt unavailable", 500)
					return
				}
				if err := os.Rename(filepath.Join(root, "receipt.tmp"), filepath.Join(root, "receipt.json")); err != nil {
					http.Error(w, "receipt unavailable", 500)
					return
				}
				w.WriteHeader(204)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, `<!doctype html><title>Redeven package input acceptance</title><style>body{margin:0;height:100vh;display:flex;flex-direction:column}textarea{flex:1;min-height:0;font:24px sans-serif;resize:none}</style><textarea autofocus></textarea><textarea></textarea><script>const fields=[...document.querySelectorAll('textarea')];let pending=Promise.resolve();const save=()=>{const body=JSON.stringify(fields.map(f=>f.value));pending=pending.then(()=>fetch('/receipt',{method:'POST',body}));};fields.forEach(f=>f.addEventListener('input',save));save();</script>`)
		}))
		defer server.Close()
		command = "/snap/bin/firefox --no-remote --profile " + profile + " --new-window " + server.URL
	}
	if command == "" {
		t.Fatal("explicit isolated package command required")
	}
	_, tools := m.tools(context.Background())
	prepared := filepath.Join(m.custom, "package.desktop")
	code := `import sys
from gi.repository import GLib
k=GLib.KeyFile();k.load_from_file(sys.argv[1],GLib.KeyFileFlags.NONE)
k.set_string('Desktop Entry','Exec',sys.argv[3]);k.set_boolean('Desktop Entry','DBusActivatable',False)
open(sys.argv[2],'w').write(k.to_data()[0])`
	prepare := exec.Command(tools.python, "-c", code, entry, prepared, command)
	prepare.Env = tools.environment(os.Environ())
	if output, err := prepare.CombinedOutput(); err != nil {
		t.Fatalf("prepare task entry: %v %s", err, output)
	}
	if err := os.Chmod(prepared, 0600); err != nil {
		t.Fatal(err)
	}
	appID := "custom:package.desktop"
	view, err := m.Launch(context.Background(), "fixture", LaunchRequest{ApplicationID: appID, Locale: "en-US", Presentation: Presentation{Locale: "en-US", Starting: "Starting", Failed: "Failed", Ended: "Ended", Retry: "Retry", Connecting: "Connecting", Reconnecting: "Reconnecting", Disconnected: "Disconnected", ConnectionHint: "Reconnect", Reconnect: "Reconnect"}})
	if err != nil {
		t.Fatal(err)
	}
	a := m.sessions[view.ID].application
	defer func() {
		if a.record.Process.Alive() {
			if err := m.Terminate(context.Background(), "fixture", QuitRequest{ApplicationID: appID, Instances: []string{a.record.ID}}); err != nil {
				t.Error(err)
			}
			waitUntil(t, func() bool { return !a.record.Process.Alive() }, 10*time.Second)
		}
	}()
	waitUntil(t, func() bool {
		for _, s := range m.Sessions("fixture") {
			if s.ID == view.ID {
				if s.State == "failed" {
					t.Fatalf("package launch failed: %+v", s)
				}
				return s.State == "running"
			}
		}
		return false
	}, 45*time.Second)
	publishClientInputFixture(t, m, view, root, state, kind, nil)
	data, err := os.ReadFile(filepath.Join(root, "connection.json"))
	if err != nil {
		t.Fatal(err)
	}
	var metadata map[string]any
	if err := json.Unmarshal(data, &metadata); err != nil {
		t.Fatal(err)
	}
	metadata["document"], metadata["desktop_entry"] = document, entry
	newline := os.Getenv("REDEVEN_TEST_SAVE_NEWLINE")
	if newline != "" && newline != "append" && newline != "ensure" {
		t.Fatal("unsupported fixture newline policy")
	}
	metadata["save_newline"] = newline
	data, _ = json.Marshal(metadata)
	if err := os.WriteFile(filepath.Join(root, "connection.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("package viewer ready: pid=%d kind=%s evidence=%s", a.record.Process.PID, kind, root)
	waitUntil(t, func() bool { _, err := os.Stat(filepath.Join(root, "done.json")); return err == nil }, 180*time.Second)
	done, err := os.ReadFile(filepath.Join(root, "done.json"))
	if err != nil {
		t.Fatal(err)
	}
	if kind == "package-editor" {
		var receipt struct {
			Document string `json:"document"`
		}
		if json.Unmarshal(done, &receipt) != nil || receipt.Document == "" {
			t.Fatal("missing save receipt")
		}
		actual, err := os.ReadFile(document)
		if err != nil || string(actual) != receipt.Document {
			t.Fatal("saved bytes do not match browser operations")
		}
		if err := os.WriteFile(filepath.Join(root, "saved-document.txt"), actual, 0600); err != nil {
			t.Fatal(err)
		}
	} else {
		var expected, actual []string
		received, err := os.ReadFile(filepath.Join(root, "receipt.json"))
		if err != nil || json.Unmarshal(done, &expected) != nil || json.Unmarshal(received, &actual) != nil || len(expected) != 2 || len(actual) != 2 || expected[0] != actual[0] || expected[1] != actual[1] {
			t.Fatal("package did not receive exact browser text")
		}
	}
}
