package ai

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
	flstorage "github.com/floegence/floret/v3/storage"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

func TestServiceResumesThreadCreateFromEveryCanonicalBoundary(t *testing.T) {
	for _, testCase := range []struct {
		name        string
		bindFloret  bool
		materialize bool
		setTitle    bool
	}{
		{name: "prepared"},
		{name: "floret_created", bindFloret: true},
		{name: "product_materialized", bindFloret: true, materialize: true},
		{name: "title_applied", bindFloret: true, materialize: true, setTitle: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			ctx := context.Background()
			db, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Close() })
			adapter := testFloretBootstrap(t, openTestFloretRuntimeHost(t, flstorage.Memory()))
			service := &Service{threadsDB: db}
			installTestFloretCapabilities(service, adapter)
			settings := threadstore.ThreadSettings{
				EndpointID: "env_create", ModelID: "openai/gpt-5", PermissionType: "approval_required",
				SettingsCreatedAtUnixMs: 100, SettingsUpdatedAtUnixMs: 100,
			}
			operation, err := db.PrepareThreadCreateOperation(ctx, threadstore.PrepareThreadCreateRequest{
				ClientRequestID: "create_" + testCase.name, Settings: settings, ExplicitTitle: "Canonical title", CreatedAtMS: 100,
			})
			if err != nil {
				t.Fatal(err)
			}
			canonicalThreadID := ""
			if testCase.bindFloret {
				created, createErr := adapter.threadCreate.CreateThread(ctx, identity.LogicalRequestID(operation.LogicalRequestID))
				if createErr != nil {
					t.Fatal(createErr)
				}
				canonicalThreadID = string(created.ThreadID)
				operation, err = db.BindThreadCreateCanonicalID(ctx, operation.OperationID, canonicalThreadID)
				if err != nil {
					t.Fatal(err)
				}
			}
			if testCase.materialize {
				if _, err := db.MaterializeThreadCreateProduct(ctx, operation.OperationID); err != nil {
					t.Fatal(err)
				}
				operation, err = db.GetThreadCreateOperation(ctx, operation.OperationID)
				if err != nil {
					t.Fatal(err)
				}
			}
			if testCase.setTitle {
				if _, err := adapter.threadCreate.SetCreatedThreadTitle(ctx, identity.ThreadID(canonicalThreadID), flruntime.SetThreadTitleCommand{LogicalRequestID: identity.LogicalRequestID(operation.TitleLogicalRequestID), Title: "Canonical title"}); err != nil {
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
			if canonicalThreadID != "" && committed.ThreadID != canonicalThreadID {
				t.Fatalf("committed thread=%q, want %q", committed.ThreadID, canonicalThreadID)
			}
			readHost, err := adapter.newThreadRead(ctx, identity.ThreadID(committed.ThreadID))
			if err != nil {
				t.Fatal(err)
			}
			overview, err := readHost.ReadThreadOverview(ctx)
			if err != nil || overview.Thread.Title != "Canonical title" {
				t.Fatalf("overview=%#v err=%v", overview, err)
			}
			stored, err := db.GetThreadCreateOperation(ctx, operation.OperationID)
			if err != nil || stored.Stage != threadstore.ThreadCreateStageCompleted || stored.CanonicalThreadID != committed.ThreadID {
				t.Fatalf("operation=%#v err=%v", stored, err)
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
		ClientRequestID: "create_corrupt", Settings: threadstore.ThreadSettings{EndpointID: "env_corrupt_create", PermissionType: "approval_required"}, CreatedAtMS: 100,
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
	adapter := testFloretBootstrap(t, openTestFloretRuntimeHost(t, flstorage.Memory()))
	service := &Service{threadsDB: db}
	installTestFloretCapabilities(service, adapter)
	if completed, err := service.replayPendingThreadCreateOperations(ctx); completed != 0 || err == nil || !strings.Contains(err.Error(), "snapshot is invalid") {
		t.Fatalf("replay completed=%d error=%v, want strict snapshot failure", completed, err)
	}
}
