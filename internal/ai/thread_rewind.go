package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/session"
)

var ErrNoCheckpoint = errors.New("no checkpoint available")

type RewindThreadRequest struct {
	ThreadID string `json:"thread_id"`
}

type RewindThreadResponse struct {
	OK           bool   `json:"ok"`
	CheckpointID string `json:"checkpoint_id,omitempty"`
}

func (s *Service) RewindThread(ctx context.Context, meta *session.Meta, threadID string) (RewindThreadResponse, error) {
	if s == nil {
		return RewindThreadResponse{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return RewindThreadResponse{}, err
	}
	threadID = strings.TrimSpace(threadID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" || threadID == "" {
		return RewindThreadResponse{}, errors.New("invalid request")
	}
	if s.threadMgr == nil {
		return RewindThreadResponse{}, errors.New("thread manager not ready")
	}
	actor := s.threadMgr.Get(endpointID, threadID)
	if actor == nil {
		return RewindThreadResponse{}, errors.New("thread actor not ready")
	}
	return actor.RewindThread(ctx, meta, RewindThreadRequest{ThreadID: threadID})
}

func (s *Service) rewindThreadCheckpoint(ctx context.Context, meta *session.Meta, endpointID string, threadID string, checkpointID string, resetReason string) (string, error) {
	if s == nil {
		return "", errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return "", err
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	checkpointID = strings.TrimSpace(checkpointID)
	resetReason = strings.TrimSpace(resetReason)
	if resetReason == "" {
		resetReason = "rewind"
	}
	if endpointID == "" || threadID == "" {
		return "", errors.New("invalid request")
	}

	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	stateDir := strings.TrimSpace(s.stateDir)
	s.mu.Unlock()
	if db == nil {
		return "", errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	var cp *threadstore.ThreadCheckpointRecord
	var err error
	getCtx, cancel := context.WithTimeout(ctx, persistTO)
	if checkpointID != "" {
		cp, err = db.GetThreadCheckpoint(getCtx, endpointID, threadID, checkpointID)
	} else {
		cp, err = db.GetLatestThreadCheckpoint(getCtx, endpointID, threadID)
	}
	cancel()
	if err != nil {
		return "", err
	}
	if cp == nil || strings.TrimSpace(cp.CheckpointID) == "" {
		return "", ErrNoCheckpoint
	}
	checkpointID = strings.TrimSpace(cp.CheckpointID)

	workspaceJSON := strings.TrimSpace(cp.WorkspaceJSON)
	if workspaceJSON != "" {
		var ws workspaceCheckpointMeta
		if err := json.Unmarshal([]byte(workspaceJSON), &ws); err != nil {
			return "", err
		}
		// Restore workspace first so DB rewind can be retried if files fail to restore.
		restoreTO := 2 * time.Minute
		if dl, ok := ctx.Deadline(); ok {
			remaining := time.Until(dl)
			if remaining > 0 {
				restoreTO = remaining
			}
		}
		wctx, wcancel := context.WithTimeout(ctx, restoreTO)
		err = restoreWorkspaceCheckpoint(wctx, stateDir, checkpointID, ws)
		wcancel()
		if err != nil {
			return "", err
		}
	}

	restoreCtx, cancel := context.WithTimeout(ctx, persistTO)
	_, err = db.RestoreThreadCheckpoint(restoreCtx, endpointID, threadID, checkpointID)
	cancel()
	if err != nil {
		return "", err
	}

	s.broadcastTranscriptReset(endpointID, threadID, checkpointID, resetReason)
	s.broadcastThreadSummary(endpointID, threadID)
	return checkpointID, nil
}
