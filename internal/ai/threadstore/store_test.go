package threadstore

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

func TestStoreSchemaContainsOnlyProductThreadState(t *testing.T) {
	store := openStoreForTest(t)
	wantTables := []string{
		"__redeven_db_meta",
		"ai_child_permission_snapshots",
		"ai_composer_drafts",
		"ai_flower_thread_routing",
		"ai_permission_snapshots",
		"ai_queued_turns",
		"ai_subagent_publication_operations",
		"ai_thread_create_operations",
		"ai_thread_delete_operations",
		"ai_thread_fork_operations",
		"ai_thread_settings",
		"ai_upload_attempts",
		"ai_upload_refs",
		"ai_uploads",
		"provider_capabilities",
	}
	gotTables := schemaNamesForTest(t, store.db, `
SELECT name
FROM sqlite_master
WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
ORDER BY name
`)
	if err := exactSchemaNamesError("fresh product tables", gotTables, wantTables); err != nil {
		t.Fatal(err)
	}

	wantThreadSettingsColumns := []string{
		"created_by_user_email",
		"created_by_user_public_id",
		"endpoint_id",
		"model_id",
		"namespace_public_id",
		"permission_type",
		"pinned_at_unix_ms",
		"queue_revision",
		"reasoning_selection_json",
		"settings_created_at_unix_ms",
		"settings_updated_at_unix_ms",
		"thread_id",
		"updated_by_user_email",
		"updated_by_user_public_id",
		"working_dir",
	}
	gotThreadSettingsColumns := schemaNamesForTest(t, store.db, `
SELECT name
FROM pragma_table_info('ai_thread_settings')
ORDER BY name
`)
	if err := exactSchemaNamesError("ai_thread_settings columns", gotThreadSettingsColumns, wantThreadSettingsColumns); err != nil {
		t.Fatal(err)
	}

	if count := countRowsForTest(t, store.db, `SELECT COUNT(1) FROM pragma_table_info('ai_thread_fork_operations') WHERE name = 'floret_result_json'`); count != 0 {
		t.Fatal("fork operation persists a Floret result shadow")
	}
}

func TestExactProductSchemaAllowlistRejectsShadowExtensions(t *testing.T) {
	testCases := []struct {
		name string
		got  []string
		want []string
	}{
		{name: "shadow table", got: []string{"ai_messages", "ai_thread_settings"}, want: []string{"ai_thread_settings"}},
		{name: "shadow settings column", got: []string{"thread_id", "title"}, want: []string{"thread_id"}},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			if err := exactSchemaNamesError(testCase.name, testCase.got, testCase.want); err == nil {
				t.Fatal("shadow schema extension satisfied the exact allowlist")
			}
		})
	}
}

func schemaNamesForTest(t *testing.T, db *sql.DB, query string) []string {
	t.Helper()
	rows, err := db.Query(query)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return names
}

func exactSchemaNamesError(label string, got []string, want []string) error {
	got = append([]string(nil), got...)
	want = append([]string(nil), want...)
	sort.Strings(got)
	sort.Strings(want)
	if reflect.DeepEqual(got, want) {
		return nil
	}
	return fmt.Errorf("%s mismatch: got=%v want=%v", label, got, want)
}

func TestStoreThreadMetadataAndPendingCommandRoundTrip(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	thread := ThreadSettings{
		ThreadID: "th_1", EndpointID: "env_1", NamespacePublicID: "ns_1",
		ModelID: "openai/gpt-5", ReasoningSelectionJSON: `{"effort":"high"}`,
		PermissionType: "approval_required", WorkingDir: "/workspace",
		CreatedByUserPublicID: "user_1", UpdatedByUserPublicID: "user_1",
		SettingsCreatedAtUnixMs: 10, SettingsUpdatedAtUnixMs: 10,
	}
	if err := store.CreateThreadSettings(ctx, thread); err != nil {
		t.Fatal(err)
	}
	record, position, revision, err := store.CreateFollowup(ctx, QueuedTurn{
		QueueID: "cmd_1", EndpointID: "env_1", ThreadID: "th_1", ChannelID: "ch_1",
		Lane: FollowupLaneQueued, TurnID: "turn_1", RunID: "run_1", ModelID: "openai/gpt-5",
		TextContent: "not admitted yet", AttachmentsJSON: "[]", OptionsJSON: "{}", SessionMetaJSON: "{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	if position != 1 || revision != 1 || record.TurnID != "turn_1" || record.RunID != "run_1" {
		t.Fatalf("unexpected pending command: %#v position=%d revision=%d", record, position, revision)
	}
	loaded, err := store.GetThreadSettings(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatal(err)
	}
	if loaded == nil || loaded.ModelID != "openai/gpt-5" || loaded.QueueRevision != 1 {
		t.Fatalf("unexpected thread metadata: %#v", loaded)
	}
	commands, err := store.ListFollowupsByLane(ctx, "env_1", "th_1", FollowupLaneQueued, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(commands) != 1 || commands[0].TextContent != "not admitted yet" || commands[0].TurnID != "turn_1" || commands[0].RunID != "run_1" {
		t.Fatalf("unexpected pending commands: %#v", commands)
	}
}

func TestStoreThreadMetadataUpdatesDoNotCreateConversationState(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	if err := store.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "th_1", EndpointID: "env_1", ModelID: "openai/gpt-5", PermissionType: "approval_required", SettingsCreatedAtUnixMs: 10, SettingsUpdatedAtUnixMs: 10}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateThreadModelAndReasoningSelection(ctx, "env_1", "th_1", "openai/gpt-5.1", `{"effort":"medium"}`); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateThreadPermissionType(ctx, "env_1", "th_1", "full_access"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetThreadPinned(ctx, "env_1", "th_1", true, "user_1", "user@example.com"); err != nil {
		t.Fatal(err)
	}
	thread, err := store.GetThreadSettings(ctx, "env_1", "th_1")
	if err != nil {
		t.Fatal(err)
	}
	if thread == nil || thread.ModelID != "openai/gpt-5.1" || thread.PermissionType != "full_access" || thread.PinnedAtUnixMs <= 0 {
		t.Fatalf("unexpected updated metadata: %#v", thread)
	}
}

func TestStoreRejectsInvalidThreadPermissionContracts(t *testing.T) {
	store := openStoreForTest(t)
	ctx := context.Background()
	if err := store.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "invalid_create", EndpointID: "env_1", PermissionType: "unknown"}); err == nil {
		t.Fatal("CreateThread succeeded with invalid permission")
	}
	if err := store.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "empty_create", EndpointID: "env_1"}); err == nil {
		t.Fatal("CreateThread succeeded with empty permission")
	}
	if err := store.CreateThreadSettings(ctx, ThreadSettings{ThreadID: "valid", EndpointID: "env_1", PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateThreadPermissionType(ctx, "env_1", "valid", "unknown"); err == nil {
		t.Fatal("UpdateThreadPermissionType succeeded with invalid permission")
	}
	if _, err := store.db.Exec(`UPDATE ai_thread_settings SET permission_type = 'unknown' WHERE thread_id = 'valid'`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetThreadSettings(ctx, "env_1", "valid"); err == nil {
		t.Fatal("GetThread accepted invalid persisted permission")
	}
	if _, err := store.db.Exec(`UPDATE ai_thread_settings SET permission_type = '' WHERE thread_id = 'valid'`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetThreadSettings(ctx, "env_1", "valid"); err == nil {
		t.Fatal("GetThread accepted empty persisted permission")
	}
}

func openStoreForTest(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "threads.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func countRowsForTest(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()
	var count int
	if err := db.QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}
