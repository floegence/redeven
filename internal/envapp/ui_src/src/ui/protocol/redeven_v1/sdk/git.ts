export type GitResolveRepoRequest = {
  path: string;
};

export type GitResolveRepoResponse = {
  available: boolean;
  gitAvailable?: boolean;
  unavailableReason?: string;
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

export type GitMutationBlocker = {
  kind?: string;
  reason?: string;
  workspacePath?: string;
  workspaceSummary: GitWorkspaceSummary;
  operation?: string;
  canStashWorkspace?: boolean;
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
  reattachBranch?: GitBranchSummary;
  upstreamRef?: string;
  aheadCount?: number;
  behindCount?: number;
  stashCount?: number;
  workspaceSummary: GitWorkspaceSummary;
};

export type GitWorkspaceSection = 'staged' | 'unstaged' | 'untracked' | 'conflicted';

export type GitDiffFileSummary = {
  changeType?: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'conflicted' | string;
  path?: string;
  oldPath?: string;
  newPath?: string;
  displayPath?: string;
  additions?: number;
  deletions?: number;
  isBinary?: boolean;
};

export type GitDiffFileContent = GitDiffFileSummary & {
  patchText?: string;
  patchTruncated?: boolean;
};

export type GitWorkspaceChange = GitDiffFileSummary & {
  section?: GitWorkspaceSection | string;
};

export type GitLinkedWorktreeSnapshot = {
  worktreePath?: string;
  summary: GitWorkspaceSummary;
  staged: GitWorkspaceChange[];
  unstaged: GitWorkspaceChange[];
  untracked: GitWorkspaceChange[];
  conflicted: GitWorkspaceChange[];
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

export type GitListStashesRequest = {
  repoRootPath: string;
};

export type GitStashSummary = {
  id: string;
  ref?: string;
  message?: string;
  branchName?: string;
  headRef?: string;
  headCommit?: string;
  createdAtUnixMs?: number;
  fileCount?: number;
  hasUntracked?: boolean;
};

export type GitListStashesResponse = {
  repoRootPath: string;
  stashes: GitStashSummary[];
};

export type GitGetStashDetailRequest = {
  repoRootPath: string;
  id: string;
};

export type GitStashDetail = GitStashSummary & {
  files: GitCommitFileSummary[];
};

export type GitGetStashDetailResponse = {
  repoRootPath: string;
  stash: GitStashDetail;
};

export type GitSaveStashRequest = {
  repoRootPath: string;
  message?: string;
  includeUntracked?: boolean;
  keepIndex?: boolean;
};

export type GitSaveStashResponse = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
  created?: GitStashSummary;
};

export type GitPreviewApplyStashRequest = {
  repoRootPath: string;
  id: string;
  removeAfterApply?: boolean;
};

export type GitPreviewApplyStashResponse = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
  stash?: GitStashSummary;
  removeAfterApply?: boolean;
  blockingReason?: string;
  blocking?: GitMutationBlocker;
  planFingerprint?: string;
};

export type GitApplyStashRequest = {
  repoRootPath: string;
  id: string;
  removeAfterApply?: boolean;
  planFingerprint?: string;
};

export type GitApplyStashResponse = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
};

export type GitPreviewDropStashRequest = {
  repoRootPath: string;
  id: string;
};

export type GitPreviewDropStashResponse = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
  stash?: GitStashSummary;
  planFingerprint?: string;
};

export type GitDropStashRequest = {
  repoRootPath: string;
  id: string;
  planFingerprint?: string;
};

export type GitDropStashResponse = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
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

export type GitFetchRepoRequest = {
  repoRootPath: string;
};

export type GitFetchRepoResponse = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
};

export type GitPullRepoRequest = {
  repoRootPath: string;
};

export type GitPullRepoResponse = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
};

export type GitPushRepoRequest = {
  repoRootPath: string;
};

export type GitPushRepoResponse = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
};

export type GitCheckoutBranchRequest = {
  repoRootPath: string;
  name?: string;
  fullName?: string;
  kind?: 'local' | 'remote' | string;
};

export type GitCheckoutBranchResponse = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
};

