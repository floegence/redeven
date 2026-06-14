import { describe, expect, it } from 'vitest';

import { resolvePathAgainstWorkingDir } from './askFlowerPath';

describe('resolvePathAgainstWorkingDir', () => {
  it('keeps absolute paths normalized', () => {
    expect(resolvePathAgainstWorkingDir('/workspace/app/src/file.ts', '/workspace/app')).toBe('/workspace/app/src/file.ts');
    expect(resolvePathAgainstWorkingDir('/workspace//app/src/', '/workspace/app')).toBe('/workspace/app/src');
  });

  it('resolves relative paths against the thread working directory', () => {
    expect(resolvePathAgainstWorkingDir('src/file.ts', '/workspace/app')).toBe('/workspace/app/src/file.ts');
    expect(resolvePathAgainstWorkingDir('./src/file.ts', '/workspace/app')).toBe('/workspace/app/src/file.ts');
    expect(resolvePathAgainstWorkingDir('../README.md', '/workspace/app/src')).toBe('/workspace/app/README.md');
  });

  it('returns empty when a relative path has no working directory', () => {
    expect(resolvePathAgainstWorkingDir('src/file.ts', '')).toBe('');
  });
});
