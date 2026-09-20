package workbenchlayout

import (
	"context"
	"errors"
	"path"
	"strings"
	"time"
)

// GitDiffTarget stores inspection identity, never a patch snapshot. Missing files
// remain valid targets: a tracked deletion can still have a readable Git diff.
type GitDiffTarget struct {
	RepoRootPath     string `json:"repoRootPath"`
	WorkspaceSection string `json:"workspaceSection"`
	Path             string `json:"path,omitempty"`
	OldPath          string `json:"oldPath,omitempty"`
	NewPath          string `json:"newPath,omitempty"`
	ChangeType       string `json:"changeType,omitempty"`
}

type OpenGitDiffRequest struct {
	Diff     *GitDiffTarget          `json:"diff"`
	Viewport OpenPreviewViewportHint `json:"viewport,omitempty"`
}

type OpenGitDiffResponse struct {
	WidgetID    string      `json:"widget_id"`
	Created     bool        `json:"created"`
	Snapshot    Snapshot    `json:"snapshot"`
	WidgetState WidgetState `json:"widget_state"`
}

func normalizeGitDiffTarget(target *GitDiffTarget) (*GitDiffTarget, error) {
	invalid := func() (*GitDiffTarget, error) { return nil, &ValidationError{Message: "invalid workspace diff target"} }
	if target == nil || !strings.HasPrefix(target.RepoRootPath, "/") || strings.ContainsRune(target.RepoRootPath, 0) || len(target.RepoRootPath) > 4096 {
		return invalid()
	}
	switch target.WorkspaceSection {
	case "staged", "unstaged", "untracked", "conflicted":
	default:
		return invalid()
	}
	if target.Path == "" && target.OldPath == "" && target.NewPath == "" {
		return invalid()
	}
	for _, value := range []string{target.Path, target.OldPath, target.NewPath} {
		if value == "" {
			continue
		}
		if strings.HasPrefix(value, "/") || strings.ContainsRune(value, 0) || len(value) > 4096 {
			return invalid()
		}
		for _, part := range strings.Split(value, "/") {
			if part == ".." {
				return invalid()
			}
		}
	}
	if len(target.ChangeType) > 32 {
		return invalid()
	}
	next := *target
	next.RepoRootPath = path.Clean(next.RepoRootPath)
	return &next, nil
}

func gitDiffTargetsEqual(left, right *GitDiffTarget) bool {
	if left == nil || right == nil {
		return left == right
	}
	return *left == *right
}

func sameGitDiffIdentity(left, right *GitDiffTarget) bool {
	if left == nil || right == nil {
		return false
	}
	// Change type can evolve while this exact path/section remains selected.
	return left.RepoRootPath == right.RepoRootPath && left.WorkspaceSection == right.WorkspaceSection && left.Path == right.Path && left.OldPath == right.OldPath && left.NewPath == right.NewPath
}

func (s *Service) OpenGitDiff(ctx context.Context, req OpenGitDiffRequest) (OpenGitDiffResponse, error) {
	if s == nil || s.store == nil {
		return OpenGitDiffResponse{}, errors.New("workbench layout service not initialized")
	}
	result, event, err := s.store.openGitDiff(ctx, req)
	if err == nil {
		s.broadcast(event)
	}
	return result, err
}

func (s *Store) openGitDiff(ctx context.Context, req OpenGitDiffRequest) (OpenGitDiffResponse, Event, error) {
	target, err := normalizeGitDiffTarget(req.Diff)
	if err != nil {
		return OpenGitDiffResponse{}, Event{}, err
	}
	now := time.Now().UnixMilli()
	hint, err := normalizeOpenPreviewViewportHint(req.Viewport, now)
	if err != nil {
		return OpenGitDiffResponse{}, Event{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return OpenGitDiffResponse{}, Event{}, err
	}
	defer func() { _ = tx.Rollback() }()
	current, err := snapshotTx(ctx, tx)
	if err != nil {
		return OpenGitDiffResponse{}, Event{}, err
	}
	for _, existing := range current.WidgetStates {
		if existing.WidgetType != WidgetTypeGitDiff || !sameGitDiffIdentity(existing.State.Diff, target) {
			continue
		}
		if gitDiffTargetsEqual(existing.State.Diff, target) {
			if err := tx.Commit(); err != nil {
				return OpenGitDiffResponse{}, Event{}, err
			}
			return OpenGitDiffResponse{WidgetID: existing.WidgetID, Snapshot: current, WidgetState: existing}, Event{}, nil
		}
		existing.State.Diff, existing.Revision, existing.UpdatedAtUnixMs = target, existing.Revision+1, now
		event, err := upsertWidgetStateTx(ctx, tx, existing)
		if err != nil {
			return OpenGitDiffResponse{}, Event{}, err
		}
		snapshot, err := snapshotTx(ctx, tx)
		if err != nil {
			return OpenGitDiffResponse{}, Event{}, err
		}
		if err := tx.Commit(); err != nil {
			return OpenGitDiffResponse{}, Event{}, err
		}
		return OpenGitDiffResponse{WidgetID: existing.WidgetID, Snapshot: snapshot, WidgetState: existing}, event, nil
	}
	widget, err := newWorkbenchWidget(current.Widgets, hint, now, WidgetTypeGitDiff)
	if err != nil {
		return OpenGitDiffResponse{}, Event{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO workbench_layout_widgets(widget_id, widget_type, x, y, width, height, z_index, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, widget.WidgetID, widget.WidgetType, widget.X, widget.Y, widget.Width, widget.Height, widget.ZIndex, widget.CreatedAtUnixMs)
	if err != nil {
		return OpenGitDiffResponse{}, Event{}, err
	}
	state := WidgetState{WidgetID: widget.WidgetID, WidgetType: WidgetTypeGitDiff, Revision: 1, UpdatedAtUnixMs: now, State: WidgetStateData{Kind: WidgetStateKindGitDiff, Diff: target}}
	if err := upsertWidgetStateRowTx(ctx, tx, state); err != nil {
		return OpenGitDiffResponse{}, Event{}, err
	}
	snapshot, event, err := commitWidgetLayoutTx(ctx, tx, current.Revision, now)
	return OpenGitDiffResponse{WidgetID: widget.WidgetID, Created: true, Snapshot: snapshot, WidgetState: state}, event, err
}
