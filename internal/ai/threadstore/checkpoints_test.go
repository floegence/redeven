package threadstore

import (
	"context"
	"fmt"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func TestStore_PruneThreadCheckpoints_ReturnsDeletedIDs(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	const endpointID = "env_prune"
	const threadID = "th_prune"
	now := time.Now().UnixMilli()
	if err := s.CreateThread(ctx, Thread{
		ThreadID:              threadID,
		EndpointID:            endpointID,
		NamespacePublicID:     "ns_test",
		ModelID:               "openai/gpt-5-mini",
		WorkingDir:            "/tmp",
		Title:                 "prune",
		RunStatus:             "idle",
		CreatedByUserPublicID: "u1",
		CreatedByUserEmail:    "u1@example.com",
		UpdatedByUserPublicID: "u1",
		UpdatedByUserEmail:    "u1@example.com",
		CreatedAtUnixMs:       now,
		UpdatedAtUnixMs:       now,
	}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	for i := 0; i < 3; i++ {
		checkpointID := "cp_" + leftPadCheckpointIndex(i)
		runID := "run_" + leftPadCheckpointIndex(i)
		if _, err := s.CreateThreadCheckpoint(ctx, endpointID, threadID, checkpointID, runID, CheckpointKindPreRun); err != nil {
			t.Fatalf("CreateThreadCheckpoint %q: %v", checkpointID, err)
		}
	}

	deletedIDs, err := s.PruneThreadCheckpoints(ctx, endpointID, threadID, 1)
	if err != nil {
		t.Fatalf("PruneThreadCheckpoints: %v", err)
	}
	if len(deletedIDs) != 2 {
		t.Fatalf("deleted checkpoint count=%d, want 2", len(deletedIDs))
	}
	if !slices.Contains(deletedIDs, "cp_0000") || !slices.Contains(deletedIDs, "cp_0001") {
		t.Fatalf("deletedIDs=%v, want cp_0000 and cp_0001", deletedIDs)
	}

	checkpointIDs, err := s.ListThreadCheckpointIDs(ctx, endpointID, threadID)
	if err != nil {
		t.Fatalf("ListThreadCheckpointIDs: %v", err)
	}
	if len(checkpointIDs) != 1 || checkpointIDs[0] != "cp_0002" {
		t.Fatalf("checkpointIDs=%v, want [cp_0002]", checkpointIDs)
	}

	allIDs, err := s.ListCheckpointIDs(ctx)
	if err != nil {
		t.Fatalf("ListCheckpointIDs: %v", err)
	}
	if len(allIDs) != 1 || allIDs[0] != "cp_0002" {
		t.Fatalf("allIDs=%v, want [cp_0002]", allIDs)
	}
}

func leftPadCheckpointIndex(v int) string {
	return fmt.Sprintf("%04d", v)
}
