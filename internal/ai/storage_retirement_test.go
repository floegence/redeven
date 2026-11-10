package ai

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestRetireOnlyValidatedAutomaticFlowerBackups(t *testing.T) {
	state, _ := loadFlowerUpgradeFixture(t, "10ce4c152")
	automatic := captureFixtureSnapshot(t, state)
	protected, err := captureFlowerSnapshot(t.Context(), state, "fixture", "before_restore", true)
	if err != nil {
		t.Fatal(err)
	}
	broken := captureFixtureSnapshot(t, state)
	parent := filepath.Join(state, flowerMaintenanceDir, "snapshots")
	if err := os.WriteFile(filepath.Join(parent, broken, "manifest.json"), []byte("unknown"), 0600); err != nil {
		t.Fatal(err)
	}
	live := filepath.Join(state, "ai", "threads.sqlite")
	before, err := os.ReadFile(live)
	if err != nil {
		t.Fatal(err)
	}
	if err := removeObsoleteFlowerSnapshots(t.Context(), state); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(parent, automatic)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("automatic backup remains: %v", err)
	}
	for _, id := range []string{protected.ID, broken} {
		if _, err := os.Stat(filepath.Join(parent, id)); err != nil {
			t.Fatal(err)
		}
	}
	after, err := os.ReadFile(live)
	if err != nil || string(before) != string(after) {
		t.Fatal("live data changed")
	}
	if err := removeObsoleteFlowerSnapshots(t.Context(), state); err != nil {
		t.Fatal(err)
	}
}

func TestRetireFlowerBackupsRefusesPendingReplacementAndSymlinks(t *testing.T) {
	state, _ := loadFlowerUpgradeFixture(t, "10ce4c152")
	id := captureFixtureSnapshot(t, state)
	journal := filepath.Join(state, flowerMaintenanceDir, "restore.json")
	if err := os.WriteFile(journal, []byte("pending"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := removeObsoleteFlowerSnapshots(t.Context(), state); err == nil {
		t.Fatal("cleanup admitted during replacement")
	}
	if _, err := os.Stat(filepath.Join(state, flowerMaintenanceDir, "snapshots", id)); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(journal); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "keep"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	symlink := filepath.Join(state, flowerMaintenanceDir, "snapshots", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if err := os.Symlink(outside, symlink); err != nil {
		t.Fatal(err)
	}
	if err := removeObsoleteFlowerSnapshots(t.Context(), state); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(outside, "keep")); err != nil || string(data) != "keep" {
		t.Fatal("followed snapshot symlink")
	}
}

func TestRetireFlowerBackupsHonorsCancellation(t *testing.T) {
	state, _ := loadFlowerUpgradeFixture(t, "10ce4c152")
	id := captureFixtureSnapshot(t, state)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := removeObsoleteFlowerSnapshots(ctx, state); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel=%v", err)
	}
	if _, err := os.Stat(filepath.Join(state, flowerMaintenanceDir, "snapshots", id)); err != nil {
		t.Fatal(err)
	}
}
