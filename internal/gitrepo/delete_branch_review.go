package gitrepo

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven-agent/internal/gitutil"
)

type deleteBranchPlan struct {
	Target                      deleteBranchTarget
	LinkedWorktree              *gitDeleteLinkedWorktreePreview
	RequiresWorktreeRemoval     bool
	RequiresDiscardConfirmation bool
	SafeDeleteAllowed           bool
	SafeDeleteBaseRef           string
	SafeDeleteReason            string
	BlockingReason              string
	TargetHeadCommit            string
	SafeDeleteBaseCommit        string
	PlanFingerprint             string
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
	BlockingReason              string                                 `json:"blocking_reason"`
	RequiresWorktreeRemoval     bool                                   `json:"requires_worktree_removal"`
	RequiresDiscardConfirmation bool                                   `json:"requires_discard_confirmation"`
	LinkedWorktree              *deleteBranchFingerprintLinkedWorktree `json:"linked_worktree,omitempty"`
}

type deleteBranchFingerprintLinkedWorktree struct {
	WorktreePath string                         `json:"worktree_path"`
	Accessible   bool                           `json:"accessible"`
	Summary      gitWorkspaceSummary            `json:"summary"`
	Changes      []deleteBranchFingerprintEntry `json:"changes,omitempty"`
}

type deleteBranchFingerprintEntry struct {
	Section    string `json:"section,omitempty"`
	ChangeType string `json:"change_type,omitempty"`
	Path       string `json:"path,omitempty"`
	OldPath    string `json:"old_path,omitempty"`
	NewPath    string `json:"new_path,omitempty"`
	Additions  int    `json:"additions,omitempty"`
	Deletions  int    `json:"deletions,omitempty"`
	IsBinary   bool   `json:"is_binary,omitempty"`
}

func (s *Service) previewDeleteBranch(ctx context.Context, repo repoContext, name string, fullName string, kind string) (*previewDeleteBranchResp, error) {
	target, err := normalizeDeleteBranchTarget(name, fullName, kind)
	if err != nil {
		return nil, err
	}
	plan, err := s.buildDeleteBranchPlan(ctx, repo, target)
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
		BlockingReason:              plan.BlockingReason,
		PlanFingerprint:             plan.PlanFingerprint,
	}, nil
}

func (s *Service) buildDeleteBranchPlan(ctx context.Context, repo repoContext, target deleteBranchTarget) (deleteBranchPlan, error) {
	if strings.TrimSpace(target.LocalName) == "" {
		return deleteBranchPlan{}, errors.New("target branch does not exist")
	}
	if strings.TrimSpace(repo.headRef) == target.LocalName {
		return deleteBranchPlan{}, errors.New("cannot delete the current branch")
	}

	localRef := "refs/heads/" + target.LocalName
	if !gitRefExists(ctx, repo.repoRootReal, localRef) {
		return deleteBranchPlan{}, errors.New("target branch does not exist")
	}

	targetHeadCommit := strings.TrimSpace(readGitOptional(ctx, repo.repoRootReal, "rev-parse", "--verify", localRef))
	linkedWorktree, err := s.readDeleteLinkedWorktreePreview(ctx, repo, localRef)
	if err != nil {
		return deleteBranchPlan{}, err
	}
	safeDeleteBaseRef, safeDeleteBaseCommit := resolveSafeDeleteBase(ctx, repo, target.LocalName)
	safeDeleteAllowed, safeDeleteReason := readSafeDeleteStatus(ctx, repo.repoRootReal, localRef, safeDeleteBaseRef)

	plan := deleteBranchPlan{
		Target:                      target,
		LinkedWorktree:              linkedWorktree,
		RequiresWorktreeRemoval:     linkedWorktree != nil,
		RequiresDiscardConfirmation: linkedWorktree != nil && linkedWorktree.Accessible && workspaceSummaryHasChanges(linkedWorktree.Summary),
		SafeDeleteAllowed:           safeDeleteAllowed,
		SafeDeleteBaseRef:           safeDeleteBaseRef,
		SafeDeleteReason:            safeDeleteReason,
		TargetHeadCommit:            targetHeadCommit,
		SafeDeleteBaseCommit:        safeDeleteBaseCommit,
	}
	if linkedWorktree != nil && !linkedWorktree.Accessible {
		plan.BlockingReason = fmt.Sprintf("Linked worktree %s is not accessible from this agent.", linkedWorktree.WorktreePath)
	}
	plan.PlanFingerprint = buildDeleteBranchPlanFingerprint(repo, plan)
	return plan, nil
}

