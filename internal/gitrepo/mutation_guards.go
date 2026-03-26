package gitrepo

import (
	"context"
	"fmt"
)

type detachedSwitchState struct {
	TargetRef        string
	TargetCommit     string
	WorkspaceSummary gitWorkspaceSummary
	BlockingReason   string
}

func formatWorkspaceBlockedReason(action string, summary gitWorkspaceSummary) string {
	parts := make([]string, 0, 4)
	if summary.StagedCount > 0 {
		parts = append(parts, fmt.Sprintf("%d staged", summary.StagedCount))
	}
	if summary.UnstagedCount > 0 {
		parts = append(parts, fmt.Sprintf("%d unstaged", summary.UnstagedCount))
	}
	if summary.UntrackedCount > 0 {
		parts = append(parts, fmt.Sprintf("%d untracked", summary.UntrackedCount))
	}
	if summary.ConflictedCount > 0 {
		parts = append(parts, fmt.Sprintf("%d conflicted", summary.ConflictedCount))
	}
	if len(parts) == 0 {
		return fmt.Sprintf("Current workspace must be clean before %s.", action)
	}
	return fmt.Sprintf("Current workspace must be clean before %s (%s).", action, joinWorkspaceBlockedParts(parts))
}

func joinWorkspaceBlockedParts(parts []string) string {
	if len(parts) == 0 {
		return ""
	}
	return joinWithMiddleDot(parts)
}

func joinWithMiddleDot(parts []string) string {
	if len(parts) == 0 {
		return ""
	}
	if len(parts) == 1 {
		return parts[0]
	}
	result := parts[0]
	for _, part := range parts[1:] {
		result += " · " + part
	}
	return result
}

func formatOperationBlockedReason(action string, operation string) string {
	return fmt.Sprintf("Finish the current %s before %s.", operation, action)
}

func (s *Service) buildDetachedSwitchState(ctx context.Context, repo repoContext, targetRef string) (detachedSwitchState, error) {
	resolvedTargetRef, err := normalizeGitRef(targetRef)
	if err != nil {
		return detachedSwitchState{}, err
	}
	status, err := s.readWorkspaceStatus(ctx, repo.repoRootReal)
	if err != nil {
		return detachedSwitchState{}, err
	}
	state := detachedSwitchState{
		TargetRef:        resolvedTargetRef,
		TargetCommit:     readGitOptional(ctx, repo.repoRootReal, "rev-parse", "--verify", resolvedTargetRef+"^{commit}"),
		WorkspaceSummary: status.Summary(),
	}
	if state.TargetCommit == "" {
		return detachedSwitchState{}, fmt.Errorf("target commit does not exist")
	}
	if workspaceSummaryHasChanges(state.WorkspaceSummary) {
		state.BlockingReason = formatWorkspaceBlockedReason("switching to detached HEAD", state.WorkspaceSummary)
		return state, nil
	}
	if operation := readGitOperationState(ctx, repo.repoRootReal); operation != "" {
		state.BlockingReason = formatOperationBlockedReason("switching to detached HEAD", operation)
		return state, nil
	}
	return state, nil
}
