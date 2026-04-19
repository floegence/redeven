export type wire_git_resolve_repo_req = {
  path: string;
};

export type wire_git_resolve_repo_resp = {
  available: boolean;
  git_available: boolean;
  unavailable_reason?: string;
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

export type wire_git_mutation_blocker = {
  kind?: string;
  reason?: string;
  workspace_path?: string;
  workspace_summary: wire_git_workspace_summary;
  operation?: string;
  can_stash_workspace?: boolean;
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
  reattach_branch?: wire_git_branch_summary;
  upstream_ref?: string;
  ahead_count?: number;
  behind_count?: number;
  stash_count?: number;
  workspace_summary: wire_git_workspace_summary;
};

export type wire_git_diff_file_summary = {
  change_type?: string;
  path?: string;
  old_path?: string;
  new_path?: string;
  display_path?: string;
  additions?: number;
  deletions?: number;
  is_binary?: boolean;
};

export type wire_git_diff_file_content = wire_git_diff_file_summary & {
  patch_text?: string;
  patch_truncated?: boolean;
};

export type wire_git_commit_diff_presentation = {
  mode?: string;
  merge_commit?: boolean;
  parent_count?: number;
};

export type wire_git_workspace_change = wire_git_diff_file_summary & {
  section?: string;
  entry_kind?: string;
  parent_path?: string;
  directory_path?: string;
  descendant_file_count?: number;
  contains_untracked?: boolean;
  contains_unstaged?: boolean;
  mutation_paths?: string[];
};

export type wire_git_workspace_breadcrumb = {
  label?: string;
  path?: string;
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

export type wire_git_list_workspace_page_req = {
  repo_root_path: string;
  section?: string;
  directory_path?: string;
  offset?: number;
  limit?: number;
};

export type wire_git_list_workspace_page_resp = {
  repo_root_path: string;
  section?: string;
  directory_path?: string;
  breadcrumbs?: wire_git_workspace_breadcrumb[];
  summary: wire_git_workspace_summary;
  scope_file_count?: number;
  total_count?: number;
  offset?: number;
  next_offset?: number;
  has_more?: boolean;
  items: wire_git_workspace_change[];
};

export type wire_git_list_stashes_req = {
  repo_root_path: string;
};

export type wire_git_stash_summary = {
  id: string;
  ref?: string;
  message?: string;
  branch_name?: string;
  head_commit?: string;
  created_at_unix_ms?: number;
  has_untracked?: boolean;
};

export type wire_git_list_stashes_resp = {
  repo_root_path: string;
  stashes: wire_git_stash_summary[];
};

export type wire_git_get_stash_detail_req = {
  repo_root_path: string;
  id: string;
};

export type wire_git_stash_detail = wire_git_stash_summary & {
  files: wire_git_commit_file_summary[];
};

export type wire_git_get_stash_detail_resp = {
  repo_root_path: string;
  stash: wire_git_stash_detail;
};

export type wire_git_save_stash_req = {
  repo_root_path: string;
  message?: string;
  include_untracked?: boolean;
  keep_index?: boolean;
};

export type wire_git_save_stash_resp = {
  repo_root_path: string;
  head_ref?: string;
  head_commit?: string;
  created?: wire_git_stash_summary;
};

export type wire_git_stage_workspace_req = {
  repo_root_path: string;
  section?: string;
  directory_path?: string;
  paths?: string[];
};

export type wire_git_workspace_mutation_result = {
  requested_count?: number;
  matched_count?: number;
  affected_count?: number;
  remaining_count?: number;
  warnings?: string[];
};

export type wire_git_stage_workspace_resp = {
  repo_root_path: string;
  result?: wire_git_workspace_mutation_result;
};

export type wire_git_unstage_workspace_req = {
  repo_root_path: string;
  section?: string;
  directory_path?: string;
  paths?: string[];
};

export type wire_git_unstage_workspace_resp = {
  repo_root_path: string;
  result?: wire_git_workspace_mutation_result;
};

export type wire_git_discard_workspace_req = {
  repo_root_path: string;
  section?: string;
  directory_path?: string;
  paths?: string[];
};

export type wire_git_discard_workspace_resp = {
  repo_root_path: string;
  result?: wire_git_workspace_mutation_result;
};

export type wire_git_preview_apply_stash_req = {
  repo_root_path: string;
  id: string;
  remove_after_apply?: boolean;
};

export type wire_git_preview_apply_stash_resp = {
  repo_root_path: string;
  head_ref?: string;
  head_commit?: string;
  stash?: wire_git_stash_summary;
  remove_after_apply?: boolean;
  blocking_reason?: string;
  blocking?: wire_git_mutation_blocker;
  plan_fingerprint?: string;
};

export type wire_git_apply_stash_req = {
  repo_root_path: string;
  id: string;
  remove_after_apply?: boolean;
  plan_fingerprint?: string;
};

export type wire_git_apply_stash_resp = {
  repo_root_path: string;
  head_ref?: string;
  head_commit?: string;
};

export type wire_git_preview_drop_stash_req = {
  repo_root_path: string;
  id: string;
};

export type wire_git_preview_drop_stash_resp = {
  repo_root_path: string;
  head_ref?: string;
  head_commit?: string;
  stash?: wire_git_stash_summary;
  plan_fingerprint?: string;
};

export type wire_git_drop_stash_req = {
  repo_root_path: string;
  id: string;
  plan_fingerprint?: string;
};

export type wire_git_drop_stash_resp = {
  repo_root_path: string;
  head_ref?: string;
  head_commit?: string;
};

export type wire_git_linked_worktree_snapshot = {
  worktree_path?: string;
  summary: wire_git_workspace_summary;
  staged: wire_git_workspace_change[];
  unstaged: wire_git_workspace_change[];
  untracked: wire_git_workspace_change[];
  conflicted: wire_git_workspace_change[];
};


export type wire_git_commit_workspace_req = {
  repo_root_path: string;
  message: string;
};

export type wire_git_commit_workspace_resp = {
  repo_root_path: string;
  head_ref?: string;
  head_commit?: string;
};

export type wire_git_fetch_repo_req = {
  repo_root_path: string;
};

export type wire_git_fetch_repo_resp = {
  repo_root_path: string;
  head_ref?: string;
  head_commit?: string;
};

export type wire_git_pull_repo_req = {
  repo_root_path: string;
};

export type wire_git_pull_repo_resp = {
  repo_root_path: string;
  head_ref?: string;
  head_commit?: string;
};

export type wire_git_push_repo_req = {
  repo_root_path: string;
};

export type wire_git_push_repo_resp = {
  repo_root_path: string;
  head_ref?: string;
  head_commit?: string;
};

export type wire_git_checkout_branch_req = {
  repo_root_path: string;
  name?: string;
  full_name?: string;
  kind?: string;
};

export type wire_git_checkout_branch_resp = {
  repo_root_path: string;
  head_ref?: string;
  head_commit?: string;
};

export type wire_git_switch_detached_req = {
  repo_root_path: string;
  target_ref: string;
};

export type wire_git_switch_detached_resp = {
  repo_root_path: string;
  head_ref?: string;
  head_commit?: string;
  detached?: boolean;
};

export type wire_git_preview_delete_branch_req = {
  repo_root_path: string;
  name?: string;
  full_name?: string;
  kind?: string;
};

export type wire_git_delete_linked_worktree_preview = {
  worktree_path?: string;
  accessible: boolean;
  summary: wire_git_workspace_summary;
  staged: wire_git_workspace_change[];
  unstaged: wire_git_workspace_change[];
  untracked: wire_git_workspace_change[];
  conflicted: wire_git_workspace_change[];
};

export type wire_git_preview_delete_branch_resp = {
  repo_root_path: string;
  name?: string;
  full_name?: string;
  kind?: string;
  linked_worktree?: wire_git_delete_linked_worktree_preview;
  requires_worktree_removal: boolean;
  requires_discard_confirmation: boolean;
  safe_delete_allowed: boolean;
  safe_delete_base_ref?: string;
  safe_delete_reason?: string;
  force_delete_allowed: boolean;
  force_delete_requires_confirm: boolean;
  force_delete_reason?: string;
  blocking_reason?: string;
  plan_fingerprint?: string;
};

export type wire_git_delete_branch_req = {
  repo_root_path: string;
  name?: string;
  full_name?: string;
  kind?: string;
  delete_mode?: string;
  confirm_branch_name?: string;
  remove_linked_worktree: boolean;
  discard_linked_worktree_changes: boolean;
  plan_fingerprint?: string;
};

export type wire_git_delete_branch_resp = {
  repo_root_path: string;
  head_ref?: string;
  head_commit?: string;
  linked_worktree_removed: boolean;
  removed_worktree_path?: string;
};

export type wire_git_preview_merge_branch_req = {
  repo_root_path: string;
  name?: string;
  full_name?: string;
  kind?: string;
};

export type wire_git_preview_merge_branch_resp = {
  repo_root_path: string;
  current_ref?: string;
  current_commit?: string;
  source_name?: string;
  source_full_name?: string;
  source_kind?: string;
  source_commit?: string;
  merge_base?: string;
  source_ahead_count?: number;
  source_behind_count?: number;
  outcome?: string;
  blocking_reason?: string;
  blocking?: wire_git_mutation_blocker;
  plan_fingerprint?: string;
  files: wire_git_commit_file_summary[];
  linked_worktree?: wire_git_linked_worktree_snapshot;
};

export type wire_git_merge_branch_req = {
  repo_root_path: string;
  name?: string;
  full_name?: string;
  kind?: string;
  plan_fingerprint?: string;
};

export type wire_git_merge_branch_resp = {
  repo_root_path: string;
  head_ref?: string;
  head_commit?: string;
  result?: string;
  conflict_summary: wire_git_workspace_summary;
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

export type wire_git_commit_file_summary = wire_git_diff_file_summary;

export type wire_git_diff_file_ref = {
  change_type?: string;
  path?: string;
  old_path?: string;
  new_path?: string;
};

export type wire_git_get_commit_detail_req = {
  repo_root_path: string;
  commit: string;
};

export type wire_git_get_commit_detail_resp = {
  repo_root_path: string;
  commit: wire_git_commit_detail;
  presentation?: wire_git_commit_diff_presentation;
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
  linked_worktree?: wire_git_linked_worktree_snapshot;
};

export type wire_git_get_diff_content_req = {
  repo_root_path: string;
  source_kind: string;
  workspace_section?: string;
  commit?: string;
  base_ref?: string;
  target_ref?: string;
  stash_id?: string;
  mode?: string;
  file: wire_git_diff_file_ref;
};

export type wire_git_get_diff_content_resp = {
  repo_root_path: string;
  mode?: string;
  presentation?: wire_git_commit_diff_presentation;
  file: wire_git_diff_file_content;
};
