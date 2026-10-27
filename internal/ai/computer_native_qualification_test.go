package ai

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func prepareComputerEntryFixture(t *testing.T, modes ...string) (string, func() map[string]any) {
	t.Helper()
	if runtime.GOOS != "darwin" || os.Getenv("REDEVEN_COMPUTER_NATIVE_E2E") != "1" {
		t.Fatal("native entry qualification requires explicit macOS fixture authorization")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	name := "Redeven Computer Entry " + rand.Text()
	app := filepath.Join(home, "Applications", name+".app")
	contents := filepath.Join(app, "Contents")
	binary := filepath.Join(contents, "MacOS", "Entry")
	result := filepath.Join(t.TempDir(), "result.json")
	read := func() map[string]any {
		body, _ := os.ReadFile(result)
		var facts map[string]any
		_ = json.Unmarshal(body, &facts)
		return facts
	}
	t.Cleanup(func() {
		// Match the exact task-owned executable even when launch failed before
		// the app could write its first receipt. Never trust a stale receipt PID.
		processes, err := exec.Command("/bin/ps", "-axo", "pid=,comm=").Output()
		if err != nil {
			t.Error(err)
			return
		}
		for _, line := range strings.Split(string(processes), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 2 || strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), fields[0])) != binary {
				continue
			}
			pid, err := strconv.Atoi(fields[0])
			if err != nil {
				continue
			}
			_ = syscall.Kill(pid, syscall.SIGTERM)
			deadline := time.Now().Add(3 * time.Second)
			for syscall.Kill(pid, 0) == nil && time.Now().Before(deadline) {
				time.Sleep(20 * time.Millisecond)
			}
			if syscall.Kill(pid, 0) == nil {
				t.Errorf("fixture process did not stop: %d", pid)
				return
			}
		}
		_ = os.RemoveAll(app)
	})
	if err = os.MkdirAll(filepath.Dir(binary), 0700); err != nil {
		t.Fatal(err)
	}
	plist := fmt.Sprintf(`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.floegence.redeven.entry-%s</string><key>CFBundleName</key><string>%s</string><key>CFBundleExecutable</key><string>Entry</string><key>CFBundlePackageType</key><string>APPL</string><key>FixtureResultPath</key><string>%s</string></dict></plist>`, rand.Text(), name, result)
	if len(modes) == 1 {
		plist = strings.Replace(plist, "</dict>", "<key>FixtureMode</key><string>"+modes[0]+"</string></dict>", 1)
	}
	if err = os.WriteFile(filepath.Join(contents, "Info.plist"), []byte(plist), 0600); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	if output, err := exec.CommandContext(t.Context(), "swiftc", filepath.Join(root, "scripts/fixtures/nativeComputerEntry.swift"), "-o", binary, "-framework", "AppKit").CombinedOutput(); err != nil {
		t.Fatalf("compile entry fixture: %v %s", err, output)
	}
	return name, read
}

func TestComputerNativeApplicationEntryQualification(t *testing.T) {
	if runtime.GOOS != "darwin" || os.Getenv("REDEVEN_COMPUTER_NATIVE_E2E") != "1" {
		t.Skip("explicit native fixture required")
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"single", "no_window", "multiple", "minimized"} {
		t.Run(mode, func(t *testing.T) {
			name, read := prepareComputerEntryFixture(t, mode)
			host, _, _, _ := computerBindingFixture(t)
			native := NewNativeDesktopTargetExecutor(filepath.Join(root, "desktop/native/computer-host/.build/release/redeven-computer-host"))
			host.executors["desktop-main"] = native
			call := TargetToolCall{ThreadID: "thread-first", TurnID: "turn", RunID: "run", ToolName: "computer.targets"}
			call.Arguments, _ = json.Marshal(map[string]any{"application": name})
			ctx := computerPermissionContext(t, "full_access")
			inventory, err := host.ComputerTargets(ctx, call, ToolTargetPolicy{})
			if err != nil {
				t.Fatal(err)
			}
			if len(inventory.Candidates) != 1 || inventory.Candidates[0].Kind != "desktop.application" || read() != nil {
				t.Fatalf("discovery changed app or returned wrong candidates: %+v", inventory)
			}
			call.ToolName = "computer.select_target"
			target, err := host.SelectComputerCandidate(ctx, call, inventory.Candidates[0].CandidateRef, ToolTargetPolicy{})
			if mode == "no_window" || mode == "multiple" {
				var selection *computerApplicationSelection
				if !errors.As(err, &selection) {
					t.Fatalf("missing application launch receipt: %v", err)
				}
				want := 0
				if mode == "multiple" {
					want = 2
				}
				if len(selection.candidates) != want || selection.cause != nil {
					t.Fatalf("unexpected windows: %+v", selection)
				}
			} else {
				if err != nil || target.Kind != "desktop.window" {
					t.Fatalf("application was not selected: %+v %v", target, err)
				}
				call.TargetID, call.ToolName, call.Arguments = target.ID, "computer.observe", json.RawMessage(`{"limit":80}`)
				result, err := host.ExecuteTargetTool(ctx, call)
				if err != nil || result.Result == nil {
					t.Fatalf("opened window unavailable: %+v %v", result, err)
				}
			}
			if facts := read(); facts == nil || facts["clicks"] != float64(0) {
				t.Fatalf("unexpected fixture effects: %+v", facts)
			}
		})
	}
}

