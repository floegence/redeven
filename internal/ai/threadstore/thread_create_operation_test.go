package threadstore

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestThreadCreateOperationCommitsSettingsOnlyAfterCanonicalSteps(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	settings := ThreadSettings{
		ThreadID: "thread_create", EndpointID: "env_create", NamespacePublicID: "ns_create",
		ModelID: "openai/gpt-5", PermissionType: "approval_required", WorkingDir: "/workspace",
		CreatedByUserPublicID: "user_1", UpdatedByUserPublicID: "user_1",
		SettingsCreatedAtUnixMs: 100, SettingsUpdatedAtUnixMs: 100,
	}
	operation, err := store.PrepareThreadCreateOperation(ctx, PrepareThreadCreateRequest{
		Settings: settings, ExplicitTitle: "Canonical title", CreatedAtMS: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	if operation.Status != ThreadCreateOperationPending || operation.Settings.ThreadID != settings.ThreadID || operation.ExplicitTitle != "Canonical title" {
		t.Fatalf("prepared operation=%#v", operation)
	}
	if got, err := store.GetThreadSettings(ctx, settings.EndpointID, settings.ThreadID); err != nil || got != nil {
		t.Fatalf("settings existed before canonical Floret steps: %#v err=%v", got, err)
	}
	var snapshot map[string]any
	if err := json.Unmarshal([]byte(operation.SnapshotJSON), &snapshot); err != nil {
		t.Fatal(err)
	}
	settingsSnapshot, _ := snapshot["settings"].(map[string]any)
	for _, forbidden := range []string{"title", "status", "phase", "latest_turn", "last_message_preview"} {
		if _, exists := settingsSnapshot[forbidden]; exists {
			t.Fatalf("create snapshot copied canonical field %q: %#v", forbidden, settingsSnapshot)
		}
	}
	if _, err := store.CommitThreadCreateSettings(ctx, operation.OperationID); err == nil || !strings.Contains(err.Error(), "canonical Floret thread") {
		t.Fatalf("commit before CreateThread error=%v", err)
	}
	operation, err = store.ConfirmThreadCreateFloretCreated(ctx, operation.OperationID)
	if err != nil || operation.FloretCreatedAtMS <= 0 {
		t.Fatalf("ConfirmThreadCreateFloretCreated operation=%#v err=%v", operation, err)
	}
	if _, err := store.CommitThreadCreateSettings(ctx, operation.OperationID); err == nil || !strings.Contains(err.Error(), "canonical title") {
		t.Fatalf("commit before SetThreadTitle error=%v", err)
	}
	operation, err = store.ConfirmThreadCreateTitleSet(ctx, operation.OperationID)
	if err != nil || operation.TitleSetAtMS <= 0 {
		t.Fatalf("ConfirmThreadCreateTitleSet operation=%#v err=%v", operation, err)
	}
	committed, err := store.CommitThreadCreateSettings(ctx, operation.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	if committed.ThreadID != settings.ThreadID || committed.ModelID != settings.ModelID {
		t.Fatalf("committed settings=%#v", committed)
	}
	replayed, err := store.CommitThreadCreateSettings(ctx, operation.OperationID)
	if err != nil || replayed.ThreadID != committed.ThreadID {
		t.Fatalf("idempotent commit settings=%#v err=%v", replayed, err)
	}
	operation, err = store.GetThreadCreateOperation(ctx, operation.OperationID)
	if err != nil || operation.Status != ThreadCreateOperationCommitted || operation.SnapshotJSON != "" || operation.SettingsCommittedAtMS <= 0 {
		t.Fatalf("committed operation=%#v err=%v", operation, err)
	}
}

func TestThreadCreateOperationRejectsConflictingIntent(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	request := PrepareThreadCreateRequest{
		Settings:      ThreadSettings{ThreadID: "thread_conflict", EndpointID: "env_create", PermissionType: "approval_required"},
		ExplicitTitle: "First", CreatedAtMS: 100,
	}
	first, err := store.PrepareThreadCreateOperation(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := store.PrepareThreadCreateOperation(ctx, request)
	if err != nil || repeated.OperationID != first.OperationID || repeated.RequestFingerprint != first.RequestFingerprint {
		t.Fatalf("idempotent prepare=%#v err=%v", repeated, err)
	}
	request.ExplicitTitle = "Different"
	if _, err := store.PrepareThreadCreateOperation(ctx, request); err == nil || !strings.Contains(err.Error(), "conflicts") {
		t.Fatalf("conflicting prepare error=%v", err)
	}
}

func TestThreadCreateOperationRejectsDamagedPendingSnapshot(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		updateSQL  string
		updateArgs []any
		want       string
	}{
		{name: "empty", updateSQL: `UPDATE ai_thread_create_operations SET snapshot_json = '' WHERE operation_id = ?`, want: "snapshot is empty"},
		{name: "unknown field", updateSQL: `UPDATE ai_thread_create_operations SET snapshot_json = json_set(snapshot_json, '$.unknown', 1) WHERE operation_id = ?`, want: "unknown field"},
		{name: "identity mismatch", updateSQL: `UPDATE ai_thread_create_operations SET snapshot_json = replace(snapshot_json, 'thread_damage', 'thread_other') WHERE operation_id = ?`, want: "identity mismatch"},
		{name: "fingerprint mismatch", updateSQL: `UPDATE ai_thread_create_operations SET request_fingerprint = 'damaged' WHERE operation_id = ?`, want: "fingerprint mismatch"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			store := openStoreForTest(t)
			ctx := context.Background()
			operation, err := store.PrepareThreadCreateOperation(ctx, PrepareThreadCreateRequest{
				Settings:    ThreadSettings{ThreadID: "thread_damage", EndpointID: "env_damage", PermissionType: "approval_required"},
				CreatedAtMS: 100,
			})
			if err != nil {
				t.Fatal(err)
			}
			args := append(append([]any(nil), testCase.updateArgs...), operation.OperationID)
			if _, err := store.db.ExecContext(ctx, testCase.updateSQL, args...); err != nil {
				t.Fatal(err)
			}
			if _, err := store.GetThreadCreateOperation(ctx, operation.OperationID); err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("GetThreadCreateOperation error=%v, want %q", err, testCase.want)
			}
			if _, err := store.CommitThreadCreateSettings(ctx, operation.OperationID); err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("CommitThreadCreateSettings error=%v, want %q", err, testCase.want)
			}
		})
	}
}
