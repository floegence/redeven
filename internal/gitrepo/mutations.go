package gitrepo

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/redeven/internal/gitutil"
)

type checkoutBranchTarget struct {
	LocalName  string
	RemoteName string
}

type deleteBranchTarget struct {
	LocalName string
}

type workspaceMutationSelection struct {
	Section       string
	DirectoryPath string
	Paths         []string
}

func (s *Service) resolveWorkspaceMutationPaths(ctx context.Context, repo repoContext, section string) ([]string, error) {
	selectedItems, _, _, err := s.resolveWorkspaceMutationScope(ctx, repo, workspaceMutationSelection{Section: section}, "section")
	if err != nil {
		return nil, err
	}
	return normalizeGitPathspecs(workspaceSectionPathspecs(selectedItems))
}

func (s *Service) stageWorkspacePaths(ctx context.Context, repo repoContext, paths []string) error {
	_, err := s.stageWorkspace(ctx, repo, workspaceMutationSelection{Paths: paths})
	return err
}

func (s *Service) stageWorkspace(ctx context.Context, repo repoContext, selection workspaceMutationSelection) (gitWorkspaceMutationResult, error) {
	selectedItems, normalizedPaths, normalizedDirectoryPath, err := s.resolveWorkspaceMutationScope(ctx, repo, selection, "stage")
	if err != nil {
		return gitWorkspaceMutationResult{}, err
	}
	result := buildWorkspaceMutationResult(selection, selectedItems, nil)
	if result.MatchedCount == 0 {
		return result, nil
	}
	args := []string{"add", "-A"}
	switch {
	case len(normalizedPaths) > 0:
		args = append(args, "--")
		args = append(args, normalizedPaths...)
	case normalizedDirectoryPath != "":
		args = append(args, "--", normalizedDirectoryPath)
	}
	if _, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, args...); err != nil {
		return gitWorkspaceMutationResult{}, err
	}
	remainingItems, err := s.resolveWorkspaceMutationRemaining(ctx, repo, selection, "stage", selectedItems)
	if err != nil {
		return gitWorkspaceMutationResult{}, err
	}
	return buildWorkspaceMutationResult(selection, selectedItems, remainingItems), nil
}

func (s *Service) unstageWorkspacePaths(ctx context.Context, repo repoContext, paths []string) error {
	_, err := s.unstageWorkspace(ctx, repo, workspaceMutationSelection{Paths: paths})
	return err
}

func (s *Service) unstageWorkspace(ctx context.Context, repo repoContext, selection workspaceMutationSelection) (gitWorkspaceMutationResult, error) {
	selectedItems, normalizedPaths, normalizedDirectoryPath, err := s.resolveWorkspaceMutationScope(ctx, repo, selection, "unstage")
	if err != nil {
		return gitWorkspaceMutationResult{}, err
	}
	result := buildWorkspaceMutationResult(selection, selectedItems, nil)
	if result.MatchedCount == 0 {
		return result, nil
	}
	args := []string{"reset", "--quiet", "--"}
	switch {
	case len(normalizedPaths) > 0:
		args = append(args, normalizedPaths...)
	case normalizedDirectoryPath != "":
		args = append(args, normalizedDirectoryPath)
	default:
		args = append(args, ".")
	}
	if _, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, args...); err != nil {
		return gitWorkspaceMutationResult{}, err
	}
	remainingItems, err := s.resolveWorkspaceMutationRemaining(ctx, repo, selection, "unstage", selectedItems)
	if err != nil {
		return gitWorkspaceMutationResult{}, err
	}
	return buildWorkspaceMutationResult(selection, selectedItems, remainingItems), nil
}

func workspaceChangeMatchesWanted(change gitWorkspaceChange, wanted map[string]struct{}) bool {
	for _, candidate := range workspaceChangePathCandidates(change) {
		if _, ok := wanted[candidate]; ok {
			return true
		}
	}
	return false
}

func workspaceDiscardTargetPath(change gitWorkspaceChange) string {
	return firstNonEmptyPath(workspaceChangePathCandidates(change)...)
}

func (s *Service) discardWorkspacePaths(ctx context.Context, repo repoContext, paths []string) error {
	_, err := s.discardWorkspace(ctx, repo, workspaceMutationSelection{Paths: paths})
	return err
}

