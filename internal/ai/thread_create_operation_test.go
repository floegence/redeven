package ai

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

func TestServiceResumesThreadCreateFromEveryCanonicalBoundary(t *testing.T) {
	for _, testCase := range []struct {
		name         string
		createFloret bool
		setTitle     bool
	}{
		{name: "after_intent_persisted"},
		{name: "after_floret_create", createFloret: true},
		{name: "after_canonical_title", createFloret: true, setTitle: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			ctx := context.Background()
			db, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Close() })
			floretStore := flruntime.NewMemoryStore()
			t.Cleanup(func() { _ = floretStore.Close() })
			adapter := testFloretBootstrap(t, floretStore)
			service := &Service{threadsDB: db}
			installTestFloretCapabilities(service, adapter)
			settings := threadstore.ThreadSettings{
				ThreadID: "thread_" + testCase.name, EndpointID: "env_create", ModelID: "openai/gpt-5",
				PermissionType: "approval_required", SettingsCreatedAtUnixMs: 100, SettingsUpdatedAtUnixMs: 100,
			}
			operation, err := db.PrepareThreadCreateOperation(ctx, threadstore.PrepareThreadCreateRequest{
				Settings: settings, ExplicitTitle: "Canonical title", CreatedAtMS: 100,
			})
			if err != nil {
				t.Fatal(err)
			}
			host, err := adapter.newThreadCreate(flruntime.ThreadID(settings.ThreadID), flruntime.CreateIntentID(operation.OperationID))
			if err != nil {
				t.Fatal(err)
			}
			if testCase.createFloret {
				if _, err := host.CreateThread(ctx, flruntime.CreateThreadRequest{
					ThreadID:       flruntime.ThreadID(settings.ThreadID),
					CreateIntentID: flruntime.CreateIntentID(operation.OperationID),
				}); err != nil {
					t.Fatal(err)
				}
				operation, err = db.ConfirmThreadCreateFloretCreated(ctx, operation.OperationID)
				if err != nil {
					t.Fatal(err)
				}
			}
			if testCase.setTitle {
				titleHost, err := adapter.newThreadTitle(ctx, flruntime.ThreadID(settings.ThreadID), nil)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := titleHost.SetThreadTitle(ctx, flruntime.SetThreadTitleRequest{ThreadID: flruntime.ThreadID(settings.ThreadID), Title: "Canonical title"}); err != nil {
					t.Fatal(err)
				}
				operation, err = db.ConfirmThreadCreateTitleSet(ctx, operation.OperationID)
				if err != nil {
					t.Fatal(err)
				}
			}

			committed, err := service.resumeThreadCreateOperation(ctx, operation)
			if err != nil {
				t.Fatal(err)
			}
			if committed.ThreadID != settings.ThreadID {
				t.Fatalf("committed settings=%#v", committed)
			}
			readHost, err := adapter.newThreadRead(ctx, flruntime.ThreadID(settings.ThreadID))
			if err != nil {
				t.Fatal(err)
			}
			overview, err := readHost.ReadThreadOverview(ctx, flruntime.ThreadID(settings.ThreadID))
			if err != nil {
				t.Fatal(err)
			}
			if overview.Thread.Title != "Canonical title" {
				t.Fatalf("canonical title=%q", overview.Thread.Title)
			}
			loaded, err := db.GetThreadSettings(ctx, settings.EndpointID, settings.ThreadID)
			if err != nil || loaded == nil {
				t.Fatalf("settings=%#v err=%v", loaded, err)
			}
		})
	}
}

func TestThreadCreateReplayRejectsDamagedSnapshotBeforeFloretCreate(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	db, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	operation, err := db.PrepareThreadCreateOperation(ctx, threadstore.PrepareThreadCreateRequest{
		Settings:    threadstore.ThreadSettings{ThreadID: "thread_corrupt_create", EndpointID: "env_corrupt_create", PermissionType: "approval_required"},
		CreatedAtMS: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	rawDB, err := sql.Open("sqlite", "file:"+dbPath+"?_pragma=busy_timeout(3000)")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rawDB.Close() }()
	if _, err := rawDB.ExecContext(ctx, `UPDATE ai_thread_create_operations SET snapshot_json = '' WHERE operation_id = ?`, operation.OperationID); err != nil {
		t.Fatal(err)
	}
	floretStore := flruntime.NewMemoryStore()
	t.Cleanup(func() { _ = floretStore.Close() })
	adapter := testFloretBootstrap(t, floretStore)
	service := &Service{threadsDB: db}
	installTestFloretCapabilities(service, adapter)
	if completed, err := service.replayPendingThreadCreateOperations(ctx); completed != 0 || err == nil || !strings.Contains(err.Error(), "snapshot is empty") {
		t.Fatalf("replay completed=%d error=%v, want strict snapshot failure", completed, err)
	}
	if _, err := adapter.newThreadRead(ctx, flruntime.ThreadID(operation.ThreadID)); !errors.Is(err, flruntime.ErrThreadNotFound) {
		t.Fatalf("canonical thread error=%v, want %v", err, flruntime.ErrThreadNotFound)
	}
}
