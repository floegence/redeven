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
	"time"

	flruntime "github.com/floegence/floret/v2/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
	_ "modernc.org/sqlite"
)

type recordingThreadDeleteHost struct {
	mu        sync.Mutex
	deleteErr error
	deleted   []string
}

type blockingThreadDeleteHost struct {
	mu      sync.Mutex
	count   int
	entered chan struct{}
	release chan struct{}
}

func (h *blockingThreadDeleteHost) DeleteThread(ctx context.Context, _ flruntime.ThreadID) error {
	h.mu.Lock()
	h.count++
	h.mu.Unlock()
	h.entered <- struct{}{}
	select {
	case <-h.release:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (h *blockingThreadDeleteHost) deleteCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.count
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
	canonicalReadCount := 0
	service.floretReads.thread = func(context.Context, flruntime.ThreadID) (floretThreadReadHost, error) {
		canonicalReadCount++
		return nil, errors.New("canonical read must not run for a retired thread")
	}
	view, err := service.GetThread(context.Background(), meta, thread.ThreadID)
	if err != nil || view != nil || canonicalReadCount != 0 {
		t.Fatalf("retired detail view=%#v reads=%d err=%v", view, canonicalReadCount, err)
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
	floretDeleteCount := host.deleteCount()
	replayed, err := service.advanceThreadDeleteOperation(context.Background(), operation.OperationID, operation.EndpointID, operation.ThreadID)
	if err != nil || replayed.Status != threadstore.ThreadDeleteOperationCommitted {
		t.Fatalf("replay committed operation=%+v err=%v", replayed, err)
	}
	if host.deleteCount() != floretDeleteCount || cleaner.deleteCount() != 1 {
		t.Fatalf("committed replay repeated cleanup: Floret=%d/%d read-state=%d", host.deleteCount(), floretDeleteCount, cleaner.deleteCount())
	}
}

func TestServiceDeleteThreadAcceptsIntentWhenStepConfirmationIsInterrupted(t *testing.T) {
	host := &recordingThreadDeleteHost{}
	cleaner := &recordingFlowerReadStateCleaner{}
	service := newThreadDeleteTestService(t, t.TempDir(), nil, cleaner)
	defer func() { _ = service.Close() }()
	meta := &session.Meta{EndpointID: "env_delete_confirmation_interrupted", UserPublicID: "user_1", CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := service.CreateThread(context.Background(), meta, "confirmation interrupted", "", "", "")
	if err != nil {
		t.Fatal(err)
	}

	deleteCtx, cancelDelete := context.WithCancel(context.Background())
	service.threadDeleteFloret = &threadDeleteFloretCoordinator{authority: testFloretThreadDeleteAuthorityFunc(func(ctx context.Context, threadID flruntime.ThreadID) error {
		err := host.DeleteThread(ctx, threadID)
		cancelDelete()
		return err
	})}
	result, err := service.DeleteThread(deleteCtx, meta, thread.ThreadID, false)
	if err != nil || result.Status != ThreadDeleteStatusPending || !result.IntentPersisted {
		t.Fatalf("DeleteThread result=%+v err=%v", result, err)
	}
	operation, err := service.threadsDB.GetThreadDeleteOperation(context.Background(), meta.EndpointID, thread.ThreadID)
	if err != nil || operation == nil || operation.Status != threadstore.ThreadDeleteOperationPending || operation.FloretDeletedAtUnixMs != 0 {
		t.Fatalf("operation=%+v err=%v", operation, err)
	}
	if host.deleteCount() != 1 || cleaner.deleteCount() != 0 {
		t.Fatalf("cleanup counts Floret=%d read-state=%d, want 1/0", host.deleteCount(), cleaner.deleteCount())
	}
}

func TestClassifyFloretThreadDeleteError(t *testing.T) {
	t.Parallel()
	terminal := []error{
		flruntime.ErrThreadNotFound,
		flruntime.ErrThreadDeleted,
		flruntime.ErrSubAgentParentRequired,
		flruntime.ErrAuthorityCorrupt,
		flruntime.ErrUnsupportedStoreCapability,
		flruntime.ErrRequestConflict,
		flruntime.ErrJournalInvariant,
		flruntime.ErrThreadAuthorityInvariant,
	}
	for _, err := range terminal {
		if code, ok := classifyFloretThreadDeleteError(fmt.Errorf("wrapped: %w", err)); !ok || code == "" {
			t.Fatalf("terminal error %v classified as code=%q terminal=%v", err, code, ok)
		}
	}
	retryable := []error{
		flruntime.ErrThreadBusy,
		&flruntime.AuthorityBusyError{Kind: flruntime.AuthorityBusyAuthority},
		flruntime.ErrSubAgentClosing,
		flruntime.ErrStaleAuthority,
		flruntime.ErrStoreClosed,
		context.Canceled,
		context.DeadlineExceeded,
		&flruntime.CommittedCleanupError{ThreadID: "thread", Err: errors.New("cleanup")},
		errors.New("transient transport failure"),
	}
	for _, err := range retryable {
		if code, ok := classifyFloretThreadDeleteError(err); ok || code != "" {
			t.Fatalf("retryable error %v classified as code=%q terminal=%v", err, code, ok)
		}
	}
}

func TestServiceDeleteThreadMarksMissingCanonicalThreadTerminal(t *testing.T) {
	host := &recordingThreadDeleteHost{deleteErr: flruntime.ErrThreadNotFound}
	cleaner := &recordingFlowerReadStateCleaner{}
	service := newThreadDeleteTestService(t, t.TempDir(), host, cleaner)
	defer func() { _ = service.Close() }()
	meta := &session.Meta{EndpointID: "env_delete_missing_canonical", UserPublicID: "user_1", CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := service.CreateThread(context.Background(), meta, "missing canonical", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	denied := &session.Meta{EndpointID: meta.EndpointID, UserPublicID: "user_2", CanRead: true}
	if _, err := service.DeleteThread(context.Background(), denied, thread.ThreadID, false); err == nil || host.deleteCount() != 0 {
		t.Fatalf("permission failure err=%v Floret calls=%d", err, host.deleteCount())
	}
	result, err := service.DeleteThread(context.Background(), meta, thread.ThreadID, false)
	if !errors.Is(err, ErrThreadDeleteOperationFailed) || result.Status != ThreadDeleteStatusFailed || !result.IntentPersisted {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	operation, err := service.threadsDB.GetThreadDeleteOperation(context.Background(), meta.EndpointID, thread.ThreadID)
	if err != nil || operation == nil || operation.ErrorCode != threadDeleteErrorFloretNotFound || operation.FloretDeletedAtUnixMs != 0 || operation.ProductDataDeletedAtUnixMs != 0 {
		t.Fatalf("operation=%+v err=%v", operation, err)
	}
	settings, err := service.threadsDB.GetThreadSettings(context.Background(), meta.EndpointID, thread.ThreadID)
	if err != nil || settings == nil || cleaner.deleteCount() != 0 {
		t.Fatalf("settings=%+v read-state deletes=%d err=%v", settings, cleaner.deleteCount(), err)
	}
	canonicalReadCount := 0
	service.floretReads.thread = func(context.Context, flruntime.ThreadID) (floretThreadReadHost, error) {
		canonicalReadCount++
		return nil, errors.New("canonical read must not run for a failed delete intent")
	}
	view, err := service.GetThread(context.Background(), meta, thread.ThreadID)
	if err != nil || view != nil || canonicalReadCount != 0 {
		t.Fatalf("failed retired detail view=%#v reads=%d err=%v", view, canonicalReadCount, err)
	}
	replayed, err := service.advanceThreadDeleteOperation(context.Background(), operation.OperationID, operation.EndpointID, operation.ThreadID)
	if !errors.Is(err, ErrThreadDeleteOperationFailed) || replayed.Status != threadstore.ThreadDeleteOperationFailed {
		t.Fatalf("replay failed operation=%+v err=%v", replayed, err)
	}
	if host.deleteCount() != 1 || cleaner.deleteCount() != 0 {
		t.Fatalf("failed replay repeated cleanup: Floret=%d read-state=%d", host.deleteCount(), cleaner.deleteCount())
	}
}

func TestThreadDeleteAdvancementAcceptsExactFloretTombstoneReplay(t *testing.T) {
	service := newThreadDeleteTestService(t, t.TempDir(), nil, &recordingFlowerReadStateCleaner{})
	defer func() { _ = service.Close() }()
	meta := &session.Meta{EndpointID: "env_delete_tombstone_replay", UserPublicID: "user_1", CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := service.CreateThread(context.Background(), meta, "tombstone replay", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	operation, err := service.threadsDB.PrepareThreadDeleteOperation(context.Background(), meta.EndpointID, thread.ThreadID, true)
	if err != nil {
		t.Fatal(err)
	}
	deleteCanonicalFloretThreadForTest(t, service, thread.ThreadID)
	advanced, err := service.advanceThreadDeleteOperation(context.Background(), operation.OperationID, operation.EndpointID, operation.ThreadID)
	if err != nil || advanced.Status != threadstore.ThreadDeleteOperationCommitted || advanced.FloretDeletedAtUnixMs <= 0 {
		t.Fatalf("advanced=%+v err=%v", advanced, err)
	}
}

func TestThreadDeleteAdvancementSerializesExplicitAndPeriodicReplay(t *testing.T) {
	cleaner := &recordingFlowerReadStateCleaner{}
	service := newThreadDeleteTestService(t, t.TempDir(), nil, cleaner)
	defer func() { _ = service.Close() }()
	host := &blockingThreadDeleteHost{entered: make(chan struct{}, 2), release: make(chan struct{})}
	service.threadDeleteFloret = &threadDeleteFloretCoordinator{authority: testFloretThreadDeleteAuthorityFunc(host.DeleteThread)}
	meta := &session.Meta{EndpointID: "env_delete_serial", UserPublicID: "user_1", CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := service.CreateThread(context.Background(), meta, "serialized delete", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	type deleteOutcome struct {
		result ThreadDeleteResult
		err    error
	}
	deleteDone := make(chan deleteOutcome, 1)
	go func() {
		result, err := service.DeleteThread(context.Background(), meta, thread.ThreadID, false)
		deleteDone <- deleteOutcome{result: result, err: err}
	}()
	<-host.entered
	replayDone := make(chan error, 1)
	go func() {
		_, err := service.replayPendingThreadDeletes(context.Background(), 10)
		replayDone <- err
	}()
	select {
	case <-host.entered:
		t.Fatal("periodic replay entered Floret while explicit delete held the lifecycle gate")
	case <-time.After(100 * time.Millisecond):
	}
	close(host.release)
	outcome := <-deleteDone
	if outcome.err != nil || outcome.result.Status != ThreadDeleteStatusCommitted {
		t.Fatalf("explicit delete result=%+v err=%v", outcome.result, outcome.err)
	}
	if err := <-replayDone; err != nil {
		t.Fatalf("periodic replay: %v", err)
	}
	if host.deleteCount() != 1 || cleaner.deleteCount() != 1 {
		t.Fatalf("external cleanup counts Floret=%d read-state=%d, want 1/1", host.deleteCount(), cleaner.deleteCount())
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
	service.threadMgr = newThreadManager(service)
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
	service.threadMgr = newThreadManager(service)
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
	overview, err := canonical.ReadThreadOverview(context.Background())
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
	_, err = NewService(Options{StateDir: stateDir, AgentHomeDir: filepath.Join(stateDir, "home")})
	if err == nil || !errors.Is(err, ErrThreadDeleteOperationFailed) {
		t.Fatalf("second NewService error=%v, want persistent terminal delete failure", err)
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
