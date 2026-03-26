import type {
  GitApplyStashRequest,
  GitApplyStashResponse,
  GitCheckoutBranchRequest,
  GitCheckoutBranchResponse,
  GitDropStashRequest,
  GitDropStashResponse,
  GitDeleteLinkedWorktreePreview,
  GitDeleteBranchRequest,
  GitDeleteBranchResponse,
  GitDiffFileContent,
  GitDiffFileRef,
  GitDiffFileSummary,
  GitGetStashDetailRequest,
  GitGetStashDetailResponse,
  GitMergeBranchRequest,
  GitMergeBranchResponse,
  GitMutationBlocker,
  GitPreviewDeleteBranchRequest,
  GitPreviewDeleteBranchResponse,
  GitPreviewApplyStashRequest,
  GitPreviewApplyStashResponse,
  GitPreviewDropStashRequest,
  GitPreviewDropStashResponse,
  GitPreviewMergeBranchRequest,
  GitPreviewMergeBranchResponse,
  GitBranchSummary,
  GitCommitWorkspaceRequest,
  GitCommitWorkspaceResponse,
  GitCommitDetail,
  GitCommitFileSummary,
  GitCommitSummary,
  GitFetchRepoRequest,
  GitFetchRepoResponse,
  GitGetBranchCompareRequest,
  GitGetBranchCompareResponse,
  GitGetCommitDetailRequest,
  GitGetCommitDetailResponse,
  GitGetDiffContentRequest,
  GitGetDiffContentResponse,
  GitLinkedWorktreeSnapshot,
  GitListBranchesRequest,
  GitListBranchesResponse,
  GitListCommitsRequest,
  GitListCommitsResponse,
  GitListStashesRequest,
  GitListStashesResponse,
  GitSaveStashRequest,
  GitSaveStashResponse,
  GitStageWorkspaceRequest,
  GitStashDetail,
  GitStashSummary,
  GitStageWorkspaceResponse,
  GitSwitchDetachedRequest,
  GitSwitchDetachedResponse,
  GitUnstageWorkspaceRequest,
  GitUnstageWorkspaceResponse,
  GitListWorkspaceChangesRequest,
  GitListWorkspaceChangesResponse,
  GitPullRepoRequest,
  GitPullRepoResponse,
  GitPushRepoRequest,
  GitPushRepoResponse,
  GitRepoSummaryRequest,
  GitRepoSummaryResponse,
  GitResolveRepoRequest,
  GitResolveRepoResponse,
  GitWorkspaceChange,
  GitWorkspaceSummary,
} from '../sdk/git';
import type {
  wire_git_apply_stash_req,
  wire_git_apply_stash_resp,
  wire_git_checkout_branch_req,
  wire_git_checkout_branch_resp,
  wire_git_drop_stash_req,
  wire_git_drop_stash_resp,
  wire_git_delete_linked_worktree_preview,
  wire_git_delete_branch_req,
  wire_git_delete_branch_resp,
  wire_git_diff_file_content,
  wire_git_diff_file_ref,
  wire_git_diff_file_summary,
  wire_git_get_stash_detail_req,
  wire_git_get_stash_detail_resp,
  wire_git_merge_branch_req,
  wire_git_merge_branch_resp,
  wire_git_mutation_blocker,
  wire_git_preview_delete_branch_req,
  wire_git_preview_delete_branch_resp,
  wire_git_preview_apply_stash_req,
  wire_git_preview_apply_stash_resp,
  wire_git_preview_drop_stash_req,
  wire_git_preview_drop_stash_resp,
  wire_git_preview_merge_branch_req,
  wire_git_preview_merge_branch_resp,
  wire_git_branch_summary,
  wire_git_commit_workspace_req,
  wire_git_commit_workspace_resp,
  wire_git_commit_detail,
  wire_git_commit_file_summary,
  wire_git_commit_summary,
  wire_git_fetch_repo_req,
  wire_git_fetch_repo_resp,
  wire_git_get_branch_compare_req,
  wire_git_get_branch_compare_resp,
  wire_git_get_commit_detail_req,
  wire_git_get_commit_detail_resp,
  wire_git_get_diff_content_req,
  wire_git_get_diff_content_resp,
  wire_git_get_repo_summary_req,
  wire_git_get_repo_summary_resp,
  wire_git_linked_worktree_snapshot,
  wire_git_list_branches_req,
  wire_git_list_branches_resp,
  wire_git_list_commits_req,
  wire_git_list_commits_resp,
  wire_git_list_stashes_req,
  wire_git_list_stashes_resp,
  wire_git_save_stash_req,
  wire_git_save_stash_resp,
  wire_git_stage_workspace_req,
  wire_git_stash_detail,
  wire_git_stash_summary,
  wire_git_stage_workspace_resp,
  wire_git_switch_detached_req,
  wire_git_switch_detached_resp,
  wire_git_unstage_workspace_req,
  wire_git_unstage_workspace_resp,
  wire_git_list_workspace_changes_req,
  wire_git_list_workspace_changes_resp,
  wire_git_pull_repo_req,
  wire_git_pull_repo_resp,
  wire_git_push_repo_req,
  wire_git_push_repo_resp,
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

function fromWireGitMutationBlocker(resp: wire_git_mutation_blocker | undefined): GitMutationBlocker | undefined {
  if (!resp) return undefined;
  return {
    kind: typeof resp?.kind === 'string' ? resp.kind : undefined,
    reason: typeof resp?.reason === 'string' ? resp.reason : undefined,
    workspacePath: typeof resp?.workspace_path === 'string' ? resp.workspace_path : undefined,
    workspaceSummary: fromWireGitWorkspaceSummary(resp?.workspace_summary),
    operation: typeof resp?.operation === 'string' ? resp.operation : undefined,
    canStashWorkspace: typeof resp?.can_stash_workspace === 'boolean' ? resp.can_stash_workspace : undefined,
  };
}

function fromWireGitDiffFileSummary(resp: wire_git_diff_file_summary | undefined): GitDiffFileSummary {
  return {
    changeType: typeof resp?.change_type === 'string' ? resp.change_type : undefined,
    path: typeof resp?.path === 'string' ? resp.path : undefined,
    oldPath: typeof resp?.old_path === 'string' ? resp.old_path : undefined,
    newPath: typeof resp?.new_path === 'string' ? resp.new_path : undefined,
    displayPath: typeof resp?.display_path === 'string' ? resp.display_path : undefined,
    additions: typeof resp?.additions === 'number' ? resp.additions : undefined,
    deletions: typeof resp?.deletions === 'number' ? resp.deletions : undefined,
    isBinary: typeof resp?.is_binary === 'boolean' ? resp.is_binary : undefined,
  };
}

function fromWireGitDiffFileContent(resp: wire_git_diff_file_content | undefined): GitDiffFileContent {
  return {
    ...fromWireGitDiffFileSummary(resp),
    patchText: typeof resp?.patch_text === 'string' ? resp.patch_text : undefined,
    patchTruncated: typeof resp?.patch_truncated === 'boolean' ? resp.patch_truncated : undefined,
  };
}

function fromWireGitWorkspaceChange(resp: wire_git_workspace_change): GitWorkspaceChange {
  return {
    section: typeof resp?.section === 'string' ? resp.section : undefined,
    ...fromWireGitDiffFileSummary(resp),
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
  return fromWireGitDiffFileSummary(resp);
}

function toWireGitDiffFileRef(req: GitDiffFileRef): wire_git_diff_file_ref {
  return {
    change_type: typeof req.changeType === 'string' ? req.changeType : undefined,
    path: typeof req.path === 'string' ? req.path : undefined,
    old_path: typeof req.oldPath === 'string' ? req.oldPath : undefined,
    new_path: typeof req.newPath === 'string' ? req.newPath : undefined,
  };
}

function fromWireGitLinkedWorktreeSnapshot(resp: wire_git_linked_worktree_snapshot | undefined): GitLinkedWorktreeSnapshot | undefined {
  if (!resp) return undefined;
  return {
    worktreePath: typeof resp?.worktree_path === 'string' ? resp.worktree_path : undefined,
    summary: fromWireGitWorkspaceSummary(resp?.summary),
    staged: Array.isArray(resp?.staged) ? resp.staged.map(fromWireGitWorkspaceChange) : [],
    unstaged: Array.isArray(resp?.unstaged) ? resp.unstaged.map(fromWireGitWorkspaceChange) : [],
    untracked: Array.isArray(resp?.untracked) ? resp.untracked.map(fromWireGitWorkspaceChange) : [],
    conflicted: Array.isArray(resp?.conflicted) ? resp.conflicted.map(fromWireGitWorkspaceChange) : [],
  };
}

function fromWireGitDeleteLinkedWorktreePreview(resp: wire_git_delete_linked_worktree_preview | undefined): GitDeleteLinkedWorktreePreview | undefined {
  if (!resp) return undefined;
  return {
    worktreePath: typeof resp?.worktree_path === 'string' ? resp.worktree_path : undefined,
    accessible: Boolean(resp?.accessible),
    summary: fromWireGitWorkspaceSummary(resp?.summary),
    staged: Array.isArray(resp?.staged) ? resp.staged.map(fromWireGitWorkspaceChange) : [],
    unstaged: Array.isArray(resp?.unstaged) ? resp.unstaged.map(fromWireGitWorkspaceChange) : [],
    untracked: Array.isArray(resp?.untracked) ? resp.untracked.map(fromWireGitWorkspaceChange) : [],
    conflicted: Array.isArray(resp?.conflicted) ? resp.conflicted.map(fromWireGitWorkspaceChange) : [],
  };
}

function fromWireGitStashSummary(resp: wire_git_stash_summary | undefined): GitStashSummary | undefined {
  if (!resp) return undefined;
  return {
    id: String(resp?.id ?? ''),
    ref: typeof resp?.ref === 'string' ? resp.ref : undefined,
    message: typeof resp?.message === 'string' ? resp.message : undefined,
    branchName: typeof resp?.branch_name === 'string' ? resp.branch_name : undefined,
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
    createdAtUnixMs: typeof resp?.created_at_unix_ms === 'number' ? resp.created_at_unix_ms : undefined,
    fileCount: typeof resp?.file_count === 'number' ? resp.file_count : undefined,
    hasUntracked: typeof resp?.has_untracked === 'boolean' ? resp.has_untracked : undefined,
  };
}

function fromWireGitStashDetail(resp: wire_git_stash_detail | undefined): GitStashDetail {
  const summary = fromWireGitStashSummary(resp);
  return {
    id: String(summary?.id ?? ''),
    ref: summary?.ref,
    message: summary?.message,
    branchName: summary?.branchName,
    headRef: summary?.headRef,
    headCommit: summary?.headCommit,
    createdAtUnixMs: summary?.createdAtUnixMs,
    fileCount: summary?.fileCount,
    hasUntracked: summary?.hasUntracked,
    files: Array.isArray(resp?.files) ? resp.files.map(fromWireGitCommitFileSummary) : [],
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
    gitAvailable: typeof resp?.git_available === 'boolean' ? resp.git_available : undefined,
    unavailableReason: typeof resp?.unavailable_reason === 'string' ? resp.unavailable_reason : undefined,
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
    reattachBranch: resp?.reattach_branch ? fromWireGitBranchSummary(resp.reattach_branch) : undefined,
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

export function toWireGitListStashesRequest(req: GitListStashesRequest): wire_git_list_stashes_req {
  return {
    repo_root_path: req.repoRootPath,
  };
}

export function fromWireGitListStashesResponse(resp: wire_git_list_stashes_resp): GitListStashesResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    stashes: Array.isArray(resp?.stashes)
      ? resp.stashes.map((item) => fromWireGitStashSummary(item)).filter((item): item is GitStashSummary => Boolean(item))
      : [],
  };
}

export function toWireGitGetStashDetailRequest(req: GitGetStashDetailRequest): wire_git_get_stash_detail_req {
  return {
    repo_root_path: req.repoRootPath,
    id: req.id,
  };
}

export function fromWireGitGetStashDetailResponse(resp: wire_git_get_stash_detail_resp): GitGetStashDetailResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    stash: fromWireGitStashDetail(resp?.stash),
  };
}

