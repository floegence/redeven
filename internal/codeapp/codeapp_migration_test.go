package codeapp

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
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

func TestNewMigratesLegacyThreadstoreSchema(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	dbPath := filepath.Join(stateDir, "ai", "threads.sqlite")
	if err := legacydb.SeedThreadstoreV15(dbPath); err != nil {
		t.Fatalf("seedLegacyFollowupQueueDB: %v", err)
	}
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open seed database: %v", err)
	}
	if _, err := raw.Exec(`INSERT INTO ai_threads(thread_id, endpoint_id, created_at_unix_ms, updated_at_unix_ms) VALUES('thread_product', 'env_1', 100, 100)`); err != nil {
		_ = raw.Close()
		t.Fatalf("seed product thread: %v", err)
	}
	if _, err := raw.Exec(`INSERT INTO ai_messages(thread_id, endpoint_id, message_id, role, status, created_at_unix_ms, updated_at_unix_ms, message_json) VALUES('thread_product', 'env_1', 'legacy_message', 'user', 'completed', 100, 100, '{}')`); err != nil {
		_ = raw.Close()
		t.Fatalf("seed legacy agent message: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close seed database: %v", err)
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
		t.Fatalf("New migrated legacy threadstore: %v", err)
	}
	if svc == nil {
		t.Fatal("New returned nil service after migrating threadstore")
	}
	if err := svc.Close(); err != nil {
		t.Fatalf("close service: %v", err)
	}

	raw, err = sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer func() { _ = raw.Close() }()

	var version int
	if err := raw.QueryRow(`PRAGMA user_version;`).Scan(&version); err != nil {
		t.Fatalf("read user_version: %v", err)
	}
	if version != threadstore.CurrentSchemaVersion() {
		t.Fatalf("user_version=%d, want %d", version, threadstore.CurrentSchemaVersion())
	}
	var legacyAgentTables int
	if err := raw.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name IN ('ai_messages', 'ai_runs', 'ai_thread_state', 'conversation_turns')`).Scan(&legacyAgentTables); err != nil {
		t.Fatalf("check legacy Agent tables: %v", err)
	}
	if legacyAgentTables != 0 {
		t.Fatalf("legacy Agent table count=%d, want 0", legacyAgentTables)
	}
	var threadCount int
	if err := raw.QueryRow(`SELECT COUNT(1) FROM ai_threads WHERE thread_id = 'thread_product'`).Scan(&threadCount); err != nil {
		t.Fatalf("check product thread: %v", err)
	}
	if threadCount != 1 {
		t.Fatalf("product thread count=%d, want 1", threadCount)
	}
	var hasLegacyExecutionColumn int
	if err := raw.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('ai_threads') WHERE name = 'run_status'`).Scan(&hasLegacyExecutionColumn); err != nil {
		t.Fatalf("check legacy thread column: %v", err)
	}
	if hasLegacyExecutionColumn != 0 {
		t.Fatal("legacy run_status column remains after migration")
	}
	floretStore, err := flruntime.OpenSQLiteStore(filepath.Join(stateDir, "ai", "floret_threads.sqlite"))
	if err != nil {
		t.Fatalf("open migrated Floret store: %v", err)
	}
	defer floretStore.Close()
	maintenance, err := flruntime.NewThreadMaintenanceHost(flruntime.ThreadMaintenanceHostOptions{Store: floretStore})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := maintenance.ReadThread(context.Background(), "thread_product"); err != nil {
		t.Fatalf("read ensured Floret thread identity: %v", err)
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
	if err := store.CreateThread(context.Background(), threadstore.Thread{ThreadID: "th_old", EndpointID: "env_1", Title: "old"}); err != nil {
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
	if err := raw.QueryRow(`SELECT COUNT(1) FROM ai_threads`).Scan(&threadCount); err != nil {
		t.Fatalf("count ai_threads: %v", err)
	}
	if threadCount != 1 {
		t.Fatalf("ai_threads row count=%d, want existing data preserved", threadCount)
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