func (s *Service) readDeleteLinkedWorktreePreview(ctx context.Context, repo repoContext, localRef string) (*gitDeleteLinkedWorktreePreview, error) {
	bindings, err := readWorktreeBindings(ctx, repo.repoRootReal)
	if err != nil {
		return nil, nil
	}
	binding, ok := bindings[localRef]
	if !ok {
		return nil, nil
	}
	worktreePath := filepath.Clean(strings.TrimSpace(binding.Path))
	if worktreePath == "" || worktreePath == filepath.Clean(repo.repoRootReal) {
		return nil, nil
	}

	repoRootReal, err := s.validateRepoRootPath(ctx, worktreePath)
	if err != nil {
		return &gitDeleteLinkedWorktreePreview{
			WorktreePath: worktreePath,
			Accessible:   false,
			Summary:      gitWorkspaceSummary{},
		}, nil
	}
	snapshot, err := s.readLinkedWorktreeSnapshot(ctx, repoRootReal)
	if err != nil {
		return nil, err
	}
	return &gitDeleteLinkedWorktreePreview{
		WorktreePath: snapshot.WorktreePath,
		Accessible:   true,
		Summary:      snapshot.Summary,
		Staged:       snapshot.Staged,
		Unstaged:     snapshot.Unstaged,
		Untracked:    snapshot.Untracked,
		Conflicted:   snapshot.Conflicted,
	}, nil
}

func resolveSafeDeleteBase(ctx context.Context, repo repoContext, localName string) (string, string) {
	upstreamRef := strings.TrimSpace(readGitOptional(
		ctx,
		repo.repoRootReal,
		"for-each-ref",
		"--format=%(upstream:short)",
		"refs/heads/"+localName,
	))
	if upstreamRef != "" {
		upstreamCommit := strings.TrimSpace(readGitOptional(ctx, repo.repoRootReal, "rev-parse", "--verify", upstreamRef))
		if upstreamCommit != "" {
			return upstreamRef, upstreamCommit
		}
	}

	headCommit := strings.TrimSpace(repo.headCommit)
	if headCommit == "" {
		headCommit = strings.TrimSpace(readGitOptional(ctx, repo.repoRootReal, "rev-parse", "--verify", "HEAD"))
	}
	return "HEAD", headCommit
}

func readSafeDeleteStatus(ctx context.Context, repoRoot string, localRef string, baseRef string) (bool, string) {
	if strings.TrimSpace(baseRef) == "" {
		return false, "Safe delete cannot be verified because the delete base is unavailable."
	}
	cmd, err := gitutil.CommandContext(ctx, repoRoot, nil, "merge-base", "--is-ancestor", localRef, baseRef)
	if err != nil {
		return false, "Safe delete cannot be verified because the delete check could not be started."
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && exitErr.ExitCode() == 1 {
			return false, fmt.Sprintf("Branch is not fully merged into %s.", baseRef)
		}
		msg := strings.TrimSpace(string(out))
		if msg != "" {
			return false, msg
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
		BlockingReason:              plan.BlockingReason,
		RequiresWorktreeRemoval:     plan.RequiresWorktreeRemoval,
		RequiresDiscardConfirmation: plan.RequiresDiscardConfirmation,
	}
	if plan.LinkedWorktree != nil {
		payload.LinkedWorktree = &deleteBranchFingerprintLinkedWorktree{
			WorktreePath: plan.LinkedWorktree.WorktreePath,
			Accessible:   plan.LinkedWorktree.Accessible,
			Summary:      plan.LinkedWorktree.Summary,
			Changes:      flattenDeleteBranchFingerprintChanges(plan.LinkedWorktree),
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

func flattenDeleteBranchFingerprintChanges(worktree *gitDeleteLinkedWorktreePreview) []deleteBranchFingerprintEntry {
	if worktree == nil {
		return nil
	}
	out := make([]deleteBranchFingerprintEntry, 0, len(worktree.Staged)+len(worktree.Unstaged)+len(worktree.Untracked)+len(worktree.Conflicted))
	appendItems := func(items []gitWorkspaceChange) {
		for _, item := range items {
			out = append(out, deleteBranchFingerprintEntry{
				Section:    item.Section,
				ChangeType: item.ChangeType,
				Path:       item.Path,
				OldPath:    item.OldPath,
				NewPath:    item.NewPath,
				Additions:  item.Additions,
				Deletions:  item.Deletions,
				IsBinary:   item.IsBinary,
			})
		}
	}
	appendItems(worktree.Staged)
	appendItems(worktree.Unstaged)
	appendItems(worktree.Untracked)
	appendItems(worktree.Conflicted)
	return out
}