export function toWireGitSaveStashRequest(req: GitSaveStashRequest): wire_git_save_stash_req {
  return {
    repo_root_path: req.repoRootPath,
    message: typeof req.message === 'string' ? req.message : undefined,
    include_untracked: typeof req.includeUntracked === 'boolean' ? req.includeUntracked : undefined,
    keep_index: typeof req.keepIndex === 'boolean' ? req.keepIndex : undefined,
  };
}

export function fromWireGitSaveStashResponse(resp: wire_git_save_stash_resp): GitSaveStashResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
    created: fromWireGitStashSummary(resp?.created),
  };
}

export function toWireGitPreviewApplyStashRequest(req: GitPreviewApplyStashRequest): wire_git_preview_apply_stash_req {
  return {
    repo_root_path: req.repoRootPath,
    id: req.id,
    remove_after_apply: typeof req.removeAfterApply === 'boolean' ? req.removeAfterApply : undefined,
  };
}

export function fromWireGitPreviewApplyStashResponse(resp: wire_git_preview_apply_stash_resp): GitPreviewApplyStashResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
    stash: fromWireGitStashSummary(resp?.stash),
    removeAfterApply: typeof resp?.remove_after_apply === 'boolean' ? resp.remove_after_apply : undefined,
    blockingReason: typeof resp?.blocking_reason === 'string' ? resp.blocking_reason : undefined,
    blocking: fromWireGitMutationBlocker(resp?.blocking),
    planFingerprint: typeof resp?.plan_fingerprint === 'string' ? resp.plan_fingerprint : undefined,
  };
}

