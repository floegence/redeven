package ai

import (
	"errors"
	"strings"

	"github.com/floegence/redeven/internal/session"
)

func (s *Service) GetActiveRunSnapshot(meta *session.Meta, threadID string) (string, string, error) {
	if s == nil {
		return "", "", errors.New("service not ready")
	}
	if meta == nil || !meta.CanRead {
		return "", "", errors.New("read permission denied")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return "", "", errors.New("invalid request")
	}

	s.mu.Lock()
	runID := strings.TrimSpace(s.activeRunByTh[runThreadKey(endpointID, threadID)])
	r := s.runs[runID]
	s.mu.Unlock()
	if runID == "" || r == nil {
		return "", "", nil
	}
	if r.assistantAlreadyPersisted() {
		return "", "", nil
	}

	msgJSON, _, _, err := r.snapshotAssistantMessageJSONWithStatus("streaming")
	if err == nil && strings.TrimSpace(msgJSON) != "" {
		return runID, msgJSON, nil
	}

	// Best-effort: callers can fall back to realtime events or the persisted transcript if the
	// in-memory snapshot is temporarily unavailable.
	return "", "", nil
}
