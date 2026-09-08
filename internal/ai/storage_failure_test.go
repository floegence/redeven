package ai

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFlowerPreparationCancellationNeverExecutes(t *testing.T) {
	for _, phase := range []FloretStoreStartupPhase{FloretStoreStartupInspecting, FloretStoreStartupBackingUp, FloretStoreStartupVerifying} {
		t.Run(string(phase), func(t *testing.T) {
			state, _ := loadFlowerUpgradeFixture(t, "10ce4c152-lifecycle")
			opts := fixtureMaintenanceOptions(t, state)
			calls := fixtureModelServer(t, &opts)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			opts.DeferExecution = false
			opts.StoreStartupProgress = func(current FloretStoreStartupPhase) {
				if current == phase {
					cancel()
				}
			}
			svc, err := NewServiceContext(ctx, opts)
			if svc != nil {
				_ = svc.Close()
				t.Fatal("cancelled preparation returned a service")
			}
			if !errors.Is(err, context.Canceled) || calls.Load() != 0 {
				t.Fatalf("cancel=%v calls=%d", err, calls.Load())
			}
		})
	}
}

func TestFlowerBackupFailurePreservesSourceAndPreventsExecution(t *testing.T) {
	state, _ := loadFlowerUpgradeFixture(t, "10ce4c152-lifecycle")
	opts := fixtureMaintenanceOptions(t, state)
	calls := fixtureModelServer(t, &opts)
	before, err := hashFlowerFiles(t.Context(), filepath.Join(state, "ai"))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(state, flowerMaintenanceDir)
	if err := os.MkdirAll(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "snapshots"), []byte("occupied"), 0600); err != nil {
		t.Fatal(err)
	}
	svc, err := NewServiceContext(t.Context(), opts)
	if svc != nil || err == nil || calls.Load() != 0 {
		t.Fatalf("backup failure=%v calls=%d", err, calls.Load())
	}
	after, err := hashFlowerFiles(t.Context(), filepath.Join(state, "ai"))
	if err != nil {
		t.Fatal(err)
	}
	if len(before) != len(after) {
		t.Fatal("backup failure changed source file set")
	}
	for i := range before {
		if before[i] != after[i] {
			t.Fatal("backup failure changed source bytes")
		}
	}
}

func TestFlowerSnapshotRetentionProtectsRecoveryAndListsDamagedBackups(t *testing.T) {
	state, _ := loadFlowerUpgradeFixture(t, "10ce4c152")
	var ids []string
	for i := 0; i < 6; i++ {
		m, err := captureFlowerSnapshot(t.Context(), state, "test", "automatic", false)
		if err != nil {
			t.Fatal(err)
		}
		m.CreatedAt = time.Unix(int64(i+1), 0).UTC()
		if err := writeMaintenanceJSON(filepath.Join(state, flowerMaintenanceDir, "snapshots", m.ID, "manifest.json"), m); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, m.ID)
	}
	if err := writeMaintenanceJSON(flowerOperationPath(state), flowerUpgradeOperation{Format: 1, TargetBuild: "test", OriginalSnapshot: ids[0]}); err != nil {
		t.Fatal(err)
	}
	scene, err := captureFlowerSnapshot(t.Context(), state, "test", "before_restore", true)
	if err != nil {
		t.Fatal(err)
	}
	broken := filepath.Join(state, flowerMaintenanceDir, "snapshots", ids[1], "manifest.json")
	if err := os.WriteFile(broken, []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := pruneFlowerSnapshots(t.Context(), state); err != nil {
		t.Fatal(err)
	}
	items, err := ListFlowerSnapshots(t.Context(), state)
	if err != nil || len(items) != 6 {
		t.Fatalf("retention=%+v %v", items, err)
	}
	found := make(map[string]FlowerSnapshotSummary)
	for _, item := range items {
		found[item.ID] = item
	}
	if !found[ids[0]].Protected || !found[scene.ID].Protected || !found[ids[1]].Unavailable {
		t.Fatalf("protected snapshots=%+v", found)
	}
	if _, exists := found[ids[2]]; exists {
		t.Fatal("unprotected old automatic snapshot was retained")
	}
}

func TestFlowerMaintenanceRejectsSymlinksAndOversizedJSON(t *testing.T) {
	state, _ := loadFlowerUpgradeFixture(t, "10ce4c152")
	out := t.TempDir()
	if err := os.Symlink(out, filepath.Join(state, flowerMaintenanceDir)); err != nil {
		t.Fatal(err)
	}
	if _, err := NewServiceContext(t.Context(), fixtureMaintenanceOptions(t, state)); err == nil {
		t.Fatal("followed maintenance symlink")
	}
	entries, err := os.ReadDir(out)
	if err != nil || len(entries) != 0 {
		t.Fatal("modified symlink target")
	}
	path := filepath.Join(t.TempDir(), "large.json")
	if err := os.WriteFile(path, append([]byte("{}"), bytes.Repeat([]byte(" "), 32<<20)...), 0600); err != nil {
		t.Fatal(err)
	}
	if err := readMaintenanceJSON(path, &struct{}{}); err == nil {
		t.Fatal("accepted oversized JSON")
	}
}
