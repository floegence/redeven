export type wire_git_resolve_repo_req = {
  path: string;
};

export type wire_git_resolve_repo_resp = {
  available: boolean;
  repo_root_path?: string;
  head_ref?: string;
  head_commit?: string;
  dirty?: boolean;
};

export type wire_git_workspace_summary = {
  staged_count?: number;
  unstaged_count?: number;
  untracked_count?: number;
  conflicted_count?: number;
};

export type wire_git_get_repo_summary_req = {
  repo_root_path: string;
};

export type wire_git_get_repo_summary_resp = {
  repo_root_path: string;
  worktree_path?: string;
  is_worktree?: boolean;
  head_ref?: string;
  head_commit?: string;
  detached?: boolean;
  upstream_ref?: string;
  ahead_count?: number;
  behind_count?: number;
  stash_count?: number;
  workspace_summary: wire_git_workspace_summary;
};

export type wire_git_workspace_change = {
  section?: string;
  change_type?: string;
  path?: string;
  old_path?: string;
  new_path?: string;
  display_path?: string;
  patch_text?: string;
  patch_truncated?: boolean;
  additions?: number;
  deletions?: number;
  is_binary?: boolean;
};

export type wire_git_list_workspace_changes_req = {
  repo_root_path: string;
};

export type wire_git_list_workspace_changes_resp = {
  repo_root_path: string;
  summary: wire_git_workspace_summary;
  staged: wire_git_workspace_change[];
  unstaged: wire_git_workspace_change[];
  untracked: wire_git_workspace_change[];
  conflicted: wire_git_workspace_change[];
};

export type wire_git_branch_summary = {
  name?: string;
  full_name?: string;
  kind?: string;
  head_commit?: string;
  author_name?: string;
  author_time_ms?: number;
  subject?: string;
  upstream_ref?: string;
  ahead_count?: number;
  behind_count?: number;
  upstream_gone?: boolean;
  current?: boolean;
  worktree_path?: string;
};

export type wire_git_list_branches_req = {
  repo_root_path: string;
};

export type wire_git_list_branches_resp = {
  repo_root_path: string;
  current_ref?: string;
  detached?: boolean;
  local: wire_git_branch_summary[];
  remote: wire_git_branch_summary[];
};

export type wire_git_commit_summary = {
  hash: string;
  short_hash: string;
  parents?: string[];
  author_name?: string;
  author_email?: string;
  author_time_ms?: number;
  subject?: string;
  body_preview?: string;
};

export type wire_git_list_commits_req = {
  repo_root_path: string;
  ref?: string;
  offset?: number;
  limit?: number;
};

export type wire_git_list_commits_resp = {
  repo_root_path: string;
  commits: wire_git_commit_summary[];
  next_offset?: number;
  has_more?: boolean;
};

export type wire_git_commit_detail = {
  hash: string;
  short_hash: string;
  parents?: string[];
  author_name?: string;
  author_email?: string;
  author_time_ms?: number;
  subject?: string;
  body?: string;
};

export type wire_git_commit_file_summary = {
  change_type?: string;
  path?: string;
  old_path?: string;
  new_path?: string;
  display_path?: string;
  patch_text?: string;
  patch_truncated?: boolean;
  additions?: number;
  deletions?: number;
  is_binary?: boolean;
};

export type wire_git_get_commit_detail_req = {
  repo_root_path: string;
  commit: string;
};

export type wire_git_get_commit_detail_resp = {
  repo_root_path: string;
  commit: wire_git_commit_detail;
  files: wire_git_commit_file_summary[];
};

export type wire_git_get_branch_compare_req = {
  repo_root_path: string;
  base_ref: string;
  target_ref: string;
  limit?: number;
};

export type wire_git_get_branch_compare_resp = {
  repo_root_path: string;
  base_ref: string;
  target_ref: string;
  merge_base?: string;
  target_ahead_count?: number;
  target_behind_count?: number;
  commits: wire_git_commit_summary[];
  files: wire_git_commit_file_summary[];
};
