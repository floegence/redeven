package ai

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
	_ "modernc.org/sqlite"
)

type recordingThreadMaintenanceHost struct {
	mu        sync.Mutex
	deleteErr error
	deleted   []string
}

func (h *recordingThreadMaintenanceHost) DeleteThread(_ context.Context, threadID flruntime.ThreadID) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.deleted = append(h.deleted, string(threadID))
	return h.deleteErr
}

func (h *recordingThreadMaintenanceHost) setDeleteError(err error) {
	h.mu.Lock()
	h.deleteErr = err
	h.mu.Unlock()
}

func (h *recordingThreadMaintenanceHost) deleteCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.deleted)
}

type recordingFlowerReadStateCleaner struct {
	mu      sync.Mutex
	err     error
	deleted []string
}

func (c *recordingFlowerReadStateCleaner) DeleteFlowerThreadReadState(_ context.Context, endpointID string, threadID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.deleted = append(c.deleted, endpointID+":"+threadID)
	return c.err
}

func (c *recordingFlowerReadStateCleaner) deleteCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.deleted)
}

func newThreadDeleteTestService(t *testing.T, stateDir string, host *recordingThreadMaintenanceHost, cleaner *recordingFlowerReadStateCleaner) *Service {
	t.Helper()
	agentHome := filepath.Join(stateDir, "home")
	if err := os.MkdirAll(agentHome, 0o700); err != nil {
		t.Fatalf("ensure agent home: %v", err)
	}
	service, err := NewService(Options{
		StateDir:               stateDir,
		AgentHomeDir:           agentHome,
		FlowerReadStateCleaner: cleaner,
		OpenThreadMaintenanceHost: func() (ThreadMaintenanceHost, error) {
			return host, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	stopTestServiceMaintenance(t, service)
	return service
}

func TestServiceDeleteThreadPersistsPendingOperationAndReplaysTransientFailure(t *testing.T) {
	stateDir := t.TempDir()
	host := &recordingThreadMaintenanceHost{deleteErr: errors.New("temporary Floret failure")}
	cleaner := &recordingFlowerReadStateCleaner{}
	service := newThreadDeleteTestService(t, stateDir, host, cleaner)
	defer func() { _ = service.Close() }()
	meta := &session.Meta{EndpointID: "env_delete_pending", UserPublicID: "user_1", CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := service.CreateThread(context.Background(), meta, "pending delete", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	const checkpointID = "checkpoint_delete_pending"
	if _, err := service.threadsDB.CreateThreadCheckpoint(context.Background(), meta.EndpointID, thread.ThreadID, checkpointID, "", threadstore.CheckpointKindPreRun); err != nil {
		t.Fatalf("CreateThreadCheckpoint: %v", err)
	}
	checkpointDir := checkpointArtifactsDir(stateDir, checkpointID)
	if err := os.MkdirAll(checkpointDir, 0o700); err != nil {
		t.Fatalf("create checkpoint artifacts: %v", err)
	}
	if err := os.WriteFile(filepath.Join(checkpointDir, "manifest.json"), []byte("{}"), 0o600); err != nil {
		t.Fatalf("write checkpoint artifact: %v", err)
	}

	result, err := service.DeleteThread(context.Background(), meta, thread.ThreadID, false)
	if err != nil {
		t.Fatalf("DeleteThread: %v", err)
	}
	if result.Status != ThreadDeleteStatusPending || result.OperationID == "" {
		t.Fatalf("result=%+v", result)
	}
	if _, err := os.Stat(checkpointDir); !os.IsNotExist(err) {
		t.Fatalf("checkpoint artifacts err=%v, want removed", err)
	}
	deletedThread, err := service.threadsDB.GetThread(context.Background(), meta.EndpointID, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if deletedThread != nil {
		t.Fatalf("thread=%+v, want product data committed", deletedThread)
	}
	operation, err := service.threadsDB.GetThreadDeleteOperation(context.Background(), meta.EndpointID, thread.ThreadID)
	if err != nil || operation == nil || operation.RetryCount != 1 {
		t.Fatalf("operation=%+v err=%v", operation, err)
	}

	host.setDeleteError(nil)
	if _, err := service.replayPendingThreadDeletes(context.Background(), 10); err != nil {
		t.Fatalf("replayPendingThreadDeletes: %v", err)
	}
	operation, err = service.threadsDB.GetThreadDeleteOperation(context.Background(), meta.EndpointID, thread.ThreadID)
	if err != nil || operation == nil || operation.Status != threadstore.ThreadDeleteOperationCommitted {
		t.Fatalf("committed operation=%+v err=%v", operation, err)
	}
	if cleaner.deleteCount() != 1 {
		t.Fatalf("read-state delete count=%d, want 1", cleaner.deleteCount())
	}
}

func TestNewServiceReplaysPendingThreadDeleteOperationsFromEveryCrashBoundary(t *testing.T) {
	for _, testCase := range []struct {
		name                         string
		confirmFiles                 bool
		confirmFloret                bool
		deleteReadStateBeforeRestart bool
		wantReadStateDeleteCount     int
	}{
		{name: "after_product_commit", wantReadStateDeleteCount: 1},
		{name: "after_file_cleanup", confirmFiles: true, wantReadStateDeleteCount: 1},
		{name: "after_floret_delete", confirmFiles: true, confirmFloret: true, wantReadStateDeleteCount: 1},
		{name: "after_read_state_delete", confirmFiles: true, confirmFloret: true, deleteReadStateBeforeRestart: true, wantReadStateDeleteCount: 2},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			stateDir := t.TempDir()
			host := &recordingThreadMaintenanceHost{deleteErr: flruntime.ErrThreadNotFound}
			cleaner := &recordingFlowerReadStateCleaner{}
			first := newThreadDeleteTestService(t, stateDir, host, cleaner)
			meta := &session.Meta{EndpointID: "env_restart", UserPublicID: "user_1", CanRead: true, CanWrite: true, CanExecute: true}
			thread, err := first.CreateThread(context.Background(), meta, testCase.name, "", "", "")
			if err != nil {
				t.Fatalf("CreateThread: %v", err)
			}
			operation, err := first.threadsDB.PrepareThreadDeleteOperation(context.Background(), meta.EndpointID, thread.ThreadID, true)
			if err != nil {
				t.Fatalf("PrepareThreadDeleteOperation: %v", err)
			}
			if testCase.confirmFiles {
				operation, err = first.threadsDB.ConfirmThreadDeleteFilesCleaned(context.Background(), operation.OperationID)
				if err != nil {
					t.Fatalf("ConfirmThreadDeleteFilesCleaned: %v", err)
				}
			}
			if testCase.confirmFloret {
				operation, err = first.threadsDB.ConfirmThreadDeleteFloretDeleted(context.Background(), operation.OperationID)
				if err != nil {
					t.Fatalf("ConfirmThreadDeleteFloretDeleted: %v", err)
				}
			}
			if testCase.deleteReadStateBeforeRestart {
				if err := cleaner.DeleteFlowerThreadReadState(context.Background(), meta.EndpointID, thread.ThreadID); err != nil {
					t.Fatalf("DeleteFlowerThreadReadState before restart: %v", err)
				}
			}
			if err := first.Close(); err != nil {
				t.Fatalf("Close first service: %v", err)
			}

			restarted := newThreadDeleteTestService(t, stateDir, host, cleaner)
			defer func() { _ = restarted.Close() }()
			operationAfterRestart, err := restarted.threadsDB.GetThreadDeleteOperation(context.Background(), meta.EndpointID, thread.ThreadID)
			if err != nil || operationAfterRestart == nil || operationAfterRestart.Status != threadstore.ThreadDeleteOperationCommitted {
				t.Fatalf("operation after restart=%+v err=%v", operationAfterRestart, err)
			}
			if cleaner.deleteCount() != testCase.wantReadStateDeleteCount {
				t.Fatalf("read-state delete count=%d, want %d", cleaner.deleteCount(), testCase.wantReadStateDeleteCount)
			}
		})
	}
}

func TestNewServiceMarksCorruptThreadDeleteSnapshotFailed(t *testing.T) {
	stateDir := t.TempDir()
	host := &recordingThreadMaintenanceHost{}
	cleaner := &recordingFlowerReadStateCleaner{}
	first := newThreadDeleteTestService(t, stateDir, host, cleaner)
	meta := &session.Meta{EndpointID: "env_corrupt_delete", UserPublicID: "user_1", CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := first.CreateThread(context.Background(), meta, "corrupt delete", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	operation, err := first.threadsDB.PrepareThreadDeleteOperation(context.Background(), meta.EndpointID, thread.ThreadID, true)
	if err != nil {
		t.Fatalf("PrepareThreadDeleteOperation: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("Close first service: %v", err)
	}

	raw, err := sql.Open("sqlite", filepath.Join(stateDir, "ai", "threads.sqlite"))
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	if _, err := raw.Exec(`UPDATE ai_thread_delete_operations SET snapshot_json = '{' WHERE operation_id = ?`, operation.OperationID); err != nil {
		_ = raw.Close()
		t.Fatalf("corrupt snapshot: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw db: %v", err)
	}

	restarted := newThreadDeleteTestService(t, stateDir, host, cleaner)
	defer func() { _ = restarted.Close() }()
	failed, err := restarted.threadsDB.GetThreadDeleteOperation(context.Background(), meta.EndpointID, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetThreadDeleteOperation: %v", err)
	}
	if failed == nil || failed.Status != threadstore.ThreadDeleteOperationFailed || failed.ErrorCode != "invalid_snapshot_json" {
		t.Fatalf("failed operation=%+v", failed)
	}
	if host.deleteCount() != 0 || cleaner.deleteCount() != 0 {
		t.Fatalf("external cleanup ran for corrupt snapshot: Floret=%d read-state=%d", host.deleteCount(), cleaner.deleteCount())
	}
}
