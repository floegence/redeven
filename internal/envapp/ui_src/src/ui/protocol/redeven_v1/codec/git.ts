import type {
  GitBranchSummary,
  GitCommitDetail,
  GitCommitFileSummary,
  GitCommitSummary,
  GitGetBranchCompareRequest,
  GitGetBranchCompareResponse,
  GitGetCommitDetailRequest,
  GitGetCommitDetailResponse,
  GitListBranchesRequest,
  GitListBranchesResponse,
  GitListCommitsRequest,
  GitListCommitsResponse,
  GitListWorkspaceChangesRequest,
  GitListWorkspaceChangesResponse,
  GitRepoSummaryRequest,
  GitRepoSummaryResponse,
  GitResolveRepoRequest,
  GitResolveRepoResponse,
  GitWorkspaceChange,
  GitWorkspaceSummary,
} from '../sdk/git';
import type {
  wire_git_branch_summary,
  wire_git_commit_detail,
  wire_git_commit_file_summary,
  wire_git_commit_summary,
  wire_git_get_branch_compare_req,
  wire_git_get_branch_compare_resp,
  wire_git_get_commit_detail_req,
  wire_git_get_commit_detail_resp,
  wire_git_get_repo_summary_req,
  wire_git_get_repo_summary_resp,
  wire_git_list_branches_req,
  wire_git_list_branches_resp,
  wire_git_list_commits_req,
  wire_git_list_commits_resp,
  wire_git_list_workspace_changes_req,
  wire_git_list_workspace_changes_resp,
  wire_git_resolve_repo_req,
  wire_git_resolve_repo_resp,
  wire_git_workspace_change,
  wire_git_workspace_summary,
} from '../wire/git';

function fromWireGitWorkspaceSummary(resp: wire_git_workspace_summary | undefined): GitWorkspaceSummary {
  return {
    stagedCount: typeof resp?.staged_count === 'number' ? resp.staged_count : undefined,
    unstagedCount: typeof resp?.unstaged_count === 'number' ? resp.unstaged_count : undefined,
    untrackedCount: typeof resp?.untracked_count === 'number' ? resp.untracked_count : undefined,
    conflictedCount: typeof resp?.conflicted_count === 'number' ? resp.conflicted_count : undefined,
  };
}

function toWireGitWorkspaceSummary(req: GitWorkspaceSummary): wire_git_workspace_summary {
  return {
    staged_count: typeof req.stagedCount === 'number' ? req.stagedCount : undefined,
    unstaged_count: typeof req.unstagedCount === 'number' ? req.unstagedCount : undefined,
    untracked_count: typeof req.untrackedCount === 'number' ? req.untrackedCount : undefined,
    conflicted_count: typeof req.conflictedCount === 'number' ? req.conflictedCount : undefined,
  };
}

function fromWireGitWorkspaceChange(resp: wire_git_workspace_change): GitWorkspaceChange {
  return {
    section: typeof resp?.section === 'string' ? resp.section : undefined,
    changeType: typeof resp?.change_type === 'string' ? resp.change_type : undefined,
    path: typeof resp?.path === 'string' ? resp.path : undefined,
    oldPath: typeof resp?.old_path === 'string' ? resp.old_path : undefined,
    newPath: typeof resp?.new_path === 'string' ? resp.new_path : undefined,
    patchPath: typeof resp?.patch_path === 'string' ? resp.patch_path : undefined,
    additions: typeof resp?.additions === 'number' ? resp.additions : undefined,
    deletions: typeof resp?.deletions === 'number' ? resp.deletions : undefined,
    isBinary: typeof resp?.is_binary === 'boolean' ? resp.is_binary : undefined,
  };
}

function fromWireGitBranchSummary(resp: wire_git_branch_summary): GitBranchSummary {
  return {
    name: typeof resp?.name === 'string' ? resp.name : undefined,
    fullName: typeof resp?.full_name === 'string' ? resp.full_name : undefined,
    kind: typeof resp?.kind === 'string' ? resp.kind : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
    authorName: typeof resp?.author_name === 'string' ? resp.author_name : undefined,
    authorTimeMs: typeof resp?.author_time_ms === 'number' ? resp.author_time_ms : undefined,
    subject: typeof resp?.subject === 'string' ? resp.subject : undefined,
    upstreamRef: typeof resp?.upstream_ref === 'string' ? resp.upstream_ref : undefined,
    aheadCount: typeof resp?.ahead_count === 'number' ? resp.ahead_count : undefined,
    behindCount: typeof resp?.behind_count === 'number' ? resp.behind_count : undefined,
    upstreamGone: typeof resp?.upstream_gone === 'boolean' ? resp.upstream_gone : undefined,
    current: typeof resp?.current === 'boolean' ? resp.current : undefined,
    worktreePath: typeof resp?.worktree_path === 'string' ? resp.worktree_path : undefined,
  };
}

