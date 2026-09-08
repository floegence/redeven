import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { PickerCopy, PickerPathContext } from '@floegence/floe-webapp-core/ui';

export type FilesystemPickerCopy = PickerCopy & Readonly<{
  home: string;
  outsideScope: string;
  permissionDenied: string;
  hostPermissionDenied: string;
  notDirectory: string;
  connectionFailed: string;
}>;

type RuntimeRoot = PickerPathContext['roots'][number] & { kind?: string };
type RuntimePathContext = Omit<PickerPathContext, 'roots'> & { roots: readonly RuntimeRoot[] };

/** Map runtime declarations only. Display Home must never manufacture a root or permission. */
export function mapFilesystemPickerContext(context: RuntimePathContext, copy: Pick<FilesystemPickerCopy, 'home' | 'root'>): PickerPathContext {
  const order = (kind?: string) => kind === 'home' ? 0 : kind === 'computer' ? 1 : 2;
  return {
    homePathAbs: context.homePathAbs,
    defaultRootId: context.defaultRootId,
    roots: context.roots.map((root) => ({
      ...root,
      label: root.kind === 'home' ? copy.home : root.kind === 'computer' ? copy.root : root.label,
    })).sort((left, right) => order(left.kind) - order(right.kind)),
  };
}

export type FilesystemPickerEntry = Readonly<{
  name: string;
  path: string;
  isDirectory: boolean;
  entryType?: 'file' | 'folder' | 'symlink';
  resolvedType?: 'file' | 'folder' | 'broken' | 'unknown';
  size?: number;
  modifiedAt?: number;
}>;

export function mapFilesystemPickerEntries(entries: readonly FilesystemPickerEntry[]): FileItem[] {
  return entries.map((entry): FileItem => ({
    id: entry.path, path: entry.path, name: entry.name,
    type: entry.isDirectory ? 'folder' : 'file',
    size: entry.size,
    modifiedAt: entry.modifiedAt ? new Date(entry.modifiedAt) : undefined,
  })).sort((left, right) => left.type === right.type ? left.name.localeCompare(right.name) : left.type === 'folder' ? -1 : 1);
}

export type FilesystemPathFailure = 'outside_scope' | 'host_permission_denied' | 'permission_denied' | 'not_found' | 'not_directory' | 'invalid_path' | 'transport_error';

/** The RPC and Desktop HTTP adapters preserve the same runtime status/message categories. */
export function classifyFilesystemPathError(error: unknown): FilesystemPathFailure {
  if (!error || typeof error !== 'object') return 'transport_error';
  const candidate = error as { code?: unknown; status?: unknown; message?: unknown };
  const status = Number(candidate.status ?? candidate.code);
  const message = String(candidate.message ?? '').trim().toLowerCase();
  if (status === 403 && message.includes('outside filesystem scope')) return 'outside_scope';
  if (status === 403 && message.includes('host filesystem permission denied')) return 'host_permission_denied';
  if (status === 403) return 'permission_denied';
  if (status === 404) return 'not_found';
  if (status === 400 && message.includes('not a directory')) return 'not_directory';
  if (status === 400 || status === 416) return 'invalid_path';
  return 'transport_error';
}

export function formatFilesystemPickerError(error: unknown, copy: FilesystemPickerCopy): string {
  switch (classifyFilesystemPathError(error)) {
    case 'outside_scope': return copy.outsideScope;
    case 'host_permission_denied': return copy.hostPermissionDenied;
    case 'permission_denied': return copy.permissionDenied;
    case 'not_found': return copy.missingPath;
    case 'not_directory': return copy.notDirectory;
    case 'invalid_path': return copy.invalidPath;
    default: return copy.connectionFailed;
  }
}
