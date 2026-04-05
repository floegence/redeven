package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
)

const (
	threadCheckpointRetentionCount        = 40
	legacyWorkspaceCheckpointSweepTimeout = 30 * time.Second
)

func checkpointIDForRun(runID string) string {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return ""
	}
	return "cp_" + runID
}

func (s *Service) createPreRunThreadCheckpoint(ctx context.Context, endpointID string, threadID string, runID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	runID = strings.TrimSpace(runID)
	if endpointID == "" || threadID == "" || runID == "" {
		return errors.New("invalid checkpoint scope")
	}

	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	checkpointID := checkpointIDForRun(runID)
	if checkpointID == "" {
		return errors.New("missing checkpoint id")
	}

	cctx, cancel := context.WithTimeout(ctx, persistTO)
	_, err := db.CreateThreadCheckpoint(cctx, endpointID, threadID, checkpointID, runID, threadstore.CheckpointKindPreRun)
	cancel()
	if err != nil {
		return err
	}

	pctx, pcancel := context.WithTimeout(context.Background(), persistTO)
	deletedIDs, pruneErr := db.PruneThreadCheckpoints(pctx, endpointID, threadID, threadCheckpointRetentionCount)
	pcancel()
	if pruneErr != nil {
		s.logLegacyWorkspaceCheckpointWarning("failed to prune old thread checkpoints", "endpoint_id", endpointID, "thread_id", threadID, "error", pruneErr)
	}
	s.cleanupLegacyWorkspaceCheckpointArtifacts(deletedIDs)
	return nil
}

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
