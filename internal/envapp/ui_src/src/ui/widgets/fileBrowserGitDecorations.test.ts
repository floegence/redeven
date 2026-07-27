import { describe, expect, it } from 'vitest';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { GitListWorkspaceChangesResponse } from '../protocol/redeven_v1';
import {
  applyFileBrowserGitDecorations,
  buildFileBrowserGitDecorationIndex,
  buildFileBrowserGitPathStatusIndex,
} from './fileBrowserGitDecorations';

function workspace(
  changes: Partial<Pick<GitListWorkspaceChangesResponse, 'staged' | 'unstaged' | 'untracked' | 'conflicted'>>,
): GitListWorkspaceChangesResponse {
  return {
    repoRootPath: '/repo',
    summary: {},
    staged: changes.staged ?? [],
    unstaged: changes.unstaged ?? [],
    untracked: changes.untracked ?? [],
    conflicted: changes.conflicted ?? [],
  };
}

function item(path: string, type: FileItem['type'] = 'file', children?: FileItem[]): FileItem {
  const name = path.split('/').filter(Boolean).at(-1) ?? path;
  return {
    id: path,
    path,
    name,
    type,
    children,
  };
}

function badgeLabel(itemValue: FileItem | undefined): string {
  return String(itemValue?.decoration?.badge?.label ?? '');
}

function nameTone(itemValue: FileItem | undefined): string {
  return String(itemValue?.decoration?.nameTone ?? '');
}

