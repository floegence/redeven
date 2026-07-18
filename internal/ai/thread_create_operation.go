package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

const threadCreateReplayBatchSize = 50

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
	if operation.Status == threadstore.ThreadCreateOperationCommitted {
		settings, err := db.GetThread(ctxOrBackground(ctx), operation.EndpointID, operation.ThreadID)
		if err != nil || settings == nil {
			return threadstore.ThreadSettings{}, errors.New("committed thread create operation is missing settings")
		}
		return *settings, nil
	}
	if operation.Status != threadstore.ThreadCreateOperationPending {
		return threadstore.ThreadSettings{}, fmt.Errorf("unsupported thread create operation status %q", operation.Status)
	}
	host, err := s.openFloretMaintenanceHost()
	if err != nil {
		_ = db.RecordThreadCreateRetry(ctx, operation.OperationID, "floret_host_open_failed", err.Error())
		return threadstore.ThreadSettings{}, err
	}
	if operation.FloretEnsuredAtMS <= 0 {
		if _, err := host.EnsureThread(ctxOrBackground(ctx), flruntime.EnsureThreadRequest{ThreadID: flruntime.ThreadID(operation.ThreadID)}); err != nil {
			_ = db.RecordThreadCreateRetry(ctx, operation.OperationID, "floret_ensure_failed", err.Error())
			return threadstore.ThreadSettings{}, err
		}
		operation, err = db.ConfirmThreadCreateFloretEnsured(ctx, operation.OperationID)
		if err != nil {
			return threadstore.ThreadSettings{}, err
		}
	}
	if title := strings.TrimSpace(operation.ExplicitTitle); title != "" && operation.TitleSetAtMS <= 0 {
		if _, err := host.SetThreadTitle(ctxOrBackground(ctx), flruntime.SetThreadTitleRequest{ThreadID: flruntime.ThreadID(operation.ThreadID), Title: title}); err != nil {
			_ = db.RecordThreadCreateRetry(ctx, operation.OperationID, "floret_title_failed", err.Error())
			return threadstore.ThreadSettings{}, err
		}
		operation, err = db.ConfirmThreadCreateTitleSet(ctx, operation.OperationID)
		if err != nil {
			return threadstore.ThreadSettings{}, err
		}
	}
	return db.CommitThreadCreateSettings(ctx, operation.OperationID)
}

func (s *Service) replayPendingThreadCreateOperations(ctx context.Context) (int, error) {
	if s == nil {
		return 0, nil
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return 0, nil
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
