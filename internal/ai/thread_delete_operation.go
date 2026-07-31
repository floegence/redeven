package ai

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

const threadDeleteReplayBatchSize = 50

var ErrThreadDeleteOperationFailed = errors.New("thread delete operation failed")

const threadDeleteErrorFloretNotFound = "floret_thread_not_found"

type threadDeleteFloretCoordinator struct {
	authority floretThreadDeleteAuthority
}

func (c *threadDeleteFloretCoordinator) delete(ctx context.Context, operationID string, threadID string) error {
	if c == nil || c.authority == nil {
		return errors.New("Floret delete coordinator authority is unavailable")
	}
	return c.authority.DeleteThread(ctxOrBackground(ctx), identity.ThreadID(strings.TrimSpace(threadID)), flruntime.DeleteThreadCommand{
		LogicalRequestID: identity.LogicalRequestID(strings.TrimSpace(operationID)),
	})
}

type ThreadDeleteStatus string

const (
	ThreadDeleteStatusPending   ThreadDeleteStatus = ThreadDeleteStatus(threadstore.ThreadDeleteOperationPending)
	ThreadDeleteStatusCommitted ThreadDeleteStatus = ThreadDeleteStatus(threadstore.ThreadDeleteOperationCommitted)
	ThreadDeleteStatusFailed    ThreadDeleteStatus = ThreadDeleteStatus(threadstore.ThreadDeleteOperationFailed)
)

type ThreadDeleteResult struct {
	OperationID     string             `json:"operation_id"`
	Status          ThreadDeleteStatus `json:"status"`
	IntentPersisted bool               `json:"intent_persisted"`
}

func threadDeleteResult(operation threadstore.ThreadDeleteOperation) ThreadDeleteResult {
	return ThreadDeleteResult{
		OperationID:     strings.TrimSpace(operation.OperationID),
		Status:          ThreadDeleteStatus(strings.TrimSpace(operation.Status)),
		IntentPersisted: true,
	}
}

func (s *Service) replayPendingThreadDeletes(ctx context.Context, limit int) (int, error) {
	if s == nil {
		return 0, errors.New("nil service")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return 0, errors.New("threads store not ready")
	}
	operations, err := db.ListPendingThreadDeleteOperations(ctxOrBackground(ctx), limit)
	if err != nil {
		return 0, err
	}
	completed := 0
	var replayErr error
	for _, operation := range operations {
		result, err := s.advanceThreadDeleteOperation(ctx, operation.OperationID, operation.EndpointID, operation.ThreadID)
		if err != nil {
			replayErr = errors.Join(replayErr, err)
			continue
		}
		if result.Status == threadstore.ThreadDeleteOperationCommitted {
			completed++
		}
	}
	return completed, replayErr
}

func (s *Service) replayAllPendingThreadDeletesForStartup(ctx context.Context, limit int) (int, error) {
	if s == nil || s.threadsDB == nil {
		return 0, errors.New("threads store not ready")
	}
	if limit <= 0 {
		limit = threadDeleteReplayBatchSize
	}
	if err := s.requireNoFailedThreadDeleteOperations(ctx); err != nil {
		return 0, err
	}
	completed := 0
	afterOperationID := ""
	for {
		operations, err := s.threadsDB.ListPendingThreadDeleteOperationsAfter(ctxOrBackground(ctx), afterOperationID, limit)
		if err != nil {
			return completed, err
		}
		if len(operations) == 0 {
			return completed, nil
		}
		for _, operation := range operations {
			afterOperationID = operation.OperationID
			result, err := s.advanceThreadDeleteOperation(ctxOrBackground(ctx), operation.OperationID, operation.EndpointID, operation.ThreadID)
			if err != nil {
				return completed, fmt.Errorf("replay thread delete %q: %w", operation.OperationID, err)
			}
			switch result.Status {
			case threadstore.ThreadDeleteOperationCommitted:
				completed++
			case threadstore.ThreadDeleteOperationPending:
				if result.ProductDataDeletedAtUnixMs <= 0 {
					return completed, fmt.Errorf("thread delete %q remains pending before product data removal", operation.OperationID)
				}
			case threadstore.ThreadDeleteOperationFailed:
				return completed, fmt.Errorf("thread delete %q is terminally failed", operation.OperationID)
			default:
				return completed, fmt.Errorf("thread delete %q has invalid status %q", operation.OperationID, result.Status)
			}
		}
	}
}

