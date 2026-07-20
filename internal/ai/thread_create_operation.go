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

type threadCreateFloretCoordinator struct {
	authority floretThreadCreateAuthority
}

func (c *threadCreateFloretCoordinator) create(ctx context.Context, threadID string, operationID string) (flruntime.ThreadSummary, error) {
	if c == nil || c.authority == nil {
		return flruntime.ThreadSummary{}, errors.New("Floret create coordinator authority is unavailable")
	}
	return c.authority.CreateThread(ctxOrBackground(ctx), flruntime.ThreadID(strings.TrimSpace(threadID)), flruntime.CreateIntentID(strings.TrimSpace(operationID)))
}

func (c *threadCreateFloretCoordinator) setTitle(ctx context.Context, threadID string, title string) (flruntime.ThreadSnapshot, error) {
	if c == nil || c.authority == nil {
		return flruntime.ThreadSnapshot{}, errors.New("Floret create coordinator authority is unavailable")
	}
	return c.authority.SetCreatedThreadTitle(ctxOrBackground(ctx), flruntime.ThreadID(strings.TrimSpace(threadID)), title)
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
	if operation.Status == threadstore.ThreadCreateOperationCommitted {
		settings, err := db.GetThreadSettings(ctxOrBackground(ctx), operation.EndpointID, operation.ThreadID)
		if err != nil || settings == nil {
			return threadstore.ThreadSettings{}, errors.New("committed thread create operation is missing settings")
		}
		return *settings, nil
	}
	if operation.Status != threadstore.ThreadCreateOperationPending {
		return threadstore.ThreadSettings{}, fmt.Errorf("unsupported thread create operation status %q", operation.Status)
	}
	if s.threadCreateFloret == nil {
		return threadstore.ThreadSettings{}, errors.New("Floret create coordinator authority is unavailable")
	}
	created, err := s.threadCreateFloret.create(ctx, operation.ThreadID, operation.OperationID)
	if err != nil {
		_ = db.RecordThreadCreateRetry(ctx, operation.OperationID, "floret_host_open_failed", err.Error())
		return threadstore.ThreadSettings{}, err
	}
	if strings.TrimSpace(string(created.ID)) != strings.TrimSpace(operation.ThreadID) {
		return threadstore.ThreadSettings{}, fmt.Errorf("Floret create result identity mismatch: got %q, want %q", created.ID, operation.ThreadID)
	}
	if operation.FloretCreatedAtMS <= 0 {
		operation, err = db.ConfirmThreadCreateFloretCreated(ctx, operation.OperationID)
		if err != nil {
			return threadstore.ThreadSettings{}, err
		}
	}
	if title := strings.TrimSpace(operation.ExplicitTitle); title != "" {
		set, err := s.threadCreateFloret.setTitle(ctx, operation.ThreadID, title)
		if err != nil {
			_ = db.RecordThreadCreateRetry(ctx, operation.OperationID, "floret_title_failed", err.Error())
			return threadstore.ThreadSettings{}, err
		}
		if strings.TrimSpace(string(set.ID)) != strings.TrimSpace(operation.ThreadID) || strings.TrimSpace(set.Title) != title {
			return threadstore.ThreadSettings{}, fmt.Errorf("Floret title result identity/title mismatch for thread %q", operation.ThreadID)
		}
		if operation.TitleSetAtMS <= 0 {
			operation, err = db.ConfirmThreadCreateTitleSet(ctx, operation.OperationID)
			if err != nil {
				return threadstore.ThreadSettings{}, err
			}
		}
	}
	return db.CommitThreadCreateSettings(ctx, operation.OperationID)
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
