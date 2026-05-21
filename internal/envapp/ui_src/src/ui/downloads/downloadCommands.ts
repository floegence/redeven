import type { FileItem } from '@floegence/floe-webapp-core/file-browser';

import type { FilePreviewDescriptor } from '../utils/filePreview';
import { getExtDot, mimeFromExtDot } from '../utils/filePreview';
import type { DownloadCommand, DownloadCommandOrigin } from './types';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function fileItemModifiedAtMs(item: FileItem): number | undefined {
  const time = item.modifiedAt?.getTime();
  return typeof time === 'number' && Number.isFinite(time) && time > 0 ? time : undefined;
}

function fileItemSize(item: FileItem): number | undefined {
  return typeof item.size === 'number' && Number.isFinite(item.size)
    ? Math.max(0, Math.floor(item.size))
    : undefined;
}

export function buildRuntimeFileDownloadCommand(
  item: FileItem | null | undefined,
  origin: DownloadCommandOrigin,
): DownloadCommand | null {
  if (!item || item.type !== 'file') {
    return null;
  }
  const path = compact(item.path);
  if (!path) {
    return null;
  }
  const name = compact(item.name) || path.split('/').filter(Boolean).pop() || 'download';
  return {
    entryKind: 'file',
    origin,
    preferredName: name,
    source: {
      kind: 'runtime_file',
      path,
      name,
      size: fileItemSize(item),
      modifiedAt: fileItemModifiedAtMs(item),
      mime: mimeFromExtDot(getExtDot(name)) ?? undefined,
    },
  };
}

export function buildFilePreviewDownloadCommand(params: Readonly<{
  item: FileItem | null | undefined;
  descriptor: FilePreviewDescriptor;
  dirty: boolean;
  draftText: string;
  origin: Extract<DownloadCommandOrigin, 'file_preview' | 'workbench_preview'>;
}>): DownloadCommand | null {
  const item = params.item;
  if (!item || item.type !== 'file') {
    return null;
  }
  const path = compact(item.path);
  if (!path) {
    return null;
  }
  const name = compact(item.name) || path.split('/').filter(Boolean).pop() || 'download';
  const mime = mimeFromExtDot(getExtDot(name)) ?? undefined;

  if (
    params.dirty
    && (params.descriptor.mode === 'text' || params.descriptor.mode === 'markdown')
  ) {
    return {
      entryKind: 'file',
      origin: params.origin,
      preferredName: name,
      source: {
        kind: 'draft_text',
        path,
        name,
        text: params.draftText,
        mime: mime ?? 'text/plain;charset=utf-8',
      },
    };
  }

  return buildRuntimeFileDownloadCommand(item, params.origin);
}
