package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

const threadForkReplayBatchSize = 20

type threadForkFloretCoordinator struct {
	authority floretThreadForkAuthority
}

func (c *threadForkFloretCoordinator) fork(ctx context.Context, logicalRequestID string, sourceThreadID string) (flruntime.ForkThreadResultV3, error) {
	if c == nil || c.authority == nil {
		return flruntime.ForkThreadResultV3{}, errors.New("Floret fork coordinator authority is unavailable")
	}
	return c.authority.ForkThread(ctxOrBackground(ctx), identity.ThreadID(strings.TrimSpace(sourceThreadID)), flruntime.ForkThreadCommand{LogicalRequestID: identity.LogicalRequestID(strings.TrimSpace(logicalRequestID))})
}

func (c *threadForkFloretCoordinator) setTitle(ctx context.Context, logicalRequestID string, threadID string, title string) (flruntime.ThreadSnapshot, error) {
	if c == nil || c.authority == nil {
		return flruntime.ThreadSnapshot{}, errors.New("Floret fork coordinator authority is unavailable")
	}
	result, err := c.authority.SetForkedThreadTitle(ctxOrBackground(ctx), identity.ThreadID(strings.TrimSpace(threadID)), flruntime.SetThreadTitleCommand{LogicalRequestID: identity.LogicalRequestID(strings.TrimSpace(logicalRequestID)), Title: title})
	return result.Thread, err
}

func (s *Service) forkFloretThread(ctx context.Context, logicalRequestID string, sourceThreadID string) (flruntime.ForkThreadResultV3, error) {
	if s == nil || s.threadForkFloret == nil {
		return flruntime.ForkThreadResultV3{}, errors.New("nil service")
	}
	return s.threadForkFloret.fork(ctx, logicalRequestID, sourceThreadID)
}

func (s *Service) resumeThreadForkOperation(ctx context.Context, db *threadstore.Store, operation *threadstore.ForkOperation) (*threadstore.ThreadSettings, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	if operation == nil {
		return nil, errors.New("nil thread fork operation")
	}
	ctx = ctxOrBackground(ctx)

	for {
		switch operation.Stage {
		case threadstore.ForkStagePrepared:
			floretResult, err := s.forkFloretThread(ctx, operation.LogicalRequestID, operation.SourceThreadID)
			if err != nil {
				code, terminal := classifyFloretForkOperationError(err)
				return nil, s.recordThreadForkOperationError(ctx, db, operation.OperationID, code, err, terminal)
			}
			operation, err = db.BindForkCanonicalDestination(ctx, operation.OperationID, string(floretResult.ThreadID))
			if err != nil {
				return nil, s.recordThreadForkOperationError(ctx, db, operation.OperationID, "redeven_bind_failed", err, true)
			}

		case threadstore.ForkStageFloretForked:
			if _, err := db.MaterializeForkProduct(ctx, operation.OperationID, time.Now().UnixMilli()); err != nil {
				terminal := errors.Is(err, threadstore.ErrForkDestinationConflict) || errors.Is(err, threadstore.ErrForkOperationConflict) || errors.Is(err, threadstore.ErrForkResultConflict)
				return nil, s.recordThreadForkOperationError(ctx, db, operation.OperationID, "redeven_materialize_failed", err, terminal)
			}
			var err error
			operation, err = db.GetForkOperation(ctx, operation.OperationID)
			if err != nil {
				return nil, err
			}

		case threadstore.ForkStageProductMaterialized:
			title := strings.TrimSpace(operation.RequestedTitle)
			if title == "" {
				return nil, errors.New("thread fork title stage is missing its title")
			}
			set, err := s.threadForkFloret.setTitle(ctx, operation.TitleLogicalRequestID, operation.DestinationThreadID, title)
			if err != nil {
				return nil, s.recordThreadForkOperationError(ctx, db, operation.OperationID, "floret_title_failed", err, false)
			}
			if strings.TrimSpace(string(set.ID)) != operation.DestinationThreadID || strings.TrimSpace(set.Title) != title {
				err := errors.New("Floret title result identity/title mismatch")
				return nil, s.recordThreadForkOperationError(ctx, db, operation.OperationID, "floret_contract_mismatch", err, true)
			}
			operation, err = db.ConfirmForkTitleApplied(ctx, operation.OperationID, time.Now().UnixMilli())
			if err != nil {
				return nil, err
			}

		case threadstore.ForkStageTitleApplied, threadstore.ForkStageTitleSkipped:
			var err error
			operation, err = db.CompleteForkOperation(ctx, operation.OperationID, time.Now().UnixMilli())
			if err != nil {
				return nil, err
			}

		case threadstore.ForkStageCompleted:
			forked, err := db.GetThreadSettings(ctx, operation.EndpointID, operation.DestinationThreadID)
			if err != nil {
				return nil, err
			}
			if forked == nil {
				return nil, threadstore.ErrForkDestinationConflict
			}
			s.publishCommittedThreadForkOperation(db, operation)
			return forked, nil

		case threadstore.ForkStageFailed:
			return nil, fmt.Errorf("thread fork operation failed: %s", strings.TrimSpace(operation.ErrorMessage))

		default:
			return nil, fmt.Errorf("unsupported thread fork operation stage %q", operation.Stage)
		}
	}
}