func (s *Service) requireNoFailedThreadDeleteOperations(ctx context.Context) error {
	failed, err := s.threadsDB.FirstFailedThreadDeleteOperation(ctxOrBackground(ctx))
	if err != nil {
		return err
	}
	if failed == nil {
		return nil
	}
	return fmt.Errorf("thread delete %q is terminally failed (%s): %w", failed.OperationID, failed.ErrorCode, ErrThreadDeleteOperationFailed)
}

func (s *Service) advanceThreadDeleteOperation(ctx context.Context, operationID string, endpointID string, threadID string) (threadstore.ThreadDeleteOperation, error) {
	operationID = strings.TrimSpace(operationID)
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	operation := threadstore.ThreadDeleteOperation{OperationID: operationID, EndpointID: endpointID, ThreadID: threadID}
	if s == nil {
		return operation, errors.New("nil service")
	}
	s.mu.Lock()
	db := s.threadsDB
	cleaner := s.flowerReadStateCleaner
	s.mu.Unlock()
	if db == nil {
		return operation, errors.New("threads store not ready")
	}
	if s.threadMgr == nil {
		return operation, errors.New("thread manager not ready")
	}
	if operationID == "" || endpointID == "" || threadID == "" {
		return operation, errors.New("invalid thread delete operation identity")
	}
	unlockLifecycle, err := s.threadMgr.lockThreadLifecycleContext(ctxOrBackground(ctx), endpointID, threadID)
	if err != nil {
		return operation, err
	}
	defer unlockLifecycle()
	current, err := db.GetThreadDeleteOperation(ctxOrBackground(ctx), endpointID, threadID)
	if err != nil {
		return operation, err
	}
	if current == nil {
		return operation, errors.New("thread delete operation is missing")
	}
	operation = *current
	if operation.OperationID != operationID || operation.EndpointID != endpointID || operation.ThreadID != threadID {
		failed, markErr := db.MarkThreadDeleteIntegrityFailed(ctxOrBackground(ctx), operation.OperationID, "operation_identity_mismatch", "thread delete operation identity mismatch")
		if markErr != nil {
			return operation, markErr
		}
		return failed, ErrThreadDeleteOperationFailed
	}
	switch operation.Status {
	case threadstore.ThreadDeleteOperationCommitted:
		return operation, nil
	case threadstore.ThreadDeleteOperationFailed:
		return operation, ErrThreadDeleteOperationFailed
	case threadstore.ThreadDeleteOperationPending:
	default:
		failed, markErr := db.MarkThreadDeleteIntegrityFailed(ctxOrBackground(ctx), operation.OperationID, "invalid_operation_status", fmt.Sprintf("invalid thread delete operation status %q", operation.Status))
		if markErr != nil {
			return operation, markErr
		}
		return failed, ErrThreadDeleteOperationFailed
	}
	if !operation.SnapshotValid {
		failed, markErr := db.MarkThreadDeleteFailed(ctxOrBackground(ctx), operation.OperationID, operation.SnapshotErrorCode, "thread delete snapshot contract is invalid")
		if markErr != nil {
			return operation, markErr
		}
		return failed, ErrThreadDeleteOperationFailed
	}
	s.retireFlowerLiveThread(operation.EndpointID, operation.ThreadID)
	if operation.FloretDeletedAtUnixMs <= 0 {
		if s.threadDeleteFloret == nil {
			return s.keepThreadDeletePending(ctx, operation, "floret_host_open_failed", errors.New("Floret delete coordinator authority is unavailable"))
		}
		deleteErr := s.threadDeleteFloret.delete(ctx, operation.OperationID, operation.ThreadID)
		if deleteErr != nil {
			if errorCode, terminal := classifyFloretThreadDeleteError(deleteErr); terminal {
				failed, markErr := db.MarkThreadDeleteFailed(ctxOrBackground(ctx), operation.OperationID, errorCode, sanitizeLogText(deleteErr.Error(), 600))
				if markErr != nil {
					return operation, markErr
				}
				return failed, ErrThreadDeleteOperationFailed
			}
			return s.keepThreadDeletePending(ctx, operation, "floret_delete_failed", deleteErr)
		}
		confirmed, err := db.ConfirmThreadDeleteFloretDeleted(ctxOrBackground(ctx), operation.OperationID)
		if err != nil {
			return operation, err
		}
		operation = confirmed
	}
	if operation.ProductDataDeletedAtUnixMs <= 0 {
		committed, err := db.CommitThreadDeleteProductData(ctxOrBackground(ctx), operation.OperationID)
		if err != nil {
			return s.keepThreadDeletePending(ctx, operation, "product_data_delete_failed", err)
		}
		operation = committed
	}
	if operation.Snapshot.DeleteFlowerReadState && operation.ReadStateDeletedAtUnixMs <= 0 {
		if cleaner == nil {
			return s.keepThreadDeletePending(ctx, operation, "read_state_cleaner_unavailable", errors.New("Flower read-state cleaner is unavailable"))
		}
		if err := cleaner.RetireFlowerThreadReadState(ctxOrBackground(ctx), operation.EndpointID, operation.ThreadID); err != nil {
			return s.keepThreadDeletePending(ctx, operation, "read_state_delete_failed", err)
		}
		confirmed, err := db.ConfirmThreadDeleteReadStateDeleted(ctxOrBackground(ctx), operation.OperationID)
		if err != nil {
			return operation, err
		}
		operation = confirmed
	}
	if !operation.Snapshot.DeleteFlowerReadState && operation.Status == threadstore.ThreadDeleteOperationPending {
		confirmed, err := db.ConfirmThreadDeleteReadStateDeleted(ctxOrBackground(ctx), operation.OperationID)
		if err != nil {
			return operation, err
		}
		operation = confirmed
	}
	if operation.FilesCleanedAtUnixMs <= 0 {
		if err := s.cleanupThreadDeleteFiles(ctx, operation); err != nil {
			return s.keepThreadDeletePending(ctx, operation, "file_cleanup_failed", err)
		}
		confirmed, err := db.ConfirmThreadDeleteFilesCleaned(ctxOrBackground(ctx), operation.OperationID)
		if err != nil {
			return operation, err
		}
		operation = confirmed
	}
	return operation, nil
}

