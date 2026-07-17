package threadstore

import (
	"context"
	"testing"
)

func TestPermissionSnapshotStore_PersistsParentAndChildSnapshotsIdempotently(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openStoreForTest(t)
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
	gotParent, ok, err := store.GetPermissionSnapshot(ctx, "env_snap", "psnap_parent")
	if err != nil {
		t.Fatalf("GetPermissionSnapshot: %v", err)
	}
	if !ok || gotParent.SnapshotJSON != `{"visible_tool_names":["terminal.exec","subagents"]}` || gotParent.SnapshotHash != "hash_parent" {
		t.Fatalf("parent snapshot lookup=%#v ok=%v", gotParent, ok)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT count(*) FROM ai_child_permission_snapshots WHERE child_snapshot_id = ? AND parent_snapshot_id = ? AND state = 'finalized'`, "psnap_child", "psnap_parent").Scan(&childCount); err != nil {
		t.Fatalf("count child snapshot: %v", err)
	}
	if childCount != 1 {
		t.Fatalf("child snapshot count=%d, want 1", childCount)
	}
}

func TestPermissionSnapshotStore_FinalizesProvisionalChildSnapshot(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openStoreForTest(t)
	child := ChildPermissionSnapshotRecord{
		ChildSnapshotID:  "psnap_child_provisional",
		EndpointID:       "env_snap",
		ParentSnapshotID: "psnap_parent",
		SpawnToolCallID:  "spawn_provisional_1",
		ParentThreadID:   "thread_parent",
		ParentRunID:      "run_parent",
		SubagentID:       "subagent_1",
		ChildThreadID:    "thread_child",
		ChildRunID:       "run_child",
		SnapshotJSON:     `{"visible_tool_names":["terminal.exec"]}`,
		SnapshotHash:     "hash_child",
		CreatedAtUnixMs:  200,
	}
	if err := store.InsertChildPermissionSnapshotProvisional(ctx, child); err != nil {
		t.Fatalf("InsertChildPermissionSnapshotProvisional: %v", err)
	}
	if rec, ok, err := store.GetFinalizedChildPermissionSnapshotByThread(ctx, "env_snap", "thread_child"); err != nil {
		t.Fatalf("GetFinalizedChildPermissionSnapshotByThread before finalize: %v", err)
	} else if ok {
		t.Fatalf("provisional snapshot returned as finalized: %#v", rec)
	}
	provisional, ok, err := store.GetChildPermissionSnapshotBySpawnToolCall(ctx, "env_snap", "spawn_provisional_1")
	if err != nil {
		t.Fatalf("GetChildPermissionSnapshotBySpawnToolCall: %v", err)
	}
	if !ok || provisional.State != "provisional" || provisional.FinalizedAtUnixMs != 0 {
		t.Fatalf("provisional lookup=%#v ok=%v", provisional, ok)
	}
	finalized, err := store.FinalizeChildPermissionSnapshot(ctx, "env_snap", "psnap_child_provisional", "thread_child", "run_child", 250)
	if err != nil {
		t.Fatalf("FinalizeChildPermissionSnapshot: %v", err)
	}
	if !finalized {
		t.Fatalf("FinalizeChildPermissionSnapshot returned false")
	}
	finalizedAgain, err := store.FinalizeChildPermissionSnapshot(ctx, "env_snap", "psnap_child_provisional", "thread_child", "run_child", 300)
	if err != nil {
		t.Fatalf("FinalizeChildPermissionSnapshot second: %v", err)
	}
	if finalizedAgain {
		t.Fatalf("second finalize should not update already finalized snapshot")
	}
	got, ok, err := store.GetFinalizedChildPermissionSnapshotByThread(ctx, "env_snap", "thread_child")
	if err != nil {
		t.Fatalf("GetFinalizedChildPermissionSnapshotByThread after finalize: %v", err)
	}
	if !ok || got.State != "finalized" || got.FinalizedAtUnixMs != 250 {
		t.Fatalf("finalized lookup=%#v ok=%v", got, ok)
	}
	exact, ok, err := store.GetFinalizedChildPermissionSnapshot(ctx, "env_snap", "thread_child", "run_child")
	if err != nil {
		t.Fatalf("GetFinalizedChildPermissionSnapshot exact: %v", err)
	}
	if !ok || exact.ChildSnapshotID != "psnap_child_provisional" || exact.ChildRunID != "run_child" {
		t.Fatalf("exact finalized lookup=%#v ok=%v", exact, ok)
	}
	if mismatched, ok, err := store.GetFinalizedChildPermissionSnapshot(ctx, "env_snap", "thread_child", "run_other"); err != nil {
		t.Fatalf("GetFinalizedChildPermissionSnapshot mismatched: %v", err)
	} else if ok {
		t.Fatalf("mismatched child run lookup returned snapshot: %#v", mismatched)
	}
}

func TestPermissionSnapshotStore_RejectsInvalidChildRunIdentity(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openStoreForTest(t)
	base := ChildPermissionSnapshotRecord{
		ChildSnapshotID:   "psnap_child_identity",
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
	for _, tc := range []struct {
		name       string
		childRunID string
	}{
		{name: "missing", childRunID: ""},
		{name: "thread_alias", childRunID: "thread_child"},
		{name: "parent_alias", childRunID: "run_parent"},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rec := base
			rec.ChildSnapshotID += "_" + tc.name
			rec.ChildRunID = tc.childRunID
			if err := store.InsertChildPermissionSnapshot(ctx, rec); err == nil {
				t.Fatalf("InsertChildPermissionSnapshot accepted child_run_id=%q", tc.childRunID)
			}
		})
	}
}
