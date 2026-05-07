import { describe, expect, it } from 'vitest';

import {
  REDEVEN_FILE_PREVIEW_LIMITS,
  getRedevenFilePreviewOversizedMessage,
  getRedevenFilePreviewReadPlan,
} from './readPlan';

describe('Redeven file preview read plan', () => {
  it('keeps text previews truncatable while rejecting oversized rich previews before download', () => {
    expect(getRedevenFilePreviewReadPlan({ mode: 'text' })).toEqual({
      maxBytes: REDEVEN_FILE_PREVIEW_LIMITS.textMaxBytes,
      readBytes: REDEVEN_FILE_PREVIEW_LIMITS.textMaxBytes,
      rejectOversizedBeforeRead: false,
      oversizedMessage: 'This file is too large to preview.',
    });

    expect(getRedevenFilePreviewReadPlan({ mode: 'pdf' })).toEqual({
      maxBytes: REDEVEN_FILE_PREVIEW_LIMITS.defaultMaxBytes,
      readBytes: REDEVEN_FILE_PREVIEW_LIMITS.defaultMaxBytes,
      rejectOversizedBeforeRead: true,
      oversizedMessage: 'This PDF is too large to preview.',
    });

    expect(getRedevenFilePreviewReadPlan({ mode: 'binary' })).toEqual({
      maxBytes: REDEVEN_FILE_PREVIEW_LIMITS.defaultMaxBytes,
      readBytes: REDEVEN_FILE_PREVIEW_LIMITS.sniffBytes,
      rejectOversizedBeforeRead: true,
      oversizedMessage: 'This file is too large to preview.',
    });
  });

  it('centralizes user-facing oversized messages by preview mode', () => {
    expect(getRedevenFilePreviewOversizedMessage('image')).toBe('This image is too large to preview.');
    expect(getRedevenFilePreviewOversizedMessage('docx')).toBe('This document is too large to preview.');
    expect(getRedevenFilePreviewOversizedMessage('xlsx')).toBe('This spreadsheet is too large to preview.');
  });
});
