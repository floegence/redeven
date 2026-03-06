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
  patch_path?: string;
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
