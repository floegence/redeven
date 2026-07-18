package threadreadstate

import (
	"context"
	"path/filepath"
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

	records, err := store.EnsureFlower(ctx, "env_1", "user_1", map[string]FlowerSnapshot{
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
	if record.ScopeID != "user_1" {
		t.Fatalf("ScopeID=%q, want user_1", record.ScopeID)
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

	record, err = store.AdvanceFlower(ctx, "env_1", "user_1", "th_1", FlowerSnapshot{
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

	record, err = store.AdvanceFlower(ctx, "env_1", "user_1", "th_1", FlowerSnapshot{
		ActivityRevision:    130,
		LastMessageAtUnixMs: 120,
		ActivitySignature:   "status:waiting_user\u001factivity:130\u001fprompt:prompt_2",
		WaitingPromptID:     "prompt_2",
	})
	if err != nil {
		t.Fatalf("AdvanceFlower(same revision): %v", err)
	}
	if record.LastSeenActivitySignature != "status:waiting_user\u001factivity:130\u001fprompt:prompt_1" {
		t.Fatalf("LastSeenActivitySignature=%q after same revision, want seeded signature", record.LastSeenActivitySignature)
	}
	if record.LastSeenWaitingPromptID != "prompt_1" {
		t.Fatalf("LastSeenWaitingPromptID=%q after same revision, want=prompt_1", record.LastSeenWaitingPromptID)
	}

	record, err = store.AdvanceFlower(ctx, "env_1", "user_1", "th_1", FlowerSnapshot{
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

	userRecords, err := store.EnsureFlower(ctx, "env_1", "user_1", map[string]FlowerSnapshot{
		"th_1": {
			ActivityRevision:    200,
			LastMessageAtUnixMs: 180,
			ActivitySignature:   "status:success\u001factivity:200",
			WaitingPromptID:     "prompt_2",
		},
	})
	if err != nil {
		t.Fatalf("EnsureFlower(user_1): %v", err)
	}
	if got := userRecords["th_1"].LastReadMessageAtUnixMs; got != 180 {
		t.Fatalf("user_1 LastReadMessageAtUnixMs=%d, want=180", got)
	}
}

func TestStore_FlowerRevisionDoesNotDeriveFromLastMessageAt(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openTestStore(t)

	records, err := store.EnsureFlower(ctx, "env_1", "user_1", map[string]FlowerSnapshot{
		"th_1": {
			ActivityRevision:    2,
			LastMessageAtUnixMs: 5000,
			ActivitySignature:   "activity:2\u001flast_message:5000",
		},
	})
	if err != nil {
		t.Fatalf("EnsureFlower: %v", err)
	}
	if got := records["th_1"].LastSeenActivityRevision; got != 2 {
		t.Fatalf("seed LastSeenActivityRevision=%d, want 2", got)
	}
	if got := records["th_1"].LastReadMessageAtUnixMs; got != 5000 {
		t.Fatalf("seed LastReadMessageAtUnixMs=%d, want 5000", got)
	}

	record, err := store.AdvanceFlower(ctx, "env_1", "user_1", "th_1", FlowerSnapshot{
		ActivityRevision:    3,
		LastMessageAtUnixMs: 6000,
		ActivitySignature:   "activity:3\u001flast_message:6000",
	})
	if err != nil {
		t.Fatalf("AdvanceFlower: %v", err)
	}
	if record.LastSeenActivityRevision != 3 {
		t.Fatalf("advance LastSeenActivityRevision=%d, want 3", record.LastSeenActivityRevision)
	}
	if record.LastReadMessageAtUnixMs != 6000 {
		t.Fatalf("advance LastReadMessageAtUnixMs=%d, want 6000", record.LastReadMessageAtUnixMs)
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

func TestStore_DeleteThreadRemovesSurfaceRecordsIdempotently(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openTestStore(t)

	if _, err := store.EnsureFlower(ctx, "env_1", "user_1", map[string]FlowerSnapshot{
		"th_1": {
			LastMessageAtUnixMs: 120,
			WaitingPromptID:     "prompt_1",
		},
		"th_other": {
			LastMessageAtUnixMs: 90,
			WaitingPromptID:     "prompt_other",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(user_1 first): %v", err)
	}
	if _, err := store.EnsureFlower(ctx, "env_1", "user_1", map[string]FlowerSnapshot{
		"th_1": {
			LastMessageAtUnixMs: 130,
			WaitingPromptID:     "prompt_2",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(user_1 second): %v", err)
	}
	if _, err := store.EnsureFlower(ctx, "env_1", "user_2", map[string]FlowerSnapshot{
		"th_1": {
			LastMessageAtUnixMs: 140,
			WaitingPromptID:     "prompt_user_2",
		},
	}); err != nil {
		t.Fatalf("EnsureFlower(user_2): %v", err)
	}
	if _, err := store.EnsureCodex(ctx, "env_1", "user_1", map[string]CodexSnapshot{
		"th_1": {
			UpdatedAtUnixS:    42,
			ActivitySignature: "status:idle",
		},
	}); err != nil {
		t.Fatalf("EnsureCodex(user_1): %v", err)
	}

	if err := store.DeleteThread(ctx, "env_1", SurfaceFlower, "th_1"); err != nil {
		t.Fatalf("DeleteThread(flower): %v", err)
	}
	var flowerRows int
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM thread_read_state WHERE endpoint_id = ? AND surface = ? AND thread_id = ?`, "env_1", string(SurfaceFlower), "th_1").Scan(&flowerRows); err != nil {
		t.Fatalf("count Flower rows: %v", err)
	}
	if flowerRows != 0 {
		t.Fatalf("Flower rows=%d, want 0", flowerRows)
	}

	if err := store.DeleteThread(ctx, "env_1", SurfaceFlower, "th_1"); err != nil {
		t.Fatalf("DeleteThread(flower, second): %v", err)
	}

	if err := store.DeleteThread(ctx, "env_1", SurfaceCodex, "th_1"); err != nil {
		t.Fatalf("DeleteThread(codex): %v", err)
	}

	if err := store.DeleteThread(ctx, "env_1", SurfaceFlower, "th_other"); err != nil {
		t.Fatalf("DeleteThread(flower other): %v", err)
	}
	if err := store.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM thread_read_state WHERE endpoint_id = ? AND surface = ? AND thread_id = ?`, "env_1", string(SurfaceFlower), "th_other").Scan(&flowerRows); err != nil {
		t.Fatalf("count other Flower rows: %v", err)
	}
	if flowerRows != 0 {
		t.Fatalf("other Flower rows=%d, want 0", flowerRows)
	}
}
