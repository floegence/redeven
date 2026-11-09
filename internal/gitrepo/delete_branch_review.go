package gitrepo

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/gitruntime"
)

type deleteBranchPlan struct {
	Target                          deleteBranchTarget
	LinkedWorktree                  *gitDeleteLinkedWorktreePreview
	RequiresWorktreeRemoval         bool
	RequiresDiscardConfirmation     bool
	SafeDeleteAllowed               bool
	SafeDeleteBaseRef               string
	SafeDeleteReason                string
	ForceDeleteAllowed              bool
	ForceDeleteRequiresConfirm      bool
	ForceDeleteReason               string
	BlockingCode                    string
	BlockingReason                  string
	TargetHeadCommit                string
	SafeDeleteBaseCommit            string
	DestructiveWorkspaceFingerprint string
	PlanFingerprint                 string
}

type deleteBranchFingerprintPayload struct {
	LocalName                   string                                 `json:"local_name"`
	TargetHeadCommit            string                                 `json:"target_head_commit"`
	RepoHeadRef                 string                                 `json:"repo_head_ref"`
	RepoHeadCommit              string                                 `json:"repo_head_commit"`
	SafeDeleteBaseRef           string                                 `json:"safe_delete_base_ref"`
	SafeDeleteBaseCommit        string                                 `json:"safe_delete_base_commit"`
	SafeDeleteAllowed           bool                                   `json:"safe_delete_allowed"`
	SafeDeleteReason            string                                 `json:"safe_delete_reason"`
	ForceDeleteAllowed          bool                                   `json:"force_delete_allowed"`
	ForceDeleteRequiresConfirm  bool                                   `json:"force_delete_requires_confirm"`
	ForceDeleteReason           string                                 `json:"force_delete_reason"`
	BlockingReason              string                                 `json:"blocking_reason"`
	BlockingCode                string                                 `json:"blocking_code"`
	RequiresWorktreeRemoval     bool                                   `json:"requires_worktree_removal"`
	RequiresDiscardConfirmation bool                                   `json:"requires_discard_confirmation"`
	LinkedWorktree              *deleteBranchFingerprintLinkedWorktree `json:"linked_worktree,omitempty"`
}

type deleteBranchMode string

const (
	deleteBranchModeSafe  deleteBranchMode = "safe"
	deleteBranchModeForce deleteBranchMode = "force"
)

func normalizeDeleteBranchMode(value string) (deleteBranchMode, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "", string(deleteBranchModeSafe):
		return deleteBranchModeSafe, nil
	case string(deleteBranchModeForce):
		return deleteBranchModeForce, nil
	default:
		return "", errors.New("invalid delete mode")
	}
}

func (s *Service) deleteBranchTopologyPaths(ctx context.Context, repo repoContext, name string, fullName string, kind string) ([]string, error) {
	target, err := normalizeDeleteBranchTarget(name, fullName, kind)
	if err != nil {
		return nil, err
	}
	paths := []string{repo.repoRootReal}
	bindings, err := s.readWorktreeBindings(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	if binding, ok := bindings["refs/heads/"+target.LocalName]; ok {
		path := filepath.Clean(binding.Path)
		if path != "" && path != filepath.Clean(repo.repoRootReal) {
			paths = append(paths, path)
		}
	}
	return paths, nil
}

func sameDeleteBranchTopologyPaths(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if filepath.Clean(left[index]) != filepath.Clean(right[index]) {
			return false
		}
	}
	return true
}

type deleteBranchFingerprintLinkedWorktree struct {
	WorktreePath                    string              `json:"worktree_path"`
	Accessible                      bool                `json:"accessible"`
	Summary                         gitWorkspaceSummary `json:"summary"`
	DestructiveWorkspaceFingerprint string              `json:"destructive_workspace_fingerprint,omitempty"`
}

func (s *Service) previewDeleteBranch(ctx context.Context, repo repoContext, name string, fullName string, kind string) (*previewDeleteBranchResp, error) {
	target, err := normalizeDeleteBranchTarget(name, fullName, kind)
	if err != nil {
		return nil, err
	}
	plan, err := s.buildDeleteBranchPlan(ctx, repo, target, false)
	if err != nil {
		return nil, err
	}
	return &previewDeleteBranchResp{
		RepoRootPath:                repo.repoRootReal,
		Name:                        target.LocalName,
		FullName:                    "refs/heads/" + target.LocalName,
		Kind:                        "local",
		LinkedWorktree:              plan.LinkedWorktree,
		RequiresWorktreeRemoval:     plan.RequiresWorktreeRemoval,
		RequiresDiscardConfirmation: plan.RequiresDiscardConfirmation,
		SafeDeleteAllowed:           plan.SafeDeleteAllowed,
		SafeDeleteBaseRef:           plan.SafeDeleteBaseRef,
		SafeDeleteReason:            plan.SafeDeleteReason,
		ForceDeleteAllowed:          plan.ForceDeleteAllowed,
		ForceDeleteRequiresConfirm:  plan.ForceDeleteRequiresConfirm,
		ForceDeleteReason:           plan.ForceDeleteReason,
		BlockingReason:              plan.BlockingReason,
		BlockingCode:                plan.BlockingCode,
		PlanFingerprint:             plan.PlanFingerprint,
	}, nil
}