function fromWireGitCommitSummary(resp: wire_git_commit_summary): GitCommitSummary {
  return {
    hash: String(resp?.hash ?? ''),
    shortHash: String(resp?.short_hash ?? ''),
    parents: Array.isArray(resp?.parents) ? resp.parents.map((item) => String(item ?? '')) : [],
    authorName: typeof resp?.author_name === 'string' ? resp.author_name : undefined,
    authorEmail: typeof resp?.author_email === 'string' ? resp.author_email : undefined,
    authorTimeMs: typeof resp?.author_time_ms === 'number' ? resp.author_time_ms : undefined,
    subject: typeof resp?.subject === 'string' ? resp.subject : undefined,
    bodyPreview: typeof resp?.body_preview === 'string' ? resp.body_preview : undefined,
  };
}

function fromWireGitCommitDetail(resp: wire_git_commit_detail): GitCommitDetail {
  return {
    hash: String(resp?.hash ?? ''),
    shortHash: String(resp?.short_hash ?? ''),
    parents: Array.isArray(resp?.parents) ? resp.parents.map((item) => String(item ?? '')) : [],
    authorName: typeof resp?.author_name === 'string' ? resp.author_name : undefined,
    authorEmail: typeof resp?.author_email === 'string' ? resp.author_email : undefined,
    authorTimeMs: typeof resp?.author_time_ms === 'number' ? resp.author_time_ms : undefined,
    subject: typeof resp?.subject === 'string' ? resp.subject : undefined,
    body: typeof resp?.body === 'string' ? resp.body : undefined,
  };
}

function fromWireGitCommitFileSummary(resp: wire_git_commit_file_summary): GitCommitFileSummary {
  return {
    changeType: typeof resp?.change_type === 'string' ? resp.change_type : undefined,
    path: typeof resp?.path === 'string' ? resp.path : undefined,
    oldPath: typeof resp?.old_path === 'string' ? resp.old_path : undefined,
    newPath: typeof resp?.new_path === 'string' ? resp.new_path : undefined,
    patchPath: typeof resp?.patch_path === 'string' ? resp.patch_path : undefined,
    additions: typeof resp?.additions === 'number' ? resp.additions : undefined,
    deletions: typeof resp?.deletions === 'number' ? resp.deletions : undefined,
    isBinary: typeof resp?.is_binary === 'boolean' ? resp.is_binary : undefined,
  };
}

export function toWireGitResolveRepoRequest(req: GitResolveRepoRequest): wire_git_resolve_repo_req {
  return {
    path: req.path,
  };
}

export function fromWireGitResolveRepoResponse(resp: wire_git_resolve_repo_resp): GitResolveRepoResponse {
  return {
    available: Boolean(resp?.available),
    repoRootPath: typeof resp?.repo_root_path === 'string' ? resp.repo_root_path : undefined,
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
    dirty: typeof resp?.dirty === 'boolean' ? resp.dirty : undefined,
  };
}

export function toWireGitGetRepoSummaryRequest(req: GitRepoSummaryRequest): wire_git_get_repo_summary_req {
  return {
    repo_root_path: req.repoRootPath,
  };
}

export function fromWireGitGetRepoSummaryResponse(resp: wire_git_get_repo_summary_resp): GitRepoSummaryResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    worktreePath: typeof resp?.worktree_path === 'string' ? resp.worktree_path : undefined,
    isWorktree: typeof resp?.is_worktree === 'boolean' ? resp.is_worktree : undefined,
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
    detached: typeof resp?.detached === 'boolean' ? resp.detached : undefined,
    upstreamRef: typeof resp?.upstream_ref === 'string' ? resp.upstream_ref : undefined,
    aheadCount: typeof resp?.ahead_count === 'number' ? resp.ahead_count : undefined,
    behindCount: typeof resp?.behind_count === 'number' ? resp.behind_count : undefined,
    stashCount: typeof resp?.stash_count === 'number' ? resp.stash_count : undefined,
    workspaceSummary: fromWireGitWorkspaceSummary(resp?.workspace_summary),
  };
}