export function toWireGitApplyStashRequest(req: GitApplyStashRequest): wire_git_apply_stash_req {
  return {
    repo_root_path: req.repoRootPath,
    id: req.id,
    remove_after_apply: typeof req.removeAfterApply === 'boolean' ? req.removeAfterApply : undefined,
    plan_fingerprint: typeof req.planFingerprint === 'string' ? req.planFingerprint : undefined,
  };
}

export function fromWireGitApplyStashResponse(resp: wire_git_apply_stash_resp): GitApplyStashResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
  };
}

export function toWireGitPreviewDropStashRequest(req: GitPreviewDropStashRequest): wire_git_preview_drop_stash_req {
  return {
    repo_root_path: req.repoRootPath,
    id: req.id,
  };
}

export function fromWireGitPreviewDropStashResponse(resp: wire_git_preview_drop_stash_resp): GitPreviewDropStashResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
    stash: fromWireGitStashSummary(resp?.stash),
    planFingerprint: typeof resp?.plan_fingerprint === 'string' ? resp.plan_fingerprint : undefined,
  };
}

export function toWireGitDropStashRequest(req: GitDropStashRequest): wire_git_drop_stash_req {
  return {
    repo_root_path: req.repoRootPath,
    id: req.id,
    plan_fingerprint: typeof req.planFingerprint === 'string' ? req.planFingerprint : undefined,
  };
}