func classifyFloretThreadDeleteError(err error) (string, bool) {
	switch {
	case errors.Is(err, flruntime.ErrThreadNotFound):
		return threadDeleteErrorFloretNotFound, true
	case errors.Is(err, flruntime.ErrThreadDeleted):
		return "floret_thread_deleted", true
	case errors.Is(err, flruntime.ErrSubAgentParentRequired):
		return "floret_subagent_parent_required", true
	case errors.Is(err, flruntime.ErrAuthorityCorrupt):
		return "floret_authority_corrupt", true
	case errors.Is(err, flruntime.ErrUnsupportedStoreCapability):
		return "floret_store_capability_unsupported", true
	case errors.Is(err, flruntime.ErrRequestConflict):
		return "floret_request_conflict", true
	case errors.Is(err, flruntime.ErrJournalInvariant):
		return "floret_journal_invariant", true
	case errors.Is(err, flruntime.ErrThreadAuthorityInvariant):
		return "floret_thread_authority_invariant", true
	default:
		return "", false
	}
}

func (s *Service) keepThreadDeletePending(ctx context.Context, operation threadstore.ThreadDeleteOperation, errorCode string, cause error) (threadstore.ThreadDeleteOperation, error) {
	if cause == nil {
		return operation, nil
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return operation, errors.New("threads store not ready")
	}
	pending, err := db.RecordThreadDeleteRetry(ctxOrBackground(ctx), operation.OperationID, errorCode, sanitizeLogText(cause.Error(), 600))
	if err != nil {
		return operation, err
	}
	if s.log != nil {
		s.log.Warn("ai: thread delete operation remains pending", "operation_id", operation.OperationID, "endpoint_id", operation.EndpointID, "thread_id", operation.ThreadID, "error_code", errorCode, "error", cause)
	}
	return pending, nil
}

func (s *Service) cleanupThreadDeleteFiles(ctx context.Context, operation threadstore.ThreadDeleteOperation) error {
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	deletedUploadIDs := make([]string, 0, len(operation.Snapshot.UploadCleanupIDs))
	for _, uploadID := range operation.Snapshot.UploadCleanupIDs {
		uploadID = strings.TrimSpace(uploadID)
		if uploadID == "" {
			return errors.New("thread delete snapshot contains empty upload id")
		}
		record, err := db.GetUpload(ctxOrBackground(ctx), operation.EndpointID, uploadID)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		if record == nil {
			continue
		}
		if record.State != threadstore.UploadStateDeleting {
			continue
		}
		if err := s.removeUploadArtifacts(*record); err != nil {
			return fmt.Errorf("delete upload %s: %w", uploadID, err)
		}
		deletedUploadIDs = append(deletedUploadIDs, uploadID)
	}
	if len(deletedUploadIDs) > 0 {
		if _, err := db.FinalizeDeletedUploads(ctxOrBackground(ctx), deletedUploadIDs); err != nil {
			return err
		}
	}
	return nil
}
