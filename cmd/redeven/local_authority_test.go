package main

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/lockfile"
)

func TestLocalAuthorityRotateKeyRequiresStateRoot(t *testing.T) {
	code, _, stderr := runCLITest(t, "local-authority", "rotate-key")
	if code != 2 {
		t.Fatalf("exit code = %d, want 2", code)
	}
	var report localAuthorityReport
	if err := json.Unmarshal([]byte(stderr), &report); err != nil {
		t.Fatal(err)
	}
	if report.Code != "state_root_required" {
		t.Fatalf("code = %q, want state_root_required", report.Code)
	}
}

func TestLocalAuthorityRotateKeyRejectsActiveRuntime(t *testing.T) {
	stateRoot := t.TempDir()
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
	code, _, stderr := runCLITest(t, "local-authority", "rotate-key", "--state-root", stateRoot)
	if code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
	var report localAuthorityReport
	if err := json.Unmarshal([]byte(stderr), &report); err != nil {
		t.Fatal(err)
	}
	if report.Code != "runtime_active" {
		t.Fatalf("code = %q, want runtime_active", report.Code)
	}
}
