package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
)

func TestManagedBrowserProfilesShareOnlyTheirOwnLogin(t *testing.T) {
	if os.Getenv("REDEVEN_BROWSER_INTEGRATION") != "1" {
		t.Skip("set REDEVEN_BROWSER_INTEGRATION=1 with the pinned browser installed")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	helper, err := filepath.Abs("../envapp/ui_src/scripts/redevenComputerHost.mjs")
	if err != nil {
		t.Fatal(err)
	}
	registry := NewTargetRegistry()
	target := TargetDescriptor{ID: "browser-main", Kind: "browser.managed", DisplayName: "Fixture"}
	if err := registry.Register(target); err != nil {
		t.Fatal(err)
	}
	runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": NewPlaywrightTargetExecutor(node, helper, t.TempDir())}, t.TempDir())
	t.Cleanup(func() {
		if err := runtime.Close(); err != nil {
			t.Error(err)
		}
	})
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/export" {
			w.Header().Set("Content-Type", "text/csv")
			w.Header().Set("Content-Disposition", "attachment; filename=results.csv")
			_, _ = w.Write([]byte("fixture,42\n"))
			return
		}
		w.Header().Set("Content-Type", "text/html")
		if r.URL.Path == "/login" {
			http.SetCookie(w, &http.Cookie{Name: "fixture", Value: "signed-in", Path: "/"})
			_, _ = w.Write([]byte("<h1>Signed in</h1>"))
			return
		}
		if _, err := r.Cookie("fixture"); err == nil {
			_, _ = w.Write([]byte("<h1>Signed in</h1>"))
		} else {
			_, _ = w.Write([]byte("<h1>Guest</h1>"))
		}
	}))
	defer server.Close()
	target, err = runtime.PrepareTarget(ctx, target)
	if err != nil || !target.Ready {
		t.Fatalf("prepare: %+v %v", target, err)
	}
	navigate := func(targetID, url string) {
		t.Helper()
		args, _ := json.Marshal(map[string]string{"url": url})
		result, err := runtime.ExecuteTargetTool(ctx, TargetToolCall{TargetID: targetID, ToolName: "browser.navigate", Arguments: args, allowedOrigins: []string{server.URL}, scriptOperation: true})
		if err != nil || result.Safety.Level != "routine" {
			t.Fatalf("navigate: %+v %v", result, err)
		}
	}
	observe := func(targetID string) string {
		t.Helper()
		result, err := runtime.ExecuteTargetTool(ctx, TargetToolCall{TargetID: targetID, ToolName: "computer.observe", allowedOrigins: []string{server.URL}, scriptOperation: true})
		if err != nil {
			t.Fatal(err)
		}
		body, _ := json.Marshal(result.Result)
		return string(body)
	}
	navigate(target.ID, server.URL+"/login")
	second, err := runtime.ConnectBrowser(ctx, ComputerBrowserConnection{ManagedProfileID: "browser-main", NewTab: true})
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == target.ID {
		t.Fatal("new tab replaced another task target")
	}
	navigate(second.ID, server.URL+"/status")
	if !strings.Contains(observe(second.ID), "Signed in") {
		t.Fatal("profile login was not reused")
	}
	service := &Service{targetToolExecutor: runtime}
	profiles, err := service.ManagedBrowserProfiles(ctx, &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}, "Separate")
	if err != nil {
		t.Fatal(err)
	}
	third, err := runtime.ConnectBrowser(ctx, ComputerBrowserConnection{ManagedProfileID: profiles[len(profiles)-1].ID, NewTab: true})
	if err != nil {
		t.Fatal(err)
	}
	navigate(third.ID, server.URL+"/status")
	if !strings.Contains(observe(third.ID), "Guest") {
		t.Fatal("login escaped its profile")
	}
	if err := runtime.disconnectBrowser(ctx, second.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.ResolveTarget(ctx, second.ID); err == nil {
		t.Fatal("disconnected target survived")
	}
	if !strings.Contains(observe(target.ID), "Signed in") {
		t.Fatal("disconnect affected another tab")
	}
	navigate(target.ID, server.URL+"/export")
	result, err := runtime.ExecuteTargetTool(ctx, TargetToolCall{TargetID: target.ID, ToolName: "browser.wait_for_download", Arguments: json.RawMessage(`{"timeout_ms":5000}`), allowedOrigins: []string{server.URL}, scriptOperation: true})
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := result.Result.(map[string]any)
	download, ok := payload["download"].(map[string]any)
	if !ok || download["state"] != "completed" {
		t.Fatalf("download not complete: %+v", result)
	}
	downloadPath, _ := download["path"].(string)
	if err := runtime.Close(); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(downloadPath)
	if err != nil || string(body) != "fixture,42\n" {
		t.Fatalf("download must survive shutdown: %q %v", body, err)
	}
}