export function toWireGitListWorkspaceChangesRequest(req: GitListWorkspaceChangesRequest): wire_git_list_workspace_changes_req {
  return {
    repo_root_path: req.repoRootPath,
  };
}

export function fromWireGitListWorkspaceChangesResponse(resp: wire_git_list_workspace_changes_resp): GitListWorkspaceChangesResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    summary: fromWireGitWorkspaceSummary(resp?.summary),
    staged: Array.isArray(resp?.staged) ? resp.staged.map(fromWireGitWorkspaceChange) : [],
    unstaged: Array.isArray(resp?.unstaged) ? resp.unstaged.map(fromWireGitWorkspaceChange) : [],
    untracked: Array.isArray(resp?.untracked) ? resp.untracked.map(fromWireGitWorkspaceChange) : [],
    conflicted: Array.isArray(resp?.conflicted) ? resp.conflicted.map(fromWireGitWorkspaceChange) : [],
  };
}

export function toWireGitListBranchesRequest(req: GitListBranchesRequest): wire_git_list_branches_req {
  return {
    repo_root_path: req.repoRootPath,
  };
}

export function fromWireGitListBranchesResponse(resp: wire_git_list_branches_resp): GitListBranchesResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    currentRef: typeof resp?.current_ref === 'string' ? resp.current_ref : undefined,
    detached: typeof resp?.detached === 'boolean' ? resp.detached : undefined,
    local: Array.isArray(resp?.local) ? resp.local.map(fromWireGitBranchSummary) : [],
    remote: Array.isArray(resp?.remote) ? resp.remote.map(fromWireGitBranchSummary) : [],
  };
}

export function toWireGitListCommitsRequest(req: GitListCommitsRequest): wire_git_list_commits_req {
  return {
    repo_root_path: req.repoRootPath,
    ref: typeof req.ref === 'string' ? req.ref : undefined,
    offset: typeof req.offset === 'number' ? req.offset : undefined,
    limit: typeof req.limit === 'number' ? req.limit : undefined,
  };
}

export function fromWireGitListCommitsResponse(resp: wire_git_list_commits_resp): GitListCommitsResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    commits: Array.isArray(resp?.commits) ? resp.commits.map(fromWireGitCommitSummary) : [],
    nextOffset: typeof resp?.next_offset === 'number' ? resp.next_offset : undefined,
    hasMore: typeof resp?.has_more === 'boolean' ? resp.has_more : undefined,
  };
}

export function toWireGitGetCommitDetailRequest(req: GitGetCommitDetailRequest): wire_git_get_commit_detail_req {
  return {
    repo_root_path: req.repoRootPath,
    commit: req.commit,
  };
}

export function fromWireGitGetCommitDetailResponse(resp: wire_git_get_commit_detail_resp): GitGetCommitDetailResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    commit: fromWireGitCommitDetail(resp?.commit ?? {}),
    files: Array.isArray(resp?.files) ? resp.files.map(fromWireGitCommitFileSummary) : [],
  };
}

export function toWireGitGetBranchCompareRequest(req: GitGetBranchCompareRequest): wire_git_get_branch_compare_req {
  return {
    repo_root_path: req.repoRootPath,
    base_ref: req.baseRef,
    target_ref: req.targetRef,
    limit: typeof req.limit === 'number' ? req.limit : undefined,
  };
}

export function fromWireGitGetBranchCompareResponse(resp: wire_git_get_branch_compare_resp): GitGetBranchCompareResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    baseRef: String(resp?.base_ref ?? ''),
    targetRef: String(resp?.target_ref ?? ''),
    mergeBase: typeof resp?.merge_base === 'string' ? resp.merge_base : undefined,
    targetAheadCount: typeof resp?.target_ahead_count === 'number' ? resp.target_ahead_count : undefined,
    targetBehindCount: typeof resp?.target_behind_count === 'number' ? resp.target_behind_count : undefined,
    commits: Array.isArray(resp?.commits) ? resp.commits.map(fromWireGitCommitSummary) : [],
    files: Array.isArray(resp?.files) ? resp.files.map(fromWireGitCommitFileSummary) : [],
  };
}
