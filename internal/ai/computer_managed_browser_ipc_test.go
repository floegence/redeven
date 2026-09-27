package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/floegence/redeven/internal/browserinstall"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestManagedBrowserIPCFixture(t *testing.T) {
	if os.Getenv("REDEVEN_MANAGED_IPC_FIXTURE") != "1" {
		return
	}
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var request struct{ ID string }
		if json.Unmarshal(scanner.Bytes(), &request) != nil {
			os.Exit(2)
		}
		if request.ID == "1" {
			time.Sleep(100 * time.Millisecond)
		}
		fmt.Printf("{\"id\":%q,\"tabs\":[{\"id\":%q}]}\n", request.ID, request.ID)
	}
	os.Exit(0)
}

func TestManagedBrowserRequestCancellationPreservesProcessAndResponseOrder(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=^TestManagedBrowserIPCFixture$")
	cmd.Env = append(os.Environ(), "REDEVEN_MANAGED_IPC_FIXTURE=1")
	input, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	p := &managedBrowserProfile{cmd: cmd, input: input, reader: bufio.NewReader(output), done: make(chan struct{})}
	go func() { _ = cmd.Wait(); close(p.done) }()
	t.Cleanup(p.close)
	ctx, cancel := context.WithTimeout(t.Context(), 25*time.Millisecond)
	defer cancel()
	if _, err := p.call(ctx, "inventory"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("request result: %v", err)
	}
	if p.stopped() {
		t.Fatal("request cancellation retired the shared browser")
	}
	tabs, err := p.call(t.Context(), "inventory")
	if err != nil || len(tabs) != 1 || tabs[0].ID != "2" {
		t.Fatalf("late response was not isolated: %+v %v", tabs, err)
	}
	if p.stopped() {
		t.Fatal("late response retired the shared browser")
	}
}

func TestManagedBrowserFailureOwnershipBeginsAfterHandshake(t *testing.T) {
	for _, established := range []bool{false, true} {
		t.Run(fmt.Sprint(established), func(t *testing.T) {
			done := make(chan struct{})
			p := &managedBrowserProfile{done: done, input: nopBrowserInput{}}
			failures := 0
			if established && !p.establish(func() { failures++ }) {
				t.Fatal("live profile rejected handshake")
			}
			close(done)
			p.fault()
			p.fault()
			want := 0
			if established {
				want = 1
			}
			if failures != want {
				t.Fatalf("failure callbacks = %d, want %d", failures, want)
			}
			if p.establish(func() { failures++ }) {
				t.Fatal("retired process accepted a late handshake")
			}
		})
	}
}

type nopBrowserInput struct{}

func (nopBrowserInput) Write(p []byte) (int, error) { return len(p), nil }
func (nopBrowserInput) Close() error                { return nil }

func TestManagedBrowserConsumesStartupFailureBeforeProcessExit(t *testing.T) {
	for range 50 {
		done := make(chan struct{})
		close(done)
		p := &managedBrowserProfile{done: done, input: nopBrowserInput{}, reader: bufio.NewReader(strings.NewReader(`{"type":"ready","error":"TARGET_SETUP_REQUIRED","reason":"browser_sandbox_unavailable"}` + "\n"))}
		var ready struct{ Reason string }
		if err := p.receive(t.Context(), &ready); err != nil || ready.Reason != "browser_sandbox_unavailable" {
			t.Fatalf("startup reason lost: %+v %v", ready, err)
		}
		p.close()
	}
}

func TestManagedBrowserFastStartupFailureKeepsStructuredReasonAndService(t *testing.T) {
	root := t.TempDir()
	pkg := browserinstall.Package{ID: "fixture", SHA256: strings.Repeat("a", 64), SizeBytes: 1, Executable: "chrome"}
	installer, err := browserinstall.New(filepath.Join(root, "browser"), pkg)
	if err != nil {
		t.Fatal(err)
	}
	defer installer.Close()
	dir := installer.Snapshot().Directory
	if err = os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{".redeven-browser": pkg.SHA256, "chrome": "fixture"} {
		if err = os.WriteFile(filepath.Join(dir, name), []byte(body), 0700); err != nil {
			t.Fatal(err)
		}
	}
	helper := filepath.Join(root, "redevenManagedBrowser.mjs")
	if err = os.WriteFile(helper, []byte(`printf '%s\n' '{"type":"ready","protocol_version":2,"error":"TARGET_SETUP_REQUIRED","reason":"browser_dependency_missing"}'
exit 1
`), 0600); err != nil {
		t.Fatal(err)
	}
	r := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"browser-main": NewPlaywrightTargetExecutor("/bin/sh", filepath.Join(root, "helper.mjs"), filepath.Join(root, "profiles"))}, root)
	r.browserInstallation = installer
	t.Cleanup(func() { _ = r.Close() })
	for range 20 {
		_, err := r.managedProfileLocked(t.Context(), "browser-main")
		if BrowserErrorCode(err) != "BROWSER_DEPENDENCIES_MISSING" {
			t.Fatalf("lost startup diagnosis: %v", err)
		}
		if r.browserServiceSnapshot().State == "failed" {
			t.Fatal("installation failure retired the shared browser service")
		}
	}
}
