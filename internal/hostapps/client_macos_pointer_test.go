//go:build darwin

package hostapps

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/portforward"
	"github.com/floegence/redeven/internal/portforward/registry"
)

// Opt-in native application with a private product WebSocket and browser driver.
func TestInstalledMacPointerViewer(t *testing.T) {
	root := os.Getenv("REDEVEN_TEST_MAC_POINTER_EVIDENCE")
	if root == "" {
		t.Skip("requires a task-owned native acceptance directory")
	}
	if !filepath.IsAbs(root) {
		t.Fatal("requires absolute evidence directory")
	}
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	bundle, receipt, kind := macPointerApplication(t, root)
	reg, err := registry.Open(filepath.Join(root, "forwards.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	forwards, err := portforward.New(reg)
	if err != nil {
		t.Fatal(err)
	}
	m := New(root, root, forwards)
	t.Cleanup(func() { _ = m.Close(); _ = forwards.Close() })
	if err := m.Add(context.Background(), AddRequest{Executable: bundle}); err != nil {
		t.Fatal(err)
	}
	catalog, err := m.Catalog(context.Background(), "fixture", "en-US")
	if err != nil || !catalog.Availability.Ready {
		t.Fatalf("native input unavailable: %+v %v", catalog.Availability, err)
	}
	id := fmt.Sprintf("macos-%x", sha256.Sum256([]byte(bundle)))
	found := false
	for _, app := range catalog.Applications {
		if app.ID == id {
			found = true
		}
	}
	if !found {
		t.Fatal("task-owned native application absent from catalog")
	}
	// The browser renders the published catalog; these private launch labels
	// only satisfy the Manager presentation boundary.
	presentation := Presentation{}
	fields := reflect.ValueOf(&presentation).Elem()
	for i := 0; i < fields.NumField(); i++ {
		fields.Field(i).SetString(fields.Type().Field(i).Name)
	}
	presentation.Locale = "en-US"
	session, err := m.Launch(context.Background(), "fixture", LaunchRequest{ApplicationID: id, Presentation: presentation})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		running, _ := m.Running(context.Background(), "fixture")
		for _, app := range running {
			if app.ApplicationID == id {
				_ = m.Terminate(context.Background(), "fixture", app)
			}
		}
	})
	address, err := url.Parse(session.Forward.Forward.TargetURL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(address)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/_redeven_host_app/state" {
			for _, current := range m.Sessions("fixture") {
				if current.ID == session.ID {
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(map[string]any{"state": current.State, "error_code": current.ErrorCode, "end_reason": current.EndReason, "password": m.Password(current.ID)})
					return
				}
			}
			http.NotFound(w, r)
			return
		}
		proxy.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	metadata, _ := json.Marshal(map[string]any{"address": server.Listener.Addr().String(), "password": m.sessions[session.ID].password, "kind": kind, "backend": "macos", "receipt": receipt, "state": root})
	if err := os.WriteFile(filepath.Join(root, "connection.json"), metadata, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("owned native pointer fixture ready: address=%s state=%s", address.Host, root)
	deadline := time.Now().Add(180 * time.Second)
	for time.Now().Before(deadline) {
		if data, err := os.ReadFile(filepath.Join(root, "done.json")); err == nil {
			var result struct {
				Passed bool `json:"passed"`
			}
			if json.Unmarshal(data, &result) != nil || !result.Passed {
				t.Fatalf("pointer acceptance failed: %s", data)
			}
			var received struct {
				Clicks   int       `json:"clicks"`
				Doubles  int       `json:"doubles"`
				Rights   int       `json:"rights"`
				Releases int       `json:"releases"`
				Drag     float64   `json:"drag"`
				Inner    []float64 `json:"inner"`
			}
			data, err := os.ReadFile(receipt)
			if err != nil || json.Unmarshal(data, &received) != nil || received.Clicks != 3 || received.Doubles < 1 || received.Rights < 1 || received.Releases < 5 || received.Drag <= 30 || len(received.Inner) != 2 || received.Inner[0] <= 0 || received.Inner[1] <= 0 {
				t.Fatalf("invalid native application pointer receipt: %s", data)
			}
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("native pointer driver did not finish")
}

func macPointerApplication(t *testing.T, root string) (string, string, string) {
	t.Helper()
	if bundle := os.Getenv("REDEVEN_TEST_MAC_POINTER_BROWSER_BUNDLE"); bundle != "" {
		// Require a disposable copy, never attach this test to a personal browser.
		if !strings.HasPrefix(bundle, "/tmp/redeven-pointer-") || !strings.HasSuffix(bundle, ".app") {
			t.Fatal("browser must be a task-owned bundle copy")
		}
		receipt := filepath.Join(root, "receipt.json")
		page, err := os.ReadFile("testdata/client_pointer.html")
		if err != nil {
			t.Fatal(err)
		}
		var receiptMu sync.Mutex
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodPost {
				data, err := io.ReadAll(io.LimitReader(r.Body, 65536))
				if err != nil || !json.Valid(data) {
					http.Error(w, "invalid receipt", 400)
					return
				}
				receiptMu.Lock()
				defer receiptMu.Unlock()
				temporary := receipt + ".tmp"
				if err := os.WriteFile(temporary, data, 0600); err != nil {
					http.Error(w, "receipt failed", 500)
					return
				}
				if err := os.Rename(temporary, receipt); err != nil {
					http.Error(w, "receipt failed", 500)
					return
				}
				w.WriteHeader(204)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write(page)
		}))
		t.Cleanup(server.Close)
		process := exec.Command(filepath.Join(bundle, "Contents", "MacOS", "Google Chrome"), "--user-data-dir="+filepath.Join(root, "profile"), "--no-first-run", "--no-default-browser-check", "--force-renderer-accessibility", "--window-size=900,640", "--window-position=100,100", "--new-window", server.URL)
		log, err := os.Create(filepath.Join(root, "browser.log"))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = log.Close() })
		process.Stdout = log
		process.Stderr = log
		if err := process.Start(); err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() { done <- process.Wait() }()
		t.Cleanup(func() {
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				_ = process.Process.Kill()
				<-done
			}
		})
		deadline := time.Now().Add(20 * time.Second)
		for time.Now().Before(deadline) {
			if _, err := os.Stat(receipt); err == nil {
				return bundle, receipt, "pointer-chrome"
			}
			time.Sleep(50 * time.Millisecond)
		}
		t.Fatal("task-owned browser did not load the receipt page")
	}
	bundle := filepath.Join(root, "Pointer.app")
	contents := filepath.Join(bundle, "Contents")
	executable := filepath.Join(contents, "MacOS", "Pointer")
	if err := os.MkdirAll(filepath.Dir(executable), 0700); err != nil {
		t.Fatal(err)
	}
	plist := `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Pointer</string><key>CFBundleIdentifier</key><string>com.floegence.pointer.` + randomID() + `</string><key>CFBundleName</key><string>Pointer acceptance</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`
	if err := os.WriteFile(filepath.Join(contents, "Info.plist"), []byte(plist), 0600); err != nil {
		t.Fatal(err)
	}
	if data, err := exec.Command("swiftc", "testdata/client_pointer.swift", "-o", executable).CombinedOutput(); err != nil {
		t.Fatalf("compile native fixture: %s: %v", data, err)
	}
	return bundle, filepath.Join(bundle, "receipt.json"), "pointer-appkit"
}
