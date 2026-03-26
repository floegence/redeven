package gitrepo

import (
	"context"
	"errors"
	"path"
	"strings"

	"github.com/floegence/redeven-agent/internal/gitutil"
)

type checkoutBranchTarget struct {
	LocalName  string
	RemoteName string
}

type deleteBranchTarget struct {
	LocalName string
}

func normalizeGitPathspecs(paths []string) ([]string, error) {
	if len(paths) == 0 {
		return nil, nil
	}
	seen := make(map[string]struct{}, len(paths))
	out := make([]string, 0, len(paths))
	for _, raw := range paths {
		item := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
		if item == "" {
			continue
		}
		cleaned := path.Clean(item)
		switch {
		case cleaned == ".":
			continue
		case strings.HasPrefix(cleaned, "/"):
			return nil, errors.New("invalid git path")
		case cleaned == "..":
			return nil, errors.New("invalid git path")
		case strings.HasPrefix(cleaned, "../"):
			return nil, errors.New("invalid git path")
		}
		if _, ok := seen[cleaned]; ok {
			continue
		}
		seen[cleaned] = struct{}{}
		out = append(out, cleaned)
	}
	return out, nil
}

func (s *Service) stageWorkspacePaths(ctx context.Context, repo repoContext, paths []string) error {
	pathspecs, err := normalizeGitPathspecs(paths)
	if err != nil {
		return err
	}
	args := []string{"add", "-A"}
	if len(pathspecs) > 0 {
		args = append(args, "--")
		args = append(args, pathspecs...)
	}
	_, err = gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, args...)
	return err
}

func (s *Service) unstageWorkspacePaths(ctx context.Context, repo repoContext, paths []string) error {
	if strings.TrimSpace(repo.headCommit) == "" {
		return errors.New("cannot unstage before the first commit")
	}
	pathspecs, err := normalizeGitPathspecs(paths)
	if err != nil {
		return err
	}
	args := []string{"reset", "--quiet", "--"}
	if len(pathspecs) == 0 {
		args = append(args, ".")
	} else {
		args = append(args, pathspecs...)
	}
	_, err = gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, args...)
	return err
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
