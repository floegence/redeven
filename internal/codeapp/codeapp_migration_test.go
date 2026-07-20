package codeapp

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/terminal"
	"github.com/floegence/redeven/internal/testutil/legacydb"
	"github.com/floegence/redeven/internal/threadreadstate"
	"github.com/floegence/redeven/internal/workbenchlayout"

	_ "modernc.org/sqlite"
)

func TestAppServerThreadReadStatePathMigratesLegacyStore(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	legacyPath := filepath.Join(stateDir, "gateway", "thread_read_state.sqlite")
	legacy, err := threadreadstate.Open(legacyPath)
	if err != nil {
		t.Fatalf("threadreadstate.Open legacy: %v", err)
	}
	if _, err := legacy.AdvanceFlower(
		context.Background(),
		"env_1",
		"user_1",
		"thread_1",
		threadreadstate.FlowerSnapshot{
			ActivityRevision:    42,
			LastMessageAtUnixMs: 123_456,
			ActivitySignature:   "sig_1",
			WaitingPromptID:     "prompt_1",
		},
	); err != nil {
		_ = legacy.Close()
		t.Fatalf("AdvanceFlower legacy: %v", err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatalf("legacy Close: %v", err)
	}

	currentPath, err := appServerThreadReadStatePath(stateDir)
	if err != nil {
		t.Fatalf("appServerThreadReadStatePath: %v", err)
	}
	wantPath := filepath.Join(stateDir, "apps", "appserver", "thread_read_state.sqlite")
	if currentPath != wantPath {
		t.Fatalf("currentPath=%q, want %q", currentPath, wantPath)
	}
	if _, err := os.Stat(legacyPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("legacy path stat err=%v, want not exist", err)
	}

	current, err := threadreadstate.Open(currentPath)
	if err != nil {
		t.Fatalf("threadreadstate.Open current: %v", err)
	}
	defer func() { _ = current.Close() }()
	records, err := current.EnsureFlower(context.Background(), "env_1", "user_1", map[string]threadreadstate.FlowerSnapshot{
		"thread_1": {
			ActivityRevision:    42,
			LastMessageAtUnixMs: 123_456,
			ActivitySignature:   "sig_1",
			WaitingPromptID:     "prompt_1",
		},
	})
	if err != nil {
		t.Fatalf("EnsureFlower current: %v", err)
	}
	record := records["thread_1"]
	if record.LastSeenActivityRevision != 42 ||
		record.LastReadMessageAtUnixMs != 123_456 ||
		record.LastSeenActivitySignature != "sig_1" ||
		record.LastSeenWaitingPromptID != "prompt_1" {
		t.Fatalf("migrated record=%#v, want legacy read state", record)
	}
}

func TestNewRejectsUnsupportedThreadstoreVersionWithoutMutation(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	dbPath := filepath.Join(stateDir, "ai", "threads.sqlite")
	if err := legacydb.SeedUnsupportedThreadstore(dbPath, "ai_threadstore_canonical", 15); err != nil {
		t.Fatalf("SeedUnsupportedThreadstore: %v", err)
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
	if err == nil {
		if svc != nil {
			_ = svc.Close()
		}
		t.Fatal("New accepted unsupported threadstore version 15")
	}
	if !strings.Contains(err.Error(), "15") || !strings.Contains(err.Error(), "v2 and v3") {
		t.Fatalf("New error=%v, want actual version and supported v2/v3 contract", err)
	}

	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer func() { _ = raw.Close() }()

	var version int
	if err := raw.QueryRow(`PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if version != 15 {
		t.Fatalf("user_version=%d, want unsupported version left unchanged", version)
	}
	var kind string
	if err := raw.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton = 1`).Scan(&kind); err != nil {
		t.Fatalf("read db kind: %v", err)
	}
	if kind != "ai_threadstore_canonical" {
		t.Fatalf("db kind=%q, want unsupported kind left unchanged", kind)
	}
	var sentinel string
	if err := raw.QueryRow(`SELECT payload FROM legacy_thread_data WHERE id = 'sentinel'`).Scan(&sentinel); err != nil {
		t.Fatalf("read sentinel: %v", err)
	}
	if sentinel != "preserve me" {
		t.Fatalf("sentinel=%q, want unsupported database left unchanged", sentinel)
	}
	var settingsTables int
	if err := raw.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'ai_thread_settings'`).Scan(&settingsTables); err != nil {
		t.Fatalf("check settings table: %v", err)
	}
	if settingsTables != 0 {
		t.Fatal("unsupported database was rewritten with current settings schema")
	}
}

func TestNewRejectsCurrentThreadstoreSchemaDrift(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	dbPath := filepath.Join(stateDir, "ai", "threads.sqlite")
	store, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{ThreadID: "th_old", EndpointID: "env_1", PermissionType: "approval_required"}); err != nil {
		_ = store.Close()
		t.Fatalf("CreateThread: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("store Close: %v", err)
	}
	if err := legacydb.AddForbiddenAgentShadowTable(dbPath); err != nil {
		t.Fatalf("add forbidden Agent shadow table: %v", err)
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
	if err == nil {
		if svc != nil {
			_ = svc.Close()
		}
		t.Fatal("New succeeded, want current threadstore schema drift error")
	}

	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer func() { _ = raw.Close() }()

	var shadowTableCount int
	if err := raw.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = 'conversation_turns'`).Scan(&shadowTableCount); err != nil {
		t.Fatalf("check forbidden Agent shadow table: %v", err)
	}
	if shadowTableCount != 1 {
		t.Fatalf("conversation_turns table count=%d, want drift left untouched", shadowTableCount)
	}
	var threadCount int
	if err := raw.QueryRow(`SELECT COUNT(1) FROM ai_thread_settings`).Scan(&threadCount); err != nil {
		t.Fatalf("count ai_thread_settings: %v", err)
	}
	if threadCount != 1 {
		t.Fatalf("ai_thread_settings row count=%d, want existing data preserved", threadCount)
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
