package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v4/identity"
)

// broadcastThreadSummary publishes one product summary derived from the
// canonical Floret current view. It deliberately does not maintain a second
// lifecycle projection or wait for provider work.
func (s *Service) broadcastThreadSummary(endpointID, threadID string) error {
	if s == nil || s.threadRuntime == nil || s.threadsDB == nil {
		return errors.New("thread summary runtime is unavailable")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("thread summary identity is incomplete")
	}
	settings, err := s.threadsDB.GetThreadSettings(context.Background(), endpointID, threadID)
	if err != nil {
		return err
	}
	if settings == nil {
		return nil
	}
	current, err := s.threadRuntime.View(context.Background(), identity.ThreadID(threadID))
	if err != nil {
		return err
	}
	summary, err := threadSummaryFromRuntime(context.Background(), s.threadRuntime, identity.ThreadID(threadID))
	if err != nil {
		return err
	}
	s.publishFlowerLiveSummary(endpointID, threadViewFromRuntimeCurrent(*settings, current, summary))
	return nil
}
