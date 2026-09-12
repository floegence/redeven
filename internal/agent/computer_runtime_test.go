package agent

import (
	"os"
	"path/filepath"
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
	if target.ID != "browser-main" || target.Kind != "browser.managed" || !target.Ready || target.State != "ready" {
		t.Fatalf("target = %+v", target)
	}
	if got := executor.(*ai.PlaywrightTargetExecutor).HelperPath; got != helper {
		t.Fatalf("helper path = %q, want %q", got, helper)
	}
}

func TestComputerUseRuntimeReportsSetupRequiredWhenHelperIsMissing(t *testing.T) {
	t.Setenv("REDEVEN_COMPUTER_HOST_HELPER_PATH", filepath.Join(t.TempDir(), "missing.mjs"))
	t.Setenv("REDEVEN_COMPUTER_NATIVE_HELPER_PATH", filepath.Join(t.TempDir(), "missing-native"))
	executor, resolver := computerUseRuntime(filepath.Join(t.TempDir(), "state"))
	if executor != nil {
		t.Fatal("missing helper should not produce an executor")
	}
	target, err := resolver.ResolveTarget(t.Context(), "current")
	if err != nil {
		t.Fatal(err)
	}
	if target.State != "setup_required" || target.Ready || target.PermissionState != "helper_missing" {
		t.Fatalf("target = %+v", target)
	}
}