export function fromWireGitDropStashResponse(resp: wire_git_drop_stash_resp): GitDropStashResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
  };
}

export function toWireGitStageWorkspaceRequest(req: GitStageWorkspaceRequest): wire_git_stage_workspace_req {
  return {
    repo_root_path: req.repoRootPath,
    paths: Array.isArray(req.paths) ? req.paths.map((item) => String(item)) : undefined,
  };
}

export function fromWireGitStageWorkspaceResponse(resp: wire_git_stage_workspace_resp): GitStageWorkspaceResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
  };
}

export function toWireGitUnstageWorkspaceRequest(req: GitUnstageWorkspaceRequest): wire_git_unstage_workspace_req {
  return {
    repo_root_path: req.repoRootPath,
    paths: Array.isArray(req.paths) ? req.paths.map((item) => String(item)) : undefined,
  };
}

export function fromWireGitUnstageWorkspaceResponse(resp: wire_git_unstage_workspace_resp): GitUnstageWorkspaceResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
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

export function toWireGitGetDiffContentRequest(req: GitGetDiffContentRequest): wire_git_get_diff_content_req {
  return {
    repo_root_path: req.repoRootPath,
    source_kind: req.sourceKind,
    workspace_section: typeof req.workspaceSection === 'string' ? req.workspaceSection : undefined,
    commit: typeof req.commit === 'string' ? req.commit : undefined,
    base_ref: typeof req.baseRef === 'string' ? req.baseRef : undefined,
    target_ref: typeof req.targetRef === 'string' ? req.targetRef : undefined,
    stash_id: typeof req.stashId === 'string' ? req.stashId : undefined,
    mode: typeof req.mode === 'string' ? req.mode : undefined,
    file: toWireGitDiffFileRef(req.file),
  };
}

export function fromWireGitGetDiffContentResponse(resp: wire_git_get_diff_content_resp): GitGetDiffContentResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    mode: typeof resp?.mode === 'string' ? resp.mode : undefined,
    file: fromWireGitDiffFileContent(resp?.file ?? {}),
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
    linkedWorktree: fromWireGitLinkedWorktreeSnapshot(resp?.linked_worktree),
  };
}

