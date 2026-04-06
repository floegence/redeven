import { describe, expect, it } from 'vitest';

import { buildCodexAdaptedFileChange } from './fileChangeDiff';

describe('buildCodexAdaptedFileChange', () => {
  it('treats plain new-file content as added lines in a synthetic git patch', () => {
    const patch = buildCodexAdaptedFileChange({
      path: 'src/ui/codex/CodexFileChangeDiff.tsx',
      kind: 'new',
      diff: [
        'export function Example() {',
        '  return <div />;',
        '}',
      ].join('\n'),
    });

    expect(patch.changeKind).toBe('added');
    expect(patch.file.changeType).toBe('added');
    expect(patch.file.displayPath).toBe('src/ui/codex/CodexFileChangeDiff.tsx');
    expect(patch.file.newPath).toBe('src/ui/codex/CodexFileChangeDiff.tsx');
    expect(patch.file.patchText).toContain('diff --git a/src/ui/codex/CodexFileChangeDiff.tsx b/src/ui/codex/CodexFileChangeDiff.tsx');
    expect(patch.file.patchText).toContain('new file mode 100644');
    expect(patch.file.patchText).toContain('@@ -0,0 +1,3 @@');
    expect(patch.file.patchText).toContain('+export function Example() {');
    expect(patch.file.patchText).toContain('+  return <div />;');
    expect(patch.file.additions).toBe(3);
    expect(patch.file.deletions).toBe(0);
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
    const patch = buildCodexAdaptedFileChange({
      path: 'src/app.ts',
      kind: 'update',
      diff,
    });

    expect(patch.file.patchText).toBe(diff);
    expect(patch.file.additions).toBe(1);
    expect(patch.file.deletions).toBe(1);
  });

  it('wraps patch-like diff bodies with file headers when upstream omits them', () => {
    const patch = buildCodexAdaptedFileChange({
      path: 'src/app.ts',
      kind: 'update',
      diff: [
        '@@ -1 +1 @@',
        '-before();',
        '+after();',
      ].join('\n'),
    });

    expect(patch.file.patchText).toContain('diff --git a/src/app.ts b/src/app.ts');
    expect(patch.file.patchText).toContain('--- a/src/app.ts');
    expect(patch.file.patchText).toContain('+++ b/src/app.ts');
    expect(patch.file.patchText).toContain('@@ -1 +1 @@');
    expect(patch.file.additions).toBe(1);
    expect(patch.file.deletions).toBe(1);
  });

  it('maps rename payloads onto shared git diff summary fields', () => {
    const patch = buildCodexAdaptedFileChange({
      path: 'src/old.ts',
      move_path: 'src/new.ts',
      kind: 'rename',
      diff: [
        '@@ -1 +1 @@',
        '-before();',
        '+after();',
      ].join('\n'),
    });

    expect(patch.changeKind).toBe('renamed');
    expect(patch.file.changeType).toBe('renamed');
    expect(patch.file.path).toBe('src/old.ts');
    expect(patch.file.oldPath).toBe('src/old.ts');
    expect(patch.file.newPath).toBe('src/new.ts');
    expect(patch.file.displayPath).toBe('src/new.ts');
    expect(patch.file.patchText).toContain('rename from src/old.ts');
    expect(patch.file.patchText).toContain('rename to src/new.ts');
  });
});
