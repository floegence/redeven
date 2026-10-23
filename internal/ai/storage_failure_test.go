package ai

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

type deletedSummaryThreadRuntime struct{ flruntime.ThreadService }

func (deletedSummaryThreadRuntime) Summary(context.Context, identity.ThreadID) (flruntime.ThreadSummary, error) {
	return flruntime.ThreadSummary{}, flruntime.ErrThreadDeleted
}

func TestStartupPreparationSkipsDeletedCanonicalThread(t *testing.T) {
	service := newSendTurnTestService(t)
	if _, err := service.CreateThread(t.Context(), testSendTurnMeta(), "deleted during recovery", "", "", ""); err != nil {
		t.Fatal(err)
	}
	service.threadRuntime = deletedSummaryThreadRuntime{ThreadService: service.threadRuntime}
	if err := service.prepareStartupThreads(t.Context()); err != nil {
		t.Fatalf("deleted canonical thread blocked startup preparation: %v", err)
	}
}

func TestFlowerPreparationWaitCancellationDoesNotStopWorker(t *testing.T) {
	state, _ := loadFlowerUpgradeFixture(t, "10ce4c152-lifecycle")
	opts := fixtureMaintenanceOptions(t, state)
	calls := fixtureModelServer(t, &opts)
	opts.DeferExecution = true
	started, release := make(chan struct{}), make(chan struct{})
	releaseWorker := func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}
	opts.StoreStartupProgress = func(phase FloretStoreStartupPhase) {
		if phase == FloretStoreStartupPreparing {
			close(started)
			<-release
		}
	}
	svc, err := NewServiceContext(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		releaseWorker()
		_ = svc.Close()
	})
	svc.startStartupPreparation()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("startup preparation did not start")
	}
	waitCtx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := svc.waitForStartupPreparation(waitCtx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled wait = %v, want context cancellation", err)
	}
	svc.startupPreparationMu.Lock()
	stillRunning := svc.startupPreparationRun
	svc.startupPreparationMu.Unlock()
	if !stillRunning {
		t.Fatal("cancelling the wait stopped the Host-owned worker")
	}
	releaseWorker()
	waitCtx, cancel = context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	if err := svc.waitForStartupPreparation(waitCtx); err != nil {
		t.Fatalf("preparation after cancelled wait: %v", err)
	}
	if calls.Load() != 0 {
		t.Fatalf("startup preparation dispatched %d provider requests", calls.Load())
	}
}

func TestFlowerDeferredServiceDoesNotStartProductRecovery(t *testing.T) {
	state, _ := loadFlowerUpgradeFixture(t, "10ce4c152-lifecycle")
	opts := fixtureMaintenanceOptions(t, state)
	opts.DeferExecution = true
	providerCalls := fixtureModelServer(t, &opts)
	var preparationCalls atomic.Int32
	opts.StoreStartupProgress = func(phase FloretStoreStartupPhase) {
		if phase == FloretStoreStartupPreparing {
			preparationCalls.Add(1)
		}
	}
	service, err := NewServiceContext(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	if preparationCalls.Load() != 0 || providerCalls.Load() != 0 {
		t.Fatalf("deferred service started preparation=%d provider=%d", preparationCalls.Load(), providerCalls.Load())
	}
}

func TestFlowerPreparationIgnoresDamagedHistoricalSnapshots(t *testing.T) {
	state, _ := loadFlowerUpgradeFixture(t, "10ce4c152-lifecycle")
	opts := fixtureMaintenanceOptions(t, state)
	path := filepath.Join(state, flowerMaintenanceDir, "snapshots", "00000000000000000000000000000000")
	if err := os.MkdirAll(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "manifest.json"), []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	service, err := NewServiceContext(t.Context(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Activate(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	snapshots, err := ListFlowerSnapshots(t.Context(), state)
	if err != nil || len(snapshots) != 1 || !snapshots[0].Unavailable {
		t.Fatalf("snapshots=%+v %v", snapshots, err)
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
	scene, err := captureFlowerSnapshot(t.Context(), state, "test", "before_restore", true)
	if err != nil {
		t.Fatal(err)
	}
	broken := filepath.Join(state, flowerMaintenanceDir, "snapshots", ids[1], "manifest.json")
	if err := os.WriteFile(broken, []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	items, err := ListFlowerSnapshots(t.Context(), state)
	if err != nil || len(items) != 7 {
		t.Fatalf("retention=%+v %v", items, err)
	}
	found := make(map[string]FlowerSnapshotSummary)
	for _, item := range items {
		found[item.ID] = item
	}
	if !found[scene.ID].Protected || !found[ids[1]].Unavailable {
		t.Fatalf("protected snapshots=%+v", found)
	}
	if _, exists := found[ids[2]]; !exists {
		t.Fatal("historical snapshot was removed")
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
