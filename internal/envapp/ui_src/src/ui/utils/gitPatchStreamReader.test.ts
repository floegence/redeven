import { describe, expect, it } from 'vitest';

import { parseGitPatchRenderedLines } from './gitPatch';
import { readGitPatchWithFallback } from './gitPatchStreamReader';

describe('readGitPatchWithFallback', () => {
  it('falls back to the full patch and extracts the requested file section when scoped output is blank', async () => {
    const fullPatch = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/src/other.ts b/src/other.ts',
      '--- a/src/other.ts',
      '+++ b/src/other.ts',
      '@@ -2 +2 @@',
      '-before',
      '+after',
    ].join('\n');
    const calls: string[] = [];

    const result = await readGitPatchWithFallback({
      item: { patchPath: 'src/app.ts', path: 'src/app.ts' },
      readByPath: async (filePath) => {
        calls.push(filePath ?? '<all>');
        if (filePath) {
          return {
            text: '\n',
            meta: { ok: true, content_len: 1 },
          };
        }
        return {
          text: fullPatch,
          meta: { ok: true, content_len: fullPatch.length },
        };
      },
    });

    expect(calls).toEqual(['src/app.ts', '<all>']);
    expect(result.text).toContain('diff --git a/src/app.ts b/src/app.ts');
    expect(result.text).toContain('+new');
    expect(result.text).not.toContain('src/other.ts');
  });
});

describe('parseGitPatchRenderedLines', () => {
  it('returns no rows for whitespace-only patch text', () => {
    expect(parseGitPatchRenderedLines('\n\n  \n')).toEqual([]);
  });
});
