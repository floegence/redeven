package runtimeservice

import (
	"errors"
	"testing"
)

func TestLifecycleFenceMakesAdmissionAndSnapshotAtomic(t *testing.T) {
	manager := NewLifecycleManager()
	first, err := manager.Admit(ManagedWorkload{Identity: "terminal:1", Kind: "terminal"})
	if err != nil {
		t.Fatal(err)
	}
	fence, err := manager.BeginLifecycleFence("op-a", 7)
	if err != nil {
		t.Fatal(err)
	}
	if fence.Snapshot.Impact.Knowledge != WorkloadKnown || len(fence.Snapshot.WorkloadIdentities) != 1 || fence.Snapshot.WorkloadIdentities[0] != "terminal:1" {
		t.Fatalf("snapshot = %#v", fence.Snapshot)
	}
	if _, err := manager.Admit(ManagedWorkload{Identity: "session:2", Kind: "session"}); !errors.Is(err, ErrLifecycleAdmissionClosed) {
		t.Fatalf("admit during fence error = %v", err)
	}
	replayed, err := manager.BeginLifecycleFence("op-a", 7)
	if err != nil || replayed.Token != fence.Token || replayed.Snapshot.SnapshotRevision != fence.Snapshot.SnapshotRevision {
		t.Fatalf("idempotent fence = %#v, %v", replayed, err)
	}
	if _, err := manager.BeginLifecycleFence("op-b", 7); !errors.Is(err, ErrLifecycleFenceHeld) {
		t.Fatalf("second operation fence error = %v", err)
	}
	if err := manager.ReleaseLifecycleFence("stale"); !errors.Is(err, ErrLifecycleFenceToken) {
		t.Fatalf("stale release error = %v", err)
	}
	if err := manager.ReleaseLifecycleFence(fence.Token); err != nil {
		t.Fatal(err)
	}
	second, err := manager.Admit(ManagedWorkload{Identity: "session:2", Kind: "session"})
	if err != nil {
		t.Fatal(err)
	}
	first.Release()
	second.Release()
}

func TestLifecycleShutdownRequiresCurrentFenceToken(t *testing.T) {
	manager := NewLifecycleManager()
	called := 0
	manager.SetShutdown(func() error {
		called++
		return nil
	})
	fence, err := manager.BeginLifecycleFence("op-a", 3)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.RequestShutdown("stale"); !errors.Is(err, ErrLifecycleFenceToken) {
		t.Fatalf("stale shutdown error = %v", err)
	}
	if err := manager.RequestShutdown(fence.Token); err != nil {
		t.Fatal(err)
	}
	if called != 1 {
		t.Fatalf("shutdown calls = %d", called)
	}
}
