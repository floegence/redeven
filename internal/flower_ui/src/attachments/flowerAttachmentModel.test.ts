import { describe, expect, it } from 'vitest';

import {
  FLOWER_INLINE_TEXT_CODE_POINT_LIMIT,
  decideFlowerTextPaste,
  flowerStringHasIsolatedSurrogate,
  inspectFlowerText,
  normalizeFlowerUploadProgress,
  replaceFlowerTextSelection,
} from './flowerAttachmentModel';

describe('flowerAttachmentModel', () => {
  it('counts Unicode code points without splitting surrogate pairs', () => {
    expect(inspectFlowerText('a'.repeat(49_999))?.codePoints).toBe(49_999);
    expect(inspectFlowerText('a'.repeat(50_000))?.codePoints).toBe(50_000);
    expect(inspectFlowerText(`${'a'.repeat(49_999)}😀`)?.codePoints).toBe(50_000);
    expect(inspectFlowerText(`${'a'.repeat(50_000)}😀`)?.codePoints).toBe(50_001);
  });

  it('rejects isolated UTF-16 surrogates before encoding', () => {
    expect(flowerStringHasIsolatedSurrogate('\ud800')).toBe(true);
    expect(flowerStringHasIsolatedSurrogate('\udc00')).toBe(true);
    expect(inspectFlowerText(`valid😀\ud800`)).toBeNull();
  });

  it('counts CRLF as two code points and one line break', () => {
    expect(inspectFlowerText('a\r\nb\rc\nd')).toEqual({
      codePoints: 8,
      lines: 4,
      sizeBytes: 8,
    });
    expect(inspectFlowerText('')).toEqual({ codePoints: 0, lines: 0, sizeBytes: 0 });
  });

  it('attaches only an individually over-limit paste payload', () => {
    const payload = '粘'.repeat(FLOWER_INLINE_TEXT_CODE_POINT_LIMIT + 1);
    expect(decideFlowerTextPaste({
      value: 'keep selected suffix',
      payload,
      selectionStart: 5,
      selectionEnd: 14,
    })).toMatchObject({
      kind: 'attach_payload',
      value: 'keep suffix',
      payload,
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  it('keeps cumulative overflow in the editor until explicit submission', () => {
    const value = 'a'.repeat(49_999);
    const decision = decideFlowerTextPaste({
      value,
      payload: 'bc',
      selectionStart: value.length,
      selectionEnd: value.length,
    });
    expect(decision).toMatchObject({
      kind: 'keep_editor',
      overLimit: true,
      value: `${value}bc`,
    });
  });

  it('restores text into the current selection without replacing surrounding instructions', () => {
    expect(replaceFlowerTextSelection('before selected after', 'payload', 7, 15)).toEqual({
      value: 'before payload after',
      selectionStart: 14,
      selectionEnd: 14,
    });
  });

  it('accepts only coherent determinate and indeterminate progress', () => {
    expect(normalizeFlowerUploadProgress({
      attempt_id: 'attempt-1',
      loaded: 4,
      total: 8,
      indeterminate: false,
    })).toEqual({ attempt_id: 'attempt-1', loaded: 4, total: 8, indeterminate: false });
    expect(normalizeFlowerUploadProgress({
      attempt_id: 'attempt-1',
      loaded: 4,
      indeterminate: true,
    })).toEqual({ attempt_id: 'attempt-1', loaded: 4, indeterminate: true });
    expect(normalizeFlowerUploadProgress({
      attempt_id: 'attempt-1',
      loaded: 9,
      total: 8,
      indeterminate: false,
    })).toBeNull();
    expect(normalizeFlowerUploadProgress({
      attempt_id: 'attempt-1',
      loaded: 4,
      total: 8,
      indeterminate: true,
    })).toBeNull();
  });
});
