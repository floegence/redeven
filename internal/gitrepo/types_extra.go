package gitrepo

type getRepoSummaryReq struct {
	RepoRootPath string `json:"repo_root_path"`
}

type gitWorkspaceSummary struct {
	StagedCount     int `json:"staged_count,omitempty"`
	UnstagedCount   int `json:"unstaged_count,omitempty"`
	UntrackedCount  int `json:"untracked_count,omitempty"`
	ConflictedCount int `json:"conflicted_count,omitempty"`
}

type gitMutationBlocker struct {
	Kind              string              `json:"kind,omitempty"`
	Reason            string              `json:"reason,omitempty"`
	WorkspacePath     string              `json:"workspace_path,omitempty"`
	WorkspaceSummary  gitWorkspaceSummary `json:"workspace_summary"`
	Operation         string              `json:"operation,omitempty"`
	CanStashWorkspace bool                `json:"can_stash_workspace,omitempty"`
}

type getRepoSummaryResp struct {
	RepoRootPath     string              `json:"repo_root_path"`
	WorktreePath     string              `json:"worktree_path,omitempty"`
	IsWorktree       bool                `json:"is_worktree,omitempty"`
	HeadRef          string              `json:"head_ref,omitempty"`
	HeadCommit       string              `json:"head_commit,omitempty"`
	Detached         bool                `json:"detached,omitempty"`
	ReattachBranch   *gitBranchSummary   `json:"reattach_branch,omitempty"`
	UpstreamRef      string              `json:"upstream_ref,omitempty"`
	AheadCount       int                 `json:"ahead_count,omitempty"`
	BehindCount      int                 `json:"behind_count,omitempty"`
	StashCount       int                 `json:"stash_count,omitempty"`
	WorkspaceSummary gitWorkspaceSummary `json:"workspace_summary"`
}

type gitDiffFileSummary struct {
	ChangeType  string `json:"change_type,omitempty"`
	Path        string `json:"path,omitempty"`
	OldPath     string `json:"old_path,omitempty"`
	NewPath     string `json:"new_path,omitempty"`
	DisplayPath string `json:"display_path,omitempty"`
	Additions   int    `json:"additions,omitempty"`
	Deletions   int    `json:"deletions,omitempty"`
	IsBinary    bool   `json:"is_binary,omitempty"`
}

type gitDiffFileContent struct {
	gitDiffFileSummary
	PatchText      string `json:"patch_text,omitempty"`
	PatchTruncated bool   `json:"patch_truncated,omitempty"`
}

type gitWorkspaceChange struct {
	Section string `json:"section,omitempty"`
	gitDiffFileSummary
}

type listWorkspaceChangesReq struct {
	RepoRootPath string `json:"repo_root_path"`
}

type listWorkspaceChangesResp struct {
	RepoRootPath string               `json:"repo_root_path"`
	Summary      gitWorkspaceSummary  `json:"summary"`
	Staged       []gitWorkspaceChange `json:"staged,omitempty"`
	Unstaged     []gitWorkspaceChange `json:"unstaged,omitempty"`
	Untracked    []gitWorkspaceChange `json:"untracked,omitempty"`
	Conflicted   []gitWorkspaceChange `json:"conflicted,omitempty"`
}

type listWorkspacePageReq struct {
	RepoRootPath string `json:"repo_root_path"`
	Section      string `json:"section,omitempty"`
	Offset       int    `json:"offset,omitempty"`
	Limit        int    `json:"limit,omitempty"`
}

type listWorkspacePageResp struct {
	RepoRootPath string               `json:"repo_root_path"`
	Section      string               `json:"section,omitempty"`
	Summary      gitWorkspaceSummary  `json:"summary"`
	TotalCount   int                  `json:"total_count,omitempty"`
	Offset       int                  `json:"offset,omitempty"`
	NextOffset   int                  `json:"next_offset,omitempty"`
	HasMore      bool                 `json:"has_more,omitempty"`
	Items        []gitWorkspaceChange `json:"items,omitempty"`
}

type listStashesReq struct {
	RepoRootPath string `json:"repo_root_path"`
}

type gitStashSummary struct {
	ID              string `json:"id"`
	Ref             string `json:"ref,omitempty"`
	Message         string `json:"message,omitempty"`
	BranchName      string `json:"branch_name,omitempty"`
	HeadRef         string `json:"head_ref,omitempty"`
	HeadCommit      string `json:"head_commit,omitempty"`
	CreatedAtUnixMs int64  `json:"created_at_unix_ms,omitempty"`
	FileCount       int    `json:"file_count,omitempty"`
	HasUntracked    bool   `json:"has_untracked,omitempty"`
}

