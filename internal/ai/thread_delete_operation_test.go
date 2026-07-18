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

func (h *recordingThreadMaintenanceHost) EnsureThread(_ context.Context, req flruntime.EnsureThreadRequest) (flruntime.ThreadSummary, error) {
	return flruntime.ThreadSummary{ID: req.ThreadID}, nil
}

func (h *recordingThreadMaintenanceHost) ReadThread(_ context.Context, threadID flruntime.ThreadID) (flruntime.ThreadSnapshot, error) {
	return flruntime.ThreadSnapshot{ID: threadID}, nil
}

func (h *recordingThreadMaintenanceHost) ListThreadTurns(_ context.Context, _ flruntime.ListThreadTurnsRequest) (flruntime.ThreadTurnsPage, error) {
	return flruntime.ThreadTurnsPage{}, nil
}

func (h *recordingThreadMaintenanceHost) ReadThreadAgentTodos(_ context.Context, threadID flruntime.ThreadID) (flruntime.ThreadAgentTodoState, error) {
	return flruntime.ThreadAgentTodoState{ThreadID: threadID}, nil
}

func (h *recordingThreadMaintenanceHost) UpdateThreadAgentTodos(_ context.Context, req flruntime.UpdateThreadAgentTodosRequest) (flruntime.ThreadAgentTodoState, error) {
	return flruntime.ThreadAgentTodoState{ThreadID: req.ThreadID, Version: req.ExpectedVersion + 1, Items: req.Items}, nil
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
	result, err := service.DeleteThread(context.Background(), meta, thread.ThreadID, false)
	if err != nil {
		t.Fatalf("DeleteThread: %v", err)
	}
	if result.Status != ThreadDeleteStatusPending || result.OperationID == "" {
		t.Fatalf("result=%+v", result)
	}
	deletedThread, err := service.threadsDB.GetThread(context.Background(), meta.EndpointID, thread.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if deletedThread == nil {
		t.Fatal("thread settings were deleted before canonical Floret deletion succeeded")
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
		name                     string
		confirmFloret            bool
		commitProductData        bool
		confirmReadState         bool
		confirmFiles             bool
		wantHostDeleteCount      int
		wantReadStateDeleteCount int
	}{
		{name: "after_intent_persisted", wantHostDeleteCount: 1, wantReadStateDeleteCount: 1},
		{name: "after_floret_confirmation", confirmFloret: true, wantReadStateDeleteCount: 1},
		{name: "after_product_data_commit", confirmFloret: true, commitProductData: true, wantReadStateDeleteCount: 1},
		{name: "after_read_state_cleanup", confirmFloret: true, commitProductData: true, confirmReadState: true},
		{name: "after_physical_file_cleanup", confirmFloret: true, commitProductData: true, confirmReadState: true, confirmFiles: true},
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
			if testCase.confirmFloret {
				operation, err = first.threadsDB.ConfirmThreadDeleteFloretDeleted(context.Background(), operation.OperationID)
				if err != nil {
					t.Fatalf("ConfirmThreadDeleteFloretDeleted: %v", err)
				}
			}
			if testCase.commitProductData {
				operation, err = first.threadsDB.CommitThreadDeleteProductData(context.Background(), operation.OperationID)
				if err != nil {
					t.Fatalf("CommitThreadDeleteProductData: %v", err)
				}
			}
			if testCase.confirmReadState {
				operation, err = first.threadsDB.ConfirmThreadDeleteReadStateDeleted(context.Background(), operation.OperationID)
				if err != nil {
					t.Fatalf("ConfirmThreadDeleteReadStateDeleted: %v", err)
				}
			}
			if testCase.confirmFiles {
				operation, err = first.threadsDB.ConfirmThreadDeleteFilesCleaned(context.Background(), operation.OperationID)
				if err != nil {
					t.Fatalf("ConfirmThreadDeleteFilesCleaned: %v", err)
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
			if host.deleteCount() != testCase.wantHostDeleteCount {
				t.Fatalf("Floret delete count=%d, want %d", host.deleteCount(), testCase.wantHostDeleteCount)
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
