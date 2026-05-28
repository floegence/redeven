import type { EnvAppTranslationKey } from '../i18n/locales';

export type FilePreviewErrorType =
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

export function classifyFilePreviewError(message: string | null | undefined): FilePreviewErrorType {
  const msg = lower(message);

  if (!msg) return 'generic_error';

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
    msg.includes('connection')
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
  not_found: {
    title: 'File not found',
    description: 'The file may have been moved, deleted, or renamed.',
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
