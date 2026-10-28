package ai

import (
	"context"
	"errors"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
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
	for _, settings := range page {
		_, err := reader.Summary(ctx, identity.ThreadID(settings.ThreadID))
		if !errors.Is(err, flruntime.ErrThreadDeleted) {
			continue
		}
		if err := s.deleteTaskFiles(ctx, settings.EndpointID, settings.ThreadID); err != nil {
			return err
		}
		if err := s.threadsDB.DeleteThreadProductData(ctx, settings.EndpointID, settings.ThreadID); err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	s.deletedFilesCursor = next
	s.mu.Unlock()
	return nil
}