type listStashesResp struct {
	RepoRootPath string            `json:"repo_root_path"`
	Stashes      []gitStashSummary `json:"stashes,omitempty"`
}

type getStashDetailReq struct {
	RepoRootPath string `json:"repo_root_path"`
	ID           string `json:"id"`
}

type gitStashDetail struct {
	gitStashSummary
	Files []gitCommitFileSummary `json:"files,omitempty"`
}

type getStashDetailResp struct {
	RepoRootPath string         `json:"repo_root_path"`
	Stash        gitStashDetail `json:"stash"`
}

type saveStashReq struct {
	RepoRootPath     string `json:"repo_root_path"`
	Message          string `json:"message,omitempty"`
	IncludeUntracked bool   `json:"include_untracked,omitempty"`
	KeepIndex        bool   `json:"keep_index,omitempty"`
}

type saveStashResp struct {
	RepoRootPath string           `json:"repo_root_path"`
	HeadRef      string           `json:"head_ref,omitempty"`
	HeadCommit   string           `json:"head_commit,omitempty"`
	Created      *gitStashSummary `json:"created,omitempty"`
}

type previewApplyStashReq struct {
	RepoRootPath     string `json:"repo_root_path"`
	ID               string `json:"id"`
	RemoveAfterApply bool   `json:"remove_after_apply,omitempty"`
}

type previewApplyStashResp struct {
	RepoRootPath     string              `json:"repo_root_path"`
	HeadRef          string              `json:"head_ref,omitempty"`
	HeadCommit       string              `json:"head_commit,omitempty"`
	Stash            *gitStashSummary    `json:"stash,omitempty"`
	RemoveAfterApply bool                `json:"remove_after_apply,omitempty"`
	BlockingReason   string              `json:"blocking_reason,omitempty"`
	Blocking         *gitMutationBlocker `json:"blocking,omitempty"`
	PlanFingerprint  string              `json:"plan_fingerprint,omitempty"`
}

type applyStashReq struct {
	RepoRootPath     string `json:"repo_root_path"`
	ID               string `json:"id"`
	RemoveAfterApply bool   `json:"remove_after_apply,omitempty"`
	PlanFingerprint  string `json:"plan_fingerprint,omitempty"`
}

type applyStashResp struct {
	RepoRootPath string `json:"repo_root_path"`
	HeadRef      string `json:"head_ref,omitempty"`
	HeadCommit   string `json:"head_commit,omitempty"`
}

type previewDropStashReq struct {
	RepoRootPath string `json:"repo_root_path"`
	ID           string `json:"id"`
}

type previewDropStashResp struct {
	RepoRootPath    string           `json:"repo_root_path"`
	HeadRef         string           `json:"head_ref,omitempty"`
	HeadCommit      string           `json:"head_commit,omitempty"`
	Stash           *gitStashSummary `json:"stash,omitempty"`
	PlanFingerprint string           `json:"plan_fingerprint,omitempty"`
}

type dropStashReq struct {
	RepoRootPath    string `json:"repo_root_path"`
	ID              string `json:"id"`
	PlanFingerprint string `json:"plan_fingerprint,omitempty"`
}

type dropStashResp struct {
	RepoRootPath string `json:"repo_root_path"`
	HeadRef      string `json:"head_ref,omitempty"`
	HeadCommit   string `json:"head_commit,omitempty"`
}

type fetchRepoReq struct {
	RepoRootPath string `json:"repo_root_path"`
}

type fetchRepoResp struct {
	RepoRootPath string `json:"repo_root_path"`
	HeadRef      string `json:"head_ref,omitempty"`
	HeadCommit   string `json:"head_commit,omitempty"`
}

type pullRepoReq struct {
	RepoRootPath string `json:"repo_root_path"`
}

type pullRepoResp struct {
	RepoRootPath string `json:"repo_root_path"`
	HeadRef      string `json:"head_ref,omitempty"`
	HeadCommit   string `json:"head_commit,omitempty"`
}

type pushRepoReq struct {
	RepoRootPath string `json:"repo_root_path"`
}

type pushRepoResp struct {
	RepoRootPath string `json:"repo_root_path"`
	HeadRef      string `json:"head_ref,omitempty"`
	HeadCommit   string `json:"head_commit,omitempty"`
}

type checkoutBranchReq struct {
	RepoRootPath string `json:"repo_root_path"`
	Name         string `json:"name,omitempty"`
	FullName     string `json:"full_name,omitempty"`
	Kind         string `json:"kind,omitempty"`
}

type checkoutBranchResp struct {
	RepoRootPath string `json:"repo_root_path"`
	HeadRef      string `json:"head_ref,omitempty"`
	HeadCommit   string `json:"head_commit,omitempty"`
}

