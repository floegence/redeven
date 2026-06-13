package threadreadstate

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()

	store, err := Open(filepath.Join(t.TempDir(), "thread_read_state.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})
	return store
}

func TestStore_EnsureFlowerSeedsMissingBaselineAndAdvanceIsMonotonic(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openTestStore(t)

	records, err := store.EnsureFlower(ctx, "env_1", map[string]FlowerSnapshot{
		"th_1": {
			ActivityRevision:    130,
			LastMessageAtUnixMs: 120,
			ActivitySignature:   "status:waiting_user\u001factivity:130\u001fprompt:prompt_1",
			WaitingPromptID:     "prompt_1",
		},
	})
	if err != nil {
		t.Fatalf("EnsureFlower: %v", err)
	}

	record := records["th_1"]
	if record.ScopeID != FlowerRuntimeScopeID {
		t.Fatalf("ScopeID=%q, want=%q", record.ScopeID, FlowerRuntimeScopeID)
	}
	if record.LastReadMessageAtUnixMs != 120 {
		t.Fatalf("LastReadMessageAtUnixMs=%d, want=120", record.LastReadMessageAtUnixMs)
	}
	if record.LastSeenActivityRevision != 130 {
		t.Fatalf("LastSeenActivityRevision=%d, want=130", record.LastSeenActivityRevision)
	}
	if record.LastSeenActivitySignature != "status:waiting_user\u001factivity:130\u001fprompt:prompt_1" {
		t.Fatalf("LastSeenActivitySignature=%q, want seeded signature", record.LastSeenActivitySignature)
	}
	if record.LastSeenWaitingPromptID != "prompt_1" {
		t.Fatalf("LastSeenWaitingPromptID=%q, want=prompt_1", record.LastSeenWaitingPromptID)
	}

	record, err = store.AdvanceFlower(ctx, "env_1", "th_1", FlowerSnapshot{
		ActivityRevision:    125,
		LastMessageAtUnixMs: 100,
	})
	if err != nil {
		t.Fatalf("AdvanceFlower(regress): %v", err)
	}
	if record.LastReadMessageAtUnixMs != 120 {
		t.Fatalf("LastReadMessageAtUnixMs=%d after regress, want=120", record.LastReadMessageAtUnixMs)
	}
	if record.LastSeenActivityRevision != 130 {
		t.Fatalf("LastSeenActivityRevision=%d after regress, want=130", record.LastSeenActivityRevision)
	}
	if record.LastSeenActivitySignature != "status:waiting_user\u001factivity:130\u001fprompt:prompt_1" {
		t.Fatalf("LastSeenActivitySignature=%q after regress, want seeded signature", record.LastSeenActivitySignature)
	}
	if record.LastSeenWaitingPromptID != "prompt_1" {
		t.Fatalf("LastSeenWaitingPromptID=%q after regress, want=prompt_1", record.LastSeenWaitingPromptID)
	}

	record, err = store.AdvanceFlower(ctx, "env_1", "th_1", FlowerSnapshot{
		ActivityRevision:    130,
		LastMessageAtUnixMs: 120,
		ActivitySignature:   "status:waiting_user\u001factivity:130\u001fprompt:prompt_2",
		WaitingPromptID:     "prompt_2",
	})
	if err != nil {
		t.Fatalf("AdvanceFlower(same revision): %v", err)
	}
	if record.LastSeenActivitySignature != "status:waiting_user\u001factivity:130\u001fprompt:prompt_2" {
		t.Fatalf("LastSeenActivitySignature=%q after same revision, want current signature", record.LastSeenActivitySignature)
	}
	if record.LastSeenWaitingPromptID != "prompt_2" {
		t.Fatalf("LastSeenWaitingPromptID=%q after same revision, want=prompt_2", record.LastSeenWaitingPromptID)
	}

	record, err = store.AdvanceFlower(ctx, "env_1", "th_1", FlowerSnapshot{
		ActivityRevision:    200,
		LastMessageAtUnixMs: 180,
		ActivitySignature:   "status:success\u001factivity:200",
		WaitingPromptID:     "prompt_2",
	})
	if err != nil {
		t.Fatalf("AdvanceFlower(progress): %v", err)
	}
	if record.LastReadMessageAtUnixMs != 180 {
		t.Fatalf("LastReadMessageAtUnixMs=%d after progress, want=180", record.LastReadMessageAtUnixMs)
	}
	if record.LastSeenActivityRevision != 200 {
		t.Fatalf("LastSeenActivityRevision=%d after progress, want=200", record.LastSeenActivityRevision)
	}
	if record.LastSeenActivitySignature != "status:success\u001factivity:200" {
		t.Fatalf("LastSeenActivitySignature=%q after progress, want updated signature", record.LastSeenActivitySignature)
	}
	if record.LastSeenWaitingPromptID != "prompt_2" {
		t.Fatalf("LastSeenWaitingPromptID=%q after progress, want=prompt_2", record.LastSeenWaitingPromptID)
	}

	runtimeRecords, err := store.EnsureFlower(ctx, "env_1", map[string]FlowerSnapshot{
		"th_1": {
			ActivityRevision:    200,
			LastMessageAtUnixMs: 180,
			ActivitySignature:   "status:success\u001factivity:200",
			WaitingPromptID:     "prompt_2",
		},
	})
	if err != nil {
		t.Fatalf("EnsureFlower(runtime): %v", err)
	}
	if got := runtimeRecords["th_1"].LastReadMessageAtUnixMs; got != 180 {
		t.Fatalf("runtime LastReadMessageAtUnixMs=%d, want=180", got)
	}
}

func TestStore_EnsureCodexSeedsMissingBaselineAndAdvanceIsMonotonic(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openTestStore(t)

	records, err := store.EnsureCodex(ctx, "env_1", "user_1", map[string]CodexSnapshot{
		"thread_1": {
			UpdatedAtUnixS:    42,
			ActivitySignature: "status:idle",
		},
	})
	if err != nil {
		t.Fatalf("EnsureCodex: %v", err)
	}

	record := records["thread_1"]
	if record.LastReadUpdatedAtUnixS != 42 {
		t.Fatalf("LastReadUpdatedAtUnixS=%d, want=42", record.LastReadUpdatedAtUnixS)
	}
	if record.LastSeenActivitySignature != "status:idle" {
		t.Fatalf("LastSeenActivitySignature=%q, want=status:idle", record.LastSeenActivitySignature)
	}

	record, err = store.AdvanceCodex(ctx, "env_1", "user_1", "thread_1", CodexSnapshot{
		UpdatedAtUnixS:    40,
		ActivitySignature: "",
	})
	if err != nil {
		t.Fatalf("AdvanceCodex(regress): %v", err)
	}
	if record.LastReadUpdatedAtUnixS != 42 {
		t.Fatalf("LastReadUpdatedAtUnixS=%d after regress, want=42", record.LastReadUpdatedAtUnixS)
	}
	if record.LastSeenActivitySignature != "status:idle" {
		t.Fatalf("LastSeenActivitySignature=%q after regress, want=status:idle", record.LastSeenActivitySignature)
	}

	record, err = store.AdvanceCodex(ctx, "env_1", "user_1", "thread_1", CodexSnapshot{
		UpdatedAtUnixS:    88,
		ActivitySignature: "status:waiting_user\u001frequest:req_1",
	})
	if err != nil {
		t.Fatalf("AdvanceCodex(progress): %v", err)
	}
	if record.LastReadUpdatedAtUnixS != 88 {
		t.Fatalf("LastReadUpdatedAtUnixS=%d after progress, want=88", record.LastReadUpdatedAtUnixS)
	}
	if record.LastSeenActivitySignature != "status:waiting_user\u001frequest:req_1" {
		t.Fatalf("LastSeenActivitySignature=%q after progress, want updated signature", record.LastSeenActivitySignature)
	}
}

func TestStore_DeleteThreadRemovesSurfaceRecordsAndRestoreRecords(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openTestStore(t)

	if _, err := store.EnsureFlower(ctx, "env_1", map[string]FlowerSnapshot{
		"th_1": {
			LastMessageAtUnixMs: 120,
			WaitingPromptID:     "prompt_1",
		},
		"th_other": {
			LastMessageAtUnixMs: 90,
			WaitingPromptID:     "prompt_other",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(runtime first): %v", err)
	}
	if _, err := store.EnsureFlower(ctx, "env_1", map[string]FlowerSnapshot{
		"th_1": {
			LastMessageAtUnixMs: 130,
			WaitingPromptID:     "prompt_2",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(runtime second): %v", err)
	}
	if _, err := store.EnsureCodex(ctx, "env_1", "user_1", map[string]CodexSnapshot{
		"th_1": {
			UpdatedAtUnixS:    42,
			ActivitySignature: "status:idle",
		},
	}); err != nil {
		t.Fatalf("EnsureCodex(user_1): %v", err)
	}

	deleted, err := store.DeleteThread(ctx, "env_1", SurfaceFlower, "th_1")
	if err != nil {
		t.Fatalf("DeleteThread(flower): %v", err)
	}
	if len(deleted) != 1 {
		t.Fatalf("len(deleted)=%d, want 1", len(deleted))
	}
	if deleted[0].ScopeID != FlowerRuntimeScopeID {
		t.Fatalf("deleted scope=%q, want %q", deleted[0].ScopeID, FlowerRuntimeScopeID)
	}

	redeleted, err := store.DeleteThread(ctx, "env_1", SurfaceFlower, "th_1")
	if err != nil {
		t.Fatalf("DeleteThread(flower, second): %v", err)
	}
	if len(redeleted) != 0 {
		t.Fatalf("len(redeleted)=%d, want 0", len(redeleted))
	}

	codexDeleted, err := store.DeleteThread(ctx, "env_1", SurfaceCodex, "th_1")
	if err != nil {
		t.Fatalf("DeleteThread(codex): %v", err)
	}
	if len(codexDeleted) != 1 {
		t.Fatalf("len(codexDeleted)=%d, want 1", len(codexDeleted))
	}

	if err := store.RestoreRecords(ctx, deleted); err != nil {
		t.Fatalf("RestoreRecords: %v", err)
	}
	restoredDeleted, err := store.DeleteThread(ctx, "env_1", SurfaceFlower, "th_1")
	if err != nil {
		t.Fatalf("DeleteThread(flower after restore): %v", err)
	}
	if !reflect.DeepEqual(restoredDeleted, deleted) {
		t.Fatalf("restoredDeleted=%+v, want %+v", restoredDeleted, deleted)
	}

	otherDeleted, err := store.DeleteThread(ctx, "env_1", SurfaceFlower, "th_other")
	if err != nil {
		t.Fatalf("DeleteThread(flower other): %v", err)
	}
	if len(otherDeleted) != 1 || otherDeleted[0].ScopeID != FlowerRuntimeScopeID {
		t.Fatalf("otherDeleted=%+v, want one runtime scope record", otherDeleted)
	}
}
