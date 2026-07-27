package gitrepo

import "testing"

func TestWorkspaceSnapshotStoreCloseDefersPinnedResourceRelease(t *testing.T) {
	store := newWorkspaceSnapshotStore()
	snapshot := &immutableWorkspaceSnapshot{
		identity:      "worktree",
		revision:      "revision",
		retainedBytes: 1024,
	}
	if err := store.publish(snapshot); err != nil {
		t.Fatal(err)
	}
	_, release, err := store.pin(snapshot.identity, snapshot.revision)
	if err != nil {
		t.Fatal(err)
	}
	store.close()
	store.mu.Lock()
	retainedWhilePinned := store.entries[workspaceSnapshotKey(snapshot.identity, snapshot.revision)] == snapshot
	store.mu.Unlock()
	if !retainedWhilePinned {
		t.Fatal("close released a pinned snapshot")
	}
	release()
	store.mu.Lock()
	remaining := len(store.entries)
	store.mu.Unlock()
	if remaining != 0 {
		t.Fatalf("entries after final pin release = %d, want 0", remaining)
	}
}