describe('fileBrowserGitDecorations', () => {
  it('decorates modified and added files with matching name tones', () => {
    const index = buildFileBrowserGitDecorationIndex('/repo', workspace({
      unstaged: [{ section: 'unstaged', changeType: 'modified', path: 'Makefile' }],
      untracked: [{ section: 'untracked', changeType: 'added', path: 'src/new.ts' }],
    }));

    const decorated = applyFileBrowserGitDecorations([
      item('/repo/Makefile'),
      item('/repo/src', 'folder', [
        item('/repo/src/new.ts'),
      ]),
    ], index);

    expect(badgeLabel(decorated[0])).toBe('M');
    expect(nameTone(decorated[0])).toBe('info');
    expect(badgeLabel(decorated[1]?.children?.[0])).toBe('A');
    expect(nameTone(decorated[1]?.children?.[0])).toBe('success');
  });

  it('aggregates directory decorations and lets modified changes win over added-only changes', () => {
    const index = buildFileBrowserGitDecorationIndex('/repo', workspace({
      unstaged: [{ section: 'unstaged', changeType: 'modified', path: 'app/main.ts' }],
      untracked: [{ section: 'untracked', changeType: 'added', path: 'app/new.ts' }],
    }));

    const decorated = applyFileBrowserGitDecorations([
      item('/repo/app', 'folder'),
    ], index);

    expect(badgeLabel(decorated[0])).toBe('M');
    expect(nameTone(decorated[0])).toBe('info');
  });

  it('marks added-only directories as added', () => {
    const index = buildFileBrowserGitDecorationIndex('/repo', workspace({
      untracked: [
        { section: 'untracked', changeType: 'added', path: 'terminal-web/src/fabric/index.ts' },
      ],
    }));

    const decorated = applyFileBrowserGitDecorations([
      item('/repo/terminal-web', 'folder'),
    ], index);

    expect(badgeLabel(decorated[0])).toBe('A');
    expect(nameTone(decorated[0])).toBe('success');
  });

  it('uses directory workspace entries without scanning descendants', () => {
    const index = buildFileBrowserGitDecorationIndex('/repo', workspace({
      unstaged: [
        {
          section: 'changes',
          entryKind: 'directory',
          directoryPath: 'app',
          containsUnstaged: true,
          containsUntracked: true,
        },
      ],
    }));

    const decorated = applyFileBrowserGitDecorations([
      item('/repo/app', 'folder'),
    ], index);

    expect(badgeLabel(decorated[0])).toBe('M');
  });

  it('keeps mixed directory workspace entries modified even when they contain untracked files', () => {
    const index = buildFileBrowserGitDecorationIndex('/repo', workspace({
      untracked: [
        {
          section: 'untracked',
          entryKind: 'directory',
          directoryPath: 'app',
          containsUnstaged: true,
          containsUntracked: true,
        },
      ],
    }));

    const decorated = applyFileBrowserGitDecorations([
      item('/repo/app', 'folder'),
    ], index);

    expect(badgeLabel(decorated[0])).toBe('M');
  });

  it('keeps deleted files off missing file rows while marking the parent directory', () => {
    const index = buildFileBrowserGitDecorationIndex('/repo', workspace({
      unstaged: [{ section: 'unstaged', changeType: 'deleted', path: 'src/removed.ts' }],
    }));

    const decorated = applyFileBrowserGitDecorations([
      item('/repo/src', 'folder', [
        item('/repo/src/kept.ts'),
      ]),
    ], index);

    expect(badgeLabel(decorated[0])).toBe('M');
    expect(badgeLabel(decorated[0]?.children?.[0])).toBe('');
    expect(index?.fileChanges.get('/repo/src/removed.ts')?.[0]?.changeType).toBe('deleted');
    expect(index?.directoryChanges.get('/repo/src')?.[0]?.changeType).toBe('deleted');
  });

  it('indexes exact file changes and keeps duplicate workspace sections selectable', () => {
    const index = buildFileBrowserGitDecorationIndex('/repo', workspace({
      staged: [{ section: 'staged', changeType: 'modified', path: 'src/app.ts' }],
      unstaged: [{ section: 'unstaged', changeType: 'modified', path: 'src/app.ts' }],
    }));

    const changes = index?.fileChanges.get('/repo/src/app.ts') ?? [];

    expect(changes.map((change) => change.section)).toEqual(['staged', 'unstaged']);
    expect(index?.directoryChanges.get('/repo/src')?.map((change) => change.section)).toEqual(['staged', 'unstaged']);
  });

  it('ignores paths outside the resolved repository', () => {
    const index = buildFileBrowserGitDecorationIndex('/repo', workspace({
      unstaged: [{ section: 'unstaged', changeType: 'modified', path: '/outside/file.ts' }],
    }));

    const items = [
      item('/repo/app.ts'),
    ];
    const decorated = applyFileBrowserGitDecorations(items, index);

    expect(decorated).toBe(items);
    expect(badgeLabel(decorated[0])).toBe('');
  });

  it('returns the original items outside a git repository or after a git load failure', () => {
    const items = [item('/repo/app.ts')];

    expect(applyFileBrowserGitDecorations(items, null)).toBe(items);
    expect(buildFileBrowserGitDecorationIndex('', null)).toBeNull();
  });

  it('builds decorations and directory targets from path-status aggregates', () => {
    const index = buildFileBrowserGitPathStatusIndex('/repo', {
      repoRootPath: '/repo',
      workspaceRevision: 'revision-a',
      items: [
        { path: 'app/main.ts', section: 'staged', changeType: 'modified' },
        {
          entryKind: 'directory',
          directoryPath: 'app',
          containsStaged: true,
          containsConflicted: true,
          stagedFileCount: 1,
          conflictedFileCount: 1,
          descendantFileCount: 2,
        },
      ],
    });

    expect(index?.decorations.get('/repo/app')?.badge?.label).toBe('M');
    expect(index?.fileChanges.get('/repo/app/main.ts')?.[0]?.section).toBe('staged');
    expect(index?.directoryChanges.get('/repo/app')?.some((item) => item.containsConflicted)).toBe(true);
  });

  it('preserves Git paths with edge whitespace and Unix backslashes', () => {
    const index = buildFileBrowserGitPathStatusIndex('/repo ', {
      repoRootPath: '/repo ',
      workspaceRevision: 'revision-a',
      items: [
        { path: ' leading\\name ', section: 'unstaged', changeType: 'modified' },
      ],
    });
    const absolutePath = '/repo / leading\\name ';
    const decorated = applyFileBrowserGitDecorations([item(absolutePath)], index);

    expect(index?.fileChanges.get(absolutePath)?.[0]?.path).toBe(' leading\\name ');
    expect(badgeLabel(decorated[0])).toBe('M');
  });
});
