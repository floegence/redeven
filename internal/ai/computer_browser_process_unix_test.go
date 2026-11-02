//go:build darwin || linux

package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
)

func TestManagedBrowserProcessOwnsAndReapsChildren(t *testing.T) {
	root := t.TempDir()
	exe := filepath.Join(root, "browser")
	// Both shell and child ignore TERM to exercise group escalation.
	script := "#!/bin/sh\ntrap '' TERM\nsleep 60 &\necho $! > '" + filepath.Join(root, "child") + "'\necho 'DevTools listening on ws://127.0.0.1:45678/devtools/browser/fixture' >&2\nwait\n"
	if err := os.WriteFile(exe, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	p, err := startManagedBrowserProcess(t.Context(), exe, root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = p.close() })
	args := strings.Join(p.cmd.Args, " ")
	if !strings.Contains(args, "--password-store=basic") || !strings.Contains(args, "--use-mock-keychain") || strings.Contains(args, "--no-sandbox") {
		t.Fatal("managed launch changed credential/sandbox isolation")
	}
	if duplicate, err := startManagedBrowserProcess(t.Context(), exe, root); err == nil {
		_ = duplicate.close()
		t.Fatal("live profile lock admitted a second owner")
	}
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			if err := p.close(); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if browserGroupExists(p.cmd.Process.Pid) {
		t.Fatal("browser group survived Close")
	}
	if _, err := os.Stat(p.receiptPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("completed process receipt survived")
	}
}
func TestManagedBrowserStartupCancellationReapsGroup(t *testing.T) {
	root := t.TempDir()
	exe := filepath.Join(root, "browser")
	if err := os.WriteFile(exe, []byte("#!/bin/sh\nsleep 60 &\nwait\n"), 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
	defer cancel()
	_, err := startManagedBrowserProcess(ctx, exe, root)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("unexpected startup cancellation: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, ".flower-browser-process.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("cancel left browser identity")
	}
}
func TestManagedBrowserReceiptRejectsUnrelatedProcess(t *testing.T) {
	root := t.TempDir()
	cmd := exec.Command("/bin/sleep", "60")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	receipt := browserProcessReceipt{PID: cmd.Process.Pid, Started: 1, OwnerPID: 999999, OwnerStarted: 1, Executable: "/not-browser", Profile: root}
	data, _ := json.Marshal(receipt)
	filename := filepath.Join(root, "receipt")
	_ = os.WriteFile(filename, data, 0600)
	if err := recoverBrowserProcess(filename, "/not-browser", root); err == nil {
		t.Fatal("unrelated process accepted")
	}
	if _, err := os.Stat(filename); err != nil {
		t.Fatal("ambiguous evidence removed")
	}
}
func TestManagedBrowserParentCrashFixture(t *testing.T) {
	if os.Getenv("REDEVEN_BROWSER_PARENT_FIXTURE") != "1" {
		return
	}
	p, err := startManagedBrowserProcess(context.Background(), os.Getenv("REDEVEN_BROWSER_TEST_EXECUTABLE"), os.Getenv("REDEVEN_BROWSER_TEST_PROFILE"))
	if err != nil {
		os.Exit(2)
	}
	_ = json.NewEncoder(os.Stdout).Encode(p.cmd.Process.Pid)
	select {}
}
func TestManagedBrowserRealProcessLifecycle(t *testing.T) {
	if os.Getenv("REDEVEN_BROWSER_INTEGRATION") != "1" {
		t.Skip("requires qualified catalog browser")
	}
	pkg := nativeBrowserFixturePackage(t)
	exe := filepath.Join(os.Getenv("REDEVEN_BROWSER_TEST_INSTALLATION"), pkg)
	root := t.TempDir()
	p, err := startManagedBrowserProcess(t.Context(), exe, root)
	if err != nil {
		t.Fatal(err)
	}
	pid := p.cmd.Process.Pid
	if err = p.close(); err != nil {
		t.Fatal(err)
	}
	if browserGroupExists(pid) {
		t.Fatal("real browser group survived")
	}
	parent := exec.Command(os.Args[0], "-test.run=^TestManagedBrowserParentCrashFixture$")
	parent.Env = append(os.Environ(), "REDEVEN_BROWSER_PARENT_FIXTURE=1", "REDEVEN_BROWSER_TEST_EXECUTABLE="+exe, "REDEVEN_BROWSER_TEST_PROFILE="+root)
	out, err := parent.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = parent.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = parent.Process.Kill() })
	line, err := bufio.NewReader(out).ReadBytes('\n')
	if err != nil {
		t.Fatal(err)
	}
	if json.Unmarshal(line, &pid) != nil {
		t.Fatalf("invalid fixture result: %s", line)
	}
	t.Cleanup(func() { _ = syscall.Kill(-pid, syscall.SIGKILL) })
	_ = parent.Process.Kill()
	_ = parent.Wait()
	next, err := startManagedBrowserProcess(t.Context(), exe, root)
	if err != nil {
		t.Fatal(err)
	}
	if browserGroupExists(pid) {
		t.Fatal("prior owned browser survived recovery")
	}
	if err = next.close(); err != nil {
		t.Fatal(err)
	}
}
func nativeBrowserFixturePackage(t *testing.T) string {
	t.Helper()
	body, err := os.ReadFile("../browserinstall/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	var catalog struct {
		Packages []struct{ Platform, Architecture, Executable string }
	}
	if err = json.Unmarshal(body, &catalog); err != nil {
		t.Fatal(err)
	}
	for _, p := range catalog.Packages {
		if p.Platform == runtime.GOOS && p.Architecture == runtime.GOARCH {
			return p.Executable
		}
	}
	t.Fatal("missing native package")
	return ""
}

