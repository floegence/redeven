import type {
  GitCommitDetail,
  GitCommitFileSummary,
  GitCommitSummary,
  GitGetCommitDetailRequest,
  GitGetCommitDetailResponse,
  GitListCommitsRequest,
  GitListCommitsResponse,
  GitResolveRepoRequest,
  GitResolveRepoResponse,
} from '../sdk/git';
import type {
  wire_git_commit_detail,
  wire_git_commit_file_summary,
  wire_git_commit_summary,
  wire_git_get_commit_detail_req,
  wire_git_get_commit_detail_resp,
  wire_git_list_commits_req,
  wire_git_list_commits_resp,
  wire_git_resolve_repo_req,
  wire_git_resolve_repo_resp,
} from '../wire/git';

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

export function toWireGitListCommitsRequest(req: GitListCommitsRequest): wire_git_list_commits_req {
  return {
    repo_root_path: req.repoRootPath,
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
