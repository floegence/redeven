package ai

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	_ "modernc.org/sqlite"
)

func TestDeleteThreadRetriesProductCleanupAfterCanonicalDelete(t *testing.T) {
	stateDir := t.TempDir()
	cfg := &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{
		ID: "openai", Type: "openai", BaseURL: "https://api.openai.com/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
	}}}
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir,
		Shell: "/bin/bash", Config: cfg, PersistOpTimeout: time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	meta := &session.Meta{
		EndpointID: "env_delete_retry", NamespacePublicID: "ns_delete_retry", ChannelID: "ch_delete_retry",
		UserPublicID: "user_delete_retry", UserEmail: "delete@example.com", CanRead: true, CanWrite: true, CanExecute: true,
	}
	thread, err := svc.CreateThread(context.Background(), meta, "delete retry", "openai/gpt-5-mini", "approval_required", "")
	if err != nil {
		t.Fatal(err)
	}

	db, err := sql.Open("sqlite", filepath.Join(stateDir, "ai", "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`CREATE TRIGGER fail_product_thread_delete BEFORE DELETE ON ai_thread_settings BEGIN SELECT RAISE(ABORT, 'injected product cleanup failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteThread(context.Background(), meta, thread.ThreadID, false); err == nil {
		t.Fatal("delete succeeded despite injected product cleanup failure")
	}
	if _, err := svc.threadRuntime.View(context.Background(), identity.ThreadID(thread.ThreadID)); !errors.Is(err, flruntime.ErrThreadDeleted) && !errors.Is(err, flruntime.ErrThreadNotFound) {
		t.Fatalf("canonical thread remained after partial delete: %v", err)
	}
	if _, err := db.Exec(`DROP TRIGGER fail_product_thread_delete`); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteThread(context.Background(), meta, thread.ThreadID, false); err != nil {
		t.Fatalf("retry product cleanup after canonical delete: %v", err)
	}
	if settings, err := svc.threadsDB.GetThreadSettings(context.Background(), meta.EndpointID, thread.ThreadID); err != nil || settings != nil {
		t.Fatalf("product settings after retry = %#v, %v", settings, err)
	}
	if err := svc.DeleteThread(context.Background(), meta, thread.ThreadID, false); err != nil {
		t.Fatalf("delete absent product catalog should be idempotent: %v", err)
	}
}
