package agent

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/testutil/legacydb"
)

func TestAgentRun_MigratesLegacyThreadstoreE2E(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	cfgPath := filepath.Join(stateDir, "config.json")
	cfg := &config.Config{
		AgentHomeDir: stateDir,
		Shell:        "/bin/sh",
		LogFormat:    "text",
		LogLevel:     "error",
	}
	if err := config.Save(cfgPath, cfg); err != nil {
		t.Fatalf("config.Save: %v", err)
	}

	dbPath := filepath.Join(stateDir, "ai", "threads.sqlite")
	if err := legacydb.SeedThreadstoreV15(dbPath); err != nil {
		t.Fatalf("seedLegacyThreadstoreV15: %v", err)
	}

	a, err := New(Options{
		Config:                cfg,
		ConfigPath:            cfgPath,
		LocalUIEnabled:        false,
		LocalUIAllowedOrigins: nil,
		ControlChannelEnabled: false,
		Version:               "test",
		Commit:                "test",
		BuildTime:             "test",
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	errCh := make(chan error, 1)
	go func() {
		errCh <- a.Run(ctx)
	}()

	time.Sleep(100 * time.Millisecond)
	cancel()

	err = <-errCh
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Run error=%v, want context.Canceled", err)
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
	if version != 16 {
		t.Fatalf("user_version=%d, want 16", version)
	}

	var laneColumns int
	if err := raw.QueryRow(`
SELECT COUNT(1)
FROM pragma_table_info('ai_queued_turns')
WHERE name = 'lane'
`).Scan(&laneColumns); err != nil {
		t.Fatalf("check lane column: %v", err)
	}
	if laneColumns != 1 {
		t.Fatalf("lane column count=%d, want 1", laneColumns)
	}
}
