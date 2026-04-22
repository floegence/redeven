import { describe, expect, it } from 'vitest';
import {
  buildGitAskFlowerIntent,
  buildGitDirectoryShortcutRequest,
} from './gitBrowserShortcuts';

describe('gitBrowserShortcuts', () => {
  it('builds a git-browser intent for workspace sections', () => {
    const result = buildGitAskFlowerIntent({
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
      source: 'git_browser',
      mode: 'append',
      suggestedWorkingDirAbs: '/workspace/repo',
      contextItems: [
        {
          kind: 'text_snapshot',
          title: 'Workspace changes',
          detail: 'main · Changes',
        },
      ],
    });
    expect(result.intent?.contextItems[0]?.kind).toBe('text_snapshot');
    const snapshot = result.intent?.contextItems[0];
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('Context: Git workspace changes');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('Section: Changes');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('modified src/app.ts (+3 -1)');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('added notes.txt');
  });

  it('builds a git-browser intent for commit context', () => {
    const result = buildGitAskFlowerIntent({
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
      source: 'git_browser',
      mode: 'append',
      suggestedWorkingDirAbs: '/workspace/repo',
      contextItems: [
        {
          kind: 'text_snapshot',
          title: 'Commit summary',
          detail: '3a47b67b',
        },
      ],
    });
    const snapshot = result.intent?.contextItems[0];
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('Context: Git commit detail');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('Commit: 3a47b67b (3a47b67b1234567890)');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('Subject: Refine bootstrap');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('Message:');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('Keep diff rendering stable.');
    expect(snapshot && 'content' in snapshot ? snapshot.content : '').toContain('modified src/app.ts (+1 -1)');
  });

  it('returns a helpful error when the repository root is missing', () => {
    const result = buildGitAskFlowerIntent({
      kind: 'workspace_section',
      repoRootPath: '',
      section: 'changes',
      items: [],
    });

    expect(result.intent).toBeNull();
    expect(result.error).toBe('Failed to resolve the Git repository root.');
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

  it('rejects parent-traversal Git directory scopes', () => {
    expect(buildGitDirectoryShortcutRequest({
      rootPath: '/workspace/repo',
      directoryPath: '../secrets',
    })).toBeNull();
  });
});
