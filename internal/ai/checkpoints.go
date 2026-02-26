package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
)

func checkpointIDForRun(runID string) string {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return ""
	}
	return "cp_" + runID
}

func (r *run) ensureWorkspaceCheckpoint(ctx context.Context) (workspaceCheckpointMeta, error) {
	meta := workspaceCheckpointMeta{}
	if r == nil {
		return meta, errors.New("nil run")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	r.muCheckpoint.Lock()
	defer r.muCheckpoint.Unlock()

	if r.workspaceCheckpointCreated {
		return meta, nil
	}

	checkpointID := checkpointIDForRun(r.id)
	if strings.TrimSpace(checkpointID) == "" {
		return meta, errors.New("missing checkpoint id")
	}

	stateDir := strings.TrimSpace(r.stateDir)
	if stateDir == "" {
		// Best-effort: allow tool execution in unit tests and other non-persistent runs.
		r.workspaceCheckpointCreated = true
		return meta, nil
	}

	workingDirAbs, err := r.workingDirAbs()
	if err != nil {
		return meta, err
	}
	cp, err := createWorkspaceCheckpoint(ctx, stateDir, checkpointID, workingDirAbs)
	if err != nil {
		return meta, err
	}
	b, err := json.Marshal(cp)
	if err != nil {
		return meta, err
	}
	workspaceJSON := strings.TrimSpace(string(b))

	// Best-effort: allow tool execution even when thread persistence is unavailable (for example,
	// in unit tests). In that mode we still snapshot the workspace, but rewind will not be able
	// to discover the snapshot later.
	if r.threadsDB == nil {
		r.workspaceCheckpointCreated = true
		return cp, nil
	}

	persistTO := r.persistOpTimeout
	if persistTO <= 0 {
		persistTO = 10 * time.Second
	}
	pctx, cancel := context.WithTimeout(context.Background(), persistTO)
	setErr := r.threadsDB.SetThreadCheckpointWorkspaceJSON(pctx, strings.TrimSpace(r.endpointID), strings.TrimSpace(r.threadID), checkpointID, workspaceJSON)
	cancel()
	if setErr != nil {
		// If the checkpoint record is missing (for example, an in-flight run from an older agent),
		// create it best-effort so future rewinds still have a stable anchor.
		if errors.Is(setErr, sql.ErrNoRows) {
			cctx, ccancel := context.WithTimeout(context.Background(), persistTO)
			_, _ = r.threadsDB.CreateThreadCheckpoint(cctx, strings.TrimSpace(r.endpointID), strings.TrimSpace(r.threadID), checkpointID, strings.TrimSpace(r.id), threadstore.CheckpointKindPreRun)
			ccancel()

			pctx, cancel := context.WithTimeout(context.Background(), persistTO)
			retryErr := r.threadsDB.SetThreadCheckpointWorkspaceJSON(pctx, strings.TrimSpace(r.endpointID), strings.TrimSpace(r.threadID), checkpointID, workspaceJSON)
			cancel()
			if retryErr != nil && !errors.Is(retryErr, sql.ErrNoRows) {
				return meta, retryErr
			}
			r.workspaceCheckpointCreated = true
			return cp, nil
		}
		return meta, setErr
	}

	r.workspaceCheckpointCreated = true
	return cp, nil
}
