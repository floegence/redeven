export type GitResolveRepoRequest = {
  path: string;
};

export type GitResolveRepoResponse = {
  available: boolean;
  repoRootPath?: string;
  headRef?: string;
  headCommit?: string;
  dirty?: boolean;
};

export type GitWorkspaceSummary = {
  stagedCount?: number;
  unstagedCount?: number;
  untrackedCount?: number;
  conflictedCount?: number;
};

export type GitRepoSummaryRequest = {
  repoRootPath: string;
};

export type GitRepoSummaryResponse = {
  repoRootPath: string;
  worktreePath?: string;
  isWorktree?: boolean;
  headRef?: string;
  headCommit?: string;
  detached?: boolean;
  upstreamRef?: string;
  aheadCount?: number;
  behindCount?: number;
  stashCount?: number;
  workspaceSummary: GitWorkspaceSummary;
};

export type GitWorkspaceSection = 'staged' | 'unstaged' | 'untracked' | 'conflicted';

export type GitWorkspaceChange = {
  section?: GitWorkspaceSection | string;
  changeType?: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'conflicted' | string;
  path?: string;
  oldPath?: string;
  newPath?: string;
  displayPath?: string;
  patchText?: string;
  patchTruncated?: boolean;
  additions?: number;
  deletions?: number;
  isBinary?: boolean;
};

export type GitListWorkspaceChangesRequest = {
  repoRootPath: string;
};

export type GitListWorkspaceChangesResponse = {
  repoRootPath: string;
  summary: GitWorkspaceSummary;
  staged: GitWorkspaceChange[];
  unstaged: GitWorkspaceChange[];
  untracked: GitWorkspaceChange[];
  conflicted: GitWorkspaceChange[];
};

export type GitStageWorkspaceRequest = {
  repoRootPath: string;
  paths?: string[];
};

export type GitStageWorkspaceResponse = {
  repoRootPath: string;
};

export type GitUnstageWorkspaceRequest = {
  repoRootPath: string;
  paths?: string[];
};

export type GitUnstageWorkspaceResponse = {
  repoRootPath: string;
};

export type GitCommitWorkspaceRequest = {
  repoRootPath: string;
  message: string;
};

export type GitCommitWorkspaceResponse = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
};

export type GitBranchSummary = {
  name?: string;
  fullName?: string;
  kind?: 'local' | 'remote' | string;
  headCommit?: string;
  authorName?: string;
  authorTimeMs?: number;
  subject?: string;
  upstreamRef?: string;
  aheadCount?: number;
  behindCount?: number;
  upstreamGone?: boolean;
  current?: boolean;
  worktreePath?: string;
};

export type GitListBranchesRequest = {
  repoRootPath: string;
};

export type GitListBranchesResponse = {
  repoRootPath: string;
  currentRef?: string;
  detached?: boolean;
  local: GitBranchSummary[];
  remote: GitBranchSummary[];
};

export type GitCommitSummary = {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName?: string;
  authorEmail?: string;
  authorTimeMs?: number;
  subject?: string;
  bodyPreview?: string;
};

export type GitListCommitsRequest = {
  repoRootPath: string;
  ref?: string;
  offset?: number;
  limit?: number;
};

export type GitListCommitsResponse = {
  repoRootPath: string;
  commits: GitCommitSummary[];
  nextOffset?: number;
  hasMore?: boolean;
};

export type GitCommitDetail = {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName?: string;
  authorEmail?: string;
  authorTimeMs?: number;
  subject?: string;
  body?: string;
};

export type GitCommitFileSummary = {
  changeType?: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | string;
  path?: string;
  oldPath?: string;
  newPath?: string;
  displayPath?: string;
  patchText?: string;
  patchTruncated?: boolean;
  additions?: number;
  deletions?: number;
  isBinary?: boolean;
};

export type GitGetCommitDetailRequest = {
  repoRootPath: string;
  commit: string;
};

export type GitGetCommitDetailResponse = {
  repoRootPath: string;
  commit: GitCommitDetail;
  files: GitCommitFileSummary[];
};

export type GitGetBranchCompareRequest = {
  repoRootPath: string;
  baseRef: string;
  targetRef: string;
  limit?: number;
};

export type GitGetBranchCompareResponse = {
  repoRootPath: string;
  baseRef: string;
  targetRef: string;
  mergeBase?: string;
  targetAheadCount?: number;
  targetBehindCount?: number;
  commits: GitCommitSummary[];
  files: GitCommitFileSummary[];
};
