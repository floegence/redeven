import { describe, expect, it } from 'vitest';
import {
  buildGitFlowerTurnLauncherIntent,
  buildGitDirectoryShortcutRequest,
  buildGitFileShortcutTarget,
} from './gitBrowserShortcuts';

describe('gitBrowserShortcuts', () => {
  it('builds a git-browser intent for workspace sections', () => {
    const result = buildGitFlowerTurnLauncherIntent({
      kind: 'workspace_section',
      repoRootPath: '/workspace/repo',
      headRef: 'main',
      section: 'changes',
      items: [
        {
          section: 'unstaged',
          changeType: 'modified',
          path: 'src/app.ts',
          displayPath: 'src/app.ts',
          additions: 3,
          deletions: 1,
        },
        {
          section: 'untracked',
          changeType: 'added',
          path: 'notes.txt',
          displayPath: 'notes.txt',
        },
      ],
    });

    expect(result.intent).toMatchObject({
      source_surface: 'git_browser',
      suggested_working_dir: '/workspace/repo',
      context_items: [
        {
          kind: 'text_snapshot',
          title: 'Workspace changes',
          detail: 'main · Changes',
        },
      ],
    });
    expect(result.intent?.context_items[0]?.kind).toBe('text_snapshot');
    const snapshot = result.intent?.context_items[0];
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('Context: Git workspace changes');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('Section: Changes');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('modified src/app.ts (+3 -1)');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('added notes.txt');
  });

  it('builds a git-browser intent for commit context', () => {
    const result = buildGitFlowerTurnLauncherIntent({
      kind: 'commit',
      repoRootPath: '/workspace/repo',
      location: 'graph',
      commit: {
        hash: '3a47b67b1234567890',
        shortHash: '3a47b67b',
        parents: ['1111111111111111'],
        authorName: 'Alice',
        authorTimeMs: 1_710_000_000_000,
        subject: 'Refine bootstrap',
        body: ['Refine bootstrap', '', 'Keep diff rendering stable.'].join('\n'),
      },
      files: [
        {
          changeType: 'modified',
          path: 'src/app.ts',
          displayPath: 'src/app.ts',
          additions: 1,
          deletions: 1,
        },
      ],
    });

    expect(result.intent).toMatchObject({
      source_surface: 'git_browser',
      suggested_working_dir: '/workspace/repo',
      context_items: [
        {
          kind: 'text_snapshot',
          title: 'Commit summary',
          detail: '3a47b67b',
        },
      ],
    });
    const snapshot = result.intent?.context_items[0];
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('Context: Git commit detail');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('Commit: 3a47b67b (3a47b67b1234567890)');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('Subject: Refine bootstrap');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('Message:');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('Keep diff rendering stable.');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('modified src/app.ts (+1 -1)');
  });

  it('returns a helpful error when the repository root is missing', () => {
    const result = buildGitFlowerTurnLauncherIntent({
      kind: 'workspace_section',
      repoRootPath: '',
      section: 'changes',
      items: [],
    });

    expect(result.intent).toBeNull();
    expect(result.error).toBe('Failed to resolve the Git repository root.');
  });

  it.each([
    {
      request: {
        kind: 'repository' as const,
        repoRootPath: '/workspace/repo',
        worktreePath: '/workspace/repo-worktree',
        headRef: 'main',
      },
      title: 'Git repository',
      content: 'Context: Git repository',
      workingDir: '/workspace/repo-worktree',
    },
    {
      request: {
        kind: 'workspace_item' as const,
        repoRootPath: '/workspace/repo',
        headRef: 'main',
        section: 'changes' as const,
        item: { changeType: 'modified', path: 'src/app.ts' },
      },
      title: 'Workspace file',
      content: 'Context: Git workspace item',
      workingDir: '/workspace/repo',
    },
    {
      request: {
        kind: 'branch' as const,
        repoRootPath: '/workspace/repo',
        branch: { name: 'feature/demo', kind: 'local', worktreePath: '/workspace/demo' },
      },
      title: 'Git branch',
      content: 'Context: Git branch',
      workingDir: '/workspace/demo',
    },
    {
      request: {
        kind: 'branch_status_item' as const,
        repoRootPath: '/workspace/repo',
        worktreePath: '/workspace/demo',
        branch: { name: 'feature/demo', kind: 'local' },
        section: 'staged' as const,
        item: { changeType: 'added', path: 'src/new.ts' },
      },
      title: 'Branch status file',
      content: 'Context: Git branch status item',
      workingDir: '/workspace/demo',
    },
    {
      request: {
        kind: 'stash' as const,
        repoRootPath: '/workspace/repo',
        stash: { id: 'stash@{0}', ref: 'stash@{0}', message: 'WIP' },
        files: [{ changeType: 'modified', path: 'src/app.ts' }],
      },
      title: 'Git stash',
      content: 'Context: Git stash',
      workingDir: '/workspace/repo',
    },
    {
      request: {
        kind: 'stash_file' as const,
        repoRootPath: '/workspace/repo',
        stash: { id: 'stash@{0}' },
        file: { changeType: 'deleted', path: 'src/old.ts' },
      },
      title: 'Stash file',
      content: 'Context: Git stash file',
      workingDir: '/workspace/repo',
    },
    {
      request: {
        kind: 'compare_file' as const,
        repoRootPath: '/workspace/repo',
        baseRef: 'main',
        targetRef: 'feature/demo',
        file: { changeType: 'renamed', oldPath: 'old.ts', newPath: 'new.ts' },
      },
      title: 'Compared file',
      content: 'Context: Git branch comparison file',
      workingDir: '/workspace/repo',
    },
  ])('builds a bounded text snapshot for $request.kind', ({ request, title, content, workingDir }) => {
    const result = buildGitFlowerTurnLauncherIntent(request);
    expect(result.intent).toMatchObject({
      source_surface: 'git_browser',
      suggested_working_dir: workingDir,
      context_items: [{ kind: 'text_snapshot', title }],
    });
    expect(result.intent?.context_items).toHaveLength(1);
    const snapshot = result.intent?.context_items[0];
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain(content);
  });

  it.each([
    { kind: 'workspace_item' as const, expectedTitle: 'Workspace directory' },
    { kind: 'branch_status_item' as const, expectedTitle: 'Branch status directory' },
  ])('describes $kind directory targets as directories', ({ kind, expectedTitle }) => {
    const common = {
      repoRootPath: '/workspace/repo',
      section: 'changes' as const,
      item: {
        entryKind: 'directory',
        directoryPath: 'src/components',
        descendantFileCount: 4,
        containsUnstaged: true,
        containsUntracked: true,
      },
    };
    const request = kind === 'workspace_item'
      ? { kind, ...common }
      : { kind, ...common, worktreePath: '/workspace/repo', branch: { name: 'main', kind: 'local' } };
    const result = buildGitFlowerTurnLauncherIntent(request);
    const snapshot = result.intent?.context_items[0];
    expect(snapshot && 'title' in snapshot ? snapshot.title : undefined).toBe(expectedTitle);
    const content = snapshot && 'content' in snapshot ? snapshot.content : '';
    expect(content).toContain('Directory:');
    expect(content).toContain('src/components');
    expect(content).toContain('Descendant files: 4');
    expect(content).not.toContain('File:');
  });

  it('limits Git file lists to 40 entries', () => {
    const result = buildGitFlowerTurnLauncherIntent({
      kind: 'stash',
      repoRootPath: '/workspace/repo',
      stash: { id: 'stash@{0}' },
      files: Array.from({ length: 43 }, (_, index) => ({
        changeType: 'modified',
        path: `src/file-${index + 1}.ts`,
      })),
    });
    const snapshot = result.intent?.context_items[0];
    const content = snapshot && 'content' in snapshot ? snapshot.content : '';
    expect(content).toContain('modified src/file-40.ts');
    expect(content).not.toContain('modified src/file-41.ts');
    expect(content).toContain('3 more files omitted');
  });

  it('caps generated snapshot content by Unicode code points', () => {
    const result = buildGitFlowerTurnLauncherIntent({
      kind: 'commit',
      repoRootPath: '/workspace/repo',
      location: 'graph',
      commit: {
        hash: 'abc1234',
        shortHash: 'abc1234',
        parents: [],
        subject: 'Large commit',
        body: `Large commit\n${'界'.repeat(20_000)}`,
      },
      files: [{
        changeType: 'modified',
        path: `src/${'a'.repeat(20_000)}.ts`,
      }],
    });
    const snapshot = result.intent?.context_items[0];
    const content = snapshot && 'content' in snapshot ? snapshot.content : '';
    expect(Array.from(content)).toHaveLength(12_000);
    expect(content.endsWith('... [Git context truncated]')).toBe(true);
  });

  it.each([
    '/workspace/repo/../outside',
    '/workspace/./repo',
  ])('rejects non-canonical Git repository roots for Flower context', (repoRootPath) => {
    expect(buildGitFlowerTurnLauncherIntent({
      kind: 'workspace_section',
      repoRootPath,
      section: 'changes',
      items: [],
    })).toMatchObject({ intent: null });
  });

  it('falls back to a canonical repo root when a worktree path contains dot segments', () => {
    const result = buildGitFlowerTurnLauncherIntent({
      kind: 'branch',
      repoRootPath: '/workspace/repo',
      branch: {
        name: 'feature/demo',
        fullName: 'refs/heads/feature/demo',
        kind: 'local',
        worktreePath: '/workspace/repo/../linked',
      },
    });
    expect(result.intent?.suggested_working_dir).toBe('/workspace/repo');
  });

  it('builds a directory shortcut request for a scoped Git directory', () => {
    expect(buildGitDirectoryShortcutRequest({
      rootPath: '/workspace/repo',
      directoryPath: 'src/ui/workbench',
    })).toEqual({
      path: '/workspace/repo/src/ui/workbench',
      preferredName: 'workbench',
    });
  });

  it('uses the repository root when the Git scope is empty', () => {
    expect(buildGitDirectoryShortcutRequest({
      rootPath: '/workspace/repo',
      directoryPath: '',
    })).toEqual({
      path: '/workspace/repo',
      preferredName: 'repo',
    });
  });

  it('keeps the legacy root directory scope compatible', () => {
    expect(buildGitDirectoryShortcutRequest({
      rootPath: '/workspace/repo',
      directoryPath: '/',
    })).toEqual({
      path: '/workspace/repo',
      preferredName: 'repo',
    });
  });

  it('rejects parent-traversal Git directory scopes', () => {
    expect(buildGitDirectoryShortcutRequest({
      rootPath: '/workspace/repo',
      directoryPath: '../secrets',
    })).toBeNull();
  });

  it('builds file targets from the effective root and normalizes backslashes', () => {
    expect(buildGitFileShortcutTarget({
      rootPath: '/workspace/repo-worktree',
      item: { changeType: 'modified', path: 'src\\ui\\app.ts' },
    })).toEqual({
      absolutePath: '/workspace/repo-worktree/src/ui/app.ts',
      parentDirectoryPath: '/workspace/repo-worktree/src/ui',
      relativePath: 'src/ui/app.ts',
      canPreviewCurrentFile: true,
    });
  });

  it('uses the new path for renamed files', () => {
    expect(buildGitFileShortcutTarget({
      rootPath: '/workspace/repo',
      item: {
        changeType: 'renamed',
        path: 'src/old.ts',
        oldPath: 'src/old.ts',
        newPath: 'src/new.ts',
      },
    })).toMatchObject({
      absolutePath: '/workspace/repo/src/new.ts',
      relativePath: 'src/new.ts',
      canPreviewCurrentFile: true,
    });
  });

  it('does not offer current-file preview for deleted files', () => {
    expect(buildGitFileShortcutTarget({
      rootPath: '/workspace/repo',
      item: { changeType: 'deleted', path: 'src/removed.ts' },
    })).toMatchObject({
      absolutePath: '/workspace/repo/src/removed.ts',
      canPreviewCurrentFile: false,
    });
  });

  it.each([
    { rootPath: '/workspace/repo', path: '' },
    { rootPath: '/workspace/repo', path: '../secret.txt' },
    { rootPath: '/workspace/repo', path: 'src/../../secret.txt' },
    { rootPath: '/workspace/repo', path: '/outside/secret.txt' },
    { rootPath: '/workspace/../repo', path: 'src/app.ts' },
  ])('rejects unsafe Git file targets for $path', ({ rootPath, path }) => {
    expect(buildGitFileShortcutTarget({
      rootPath,
      item: { changeType: 'modified', path },
    })).toBeNull();
  });
});