export function toWireGitCommitWorkspaceRequest(req: GitCommitWorkspaceRequest): wire_git_commit_workspace_req {
  return {
    repo_root_path: req.repoRootPath,
    message: req.message,
  };
}

export function fromWireGitCommitWorkspaceResponse(resp: wire_git_commit_workspace_resp): GitCommitWorkspaceResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
  };
}

export function toWireGitFetchRepoRequest(req: GitFetchRepoRequest): wire_git_fetch_repo_req {
  return {
    repo_root_path: req.repoRootPath,
  };
}

export function fromWireGitFetchRepoResponse(resp: wire_git_fetch_repo_resp): GitFetchRepoResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
  };
}

export function toWireGitPullRepoRequest(req: GitPullRepoRequest): wire_git_pull_repo_req {
  return {
    repo_root_path: req.repoRootPath,
  };
}

export function fromWireGitPullRepoResponse(resp: wire_git_pull_repo_resp): GitPullRepoResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
  };
}

export function toWireGitPushRepoRequest(req: GitPushRepoRequest): wire_git_push_repo_req {
  return {
    repo_root_path: req.repoRootPath,
  };
}

export function fromWireGitPushRepoResponse(resp: wire_git_push_repo_resp): GitPushRepoResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
  };
}

export function toWireGitCheckoutBranchRequest(req: GitCheckoutBranchRequest): wire_git_checkout_branch_req {
  return {
    repo_root_path: req.repoRootPath,
    name: typeof req.name === 'string' ? req.name : undefined,
    full_name: typeof req.fullName === 'string' ? req.fullName : undefined,
    kind: typeof req.kind === 'string' ? req.kind : undefined,
  };
}

export function fromWireGitCheckoutBranchResponse(resp: wire_git_checkout_branch_resp): GitCheckoutBranchResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
  };
}

export function toWireGitSwitchDetachedRequest(req: GitSwitchDetachedRequest): wire_git_switch_detached_req {
  return {
    repo_root_path: req.repoRootPath,
    target_ref: req.targetRef,
  };
}

export function fromWireGitSwitchDetachedResponse(resp: wire_git_switch_detached_resp): GitSwitchDetachedResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
    detached: typeof resp?.detached === 'boolean' ? resp.detached : undefined,
  };
}

export function toWireGitPreviewDeleteBranchRequest(req: GitPreviewDeleteBranchRequest): wire_git_preview_delete_branch_req {
  return {
    repo_root_path: req.repoRootPath,
    name: typeof req.name === 'string' ? req.name : undefined,
    full_name: typeof req.fullName === 'string' ? req.fullName : undefined,
    kind: typeof req.kind === 'string' ? req.kind : undefined,
  };
}

export function fromWireGitPreviewDeleteBranchResponse(resp: wire_git_preview_delete_branch_resp): GitPreviewDeleteBranchResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    name: typeof resp?.name === 'string' ? resp.name : undefined,
    fullName: typeof resp?.full_name === 'string' ? resp.full_name : undefined,
    kind: typeof resp?.kind === 'string' ? resp.kind : undefined,
    linkedWorktree: fromWireGitDeleteLinkedWorktreePreview(resp?.linked_worktree),
    requiresWorktreeRemoval: Boolean(resp?.requires_worktree_removal),
    requiresDiscardConfirmation: Boolean(resp?.requires_discard_confirmation),
    safeDeleteAllowed: Boolean(resp?.safe_delete_allowed),
    safeDeleteBaseRef: typeof resp?.safe_delete_base_ref === 'string' ? resp.safe_delete_base_ref : undefined,
    safeDeleteReason: typeof resp?.safe_delete_reason === 'string' ? resp.safe_delete_reason : undefined,
    forceDeleteAllowed: Boolean(resp?.force_delete_allowed),
    forceDeleteRequiresConfirm: Boolean(resp?.force_delete_requires_confirm),
    forceDeleteReason: typeof resp?.force_delete_reason === 'string' ? resp.force_delete_reason : undefined,
    blockingReason: typeof resp?.blocking_reason === 'string' ? resp.blocking_reason : undefined,
    planFingerprint: typeof resp?.plan_fingerprint === 'string' ? resp.plan_fingerprint : undefined,
  };
}

