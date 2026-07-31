package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

const threadCreateReplayBatchSize = 50

type threadCreateFloretCoordinator struct {
	authority floretThreadCreateAuthority
}

func (c *threadCreateFloretCoordinator) create(ctx context.Context, logicalRequestID string) (flruntime.CreateThreadResult, error) {
	if c == nil || c.authority == nil {
		return flruntime.CreateThreadResult{}, errors.New("Floret create coordinator authority is unavailable")
	}
	return c.authority.CreateThread(ctxOrBackground(ctx), identity.LogicalRequestID(strings.TrimSpace(logicalRequestID)))
}

func (c *threadCreateFloretCoordinator) setTitle(ctx context.Context, logicalRequestID string, threadID string, title string) (flruntime.ThreadSnapshot, error) {
	if c == nil || c.authority == nil {
		return flruntime.ThreadSnapshot{}, errors.New("Floret create coordinator authority is unavailable")
	}
	result, err := c.authority.SetCreatedThreadTitle(ctxOrBackground(ctx), identity.ThreadID(strings.TrimSpace(threadID)), flruntime.SetThreadTitleCommand{
		LogicalRequestID: identity.LogicalRequestID(strings.TrimSpace(logicalRequestID)),
		Title:            title,
	})
	return result.Thread, err
}

func (s *Service) resumeThreadCreateOperation(ctx context.Context, operation threadstore.ThreadCreateOperation) (threadstore.ThreadSettings, error) {
	if s == nil {
		return threadstore.ThreadSettings{}, errors.New("nil service")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return threadstore.ThreadSettings{}, errors.New("threads store not ready")
	}
	if s.threadCreateFloret == nil {
		return threadstore.ThreadSettings{}, errors.New("Floret create coordinator authority is unavailable")
	}
	ctx = ctxOrBackground(ctx)

	for {
		switch operation.Stage {
		case threadstore.ThreadCreateStagePrepared:
			created, err := s.threadCreateFloret.create(ctx, operation.LogicalRequestID)
			if err != nil {
				_ = db.RecordThreadCreateRetry(ctx, operation.OperationID, "floret_host_open_failed", err.Error())
				return threadstore.ThreadSettings{}, err
			}
			operation, err = db.BindThreadCreateCanonicalID(ctx, operation.OperationID, string(created.ThreadID))
			if err != nil {
				return threadstore.ThreadSettings{}, err
			}

		case threadstore.ThreadCreateStageFloretCreated:
			if _, err := db.MaterializeThreadCreateProduct(ctx, operation.OperationID); err != nil {
				_ = db.RecordThreadCreateRetry(ctx, operation.OperationID, "redeven_materialize_failed", err.Error())
				return threadstore.ThreadSettings{}, err
			}
			var err error
			operation, err = db.GetThreadCreateOperation(ctx, operation.OperationID)
			if err != nil {
				return threadstore.ThreadSettings{}, err
			}

		case threadstore.ThreadCreateStageProductMaterialized:
			title := strings.TrimSpace(operation.ExplicitTitle)
			if title == "" {
				return threadstore.ThreadSettings{}, errors.New("thread create title stage is missing its title")
			}
			set, err := s.threadCreateFloret.setTitle(ctx, operation.TitleLogicalRequestID, operation.CanonicalThreadID, title)
			if err != nil {
				_ = db.RecordThreadCreateRetry(ctx, operation.OperationID, "floret_title_failed", err.Error())
				return threadstore.ThreadSettings{}, err
			}
			if strings.TrimSpace(string(set.ID)) != operation.CanonicalThreadID || strings.TrimSpace(set.Title) != title {
				return threadstore.ThreadSettings{}, fmt.Errorf("Floret title result identity/title mismatch for thread %q", operation.CanonicalThreadID)
			}
			operation, err = db.ConfirmThreadCreateTitleSet(ctx, operation.OperationID)
			if err != nil {
				return threadstore.ThreadSettings{}, err
			}

		case threadstore.ThreadCreateStageTitleApplied, threadstore.ThreadCreateStageTitleSkipped:
			var err error
			operation, err = db.CompleteThreadCreateOperation(ctx, operation.OperationID)
			if err != nil {
				return threadstore.ThreadSettings{}, err
			}

		case threadstore.ThreadCreateStageCompleted:
			settings, err := db.GetThreadSettings(ctx, operation.EndpointID, operation.CanonicalThreadID)
			if err != nil {
				return threadstore.ThreadSettings{}, err
			}
			if settings == nil {
				return threadstore.ThreadSettings{}, errors.New("completed thread create operation is missing settings")
			}
			return *settings, nil

		case threadstore.ThreadCreateStageFailed:
			return threadstore.ThreadSettings{}, fmt.Errorf("thread create operation failed: %s", strings.TrimSpace(operation.ErrorMessage))

		default:
			return threadstore.ThreadSettings{}, fmt.Errorf("unsupported thread create operation stage %q", operation.Stage)
		}
	}
}

func (s *Service) replayPendingThreadCreateOperations(ctx context.Context) (int, error) {
	if s == nil {
		return 0, errors.New("thread create recovery coordinator is unavailable")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return 0, errors.New("thread create recovery store is unavailable")
	}
	operations, err := db.ListPendingThreadCreateOperations(ctxOrBackground(ctx), threadCreateReplayBatchSize)
	if err != nil {
		return 0, err
	}
	completed := 0
	var replayErr error
	for _, operation := range operations {
		if _, err := s.resumeThreadCreateOperation(ctx, operation); err != nil {
			replayErr = errors.Join(replayErr, fmt.Errorf("operation %s: %w", operation.OperationID, err))
			continue
		}
		completed++
	}
	return completed, replayErr
}
