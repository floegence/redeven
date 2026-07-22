package ai

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
	_ "modernc.org/sqlite"
)

type recordingThreadDeleteHost struct {
	mu        sync.Mutex
	deleteErr error
	deleted   []string
}

func (h *recordingThreadDeleteHost) DeleteThread(_ context.Context, threadID flruntime.ThreadID) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.deleted = append(h.deleted, string(threadID))
	return h.deleteErr
}

func (h *recordingThreadDeleteHost) setDeleteError(err error) {
	h.mu.Lock()
	h.deleteErr = err
	h.mu.Unlock()
}

func (h *recordingThreadDeleteHost) deleteCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.deleted)
}

type recordingFlowerReadStateCleaner struct {
	mu      sync.Mutex
	err     error
	deleted []string
}

func (c *recordingFlowerReadStateCleaner) RetireFlowerThreadReadState(_ context.Context, endpointID string, threadID string) error {
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

func newThreadDeleteTestService(t *testing.T, stateDir string, host *recordingThreadDeleteHost, cleaner *recordingFlowerReadStateCleaner) *Service {
	t.Helper()
	agentHome := filepath.Join(stateDir, "home")
	if err := os.MkdirAll(agentHome, 0o700); err != nil {
		t.Fatalf("ensure agent home: %v", err)
	}
	service, err := NewService(Options{
		StateDir:               stateDir,
		AgentHomeDir:           agentHome,
		FlowerReadStateCleaner: cleaner,
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	if host != nil {
		service.threadDeleteFloret = &threadDeleteFloretCoordinator{authority: testFloretThreadDeleteAuthorityFunc(func(ctx context.Context, threadID flruntime.ThreadID) error {
			return host.DeleteThread(ctx, threadID)
		})}
	}
	stopTestServiceMaintenance(t, service)
	return service
}

func TestServiceDeleteThreadPersistsPendingOperationAndReplaysTransientFailure(t *testing.T) {
	stateDir := t.TempDir()
	host := &recordingThreadDeleteHost{deleteErr: errors.New("temporary Floret failure")}
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
	deletedThread, err := service.threadsDB.GetThreadSettings(context.Background(), meta.EndpointID, thread.ThreadID)
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

func TestStartupDeleteRecoveryProcessesEveryBatchBeforeTurnRecovery(t *testing.T) {
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	host := &recordingThreadDeleteHost{}
	service := &Service{
		threadsDB: store,
		threadDeleteFloret: &threadDeleteFloretCoordinator{authority: testFloretThreadDeleteAuthorityFunc(func(ctx context.Context, threadID flruntime.ThreadID) error {
			return host.DeleteThread(ctx, threadID)
		})},
	}
	const total = threadDeleteReplayBatchSize + 25
	for index := 0; index < total; index++ {
		threadID := fmt.Sprintf("thread_startup_delete_%03d", index)
		if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
			EndpointID: "env_startup_delete", ThreadID: threadID, PermissionType: "approval_required",
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := store.PrepareThreadDeleteOperation(context.Background(), "env_startup_delete", threadID, false); err != nil {
			t.Fatal(err)
		}
	}
	completed, err := service.replayAllPendingThreadDeletesForStartup(context.Background(), threadDeleteReplayBatchSize)
	if err != nil {
		t.Fatal(err)
	}
	if completed != total || host.deleteCount() != total {
		t.Fatalf("completed=%d deleted=%d, want %d", completed, host.deleteCount(), total)
	}
	pending, err := store.ListPendingThreadDeleteOperations(context.Background(), total)
	if err != nil || len(pending) != 0 {
		t.Fatalf("pending deletes=%d err=%v", len(pending), err)
	}
}

func TestStartupDeleteRecoveryFailsClosedBeforeProductDataRemoval(t *testing.T) {
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	host := &recordingThreadDeleteHost{deleteErr: errors.New("temporary canonical delete failure")}
	service := &Service{
		threadsDB: store,
		threadDeleteFloret: &threadDeleteFloretCoordinator{authority: testFloretThreadDeleteAuthorityFunc(func(ctx context.Context, threadID flruntime.ThreadID) error {
			return host.DeleteThread(ctx, threadID)
		})},
	}
	if err := store.CreateThreadSettings(context.Background(), threadstore.ThreadSettings{
		EndpointID: "env_startup_block", ThreadID: "thread_startup_block", PermissionType: "approval_required",
	}); err != nil {
		t.Fatal(err)
	}
	operation, err := store.PrepareThreadDeleteOperation(context.Background(), "env_startup_block", "thread_startup_block", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.replayAllPendingThreadDeletesForStartup(context.Background(), threadDeleteReplayBatchSize); err == nil || !strings.Contains(err.Error(), "remains pending before product data removal") {
		t.Fatalf("startup delete recovery error=%v", err)
	}
	stored, err := store.GetThreadDeleteOperation(context.Background(), operation.EndpointID, operation.ThreadID)
	if err != nil || stored == nil || stored.ProductDataDeletedAtUnixMs != 0 || stored.Status != threadstore.ThreadDeleteOperationPending {
		t.Fatalf("pending operation=%#v err=%v", stored, err)
	}
}

func TestServiceRenameDoesNotMutateCanonicalTitleAfterDeleteIntent(t *testing.T) {
	stateDir := t.TempDir()
	host := &recordingThreadDeleteHost{deleteErr: errors.New("temporary Floret failure")}
	service := newThreadDeleteTestService(t, stateDir, host, &recordingFlowerReadStateCleaner{})
	defer func() { _ = service.Close() }()
	meta := &session.Meta{EndpointID: "env_delete_rename", UserPublicID: "user_1", CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := service.CreateThread(context.Background(), meta, "title before delete", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if _, err := service.DeleteThread(context.Background(), meta, thread.ThreadID, false); err != nil {
		t.Fatalf("DeleteThread: %v", err)
	}
	if err := service.RenameThread(context.Background(), meta, thread.ThreadID, "title after delete"); !errors.Is(err, threadstore.ErrThreadIDRetired) {
		t.Fatalf("RenameThread error=%v, want %v", err, threadstore.ErrThreadIDRetired)
	}
	canonical, err := service.openFloretMaintenanceHost(context.Background(), thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	overview, err := canonical.ReadThreadOverview(context.Background(), flruntime.ThreadID(thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	if overview.Thread.Title != "title before delete" {
		t.Fatalf("canonical title=%q, want original title", overview.Thread.Title)
	}
}

func TestNewServiceReplaysPendingThreadDeleteOperationsFromEveryCrashBoundary(t *testing.T) {
	for _, testCase := range []struct {
		name                     string
		confirmFloret            bool
		commitProductData        bool
		confirmReadState         bool
		confirmFiles             bool
		wantReadStateDeleteCount int
		wantLiveRetired          bool
	}{
		{name: "after_intent_persisted", wantReadStateDeleteCount: 1, wantLiveRetired: true},
		{name: "after_floret_confirmation", confirmFloret: true, wantReadStateDeleteCount: 1, wantLiveRetired: true},
		{name: "after_product_data_commit", confirmFloret: true, commitProductData: true, wantReadStateDeleteCount: 1, wantLiveRetired: true},
		{name: "after_read_state_cleanup", confirmFloret: true, commitProductData: true, confirmReadState: true, wantLiveRetired: true},
		{name: "after_physical_file_cleanup", confirmFloret: true, commitProductData: true, confirmReadState: true, confirmFiles: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			stateDir := t.TempDir()
			cleaner := &recordingFlowerReadStateCleaner{}
			first := newThreadDeleteTestService(t, stateDir, nil, cleaner)
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
				deleteCanonicalFloretThreadForTest(t, first, thread.ThreadID)
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

			restarted := newThreadDeleteTestService(t, stateDir, nil, cleaner)
			defer func() { _ = restarted.Close() }()
			operationAfterRestart, err := restarted.threadsDB.GetThreadDeleteOperation(context.Background(), meta.EndpointID, thread.ThreadID)
			if err != nil || operationAfterRestart == nil || operationAfterRestart.Status != threadstore.ThreadDeleteOperationCommitted {
				t.Fatalf("operation after restart=%+v err=%v", operationAfterRestart, err)
			}
			if cleaner.deleteCount() != testCase.wantReadStateDeleteCount {
				t.Fatalf("read-state delete count=%d, want %d", cleaner.deleteCount(), testCase.wantReadStateDeleteCount)
			}
			threadKey := runThreadKey(meta.EndpointID, thread.ThreadID)
			restarted.mu.Lock()
			_, liveRetired := restarted.flowerLiveRetired[threadKey]
			_, liveStreamExists := restarted.flowerLiveByThread[threadKey]
			restarted.mu.Unlock()
			if liveRetired != testCase.wantLiveRetired || liveStreamExists {
				t.Fatalf("live retirement after restart retired/stream=%v/%v, want %v/false", liveRetired, liveStreamExists, testCase.wantLiveRetired)
			}
			if _, err := restarted.openFloretThreadReadHost(context.Background(), thread.ThreadID); !errors.Is(err, flruntime.ErrThreadDeleted) {
				t.Fatalf("canonical thread after replay error=%v, want %v", err, flruntime.ErrThreadDeleted)
			}
		})
	}
}

func TestNewServiceMarksCorruptThreadDeleteSnapshotFailed(t *testing.T) {
	stateDir := t.TempDir()
	host := &recordingThreadDeleteHost{}
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

	_, err = NewService(Options{StateDir: stateDir, AgentHomeDir: filepath.Join(stateDir, "home")})
	if err == nil || !strings.Contains(err.Error(), "recover pending thread deletes") {
		t.Fatalf("NewService error=%v, want strict delete recovery failure", err)
	}
	store, err := threadstore.Open(filepath.Join(stateDir, "ai", "threads.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	failed, err := store.GetThreadDeleteOperation(context.Background(), meta.EndpointID, thread.ThreadID)
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
