import { describe, expect, it } from 'vitest';
import {
  formatFileBrowserPathInputValue,
  parseFileBrowserPathInput,
  pathInputIncludesHiddenSegment,
} from './fileBrowserPathInput';

describe('fileBrowserPathInput', () => {
  it('formats in-root absolute paths using home display syntax', () => {
    expect(formatFileBrowserPathInputValue('/Users/tester/project/src', '/Users/tester')).toBe('~/project/src');
    expect(formatFileBrowserPathInputValue('/Users/tester', '/Users/tester')).toBe('~');
  });

  it('keeps absolute paths when no root is configured', () => {
    expect(formatFileBrowserPathInputValue('/workspace/project/src')).toBe('/workspace/project/src');
  });

  it('parses home-relative input against the configured root', () => {
    expect(parseFileBrowserPathInput('~/project/src', '/Users/tester')).toEqual({
      kind: 'ok',
      absolutePath: '/Users/tester/project/src',
      displayPath: '~/project/src',
    });
  });

  it('parses browser-root-relative display paths against the configured root', () => {
    expect(parseFileBrowserPathInput('/project/src', '/Users/tester')).toEqual({
      kind: 'ok',
      absolutePath: '/Users/tester/project/src',
      displayPath: '~/project/src',
    });
  });

  it('keeps in-root absolute paths unchanged when they are entered explicitly', () => {
    expect(parseFileBrowserPathInput('/Users/tester/project/src', '/Users/tester')).toEqual({
      kind: 'ok',
      absolutePath: '/Users/tester/project/src',
      displayPath: '~/project/src',
    });
  });

  it('rejects relative shell-like input when a root is configured', () => {
    expect(parseFileBrowserPathInput('../project/src', '/Users/tester')).toEqual({
      kind: 'error',
      message: 'Use "/" or "~" to enter a path.',
    });
  });

  it('requires absolute paths when no root is configured', () => {
    expect(parseFileBrowserPathInput('project/src')).toEqual({
      kind: 'error',
      message: 'Enter an absolute path.',
    });
  });

  it('rejects home-relative input when no root is available', () => {
    expect(parseFileBrowserPathInput('~/project/src')).toEqual({
      kind: 'error',
      message: 'Home directory is unavailable.',
    });
  });

  it('detects hidden path segments relative to the configured root', () => {
    expect(pathInputIncludesHiddenSegment('/Users/tester/.config/redeven', '/Users/tester')).toBe(true);
    expect(pathInputIncludesHiddenSegment('/Users/tester/project/src', '/Users/tester')).toBe(false);
    expect(pathInputIncludesHiddenSegment('/outside/.config', '/Users/tester')).toBe(false);
  });
});
