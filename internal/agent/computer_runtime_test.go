package agent

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/floegence/redeven/internal/ai"
)

func TestComputerUseRuntimeUsesConfiguredAbsoluteHelperFromAnyWorkingDirectory(t *testing.T) {
	helper := filepath.Join(t.TempDir(), "redevenComputerHost.mjs")
	if err := os.WriteFile(helper, []byte("// fixture"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("REDEVEN_COMPUTER_HOST_HELPER_PATH", helper)
	t.Setenv("REDEVEN_COMPUTER_NATIVE_HELPER_PATH", "")
	executor, resolver := computerUseRuntime(filepath.Join(t.TempDir(), "state"))
	if executor == nil {
		t.Fatal("managed browser executor is nil")
	}
	target, err := resolver.ResolveTarget(t.Context(), "current")
	if err != nil {
		t.Fatal(err)
	}
	if target.ID != "browser-main" || target.Kind != "browser.managed" || target.Ready || target.State != "stopped" || target.PermissionState != "not_checked" {
		t.Fatalf("target = %+v", target)
	}

}

func TestComputerUseRuntimeReportsSetupRequiredWhenHelperIsMissing(t *testing.T) {
	t.Setenv("REDEVEN_COMPUTER_HOST_HELPER_PATH", filepath.Join(t.TempDir(), "missing.mjs"))
	t.Setenv("REDEVEN_COMPUTER_NATIVE_HELPER_PATH", filepath.Join(t.TempDir(), "missing-native"))
	executor, resolver := computerUseRuntime(filepath.Join(t.TempDir(), "state"))
	if executor == nil {
		t.Fatal("runtime owner should remain available to report setup state")
	}
	target, err := resolver.ResolveTarget(t.Context(), "current")
	if err != nil {
		t.Fatal(err)
	}
	if target.State != "setup_required" || target.Ready || target.PermissionState != "helper_missing" {
		t.Fatalf("target = %+v", target)
	}
}

func TestComputerUseRuntimeDoesNotReplaceMissingBrowserWithNativeDesktop(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("native desktop registration is macOS-only")
	}
	native := filepath.Join(t.TempDir(), "redeven-computer-host")
	if err := os.WriteFile(native, []byte("#!/bin/sh\nprintf '{\"protocol_version\":1,\"screen_recording\":true,\"accessibility\":true}'\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("REDEVEN_COMPUTER_HOST_HELPER_PATH", filepath.Join(t.TempDir(), "missing-browser"))
	t.Setenv("REDEVEN_COMPUTER_NATIVE_HELPER_PATH", native)
	executor, resolver := computerUseRuntime(filepath.Join(t.TempDir(), "state"))
	if executor == nil {
		t.Fatal("native executor is nil")
	}
	target, err := resolver.ResolveTarget(t.Context(), "current")
	if err != nil {
		t.Fatal(err)
	}
	target, err = executor.(ai.TargetPreparer).PrepareTarget(t.Context(), target)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = executor.(*ai.ComputerUseRuntime).Close() })
	if target.ID != "browser-main" || target.Ready || target.State != "setup_required" {
		t.Fatalf("current target = %+v", target)
	}
}

func TestComputerUseRuntimeRegistersOnlyDiscoveredNativeWindows(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("native desktop registration is macOS-only")
	}
	t.Setenv("REDEVEN_COMPUTER_CONNECTED_CDP_URL", "http://127.0.0.1:19222")
	managed := filepath.Join(t.TempDir(), "redevenComputerHost.mjs")
	native := filepath.Join(t.TempDir(), "redeven-computer-host")
	if err := os.WriteFile(managed, []byte("// fixture"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(native, []byte(`#!/bin/sh
if [ "$1" = "--capabilities" ]; then
  printf '%s\n' '{"protocol_version":3,"screen_recording":true,"accessibility":true}'
  exit 0
fi
while IFS= read -r line; do
  request_id=$(printf '%s' "$line" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
  printf '{"type":"result","request_id":"%s","target_id":"desktop-main","payload":{"targets":[{"id":"macos-window-fixture","kind":"desktop.window","app_bundle_id":"dev.fixture","ready":true}]}}\n' "$request_id"
done
`), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("REDEVEN_COMPUTER_HOST_HELPER_PATH", managed)
	t.Setenv("REDEVEN_COMPUTER_NATIVE_HELPER_PATH", native)
	executor, resolver := computerUseRuntime(filepath.Join(t.TempDir(), "state"))
	if _, ok := executor.(*ai.ComputerUseRuntime); !ok {
		t.Fatalf("executor = %T, want multiplexed target executor", executor)
	}
	owner := executor.(*ai.ComputerUseRuntime)
	t.Cleanup(func() { _ = owner.Close() })
	for _, alias := range []string{"desktop-main", "desktop.screen"} {
		if target, err := resolver.ResolveTarget(t.Context(), alias); err == nil {
			t.Fatalf("internal inventory became executable: %+v", target)
		}
	}
	if _, err := owner.ListComputerTargets(t.Context()); err != nil {
		t.Fatal(err)
	}
	target, err := resolver.ResolveTarget(t.Context(), "macos-window-fixture")
	if err != nil || target.Kind != "desktop.window" || !target.Ready {
		t.Fatalf("discovered window = %+v, %v", target, err)
	}
	current, err := resolver.ResolveTarget(t.Context(), "current")
	if err != nil || current.ID != "browser-main" {
		t.Fatalf("inventory changed default = %+v, %v", current, err)
	}
}
