package threadstore

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai/permissionsnapshot"
)

func permissionSnapshotPayloadForTest(t *testing.T, snapshotID string, permissionType permissionsnapshot.PermissionType) (string, string, string, string, string) {
	t.Helper()
	snapshot := permissionsnapshot.Snapshot{
		Version: permissionsnapshot.VersionCurrent, SnapshotID: snapshotID, PermissionType: permissionType,
		VisibleToolNames: []string{}, PromptCapabilityNames: []string{}, FloretToolNames: []string{},
		ToolPolicies: map[string]permissionsnapshot.ToolPolicy{},
		RegistryHash: "registry_" + snapshotID, SchemaHash: "schema_" + snapshotID, PresentationHash: "presentation_" + snapshotID,
	}
	snapshot.SnapshotHash = permissionsnapshot.Hash(snapshot)
	payload, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	return string(payload), snapshot.SnapshotHash, snapshot.RegistryHash, snapshot.SchemaHash, snapshot.PresentationHash
}

func TestSubAgentPublicationStorePreparesAndFinalizesAuditAtomically(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openStoreForTest(t)
	requestJSON := `{"publication_id":"publication_1","parent_thread_id":"thread_parent","parent_turn_id":"turn_parent","thread_id":"thread_child"}`
	requestHash := sha256.Sum256([]byte(requestJSON))
	childJSON, childHash, childRegistry, childSchema, childPresentation := permissionSnapshotPayloadForTest(t, "psnap_child_publication", permissionsnapshot.PermissionApprovalRequired)
	child := ChildPermissionSnapshotRecord{
		ChildSnapshotID: "psnap_child_publication", EndpointID: "env_publication", ParentSnapshotID: "psnap_parent_publication",
		SpawnToolCallID: "spawn_publication", ParentThreadID: "thread_parent", ParentRunID: "run_parent",
		ChildThreadID: "thread_child", ChildRunID: "run_child", SnapshotJSON: childJSON, SnapshotHash: childHash,
		RegistryHash: childRegistry, SchemaHash: childSchema, PresentationHash: childPresentation, CreatedAtUnixMs: 100,
	}
	operation := SubAgentPublicationOperation{
		PublicationID: "publication_1", EndpointID: "env_publication", ParentThreadID: "thread_parent", ParentTurnID: "turn_parent",
		ParentRunID: "run_parent", SpawnToolCallID: "spawn_publication", ChildThreadID: "thread_child", ChildRunID: "run_child",
		ChildSnapshotID: child.ChildSnapshotID, RequestJSON: requestJSON, RequestHash: hex.EncodeToString(requestHash[:]),
		SessionMetaJSON: `{"endpoint_id":"env_publication"}`, ModelID: "provider/model", ReasoningSelectionJSON: `{}`, CreatedAtUnixMs: 100,
	}
	if err := store.PrepareSubAgentPublication(ctx, operation, child); err != nil {
		t.Fatalf("PrepareSubAgentPublication: %v", err)
	}
	pending, err := store.ListPendingSubAgentPublicationsForParent(ctx, operation.EndpointID, operation.ParentThreadID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || pending[0].PublicationID != operation.PublicationID {
		t.Fatalf("pending publications=%#v", pending)
	}
	if ok, err := store.FinalizeSubAgentPublication(ctx, operation.PublicationID, operation.ChildSnapshotID, operation.ChildThreadID, operation.ChildRunID, 200); err != nil || !ok {
		t.Fatalf("FinalizeSubAgentPublication ok=%v err=%v", ok, err)
	}
	committed, ok, err := store.GetSubAgentPublication(ctx, operation.PublicationID)
	if err != nil || !ok {
		t.Fatalf("GetSubAgentPublication committed=%#v ok=%v err=%v", committed, ok, err)
	}
	if committed.State != SubAgentPublicationCommitted || committed.RequestJSON != "" || committed.SessionMetaJSON != "" || committed.ModelID != "" || committed.ReasoningSelectionJSON != "" {
		t.Fatalf("committed publication retained pending payload: %#v", committed)
	}
	if finalized, ok, err := store.GetFinalizedChildPermissionSnapshot(ctx, operation.EndpointID, operation.ChildThreadID, operation.ChildRunID); err != nil || !ok || finalized.ChildSnapshotID != operation.ChildSnapshotID {
		t.Fatalf("finalized audit=%#v ok=%v err=%v", finalized, ok, err)
	}
	if ok, err := store.FinalizeSubAgentPublication(ctx, operation.PublicationID, operation.ChildSnapshotID, operation.ChildThreadID, operation.ChildRunID, 300); err != nil || !ok {
		t.Fatalf("idempotent finalize ok=%v err=%v", ok, err)
	}
	conflict := operation
	conflict.RequestHash = strings.Repeat("0", 64)
	if err := store.PrepareSubAgentPublication(ctx, conflict, child); err == nil {
		t.Fatal("PrepareSubAgentPublication accepted conflicting committed identity")
	}
}

func TestSubAgentPublicationStoreMarksFailedSpawnTerminal(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openStoreForTest(t)
	requestJSON := `{"publication_id":"publication_failed","parent_thread_id":"thread_parent","parent_turn_id":"turn_parent","thread_id":"thread_child_failed"}`
	requestHash := sha256.Sum256([]byte(requestJSON))
	childJSON, childHash, childRegistry, childSchema, childPresentation := permissionSnapshotPayloadForTest(t, "psnap_child_failed", permissionsnapshot.PermissionApprovalRequired)
	child := ChildPermissionSnapshotRecord{
		ChildSnapshotID: "psnap_child_failed", EndpointID: "env_publication", ParentSnapshotID: "psnap_parent_publication",
		SpawnToolCallID: "spawn_failed", ParentThreadID: "thread_parent", ParentRunID: "run_parent",
		ChildThreadID: "thread_child_failed", ChildRunID: "run_child_failed", SnapshotJSON: childJSON, SnapshotHash: childHash,
		RegistryHash: childRegistry, SchemaHash: childSchema, PresentationHash: childPresentation, CreatedAtUnixMs: 100,
	}
	operation := SubAgentPublicationOperation{
		PublicationID: "publication_failed", EndpointID: "env_publication", ParentThreadID: "thread_parent", ParentTurnID: "turn_parent",
		ParentRunID: "run_parent", SpawnToolCallID: "spawn_failed", ChildThreadID: "thread_child_failed", ChildRunID: "run_child_failed",
		ChildSnapshotID: child.ChildSnapshotID, RequestJSON: requestJSON, RequestHash: hex.EncodeToString(requestHash[:]),
		SessionMetaJSON: `{"endpoint_id":"env_publication"}`, ModelID: "provider/model", ReasoningSelectionJSON: `{}`, CreatedAtUnixMs: 100,
	}
	if err := store.PrepareSubAgentPublication(ctx, operation, child); err != nil {
		t.Fatalf("PrepareSubAgentPublication: %v", err)
	}
	if ok, err := store.FailSubAgentPublication(ctx, operation.PublicationID, operation.ChildSnapshotID, operation.ChildThreadID, operation.ChildRunID, 200); err != nil || !ok {
		t.Fatalf("FailSubAgentPublication ok=%v err=%v", ok, err)
	}
	failed, ok, err := store.GetSubAgentPublication(ctx, operation.PublicationID)
	if err != nil || !ok {
		t.Fatalf("GetSubAgentPublication failed=%#v ok=%v err=%v", failed, ok, err)
	}
	if failed.State != SubAgentPublicationFailed || failed.FailedAtUnixMs != 200 || failed.CommittedAtUnixMs != 0 ||
		failed.RequestJSON != "" || failed.SessionMetaJSON != "" || failed.ModelID != "" || failed.ReasoningSelectionJSON != "" {
		t.Fatalf("failed publication retained replay state: %#v", failed)
	}
	if pending, err := store.ListPendingSubAgentPublications(ctx, 10); err != nil || len(pending) != 0 {
		t.Fatalf("pending publications=%#v err=%v, want none", pending, err)
	}
	if ok, err := store.FailSubAgentPublication(ctx, operation.PublicationID, operation.ChildSnapshotID, operation.ChildThreadID, operation.ChildRunID, 300); err != nil || !ok {
		t.Fatalf("idempotent FailSubAgentPublication ok=%v err=%v", ok, err)
	}
	if err := store.PrepareSubAgentPublication(ctx, operation, child); err == nil {
		t.Fatal("PrepareSubAgentPublication retried a failed publication")
	}
}

func TestPermissionSnapshotStore_PersistsParentAndChildSnapshotsIdempotently(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openStoreForTest(t)
	parentJSON, parentHash, parentRegistry, parentSchema, parentPresentation := permissionSnapshotPayloadForTest(t, "psnap_parent", permissionsnapshot.PermissionApprovalRequired)
	parent := PermissionSnapshotRecord{
		SnapshotID:       "psnap_parent",
		EndpointID:       "env_snap",
		OwnerThreadID:    "thread_parent",
		OwnerRunID:       "run_parent",
		PermissionType:   "approval_required",
		SnapshotJSON:     parentJSON,
		SnapshotHash:     parentHash,
		RegistryHash:     parentRegistry,
		SchemaHash:       parentSchema,
		PresentationHash: parentPresentation,
		CreatedAtUnixMs:  100,
	}
	if err := store.InsertPermissionSnapshot(ctx, parent); err != nil {
		t.Fatalf("InsertPermissionSnapshot first: %v", err)
	}
	parent.SnapshotJSON = `{"changed":true}`
	if err := store.InsertPermissionSnapshot(ctx, parent); err == nil {
		t.Fatal("InsertPermissionSnapshot accepted conflicting duplicate id")
	}
	childJSON, childHash, childRegistry, childSchema, childPresentation := permissionSnapshotPayloadForTest(t, "psnap_child", permissionsnapshot.PermissionApprovalRequired)
	child := ChildPermissionSnapshotRecord{
		ChildSnapshotID:   "psnap_child",
		EndpointID:        "env_snap",
		ParentSnapshotID:  "psnap_parent",
		SpawnToolCallID:   "spawn_1",
		ParentThreadID:    "thread_parent",
		ParentRunID:       "run_parent",
		ChildThreadID:     "thread_child",
		ChildRunID:        "run_child",
		State:             "finalized",
		SnapshotJSON:      childJSON,
		SnapshotHash:      childHash,
		RegistryHash:      childRegistry,
		SchemaHash:        childSchema,
		PresentationHash:  childPresentation,
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
	if err := store.db.QueryRowContext(ctx, `SELECT count(*) FROM ai_permission_snapshots WHERE snapshot_id = ? AND snapshot_json = ?`, "psnap_parent", parentJSON).Scan(&parentCount); err != nil {
		t.Fatalf("count parent snapshot: %v", err)
	}
	if parentCount != 1 {
		t.Fatalf("parent snapshot count=%d, want 1", parentCount)
	}
	gotParent, ok, err := store.GetPermissionSnapshot(ctx, "env_snap", "psnap_parent")
	if err != nil {
		t.Fatalf("GetPermissionSnapshot: %v", err)
	}
	if !ok || gotParent.SnapshotJSON != parentJSON || gotParent.SnapshotHash != parentHash {
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
	childJSON, childHash, childRegistry, childSchema, childPresentation := permissionSnapshotPayloadForTest(t, "psnap_child_provisional", permissionsnapshot.PermissionApprovalRequired)
	child := ChildPermissionSnapshotRecord{
		ChildSnapshotID:  "psnap_child_provisional",
		EndpointID:       "env_snap",
		ParentSnapshotID: "psnap_parent",
		SpawnToolCallID:  "spawn_provisional_1",
		ParentThreadID:   "thread_parent",
		ParentRunID:      "run_parent",
		ChildThreadID:    "thread_child",
		ChildRunID:       "run_child",
		SnapshotJSON:     childJSON,
		SnapshotHash:     childHash,
		RegistryHash:     childRegistry,
		SchemaHash:       childSchema,
		PresentationHash: childPresentation,
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

func TestPermissionSnapshotStoreRejectsIncompleteAuditRecords(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openStoreForTest(t)
	if err := store.InsertPermissionSnapshot(ctx, PermissionSnapshotRecord{
		SnapshotID: "parent_empty_json", EndpointID: "env_snap", OwnerThreadID: "thread_parent", OwnerRunID: "run_parent",
		PermissionType: "approval_required", SnapshotHash: "hash", RegistryHash: "registry", SchemaHash: "schema",
		PresentationHash: "presentation", CreatedAtUnixMs: 1,
	}); err == nil {
		t.Fatal("InsertPermissionSnapshot accepted empty snapshot JSON")
	}
	baseChild := ChildPermissionSnapshotRecord{
		ChildSnapshotID: "child_invalid", EndpointID: "env_snap", ParentSnapshotID: "parent", SpawnToolCallID: "spawn",
		ParentThreadID: "thread_parent", ParentRunID: "run_parent", ChildThreadID: "thread_child", ChildRunID: "run_child",
		SnapshotJSON: `{"version":2}`, SnapshotHash: "hash", RegistryHash: "registry", SchemaHash: "schema",
		PresentationHash: "presentation", CreatedAtUnixMs: 1,
	}
	if err := store.InsertChildPermissionSnapshot(ctx, baseChild); err == nil {
		t.Fatal("InsertChildPermissionSnapshot accepted empty state")
	}
	baseChild.State = "finalized"
	if err := store.InsertChildPermissionSnapshot(ctx, baseChild); err == nil {
		t.Fatal("InsertChildPermissionSnapshot accepted missing finalized time")
	}
}

func TestPermissionSnapshotStoreRejectsTamperedRecordsOnRead(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openStoreForTest(t)
	parentJSON, parentHash, parentRegistry, parentSchema, parentPresentation := permissionSnapshotPayloadForTest(t, "psnap_parent_tampered", permissionsnapshot.PermissionApprovalRequired)
	parent := PermissionSnapshotRecord{
		SnapshotID: "psnap_parent_tampered", EndpointID: "env_snap", OwnerThreadID: "thread_parent", OwnerRunID: "run_parent",
		PermissionType: "approval_required", SnapshotJSON: parentJSON, SnapshotHash: parentHash, RegistryHash: parentRegistry,
		SchemaHash: parentSchema, PresentationHash: parentPresentation, CreatedAtUnixMs: 100,
	}
	if err := store.InsertPermissionSnapshot(ctx, parent); err != nil {
		t.Fatalf("InsertPermissionSnapshot: %v", err)
	}
	childJSON, childHash, childRegistry, childSchema, childPresentation := permissionSnapshotPayloadForTest(t, "psnap_child_tampered", permissionsnapshot.PermissionApprovalRequired)
	child := ChildPermissionSnapshotRecord{
		ChildSnapshotID: "psnap_child_tampered", EndpointID: "env_snap", ParentSnapshotID: parent.SnapshotID,
		SpawnToolCallID: "spawn_tampered", ParentThreadID: "thread_parent", ParentRunID: "run_parent",
		ChildThreadID: "thread_child", ChildRunID: "run_child", State: "finalized", SnapshotJSON: childJSON, SnapshotHash: childHash,
		RegistryHash: childRegistry, SchemaHash: childSchema, PresentationHash: childPresentation, CreatedAtUnixMs: 200, FinalizedAtUnixMs: 201,
	}
	if err := store.InsertChildPermissionSnapshot(ctx, child); err != nil {
		t.Fatalf("InsertChildPermissionSnapshot: %v", err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE ai_permission_snapshots SET snapshot_json = '{"version":1}' WHERE snapshot_id = ?`, parent.SnapshotID); err != nil {
		t.Fatalf("tamper parent snapshot: %v", err)
	}
	if _, ok, err := store.GetPermissionSnapshot(ctx, parent.EndpointID, parent.SnapshotID); err == nil || ok {
		t.Fatalf("GetPermissionSnapshot ok=%v err=%v, want strict v2 rejection", ok, err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE ai_child_permission_snapshots SET snapshot_hash = 'tampered' WHERE child_snapshot_id = ?`, child.ChildSnapshotID); err != nil {
		t.Fatalf("tamper child snapshot: %v", err)
	}
	if _, ok, err := store.GetFinalizedChildPermissionSnapshot(ctx, child.EndpointID, child.ChildThreadID, child.ChildRunID); err == nil || ok {
		t.Fatalf("GetFinalizedChildPermissionSnapshot ok=%v err=%v, want hash rejection", ok, err)
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
