package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func runtimeFixture(t *testing.T) (*ComputerUseRuntime, *PlaywrightTargetExecutor) {
	t.Helper()
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "browser-main", Kind: "browser.managed", State: "stopped"}); err != nil {
		t.Fatal(err)
	}
	helper := filepath.Join(t.TempDir(), "helper.sh")
	if err := os.WriteFile(helper, []byte("# Runtime source fixture\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(helper), "redevenBrowserInventory.mjs"), []byte(`printf '%s\n' '{"protocol_version":2,"tabs":[{"id":"tab-one","profile_id":"default","title":"Fixture","url":"about:blank"}]}'`), 0600); err != nil {
		t.Fatal(err)
	}
	executor := NewPlaywrightTargetExecutor("/bin/sh", helper, t.TempDir())
	// This fixture exercises shared source admission. Helper protocol negotiation
	// and exact-tab isolation have separate process and real-browser fixtures.
	executor.CDPURL, executor.TabID, executor.BrowserContextID = "http://127.0.0.1:1", "fixture", "default"
	runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": executor}, t.TempDir())
	runtime.browserHost, _ = browserHostFixture(t, func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			ID, Method string
			Params     struct {
				ID, Endpoint string
				Tabs         []ComputerBrowserTab `json:"tabs"`
			}
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		reply := map[string]any{"id": request.ID}
		switch request.Method {
		case "source.admit":
			reply["result"] = request.Params.ID
		case "source.inventory":
			reply["result"] = request.Params.Tabs
		}
		_ = json.NewEncoder(w).Encode(reply)
	})
	t.Cleanup(func() { _ = runtime.Close() })
	return runtime, executor
}

