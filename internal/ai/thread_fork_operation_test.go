package ai

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

func TestClassifyFloretForkOperationError(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		err      error
		code     string
		terminal bool
	}{
		{name: "operation conflict", err: flruntime.ErrForkOperationConflict, code: "floret_operation_conflict", terminal: true},
		{name: "destination conflict", err: flruntime.ErrForkDestinationConflict, code: "floret_destination_conflict", terminal: true},
		{name: "source missing", err: flruntime.ErrThreadNotFound, code: "floret_source_missing", terminal: true},
		{name: "transient", err: errors.New("temporary I/O failure"), code: "floret_fork_failed", terminal: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code, terminal := classifyFloretForkOperationError(tt.err)
			if code != tt.code || terminal != tt.terminal {
				t.Fatalf("classification=(%q,%t), want (%q,%t)", code, terminal, tt.code, tt.terminal)
			}
		})
	}
}

func TestThreadForkReplayRejectsDamagedSnapshotBeforeFloretFork(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	db, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.CreateThreadSettings(ctx, threadstore.ThreadSettings{
		ThreadID: "thread_corrupt_fork_source", EndpointID: "env_corrupt_fork", PermissionType: "approval_required",
	}); err != nil {
		t.Fatal(err)
	}
	operation, err := db.PrepareForkOperation(ctx, threadstore.ForkThreadRequest{
		OperationID: "fork_corrupt_replay", EndpointID: "env_corrupt_fork", SourceThreadID: "thread_corrupt_fork_source",
		DestinationThreadID: "thread_corrupt_fork_destination", CreatedAtUnixMs: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	rawDB, err := sql.Open("sqlite", "file:"+dbPath+"?_pragma=busy_timeout(3000)")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rawDB.Close() }()
	if _, err := rawDB.ExecContext(ctx, `UPDATE ai_thread_fork_operations SET request_fingerprint = 'damaged' WHERE operation_id = ?`, operation.OperationID); err != nil {
		t.Fatal(err)
	}
	floretStore := flruntime.NewMemoryStore()
	t.Cleanup(func() { _ = floretStore.Close() })
	adapter := testFloretBootstrap(t, floretStore)
	createIntentID := flruntime.CreateIntentID("test-create-fork-source")
	host, err := adapter.newThreadCreate(flruntime.ThreadID(operation.SourceThreadID), createIntentID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := host.CreateThread(ctx, flruntime.CreateThreadRequest{ThreadID: flruntime.ThreadID(operation.SourceThreadID), CreateIntentID: createIntentID}); err != nil {
		t.Fatal(err)
	}
	service := &Service{threadsDB: db}
	installTestFloretCapabilities(service, adapter)
	if completed, err := service.replayPendingThreadForkOperations(ctx); completed != 0 || err == nil || !strings.Contains(err.Error(), "fingerprint mismatch") {
		t.Fatalf("replay completed=%d error=%v, want strict snapshot failure", completed, err)
	}
	if _, err := adapter.newThreadRead(ctx, flruntime.ThreadID(operation.DestinationThreadID)); !errors.Is(err, flruntime.ErrThreadNotFound) {
		t.Fatalf("fork destination error=%v, want %v", err, flruntime.ErrThreadNotFound)
	}
}

func TestThreadForkOperationRecoversAfterFloretCommitAndProcessRestart(t *testing.T) {
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()
	newService := func() *Service {
		svc, err := NewService(Options{
			Logger:           slog.New(slog.NewTextHandler(io.Discard, nil)),
			StateDir:         stateDir,
			AgentHomeDir:     agentHomeDir,
			Shell:            "/bin/bash",
			PersistOpTimeout: 2 * time.Second,
		})
		if err != nil {
			t.Fatalf("NewService: %v", err)
		}
		return svc
	}

	ctx := context.Background()
	svc := newService()
	stopTestServiceMaintenance(t, svc)
	meta := testSendTurnMeta()
	source, err := svc.CreateThread(ctx, meta, "Source", "", "", "")
	if err != nil {
		_ = svc.Close()
		t.Fatalf("CreateThread: %v", err)
	}

	operationID := "fork_restart_recovery"
	destinationID := "thread_restart_destination"
	operation, err := svc.threadsDB.PrepareForkOperation(ctx, threadstore.ForkThreadRequest{
		OperationID:           operationID,
		EndpointID:            meta.EndpointID,
		SourceThreadID:        source.ThreadID,
		DestinationThreadID:   destinationID,
		Title:                 "Recovered fork",
		CreatedByUserPublicID: meta.UserPublicID,
		CreatedByUserEmail:    meta.UserEmail,
		CreatedAtUnixMs:       1000,
	})
	if err != nil {
		_ = svc.Close()
		t.Fatalf("PrepareForkOperation: %v", err)
	}
	if _, err := svc.forkFloretThread(ctx, operation.OperationID, operation.SourceThreadID, operation.DestinationThreadID); err != nil {
		_ = svc.Close()
		t.Fatalf("forkFloretThread: %v", err)
	}
	if err := svc.Close(); err != nil {
		t.Fatalf("Close first service: %v", err)
	}

	recovered := newService()
	t.Cleanup(func() { _ = recovered.Close() })
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		forked, getErr := recovered.threadsDB.GetThreadSettings(ctx, meta.EndpointID, destinationID)
		if getErr != nil {
			t.Fatalf("GetThread destination: %v", getErr)
		}
		if forked != nil {
			gotOperation, getOperationErr := recovered.threadsDB.GetForkOperation(ctx, operationID)
			if getOperationErr != nil {
				t.Fatalf("GetForkOperation: %v", getOperationErr)
			}
			if gotOperation.Status != threadstore.ForkOperationCommitted || gotOperation.SnapshotJSON != "" {
				t.Fatalf("recovered operation=%+v", gotOperation)
			}
			if gotOperation.SourceBroadcastedAtUnixMs == 0 || gotOperation.DestinationBroadcastedAtUnixMs == 0 {
				t.Fatalf("fork broadcasts were not acknowledged: %+v", gotOperation)
			}
			stale := *gotOperation
			stale.SourceBroadcastedAtUnixMs = 0
			stale.DestinationBroadcastedAtUnixMs = 0
			recovered.publishCommittedThreadForkOperation(recovered.threadsDB, &stale)
			afterReplay, replayErr := recovered.threadsDB.GetForkOperation(ctx, operationID)
			if replayErr != nil {
				t.Fatalf("GetForkOperation after stale publish replay: %v", replayErr)
			}
			if afterReplay.SourceBroadcastedAtUnixMs != gotOperation.SourceBroadcastedAtUnixMs || afterReplay.DestinationBroadcastedAtUnixMs != gotOperation.DestinationBroadcastedAtUnixMs {
				t.Fatalf("stale publish replay changed acknowledgements: before=%+v after=%+v", gotOperation, afterReplay)
			}
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("pending fork operation was not recovered after restart")
}
