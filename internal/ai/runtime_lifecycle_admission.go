package ai

import (
	"strings"
	"sync"

	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/runtimeservice"
)

type WorkloadAdmission func(runtimeservice.ManagedWorkload) (func(), error)

type aiWorkloadLease struct {
	threadID string
	accepted bool
	once     sync.Once
	release  func()
}

func (lease *aiWorkloadLease) Release() {
	if lease == nil {
		return
	}
	lease.once.Do(func() {
		if lease.release != nil {
			lease.release()
		}
	})
}

func (s *Service) SetWorkloadAdmission(admit WorkloadAdmission) {
	if s == nil {
		return
	}
	s.workloadMu.Lock()
	s.workloadAdmission = admit
	s.workloadMu.Unlock()
	s.mu.Lock()
	terminalProcesses := s.terminalProcesses
	s.mu.Unlock()
	terminalProcesses.SetWorkloadAdmission(admit)
}

func aiTurnWorkloadKey(endpointID, threadID, requestID string) string {
	return strings.TrimSpace(endpointID) + "\x00" + strings.TrimSpace(threadID) + "\x00" + strings.TrimSpace(requestID)
}

func aiTurnWorkloadIdentity(endpointID, threadID, requestID string) string {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		threadID = "pending"
	}
	return "ai_turn:" + strings.TrimSpace(endpointID) + ":" + threadID + ":" + strings.TrimSpace(requestID)
}

func (s *Service) admitAIUserTurn(endpointID, threadID, requestID string) (string, bool, error) {
	if s == nil {
		return "", false, nil
	}
	key := aiTurnWorkloadKey(endpointID, threadID, requestID)
	if strings.TrimSpace(endpointID) == "" || strings.TrimSpace(requestID) == "" {
		return "", false, nil
	}
	s.workloadMu.Lock()
	defer s.workloadMu.Unlock()
	if _, exists := s.workloadLeases[key]; exists {
		return key, false, nil
	}
	if s.workloadAdmission == nil {
		return "", false, nil
	}
	release, err := s.workloadAdmission(runtimeservice.ManagedWorkload{
		Identity: aiTurnWorkloadIdentity(endpointID, threadID, requestID), Kind: "ai_turn", Protected: true,
	})
	if err != nil {
		return "", false, err
	}
	s.workloadLeases[key] = &aiWorkloadLease{threadID: strings.TrimSpace(threadID), release: release}
	return key, true, nil
}

func (s *Service) acceptAIUserTurnLease(key, threadID string, current flruntime.ThreadView) {
	if s == nil || key == "" {
		return
	}
	s.workloadMu.Lock()
	lease := s.workloadLeases[key]
	if lease != nil {
		lease.threadID = strings.TrimSpace(threadID)
		lease.accepted = true
	}
	s.workloadMu.Unlock()
	if current.Activity != flruntime.ThreadActivityActive && len(current.Queue) == 0 {
		s.reconcileAIWorkloadLeases(strings.TrimSpace(threadID), current)
	}
}

func (s *Service) rejectAIUserTurnLease(key string, newlyAdmitted bool) {
	if s == nil || key == "" || !newlyAdmitted {
		return
	}
	s.workloadMu.Lock()
	lease := s.workloadLeases[key]
	delete(s.workloadLeases, key)
	s.workloadMu.Unlock()
	lease.Release()
}

func (s *Service) reconcileAIWorkloadLeases(threadID string, current flruntime.ThreadView) {
	if s == nil || strings.TrimSpace(threadID) == "" || current.Activity == flruntime.ThreadActivityActive || len(current.Queue) > 0 {
		return
	}
	var releases []*aiWorkloadLease
	s.workloadMu.Lock()
	for key, lease := range s.workloadLeases {
		if lease != nil && lease.accepted && lease.threadID == strings.TrimSpace(threadID) {
			releases = append(releases, lease)
			delete(s.workloadLeases, key)
		}
	}
	s.workloadMu.Unlock()
	for _, lease := range releases {
		lease.Release()
	}
}

func (s *Service) releaseAllAIWorkloadLeases() {
	if s == nil {
		return
	}
	s.workloadMu.Lock()
	releases := make([]*aiWorkloadLease, 0, len(s.workloadLeases))
	for key, lease := range s.workloadLeases {
		releases = append(releases, lease)
		delete(s.workloadLeases, key)
	}
	s.workloadMu.Unlock()
	for _, lease := range releases {
		lease.Release()
	}
}