export function toWireGitDeleteBranchRequest(req: GitDeleteBranchRequest): wire_git_delete_branch_req {
  return {
    repo_root_path: req.repoRootPath,
    name: typeof req.name === 'string' ? req.name : undefined,
    full_name: typeof req.fullName === 'string' ? req.fullName : undefined,
    kind: typeof req.kind === 'string' ? req.kind : undefined,
    delete_mode: typeof req.deleteMode === 'string' ? req.deleteMode : undefined,
    confirm_branch_name: typeof req.confirmBranchName === 'string' ? req.confirmBranchName : undefined,
    remove_linked_worktree: Boolean(req.removeLinkedWorktree),
    discard_linked_worktree_changes: Boolean(req.discardLinkedWorktreeChanges),
    plan_fingerprint: typeof req.planFingerprint === 'string' ? req.planFingerprint : undefined,
  };
}

export function fromWireGitDeleteBranchResponse(resp: wire_git_delete_branch_resp): GitDeleteBranchResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
    linkedWorktreeRemoved: Boolean(resp?.linked_worktree_removed),
    removedWorktreePath: typeof resp?.removed_worktree_path === 'string' ? resp.removed_worktree_path : undefined,
  };
}

export function toWireGitPreviewMergeBranchRequest(req: GitPreviewMergeBranchRequest): wire_git_preview_merge_branch_req {
  return {
    repo_root_path: req.repoRootPath,
    name: typeof req.name === 'string' ? req.name : undefined,
    full_name: typeof req.fullName === 'string' ? req.fullName : undefined,
    kind: typeof req.kind === 'string' ? req.kind : undefined,
  };
}

export function fromWireGitPreviewMergeBranchResponse(resp: wire_git_preview_merge_branch_resp): GitPreviewMergeBranchResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    currentRef: typeof resp?.current_ref === 'string' ? resp.current_ref : undefined,
    currentCommit: typeof resp?.current_commit === 'string' ? resp.current_commit : undefined,
    sourceName: typeof resp?.source_name === 'string' ? resp.source_name : undefined,
    sourceFullName: typeof resp?.source_full_name === 'string' ? resp.source_full_name : undefined,
    sourceKind: typeof resp?.source_kind === 'string' ? resp.source_kind : undefined,
    sourceCommit: typeof resp?.source_commit === 'string' ? resp.source_commit : undefined,
    mergeBase: typeof resp?.merge_base === 'string' ? resp.merge_base : undefined,
    sourceAheadCount: typeof resp?.source_ahead_count === 'number' ? resp.source_ahead_count : undefined,
    sourceBehindCount: typeof resp?.source_behind_count === 'number' ? resp.source_behind_count : undefined,
    outcome: typeof resp?.outcome === 'string' ? resp.outcome : undefined,
    blockingReason: typeof resp?.blocking_reason === 'string' ? resp.blocking_reason : undefined,
    blocking: fromWireGitMutationBlocker(resp?.blocking),
    planFingerprint: typeof resp?.plan_fingerprint === 'string' ? resp.plan_fingerprint : undefined,
    files: Array.isArray(resp?.files) ? resp.files.map(fromWireGitCommitFileSummary) : [],
    linkedWorktree: fromWireGitLinkedWorktreeSnapshot(resp?.linked_worktree),
  };
}

export function toWireGitMergeBranchRequest(req: GitMergeBranchRequest): wire_git_merge_branch_req {
  return {
    repo_root_path: req.repoRootPath,
    name: typeof req.name === 'string' ? req.name : undefined,
    full_name: typeof req.fullName === 'string' ? req.fullName : undefined,
    kind: typeof req.kind === 'string' ? req.kind : undefined,
    plan_fingerprint: typeof req.planFingerprint === 'string' ? req.planFingerprint : undefined,
  };
}

export function fromWireGitMergeBranchResponse(resp: wire_git_merge_branch_resp): GitMergeBranchResponse {
  return {
    repoRootPath: String(resp?.repo_root_path ?? ''),
    headRef: typeof resp?.head_ref === 'string' ? resp.head_ref : undefined,
    headCommit: typeof resp?.head_commit === 'string' ? resp.head_commit : undefined,
    result: typeof resp?.result === 'string' ? resp.result : undefined,
    conflictSummary: fromWireGitWorkspaceSummary(resp?.conflict_summary),
  };
}
