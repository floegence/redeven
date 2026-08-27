package ai

import (
	"context"
	"errors"
	"strings"

	flruntime "github.com/floegence/floret/v5/runtime"
	"github.com/floegence/redeven/internal/logsafe"
)

var errFlowerRuntimeEndpointConflict = errors.New("Flower runtime endpoint routing conflict")

func (s *Service) publishFlowerRuntimeCurrent(endpointID string, current flruntime.ThreadView) {
	if s == nil {
		return
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID := strings.TrimSpace(current.ThreadID.String())
	if endpointID == "" || threadID == "" || current.ViewVersion == 0 {
		return
	}
	if err := s.rememberFlowerRuntimeEndpoint(threadID, endpointID); err != nil {
		if s.log != nil {
			s.log.Error("ai: reject conflicting Flower runtime view owner", "thread_id", logsafe.Text(threadID, 256), "error", err)
		}
		return
	}
	publisher := s.ensureFlowerRuntimeCurrentPublisher()
	publisher.Publish(endpointID, current)
}

func (s *Service) ensureFlowerRuntimeCurrentPublisher() *flowerRuntimeCurrentPublisher {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.flowerRuntimeCurrentPublisher == nil {
		s.flowerRuntimeCurrentPublisher = newFlowerRuntimeCurrentPublisher(
			flowerRuntimeCurrentPublishInterval,
			systemFlowerRuntimePublishClock{},
			s.broadcastFlowerRuntimeCurrent,
		)
		s.flowerRuntimeCurrentPublisher.metrics = &s.flowerLiveMetrics
	}
	return s.flowerRuntimeCurrentPublisher
}

func (s *Service) rememberFlowerRuntimeEndpoint(threadID string, endpointID string) error {
	threadID = strings.TrimSpace(threadID)
	endpointID = strings.TrimSpace(endpointID)
	if s == nil || threadID == "" || endpointID == "" {
		return errors.New("Flower runtime endpoint routing identity is incomplete")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.flowerRuntimeEndpointByThread == nil {
		s.flowerRuntimeEndpointByThread = make(map[string]string)
	}
	if existing := s.flowerRuntimeEndpointByThread[threadID]; existing != "" && existing != endpointID {
		return errFlowerRuntimeEndpointConflict
	}
	s.flowerRuntimeEndpointByThread[threadID] = endpointID
	return nil
}

func (s *Service) resolveFlowerRuntimeEndpoint(ctx context.Context, threadID string) (string, error) {
	threadID = strings.TrimSpace(threadID)
	if s == nil || threadID == "" {
		return "", errors.New("Flower runtime thread identity is incomplete")
	}
	s.mu.Lock()
	endpointID := s.flowerRuntimeEndpointByThread[threadID]
	db := s.threadsDB
	s.mu.Unlock()
	if endpointID != "" {
		return endpointID, nil
	}
	if db == nil {
		return "", errors.New("threads store not ready")
	}
	settings, err := db.GetThreadSettingsByCanonicalThreadID(ctxOrBackground(ctx), threadID)
	if err != nil || settings == nil {
		return "", err
	}
	endpointID = strings.TrimSpace(settings.EndpointID)
	if endpointID == "" {
		return "", errors.New("Flower runtime thread has no endpoint owner")
	}
	if err := s.rememberFlowerRuntimeEndpoint(threadID, endpointID); err != nil {
		return "", err
	}
	return endpointID, nil
}

func (s *Service) forgetFlowerRuntimeThread(threadID string) {
	if s == nil {
		return
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return
	}
	s.mu.Lock()
	delete(s.flowerRuntimeEndpointByThread, threadID)
	publisher := s.flowerRuntimeCurrentPublisher
	s.mu.Unlock()
	if publisher != nil {
		publisher.Forget(threadID)
	}
}
