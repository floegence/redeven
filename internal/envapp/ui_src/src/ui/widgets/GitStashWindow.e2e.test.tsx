// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDiffContent = vi.hoisted(() => vi.fn());

vi.mock('../protocol/redeven_v1', async () => {
  const actual = await vi.importActual<typeof import('../protocol/redeven_v1')>('../protocol/redeven_v1');
  return {
    ...actual,
    useRedevenRpc: () => ({
      git: {
        getDiffContent: mockGetDiffContent,
      },
    }),
  };
});

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

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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
  mockGetDiffContent.mockReset();
  mockGetDiffContent.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    mode: 'preview',
    file: {
      changeType: 'modified',
      path: 'src/app.ts',
      displayPath: 'src/app.ts',
      patchText: '@@ -1 +1 @@\n-before\n+after',
    },
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
      const stashTabs = host.querySelector('[role="group"][aria-label="Stash tabs"]') as HTMLDivElement | null;
      expect(stashTabs).toBeTruthy();
      expect(stashTabs?.className).toContain('redeven-surface-segmented');
      const activeRadio = host.querySelector('[role="radio"][aria-checked="true"]') as HTMLButtonElement | null;
      expect(activeRadio?.textContent).toContain('Save Changes');
      expect(activeRadio?.className).not.toContain('git-browser-selection-chip');

      const stashesTab = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Saved Stashes')) as HTMLButtonElement | undefined;
      expect(stashesTab).toBeTruthy();
      stashesTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(host.textContent).toContain('Selected Stash');
      expect(host.textContent).toContain('WIP linked worktree');
      expect(host.textContent).toContain('Apply');
      expect(host.textContent).toContain('Apply & Remove');
      expect(host.textContent).toContain('Delete');
      const selectedStashButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('WIP linked worktree')) as HTMLButtonElement | undefined;
      const selectedFileButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('src/app.ts')) as HTMLButtonElement | undefined;
      expect(selectedStashButton?.className).toContain('git-browser-selection-surface');
      expect(selectedFileButton?.className).toContain('git-browser-selection-surface');
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

  it('shows a contextual stash patch error instead of raw git CLI output', async () => {
    mockGetDiffContent.mockRejectedValueOnce(new Error("git stash show --patch --include-untracked stash@{0} -- src/app.ts failed: Too many revisions specified"));

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
            source="changes"
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
              }],
            }}
          />
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      await flush();
      expect(mockGetDiffContent).toHaveBeenCalledTimes(1);
      expect(host.textContent).toContain('Could not load the selected stash patch.');
      expect(host.textContent).toContain('Refresh the stash list and try again.');
      expect(host.textContent).not.toContain('Too many revisions specified');
      expect(host.textContent).not.toContain('git stash show');
    } finally {
      dispose();
    }
  });
});
