package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func runtimeFixture(t *testing.T, handshake string) (*ComputerUseRuntime, *PlaywrightTargetExecutor) {
	t.Helper()
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "browser-main", Kind: "browser.managed", State: "stopped"}); err != nil {
		t.Fatal(err)
	}
	helper := filepath.Join(t.TempDir(), "helper.sh")
	if err := os.WriteFile(helper, []byte("printf '%s\\n' '"+handshake+"'\nwhile IFS= read -r line; do :; done\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	executor := NewPlaywrightTargetExecutor("/bin/sh", helper, t.TempDir())
	runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": executor})
	t.Cleanup(func() { _ = runtime.Close() })
	return runtime, executor
}

func TestComputerRuntimeRequiresRealHandshake(t *testing.T) {
	runtime, executor := runtimeFixture(t, `{"type":"ready","protocol_version":1}`)
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
	for _, test := range []struct{ handshake, state, reason string }{
		{`{"type":"ready","protocol_version":1,"error":"TARGET_SETUP_REQUIRED","reason":"browser_dependency_missing"}`, "setup_required", "browser_dependency_missing"},
		{`{"type":"ready","protocol_version":1,"error":"TARGET_CONNECTION_REQUIRED","reason":"browser_connection_failed"}`, "connection_required", "browser_connection_failed"},
		{`{"type":"ready","protocol_version":999,"error":"Authorization: secret"}`, "setup_required", "browser_handshake_invalid"},
		{`{"type":"ready","protocol_version":1,"error":"secret","reason":"data:image/png;base64,secret"}`, "setup_required", "browser_launch_failed"},
	} {
		t.Run(test.reason, func(t *testing.T) {
			runtime, executor := runtimeFixture(t, test.handshake)
			target, _ := runtime.ResolveTarget(t.Context(), "current")
			target, err := runtime.PrepareTarget(t.Context(), target)
			if err != nil || target.Ready || target.State != test.state || target.PermissionState != test.reason {
				t.Fatalf("startup result: %+v, %v", target, err)
			}
			if len(executor.clients) != 0 {
				t.Fatal("failed readiness retained a helper")
			}
		})
	}
}

func TestComputerRuntimeRejectsPathDependentNodeBeforeLaunch(t *testing.T) {
	runtime, executor := runtimeFixture(t, `{"type":"ready","protocol_version":1}`)
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
		{`printf '{"protocol_version":1,"screen_recording":false,"accessibility":true}'`, "TARGET_PERMISSION_REQUIRED"},
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
	runtime, managed := runtimeFixture(t, `{"type":"ready","protocol_version":1}`)
	first, err := runtime.ConnectBrowser(t.Context(), "http://127.0.0.1:9222")
	if err != nil || !first.Ready {
		t.Fatalf("first connection: %+v %v", first, err)
	}
	original := runtime.executors[first.ID].(*PlaywrightTargetExecutor)
	if err := os.WriteFile(managed.HelperPath, []byte("printf '%s\\n' '{\"type\":\"ready\",\"protocol_version\":1,\"error\":\"TARGET_CONNECTION_REQUIRED\",\"reason\":\"browser_connection_failed\"}'\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	failed, err := runtime.ConnectBrowser(t.Context(), "http://127.0.0.1:9223")
	var startup *TargetStartupError
	if !errors.As(err, &startup) || startup.Code != "TARGET_CONNECTION_REQUIRED" || failed.Ready {
		t.Fatalf("failed connection reported success: %+v %v", failed, err)
	}
	if runtime.executors[first.ID] != original || original.closed {
		t.Fatal("failed replacement discarded the authorized connection")
	}
}

func TestComputerRuntimeConnectReapsReplacementAndRejectsAfterClose(t *testing.T) {
	runtime, _ := runtimeFixture(t, `{"type":"ready","protocol_version":1}`)
	first, err := runtime.ConnectBrowser(t.Context(), "http://127.0.0.1:9222")
	if err != nil {
		t.Fatal(err)
	}
	old := runtime.executors[first.ID].(*PlaywrightTargetExecutor)
	if _, err := runtime.ConnectBrowser(t.Context(), "http://127.0.0.1:9223"); err != nil {
		t.Fatal(err)
	}
	if !old.closed || len(old.clients) != 0 {
		t.Fatal("replacement leaked the old helper")
	}
	if err := runtime.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.ConnectBrowser(t.Context(), "http://127.0.0.1:9224"); err == nil {
		t.Fatal("closed runtime started another browser")
	}
}
