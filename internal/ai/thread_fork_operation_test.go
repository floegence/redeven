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

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
	flstorage "github.com/floegence/floret/v3/storage"
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
	adapter := testFloretBootstrap(t, openTestFloretRuntimeHost(t, flstorage.Memory()))
	created, err := adapter.threadCreate.CreateThread(ctx, identity.LogicalRequestID("create_corrupt_fork_source"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.CreateThreadSettings(ctx, threadstore.ThreadSettings{ThreadID: string(created.ThreadID), EndpointID: "env_corrupt_fork", PermissionType: "approval_required"}); err != nil {
		t.Fatal(err)
	}
	operation, err := db.PrepareForkOperation(ctx, threadstore.ForkThreadRequest{ClientRequestID: "fork_corrupt_replay", EndpointID: "env_corrupt_fork", SourceThreadID: string(created.ThreadID), CreatedByUserPublicID: "user", CreatedAtUnixMs: 100})
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
	service := &Service{threadsDB: db}
	installTestFloretCapabilities(service, adapter)
	if completed, err := service.replayPendingThreadForkOperations(ctx); completed != 0 || err == nil || !strings.Contains(err.Error(), "fingerprint mismatch") {
		t.Fatalf("replay completed=%d error=%v", completed, err)
	}
}

func TestThreadForkOperationRecoversAfterFloretCommitAndProcessRestart(t *testing.T) {
	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()
	newService := func() *Service {
		svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: agentHomeDir, Shell: "/bin/bash", PersistOpTimeout: 2 * time.Second})
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
	operation, err := svc.threadsDB.PrepareForkOperation(ctx, threadstore.ForkThreadRequest{ClientRequestID: "fork_restart_recovery", EndpointID: meta.EndpointID, SourceThreadID: source.ThreadID, Title: "Recovered fork", CreatedByUserPublicID: meta.UserPublicID, CreatedByUserEmail: meta.UserEmail, CreatedAtUnixMs: 1000})
	if err != nil {
		_ = svc.Close()
		t.Fatal(err)
	}
	floretResult, err := svc.forkFloretThread(ctx, operation.LogicalRequestID, operation.SourceThreadID)
	if err != nil {
		_ = svc.Close()
		t.Fatal(err)
	}
	destinationID := string(floretResult.ThreadID)
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}

	recovered := newService()
	t.Cleanup(func() { _ = recovered.Close() })
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		forked, getErr := recovered.threadsDB.GetThreadSettings(ctx, meta.EndpointID, destinationID)
		if getErr != nil {
			t.Fatal(getErr)
		}
		if forked != nil {
			got, getOperationErr := recovered.threadsDB.GetForkOperation(ctx, operation.OperationID)
			if getOperationErr != nil || got.Stage != threadstore.ForkStageCompleted || got.DestinationThreadID != destinationID || got.SnapshotJSON == "" {
				t.Fatalf("operation=%+v err=%v", got, getOperationErr)
			}
			if got.SourceBroadcastedAtUnixMs == 0 || got.DestinationBroadcastedAtUnixMs == 0 {
				t.Fatalf("broadcasts were not acknowledged: %+v", got)
			}
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("pending fork operation was not recovered after restart")
}
