import { describe, expect, it, vi } from 'vitest';

import { createCodexComposerFileIndex } from './composerFileIndex';

describe('composerFileIndex', () => {
  it('indexes files recursively and ranks matching results', async () => {
    const listDirectory = vi.fn(async (path: string) => {
      switch (path) {
        case '/workspace':
          return [
            { name: 'src', path: '/workspace/src', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1 },
            { name: 'README.md', path: '/workspace/README.md', isDirectory: false, size: 10, modifiedAt: 1, createdAt: 1 },
          ];
        case '/workspace/src':
          return [
            { name: 'codex.css', path: '/workspace/src/codex.css', isDirectory: false, size: 10, modifiedAt: 1, createdAt: 1 },
            { name: 'CodexComposerShell.tsx', path: '/workspace/src/CodexComposerShell.tsx', isDirectory: false, size: 10, modifiedAt: 1, createdAt: 1 },
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
            { name: '.git', path: '/workspace/.git', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1 },
            { name: 'src', path: '/workspace/src', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1 },
          ];
        case '/workspace/src':
          return [
            { name: 'app.tsx', path: '/workspace/src/app.tsx', isDirectory: false, size: 10, modifiedAt: 1, createdAt: 1 },
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
