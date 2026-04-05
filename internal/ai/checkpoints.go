package ai

import (
	"context"
	"strings"
	"time"
)

const (
	legacyWorkspaceCheckpointSweepTimeout = 30 * time.Second
)

func (s *Service) cleanupLegacyWorkspaceCheckpointArtifacts(checkpointIDs []string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	stateDir := strings.TrimSpace(s.stateDir)
	s.mu.Unlock()
	if stateDir == "" || len(checkpointIDs) == 0 {
		return
	}
	for _, checkpointID := range checkpointIDs {
		checkpointID = strings.TrimSpace(checkpointID)
		if checkpointID == "" {
			continue
		}
		if err := removeWorkspaceCheckpointArtifacts(stateDir, checkpointID); err != nil {
			s.logLegacyWorkspaceCheckpointWarning("failed to remove legacy workspace checkpoint artifacts", "checkpoint_id", checkpointID, "error", err)
		}
	}
}

func (s *Service) scheduleLegacyWorkspaceCheckpointSweep() {
	if s == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), legacyWorkspaceCheckpointSweepTimeout)
		defer cancel()
		if err := s.sweepOrphanWorkspaceCheckpointArtifacts(ctx); err != nil {
			s.logLegacyWorkspaceCheckpointWarning("failed to sweep orphan legacy workspace checkpoints", "error", err)
		}
	}()
}

func (s *Service) sweepOrphanWorkspaceCheckpointArtifacts(ctx context.Context) error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	db := s.threadsDB
	stateDir := strings.TrimSpace(s.stateDir)
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil || stateDir == "" {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	artifactIDs, err := listWorkspaceCheckpointArtifactIDs(stateDir)
	if err != nil || len(artifactIDs) == 0 {
		return err
	}

	lctx, cancel := context.WithTimeout(ctx, persistTO)
	validIDs, err := db.ListCheckpointIDs(lctx)
	cancel()
	if err != nil {
		return err
	}

	keep := make(map[string]struct{}, len(validIDs))
	for _, checkpointID := range validIDs {
		checkpointID = strings.TrimSpace(checkpointID)
		if checkpointID == "" {
			continue
		}
		keep[checkpointID] = struct{}{}
	}
	for _, checkpointID := range artifactIDs {
		if _, ok := keep[checkpointID]; ok {
			continue
		}
		if err := removeWorkspaceCheckpointArtifacts(stateDir, checkpointID); err != nil {
			s.logLegacyWorkspaceCheckpointWarning("failed to remove orphan legacy workspace checkpoint artifacts", "checkpoint_id", checkpointID, "error", err)
		}
	}
	return nil
}

func (s *Service) logLegacyWorkspaceCheckpointWarning(msg string, args ...any) {
	if s == nil || s.log == nil {
		return
	}
	s.log.Warn(msg, args...)
}