func (s *Service) discardWorkspace(ctx context.Context, repo repoContext, selection workspaceMutationSelection) (gitWorkspaceMutationResult, error) {
	selectedItems, _, _, err := s.resolveWorkspaceMutationScope(ctx, repo, selection, "discard")
	if err != nil {
		return gitWorkspaceMutationResult{}, err
	}
	result := buildWorkspaceMutationResult(selection, selectedItems, nil)
	if result.MatchedCount == 0 {
		return result, nil
	}
	trackedPaths, untrackedPaths := workspaceDiscardPaths(selectedItems)
	if len(trackedPaths) > 0 {
		args := []string{"restore", "--worktree", "--"}
		args = append(args, trackedPaths...)
		if _, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, args...); err != nil {
			return gitWorkspaceMutationResult{}, err
		}
	}
	if len(untrackedPaths) > 0 {
		args := []string{"clean", "-f", "-d", "--"}
		args = append(args, untrackedPaths...)
		if _, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, args...); err != nil {
			return gitWorkspaceMutationResult{}, err
		}
	}
	remainingItems, err := s.resolveWorkspaceMutationRemaining(ctx, repo, selection, "discard", selectedItems)
	if err != nil {
		return gitWorkspaceMutationResult{}, err
	}
	return buildWorkspaceMutationResult(selection, selectedItems, remainingItems), nil
}

func (s *Service) resolveWorkspaceMutationScope(ctx context.Context, repo repoContext, selection workspaceMutationSelection, action string) ([]gitWorkspaceChange, []string, string, error) {
	normalizedPaths, err := normalizeGitPathspecs(selection.Paths)
	if err != nil {
		return nil, nil, "", err
	}
	normalizedDirectoryPath, err := normalizeGitDirectoryPath(selection.DirectoryPath)
	if err != nil {
		return nil, nil, "", err
	}
	status, err := s.readWorkspaceStatus(ctx, repo.repoRootReal)
	if err != nil {
		return nil, nil, "", err
	}
	sourceItems, err := workspaceMutationSourceItems(status, selection.Section, action)
	if err != nil {
		return nil, nil, "", err
	}
	return filterWorkspaceMutationItems(sourceItems, normalizedPaths, normalizedDirectoryPath), normalizedPaths, normalizedDirectoryPath, nil
}

