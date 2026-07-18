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
		CreatedAtUnixMs: 100, UpdatedAtUnixMs: 100,
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
	if got, err := store.GetThread(ctx, settings.EndpointID, settings.ThreadID); err != nil || got != nil {
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
		t.Fatalf("commit before EnsureThread error=%v", err)
	}
	operation, err = store.ConfirmThreadCreateFloretEnsured(ctx, operation.OperationID)
	if err != nil || operation.FloretEnsuredAtMS <= 0 {
		t.Fatalf("ConfirmThreadCreateFloretEnsured operation=%#v err=%v", operation, err)
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