func TestComputerRuntimeRequiresSharedSourceAdmission(t *testing.T) {
	runtime, executor := runtimeFixture(t)
	target, err := runtime.ResolveTarget(t.Context(), "current")
	if err != nil {
		t.Fatal(err)
	}
	if target.Ready || len(executor.clients) != 0 {
		t.Fatal("identity resolution started or declared a ready browser")
	}
	target, err = runtime.PrepareTarget(t.Context(), target)
	if err != nil || !target.Ready || len(executor.clients) != 1 {
		t.Fatalf("handshake: %+v, %v", target, err)
	}
	client := executor.clients[target.ID]
	if client.host != runtime.browserHost || client.cmd != nil {
		t.Fatal("Runtime source bypassed the shared host")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err = runtime.PrepareTarget(ctx, target); err != context.Canceled {
		t.Fatalf("cancel: %v", err)
	}
	if executor.clients[target.ID] != client {
		t.Fatal("cancelled readiness replaced the persistent helper")
	}
}

func TestComputerRuntimeStartupFailureRemainsTypedAndSecretFree(t *testing.T) {
	runtime, executor := runtimeFixture(t)
	failed, _ := browserHostFixture(t, func(w http.ResponseWriter, r *http.Request) {
		var request struct{ ID string }
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": request.ID, "error": "Authorization: private-page-secret"})
	})
	runtime.browserHost = failed
	target, _ := runtime.ResolveTarget(t.Context(), "current")
	target, err := runtime.PrepareTarget(t.Context(), target)
	if err != nil || target.Ready || target.State != "connection_required" || target.PermissionState != "browser_connection_failed" {
		t.Fatalf("startup result: %+v %v", target, err)
	}
	if len(executor.clients) != 0 {
		t.Fatal("failed admission retained a source")
	}
}

func TestComputerRuntimeRejectsPathDependentNodeBeforeLaunch(t *testing.T) {
	runtime, executor := runtimeFixture(t)
	executor.NodeBinary = "node"
	target, _ := runtime.ResolveTarget(t.Context(), "current")
	target, err := runtime.PrepareTarget(t.Context(), target)
	if err != nil || target.Ready || target.PermissionState != "browser_paths_not_absolute" {
		t.Fatalf("path-dependent node accepted: %+v %v", target, err)
	}
}

func TestNativeReadinessTimeoutAndPermissions(t *testing.T) {
	for _, test := range []struct{ script, code string }{
		{"exec sleep 30", "TARGET_SETUP_REQUIRED"},
		{`printf '{"protocol_version":3,"screen_recording":false,"accessibility":true}'`, "TARGET_PERMISSION_REQUIRED"},
	} {
		t.Run(test.code, func(t *testing.T) {
			helper := filepath.Join(t.TempDir(), "native")
			if err := os.WriteFile(helper, []byte("#!/bin/sh\n"+test.script+"\n"), 0o700); err != nil {
				t.Fatal(err)
			}
			executor := NewNativeDesktopTargetExecutor(helper)
			executor.Timeout = 2 * time.Second
			if test.code == "TARGET_SETUP_REQUIRED" {
				executor.Timeout = 50 * time.Millisecond
			}
			t.Cleanup(func() { _ = executor.Close() })
			err := executor.EnsureTargetReady(t.Context(), "desktop-main")
			if err == nil || !strings.Contains(err.Error(), test.code) {
				t.Fatalf("readiness: %v", err)
			}
			if executor.cmd != nil {
				t.Fatal("failed permission check launched a native session")
			}
		})
	}
}

func TestComputerRuntimeConnectRequiresReadyAndPreservesExistingConnection(t *testing.T) {
	runtime, _ := runtimeFixture(t)
	first, err := runtime.ConnectBrowser(t.Context(), ComputerBrowserConnection{CDPURL: "http://127.0.0.1:9222", TabID: "tab-one", ProfileID: "default"})
	if err != nil || !first.Ready {
		t.Fatalf("first connection: %+v %v", first, err)
	}
	original := runtime.executors[first.ID].(*PlaywrightTargetExecutor)
	// The shared host can fail while an authorized source remains registered.
	// Another connection must fail closed without replacing that source.
	runtime.browserHost.cancel()
	failed, err := runtime.ConnectBrowser(t.Context(), ComputerBrowserConnection{CDPURL: "http://127.0.0.1:9223", TabID: "tab-one", ProfileID: "default"})
	var startup *TargetStartupError
	if !errors.As(err, &startup) || startup.Code != "TARGET_CONNECTION_REQUIRED" || failed.Ready {
		t.Fatalf("failed connection reported success: %+v %v", failed, err)
	}
	if runtime.executors[first.ID] != original || original.closed {
		t.Fatal("failed replacement discarded the authorized connection")
	}
}

func TestComputerRuntimeConnectKeepsDistinctTabsAndRejectsAfterClose(t *testing.T) {
	runtime, _ := runtimeFixture(t)
	first, err := runtime.ConnectBrowser(t.Context(), ComputerBrowserConnection{CDPURL: "http://127.0.0.1:9222", TabID: "tab-one", ProfileID: "default"})
	if err != nil {
		t.Fatal(err)
	}
	old := runtime.executors[first.ID].(*PlaywrightTargetExecutor)
	if _, err := runtime.ConnectBrowser(t.Context(), ComputerBrowserConnection{CDPURL: "http://127.0.0.1:9223", TabID: "tab-one", ProfileID: "default"}); err != nil {
		t.Fatal(err)
	}
	if old.closed || len(old.clients) != 1 || len(runtime.executors) != 3 {
		t.Fatal("connecting a different browser replaced an existing tab")
	}
	if err := runtime.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.ConnectBrowser(t.Context(), ComputerBrowserConnection{CDPURL: "http://127.0.0.1:9224", TabID: "tab-one", ProfileID: "default"}); err == nil {
		t.Fatal("closed runtime started another browser")
	}
}

func TestComputerRuntimeConnectPreservesLeasedBrowser(t *testing.T) {
	for _, private := range []bool{false, true} {
		runtime, _ := runtimeFixture(t)
		first, err := runtime.ConnectBrowser(t.Context(), ComputerBrowserConnection{CDPURL: "http://127.0.0.1:9222", TabID: "tab-one", ProfileID: "default"})
		if err != nil {
			t.Fatal(err)
		}
		original := runtime.executors[first.ID].(*PlaywrightTargetExecutor)
		owner := TargetToolCall{TargetID: first.ID, ThreadID: "owner", TurnID: "turn", RunID: "run"}
		control, unlock, err := runtime.acquireComputerControl(t.Context(), owner)
		if err != nil {
			t.Fatal(err)
		}
		control.mu.Lock()
		if private {
			control.pauseForUser()
		}
		control.mu.Unlock()
		unlock()
		_, err = runtime.ConnectBrowser(t.Context(), ComputerBrowserConnection{CDPURL: "http://127.0.0.1:9223", TabID: "tab-one", ProfileID: "default"})
		if err != nil {
			t.Fatalf("independent connection: %v", err)
		}
		reused, err := runtime.ConnectBrowser(t.Context(), ComputerBrowserConnection{CDPURL: "http://127.0.0.1:9222", TabID: "tab-one", ProfileID: "default"})
		if err != nil || reused.ID != first.ID {
			t.Fatalf("same tab did not retain its identity: %+v %v", reused, err)
		}

		if runtime.executors[first.ID] != original || original.closed {
			t.Fatal("connection changed the running turn's browser")
		}
		runtime.releaseComputerControl(owner.ThreadID, owner.RunID)
		if _, err := runtime.ConnectBrowser(t.Context(), ComputerBrowserConnection{CDPURL: "http://127.0.0.1:9223", TabID: "tab-one", ProfileID: "default"}); err != nil {
			t.Fatalf("released target could not reconnect: %v", err)
		}
	}
}

func TestComputerRuntimeConnectPreservesInFlightTarget(t *testing.T) {
	runtime, _ := runtimeFixture(t)
	first, err := runtime.ConnectBrowser(t.Context(), ComputerBrowserConnection{CDPURL: "http://127.0.0.1:9222", TabID: "tab-one", ProfileID: "default"})
	if err != nil {
		t.Fatal(err)
	}
	original := runtime.executors[first.ID]
	control := runtime.controlForTarget(first.ID)
	control.gate <- struct{}{}
	defer func() { <-control.gate }()
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	_, err = runtime.ConnectBrowser(ctx, ComputerBrowserConnection{CDPURL: "http://127.0.0.1:9223", TabID: "tab-one", ProfileID: "default"})
	if err != nil {
		t.Fatalf("independent tab connection: %v", err)
	}
	if runtime.executors[first.ID] != original {
		t.Fatal("in-flight executor was replaced")
	}
}

type blockedReadinessExecutor struct {
	serialComputerExecutor
}

func (e *blockedReadinessExecutor) EnsureTargetReady(ctx context.Context, _ string) error {
	_, err := e.ExecuteTargetTool(ctx, TargetToolCall{})
	return err
}

func TestComputerRuntimeReadinessAndOtherConnectionsAreIndependent(t *testing.T) {
	runtime, _ := runtimeFixture(t)
	target := TargetDescriptor{ID: "browser-connected", Kind: "browser.connected", State: "starting"}
	if err := runtime.registry.Register(target); err != nil {
		t.Fatal(err)
	}
	executor := &blockedReadinessExecutor{serialComputerExecutor{entered: make(chan struct{}, 1), leave: make(chan struct{})}}
	runtime.executors[target.ID] = executor
	prepared := make(chan error, 1)
	go func() {
		_, err := runtime.PrepareTarget(t.Context(), target)
		prepared <- err
	}()
	<-executor.entered
	_, err := runtime.ConnectBrowser(t.Context(), ComputerBrowserConnection{CDPURL: "http://127.0.0.1:9222", TabID: "tab-one", ProfileID: "default"})
	close(executor.leave)
	if prepareErr := <-prepared; prepareErr != nil {
		t.Fatal(prepareErr)
	}
	if err != nil {
		t.Fatalf("independent tab readiness: %v", err)
	}
	if runtime.executors[target.ID] != executor {
		t.Fatal("readiness published a retired adapter's state")
	}
}

func TestComputerRuntimeClosedReadinessCannotRestartHelper(t *testing.T) {
	runtime, executor := runtimeFixture(t)
	target, _ := runtime.ResolveTarget(t.Context(), "current")
	if err := runtime.Close(); err != nil {
		t.Fatal(err)
	}
	_, err := runtime.PrepareTarget(t.Context(), target)
	var startup *TargetStartupError
	if !errors.As(err, &startup) || startup.Reason != "runtime_closed" || len(executor.clients) != 0 {
		t.Fatalf("closed readiness: %v", err)
	}
}