func (s *Service) resolveWorkspaceMutationRemaining(ctx context.Context, repo repoContext, selection workspaceMutationSelection, action string, selectedItems []gitWorkspaceChange) ([]gitWorkspaceChange, error) {
	if len(selectedItems) == 0 {
		return nil, nil
	}
	status, err := s.readWorkspaceStatus(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	sourceItems, err := workspaceMutationSourceItems(status, selection.Section, action)
	if err != nil {
		return nil, err
	}
	wanted := workspaceCanonicalMatchSet(workspaceSectionPathspecs(selectedItems))
	if len(wanted) == 0 {
		return nil, nil
	}
	remaining := make([]gitWorkspaceChange, 0, len(sourceItems))
	for _, item := range sourceItems {
		if workspaceChangeMatchesWanted(item, wanted) {
			remaining = append(remaining, item)
		}
	}
	return remaining, nil
}

func workspaceMutationSourceItems(status workspaceStatusSnapshot, section string, action string) ([]gitWorkspaceChange, error) {
	normalizedSection := strings.TrimSpace(section)
	switch action {
	case "stage":
		switch normalizedSection {
		case "", "changes":
			return append(append([]gitWorkspaceChange{}, status.Unstaged...), status.Untracked...), nil
		case "conflicted":
			return append([]gitWorkspaceChange{}, status.Conflicted...), nil
		default:
			return nil, errors.New("invalid workspace page section")
		}
	case "unstage":
		switch normalizedSection {
		case "", "staged":
			return append([]gitWorkspaceChange{}, status.Staged...), nil
		default:
			return nil, errors.New("invalid workspace page section")
		}
	case "discard":
		switch normalizedSection {
		case "", "changes":
			return append(append([]gitWorkspaceChange{}, status.Unstaged...), status.Untracked...), nil
		default:
			return nil, errors.New("invalid workspace page section")
		}
	case "section":
		pageSection, err := normalizeWorkspacePageSection(normalizedSection)
		if err != nil {
			return nil, err
		}
		switch pageSection {
		case "staged":
			return append([]gitWorkspaceChange{}, status.Staged...), nil
		case "conflicted":
			return append([]gitWorkspaceChange{}, status.Conflicted...), nil
		default:
			return append(append([]gitWorkspaceChange{}, status.Unstaged...), status.Untracked...), nil
		}
	default:
		return nil, errors.New("invalid workspace mutation action")
	}
}

func filterWorkspaceMutationItems(items []gitWorkspaceChange, normalizedPaths []string, normalizedDirectoryPath string) []gitWorkspaceChange {
	if len(items) == 0 {
		return nil
	}
	if len(normalizedPaths) == 0 && normalizedDirectoryPath == "" {
		return append([]gitWorkspaceChange{}, items...)
	}
	wanted := workspaceCanonicalMatchSet(normalizedPaths)
	filtered := make([]gitWorkspaceChange, 0, len(items))
	for _, item := range items {
		if len(wanted) > 0 {
			if workspaceChangeMatchesWanted(item, wanted) {
				filtered = append(filtered, item)
			}
			continue
		}
		if workspacePathWithinDirectory(workspaceChangeBrowsePath(item), normalizedDirectoryPath) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func buildWorkspaceMutationResult(selection workspaceMutationSelection, matchedItems []gitWorkspaceChange, remainingItems []gitWorkspaceChange) gitWorkspaceMutationResult {
	result := gitWorkspaceMutationResult{
		RequestedCount: len(matchedItems),
		MatchedCount:   len(matchedItems),
		AffectedCount:  len(matchedItems) - len(remainingItems),
		RemainingCount: len(remainingItems),
	}
	if result.AffectedCount < 0 {
		result.AffectedCount = 0
	}
	if result.MatchedCount == 0 {
		result.Warnings = []string{workspaceMutationNoMatchWarning(selection)}
		return result
	}
	if result.RemainingCount > 0 {
		result.Warnings = []string{"Some selected files still match the requested scope after the Git operation."}
	}
	return result
}

func workspaceMutationNoMatchWarning(selection workspaceMutationSelection) string {
	switch {
	case strings.TrimSpace(selection.DirectoryPath) != "":
		return "No current files matched the selected folder."
	case len(selection.Paths) > 0:
		return "No current files matched the selected file scope."
	default:
		return "No current files matched the selected workspace section."
	}
}

func workspaceDiscardPaths(items []gitWorkspaceChange) ([]string, []string) {
	trackedPaths := make([]string, 0, len(items))
	untrackedPaths := make([]string, 0, len(items))
	trackedSeen := make(map[string]struct{}, len(items)*2)
	untrackedSeen := make(map[string]struct{}, len(items))
	for _, item := range items {
		if strings.TrimSpace(item.Section) == "untracked" {
			targetPath := workspaceDiscardTargetPath(item)
			if targetPath == "" {
				continue
			}
			if _, ok := untrackedSeen[targetPath]; ok {
				continue
			}
			untrackedSeen[targetPath] = struct{}{}
			untrackedPaths = append(untrackedPaths, targetPath)
			continue
		}
		for _, targetPath := range workspaceChangePathCandidates(item) {
			if targetPath == "" {
				continue
			}
			if _, ok := trackedSeen[targetPath]; ok {
				continue
			}
			trackedSeen[targetPath] = struct{}{}
			trackedPaths = append(trackedPaths, targetPath)
		}
	}
	return trackedPaths, untrackedPaths
}

func (s *Service) commitWorkspace(ctx context.Context, repo repoContext, message string) (*commitWorkspaceResp, error) {
	message = strings.TrimSpace(message)
	if message == "" {
		return nil, errors.New("commit message is required")
	}
	status, err := s.readWorkspaceStatus(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	if len(status.Staged) == 0 {
		return nil, errors.New("no staged changes to commit")
	}
	_, err = gitutil.RunCombinedOutput(ctx, repo.repoRootReal, []string{"GIT_EDITOR=:"}, "commit", "--message", message, "--cleanup=strip")
	if err != nil {
		return nil, err
	}
	updatedRepo, err := s.loadRepoContext(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	return &commitWorkspaceResp{
		RepoRootPath: updatedRepo.repoRootReal,
		HeadRef:      updatedRepo.headRef,
		HeadCommit:   updatedRepo.headCommit,
	}, nil
}

func (s *Service) fetchRepo(ctx context.Context, repo repoContext) (*fetchRepoResp, error) {
	if _, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, "fetch", "--all", "--prune"); err != nil {
		return nil, err
	}
	updatedRepo, err := s.loadRepoContext(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	return &fetchRepoResp{
		RepoRootPath: updatedRepo.repoRootReal,
		HeadRef:      updatedRepo.headRef,
		HeadCommit:   updatedRepo.headCommit,
	}, nil
}

func (s *Service) pullRepo(ctx context.Context, repo repoContext) (*pullRepoResp, error) {
	if strings.TrimSpace(repo.headRef) == "" || repo.headRef == "HEAD" {
		return nil, errors.New("cannot pull while HEAD is detached")
	}
	if _, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, "pull", "--ff-only"); err != nil {
		return nil, err
	}
	updatedRepo, err := s.loadRepoContext(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	return &pullRepoResp{
		RepoRootPath: updatedRepo.repoRootReal,
		HeadRef:      updatedRepo.headRef,
		HeadCommit:   updatedRepo.headCommit,
	}, nil
}

func (s *Service) pushRepo(ctx context.Context, repo repoContext) (*pushRepoResp, error) {
	if strings.TrimSpace(repo.headRef) == "" || repo.headRef == "HEAD" {
		return nil, errors.New("cannot push while HEAD is detached")
	}
	if _, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, "push"); err != nil {
		return nil, err
	}
	updatedRepo, err := s.loadRepoContext(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	return &pushRepoResp{
		RepoRootPath: updatedRepo.repoRootReal,
		HeadRef:      updatedRepo.headRef,
		HeadCommit:   updatedRepo.headCommit,
	}, nil
}

func (s *Service) checkoutBranch(ctx context.Context, repo repoContext, name string, fullName string, kind string) (*checkoutBranchResp, error) {
	target, err := normalizeCheckoutBranchTarget(name, fullName, kind)
	if err != nil {
		return nil, err
	}
	args := []string{"checkout"}
	switch {
	case target.RemoteName != "":
		localRef := "refs/heads/" + target.LocalName
		remoteRef := "refs/remotes/" + target.RemoteName
		switch {
		case gitRefExists(ctx, repo.repoRootReal, localRef):
			args = append(args, target.LocalName)
		case gitRefExists(ctx, repo.repoRootReal, remoteRef):
			args = append(args, "--track", "-b", target.LocalName, remoteRef)
		default:
			return nil, errors.New("target branch does not exist")
		}
	default:
		localRef := "refs/heads/" + target.LocalName
		if !gitRefExists(ctx, repo.repoRootReal, localRef) {
			return nil, errors.New("target branch does not exist")
		}
		args = append(args, target.LocalName)
	}

	if _, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, args...); err != nil {
		return nil, err
	}
	updatedRepo, err := s.loadRepoContext(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	return &checkoutBranchResp{
		RepoRootPath: updatedRepo.repoRootReal,
		HeadRef:      updatedRepo.headRef,
		HeadCommit:   updatedRepo.headCommit,
	}, nil
}

func (s *Service) switchDetached(ctx context.Context, repo repoContext, targetRef string) (*switchDetachedResp, error) {
	state, err := s.buildDetachedSwitchState(ctx, repo, targetRef)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(state.BlockingReason) != "" {
		return nil, errors.New(state.BlockingReason)
	}
	if _, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, "switch", "--detach", state.TargetRef); err != nil {
		return nil, err
	}
	updatedRepo, err := s.loadRepoContext(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	return &switchDetachedResp{
		RepoRootPath: updatedRepo.repoRootReal,
		HeadRef:      updatedRepo.headRef,
		HeadCommit:   updatedRepo.headCommit,
		Detached:     updatedRepo.headRef == "" || updatedRepo.headRef == "HEAD",
	}, nil
}

func (s *Service) mergeBranch(ctx context.Context, repo repoContext, name string, fullName string, kind string, planFingerprint string) (*mergeBranchResp, error) {
	target, err := normalizeMergeBranchTarget(name, fullName, kind)
	if err != nil {
		return nil, err
	}
	plan, err := s.buildMergeBranchPlan(ctx, repo, target)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(planFingerprint) == "" {
		return nil, errors.New("merge plan fingerprint is required")
	}
	if plan.PlanFingerprint != strings.TrimSpace(planFingerprint) {
		return nil, errors.New("merge plan is stale; review the merge again")
	}
	if strings.TrimSpace(plan.BlockingReason) != "" {
		return nil, errors.New(plan.BlockingReason)
	}

	result := plan.Outcome
	switch plan.Outcome {
	case mergeBranchOutcomeUpToDate:
	case mergeBranchOutcomeFastForward, mergeBranchOutcomeMergeCommit:
		conflicted, err := s.runMergeBranchCommand(ctx, repo.repoRootReal, target.MergeRef)
		if err != nil {
			return nil, err
		}
		if conflicted {
			result = mergeBranchResultConflicted
		}
	default:
		return nil, errors.New("merge is blocked")
	}

	updatedRepo, err := s.loadRepoContext(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	resp := &mergeBranchResp{
		RepoRootPath: updatedRepo.repoRootReal,
		HeadRef:      updatedRepo.headRef,
		HeadCommit:   updatedRepo.headCommit,
		Result:       result,
	}
	if result == mergeBranchResultConflicted {
		status, err := s.readWorkspaceStatus(ctx, repo.repoRootReal)
		if err != nil {
			return nil, err
		}
		resp.ConflictSummary = status.Summary()
	}
	return resp, nil
}

type deleteBranchOptions struct {
	Name                         string
	FullName                     string
	Kind                         string
	DeleteMode                   string
	ConfirmBranchName            string
	RemoveLinkedWorktree         bool
	DiscardLinkedWorktreeChanges bool
	PlanFingerprint              string
}

func (s *Service) deleteBranch(
	ctx context.Context,
	repo repoContext,
	req deleteBranchOptions,
) (*deleteBranchResp, error) {
	target, err := normalizeDeleteBranchTarget(req.Name, req.FullName, req.Kind)
	if err != nil {
		return nil, err
	}
	deleteMode, err := normalizeDeleteBranchMode(req.DeleteMode)
	if err != nil {
		return nil, err
	}
	plan, err := s.buildDeleteBranchPlan(ctx, repo, target)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.PlanFingerprint) == "" {
		return nil, errors.New("delete plan fingerprint is required")
	}
	if plan.PlanFingerprint != strings.TrimSpace(req.PlanFingerprint) {
		return nil, errors.New("delete plan is stale; review the branch again")
	}
	if strings.TrimSpace(plan.BlockingReason) != "" {
		return nil, errors.New(plan.BlockingReason)
	}
	if deleteMode == deleteBranchModeSafe && !plan.SafeDeleteAllowed {
		return nil, errors.New(plan.SafeDeleteReason)
	}
	if deleteMode == deleteBranchModeForce {
		if !plan.ForceDeleteAllowed {
			return nil, errors.New(plan.ForceDeleteReason)
		}
		if plan.ForceDeleteRequiresConfirm && strings.TrimSpace(req.ConfirmBranchName) != target.LocalName {
			return nil, errors.New("branch name confirmation does not match the target branch")
		}
	}

	removedWorktreePath := ""
	if plan.LinkedWorktree != nil {
		if !req.RemoveLinkedWorktree {
			return nil, errors.New("linked worktree removal must be confirmed before deleting this branch")
		}
		args := []string{"worktree", "remove"}
		if deleteMode == deleteBranchModeForce || plan.RequiresDiscardConfirmation {
			if deleteMode != deleteBranchModeForce && !req.DiscardLinkedWorktreeChanges {
				return nil, errors.New("discard confirmation is required for linked worktree changes")
			}
			args = append(args, "--force")
		}
		args = append(args, plan.LinkedWorktree.WorktreePath)
		if _, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, args...); err != nil {
			return nil, err
		}
		removedWorktreePath = plan.LinkedWorktree.WorktreePath
	}

	deleteFlag := "-d"
	if deleteMode == deleteBranchModeForce {
		deleteFlag = "-D"
	}
	if _, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, "branch", deleteFlag, target.LocalName); err != nil {
		return nil, err
	}
	updatedRepo, err := s.loadRepoContext(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	return &deleteBranchResp{
		RepoRootPath:          updatedRepo.repoRootReal,
		HeadRef:               updatedRepo.headRef,
		HeadCommit:            updatedRepo.headCommit,
		LinkedWorktreeRemoved: removedWorktreePath != "",
		RemovedWorktreePath:   removedWorktreePath,
	}, nil
}

func (s *Service) runMergeBranchCommand(ctx context.Context, repoRoot string, mergeRef string) (bool, error) {
	cmd, err := gitutil.CommandContext(ctx, repoRoot, nil, "merge", "--no-edit", mergeRef)
	if err != nil {
		return false, err
	}
	out, err := cmd.CombinedOutput()
	if err == nil {
		return false, nil
	}

	status, statusErr := s.readWorkspaceStatus(ctx, repoRoot)
	if statusErr == nil && len(status.Conflicted) > 0 {
		return true, nil
	}

	message := strings.TrimSpace(string(out))
	if message == "" {
		message = err.Error()
	}
	return false, errors.New(message)
}

func gitRefExists(ctx context.Context, repoRoot string, ref string) bool {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return false
	}
	_, err := gitutil.RunCombinedOutput(ctx, repoRoot, nil, "show-ref", "--verify", "--quiet", ref)
	return err == nil
}

func normalizeCheckoutBranchTarget(name string, fullName string, kind string) (checkoutBranchTarget, error) {
	fullName = strings.TrimSpace(fullName)
	switch {
	case strings.HasPrefix(fullName, "refs/heads/"):
		localName, err := normalizeGitRef(strings.TrimPrefix(fullName, "refs/heads/"))
		if err != nil {
			return checkoutBranchTarget{}, err
		}
		return checkoutBranchTarget{LocalName: localName}, nil
	case strings.HasPrefix(fullName, "refs/remotes/"):
		remoteName, err := normalizeGitRef(strings.TrimPrefix(fullName, "refs/remotes/"))
		if err != nil {
			return checkoutBranchTarget{}, err
		}
		localName := trackingBranchNameFromRemote(remoteName)
		if localName == "" {
			return checkoutBranchTarget{}, errors.New("invalid remote branch")
		}
		return checkoutBranchTarget{LocalName: localName, RemoteName: remoteName}, nil
	}

	switch strings.TrimSpace(kind) {
	case "remote":
		remoteName, err := normalizeGitRef(name)
		if err != nil {
			return checkoutBranchTarget{}, err
		}
		localName := trackingBranchNameFromRemote(remoteName)
		if localName == "" {
			return checkoutBranchTarget{}, errors.New("invalid remote branch")
		}
		return checkoutBranchTarget{LocalName: localName, RemoteName: remoteName}, nil
	default:
		localName, err := normalizeGitRef(name)
		if err != nil {
			return checkoutBranchTarget{}, err
		}
		return checkoutBranchTarget{LocalName: localName}, nil
	}
}

func normalizeDeleteBranchTarget(name string, fullName string, kind string) (deleteBranchTarget, error) {
	fullName = strings.TrimSpace(fullName)
	switch {
	case strings.HasPrefix(fullName, "refs/heads/"):
		localName, err := normalizeGitRef(strings.TrimPrefix(fullName, "refs/heads/"))
		if err != nil {
			return deleteBranchTarget{}, err
		}
		return deleteBranchTarget{LocalName: localName}, nil
	case strings.HasPrefix(fullName, "refs/remotes/"):
		return deleteBranchTarget{}, errors.New("remote branches cannot be deleted here")
	}

	if strings.TrimSpace(kind) == "remote" {
		return deleteBranchTarget{}, errors.New("remote branches cannot be deleted here")
	}
	localName, err := normalizeGitRef(name)
	if err != nil {
		return deleteBranchTarget{}, err
	}
	return deleteBranchTarget{LocalName: localName}, nil
}

func trackingBranchNameFromRemote(remoteName string) string {
	remoteName = strings.TrimSpace(remoteName)
	slash := strings.Index(remoteName, "/")
	if slash <= 0 || slash >= len(remoteName)-1 {
		return ""
	}
	return remoteName[slash+1:]
}
