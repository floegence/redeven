package ai

import (
	"context"
	"strings"
	"sync"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/runtimeservice"
)

type WorkloadAdmission func(runtimeservice.ManagedWorkload) (func(), error)

type aiWorkloadLease struct {
	endpointID string
	threadID   string
	accepted   bool
	once       sync.Once
	release    func()
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
	s.workloadLeases[key] = &aiWorkloadLease{
		endpointID: strings.TrimSpace(endpointID),
		threadID:   strings.TrimSpace(threadID),
		release:    release,
	}
	return key, true, nil
}

// Mark acceptance before sampling current facts: terminal publication may race
// the receipt. The existing facts subscriber owns later lease settlement.
func (s *Service) acceptAIUserTurnReceipt(ctx context.Context, key, threadID string) {
	if s == nil || key == "" {
		return
	}
	s.workloadMu.Lock()
	lease := s.workloadLeases[key]
	if lease != nil {
		lease.threadID, lease.accepted = strings.TrimSpace(threadID), true
	}
	s.workloadMu.Unlock()
	if lease == nil {
		return
	}
	if summary, err := threadSummaryFromRuntime(context.WithoutCancel(ctx), s.threadRuntime, identity.ThreadID(threadID)); err == nil {
		s.reconcileAIWorkloadLeases(threadID, summary.Activity, summary.QueueCount)
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

func (s *Service) reconcileAIWorkloadLeases(threadID string, activity flruntime.ThreadActivity, queueCount int) {
	if s == nil || strings.TrimSpace(threadID) == "" || activity == flruntime.ThreadActivityActive || queueCount > 0 {
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
