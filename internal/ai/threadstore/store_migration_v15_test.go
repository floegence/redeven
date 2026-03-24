package threadstore

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven-agent/internal/testutil/legacydb"

	_ "modernc.org/sqlite"
)

func TestStore_MigrateFromV15AddsFollowupLaneColumns(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	if err := legacydb.SeedThreadstoreV15(dbPath); err != nil {
		t.Fatalf("seed v15 db: %v", err)
	}

	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open reopen: %v", err)
	}
	if _, err := raw.Exec(`
INSERT INTO ai_threads(thread_id, endpoint_id, title, created_at_unix_ms, updated_at_unix_ms)
VALUES('th_1', 'env_1', 'chat', 1000, 1000);
INSERT INTO ai_queued_turns(queue_id, endpoint_id, thread_id, channel_id, message_id, model_id, text_content, created_at_unix_ms)
VALUES('q_1', 'env_1', 'th_1', 'ch_1', 'msg_1', 'openai/gpt-5-mini', 'queued followup', 1234);
`); err != nil {
		_ = raw.Close()
		t.Fatalf("seed v15 rows: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close seeded db: %v", err)
	}

	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	ctx := context.Background()
	queued, err := s.ListFollowupsByLane(ctx, "env_1", "th_1", FollowupLaneQueued, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane: %v", err)
	}
	if len(queued) != 1 {
		t.Fatalf("len(queued)=%d, want 1", len(queued))
	}
	if queued[0].Lane != FollowupLaneQueued {
		t.Fatalf("Lane=%q, want %q", queued[0].Lane, FollowupLaneQueued)
	}
	if queued[0].SortIndex != 1 {
		t.Fatalf("SortIndex=%d, want 1", queued[0].SortIndex)
	}
	if queued[0].UpdatedAtUnixMs != queued[0].CreatedAtUnixMs {
		t.Fatalf("UpdatedAtUnixMs=%d, want %d", queued[0].UpdatedAtUnixMs, queued[0].CreatedAtUnixMs)
	}

	var version int
	if err := s.db.QueryRowContext(ctx, `PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if version != CurrentSchemaVersion() {
		t.Fatalf("user_version=%d, want %d", version, CurrentSchemaVersion())
	}
	if tableExistsForTest(t, s.db, "memory_embeddings") {
		t.Fatalf("memory_embeddings should be removed from the current schema")
	}

	var indexExists int
	if err := s.db.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM sqlite_master
WHERE type = 'index' AND name = 'idx_ai_queued_turns_thread_lane_sort'
`).Scan(&indexExists); err != nil {
		t.Fatalf("check lane index: %v", err)
	}
	if indexExists != 1 {
		t.Fatalf("lane index exists=%d, want 1", indexExists)
	}
}
