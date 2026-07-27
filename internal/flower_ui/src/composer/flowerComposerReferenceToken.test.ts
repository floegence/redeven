import { describe, expect, it } from 'vitest';

import {
  findFlowerComposerReferenceToken,
  replaceFlowerComposerReferenceToken,
} from './flowerComposerReferenceToken';

describe('findFlowerComposerReferenceToken', () => {
  it.each([
    ['@src', 4, 0, 4, 'src'],
    ['Please inspect @src/main.ts', 27, 15, 27, 'src/main.ts'],
    ['Please inspect\n@src/main.ts', 27, 15, 27, 'src/main.ts'],
    ['Please inspect\u3000@src', 19, 15, 19, 'src'],
    ['🙂 @src', 7, 3, 7, 'src'],
  ])('finds a token in %j', (text, cursor, start, end, query) => {
    expect(findFlowerComposerReferenceToken({
      text,
      selectionStart: cursor,
      selectionEnd: cursor,
    })).toEqual({
      range: { start, end },
      queryRange: { start: start + 1, end: cursor },
      query,
    });
  });

  it('keeps the full token range when the caret edits the middle of a query', () => {
    expect(findFlowerComposerReferenceToken({
      text: 'Use @src/components now',
      selectionStart: 8,
      selectionEnd: 8,
    })).toEqual({
      range: { start: 4, end: 19 },
      queryRange: { start: 5, end: 8 },
      query: 'src',
    });
  });

  it('opens an empty query when the caret is on the at sign', () => {
    expect(findFlowerComposerReferenceToken({
      text: 'Use @src',
      selectionStart: 4,
      selectionEnd: 4,
    })).toEqual({
      range: { start: 4, end: 8 },
      queryRange: { start: 5, end: 5 },
      query: '',
    });
  });

  it.each([
    ['person@example.com', 18],
    ['foo@bar', 7],
    ['npm@scope/pkg', 13],
    ['@src next', 9],
  ])('does not trigger for non-reference caret position in %j', (text, cursor) => {
    expect(findFlowerComposerReferenceToken({
      text,
      selectionStart: cursor,
      selectionEnd: cursor,
    })).toBeUndefined();
  });

  it('does not trigger while composing or while text is selected', () => {
    expect(findFlowerComposerReferenceToken({
      text: '@src',
      selectionStart: 4,
      selectionEnd: 4,
      isComposing: true,
    })).toBeUndefined();
    expect(findFlowerComposerReferenceToken({
      text: '@src',
      selectionStart: 1,
      selectionEnd: 4,
    })).toBeUndefined();
  });
});

describe('replaceFlowerComposerReferenceToken', () => {
  it.each([
    ['@src inspect it', { start: 0, end: 4 }, 'inspect it', 0],
    ['Inspect @src', { start: 8, end: 12 }, 'Inspect', 7],
    ['Inspect @src next', { start: 8, end: 12 }, 'Inspect next', 8],
    ['Inspect\n@src\nnext', { start: 8, end: 12 }, 'Inspect\n\nnext', 8],
    ['a@src', { start: 1, end: 5 }, 'a', 1],
  ])('replaces one complete token without damaging surrounding text', (text, range, expected, cursor) => {
    expect(replaceFlowerComposerReferenceToken(text, range)).toEqual({ text: expected, cursor });
  });

  it('clamps malformed offsets to code point boundaries', () => {
    expect(replaceFlowerComposerReferenceToken('🙂@src', { start: 1, end: 6 })).toEqual({
      text: '',
      cursor: 0,
    });
  });
});
