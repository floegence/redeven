package gitrepo

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	mergeBranchOutcomeBlocked     = "blocked"
	mergeBranchOutcomeUpToDate    = "up_to_date"
	mergeBranchOutcomeFastForward = "fast_forward"
	mergeBranchOutcomeMergeCommit = "merge_commit"
	mergeBranchResultConflicted   = "conflicted"
)

type mergeBranchTarget struct {
	Name     string
	FullName string
	Kind     string
	MergeRef string
}

type mergeBranchPlan struct {
	Source            mergeBranchTarget
	CurrentRef        string
	CurrentCommit     string
	SourceCommit      string
	MergeBase         string
	SourceAheadCount  int
	SourceBehindCount int
	Outcome           string
	BlockingReason    string
	WorkspaceSummary  gitWorkspaceSummary
	Files             []gitCommitFileSummary
	LinkedWorktree    *gitLinkedWorktreeSnapshot
	PlanFingerprint   string
}

type mergeBranchFingerprintPayload struct {
	CurrentRef        string              `json:"current_ref"`
	CurrentCommit     string              `json:"current_commit"`
	SourceFullName    string              `json:"source_full_name"`
	SourceKind        string              `json:"source_kind"`
	SourceCommit      string              `json:"source_commit"`
	MergeBase         string              `json:"merge_base"`
	SourceAheadCount  int                 `json:"source_ahead_count"`
	SourceBehindCount int                 `json:"source_behind_count"`
	Outcome           string              `json:"outcome"`
	BlockingReason    string              `json:"blocking_reason"`
	WorkspaceSummary  gitWorkspaceSummary `json:"workspace_summary"`
}

func (s *Service) previewMergeBranch(ctx context.Context, repo repoContext, name string, fullName string, kind string) (*previewMergeBranchResp, error) {
	target, err := normalizeMergeBranchTarget(name, fullName, kind)
	if err != nil {
		return nil, err
	}
	plan, err := s.buildMergeBranchPlan(ctx, repo, target)
	if err != nil {
		return nil, err
	}
	return &previewMergeBranchResp{
		RepoRootPath:      repo.repoRootReal,
		CurrentRef:        plan.CurrentRef,
		CurrentCommit:     plan.CurrentCommit,
		SourceName:        plan.Source.Name,
		SourceFullName:    plan.Source.FullName,
		SourceKind:        plan.Source.Kind,
		SourceCommit:      plan.SourceCommit,
		MergeBase:         plan.MergeBase,
		SourceAheadCount:  plan.SourceAheadCount,
		SourceBehindCount: plan.SourceBehindCount,
		Outcome:           plan.Outcome,
		BlockingReason:    plan.BlockingReason,
		PlanFingerprint:   plan.PlanFingerprint,
		Files:             plan.Files,
		LinkedWorktree:    plan.LinkedWorktree,
	}, nil
}

func (s *Service) buildMergeBranchPlan(ctx context.Context, repo repoContext, target mergeBranchTarget) (mergeBranchPlan, error) {
	if strings.TrimSpace(target.FullName) == "" {
		return mergeBranchPlan{}, errors.New("target branch does not exist")
	}
	if !gitRefExists(ctx, repo.repoRootReal, target.FullName) {
		return mergeBranchPlan{}, errors.New("target branch does not exist")
	}

	status, err := s.readWorkspaceStatus(ctx, repo.repoRootReal)
	if err != nil {
		return mergeBranchPlan{}, err
	}
	plan := mergeBranchPlan{
		Source:           target,
		CurrentRef:       strings.TrimSpace(repo.headRef),
		CurrentCommit:    strings.TrimSpace(repo.headCommit),
		SourceCommit:     strings.TrimSpace(readGitOptional(ctx, repo.repoRootReal, "rev-parse", "--verify", target.FullName)),
		WorkspaceSummary: status.Summary(),
	}

	if plan.CurrentRef == "" || plan.CurrentRef == "HEAD" {
		plan.Outcome = mergeBranchOutcomeBlocked
		plan.BlockingReason = "Attach HEAD to a local branch before merging."
		plan.PlanFingerprint = buildMergeBranchPlanFingerprint(plan)
		return plan, nil
	}
	if plan.CurrentCommit == "" {
		plan.CurrentCommit = strings.TrimSpace(readGitOptional(ctx, repo.repoRootReal, "rev-parse", "--verify", "HEAD"))
	}
	if plan.CurrentRef == target.Name || target.FullName == "refs/heads/"+plan.CurrentRef {
		plan.Outcome = mergeBranchOutcomeBlocked
		plan.BlockingReason = "Select a different branch to merge into the current branch."
		plan.PlanFingerprint = buildMergeBranchPlanFingerprint(plan)
		return plan, nil
	}
	if workspaceSummaryHasChanges(plan.WorkspaceSummary) {
		plan.Outcome = mergeBranchOutcomeBlocked
		plan.BlockingReason = formatWorkspaceBlockedReason("merging", plan.WorkspaceSummary)
		plan.PlanFingerprint = buildMergeBranchPlanFingerprint(plan)
		return plan, nil
	}
	if operation := readGitOperationState(ctx, repo.repoRootReal); operation != "" {
		plan.Outcome = mergeBranchOutcomeBlocked
		plan.BlockingReason = formatOperationBlockedReason("merging another branch", operation)
		plan.PlanFingerprint = buildMergeBranchPlanFingerprint(plan)
		return plan, nil
	}

	mergeBase := strings.TrimSpace(readGitOptional(ctx, repo.repoRootReal, "merge-base", plan.CurrentRef, target.MergeRef))
	plan.MergeBase = mergeBase
	if plan.SourceCommit == "" {
		plan.Outcome = mergeBranchOutcomeBlocked
		plan.BlockingReason = "Target branch does not have a readable head commit."
		plan.PlanFingerprint = buildMergeBranchPlanFingerprint(plan)
		return plan, nil
	}
	if plan.CurrentCommit == plan.SourceCommit {
		plan.Outcome = mergeBranchOutcomeUpToDate
		plan.PlanFingerprint = buildMergeBranchPlanFingerprint(plan)
		return plan, nil
	}
	if plan.MergeBase == "" {
		plan.Outcome = mergeBranchOutcomeBlocked
		plan.BlockingReason = "This merge requires unrelated histories support, which is not available here."
		plan.PlanFingerprint = buildMergeBranchPlanFingerprint(plan)
		return plan, nil
	}

	compare, err := s.getBranchCompare(ctx, repo, plan.CurrentRef, target.MergeRef, defaultBranchCompareLimit)
	if err != nil {
		return mergeBranchPlan{}, err
	}
	plan.MergeBase = compare.MergeBase
	plan.SourceAheadCount = compare.TargetAheadCount
	plan.SourceBehindCount = compare.TargetBehindCount
	plan.Files = compare.Files
	plan.LinkedWorktree = compare.LinkedWorktree

	switch {
	case plan.MergeBase == plan.SourceCommit:
		plan.Outcome = mergeBranchOutcomeUpToDate
	case plan.MergeBase == plan.CurrentCommit:
		plan.Outcome = mergeBranchOutcomeFastForward
	default:
		plan.Outcome = mergeBranchOutcomeMergeCommit
	}
	plan.PlanFingerprint = buildMergeBranchPlanFingerprint(plan)
	return plan, nil
}

