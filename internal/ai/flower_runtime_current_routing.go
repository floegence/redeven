package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/v7/runtime"
)

var errFlowerRuntimeEndpointConflict = errors.New("flower runtime endpoint routing conflict")

func flowerSubagentFactsBoundary(turnID string, facts flruntime.ThreadRuntimeFacts) string {
	lastOutcome := ""
	if facts.LastOutcome != nil {
		lastOutcome = string(*facts.LastOutcome)
	}
	return strings.Join([]string{turnID, string(facts.Activity), lastOutcome, fmt.Sprintf("approval:%d", facts.Attention.ApprovalCount), fmt.Sprintf("input:%d", facts.Attention.InputCount), fmt.Sprintf("queue:%d", facts.QueueCount)}, "\x1f")
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
		return errors.New("flower runtime endpoint routing identity is incomplete")
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
		return "", "", errors.New("flower runtime thread identity is incomplete")
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
		return "", "", errors.New("flower runtime thread has no endpoint owner")
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
	s.mu.Unlock()
}
