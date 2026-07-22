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
  await new Promise((resolve) => setTimeout(resolve, 20));
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
  return Array.from(document.body.querySelectorAll('[role="tooltip"]')).at(-1) as HTMLElement | null;
}

function findContextMenuItem(label: string, key: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => {
    const text = item.textContent?.trim() ?? '';
    return text === label || text === key || text.includes(label) || text.includes(key);
  });
}

async function openMouseContextMenu(element: Element | null): Promise<void> {
  expect(element).toBeTruthy();
  element!.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    clientX: 32,
    clientY: 48,
  }));
  await flush();
}

async function openKeyboardContextMenu(element: HTMLElement | null, shiftF10 = false): Promise<void> {
  expect(element).toBeTruthy();
  element!.focus();
  element!.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    key: shiftF10 ? 'F10' : 'ContextMenu',
    shiftKey: shiftF10,
  }));
  await flush();
}

async function closeContextMenu(): Promise<void> {
  const menuItem = document.body.querySelector<HTMLElement>('[role="menuitem"]');
  menuItem?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
  await flush();
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
  it('exposes stable, path-aware context actions for stash entries, details, and files', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const originalStash = {
      id: 'stash-1',
      ref: 'stash@{0}',
      message: 'WIP context menu',
      branchName: 'feature/context-menu',
      createdAtUnixMs: 1,
    };
    const files = [{
      changeType: 'renamed',
      path: 'src/old.ts',
      oldPath: 'src/old.ts',
      newPath: 'src/new.ts',
      displayPath: 'src/new.ts',
    }, {
      changeType: 'deleted',
      path: 'src/deleted.ts',
      displayPath: 'src/deleted.ts',
    }, {
      changeType: 'modified',
      path: '../outside.ts',
      displayPath: '../outside.ts',
    }];
    const onRequestApply = vi.fn();
    const onRequestDrop = vi.fn();
    const onAskFlower = vi.fn();
    const onOpenInTerminal = vi.fn();
    const onBrowseFiles = vi.fn();
    const onPreviewCurrentFile = vi.fn();
    const onCopyText = vi.fn();
    let setStashes!: (value: typeof originalStash[]) => void;
    let setSelectedStashId!: (value: string) => void;

    const dispose = render(() => {
      const [stashes, updateStashes] = createSignal([originalStash]);
      const [selectedStashId, updateSelectedStashId] = createSignal('stash-1');
      setStashes = updateStashes;
      setSelectedStashId = updateSelectedStashId;
      return (
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
                workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
              }}
              stashes={stashes()}
              selectedStashId={selectedStashId()}
              onSelectStash={updateSelectedStashId}
              stashDetail={{ ...originalStash, files }}
              onRequestApply={onRequestApply}
              onRequestDrop={onRequestDrop}
              onAskFlower={onAskFlower}
              onOpenInTerminal={onOpenInTerminal}
              onBrowseFiles={onBrowseFiles}
              onPreviewCurrentFile={onPreviewCurrentFile}
              onCopyText={onCopyText}
            />
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      const stashEntry = () => host.querySelector('[data-git-stash-id="stash-1"]');
      await openMouseContextMenu(stashEntry());
      expect(findContextMenuItem('Ask Flower', 'git.contextMenu.askFlower')).toBeTruthy();
      expect(findContextMenuItem('Open Terminal', 'git.contextMenu.openTerminal')).toBeTruthy();
      expect(findContextMenuItem('Browse Files', 'git.contextMenu.browseFiles')).toBeTruthy();
      expect(findContextMenuItem('Apply Stash', 'git.contextMenu.applyStash')).toBeTruthy();
      expect(findContextMenuItem('Apply and Remove Stash', 'git.contextMenu.applyAndRemoveStash')).toBeTruthy();
      expect(findContextMenuItem('Delete Stash', 'git.contextMenu.deleteStash')).toBeTruthy();

      setStashes([{ ...originalStash, ref: 'stash@{1}' }]);
      findContextMenuItem('Copy Stash Reference', 'git.contextMenu.copyStashRef')!.click();
      await flush();
      expect(onCopyText).toHaveBeenLastCalledWith('stash@{0}');

      setStashes([originalStash]);
      await flush();
      await openMouseContextMenu(stashEntry());
      setStashes([{ ...originalStash, id: 'stash-replaced' }]);
      findContextMenuItem('Apply Stash', 'git.contextMenu.applyStash')!.click();
      await flush();
      expect(onRequestApply).toHaveBeenLastCalledWith('stash-1', false);

      setStashes([originalStash]);
      await flush();
      const detailHeader = host.querySelector<HTMLElement>('[data-git-stash-detail-header]');
      await openKeyboardContextMenu(detailHeader);
      expect(document.activeElement).toBe(findContextMenuItem('Ask Flower', 'git.contextMenu.askFlower'));
      findContextMenuItem('Ask Flower', 'git.contextMenu.askFlower')!.click();
      await flush();
      expect(onAskFlower).toHaveBeenLastCalledWith(expect.objectContaining({
        kind: 'stash',
        repoRootPath: '/workspace/repo',
        stash: expect.objectContaining({ id: 'stash-1' }),
        files: expect.arrayContaining([expect.objectContaining({ path: 'src/old.ts' })]),
      }));

      const renamedRow = host.querySelector<HTMLElement>('[data-git-stash-file="src/old.ts"]');
      await openKeyboardContextMenu(renamedRow, true);
      findContextMenuItem('Preview Current File', 'git.contextMenu.previewCurrentFile')!.click();
      await flush();
      expect(onPreviewCurrentFile).toHaveBeenLastCalledWith({
        absolutePath: '/workspace/repo/src/new.ts',
        parentDirectoryPath: '/workspace/repo/src',
        relativePath: 'src/new.ts',
        canPreviewCurrentFile: true,
      });

      await openMouseContextMenu(renamedRow);
      findContextMenuItem('Open Terminal', 'git.contextMenu.openTerminal')!.click();
      await flush();
      expect(onOpenInTerminal).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/workspace/repo/src' }));

      await openMouseContextMenu(renamedRow);
      findContextMenuItem('Browse Files', 'git.contextMenu.browseFiles')!.click();
      await flush();
      expect(onBrowseFiles).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/workspace/repo/src' }));

      await openMouseContextMenu(renamedRow);
      findContextMenuItem('Ask Flower', 'git.contextMenu.askFlower')!.click();
      await flush();
      expect(onAskFlower).toHaveBeenLastCalledWith(expect.objectContaining({
        kind: 'stash_file',
        stash: expect.objectContaining({ id: 'stash-1' }),
        file: expect.objectContaining({ newPath: 'src/new.ts' }),
      }));

      await openMouseContextMenu(renamedRow);
      findContextMenuItem('Copy Absolute Path', 'git.contextMenu.copyAbsolutePath')!.click();
      await flush();
      expect(onCopyText).toHaveBeenLastCalledWith('/workspace/repo/src/new.ts');

      await openMouseContextMenu(renamedRow);
      findContextMenuItem('Copy Relative Path', 'git.contextMenu.copyRelativePath')!.click();
      await flush();
      expect(onCopyText).toHaveBeenLastCalledWith('src/new.ts');

      await openMouseContextMenu(renamedRow);
      setSelectedStashId('stash-2');
      findContextMenuItem('View Diff', 'git.contextMenu.viewDiff')!.click();
      await flush();
      expect(gitDiffDialogRenderStore.snapshots.at(-1)).toMatchObject({
        open: true,
        itemPath: 'src/old.ts',
        sourceKind: 'stash',
        stashId: 'stash-1',
      });

      const deletedRow = host.querySelector<HTMLElement>('[data-git-stash-file="src/deleted.ts"]');
      await openMouseContextMenu(deletedRow);
      expect(findContextMenuItem('Preview Current File', 'git.contextMenu.previewCurrentFile')).toBeUndefined();
      await closeContextMenu();

      const inaccessibleRow = host.querySelector<HTMLElement>('[data-git-stash-file="../outside.ts"]');
      await openMouseContextMenu(inaccessibleRow);
      const disabledPreview = findContextMenuItem('Preview Current File', 'git.contextMenu.previewCurrentFile');
      expect(disabledPreview?.getAttribute('aria-disabled')).toBe('true');
      expect(disabledPreview?.getAttribute('title')).toMatch(/unavailable|git\.contextMenu\.previewCurrentFileUnavailable/i);
      expect(findContextMenuItem('Open Terminal', 'git.contextMenu.openTerminal')?.getAttribute('aria-disabled')).toBe('true');
      expect(findContextMenuItem('Browse Files', 'git.contextMenu.browseFiles')?.getAttribute('aria-disabled')).toBe('true');

      await closeContextMenu();
      await openMouseContextMenu(stashEntry());
      findContextMenuItem('Delete Stash', 'git.contextMenu.deleteStash')!.click();
      await flush();
      expect(onRequestDrop).toHaveBeenLastCalledWith('stash-1');
    } finally {
      dispose();
    }
  });

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
      expect(host.textContent).toContain('Stash current workspace');
      expect(host.textContent).toContain('Stash Changes');
      const stashTabs = host.querySelector('[role="group"][aria-label="Stash tabs"]') as HTMLDivElement | null;
      expect(stashTabs).toBeTruthy();
      expect(stashTabs?.className).toContain('floe-segmented-control');
      const activeRadio = host.querySelector('[role="radio"][aria-checked="true"]') as HTMLButtonElement | null;
      expect(activeRadio?.textContent).toContain('Save Changes');
      expect(activeRadio?.className).not.toContain('git-browser-selection-chip');

      const stashesTab = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Saved Stashes')) as HTMLButtonElement | undefined;
      expect(stashesTab).toBeTruthy();
      stashesTab!.click();
      await flush();

      expect(host.textContent).toContain('WIP linked worktree');
      expect(host.textContent).toContain('Changed Files');
      expect(host.textContent).toContain('Apply');
      expect(host.textContent).toContain('Apply & Remove');
      expect(host.textContent).toContain('Delete');
      const selectedStashButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('WIP linked worktree')) as HTMLButtonElement | undefined;
      expect(selectedStashButton?.className).toContain('border-l-[var(--redeven-status-info)]');
      expect(selectedStashButton?.className).toContain('bg-[var(--redeven-status-info-soft)]');
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
      expect((await revealTooltipForButton(applyButton))?.textContent).toContain('Review and apply this stash. The stash remains available after confirmation.');
      expect((await revealTooltipForButton(applyRemoveButton))?.textContent).toContain('Review and apply this stash, then remove it after confirmation.');
      expect((await revealTooltipForButton(deleteButton))?.textContent).toContain('Review permanent deletion without applying the stash changes.');

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
