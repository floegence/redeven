// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { createEffect, createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetDiffContent = vi.hoisted(() => vi.fn());
const gitDiffDialogRenderStore = vi.hoisted(() => ({
  snapshots: [] as Array<{
    open: boolean;
    itemPath: string;
    sourceKind: string;
    stashId: string;
    description: string;
    desktopWindowZIndex: number;
  }>,
}));

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
  PREVIEW_WINDOW_Z_INDEX: 150,
  PreviewWindow: (props: { open?: boolean; children?: JSX.Element; surfaceRef?: (element: HTMLElement | null) => void }) => (
    props.open ? <div ref={(element) => props.surfaceRef?.(element)} data-testid="preview-window">{props.children}</div> : null
  ),
}));

vi.mock('./GitDiffDialog', () => ({
  GitDiffDialog: (props: {
    open?: boolean;
    item?: { path?: string } | null;
    source?: { kind?: string; stashId?: string } | null;
    description?: string;
    desktopWindowZIndex?: number;
  }) => {
    createEffect(() => {
      gitDiffDialogRenderStore.snapshots.push({
        open: Boolean(props.open),
        itemPath: String(props.item?.path ?? ''),
        sourceKind: String(props.source?.kind ?? ''),
        stashId: String(props.source?.stashId ?? ''),
        description: String(props.description ?? ''),
        desktopWindowZIndex: Number(props.desktopWindowZIndex ?? 0),
      });
    });
    return (
      <div data-testid="git-diff-dialog">
        <div>diff-open:{props.open ? 'yes' : 'no'}</div>
        <div>diff-item:{props.item?.path ?? ''}</div>
        <div>diff-source:{props.source?.kind ?? ''}</div>
        <div>diff-stash:{props.source?.stashId ?? ''}</div>
      </div>
    );
  },
}));

