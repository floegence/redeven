import { describe, expect, it } from 'vitest';

import { buildCodexRenderableFilePatch } from './fileChangeDiff';

describe('buildCodexRenderableFilePatch', () => {
  it('treats plain new-file content as added lines in a synthetic git patch', () => {
    const patch = buildCodexRenderableFilePatch({
      path: 'src/ui/codex/CodexFileChangeDiff.tsx',
      kind: 'new',
      diff: [
        'export function Example() {',
        '  return <div />;',
        '}',
      ].join('\n'),
    });

    expect(patch.changeKind).toBe('added');
    expect(patch.patchText).toContain('diff --git a/src/ui/codex/CodexFileChangeDiff.tsx b/src/ui/codex/CodexFileChangeDiff.tsx');
    expect(patch.patchText).toContain('new file mode 100644');
    expect(patch.patchText).toContain('@@ -0,0 +1,3 @@');
    expect(patch.patchText).toContain('+export function Example() {');
    expect(patch.patchText).toContain('+  return <div />;');
    expect(patch.additions).toBe(3);
    expect(patch.deletions).toBe(0);
    expect(patch.renderedLines.filter((line) => line.kind === 'add')).toHaveLength(3);
  });

  it('reuses unified patch text when upstream already provides a full git diff', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1 +1 @@',
      '-before();',
      '+after();',
    ].join('\n');
    const patch = buildCodexRenderableFilePatch({
      path: 'src/app.ts',
      kind: 'update',
      diff,
    });

    expect(patch.patchText).toBe(diff);
    expect(patch.additions).toBe(1);
    expect(patch.deletions).toBe(1);
  });

  it('wraps patch-like diff bodies with file headers when upstream omits them', () => {
    const patch = buildCodexRenderableFilePatch({
      path: 'src/app.ts',
      kind: 'update',
      diff: [
        '@@ -1 +1 @@',
        '-before();',
        '+after();',
      ].join('\n'),
    });

    expect(patch.patchText).toContain('diff --git a/src/app.ts b/src/app.ts');
    expect(patch.patchText).toContain('--- a/src/app.ts');
    expect(patch.patchText).toContain('+++ b/src/app.ts');
    expect(patch.patchText).toContain('@@ -1 +1 @@');
    expect(patch.additions).toBe(1);
    expect(patch.deletions).toBe(1);
  });
});
