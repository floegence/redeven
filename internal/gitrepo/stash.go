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
	"strconv"
	"strings"

	"github.com/floegence/redeven-agent/internal/gitutil"
)

const stashBlockerKindApplyConflict = "stash_apply_conflict"

type stashApplyPlan struct {
	RepoRootPath     string
	HeadRef          string
	HeadCommit       string
	WorkspaceSummary gitWorkspaceSummary
	Stash            *gitStashSummary
	RemoveAfterApply bool
	Blocking         *gitMutationBlocker
	BlockingReason   string
	PlanFingerprint  string
}

type stashApplyFingerprintPayload struct {
	RepoRootPath     string              `json:"repo_root_path"`
	HeadRef          string              `json:"head_ref"`
	HeadCommit       string              `json:"head_commit"`
	WorkspaceSummary gitWorkspaceSummary `json:"workspace_summary"`
	StashID          string              `json:"stash_id"`
	StashHeadCommit  string              `json:"stash_head_commit"`
	RemoveAfterApply bool                `json:"remove_after_apply"`
	Blocking         *gitMutationBlocker `json:"blocking,omitempty"`
}

type stashDropPlan struct {
	RepoRootPath    string
	HeadRef         string
	HeadCommit      string
	Stash           *gitStashSummary
	PlanFingerprint string
}

type stashDropFingerprintPayload struct {
	RepoRootPath    string `json:"repo_root_path"`
	HeadRef         string `json:"head_ref"`
	HeadCommit      string `json:"head_commit"`
	StashID         string `json:"stash_id"`
	StashHeadCommit string `json:"stash_head_commit"`
}