func (s *Service) buildDeleteBranchPlan(ctx context.Context, repo repoContext, target deleteBranchTarget, directWorkspaceRead bool) (deleteBranchPlan, error) {
	if strings.TrimSpace(target.LocalName) == "" {
		return deleteBranchPlan{}, errors.New("target branch does not exist")
	}
	if strings.TrimSpace(repo.headRef) == target.LocalName {
		return deleteBranchPlan{}, errors.New("cannot delete the current branch")
	}

	localRef := "refs/heads/" + target.LocalName
	if !s.gitRefExists(ctx, repo.repoRootReal, localRef) {
		return deleteBranchPlan{}, errors.New("target branch does not exist")
	}

	targetHeadCommit := strings.TrimSpace(s.readGitOptional(ctx, repo.repoRootReal, "rev-parse", "--verify", localRef))
	linkedWorktree, err := s.readDeleteLinkedWorktreePreview(ctx, repo, localRef, directWorkspaceRead)
	if err != nil {
		return deleteBranchPlan{}, err
	}
	safeDeleteBaseRef, safeDeleteBaseCommit := s.resolveSafeDeleteBase(ctx, repo, target.LocalName)
	safeDeleteAllowed, safeDeleteReason := s.readSafeDeleteStatus(ctx, repo.repoRootReal, localRef, safeDeleteBaseRef)

	plan := deleteBranchPlan{
		Target:                      target,
		LinkedWorktree:              linkedWorktree,
		RequiresWorktreeRemoval:     linkedWorktree != nil,
		RequiresDiscardConfirmation: linkedWorktree != nil && linkedWorktree.Accessible && workspaceSummaryHasChanges(linkedWorktree.Summary),
		SafeDeleteAllowed:           safeDeleteAllowed,
		SafeDeleteBaseRef:           safeDeleteBaseRef,
		SafeDeleteReason:            safeDeleteReason,
		ForceDeleteAllowed:          true,
		ForceDeleteRequiresConfirm:  true,
		TargetHeadCommit:            targetHeadCommit,
		SafeDeleteBaseCommit:        safeDeleteBaseCommit,
	}
	if linkedWorktree != nil && linkedWorktree.blockingCode != "" {
		plan.BlockingCode = linkedWorktree.blockingCode
		plan.BlockingReason = linkedWorktree.blockingReason
		plan.SafeDeleteAllowed = false
		plan.SafeDeleteReason = plan.BlockingReason
		plan.ForceDeleteAllowed = false
		plan.ForceDeleteReason = plan.BlockingReason
		plan.RequiresWorktreeRemoval = false
		plan.RequiresDiscardConfirmation = false
	}
	if linkedWorktree != nil && linkedWorktree.Accessible && plan.BlockingReason == "" {
		ignored, ignoredErr := s.runtime.RunRead(ctx, linkedWorktree.WorktreePath, nil, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory", "-z")
		if ignoredErr != nil {
			return deleteBranchPlan{}, ignoredErr
		}
		plan.RequiresDiscardConfirmation = plan.RequiresDiscardConfirmation || len(ignored.Stdout) > 0
		plan.DestructiveWorkspaceFingerprint, err = s.destructiveWorkspaceFingerprint(ctx, linkedWorktree.WorktreePath)
		if err != nil {
			return deleteBranchPlan{}, err
		}
	}
	plan.PlanFingerprint = buildDeleteBranchPlanFingerprint(repo, plan)
	return plan, nil
}

func (s *Service) readDeleteLinkedWorktreePreview(ctx context.Context, repo repoContext, localRef string, directWorkspaceRead bool) (*gitDeleteLinkedWorktreePreview, error) {
	worktrees, err := s.readWorktrees(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	var binding *worktreeBinding
	for index := range worktrees {
		if worktrees[index].Ref == localRef {
			binding = &worktrees[index]
			break
		}
	}
	if binding == nil {
		return nil, nil
	}
	worktreePath := filepath.Clean(binding.Path)
	if worktreePath == filepath.Clean(repo.repoRootReal) {
		return nil, nil
	}
	blocked := func(code, reason string, accessible bool) (*gitDeleteLinkedWorktreePreview, error) {
		return &gitDeleteLinkedWorktreePreview{WorktreePath: worktreePath, Accessible: accessible, blockingCode: code, blockingReason: reason}, nil
	}
	identity, err := s.validateRepoRootIdentity(ctx, worktreePath)
	if err != nil {
		return blocked("inaccessible_worktree", fmt.Sprintf("Linked worktree %s is not accessible from this runtime host.", worktreePath), false)
	}
	if identity.CommonDir != repo.identity.CommonDir {
		return blocked("worktree_identity_changed", "The worktree repository identity has changed. Review the branch again.", true)
	}
	if identity.GitDir == identity.CommonDir {
		return blocked("primary_worktree", "This branch is checked out in the primary worktree. Switch that directory to another branch before deleting this branch.", true)
	}
	if binding.Locked {
		return blocked("locked_worktree", "This worktree is locked. Unlock it explicitly before deleting its branch and worktree.", true)
	}
	for _, other := range worktrees {
		relative, relErr := filepath.Rel(worktreePath, filepath.Clean(other.Path))
		if relErr == nil && relative != "." && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative) {
			return blocked("nested_worktree", "This worktree contains another registered worktree. Move or remove the nested worktree first.", true)
		}
	}
	if directWorkspaceRead {
		linkedRepo, loadErr := s.loadResolvedRepoContext(ctx, identity)
		if loadErr != nil {
			return nil, loadErr
		}
		status, statusErr := s.readWorkspaceStatus(ctx, linkedRepo.repoRootReal)
		if statusErr != nil {
			return nil, statusErr
		}
		return &gitDeleteLinkedWorktreePreview{
			WorktreePath: linkedRepo.repoRootReal,
			Accessible:   true,
			Summary:      status.Summary(),
		}, nil
	}
	snapshot, err := s.readLinkedWorktreeSnapshot(ctx, identity.WorktreeRoot)
	if err != nil {
		return nil, err
	}
	return &gitDeleteLinkedWorktreePreview{
		WorktreePath:      snapshot.WorktreePath,
		Accessible:        true,
		Summary:           snapshot.Summary,
		WorkspaceRevision: snapshot.WorkspaceRevision,
	}, nil
}

func (s *Service) resolveSafeDeleteBase(ctx context.Context, repo repoContext, localName string) (string, string) {
	upstreamRef := strings.TrimSpace(s.readGitOptional(
		ctx,
		repo.repoRootReal,
		"for-each-ref",
		"--format=%(upstream:short)",
		"refs/heads/"+localName,
	))
	if upstreamRef != "" {
		upstreamCommit := strings.TrimSpace(s.readGitOptional(ctx, repo.repoRootReal, "rev-parse", "--verify", upstreamRef))
		if upstreamCommit != "" {
			return upstreamRef, upstreamCommit
		}
	}

	headCommit := strings.TrimSpace(repo.headCommit)
	if headCommit == "" {
		headCommit = strings.TrimSpace(s.readGitOptional(ctx, repo.repoRootReal, "rev-parse", "--verify", "HEAD"))
	}
	return "HEAD", headCommit
}

func (s *Service) readSafeDeleteStatus(ctx context.Context, repoRoot string, localRef string, baseRef string) (bool, string) {
	if strings.TrimSpace(baseRef) == "" {
		return false, "Safe delete cannot be verified because the delete base is unavailable."
	}
	_, err := s.runtime.RunRead(ctx, repoRoot, nil, "merge-base", "--is-ancestor", localRef, baseRef)
	if err != nil {
		var commandErr *gitruntime.CommandError
		if errors.As(err, &commandErr) && !commandErr.UnknownOutcome && !commandErr.BudgetExceeded && commandErr.ExitCode == 1 {
			return false, fmt.Sprintf("Branch is not fully merged into %s.", baseRef)
		}
		return false, "Safe delete cannot be verified because the delete check failed."
	}
	return true, ""
}

func workspaceSummaryHasChanges(summary gitWorkspaceSummary) bool {
	return summary.StagedCount > 0 || summary.UnstagedCount > 0 || summary.UntrackedCount > 0 || summary.ConflictedCount > 0
}

func buildDeleteBranchPlanFingerprint(repo repoContext, plan deleteBranchPlan) string {
	payload := deleteBranchFingerprintPayload{
		LocalName:                   plan.Target.LocalName,
		TargetHeadCommit:            plan.TargetHeadCommit,
		RepoHeadRef:                 repo.headRef,
		RepoHeadCommit:              repo.headCommit,
		SafeDeleteBaseRef:           plan.SafeDeleteBaseRef,
		SafeDeleteBaseCommit:        plan.SafeDeleteBaseCommit,
		SafeDeleteAllowed:           plan.SafeDeleteAllowed,
		SafeDeleteReason:            plan.SafeDeleteReason,
		ForceDeleteAllowed:          plan.ForceDeleteAllowed,
		ForceDeleteRequiresConfirm:  plan.ForceDeleteRequiresConfirm,
		ForceDeleteReason:           plan.ForceDeleteReason,
		BlockingReason:              plan.BlockingReason,
		BlockingCode:                plan.BlockingCode,
		RequiresWorktreeRemoval:     plan.RequiresWorktreeRemoval,
		RequiresDiscardConfirmation: plan.RequiresDiscardConfirmation,
	}
	if plan.LinkedWorktree != nil {
		payload.LinkedWorktree = &deleteBranchFingerprintLinkedWorktree{
			WorktreePath:                    plan.LinkedWorktree.WorktreePath,
			Accessible:                      plan.LinkedWorktree.Accessible,
			Summary:                         plan.LinkedWorktree.Summary,
			DestructiveWorkspaceFingerprint: plan.DestructiveWorkspaceFingerprint,
		}
	}
	data, err := json.Marshal(payload)
	if err != nil {
		sum := sha256.Sum256([]byte(fmt.Sprintf("%+v", payload)))
		return hex.EncodeToString(sum[:])
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
