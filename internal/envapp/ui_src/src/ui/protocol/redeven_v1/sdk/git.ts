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
  patchPath?: string;
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
