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

type getRepoSummaryResp struct {
	RepoRootPath     string              `json:"repo_root_path"`
	WorktreePath     string              `json:"worktree_path,omitempty"`
	IsWorktree       bool                `json:"is_worktree,omitempty"`
	HeadRef          string              `json:"head_ref,omitempty"`
	HeadCommit       string              `json:"head_commit,omitempty"`
	Detached         bool                `json:"detached,omitempty"`
	UpstreamRef      string              `json:"upstream_ref,omitempty"`
	AheadCount       int                 `json:"ahead_count,omitempty"`
	BehindCount      int                 `json:"behind_count,omitempty"`
	StashCount       int                 `json:"stash_count,omitempty"`
	WorkspaceSummary gitWorkspaceSummary `json:"workspace_summary"`
}

type gitWorkspaceChange struct {
	Section    string `json:"section,omitempty"`
	ChangeType string `json:"change_type,omitempty"`
	Path       string `json:"path,omitempty"`
	OldPath    string `json:"old_path,omitempty"`
	NewPath    string `json:"new_path,omitempty"`
	PatchPath  string `json:"patch_path,omitempty"`
	Additions  int    `json:"additions,omitempty"`
	Deletions  int    `json:"deletions,omitempty"`
	IsBinary   bool   `json:"is_binary,omitempty"`
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

type getBranchCompareResp struct {
	RepoRootPath      string                 `json:"repo_root_path"`
	BaseRef           string                 `json:"base_ref"`
	TargetRef         string                 `json:"target_ref"`
	MergeBase         string                 `json:"merge_base,omitempty"`
	TargetAheadCount  int                    `json:"target_ahead_count,omitempty"`
	TargetBehindCount int                    `json:"target_behind_count,omitempty"`
	Commits           []gitCommitSummary     `json:"commits,omitempty"`
	Files             []gitCommitFileSummary `json:"files,omitempty"`
}

type readWorkspacePatchReq struct {
	RepoRootPath string `json:"repo_root_path"`
	Section      string `json:"section"`
	FilePath     string `json:"file_path,omitempty"`
	MaxBytes     int64  `json:"max_bytes,omitempty"`
}

type readComparePatchReq struct {
	RepoRootPath string `json:"repo_root_path"`
	BaseRef      string `json:"base_ref"`
	TargetRef    string `json:"target_ref"`
	FilePath     string `json:"file_path,omitempty"`
	MaxBytes     int64  `json:"max_bytes,omitempty"`
}
