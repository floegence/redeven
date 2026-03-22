package codeapp

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/session"
	"github.com/floegence/redeven-agent/internal/testutil/legacydb"

	_ "modernc.org/sqlite"
)

func TestNewMigratesLegacyFollowupQueueSchema(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	dbPath := filepath.Join(stateDir, "ai", "threads.sqlite")
	if err := legacydb.SeedThreadstoreV15(dbPath); err != nil {
		t.Fatalf("seedLegacyFollowupQueueDB: %v", err)
	}

	svc, err := New(context.Background(), Options{
		Logger:       slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError})),
		StateDir:     stateDir,
		ConfigPath:   filepath.Join(stateDir, "config.json"),
		AgentHomeDir: stateDir,
		Shell:        "/bin/sh",
		ResolveSessionMeta: func(string) (*session.Meta, bool) {
			return nil, false
		},
		ResolveSessionTunnelURL: func(string) (string, bool) {
			return "", false
		},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer func() { _ = svc.Close() }()

	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer func() { _ = raw.Close() }()

	var version int
	if err := raw.QueryRow(`PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if want := threadstore.CurrentSchemaVersion(); version != want {
		t.Fatalf("user_version=%d, want %d", version, want)
	}

	var laneColCount int
	if err := raw.QueryRow(`
SELECT COUNT(1)
FROM pragma_table_info('ai_queued_turns')
WHERE name = 'lane'
`).Scan(&laneColCount); err != nil {
		t.Fatalf("check lane column: %v", err)
	}
	if laneColCount != 1 {
		t.Fatalf("lane column count=%d, want 1", laneColCount)
	}
}