func TestManagedBrowserRealRuntimeLifecycle(t *testing.T) {
	if os.Getenv("REDEVEN_BROWSER_INTEGRATION") != "1" {
		t.Skip("requires qualified catalog browser")
	}
	for _, scenario := range []string{"helper_killed", "helper_hung", "idle", "page_preserved", "busy_stop", "stop_attached", "unrelated_browser"} {
		t.Run(scenario, func(t *testing.T) {
			node, err := exec.LookPath("node")
			if err != nil {
				t.Fatal(err)
			}
			helper, _ := filepath.Abs("../envapp/ui_src/scripts/redevenComputerHost.mjs")
			host := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"browser-main": NewPlaywrightTargetExecutor(node, helper, t.TempDir())}, t.TempDir())
			configureBrowserFixture(t, host)
			t.Cleanup(func() {
				if err := host.Close(); err != nil {
					t.Error(err)
				}
			})
			meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}
			if _, err = host.ManageBrowserProfile(t.Context(), meta, "browser-main", "start"); err != nil {
				t.Fatal(err)
			}
			p := host.managedProfiles["browser-main"]
			pid := p.browser.cmd.Process.Pid
			switch scenario {
			case "helper_killed":
				_ = p.cmd.Process.Kill()
				deadline := time.Now().Add(10 * time.Second)
				for browserGroupExists(pid) && time.Now().Before(deadline) {
					time.Sleep(25 * time.Millisecond)
				}
				if browserGroupExists(pid) {
					t.Fatal("helper death left Chrome running")
				}
			case "helper_hung":
				_ = p.cmd.Process.Signal(syscall.SIGSTOP)
				if err := host.Close(); err != nil {
					t.Fatal(err)
				}
				if browserGroupExists(pid) {
					t.Fatal("hung helper left Chrome running")
				}
			case "idle":
				now := time.Now()
				host.releaseIdleManagedBrowsers(t.Context(), now)
				if p.idleSince.IsZero() {
					t.Fatal("empty profile not idle")
				}
				if _, err := host.ManagedBrowserTabs(t.Context(), meta, "browser-main"); err != nil {
					t.Fatal(err)
				}
				host.releaseIdleManagedBrowsers(t.Context(), now.Add(managedBrowserIdleTimeout+time.Second))
				if browserGroupExists(pid) || host.managedProfiles["browser-main"] != nil {
					t.Fatal("empty idle profile survived")
				}
				if _, err := host.ManageBrowserProfile(t.Context(), meta, "browser-main", "start"); err != nil {
					t.Fatal(err)
				}
			case "page_preserved":
				if _, err := p.call(t.Context(), "new_tab"); err != nil {
					t.Fatal(err)
				}
				now := time.Now()
				host.releaseIdleManagedBrowsers(t.Context(), now)
				host.releaseIdleManagedBrowsers(t.Context(), now.Add(24*time.Hour))
				if !browserGroupExists(pid) || !p.idleSince.IsZero() {
					t.Fatal("idle policy lost a retained page")
				}
			case "busy_stop":
				e := NewPlaywrightTargetExecutor(node, helper, t.TempDir())
				e.ManagedAttachment = true
				e.CDPURL = p.endpoint
				host.executors["task"] = e
				c := host.controlForTarget("task")
				c.threadID = "active"
				if _, err := host.ManageBrowserProfile(t.Context(), meta, "browser-main", "stop"); err == nil {
					t.Fatal("stopped active task")
				}
				if !browserGroupExists(pid) {
					t.Fatal("busy stop killed browser")
				}
				c.threadID = ""
				if _, err := host.ManageBrowserProfile(t.Context(), meta, "browser-main", "stop"); err != nil {
					t.Fatal(err)
				}
			case "stop_attached":
				target, err := host.ConnectBrowser(t.Context(), ComputerBrowserConnection{ManagedProfileID: "browser-main", NewTab: true})
				if err != nil {
					t.Fatal(err)
				}
				old := host.executors[target.ID].(*PlaywrightTargetExecutor)
				if _, err := host.ManageBrowserProfile(t.Context(), meta, "browser-main", "stop"); err != nil {
					t.Fatal(err)
				}
				if err := old.EnsureTargetReady(t.Context(), target.ID); err == nil {
					t.Fatal("stopped source retained readiness")
				}
				next, err := host.ConnectBrowser(t.Context(), ComputerBrowserConnection{ManagedProfileID: "browser-main", NewTab: true})
				if err != nil || next.ID == target.ID || !next.Ready {
					t.Fatalf("fresh explicit selection: %+v %v", next, err)
				}
			case "unrelated_browser":
				exe := filepath.Join(os.Getenv("REDEVEN_BROWSER_TEST_INSTALLATION"), nativeBrowserFixturePackage(t))
				other, err := startManagedBrowserProcess(t.Context(), exe, t.TempDir())
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = other.close() })
				if err := host.Close(); err != nil {
					t.Fatal(err)
				}
				if !browserGroupExists(other.cmd.Process.Pid) {
					t.Fatal("closing one runtime killed another browser")
				}
			}
		})
	}
}