func (s *Service) listStashes(ctx context.Context, repo repoContext) (*listStashesResp, error) {
	stashes, err := s.readStashes(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	return &listStashesResp{
		RepoRootPath: repo.repoRootReal,
		Stashes:      stashes,
	}, nil
}

func (s *Service) getStashDetail(ctx context.Context, repo repoContext, id string) (*getStashDetailResp, error) {
	summary, err := s.resolveStashByID(ctx, repo.repoRootReal, id)
	if err != nil {
		return nil, err
	}
	files, err := s.readStashFiles(ctx, repo.repoRootReal, summary.Ref)
	if err != nil {
		return nil, err
	}
	return &getStashDetailResp{
		RepoRootPath: repo.repoRootReal,
		Stash: gitStashDetail{
			gitStashSummary: summary,
			Files:           files,
		},
	}, nil
}

func (s *Service) saveStash(ctx context.Context, repo repoContext, req saveStashReq) (*saveStashResp, error) {
	status, err := s.readWorkspaceStatus(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	if !workspaceSummaryHasChanges(status.Summary()) {
		return nil, errors.New("no local changes to stash")
	}

	args := []string{"stash", "push"}
	if req.IncludeUntracked {
		args = append(args, "--include-untracked")
	}
	if req.KeepIndex {
		args = append(args, "--keep-index")
	}
	if message := strings.TrimSpace(req.Message); message != "" {
		args = append(args, "--message", message)
	}
	if _, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, args...); err != nil {
		return nil, err
	}

	updatedRepo, err := s.loadRepoContext(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	stashes, err := s.readStashes(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}

	var created *gitStashSummary
	if len(stashes) > 0 {
		entry := stashes[0]
		created = &entry
	}

	return &saveStashResp{
		RepoRootPath: updatedRepo.repoRootReal,
		HeadRef:      updatedRepo.headRef,
		HeadCommit:   updatedRepo.headCommit,
		Created:      created,
	}, nil
}

func (s *Service) previewApplyStash(ctx context.Context, repo repoContext, id string, removeAfterApply bool) (*previewApplyStashResp, error) {
	plan, err := s.buildStashApplyPlan(ctx, repo, id, removeAfterApply)
	if err != nil {
		return nil, err
	}
	return &previewApplyStashResp{
		RepoRootPath:     plan.RepoRootPath,
		HeadRef:          plan.HeadRef,
		HeadCommit:       plan.HeadCommit,
		Stash:            plan.Stash,
		RemoveAfterApply: plan.RemoveAfterApply,
		BlockingReason:   plan.BlockingReason,
		Blocking:         plan.Blocking,
		PlanFingerprint:  plan.PlanFingerprint,
	}, nil
}

func (s *Service) applyStash(ctx context.Context, repo repoContext, id string, removeAfterApply bool, planFingerprint string) (*applyStashResp, error) {
	plan, err := s.buildStashApplyPlan(ctx, repo, id, removeAfterApply)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(planFingerprint) == "" {
		return nil, errors.New("stash apply plan fingerprint is required")
	}
	if plan.PlanFingerprint != strings.TrimSpace(planFingerprint) {
		return nil, errors.New("stash apply plan is stale; review the stash again")
	}
	if strings.TrimSpace(plan.BlockingReason) != "" {
		return nil, errors.New(plan.BlockingReason)
	}
	if plan.Stash == nil {
		return nil, errors.New("stash not found")
	}

	if err := s.runApplyStash(ctx, repo.repoRootReal, plan.Stash.Ref); err != nil {
		return nil, err
	}
	if removeAfterApply {
		if _, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, "stash", "drop", plan.Stash.Ref); err != nil {
			return nil, err
		}
	}

	updatedRepo, err := s.loadRepoContext(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	return &applyStashResp{
		RepoRootPath: updatedRepo.repoRootReal,
		HeadRef:      updatedRepo.headRef,
		HeadCommit:   updatedRepo.headCommit,
	}, nil
}

func (s *Service) previewDropStash(ctx context.Context, repo repoContext, id string) (*previewDropStashResp, error) {
	plan, err := s.buildStashDropPlan(ctx, repo, id)
	if err != nil {
		return nil, err
	}
	return &previewDropStashResp{
		RepoRootPath:    plan.RepoRootPath,
		HeadRef:         plan.HeadRef,
		HeadCommit:      plan.HeadCommit,
		Stash:           plan.Stash,
		PlanFingerprint: plan.PlanFingerprint,
	}, nil
}

func (s *Service) dropStash(ctx context.Context, repo repoContext, id string, planFingerprint string) (*dropStashResp, error) {
	plan, err := s.buildStashDropPlan(ctx, repo, id)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(planFingerprint) == "" {
		return nil, errors.New("stash drop plan fingerprint is required")
	}
	if plan.PlanFingerprint != strings.TrimSpace(planFingerprint) {
		return nil, errors.New("stash drop plan is stale; review the stash again")
	}
	if plan.Stash == nil {
		return nil, errors.New("stash not found")
	}
	if _, err := gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, "stash", "drop", plan.Stash.Ref); err != nil {
		return nil, err
	}

	updatedRepo, err := s.loadRepoContext(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	return &dropStashResp{
		RepoRootPath: updatedRepo.repoRootReal,
		HeadRef:      updatedRepo.headRef,
		HeadCommit:   updatedRepo.headCommit,
	}, nil
}

func (s *Service) buildStashApplyPlan(ctx context.Context, repo repoContext, id string, removeAfterApply bool) (stashApplyPlan, error) {
	summary, err := s.resolveStashByID(ctx, repo.repoRootReal, id)
	if err != nil {
		return stashApplyPlan{}, err
	}
	status, err := s.readWorkspaceStatus(ctx, repo.repoRootReal)
	if err != nil {
		return stashApplyPlan{}, err
	}
	plan := stashApplyPlan{
		RepoRootPath:     repo.repoRootReal,
		HeadRef:          strings.TrimSpace(repo.headRef),
		HeadCommit:       strings.TrimSpace(repo.headCommit),
		WorkspaceSummary: status.Summary(),
		Stash:            &summary,
		RemoveAfterApply: removeAfterApply,
	}
	if plan.HeadCommit == "" {
		plan.HeadCommit = strings.TrimSpace(readGitOptional(ctx, repo.repoRootReal, "rev-parse", "--verify", "HEAD"))
	}
	if workspaceSummaryHasChanges(plan.WorkspaceSummary) {
		plan.Blocking = newWorkspaceMutationBlocker("applying a stash", repo.repoRootReal, plan.WorkspaceSummary, false)
		plan.BlockingReason = plan.Blocking.Reason
		plan.PlanFingerprint = buildStashApplyPlanFingerprint(plan)
		return plan, nil
	}
	if operation := readGitOperationState(ctx, repo.repoRootReal); operation != "" {
		plan.Blocking = newOperationMutationBlocker("applying a stash", operation)
		plan.BlockingReason = plan.Blocking.Reason
		plan.PlanFingerprint = buildStashApplyPlanFingerprint(plan)
		return plan, nil
	}
	if reason := s.previewApplyStashInTemporaryWorktree(ctx, repo.repoRootReal, summary.Ref); reason != "" {
		plan.Blocking = &gitMutationBlocker{
			Kind:   stashBlockerKindApplyConflict,
			Reason: reason,
		}
		plan.BlockingReason = reason
	}
	plan.PlanFingerprint = buildStashApplyPlanFingerprint(plan)
	return plan, nil
}

func buildStashApplyPlanFingerprint(plan stashApplyPlan) string {
	payload := stashApplyFingerprintPayload{
		RepoRootPath:     plan.RepoRootPath,
		HeadRef:          plan.HeadRef,
		HeadCommit:       plan.HeadCommit,
		WorkspaceSummary: plan.WorkspaceSummary,
		RemoveAfterApply: plan.RemoveAfterApply,
		Blocking:         plan.Blocking,
	}
	if plan.Stash != nil {
		payload.StashID = plan.Stash.ID
		payload.StashHeadCommit = plan.Stash.HeadCommit
	}
	return hashFingerprintPayload(payload)
}

func (s *Service) buildStashDropPlan(ctx context.Context, repo repoContext, id string) (stashDropPlan, error) {
	summary, err := s.resolveStashByID(ctx, repo.repoRootReal, id)
	if err != nil {
		return stashDropPlan{}, err
	}
	plan := stashDropPlan{
		RepoRootPath: repo.repoRootReal,
		HeadRef:      strings.TrimSpace(repo.headRef),
		HeadCommit:   strings.TrimSpace(repo.headCommit),
		Stash:        &summary,
	}
	if plan.HeadCommit == "" {
		plan.HeadCommit = strings.TrimSpace(readGitOptional(ctx, repo.repoRootReal, "rev-parse", "--verify", "HEAD"))
	}
	plan.PlanFingerprint = buildStashDropPlanFingerprint(plan)
	return plan, nil
}

func buildStashDropPlanFingerprint(plan stashDropPlan) string {
	payload := stashDropFingerprintPayload{
		RepoRootPath: plan.RepoRootPath,
		HeadRef:      plan.HeadRef,
		HeadCommit:   plan.HeadCommit,
	}
	if plan.Stash != nil {
		payload.StashID = plan.Stash.ID
		payload.StashHeadCommit = plan.Stash.HeadCommit
	}
	return hashFingerprintPayload(payload)
}

func hashFingerprintPayload(payload any) string {
	data, err := json.Marshal(payload)
	if err != nil {
		sum := sha256.Sum256([]byte(fmt.Sprintf("%+v", payload)))
		return hex.EncodeToString(sum[:])
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (s *Service) resolveStashByID(ctx context.Context, repoRoot string, id string) (gitStashSummary, error) {
	stashID := strings.TrimSpace(id)
	if stashID == "" {
		return gitStashSummary{}, errors.New("stash id is required")
	}
	stashes, err := s.readStashes(ctx, repoRoot)
	if err != nil {
		return gitStashSummary{}, err
	}
	for _, item := range stashes {
		if item.ID == stashID {
			return item, nil
		}
	}
	return gitStashSummary{}, errors.New("stash not found")
}

func (s *Service) readStashes(ctx context.Context, repoRoot string) ([]gitStashSummary, error) {
	out, err := gitutil.RunCombinedOutput(ctx, repoRoot, nil, "stash", "list", "--format=%H%x00%gd%x00%gs%x00%ct")
	if err != nil {
		return nil, err
	}
	raw := strings.TrimSpace(string(out))
	if raw == "" {
		return nil, nil
	}

	lines := strings.Split(raw, "\n")
	stashes := make([]gitStashSummary, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\x00")
		if len(fields) < 4 {
			continue
		}
		id := strings.TrimSpace(fields[0])
		ref := strings.TrimSpace(fields[1])
		rawMessage := strings.TrimSpace(fields[2])
		createdUnix, _ := strconv.ParseInt(strings.TrimSpace(fields[3]), 10, 64)
		branchName, message := parseStashMessage(rawMessage)
		headCommit := strings.TrimSpace(readGitOptional(ctx, repoRoot, "rev-parse", "--verify", id+"^1"))
		fileCount, err := readStashFileCount(ctx, repoRoot, ref)
		if err != nil {
			return nil, err
		}
		parentCount := readStashParentCount(ctx, repoRoot, id)
		stashes = append(stashes, gitStashSummary{
			ID:              id,
			Ref:             ref,
			Message:         message,
			BranchName:      branchName,
			HeadRef:         branchName,
			HeadCommit:      headCommit,
			CreatedAtUnixMs: createdUnix * 1000,
			FileCount:       fileCount,
			HasUntracked:    parentCount >= 3,
		})
	}
	return stashes, nil
}

func parseStashMessage(raw string) (string, string) {
	value := strings.TrimSpace(raw)
	switch {
	case strings.HasPrefix(value, "On "):
		rest := strings.TrimSpace(strings.TrimPrefix(value, "On "))
		if branch, message, ok := splitStashBranchAndMessage(rest); ok {
			return branch, message
		}
	case strings.HasPrefix(value, "WIP on "):
		rest := strings.TrimSpace(strings.TrimPrefix(value, "WIP on "))
		if branch, message, ok := splitStashBranchAndMessage(rest); ok {
			return branch, message
		}
	}
	return "", value
}

func splitStashBranchAndMessage(raw string) (string, string, bool) {
	parts := strings.SplitN(raw, ":", 2)
	if len(parts) == 0 {
		return "", "", false
	}
	branch := strings.TrimSpace(parts[0])
	message := ""
	if len(parts) > 1 {
		message = strings.TrimSpace(parts[1])
	}
	if branch == "" {
		return "", "", false
	}
	if message == "" {
		message = raw
	}
	return branch, message, true
}

func readStashFileCount(ctx context.Context, repoRoot string, ref string) (int, error) {
	out, err := gitutil.RunCombinedOutput(ctx, repoRoot, nil, "stash", "show", "--name-only", "--include-untracked", ref)
	if err != nil {
		return 0, err
	}
	seen := make(map[string]struct{})
	count := 0
	for _, line := range strings.Split(string(out), "\n") {
		pathValue := strings.TrimSpace(line)
		if pathValue == "" {
			continue
		}
		if _, ok := seen[pathValue]; ok {
			continue
		}
		seen[pathValue] = struct{}{}
		count += 1
	}
	return count, nil
}

func readStashParentCount(ctx context.Context, repoRoot string, id string) int {
	out := strings.TrimSpace(readGitOptional(ctx, repoRoot, "rev-list", "--parents", "-n", "1", id))
	if out == "" {
		return 0
	}
	parts := strings.Fields(out)
	if len(parts) == 0 {
		return 0
	}
	return len(parts) - 1
}

func (s *Service) readStashFiles(ctx context.Context, repoRoot string, ref string) ([]gitCommitFileSummary, error) {
	files, err := s.readGitDiffMetadata(ctx, repoRoot,
		[]string{
			"stash",
			"show",
			"--name-status",
			"-z",
			"--include-untracked",
			"--find-renames",
			"--find-copies",
			"--no-ext-diff",
			ref,
		},
		[]string{
			"stash",
			"show",
			"--numstat",
			"-z",
			"--include-untracked",
			"--find-renames",
			"--find-copies",
			"--no-ext-diff",
			ref,
		},
	)
	if err != nil {
		return nil, err
	}
	return files, nil
}

func (s *Service) previewApplyStashInTemporaryWorktree(ctx context.Context, repoRoot string, ref string) string {
	tempRoot, err := os.MkdirTemp("", "redeven-stash-preview-*")
	if err != nil {
		return "Failed to prepare a temporary stash preview."
	}
	defer os.RemoveAll(tempRoot)

	worktreePath := filepath.Join(tempRoot, "worktree")
	if _, err := gitutil.RunCombinedOutput(ctx, repoRoot, nil, "worktree", "add", "--quiet", "--detach", worktreePath, "HEAD"); err != nil {
		return "Failed to prepare a temporary stash preview."
	}
	defer func() {
		_, _ = gitutil.RunCombinedOutput(context.Background(), repoRoot, nil, "worktree", "remove", "--force", worktreePath)
	}()

	if err := s.runApplyStash(ctx, worktreePath, ref); err != nil {
		return strings.TrimSpace(err.Error())
	}
	return ""
}

func (s *Service) runApplyStash(ctx context.Context, repoRoot string, ref string) error {
	if _, err := gitutil.RunCombinedOutput(ctx, repoRoot, nil, "stash", "apply", "--index", "--quiet", ref); err != nil {
		status, statusErr := s.readWorkspaceStatus(ctx, repoRoot)
		if statusErr == nil && len(status.Conflicted) > 0 {
			return errors.New("this stash cannot be applied cleanly on the current HEAD")
		}
		lower := strings.ToLower(err.Error())
		switch {
		case strings.Contains(lower, "would be overwritten by merge"),
			strings.Contains(lower, "already exists, no checkout"),
			strings.Contains(lower, "could not restore untracked files from stash"):
			return errors.New("current files would be overwritten by this stash")
		case strings.Contains(lower, "conflict"),
			strings.Contains(lower, "patch does not apply"),
			strings.Contains(lower, "could not restore index"):
			return errors.New("this stash cannot be applied cleanly on the current HEAD")
		default:
			return err
		}
	}
	return nil
}