// Explicit foreground qualification targets only this disposable fixture.
func TestComputerNativeScriptQualification(t *testing.T) {
	if runtime.GOOS != "darwin" || os.Getenv("REDEVEN_COMPUTER_NATIVE_E2E") != "1" {
		t.Skip("explicit native fixture required")
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	contents := filepath.Join(dir, "Fixture.app", "Contents")
	if err = os.MkdirAll(filepath.Join(contents, "MacOS"), 0700); err != nil {
		t.Fatal(err)
	}
	plist := []byte("<?xml version='1.0'?><plist version='1.0'><dict><key>CFBundleIdentifier</key><string>dev.floegence.redeven.computer-fixture</string><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>")
	if err = os.WriteFile(filepath.Join(contents, "Info.plist"), plist, 0600); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(contents, "MacOS", "Fixture")
	if body, err := exec.CommandContext(t.Context(), "swiftc", filepath.Join(root, "scripts/fixtures/nativeComputerUse.swift"), "-o", executable, "-framework", "AppKit").CombinedOutput(); err != nil {
		t.Fatalf("compile fixture: %v %s", err, body)
	}
	resultPath := filepath.Join(dir, "result.json")
	fixture := exec.CommandContext(t.Context(), executable, resultPath, "--background", "--status-pipe")
	input, err := fixture.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := fixture.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = fixture.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = fixture.Process.Kill(); _ = fixture.Wait() })
	read := func() map[string]any {
		body, err := os.ReadFile(resultPath)
		if err != nil {
			return nil
		}
		var value map[string]any
		_ = json.Unmarshal(body, &value)
		return value
	}
	deadline := time.Now().Add(10 * time.Second)
	for read() == nil && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	initial := read()
	if initial == nil {
		t.Fatal("fixture unavailable")
	}
	native := NewNativeDesktopTargetExecutor(filepath.Join(root, "desktop/native/computer-host/.build/release/redeven-computer-host"))
	t.Cleanup(func() { _ = native.Close() })
	var target TargetDescriptor
	deadline = time.Now().Add(10 * time.Second)
	for target.ID == "" && time.Now().Before(deadline) {
		targets, err := native.ListTargets(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		for _, candidate := range targets {
			if candidate.AppBundleID == "dev.floegence.redeven.computer-fixture" {
				if target.ID != "" {
					t.Fatal("ambiguous fixture")
				}
				target = candidate
			}
		}
		if target.ID == "" {
			time.Sleep(100 * time.Millisecond)
		}
	}
	if target.ID == "" {
		t.Fatal("fixture missing")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	registry := NewTargetRegistry()
	if err = registry.Register(target); err != nil {
		t.Fatal(err)
	}
	host := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{target.ID: native, "browser-main": NewPlaywrightTargetExecutor(node, filepath.Join(root, "internal/envapp/ui_src/scripts/redevenComputerHost.mjs"), t.TempDir())}, t.TempDir())
	defer host.Close()
	geometry := initial["geometry"].(map[string]any)
	x := geometry["scrollX"].(float64) - geometry["x"].(float64)
	y := geometry["scrollY"].(float64) - geometry["y"].(float64)
	call := TargetToolCall{ThreadID: "native-fixture", TurnID: "turn", RunID: "run", TargetID: target.ID, ToolCallID: "script", ToolName: "computer.exec", fullAccess: true, revalidate: func(ctx context.Context) error { return ctx.Err() }}
	code := fmt.Sprintf("await ui.snapshot(); await ui.scroll(0); await ui.scrollAt(%f,%f,200); await ui.screenshot();", x, y)
	result, err := executeTestScript(t.Context(), host, call, code)
	if err != nil {
		t.Fatalf("native facade failed: %v %#v", err, result.Result)
	}
	if len(result.Attachments) != 1 {
		t.Fatal("native screenshot missing")
	}
	deadline = time.Now().Add(3 * time.Second)
	for read()["scrollOffset"].(float64) <= 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	final := read()
	if final["wheelEvents"].(float64) < 2 || final["scrollOffset"].(float64) <= 0 {
		t.Fatalf("native facade did not scroll: %v", final)
	}
	if _, err := fmt.Fprintln(input, "status"); err != nil {
		t.Fatal(err)
	}
	status := make(chan map[string]any, 1)
	go func() {
		scanner := bufio.NewScanner(output)
		var value map[string]any
		if scanner.Scan() {
			_ = json.Unmarshal(scanner.Bytes(), &value)
		}
		status <- value
	}()
	select {
	case final = <-status:
	case <-time.After(5 * time.Second):
		t.Fatal("fixture status timeout")
	}
	if final == nil || final["frontmost_pid"] != initial["initial_frontmost_pid"] || final["pointer_x"] != initial["initial_pointer_x"] || final["pointer_y"] != initial["initial_pointer_y"] || final["original_window_focused"] != true {
		t.Fatalf("native restoration: original_pid=%v final_pid=%v pointer=(%v,%v)->(%v,%v) original_window_available=%v focused=%v", initial["initial_frontmost_pid"], final["frontmost_pid"], initial["initial_pointer_x"], initial["initial_pointer_y"], final["pointer_x"], final["pointer_y"], final["original_window_available"], final["original_window_focused"])
	}
	t.Logf("facade-to-native scroll verified; wheel events=%v offset=%v", final["wheelEvents"], final["scrollOffset"])
}
