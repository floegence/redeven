package ai

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

// Only a canonical deletion tombstone permits recovery. Missing or unavailable
// history is not evidence that user resources can be removed. Product settings
// remain the durable retry anchor until all local cleanup succeeds.
func (s *Service) sweepDeletedThreadFiles(ctx context.Context) error {
	reader, ok := s.threadRuntime.(flruntime.ThreadSummaryReader)
	if !ok || s.threadsDB == nil {
		return nil
	}
	s.mu.Lock()
	cursor := s.deletedFilesCursor
	s.mu.Unlock()
	page, next, _, err := s.threadsDB.ListThreadSettingsForRecoveryPage(ctx, cursor, 50)
	if err != nil {
		return err
	}
	var failures []error
	for _, settings := range page {
		if err := ctx.Err(); err != nil {
			return errors.Join(append(failures, err)...)
		}
		itemCtx, cancel := context.WithTimeout(ctx, time.Second)
		_, err := reader.Summary(itemCtx, identity.ThreadID(settings.ThreadID))
		if errors.Is(err, flruntime.ErrThreadDeleted) {
			err = s.deleteThreadFilesAndProductData(itemCtx, settings.EndpointID, settings.ThreadID)
			if err != nil {
				failures = append(failures, fmt.Errorf("clean deleted thread %s: %w", settings.ThreadID, err))
			}
		}
		cancel()
		s.mu.Lock()
		s.deletedFilesCursor = threadstore.ThreadSettingsRecoveryCursor{EndpointID: settings.EndpointID, ThreadID: settings.ThreadID}
		s.mu.Unlock()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	s.deletedFilesCursor = next
	s.mu.Unlock()
	return errors.Join(failures...)
}

// Product ownership remains the retry anchor until its disposable files are gone.
func (s *Service) deleteThreadFilesAndProductData(ctx context.Context, endpoint, thread string) error {
	if err := s.deleteTaskFiles(ctx, endpoint, thread); err != nil {
		return err
	}
	return s.threadsDB.DeleteThreadProductData(ctx, endpoint, thread)
}
