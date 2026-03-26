// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./PreviewWindow', () => ({
  PreviewWindow: (props: { open?: boolean; children?: JSX.Element }) => (
    props.open ? <div data-testid="preview-window">{props.children}</div> : null
  ),
}));

vi.mock('./GitPatchViewer', () => ({
  GitPatchViewer: (props: { item?: { displayPath?: string }; emptyMessage?: string }) => (
    <div data-testid="patch-viewer">
      {props.item?.displayPath ?? props.emptyMessage}
    </div>
  ),
}));

import { GitStashWindow } from './GitStashWindow';

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('GitStashWindow', () => {
  it('switches from save mode to the stash list and exposes stash actions', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => {
      const [tab, setTab] = createSignal<'save' | 'stashes'>('save');
      return (
        <LayoutProvider>
          <NotificationProvider>
            <GitStashWindow
              open
              onOpenChange={() => {}}
              tab={tab()}
              onTabChange={setTab}
              repoRootPath="/workspace/repo"
              source="changes"
              repoSummary={{
                repoRootPath: '/workspace/repo',
                stashCount: 1,
                workspaceSummary: { stagedCount: 1, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
              }}
              workspaceSummary={{ stagedCount: 1, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 }}
              stashes={[{
                id: 'stash-1',
                ref: 'stash@{0}',
                message: 'WIP linked worktree',
                branchName: 'feature/demo',
                createdAtUnixMs: 1,
                fileCount: 1,
              }]}
              selectedStashId="stash-1"
              onSelectStash={() => {}}
              stashDetail={{
                id: 'stash-1',
                ref: 'stash@{0}',
                message: 'WIP linked worktree',
                branchName: 'feature/demo',
                fileCount: 1,
                files: [{
                  changeType: 'modified',
                  path: 'src/app.ts',
                  displayPath: 'src/app.ts',
                  patchText: '@@ -1 +1 @@\n-before\n+after',
                }],
              }}
            />
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      expect(host.textContent).toContain('Target Workspace');
      expect(host.textContent).toContain('Stash Changes');

      const stashesTab = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Saved Stashes')) as HTMLButtonElement | undefined;
      expect(stashesTab).toBeTruthy();
      stashesTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(host.textContent).toContain('Selected Stash');
      expect(host.textContent).toContain('WIP linked worktree');
      expect(host.textContent).toContain('Apply');
      expect(host.textContent).toContain('Apply & Remove');
      expect(host.textContent).toContain('Delete');
      expect(host.querySelector('[data-testid="patch-viewer"]')?.textContent).toContain('src/app.ts');
    } finally {
      dispose();
    }
  });

  it('shows a blocked apply review and keeps confirmation disabled', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <GitStashWindow
            open
            onOpenChange={() => {}}
            tab="stashes"
            onTabChange={() => {}}
            repoRootPath="/workspace/repo"
            source="merge_blocker"
            repoSummary={{
              repoRootPath: '/workspace/repo',
              stashCount: 1,
              workspaceSummary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
            }}
            workspaceSummary={{ stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 }}
            stashes={[{
              id: 'stash-1',
              ref: 'stash@{0}',
              message: 'WIP linked worktree',
              createdAtUnixMs: 1,
              fileCount: 1,
            }]}
            selectedStashId="stash-1"
            onSelectStash={() => {}}
            stashDetail={{
              id: 'stash-1',
              ref: 'stash@{0}',
              message: 'WIP linked worktree',
              fileCount: 1,
              files: [{
                changeType: 'modified',
                path: 'src/app.ts',
                displayPath: 'src/app.ts',
                patchText: '@@ -1 +1 @@\n-before\n+after',
              }],
            }}
            review={{
              kind: 'apply',
              removeAfterApply: false,
              preview: {
                repoRootPath: '/workspace/repo',
                stash: {
                  id: 'stash-1',
                  ref: 'stash@{0}',
                  message: 'WIP linked worktree',
                  fileCount: 1,
                },
                blocking: {
                  kind: 'workspace_dirty',
                  reason: 'Current workspace must be clean before applying a stash (1 unstaged).',
                  workspacePath: '/workspace/repo',
                  workspaceSummary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
                },
                planFingerprint: 'stash-plan-1',
              },
            }}
          />
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Current workspace must be clean before applying a stash (1 unstaged).');
      const confirmButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Confirm Apply') as HTMLButtonElement | undefined;
      expect(confirmButton).toBeTruthy();
      expect(confirmButton?.disabled).toBe(true);
    } finally {
      dispose();
    }
  });
});