import { GitStashWindow } from './GitStashWindow';

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function revealTooltipForButton(button: HTMLButtonElement | undefined): Promise<HTMLElement | null> {
  document.querySelectorAll('[data-redeven-tooltip-anchor]').forEach((node) => {
    node.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
  });
  await flush();

  const host = button?.closest('[data-redeven-tooltip-anchor]') as HTMLElement | null;
  expect(host).toBeTruthy();
  host!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  await flush();
  return document.body.querySelector('[role="tooltip"]') as HTMLElement | null;
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
  gitDiffDialogRenderStore.snapshots = [];
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('GitStashWindow', () => {
  it('switches from save mode to the stash list and exposes stash actions', async () => {
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
              }]}
              selectedStashId="stash-1"
              onSelectStash={() => {}}
              stashDetail={{
                id: 'stash-1',
                ref: 'stash@{0}',
                message: 'WIP linked worktree',
                branchName: 'feature/demo',
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
      stashesTab!.click();
      await flush();

      expect(host.textContent).toContain('Selected Stash');
      expect(host.textContent).toContain('WIP linked worktree');
      expect(host.textContent).toContain('Changed Files');
      expect(host.textContent).toContain('Apply');
      expect(host.textContent).toContain('Apply & Remove');
      expect(host.textContent).toContain('Delete');
      const selectedStashButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('WIP linked worktree')) as HTMLButtonElement | undefined;
      expect(selectedStashButton?.className).toContain('git-browser-selection-surface');
      const actionRow = host.querySelector('[data-git-stash-actions]') as HTMLDivElement | null;
      expect(actionRow).toBeTruthy();
      expect(actionRow?.className).toContain('flex');
      expect(actionRow?.className).toContain('flex-wrap');
      expect(actionRow?.className).not.toContain('grid');
      const actionDivider = host.querySelector('[data-git-stash-actions-divider]') as HTMLDivElement | null;
      expect(actionDivider?.className).toContain('sm:block');

      const applyButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Apply') as HTMLButtonElement | undefined;
      const applyRemoveButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Apply & Remove') as HTMLButtonElement | undefined;
      const deleteButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Delete') as HTMLButtonElement | undefined;
      expect((await revealTooltipForButton(applyButton))?.textContent).toContain('Review and apply this stash to the current workspace. After confirmation, the stash entry stays available.');
      expect((await revealTooltipForButton(applyRemoveButton))?.textContent).toContain('Review and apply this stash to the current workspace. After a successful confirmation, the stash entry is removed.');
      expect((await revealTooltipForButton(deleteButton))?.textContent).toContain('Review deletion of this stash entry. After confirmation, it is permanently removed without applying its changes.');

      const selectedFileButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'src/app.ts') as HTMLButtonElement | undefined;
      expect(selectedFileButton).toBeTruthy();
      selectedFileButton!.click();
      await flush();

      const latestDialog = gitDiffDialogRenderStore.snapshots.at(-1);
      expect(latestDialog).toMatchObject({
        open: true,
        itemPath: 'src/app.ts',
        sourceKind: 'stash',
        stashId: 'stash-1',
        desktopWindowZIndex: 160,
      });
      expect(latestDialog?.description).toContain('src/app.ts');
      expect(host.textContent).toContain('diff-open:yes');
      expect(host.textContent).toContain('diff-source:stash');
      expect(host.textContent).toContain('diff-stash:stash-1');
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
            }]}
            selectedStashId="stash-1"
            onSelectStash={() => {}}
            stashDetail={{
              id: 'stash-1',
              ref: 'stash@{0}',
              message: 'WIP linked worktree',
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
              reviewContext: {
                repoRootPath: '/workspace/repo',
                stashId: 'stash-1',
              },
              preview: {
                repoRootPath: '/workspace/repo',
                stash: {
                  id: 'stash-1',
                  ref: 'stash@{0}',
                  message: 'WIP linked worktree',
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

  it('opens delete confirmation inside a dialog instead of inline review content', async () => {
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
              headRef: 'main',
              headCommit: 'abc1234',
              stashCount: 1,
              workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
            }}
            workspaceSummary={{ stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 }}
            stashes={[{
              id: 'stash-1',
              ref: 'stash@{0}',
              message: 'WIP linked worktree',
              branchName: 'feature/demo',
              headCommit: 'stash-head-1',
              createdAtUnixMs: 1,
            }]}
            selectedStashId="stash-1"
            onSelectStash={() => {}}
            stashDetail={{
              id: 'stash-1',
              ref: 'stash@{0}',
              message: 'WIP linked worktree',
              branchName: 'feature/demo',
              headCommit: 'stash-head-1',
              createdAtUnixMs: 1,
              files: [{
                changeType: 'modified',
                path: 'src/app.ts',
                displayPath: 'src/app.ts',
              }],
            }}
            review={{
              kind: 'drop',
              reviewContext: {
                repoRootPath: '/workspace/repo',
                headRef: 'main',
                headCommit: 'abc1234',
                stashId: 'stash-1',
                stashHeadCommit: 'stash-head-1',
              },
              preview: {
                repoRootPath: '/workspace/repo',
                headRef: 'main',
                headCommit: 'abc1234',
                stash: {
                  id: 'stash-1',
                  ref: 'stash@{0}',
                  message: 'WIP linked worktree',
                  branchName: 'feature/demo',
                  headCommit: 'stash-head-1',
                  createdAtUnixMs: 1,
                },
                planFingerprint: 'stash-drop-plan-1',
              },
            }}
          />
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      expect(host.textContent).not.toContain('Delete this stash entry');
      const previewWindow = host.querySelector('[data-testid="preview-window"]') as HTMLDivElement | null;
      expect(previewWindow?.textContent).toContain('Delete Stash');
      expect(previewWindow?.textContent).toContain('Remove this stash entry from the shared stack without applying its changes.');
      expect(previewWindow?.textContent).toContain('Deleting a stash removes it from the shared stack.');
      const confirmButton = Array.from(previewWindow?.querySelectorAll('button') ?? []).find((node) => node.textContent?.trim() === 'Confirm Delete') as HTMLButtonElement | undefined;
      expect(confirmButton).toBeTruthy();
      expect(confirmButton?.className).toContain('w-full');
    } finally {
      dispose();
    }
  });

  it('hides a drop confirmation when the reviewed repository head is stale', () => {
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
              headRef: 'main',
              headCommit: 'def5678',
              stashCount: 1,
              workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
            }}
            workspaceSummary={{ stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 }}
            stashes={[{
              id: 'stash-1',
              ref: 'stash@{0}',
              message: 'WIP linked worktree',
              headCommit: 'stash-head-1',
              createdAtUnixMs: 1,
            }]}
            selectedStashId="stash-1"
            onSelectStash={() => {}}
            stashDetail={{
              id: 'stash-1',
              ref: 'stash@{0}',
              message: 'WIP linked worktree',
              headCommit: 'stash-head-1',
              files: [{
                changeType: 'modified',
                path: 'src/app.ts',
                displayPath: 'src/app.ts',
              }],
            }}
            review={{
              kind: 'drop',
              reviewContext: {
                repoRootPath: '/workspace/repo',
                headRef: 'main',
                headCommit: 'abc1234',
                stashId: 'stash-1',
                stashHeadCommit: 'stash-head-1',
              },
              preview: {
                repoRootPath: '/workspace/repo',
                headRef: 'main',
                headCommit: 'abc1234',
                stash: {
                  id: 'stash-1',
                  ref: 'stash@{0}',
                  message: 'WIP linked worktree',
                  headCommit: 'stash-head-1',
                },
                planFingerprint: 'stash-drop-plan-1',
              },
            }}
          />
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Delete');
      expect(host.textContent).not.toContain('Confirm Delete');
      expect(host.textContent).not.toContain('Delete this stash entry');
    } finally {
      dispose();
    }
  });

  it('keeps stash review summary-first and does not fetch inline patch content', async () => {
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
            }]}
            selectedStashId="stash-1"
            onSelectStash={() => {}}
            stashDetail={{
              id: 'stash-1',
              ref: 'stash@{0}',
              message: 'WIP linked worktree',
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
      expect(mockGetDiffContent).not.toHaveBeenCalled();
      expect(host.textContent).not.toContain('Select a stash file to inspect its patch.');

      const viewDiffButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'View Diff') as HTMLButtonElement | undefined;
      expect(viewDiffButton).toBeTruthy();
      viewDiffButton!.click();
      await flush();

      expect(mockGetDiffContent).not.toHaveBeenCalled();
      expect(gitDiffDialogRenderStore.snapshots.at(-1)).toMatchObject({
        open: true,
        itemPath: 'src/app.ts',
        sourceKind: 'stash',
        stashId: 'stash-1',
      });
    } finally {
      dispose();
    }
  });
});