func TestManagedBrowserProfileMetadataFailsClosed(t *testing.T) {
	for _, scenario := range []string{"empty", "unknown_field", "wrong_identity", "oversize", "symlink", "valid"} {
		t.Run(scenario, func(t *testing.T) {
			root := t.TempDir()
			id := "profile-0123456789abcdef0123456789abcdef"
			directory := filepath.Join(root, id)
			if err := os.Mkdir(directory, 0700); err != nil {
				t.Fatal(err)
			}
			body := []byte(`{"id":"` + id + `","name":"Work"}`)
			switch scenario {
			case "empty":
				body = nil
			case "unknown_field":
				body = []byte(`{"id":"` + id + `","name":"Work","cookie":"ignored"}`)
			case "wrong_identity":
				body = []byte(`{"id":"another","name":"Work"}`)
			case "oversize":
				body = []byte(strings.Repeat(" ", 1025))
			}
			filename := filepath.Join(directory, "flower-profile.json")
			if scenario == "symlink" {
				outside := filepath.Join(t.TempDir(), "metadata")
				if err := os.WriteFile(outside, body, 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(outside, filename); err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(filename, body, 0600); err != nil {
				t.Fatal(err)
			}
			runtime := NewComputerUseRuntime(NewTargetRegistry(), map[string]TargetToolExecutor{"browser-main": NewPlaywrightTargetExecutor("/fixture/node", "/fixture/helper", root)}, t.TempDir())
			profiles, err := runtime.managedProfilesLocked()
			if scenario == "valid" {
				if err != nil || len(profiles) != 2 || profiles[1].ID != id {
					t.Fatalf("profiles: %+v %v", profiles, err)
				}
			} else if err == nil {
				t.Fatalf("invalid profile accepted: %+v", profiles)
			}
			after, err := os.ReadFile(filename)
			if err != nil || string(after) != string(body) {
				t.Fatal("validation changed profile bytes")
			}
		})
	}
}

func TestManagedBrowserLostTabAndProcessNeverSelectReplacement(t *testing.T) {
	if os.Getenv("REDEVEN_BROWSER_INTEGRATION") != "1" {
		t.Skip("set REDEVEN_BROWSER_INTEGRATION=1 with the pinned browser installed")
	}
	for _, failure := range []string{"closed_tab", "crashed_browser"} {
		t.Run(failure, func(t *testing.T) {
			node, err := exec.LookPath("node")
			if err != nil {
				t.Fatal(err)
			}
			helper, err := filepath.Abs("../envapp/ui_src/scripts/redevenComputerHost.mjs")
			if err != nil {
				t.Fatal(err)
			}
			registry := NewTargetRegistry()
			target := TargetDescriptor{ID: "browser-main", Kind: "browser.managed", DisplayName: "Fixture"}
			if err := registry.Register(target); err != nil {
				t.Fatal(err)
			}
			runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": NewPlaywrightTargetExecutor(node, helper, t.TempDir())}, t.TempDir())
			t.Cleanup(func() { _ = runtime.Close() })
			ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
			defer cancel()
			target, err = runtime.PrepareTarget(ctx, target)
			if err != nil || !target.Ready {
				t.Fatalf("prepare: %+v %v", target, err)
			}
			executor := runtime.executors[target.ID].(*PlaywrightTargetExecutor)
			tabID := executor.TabID
			// The endpoint and process ID come only from this test's owned
			// managed profile. No name-based process discovery or cleanup.
			script := `import {chromium} from 'playwright';
const browser = await chromium.connectOverCDP(process.argv[1], {noDefaults:true});
const session = await browser.newBrowserCDPSession();
if (process.argv[3] === 'closed_tab') {
  await session.send('Target.closeTarget', {targetId:process.argv[2]});
  await browser.close();
} else {
  const {processInfo} = await session.send('SystemInfo.getProcessInfo');
  const owner = processInfo.find(item => item.type === 'browser');
  if (!owner) throw new Error('owned browser process unavailable');
  process.kill(owner.id, 'SIGKILL');
  await browser.close();
}`
			command := exec.CommandContext(ctx, node, "--input-type=module", "-e", script, executor.CDPURL, tabID, failure)
			command.Dir = filepath.Dir(filepath.Dir(helper))
			if output, err := command.CombinedOutput(); err != nil {
				t.Fatalf("fixture failure injection: %s %v", output, err)
			}
			for range 2 {
				result, err := runtime.ExecuteTargetTool(ctx, TargetToolCall{TargetID: target.ID, ToolName: "computer.observe"})
				if err == nil || result.Result != nil || len(result.Attachments) != 0 {
					t.Fatalf("lost target produced an observation: %+v %v", result, err)
				}
				if executor.TabID != tabID || executor.CDPURL == "" {
					t.Fatal("lost target was silently replaced")
				}
			}
			if failure == "closed_tab" {
				profile := runtime.managedProfiles["browser-main"]
				tabs, err := profile.call(ctx, "inventory")
				if err != nil || len(tabs) != 1 || tabs[0].ID == tabID {
					t.Fatalf("closed tab was recreated or affected its sibling: %+v %v", tabs, err)
				}
			}
		})
	}
}

func TestManagedBrowserPrivateRecoverySharesProfileOwner(t *testing.T) {
	if os.Getenv("REDEVEN_BROWSER_INTEGRATION") != "1" {
		t.Skip("set REDEVEN_BROWSER_INTEGRATION=1 with the pinned browser installed")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	helper, err := filepath.Abs("../envapp/ui_src/scripts/redevenComputerHost.mjs")
	if err != nil {
		t.Fatal(err)
	}
	registry := NewTargetRegistry()
	target := TargetDescriptor{ID: "browser-main", Kind: "browser.managed", DisplayName: "Fixture"}
	if err := registry.Register(target); err != nil {
		t.Fatal(err)
	}
	runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{target.ID: NewPlaywrightTargetExecutor(node, helper, t.TempDir())}, t.TempDir())
	t.Cleanup(func() { _ = runtime.Close() })
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	frames := make(chan FlowerComputerFrame, 1)
	call := TargetToolCall{TargetID: target.ID, ThreadID: "thread", TurnID: "turn", RunID: "run"}
	stop, err := runtime.startComputerLiveFrames(ctx, computerLiveRequest{
		ComputerViewerRequest: ComputerViewerRequest{ObserverID: "observer", ThreadID: call.ThreadID, TargetID: target.ID, InteractionID: "pending", Revision: 1},
		privateCall:           call, validate: func(context.Context) error { return nil },
	}, func(frame FlowerComputerFrame) {
		select {
		case frames <- frame:
		default:
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	select {
	case frame := <-frames:
		if frame.ErrorCode != "" {
			t.Fatalf("private recovery: %+v", frame)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	stop()
	runtime.connectMu.Lock()
	owner := runtime.managedProfiles["browser-main"]
	runtime.connectMu.Unlock()
	if owner == nil {
		t.Fatal("private recovery bypassed the managed profile owner")
	}
	if err := runtime.ReobserveComputerTarget(ctx, call); err != nil {
		t.Fatal(err)
	}
	target, err = runtime.PrepareTarget(ctx, target)
	if err != nil || !target.Ready {
		t.Fatalf("subsequent task could not reuse profile: %+v %v", target, err)
	}
	call.ToolName = "computer.observe"
	if _, err := runtime.ExecuteTargetTool(ctx, call); err != nil {
		t.Fatal(err)
	}
	runtime.connectMu.Lock()
	defer runtime.connectMu.Unlock()
	if runtime.managedProfiles["browser-main"] != owner {
		t.Fatal("profile owner changed during continuation")
	}
}

func TestComputerFullAccessManagedBrowserUsesTaskPermission(t *testing.T) {
	if os.Getenv("REDEVEN_BROWSER_INTEGRATION") != "1" {
		t.Skip("requires the pinned browser")
	}
	runtime, _, _, _ := computerBindingFixture(t)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	helper, err := filepath.Abs("../envapp/ui_src/scripts/redevenComputerHost.mjs")
	if err != nil {
		t.Fatal(err)
	}
	runtime.executors["browser-main"] = NewPlaywrightTargetExecutor(node, helper, t.TempDir())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<h1>Full access fixture</h1>"))
	}))
	defer server.Close()
	args, _ := json.Marshal(map[string]string{"url": server.URL})
	result, err := runtime.ExecuteTargetTool(t.Context(), TargetToolCall{ThreadID: "thread-first", TurnID: "turn", RunID: "run", ToolCallID: "navigate", TargetID: "browser-main", ToolName: "browser.navigate", Arguments: args, scriptOperation: true})
	if err != nil || result.Safety == nil || result.Safety.Level != "routine" {
		t.Fatalf("full access navigation failed: %+v %v", result, err)
	}
}
