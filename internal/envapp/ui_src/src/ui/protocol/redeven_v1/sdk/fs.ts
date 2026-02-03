export type FsEncoding = 'utf8' | 'base64';

export interface FsFileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
  createdAt: number;
  permissions?: string;
}

export interface FsGetHomeResponse {
  path: string;
}

export interface FsListRequest {
  path: string;
  showHidden?: boolean;
}

export interface FsListResponse {
  entries: FsFileInfo[];
}

export interface FsReadFileRequest {
  path: string;
  encoding?: FsEncoding;
}

export interface FsReadFileResponse {
  content: string;
  encoding: FsEncoding | string;
}

export interface FsWriteFileRequest {
  path: string;
  content: string;
  encoding?: FsEncoding;
  createDirs?: boolean;
}

export interface FsWriteFileResponse {
  success: boolean;
}

export interface FsDeleteRequest {
  path: string;
  recursive?: boolean;
}

export interface FsDeleteResponse {
  success: boolean;
}

export interface FsRenameRequest {
  oldPath: string;
  newPath: string;
}

export interface FsRenameResponse {
  success: boolean;
  newPath: string;
}

export interface FsCopyRequest {
  sourcePath: string;
  destPath: string;
  overwrite?: boolean;
}

export interface FsCopyResponse {
  success: boolean;
  newPath: string;
}