func normalizeMergeBranchTarget(name string, fullName string, kind string) (mergeBranchTarget, error) {
	fullName = strings.TrimSpace(fullName)
	switch {
	case strings.HasPrefix(fullName, "refs/heads/"):
		localName, err := normalizeGitRef(strings.TrimPrefix(fullName, "refs/heads/"))
		if err != nil {
			return mergeBranchTarget{}, err
		}
		return mergeBranchTarget{
			Name:     localName,
			FullName: "refs/heads/" + localName,
			Kind:     "local",
			MergeRef: localName,
		}, nil
	case strings.HasPrefix(fullName, "refs/remotes/"):
		remoteName, err := normalizeGitRef(strings.TrimPrefix(fullName, "refs/remotes/"))
		if err != nil {
			return mergeBranchTarget{}, err
		}
		return mergeBranchTarget{
			Name:     remoteName,
			FullName: "refs/remotes/" + remoteName,
			Kind:     "remote",
			MergeRef: remoteName,
		}, nil
	}

	switch strings.TrimSpace(kind) {
	case "remote":
		remoteName, err := normalizeGitRef(name)
		if err != nil {
			return mergeBranchTarget{}, err
		}
		return mergeBranchTarget{
			Name:     remoteName,
			FullName: "refs/remotes/" + remoteName,
			Kind:     "remote",
			MergeRef: remoteName,
		}, nil
	default:
		localName, err := normalizeGitRef(name)
		if err != nil {
			return mergeBranchTarget{}, err
		}
		return mergeBranchTarget{
			Name:     localName,
			FullName: "refs/heads/" + localName,
			Kind:     "local",
			MergeRef: localName,
		}, nil
	}
}

func buildMergeBranchPlanFingerprint(plan mergeBranchPlan) string {
	payload := mergeBranchFingerprintPayload{
		CurrentRef:        plan.CurrentRef,
		CurrentCommit:     plan.CurrentCommit,
		SourceFullName:    plan.Source.FullName,
		SourceKind:        plan.Source.Kind,
		SourceCommit:      plan.SourceCommit,
		MergeBase:         plan.MergeBase,
		SourceAheadCount:  plan.SourceAheadCount,
		SourceBehindCount: plan.SourceBehindCount,
		Outcome:           plan.Outcome,
		BlockingReason:    plan.BlockingReason,
		WorkspaceSummary:  plan.WorkspaceSummary,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		sum := sha256.Sum256([]byte(fmt.Sprintf("%+v", payload)))
		return hex.EncodeToString(sum[:])
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func readGitOperationState(ctx context.Context, repoRoot string) string {
	checks := []struct {
		Path  string
		State string
	}{
		{Path: "MERGE_HEAD", State: "merge"},
		{Path: "rebase-merge", State: "rebase"},
		{Path: "rebase-apply", State: "rebase"},
		{Path: "CHERRY_PICK_HEAD", State: "cherry-pick"},
		{Path: "REVERT_HEAD", State: "revert"},
	}
	for _, check := range checks {
		gitPath := strings.TrimSpace(readGitOptional(ctx, repoRoot, "rev-parse", "--git-path", check.Path))
		if gitPath == "" {
			continue
		}
		if !filepath.IsAbs(gitPath) {
			gitPath = filepath.Join(repoRoot, filepath.Clean(gitPath))
		}
		if _, err := os.Stat(gitPath); err == nil {
			return check.State
		}
	}
	return ""
}
