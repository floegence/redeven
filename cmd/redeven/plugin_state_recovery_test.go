package main

import (
	"context"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/redevpluginintegration"
	"github.com/floegence/redevplugin/pkg/ownerscope"
)

func TestPluginStateRecoveryCLIRequiresExactConfirmationAndPlan(t *testing.T) {
	stateRoot := copiedPluginStateRoot(t)

	code, stdout, stderr := runCLITest(t, "plugin-state-recovery", "inspect", "--state-root", stateRoot)
	if code != 0 || stderr != "" {
		t.Fatalf("inspect code=%d stdout=%q stderr=%q", code, stdout, stderr)
	}
	inspect := decodePluginStateRecoveryReport(t, stdout)
	if inspect.SchemaVersion != pluginStateRecoverySchemaVersion || inspect.Operation != "inspect" || inspect.Status != "recovery_required" || inspect.Code != "plugin_state_recovery_required" || inspect.Plan == nil {
		t.Fatalf("inspect report = %#v", inspect)
	}
	if strings.Contains(stdout, stateRoot) {
		t.Fatalf("inspect output leaked state root: %s", stdout)
	}

	code, stdout, stderr = runCLITest(t,
		"plugin-state-recovery", "recover",
		"--state-root", stateRoot,
		"--expected-plan-sha256", inspect.Plan.PlanSHA256,
	)
	if code != 2 || stdout != "" {
		t.Fatalf("unconfirmed recovery code=%d stdout=%q stderr=%q", code, stdout, stderr)
	}
	unconfirmed := decodePluginStateRecoveryReport(t, stderr)
	if unconfirmed.Code != "confirmation_required" {
		t.Fatalf("unconfirmed report = %#v", unconfirmed)
	}

	code, stdout, stderr = runCLITest(t,
		"plugin-state-recovery", "recover",
		"--state-root", stateRoot,
		"--expected-plan-sha256", strings.Repeat("0", 64),
		"--confirm-retain-archive-and-reset-active-state",
	)
	if code != 1 || stderr != "" {
		t.Fatalf("stale recovery code=%d stdout=%q stderr=%q", code, stdout, stderr)
	}
	stale := decodePluginStateRecoveryReport(t, stdout)
	if stale.Code != "recovery_plan_changed" || strings.Contains(stdout, stateRoot) {
		t.Fatalf("stale report = %#v output=%q", stale, stdout)
	}

	code, stdout, stderr = runCLITest(t,
		"plugin-state-recovery", "recover",
		"--state-root", stateRoot,
		"--expected-plan-sha256", inspect.Plan.PlanSHA256,
		"--confirm-retain-archive-and-reset-active-state",
	)
	if code != 0 || stderr != "" {
		t.Fatalf("recovery code=%d stdout=%q stderr=%q", code, stdout, stderr)
	}
	recovered := decodePluginStateRecoveryReport(t, stdout)
	if recovered.Status != "recovered" || recovered.Code != "plugin_state_recovered" || recovered.Plan == nil || recovered.Plan.PlanSHA256 != inspect.Plan.PlanSHA256 || recovered.RecoveryID == "" || recovered.FreshGenerationID == "" {
		t.Fatalf("recovered report = %#v", recovered)
	}
	if strings.Contains(stdout, stateRoot) {
		t.Fatalf("recovery output leaked state root: %s", stdout)
	}

	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatal(err)
	}
	generation, err := redevpluginintegration.PrepareOwnerScopeGeneration(context.Background(), layout.StateDir)
	if err != nil || generation.Status.FreshGenerationID != recovered.FreshGenerationID {
		t.Fatalf("reopened generation = %#v, %v", generation, err)
	}
}

func TestPluginStateRecoveryCLIRefusesRuntimeLockOwner(t *testing.T) {
	stateRoot := copiedPluginStateRoot(t)
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(layout.StateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	lock, err := lockfile.Acquire(layout.LockPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = lock.Release() }()

	code, stdout, stderr := runCLITest(t, "plugin-state-recovery", "inspect", "--state-root", stateRoot)
	if code != 1 || stderr != "" {
		t.Fatalf("locked inspect code=%d stdout=%q stderr=%q", code, stdout, stderr)
	}
	report := decodePluginStateRecoveryReport(t, stdout)
	if report.Code != "runtime_active" || strings.Contains(stdout, stateRoot) {
		t.Fatalf("locked report = %#v output=%q", report, stdout)
	}
}

func decodePluginStateRecoveryReport(t *testing.T, body string) pluginStateRecoveryReport {
	t.Helper()
	var report pluginStateRecoveryReport
	if err := json.Unmarshal([]byte(body), &report); err != nil {
		t.Fatalf("decode report %q: %v", body, err)
	}
	return report
}

func copiedPluginStateRoot(t *testing.T) string {
	t.Helper()
	sourceRoot := filepath.Join(t.TempDir(), "plugin-root")
	if err := os.MkdirAll(sourceRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	generation, err := ownerscope.PrepareOwnerScopeGeneration(context.Background(), sourceRoot)
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(generation.Path, "storage", "copied-state")
	if err := os.MkdirAll(filepath.Dir(marker), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(marker, []byte("copied plugin state"), 0o600); err != nil {
		t.Fatal(err)
	}

	stateRoot := t.TempDir()
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatal(err)
	}
	destinationRoot := filepath.Join(layout.StateDir, "apps", "redevplugin")
	if err := filepath.WalkDir(sourceRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(sourceRoot, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destinationRoot, relative)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return os.MkdirAll(target, info.Mode().Perm())
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, body, info.Mode().Perm())
	}); err != nil {
		t.Fatal(err)
	}
	return stateRoot
}