func TestManagedBrowserSandboxIntegration(t *testing.T) {
	if os.Getenv("REDEVEN_BROWSER_INTEGRATION") != "1" {
		t.Skip("requires qualified catalog browser")
	}
	exe := filepath.Join(os.Getenv("REDEVEN_BROWSER_TEST_INSTALLATION"), nativeBrowserFixturePackage(t))
	p, err := startManagedBrowserProcess(t.Context(), exe, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := p.close(); err != nil {
			t.Error(err)
		}
	})
	cmd := exec.CommandContext(t.Context(), "node", "--test", "../envapp/ui_src/scripts/computerManagedSandbox.node-test.mjs")
	cmd.Env = append(os.Environ(), "REDEVEN_BROWSER_TEST_ENDPOINT="+p.endpoint)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("sandbox/popup contract: %v\n%s", err, output)
	}
}
func TestManagedBrowserRealRepeatedLifecycle(t *testing.T) {
	if os.Getenv("REDEVEN_BROWSER_INTEGRATION") != "1" {
		t.Skip("requires qualified catalog browser")
	}
	cycles := 5
	if os.Getenv("REDEVEN_BROWSER_LIFECYCLE_STRESS") == "1" {
		cycles = 100
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	helper, _ := filepath.Abs("../envapp/ui_src/scripts/redevenComputerHost.mjs")
	host := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"browser-main": NewPlaywrightTargetExecutor(node, helper, t.TempDir())}, t.TempDir())
	configureBrowserFixture(t, host)
	t.Cleanup(func() {
		if err := host.Close(); err != nil {
			t.Error(err)
		}
	})
	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}
	for i := range cycles {
		if _, err := host.ManageBrowserProfile(t.Context(), meta, "browser-main", "start"); err != nil {
			t.Fatal(i, err)
		}
		p := host.managedProfiles["browser-main"]
		pid := p.browser.cmd.Process.Pid
		if _, err := host.ManageBrowserProfile(t.Context(), meta, "browser-main", "start"); err != nil || host.managedProfiles["browser-main"] != p {
			t.Fatal("start duplicated an owner", i, err)
		}
		if _, err := p.call(t.Context(), "new_tab"); err != nil {
			t.Fatal(i, err)
		}
		if _, err := host.ManageBrowserProfile(t.Context(), meta, "browser-main", "stop"); err != nil {
			t.Fatal(i, err)
		}
		if browserGroupExists(pid) || len(host.managedProfiles) != 0 {
			t.Fatal("cycle retained a browser", i)
		}
	}
	t.Logf("%d start/reuse/create-page/stop cycles; every process group reaped", cycles)
}
func TestManagedBrowserProcessRejectsUnsafeReceipts(t *testing.T) {
	for _, fixture := range []string{"symlink", "oversized", "invalid"} {
		t.Run(fixture, func(t *testing.T) {
			root := t.TempDir()
			file := filepath.Join(root, "receipt")
			switch fixture {
			case "symlink":
				if err := os.Symlink(filepath.Join(root, "missing"), file); err != nil {
					t.Fatal(err)
				}
			case "oversized":
				if err := os.WriteFile(file, make([]byte, 8193), 0600); err != nil {
					t.Fatal(err)
				}
			case "invalid":
				if err := os.WriteFile(file, []byte("{}"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if err := recoverBrowserProcess(file, "/browser", root); err == nil {
				t.Fatal("unsafe receipt accepted")
			}
			if _, err := os.Lstat(file); err != nil {
				t.Fatal("evidence lost", err)
			}
		})
	}
}
