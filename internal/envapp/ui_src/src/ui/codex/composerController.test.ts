import { describe, expect, it } from 'vitest';

import {
  findComposerMentionToken,
  findComposerSlashCommandToken,
  replaceComposerTextRange,
} from './composerController';

describe('composerController', () => {
  it('detects mention tokens at whitespace boundaries', () => {
    expect(findComposerMentionToken({
      text: 'Review @src/ui/codex',
      selectionStart: 20,
      selectionEnd: 20,
    })).toEqual({
      trigger: '@',
      query: 'src/ui/codex',
      range: { start: 7, end: 20 },
    });
  });

  it('ignores mention tokens in the middle of a word', () => {
    expect(findComposerMentionToken({
      text: 'email@example.com',
      selectionStart: 10,
      selectionEnd: 10,
    })).toBeNull();
  });

  it('detects slash commands only on the first line at column zero', () => {
    expect(findComposerSlashCommandToken({
      text: '/mention file',
      selectionStart: 8,
      selectionEnd: 8,
    })).toEqual({
      trigger: '/',
      query: 'mention',
      range: { start: 0, end: 8 },
    });

    expect(findComposerSlashCommandToken({
      text: '  /mention',
      selectionStart: 10,
      selectionEnd: 10,
    })).toBeNull();

    expect(findComposerSlashCommandToken({
      text: 'hello\n/mention',
      selectionStart: 12,
      selectionEnd: 12,
    })).toBeNull();
  });

  it('replaces text ranges and returns the next selection index', () => {
    expect(replaceComposerTextRange('Review @foo now', { start: 7, end: 11 }, '')).toEqual({
      text: 'Review  now',
      selection: 7,
    });
  });
});
