import type {
  wire_fs_copy_req,
  wire_fs_copy_resp,
  wire_fs_delete_req,
  wire_fs_delete_resp,
  wire_fs_get_home_resp,
  wire_fs_list_req,
  wire_fs_list_resp,
  wire_fs_read_file_req,
  wire_fs_read_file_resp,
  wire_fs_rename_req,
  wire_fs_rename_resp,
  wire_fs_write_file_req,
  wire_fs_write_file_resp,
} from '../wire/fs';
import type {
  FsCopyRequest,
  FsCopyResponse,
  FsDeleteRequest,
  FsDeleteResponse,
  FsGetHomeResponse,
  FsListRequest,
  FsListResponse,
  FsReadFileRequest,
  FsReadFileResponse,
  FsRenameRequest,
  FsRenameResponse,
  FsWriteFileRequest,
  FsWriteFileResponse,
} from '../sdk/fs';

export function toWireFsListRequest(req: FsListRequest): wire_fs_list_req {
  return {
    path: req.path,
    show_hidden: typeof req.showHidden === 'boolean' ? req.showHidden : undefined,
  };
}

export function fromWireFsListResponse(resp: wire_fs_list_resp): FsListResponse {
  const entries = Array.isArray(resp?.entries) ? resp.entries : [];
  return {
    entries: entries.map((e) => ({
      name: String(e?.name ?? ''),
      path: String(e?.path ?? ''),
      isDirectory: Boolean(e?.is_directory ?? false),
      size: Number(e?.size ?? 0),
      modifiedAt: Number(e?.modified_at ?? 0),
      createdAt: Number(e?.created_at ?? 0),
      permissions: typeof e?.permissions === 'string' ? e.permissions : undefined,
    })),
  };
}

export function toWireFsReadFileRequest(req: FsReadFileRequest): wire_fs_read_file_req {
  return {
    path: req.path,
    encoding: req.encoding,
  };
}

export function fromWireFsReadFileResponse(resp: wire_fs_read_file_resp): FsReadFileResponse {
  return {
    content: String(resp?.content ?? ''),
    encoding: String(resp?.encoding ?? 'utf8'),
  };
}

export function toWireFsWriteFileRequest(req: FsWriteFileRequest): wire_fs_write_file_req {
  return {
    path: req.path,
    content: req.content,
    encoding: req.encoding,
    create_dirs: typeof req.createDirs === 'boolean' ? req.createDirs : undefined,
  };
}

export function fromWireFsWriteFileResponse(resp: wire_fs_write_file_resp): FsWriteFileResponse {
  return { success: Boolean(resp?.success ?? false) };
}

export function toWireFsDeleteRequest(req: FsDeleteRequest): wire_fs_delete_req {
  return {
    path: req.path,
    recursive: typeof req.recursive === 'boolean' ? req.recursive : undefined,
  };
}

export function fromWireFsDeleteResponse(resp: wire_fs_delete_resp): FsDeleteResponse {
  return { success: Boolean(resp?.success ?? false) };
}

export function toWireFsRenameRequest(req: FsRenameRequest): wire_fs_rename_req {
  return {
    old_path: req.oldPath,
    new_path: req.newPath,
  };
}

export function fromWireFsRenameResponse(resp: wire_fs_rename_resp): FsRenameResponse {
  return {
    success: Boolean(resp?.success ?? false),
    newPath: String(resp?.new_path ?? ''),
  };
}

export function toWireFsCopyRequest(req: FsCopyRequest): wire_fs_copy_req {
  return {
    source_path: req.sourcePath,
    dest_path: req.destPath,
    overwrite: typeof req.overwrite === 'boolean' ? req.overwrite : undefined,
  };
}

export function fromWireFsCopyResponse(resp: wire_fs_copy_resp): FsCopyResponse {
  return {
    success: Boolean(resp?.success ?? false),
    newPath: String(resp?.new_path ?? ''),
  };
}

export function fromWireFsGetHomeResponse(resp: wire_fs_get_home_resp): FsGetHomeResponse {
  return { path: String(resp?.path ?? '') };
}

