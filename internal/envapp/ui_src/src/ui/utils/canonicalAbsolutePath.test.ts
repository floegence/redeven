import { describe, expect, it } from 'vitest';

import { canonicalAbsolutePath } from './canonicalAbsolutePath';

describe('canonicalAbsolutePath', () => {
  it('accepts canonical absolute paths without rewriting them', () => {
    expect(canonicalAbsolutePath('/')).toBe('/');
    expect(canonicalAbsolutePath('/workspace/redeven')).toBe('/workspace/redeven');
  });

  it('rejects aliases and unsafe path forms instead of normalizing them', () => {
    for (const value of [
      'relative/path',
      ' /workspace/repo',
      '/workspace/repo ',
      '/workspace//repo',
      '/workspace/./repo',
      '/workspace/../repo',
      '/workspace/repo/',
      '/workspace\\repo',
      '/workspace/line\nbreak',
    ]) {
      expect(canonicalAbsolutePath(value), value).toBe('');
    }
  });
});