type switchDetachedReq struct {
	RepoRootPath string `json:"repo_root_path"`
	TargetRef    string `json:"target_ref"`
}

type switchDetachedResp struct {
	RepoRootPath string `json:"repo_root_path"`
	HeadRef      string `json:"head_ref,omitempty"`
	HeadCommit   string `json:"head_commit,omitempty"`
	Detached     bool   `json:"detached,omitempty"`
}

type previewDeleteBranchReq struct {
	RepoRootPath string `json:"repo_root_path"`
	Name         string `json:"name,omitempty"`
	FullName     string `json:"full_name,omitempty"`
	Kind         string `json:"kind,omitempty"`
}

type gitDeleteLinkedWorktreePreview struct {
	WorktreePath string               `json:"worktree_path,omitempty"`
	Accessible   bool                 `json:"accessible"`
	Summary      gitWorkspaceSummary  `json:"summary"`
	Staged       []gitWorkspaceChange `json:"staged,omitempty"`
	Unstaged     []gitWorkspaceChange `json:"unstaged,omitempty"`
	Untracked    []gitWorkspaceChange `json:"untracked,omitempty"`
	Conflicted   []gitWorkspaceChange `json:"conflicted,omitempty"`
}

type previewDeleteBranchResp struct {
	RepoRootPath                string                          `json:"repo_root_path"`
	Name                        string                          `json:"name,omitempty"`
	FullName                    string                          `json:"full_name,omitempty"`
	Kind                        string                          `json:"kind,omitempty"`
	LinkedWorktree              *gitDeleteLinkedWorktreePreview `json:"linked_worktree,omitempty"`
	RequiresWorktreeRemoval     bool                            `json:"requires_worktree_removal"`
	RequiresDiscardConfirmation bool                            `json:"requires_discard_confirmation"`
	SafeDeleteAllowed           bool                            `json:"safe_delete_allowed"`
	SafeDeleteBaseRef           string                          `json:"safe_delete_base_ref,omitempty"`
	SafeDeleteReason            string                          `json:"safe_delete_reason,omitempty"`
	ForceDeleteAllowed          bool                            `json:"force_delete_allowed"`
	ForceDeleteRequiresConfirm  bool                            `json:"force_delete_requires_confirm"`
	ForceDeleteReason           string                          `json:"force_delete_reason,omitempty"`
	BlockingReason              string                          `json:"blocking_reason,omitempty"`
	PlanFingerprint             string                          `json:"plan_fingerprint,omitempty"`
}

type deleteBranchReq struct {
	RepoRootPath                 string `json:"repo_root_path"`
	Name                         string `json:"name,omitempty"`
	FullName                     string `json:"full_name,omitempty"`
	Kind                         string `json:"kind,omitempty"`
	DeleteMode                   string `json:"delete_mode,omitempty"`
	ConfirmBranchName            string `json:"confirm_branch_name,omitempty"`
	RemoveLinkedWorktree         bool   `json:"remove_linked_worktree"`
	DiscardLinkedWorktreeChanges bool   `json:"discard_linked_worktree_changes"`
	PlanFingerprint              string `json:"plan_fingerprint,omitempty"`
}

type deleteBranchResp struct {
	RepoRootPath          string `json:"repo_root_path"`
	HeadRef               string `json:"head_ref,omitempty"`
	HeadCommit            string `json:"head_commit,omitempty"`
	LinkedWorktreeRemoved bool   `json:"linked_worktree_removed"`
	RemovedWorktreePath   string `json:"removed_worktree_path,omitempty"`
}

type previewMergeBranchReq struct {
	RepoRootPath string `json:"repo_root_path"`
	Name         string `json:"name,omitempty"`
	FullName     string `json:"full_name,omitempty"`
	Kind         string `json:"kind,omitempty"`
}

type previewMergeBranchResp struct {
	RepoRootPath      string                     `json:"repo_root_path"`
	CurrentRef        string                     `json:"current_ref,omitempty"`
	CurrentCommit     string                     `json:"current_commit,omitempty"`
	SourceName        string                     `json:"source_name,omitempty"`
	SourceFullName    string                     `json:"source_full_name,omitempty"`
	SourceKind        string                     `json:"source_kind,omitempty"`
	SourceCommit      string                     `json:"source_commit,omitempty"`
	MergeBase         string                     `json:"merge_base,omitempty"`
	SourceAheadCount  int                        `json:"source_ahead_count,omitempty"`
	SourceBehindCount int                        `json:"source_behind_count,omitempty"`
	Outcome           string                     `json:"outcome,omitempty"`
	BlockingReason    string                     `json:"blocking_reason,omitempty"`
	Blocking          *gitMutationBlocker        `json:"blocking,omitempty"`
	PlanFingerprint   string                     `json:"plan_fingerprint,omitempty"`
	Files             []gitCommitFileSummary     `json:"files,omitempty"`
	LinkedWorktree    *gitLinkedWorktreeSnapshot `json:"linked_worktree,omitempty"`
}