func classifyFloretForkOperationError(err error) (string, bool) {
	switch {
	case errors.Is(err, flruntime.ErrForkOperationConflict):
		return "floret_operation_conflict", true
	case errors.Is(err, flruntime.ErrForkDestinationConflict):
		return "floret_destination_conflict", true
	case errors.Is(err, flruntime.ErrThreadNotFound):
		return "floret_source_missing", true
	default:
		return "floret_fork_failed", false
	}
}

func (s *Service) recordThreadForkOperationError(ctx context.Context, db *threadstore.Store, operationID string, code string, operationErr error, terminal bool) error {
	if operationErr == nil {
		return nil
	}
	recordErr := db.RecordForkOperationFailure(ctx, operationID, code, sanitizeLogText(operationErr.Error(), 480), terminal, time.Now().UnixMilli())
	if recordErr != nil {
		return errors.Join(operationErr, recordErr)
	}
	return operationErr
}

func (s *Service) publishCommittedThreadForkOperation(db *threadstore.Store, operation *threadstore.ForkOperation) {
	if s == nil || db == nil || operation == nil || operation.Stage != threadstore.ForkStageCompleted {
		return
	}
	s.threadForkBroadcastMu.Lock()
	defer s.threadForkBroadcastMu.Unlock()
	loadCtx, loadCancel := context.WithTimeout(context.Background(), s.persistTimeout())
	current, err := db.GetForkOperation(loadCtx, operation.OperationID)
	loadCancel()
	if err != nil || current == nil || current.Stage != threadstore.ForkStageCompleted {
		if err != nil && s.log != nil {
			s.log.Warn("ai: load thread fork broadcast state failed", "operation_id", operation.OperationID, "error", err)
		}
		return
	}
	publish := func(source bool, endpointID string, threadID string, acknowledgedAt int64) {
		if acknowledgedAt != 0 || strings.TrimSpace(endpointID) == "" || strings.TrimSpace(threadID) == "" {
			return
		}
		if err := s.broadcastThreadSummaryChecked(endpointID, threadID); err != nil {
			if s.log != nil {
				s.log.Warn("ai: thread fork broadcast failed", "operation_id", current.OperationID, "thread_id", threadID, "error", err)
			}
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), s.persistTimeout())
		defer cancel()
		if err := db.MarkForkOperationBroadcasted(ctx, current.OperationID, source, time.Now().UnixMilli()); err != nil && s.log != nil {
			s.log.Warn("ai: mark thread fork broadcast failed", "operation_id", current.OperationID, "thread_id", threadID, "error", err)
		}
	}
	publish(true, current.EndpointID, current.SourceThreadID, current.SourceBroadcastedAtUnixMs)
	publish(false, current.EndpointID, current.DestinationThreadID, current.DestinationBroadcastedAtUnixMs)
}

func (s *Service) replayPendingThreadForkOperations(ctx context.Context) (int, error) {
	if s == nil {
		return 0, errors.New("thread fork recovery coordinator is unavailable")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return 0, errors.New("thread fork recovery store is unavailable")
	}
	operations, err := db.ListPendingForkOperations(ctxOrBackground(ctx), threadForkReplayBatchSize)
	if err != nil {
		return 0, err
	}
	completed := 0
	var errs []error
	for i := range operations {
		operation := operations[i]
		if _, err := s.resumeThreadForkOperation(ctx, db, &operation); err != nil {
			errs = append(errs, fmt.Errorf("operation %s: %w", operation.OperationID, err))
			continue
		}
		completed++
	}
	return completed, errors.Join(errs...)
}

func (s *Service) publishUnbroadcastThreadForkOperations(ctx context.Context) (int, error) {
	if s == nil {
		return 0, nil
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return 0, nil
	}
	operations, err := db.ListUnbroadcastCommittedForkOperations(ctx, threadForkReplayBatchSize)
	if err != nil {
		return 0, err
	}
	for i := range operations {
		s.publishCommittedThreadForkOperation(db, &operations[i])
	}
	return len(operations), nil
}
