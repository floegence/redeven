package threadstore

import (
	"context"
	"testing"
)

func TestPermissionSnapshotStore_PersistsParentAndChildSnapshotsIdempotently(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openDelegatedApprovalTestStore(t)
	parent := PermissionSnapshotRecord{
		SnapshotID:       "psnap_parent",
		EndpointID:       "env_snap",
		OwnerThreadID:    "thread_parent",
		OwnerRunID:       "run_parent",
		PermissionType:   "approval_required",
		SnapshotJSON:     `{"visible_tool_names":["terminal.exec","subagents"]}`,
		SnapshotHash:     "hash_parent",
		RegistryHash:     "registry_parent",
		SchemaHash:       "schema_parent",
		PresentationHash: "presentation_parent",
		CreatedAtUnixMs:  100,
	}
	if err := store.InsertPermissionSnapshot(ctx, parent); err != nil {
		t.Fatalf("InsertPermissionSnapshot first: %v", err)
	}
	parent.SnapshotJSON = `{"changed":true}`
	if err := store.InsertPermissionSnapshot(ctx, parent); err != nil {
		t.Fatalf("InsertPermissionSnapshot second: %v", err)
	}
	child := ChildPermissionSnapshotRecord{
		ChildSnapshotID:   "psnap_child",
		EndpointID:        "env_snap",
		ParentSnapshotID:  "psnap_parent",
		SpawnToolCallID:   "spawn_1",
		ParentThreadID:    "thread_parent",
		ParentRunID:       "run_parent",
		SubagentID:        "subagent_1",
		ChildThreadID:     "thread_child",
		ChildRunID:        "run_child",
		State:             "finalized",
		SnapshotJSON:      `{"visible_tool_names":["terminal.exec"]}`,
		SnapshotHash:      "hash_child",
		RegistryHash:      "registry_child",
		SchemaHash:        "schema_child",
		PresentationHash:  "presentation_child",
		CreatedAtUnixMs:   200,
		FinalizedAtUnixMs: 201,
	}
	if err := store.InsertChildPermissionSnapshot(ctx, child); err != nil {
		t.Fatalf("InsertChildPermissionSnapshot first: %v", err)
	}
	if err := store.InsertChildPermissionSnapshot(ctx, child); err != nil {
		t.Fatalf("InsertChildPermissionSnapshot second: %v", err)
	}

	var parentCount, childCount int
	if err := store.db.QueryRowContext(ctx, `SELECT count(*) FROM ai_permission_snapshots WHERE snapshot_id = ? AND snapshot_json = ?`, "psnap_parent", `{"visible_tool_names":["terminal.exec","subagents"]}`).Scan(&parentCount); err != nil {
		t.Fatalf("count parent snapshot: %v", err)
	}
	if parentCount != 1 {
		t.Fatalf("parent snapshot count=%d, want 1", parentCount)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT count(*) FROM ai_child_permission_snapshots WHERE child_snapshot_id = ? AND parent_snapshot_id = ? AND state = 'finalized'`, "psnap_child", "psnap_parent").Scan(&childCount); err != nil {
		t.Fatalf("count child snapshot: %v", err)
	}
	if childCount != 1 {
		t.Fatalf("child snapshot count=%d, want 1", childCount)
	}
}
