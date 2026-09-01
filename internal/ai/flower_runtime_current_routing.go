package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/v7/runtime"
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
			s.broadcastFlowerRuntimeProjection,
		)
		s.flowerRuntimeCurrentPublisher.metrics = &s.flowerLiveMetrics
	}
	return s.flowerRuntimeCurrentPublisher
}

func (s *Service) broadcastFlowerRuntimeProjection(endpointID string, current flruntime.ThreadView) {
	if s == nil {
		return
	}
	threadID := strings.TrimSpace(current.ThreadID.String())
	s.mu.Lock()
	parentThreadID := strings.TrimSpace(s.flowerRuntimeParentByThread[threadID])
	s.mu.Unlock()
	if parentThreadID == "" {
		s.broadcastFlowerRuntimeCurrent(endpointID, current)
		return
	}
	boundary := flowerSubagentInventoryBoundary(current)
	s.mu.Lock()
	if s.flowerSubagentBoundaryByThread == nil {
		s.flowerSubagentBoundaryByThread = make(map[string]string)
	}
	if s.flowerSubagentBoundaryByThread[threadID] == boundary {
		s.mu.Unlock()
		return
	}
	s.flowerSubagentBoundaryByThread[threadID] = boundary
	s.mu.Unlock()
	s.publishFlowerSubagentsPatch(context.Background(), endpointID, parentThreadID)
}

func flowerSubagentInventoryBoundary(current flruntime.ThreadView) string {
	lastOutcome := ""
	if current.LastOutcome != nil {
		lastOutcome = string(*current.LastOutcome)
	}
	return strings.Join([]string{
		strings.TrimSpace(current.TurnID.String()),
		string(current.Activity),
		lastOutcome,
		fmt.Sprintf("approval:%d", current.Attention.ApprovalCount),
		fmt.Sprintf("input:%d", current.Attention.InputCount),
		fmt.Sprintf("queue:%d", len(current.Queue)),
	}, "\x1f")
}

func (s *Service) rememberFlowerRuntimeParent(threadID, parentThreadID string) {
	threadID = strings.TrimSpace(threadID)
	parentThreadID = strings.TrimSpace(parentThreadID)
	if s == nil || threadID == "" || parentThreadID == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.flowerRuntimeParentByThread == nil {
		s.flowerRuntimeParentByThread = make(map[string]string)
	}
	s.flowerRuntimeParentByThread[threadID] = parentThreadID
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

func (s *Service) resolveFlowerRuntimeRoute(ctx context.Context, threadID string) (string, string, error) {
	threadID = strings.TrimSpace(threadID)
	if s == nil || threadID == "" {
		return "", "", errors.New("Flower runtime thread identity is incomplete")
	}
	s.mu.Lock()
	endpointID := s.flowerRuntimeEndpointByThread[threadID]
	parentThreadID := s.flowerRuntimeParentByThread[threadID]
	routeKnown := s.flowerRuntimeRouteKnown[threadID]
	db := s.threadsDB
	s.mu.Unlock()
	if endpointID != "" && routeKnown {
		return endpointID, parentThreadID, nil
	}
	if db == nil {
		return "", "", errors.New("threads store not ready")
	}
	settings, err := db.GetThreadSettingsByCanonicalThreadID(ctxOrBackground(ctx), threadID)
	if err != nil || settings == nil {
		return "", "", err
	}
	endpointID = strings.TrimSpace(settings.EndpointID)
	if endpointID == "" {
		return "", "", errors.New("Flower runtime thread has no endpoint owner")
	}
	if err := s.rememberFlowerRuntimeEndpoint(threadID, endpointID); err != nil {
		return "", "", err
	}
	parentThreadID = strings.TrimSpace(settings.ParentThreadID)
	if parentThreadID != "" {
		s.rememberFlowerRuntimeParent(threadID, parentThreadID)
	}
	s.mu.Lock()
	if s.flowerRuntimeRouteKnown == nil {
		s.flowerRuntimeRouteKnown = make(map[string]bool)
	}
	s.flowerRuntimeRouteKnown[threadID] = true
	s.mu.Unlock()
	return endpointID, parentThreadID, nil
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
	delete(s.flowerRuntimeParentByThread, threadID)
	delete(s.flowerRuntimeRouteKnown, threadID)
	delete(s.flowerSubagentBoundaryByThread, threadID)
	publisher := s.flowerRuntimeCurrentPublisher
	s.mu.Unlock()
	if publisher != nil {
		publisher.Forget(threadID)
	}
}
