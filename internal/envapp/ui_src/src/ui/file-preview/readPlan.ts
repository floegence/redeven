import type { FilePreviewDescriptor, PreviewMode } from '../utils/filePreview';

export const REDEVEN_FILE_PREVIEW_LIMITS = {
  defaultMaxBytes: 20 * 1024 * 1024,
  textMaxBytes: 2 * 1024 * 1024,
  sniffBytes: 64 * 1024,
} as const;

export type RedevenFilePreviewReadPlan = Readonly<{
  maxBytes: number;
  readBytes: number;
  rejectOversizedBeforeRead: boolean;
  oversizedMessage: string;
}>;

export function getRedevenFilePreviewOversizedMessage(mode: PreviewMode): string {
  switch (mode) {
    case 'image':
      return 'This image is too large to preview.';
    case 'pdf':
      return 'This PDF is too large to preview.';
    case 'docx':
      return 'This document is too large to preview.';
    case 'xlsx':
      return 'This spreadsheet is too large to preview.';
    default:
      return 'This file is too large to preview.';
  }
}

export function getRedevenFilePreviewReadPlan(descriptor: FilePreviewDescriptor): RedevenFilePreviewReadPlan {
  if (descriptor.mode === 'text') {
    return {
      maxBytes: REDEVEN_FILE_PREVIEW_LIMITS.textMaxBytes,
      readBytes: REDEVEN_FILE_PREVIEW_LIMITS.textMaxBytes,
      rejectOversizedBeforeRead: false,
      oversizedMessage: getRedevenFilePreviewOversizedMessage('text'),
    };
  }

  if (descriptor.mode === 'binary') {
    return {
      maxBytes: REDEVEN_FILE_PREVIEW_LIMITS.defaultMaxBytes,
      readBytes: REDEVEN_FILE_PREVIEW_LIMITS.sniffBytes,
      rejectOversizedBeforeRead: true,
      oversizedMessage: getRedevenFilePreviewOversizedMessage('binary'),
    };
  }

  return {
    maxBytes: REDEVEN_FILE_PREVIEW_LIMITS.defaultMaxBytes,
    readBytes: REDEVEN_FILE_PREVIEW_LIMITS.defaultMaxBytes,
    rejectOversizedBeforeRead: descriptor.mode !== 'unsupported',
    oversizedMessage: getRedevenFilePreviewOversizedMessage(descriptor.mode),
  };
}