type mergeBranchReq struct {
	RepoRootPath    string `json:"repo_root_path"`
	Name            string `json:"name,omitempty"`
	FullName        string `json:"full_name,omitempty"`
	Kind            string `json:"kind,omitempty"`
	PlanFingerprint string `json:"plan_fingerprint,omitempty"`
}

type mergeBranchResp struct {
	RepoRootPath    string              `json:"repo_root_path"`
	HeadRef         string              `json:"head_ref,omitempty"`
	HeadCommit      string              `json:"head_commit,omitempty"`
	Result          string              `json:"result,omitempty"`
	ConflictSummary gitWorkspaceSummary `json:"conflict_summary,omitempty"`
}

type listBranchesReq struct {
	RepoRootPath string `json:"repo_root_path"`
}

type gitBranchSummary struct {
	Name         string `json:"name,omitempty"`
	FullName     string `json:"full_name,omitempty"`
	Kind         string `json:"kind,omitempty"`
	HeadCommit   string `json:"head_commit,omitempty"`
	AuthorName   string `json:"author_name,omitempty"`
	AuthorTimeMs int64  `json:"author_time_ms,omitempty"`
	Subject      string `json:"subject,omitempty"`
	UpstreamRef  string `json:"upstream_ref,omitempty"`
	AheadCount   int    `json:"ahead_count,omitempty"`
	BehindCount  int    `json:"behind_count,omitempty"`
	UpstreamGone bool   `json:"upstream_gone,omitempty"`
	Current      bool   `json:"current,omitempty"`
	WorktreePath string `json:"worktree_path,omitempty"`
}

type listBranchesResp struct {
	RepoRootPath string             `json:"repo_root_path"`
	CurrentRef   string             `json:"current_ref,omitempty"`
	Detached     bool               `json:"detached,omitempty"`
	Local        []gitBranchSummary `json:"local,omitempty"`
	Remote       []gitBranchSummary `json:"remote,omitempty"`
}

type getBranchCompareReq struct {
	RepoRootPath string `json:"repo_root_path"`
	BaseRef      string `json:"base_ref"`
	TargetRef    string `json:"target_ref"`
	Limit        int    `json:"limit,omitempty"`
}

type gitLinkedWorktreeSnapshot struct {
	WorktreePath string               `json:"worktree_path,omitempty"`
	Summary      gitWorkspaceSummary  `json:"summary"`
	Staged       []gitWorkspaceChange `json:"staged,omitempty"`
	Unstaged     []gitWorkspaceChange `json:"unstaged,omitempty"`
	Untracked    []gitWorkspaceChange `json:"untracked,omitempty"`
	Conflicted   []gitWorkspaceChange `json:"conflicted,omitempty"`
}

type getBranchCompareResp struct {
	RepoRootPath      string                     `json:"repo_root_path"`
	BaseRef           string                     `json:"base_ref"`
	TargetRef         string                     `json:"target_ref"`
	MergeBase         string                     `json:"merge_base,omitempty"`
	TargetAheadCount  int                        `json:"target_ahead_count,omitempty"`
	TargetBehindCount int                        `json:"target_behind_count,omitempty"`
	Commits           []gitCommitSummary         `json:"commits,omitempty"`
	Files             []gitCommitFileSummary     `json:"files,omitempty"`
	LinkedWorktree    *gitLinkedWorktreeSnapshot `json:"linked_worktree,omitempty"`
}

type gitDiffFileRef struct {
	ChangeType string `json:"change_type,omitempty"`
	Path       string `json:"path,omitempty"`
	OldPath    string `json:"old_path,omitempty"`
	NewPath    string `json:"new_path,omitempty"`
}

type getDiffContentReq struct {
	RepoRootPath     string         `json:"repo_root_path"`
	SourceKind       string         `json:"source_kind"`
	WorkspaceSection string         `json:"workspace_section,omitempty"`
	Commit           string         `json:"commit,omitempty"`
	BaseRef          string         `json:"base_ref,omitempty"`
	TargetRef        string         `json:"target_ref,omitempty"`
	StashID          string         `json:"stash_id,omitempty"`
	Mode             string         `json:"mode,omitempty"`
	File             gitDiffFileRef `json:"file"`
}

type getDiffContentResp struct {
	RepoRootPath string             `json:"repo_root_path"`
	Mode         string             `json:"mode,omitempty"`
	File         gitDiffFileContent `json:"file"`
}

type gitCommitFileSummary = gitDiffFileSummary
