package codeapp

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/terminal"
	"github.com/floegence/redeven/internal/testutil/legacydb"
	"github.com/floegence/redeven/internal/workbenchlayout"

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
		StateRoot:    stateDir,
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

	var titleSourceColumns int
	if err := raw.QueryRow(`
SELECT COUNT(1)
FROM pragma_table_info('ai_threads')
WHERE name = 'title_source'
`).Scan(&titleSourceColumns); err != nil {
		t.Fatalf("check title_source column: %v", err)
	}
	if titleSourceColumns != 1 {
		t.Fatalf("title_source column count=%d, want 1", titleSourceColumns)
	}
}

func TestNewPrunesStaleWorkbenchTerminalSessions(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	layouts, err := workbenchlayout.Open(filepath.Join(stateDir, "apps", "workbench", "layout.sqlite"))
	if err != nil {
		t.Fatalf("workbenchlayout.Open: %v", err)
	}
	if _, err := layouts.Replace(context.Background(), workbenchlayout.PutLayoutRequest{
		BaseRevision: 0,
		Widgets: []workbenchlayout.WidgetLayout{
			{
				WidgetID:        "widget-terminal-1",
				WidgetType:      workbenchlayout.WidgetTypeTerminal,
				X:               120,
				Y:               80,
				Width:           760,
				Height:          560,
				ZIndex:          1,
				CreatedAtUnixMs: 1_700_000_000_000,
			},
		},
	}); err != nil {
		t.Fatalf("Replace: %v", err)
	}
	if _, err := layouts.AppendTerminalSession(context.Background(), "widget-terminal-1", "stale-session"); err != nil {
		t.Fatalf("AppendTerminalSession: %v", err)
	}
	if err := layouts.Close(); err != nil {
		t.Fatalf("layout Close: %v", err)
	}

	term := terminal.NewManager("/bin/sh", stateDir, nil)
	t.Cleanup(term.Cleanup)

	svc, err := New(context.Background(), Options{
		Logger:       slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError})),
		StateDir:     stateDir,
		StateRoot:    stateDir,
		ConfigPath:   filepath.Join(stateDir, "config.json"),
		AgentHomeDir: stateDir,
		Shell:        "/bin/sh",
		Terminal:     term,
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

	snapshot, err := svc.layouts.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if len(snapshot.WidgetStates) != 1 {
		t.Fatalf("widget state count=%d, want 1", len(snapshot.WidgetStates))
	}
	state := snapshot.WidgetStates[0]
	if state.WidgetID != "widget-terminal-1" || state.State.Kind != workbenchlayout.WidgetStateKindTerminal {
		t.Fatalf("widget state=%#v, want terminal widget state", state)
	}
	if len(state.State.SessionIDs) != 0 {
		t.Fatalf("session_ids=%#v, want stale sessions pruned", state.State.SessionIDs)
	}
}
