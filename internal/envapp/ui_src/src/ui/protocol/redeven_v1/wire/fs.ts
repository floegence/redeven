export type wire_fs_get_home_req = Record<string, never>;
export type wire_fs_get_home_resp = { path: string };

export type wire_fs_list_req = {
  path: string;
  show_hidden?: boolean;
};

export type wire_fs_file_info = {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  modified_at: number;
  created_at: number;
  permissions?: string;
};

export type wire_fs_list_resp = { entries: wire_fs_file_info[] };

export type wire_fs_read_file_req = {
  path: string;
  encoding?: 'utf8' | 'utf-8' | 'base64';
};

export type wire_fs_read_file_resp = {
  content: string;
  encoding: string;
};

export type wire_fs_write_file_req = {
  path: string;
  content: string;
  encoding?: 'utf8' | 'utf-8' | 'base64';
  create_dirs?: boolean;
};

export type wire_fs_write_file_resp = { success: boolean };

export type wire_fs_delete_req = {
  path: string;
  recursive?: boolean;
};

export type wire_fs_delete_resp = { success: boolean };

export type wire_fs_rename_req = {
  old_path: string;
  new_path: string;
};

export type wire_fs_rename_resp = {
  success: boolean;
  new_path: string;
};

export type wire_fs_copy_req = {
  source_path: string;
  dest_path: string;
  overwrite?: boolean;
};

export type wire_fs_copy_resp = {
  success: boolean;
  new_path: string;
};

