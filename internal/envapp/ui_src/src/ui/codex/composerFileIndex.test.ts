import { describe, expect, it, vi } from 'vitest';

import { createCodexComposerFileIndex } from './composerFileIndex';

function makeEntry(params: {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
  createdAt: number;
}) {
  return {
    ...params,
    entryType: params.isDirectory ? 'folder' : 'file',
    resolvedType: params.isDirectory ? 'folder' : 'file',
  } as const;
}

describe('composerFileIndex', () => {
  it('indexes files recursively and ranks matching results', async () => {
    const listDirectory = vi.fn(async (path: string) => {
      switch (path) {
        case '/workspace':
          return [
            makeEntry({ name: 'src', path: '/workspace/src', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1 }),
            makeEntry({ name: 'README.md', path: '/workspace/README.md', isDirectory: false, size: 10, modifiedAt: 1, createdAt: 1 }),
          ];
        case '/workspace/src':
          return [
            makeEntry({ name: 'codex.css', path: '/workspace/src/codex.css', isDirectory: false, size: 10, modifiedAt: 1, createdAt: 1 }),
            makeEntry({ name: 'CodexComposerShell.tsx', path: '/workspace/src/CodexComposerShell.tsx', isDirectory: false, size: 10, modifiedAt: 1, createdAt: 1 }),
          ];
        default:
          return [];
      }
    });
    const index = createCodexComposerFileIndex({ listDirectory });

    await index.ensureIndexed('/workspace');

    expect(index.getSnapshot('/workspace')?.complete).toBe(true);
    expect(index.query('/workspace', 'codex').map((entry) => entry.path)).toEqual([
      '/workspace/src/codex.css',
      '/workspace/src/CodexComposerShell.tsx',
    ]);
  });

  it('skips configured heavy directories', async () => {
    const listDirectory = vi.fn(async (path: string) => {
      switch (path) {
        case '/workspace':
          return [
            makeEntry({ name: '.git', path: '/workspace/.git', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1 }),
            makeEntry({ name: 'src', path: '/workspace/src', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1 }),
          ];
        case '/workspace/src':
          return [
            makeEntry({ name: 'app.tsx', path: '/workspace/src/app.tsx', isDirectory: false, size: 10, modifiedAt: 1, createdAt: 1 }),
          ];
        default:
          return [];
      }
    });
    const index = createCodexComposerFileIndex({ listDirectory });

    await index.ensureIndexed('/workspace');

    expect(listDirectory).toHaveBeenCalledWith('/workspace');
    expect(listDirectory).toHaveBeenCalledWith('/workspace/src');
    expect(listDirectory).not.toHaveBeenCalledWith('/workspace/.git');
    expect(index.query('/workspace', '').map((entry) => entry.path)).toEqual(['/workspace/src/app.tsx']);
  });
});
