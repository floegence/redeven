package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/redeven/internal/logsafe"
)

// publishCanonicalThreadSummary publishes one product summary derived from the
// canonical Floret current view. It deliberately does not maintain a second
// lifecycle projection or wait for provider work.
func (s *Service) publishCanonicalThreadSummary(ctx context.Context, endpointID, threadID string) error {
	if s == nil || s.threadRuntime == nil || s.threadsDB == nil {
		return errors.New("thread summary runtime is unavailable")
	}
	ctx = ctxOrBackground(ctx)
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("thread summary identity is incomplete")
	}
	settings, err := s.threadsDB.GetThreadSettings(ctx, endpointID, threadID)
	if err != nil {
		return err
	}
	if settings == nil {
		return nil
	}
	if parentThreadID := strings.TrimSpace(settings.ParentThreadID); parentThreadID != "" {
		items, listErr := s.listFlowerSubagentsForParent(ctx, identity.ThreadID(parentThreadID))
		if listErr != nil {
			return listErr
		}
		s.broadcastFlowerSubagentsPatch(endpointID, parentThreadID, items)
		return nil
	}
	current, err := s.threadRuntime.View(ctx, identity.ThreadID(threadID))
	if err != nil {
		return err
	}
	summary, err := threadSummaryFromRuntime(ctx, s.threadRuntime, identity.ThreadID(threadID))
	if err != nil {
		return err
	}
	view, err := s.threadViewFromRuntimeCurrent(ctx, settings, current, &summary)
	if err != nil {
		return err
	}
	s.publishFlowerLiveSummary(endpointID, view)
	return nil
}

func (s *Service) requestCanonicalThreadSummary(endpointID, threadID string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	publisher := s.flowerThreadSummaryPublisher
	s.mu.Unlock()
	if publisher == nil {
		s.handleCanonicalThreadSummaryFailure(endpointID, threadID, errors.New("thread summary publisher is unavailable"))
		return
	}
	publisher.Request(endpointID, threadID)
}

func (s *Service) handleCanonicalThreadSummaryFailure(endpointID, threadID string, err error) {
	if s == nil || err == nil {
		return
	}
	if s.log != nil {
		s.log.Warn(
			"ai: publish canonical Flower thread summary",
			"endpoint_id", logsafe.Text(endpointID, 256),
			"thread_id", logsafe.Text(threadID, 256),
			"error", err,
		)
	}
	s.fenceFlowerLiveEndpoint(endpointID)
}
