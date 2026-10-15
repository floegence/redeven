import type { EnvAppTranslationKey } from '../i18n/locales';

export type FilePreviewErrorType =
  | 'type_changed'
  | 'not_found'
  | 'permission_denied'
  | 'file_too_large'
  | 'unsupported'
  | 'render_error'
  | 'connection_error'
  | 'generic_error';

export interface FilePreviewErrorMeta {
  type: FilePreviewErrorType;
  title: string;
  description: string;
  titleKey: EnvAppTranslationKey;
  descriptionKey: EnvAppTranslationKey;
}

function lower(value: string | null | undefined): string {
  return (value ?? '').toLowerCase();
}

export function classifyFilePreviewError(error: unknown): FilePreviewErrorType {
  const record = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown; message?: unknown } : null;
  const code = typeof record?.code === 'string' ? record.code.toUpperCase() : '';
  if (['EACCES', 'EPERM', 'PERMISSION_DENIED', 'READ_DENIED', 'PATH_OUTSIDE_SCOPE'].includes(code)) return 'permission_denied';
  if (['ENOENT', 'NOT_FOUND'].includes(code)) return 'not_found';
  if (['EISDIR', 'ENOTDIR', 'PATH_NOT_FILE', 'PATH_NOT_DIRECTORY'].includes(code)) return 'type_changed';
  const status = Number(record?.status ?? record?.code);
  if (status === 403 || status === 401) return 'permission_denied';
  if (status === 404 || status === 410) return 'not_found';
  if (status === 413) return 'file_too_large';
  if (status === 415) return 'unsupported';
  if (status === 409) return 'type_changed';
  if (status >= 500) return 'connection_error';
  const msg = lower(typeof error === 'string' ? error : typeof record?.message === 'string' ? record.message : '');

  if (status === 400 && !['path is a directory', 'path is not a directory'].includes(msg)) return 'generic_error';
  if (!msg) return 'generic_error';
  if (msg.includes('not a file') || msg.includes('must reference a file') || msg.includes('is a directory') || msg.includes('is not a directory')) return 'type_changed';

  if (msg.includes('not found') || msg.includes('404') || msg.includes('no such file')) {
    return 'not_found';
  }

  if (
    msg.includes('permission denied')
    || msg.includes('access denied')
    || msg.includes('403')
    || msg.includes('eacces')
    || msg.includes('not permitted')
  ) {
    return 'permission_denied';
  }

  if (msg.includes('too large') || msg.includes('oversized')) {
    return 'file_too_large';
  }

  if (
    msg.includes('cannot preview a directory')
    || msg.includes('directory link')
    || msg.includes('symbolic link')
    || msg.includes('binary file')
    || msg.includes('preview not available')
    || msg.includes('preview is not available')
    || msg.includes('no worksheet found')
  ) {
    return 'unsupported';
  }

  if (
    msg.includes('failed to render')
    || msg.includes('failed to load pdf')
    || msg.includes('renderasync')
  ) {
    return 'render_error';
  }

  if (
    msg.includes('failed to fetch')
    || msg.includes('load failed')
    || msg.includes('connection')
    || msg.includes('waiting for connection')
    || msg.includes('network')
    || msg.includes('econnrefused')
    || msg.includes('enotfound')
    || msg.includes('timeout')
  ) {
    return 'connection_error';
  }

  return 'generic_error';
}

const ERROR_META: Record<FilePreviewErrorType, { title: string; description: string; titleKey: EnvAppTranslationKey; descriptionKey: EnvAppTranslationKey }> = {
  type_changed: {
    title: 'File type changed',
    description: 'The current object cannot be opened as a file. Browse its parent folder to inspect it.',
    titleKey: 'filePreview.errorTypeChangedTitle',
    descriptionKey: 'filePreview.errorTypeChangedDescription',
  },
  not_found: {
    title: 'File not found',
    description: 'It may have been moved, deleted, or disconnected.',
    titleKey: 'filePreview.errorFileNotFoundTitle',
    descriptionKey: 'filePreview.errorFileNotFoundDescription',
  },
  permission_denied: {
    title: 'Access denied',
    description: "You don't have permission to view this file.",
    titleKey: 'filePreview.errorAccessDeniedTitle',
    descriptionKey: 'filePreview.errorAccessDeniedDescription',
  },
  file_too_large: {
    title: 'File too large to preview',
    description: 'Try opening a smaller file.',
    titleKey: 'filePreview.errorFileTooLargeTitle',
    descriptionKey: 'filePreview.errorFileTooLargeDescription',
  },
  unsupported: {
    title: 'Preview not available',
    description: 'This file type cannot be previewed.',
    titleKey: 'filePreview.errorUnsupportedTitle',
    descriptionKey: 'filePreview.errorUnsupportedDescription',
  },
  render_error: {
    title: 'Failed to render preview',
    description: 'An error occurred while rendering the file content.',
    titleKey: 'filePreview.errorRenderTitle',
    descriptionKey: 'filePreview.errorRenderDescription',
  },
  connection_error: {
    title: 'Connection unavailable',
    description: 'Unable to reach the remote file system.',
    titleKey: 'filePreview.errorConnectionTitle',
    descriptionKey: 'filePreview.errorConnectionDescription',
  },
  generic_error: {
    title: 'Failed to load file',
    description: 'An unexpected error occurred.',
    titleKey: 'filePreview.errorGenericTitle',
    descriptionKey: 'filePreview.errorGenericDescription',
  },
};

export function getFilePreviewErrorMeta(type: FilePreviewErrorType): FilePreviewErrorMeta {
  const meta = ERROR_META[type];
  return { type, ...meta };
}
