import { describe, expect, it } from 'vitest';

import {
  getGitPatchRenderSnapshot,
  gitPatchPreviewLineClass,
  parseGitPatchRenderedLines,
  summarizeGitPatchRenderedLines,
} from './gitPatch';

describe('git patch render snapshots', () => {
  it('caches rendered lines and metrics for repeated patch consumers', () => {
    const patchText = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,2 +1,2 @@',
      ' const keep = true;',
      '-before();',
      '+after();',
    ].join('\n');

    const first = getGitPatchRenderSnapshot(patchText);
    const second = getGitPatchRenderSnapshot(patchText);

    expect(second).toBe(first);
    expect(parseGitPatchRenderedLines(patchText)).toBe(first.renderedLines);
    expect(summarizeGitPatchRenderedLines(patchText)).toEqual({
      additions: 1,
      deletions: 1,
    });
  });
});

it.each(['diff --git a/file b/file', '--- a/file', '+++ b/file', '@@ -1 +1 @@'])('keeps patch metadata on the opaque secondary ink role: %s', line => {
  expect(gitPatchPreviewLineClass(line)).toBe('text-muted-foreground');
});
