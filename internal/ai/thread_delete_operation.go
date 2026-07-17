package ai

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

const threadDeleteReplayBatchSize = 50

var ErrThreadDeleteOperationFailed = errors.New("thread delete operation failed")

type ThreadDeleteStatus string

const (
	ThreadDeleteStatusPending   ThreadDeleteStatus = ThreadDeleteStatus(threadstore.ThreadDeleteOperationPending)
	ThreadDeleteStatusCommitted ThreadDeleteStatus = ThreadDeleteStatus(threadstore.ThreadDeleteOperationCommitted)
	ThreadDeleteStatusFailed    ThreadDeleteStatus = ThreadDeleteStatus(threadstore.ThreadDeleteOperationFailed)
)

type ThreadDeleteResult struct {
	OperationID string             `json:"operation_id"`
	Status      ThreadDeleteStatus `json:"status"`
}

func threadDeleteResult(operation threadstore.ThreadDeleteOperation) ThreadDeleteResult {
	return ThreadDeleteResult{OperationID: strings.TrimSpace(operation.OperationID), Status: ThreadDeleteStatus(strings.TrimSpace(operation.Status))}
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
		result, err := s.replayThreadDeleteOperation(ctx, operation)
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

func (s *Service) replayThreadDeleteOperation(ctx context.Context, operation threadstore.ThreadDeleteOperation) (threadstore.ThreadDeleteOperation, error) {
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
	if operation.Status != threadstore.ThreadDeleteOperationPending {
		return operation, nil
	}
	if !operation.SnapshotValid {
		failed, markErr := db.MarkThreadDeleteFailed(ctxOrBackground(ctx), operation.OperationID, operation.SnapshotErrorCode, "thread delete snapshot contract is invalid")
		if markErr != nil {
			return operation, markErr
		}
		return failed, ErrThreadDeleteOperationFailed
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
	if operation.FloretDeletedAtUnixMs <= 0 {
		host, err := s.openThreadDeleteMaintenanceHost()
		if err != nil {
			return s.keepThreadDeletePending(ctx, operation, "floret_host_open_failed", err)
		}
		deleteErr := host.DeleteThread(ctxOrBackground(ctx), flruntime.ThreadID(operation.ThreadID))
		if deleteErr != nil && !errors.Is(deleteErr, flruntime.ErrThreadNotFound) {
			return s.keepThreadDeletePending(ctx, operation, "floret_delete_failed", deleteErr)
		}
		confirmed, err := db.ConfirmThreadDeleteFloretDeleted(ctxOrBackground(ctx), operation.OperationID)
		if err != nil {
			return operation, err
		}
		operation = confirmed
	}
	if operation.Snapshot.DeleteFlowerReadState && operation.ReadStateDeletedAtUnixMs <= 0 {
		if cleaner == nil {
			return s.keepThreadDeletePending(ctx, operation, "read_state_cleaner_unavailable", errors.New("Flower read-state cleaner is unavailable"))
		}
		if err := cleaner.DeleteFlowerThreadReadState(ctxOrBackground(ctx), operation.EndpointID, operation.ThreadID); err != nil {
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
	return operation, nil
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
	for _, checkpointID := range operation.Snapshot.CheckpointIDs {
		checkpointID = strings.TrimSpace(checkpointID)
		if checkpointID == "" {
			return errors.New("thread delete snapshot contains empty checkpoint id")
		}
		if err := os.RemoveAll(checkpointArtifactsDir(s.stateDir, checkpointID)); err != nil {
			return fmt.Errorf("delete checkpoint %s: %w", checkpointID, err)
		}
	}
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

func (s *Service) openThreadDeleteMaintenanceHost() (ThreadMaintenanceHost, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	s.mu.Lock()
	openHost := s.openDeleteMaintenanceHost
	s.mu.Unlock()
	if openHost != nil {
		return openHost()
	}
	return s.openFloretMaintenanceHost()
}