export type GitSwitchDetachedRequest = {
  repoRootPath: string;
  targetRef: string;
};

export type GitSwitchDetachedResponse = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
  detached?: boolean;
};

export type GitDeleteLinkedWorktreePreview = {
  worktreePath?: string;
  accessible: boolean;
  summary: GitWorkspaceSummary;
  staged: GitWorkspaceChange[];
  unstaged: GitWorkspaceChange[];
  untracked: GitWorkspaceChange[];
  conflicted: GitWorkspaceChange[];
};

export type GitPreviewDeleteBranchRequest = {
  repoRootPath: string;
  name?: string;
  fullName?: string;
  kind?: 'local' | 'remote' | string;
};

export type GitPreviewDeleteBranchResponse = {
  repoRootPath: string;
  name?: string;
  fullName?: string;
  kind?: 'local' | 'remote' | string;
  linkedWorktree?: GitDeleteLinkedWorktreePreview;
  requiresWorktreeRemoval: boolean;
  requiresDiscardConfirmation: boolean;
  safeDeleteAllowed: boolean;
  safeDeleteBaseRef?: string;
  safeDeleteReason?: string;
  forceDeleteAllowed: boolean;
  forceDeleteRequiresConfirm: boolean;
  forceDeleteReason?: string;
  blockingReason?: string;
  planFingerprint?: string;
};

export type GitDeleteBranchMode = 'safe' | 'force';

export type GitDeleteBranchRequest = {
  repoRootPath: string;
  name?: string;
  fullName?: string;
  kind?: 'local' | 'remote' | string;
  deleteMode?: GitDeleteBranchMode | string;
  confirmBranchName?: string;
  removeLinkedWorktree: boolean;
  discardLinkedWorktreeChanges: boolean;
  planFingerprint?: string;
};

export type GitDeleteBranchResponse = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
  linkedWorktreeRemoved: boolean;
  removedWorktreePath?: string;
};

export type GitPreviewMergeBranchRequest = {
  repoRootPath: string;
  name?: string;
  fullName?: string;
  kind?: 'local' | 'remote' | string;
};

export type GitPreviewMergeBranchResponse = {
  repoRootPath: string;
  currentRef?: string;
  currentCommit?: string;
  sourceName?: string;
  sourceFullName?: string;
  sourceKind?: 'local' | 'remote' | string;
  sourceCommit?: string;
  mergeBase?: string;
  sourceAheadCount?: number;
  sourceBehindCount?: number;
  outcome?: 'blocked' | 'up_to_date' | 'fast_forward' | 'merge_commit' | string;
  blockingReason?: string;
  blocking?: GitMutationBlocker;
  planFingerprint?: string;
  files: GitCommitFileSummary[];
  linkedWorktree?: GitLinkedWorktreeSnapshot;
};

export type GitMergeBranchRequest = {
  repoRootPath: string;
  name?: string;
  fullName?: string;
  kind?: 'local' | 'remote' | string;
  planFingerprint?: string;
};

export type GitMergeBranchResponse = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
  result?: 'up_to_date' | 'fast_forward' | 'merge_commit' | 'conflicted' | string;
  conflictSummary: GitWorkspaceSummary;
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

export type GitCommitFileSummary = GitDiffFileSummary;

export type GitDiffFileRef = {
  changeType?: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'conflicted' | string;
  path?: string;
  oldPath?: string;
  newPath?: string;
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
  linkedWorktree?: GitLinkedWorktreeSnapshot;
};

export type GitDiffContentSourceKind = 'workspace' | 'commit' | 'compare' | 'stash';
export type GitDiffContentMode = 'preview' | 'full';

export type GitGetDiffContentRequest = {
  repoRootPath: string;
  sourceKind: GitDiffContentSourceKind | string;
  workspaceSection?: GitWorkspaceSection | string;
  commit?: string;
  baseRef?: string;
  targetRef?: string;
  stashId?: string;
  mode?: GitDiffContentMode | string;
  file: GitDiffFileRef;
};

export type GitGetDiffContentResponse = {
  repoRootPath: string;
  mode?: GitDiffContentMode | string;
  file: GitDiffFileContent;
};
