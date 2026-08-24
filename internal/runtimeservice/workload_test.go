package runtimeservice

import (
	"testing"
)

func TestWorkloadAdmissionTracksSessionsWithoutLifecycleControl(t *testing.T) {
	manager := NewWorkloadManager()
	first, err := manager.Admit(ManagedWorkload{Identity: "terminal:1", Kind: "terminal"})
	if err != nil {
		t.Fatalf("Admit() error = %v", err)
	}
	if _, err := manager.Admit(ManagedWorkload{Identity: "terminal:1", Kind: "terminal"}); err == nil {
		t.Fatal("duplicate workload admission unexpectedly succeeded")
	}
	snapshot := manager.Snapshot()
	if snapshot.Impact.Knowledge != WorkloadKnown || snapshot.Impact.AffectedProcessCount == nil || *snapshot.Impact.AffectedProcessCount != 1 {
		t.Fatalf("Snapshot() = %#v, want one known workload", snapshot)
	}
	first.Release()
	if got := manager.Snapshot().Impact.AffectedProcessCount; got == nil || *got != 0 {
		t.Fatalf("Snapshot() after release = %#v, want zero workloads", manager.Snapshot())
	}
}

func TestWorkloadAdmissionCanMarkInventoryUnknown(t *testing.T) {
	manager := NewWorkloadManager()
	manager.SetInventoryUnknown(true)
	snapshot := manager.Snapshot()
	if snapshot.Impact.Knowledge != WorkloadUnknown || snapshot.ProcessInventoryDigest != "unknown" {
		t.Fatalf("unknown Snapshot() = %#v", snapshot)
	}
}
