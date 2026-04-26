// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { redevenV1Contract } from '../protocol/redeven_v1';
import { FLOE_DIALOG_SURFACE_HOST_ATTR } from '../workbench/surface/workbenchInputRouting';
import { GitWorkspace } from './GitWorkspace';

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  });
}

async function settleDialog() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  mockMatchMedia(false);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('GitWorkspace interactions', () => {
  it('keeps mode switching and git view switching pinned inside the shared sidebar shell', () => {
    let nextMode = '';
    let nextSubview = '';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[620px]">
              <GitWorkspace
                mode="git"
                onModeChange={(mode) => {
                  nextMode = mode;
                }}
                subview="changes"
                onSubviewChange={(view) => {
                  nextSubview = view;
                }}
                width={280}
                open
                currentPath="/workspace/repo/src"
                repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: 'abc1234' }}
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'main',
                  headCommit: 'abc1234',
                  aheadCount: 1,
                  behindCount: 0,
                  workspaceSummary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                }}
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                  staged: [],
                  unstaged: [],
                  untracked: [],
                  conflicted: [],
                }}
                branches={{
                  repoRootPath: '/workspace/repo',
                  currentRef: 'main',
                  local: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }],
                  remote: [],
                }}
                commits={[]}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Mode');
      expect(host.textContent).toContain('View');
      expect(host.querySelectorAll('[role="radiogroup"][aria-label="Browser mode"]').length).toBe(1);
      expect(host.querySelectorAll('[role="tablist"][aria-label="Git views"]').length).toBe(1);
      const scrollRegion = host.querySelector('[data-testid="git-sidebar-scroll-region"]');
      expect(scrollRegion).toBeTruthy();
      expect(scrollRegion?.querySelector('[role="tablist"][aria-label="Git views"]')).toBeNull();

      const historyButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim().startsWith('Graph'));
      expect(historyButton).toBeTruthy();
      historyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const filesButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Files'));
      expect(filesButton).toBeTruthy();
      filesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(nextSubview).toBe('history');
      expect(nextMode).toBe('files');
    } finally {
      dispose();
    }
  });

  it('does not render a mobile sidebar button unless requested explicitly', () => {
    mockMatchMedia(true);
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[620px]">
              <GitWorkspace
                mode="git"
                onModeChange={() => {}}
                subview="changes"
                onSubviewChange={() => {}}
                width={280}
                open={false}
                currentPath="/workspace/repo/src"
                repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: 'abc1234' }}
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'main',
                  headCommit: 'abc1234',
                  aheadCount: 1,
                  behindCount: 0,
                  workspaceSummary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                }}
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                  staged: [],
                  unstaged: [],
                  untracked: [],
                  conflicted: [],
                }}
                branches={{
                  repoRootPath: '/workspace/repo',
                  currentRef: 'main',
                  local: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }],
                  remote: [],
                }}
                commits={[]}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.querySelector('button[aria-label="Toggle browser sidebar"]')).toBeNull();
    } finally {
      dispose();
    }
  });

  it('supports vertical keyboard navigation across git view tabs', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => {
      const [subview, setSubview] = createSignal<'changes' | 'branches' | 'history'>('changes');

      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div class="h-[620px]">
                <GitWorkspace
                  mode="git"
                  onModeChange={() => {}}
                  subview={subview()}
                  onSubviewChange={setSubview}
                  width={280}
                  open
                  currentPath="/workspace/repo/src"
                  repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: 'abc1234' }}
                  repoSummary={{
                    repoRootPath: '/workspace/repo',
                    headRef: 'main',
                    headCommit: 'abc1234',
                    aheadCount: 1,
                    behindCount: 0,
                    workspaceSummary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                  }}
                  workspace={{
                    repoRootPath: '/workspace/repo',
                    summary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                    staged: [],
                    unstaged: [],
                    untracked: [],
                    conflicted: [],
                  }}
                  branches={{
                    repoRootPath: '/workspace/repo',
                    currentRef: 'main',
                    local: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }],
                    remote: [],
                  }}
                  commits={[]}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      const activeTab = host.querySelector('[role="tab"][aria-selected="true"]') as HTMLButtonElement | null;
      expect(activeTab?.id).toBe('git-workbench-subview-tab-changes');
      expect(activeTab?.getAttribute('aria-controls')).toBe('git-workbench-subview-panel-changes');
      expect(activeTab?.getAttribute('tabindex')).toBe('0');
      expect(host.querySelector('#git-workbench-subview-panel-changes')).toBeTruthy();
      activeTab!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(host.querySelector('#git-workbench-subview-tab-branches')?.getAttribute('aria-selected')).toBe('true');
      expect(host.querySelector('#git-workbench-subview-panel-branches')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('uses the content header button to reopen the git sidebar on mobile widgets', () => {
    mockMatchMedia(true);
    let toggleSidebarCount = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[620px]">
              <GitWorkspace
                mode="git"
                onModeChange={() => {}}
                subview="changes"
                onSubviewChange={() => {}}
                width={280}
                open={false}
                showMobileSidebarButton
                onToggleSidebar={() => {
                  toggleSidebarCount += 1;
                }}
                currentPath="/workspace/repo/src"
                repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: 'abc1234' }}
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'main',
                  headCommit: 'abc1234',
                  aheadCount: 1,
                  behindCount: 0,
                  workspaceSummary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                }}
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                  staged: [],
                  unstaged: [],
                  untracked: [],
                  conflicted: [],
                }}
                branches={{
                  repoRootPath: '/workspace/repo',
                  currentRef: 'main',
                  local: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }],
                  remote: [],
                }}
                commits={[]}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const sidebarButton = host.querySelector('button[aria-label="Toggle browser sidebar"]');
      expect(sidebarButton).toBeTruthy();
      expect(sidebarButton?.textContent).toContain('Sidebar');
      sidebarButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(toggleSidebarCount).toBe(1);
    } finally {
      dispose();
    }
  });

  it('routes initial git bootstrap through one shell-owned loading pane', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[620px]">
              <GitWorkspace
                mode="git"
                onModeChange={() => {}}
                subview="branches"
                onSubviewChange={() => {}}
                width={280}
                open
                currentPath="/workspace/repo/src"
                repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: 'abc1234' }}
                shellLoadingMessage="Loading branches..."
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Preparing the active Git view...');
      expect(host.textContent).toContain('Loading branches...');
      expect(host.querySelector('[data-testid="git-sidebar-scroll-region"]')).toBeNull();
      expect(host.textContent).not.toContain('Current path is not inside a Git repository.');
    } finally {
      dispose();
    }
  });

  it('keeps the shell chrome visible when branch history is loading inside branches view', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[620px]">
              <GitWorkspace
                mode="git"
                onModeChange={() => {}}
                subview="branches"
                onSubviewChange={() => {}}
                width={280}
                open
                currentPath="/workspace/repo/src"
                repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: 'abc1234' }}
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'main',
                  headCommit: 'abc1234',
                  aheadCount: 1,
                  behindCount: 0,
                  workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                }}
                branches={{
                  repoRootPath: '/workspace/repo',
                  currentRef: 'main',
                  local: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }],
                  remote: [],
                }}
                selectedBranch={{
                  name: 'main',
                  fullName: 'refs/heads/main',
                  kind: 'local',
                  current: true,
                }}
                selectedBranchSubview="history"
                commits={[]}
                listLoading
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.querySelector('[data-testid="git-sidebar-scroll-region"]')).toBeTruthy();
      expect(host.textContent).toContain('Loading commit history...');
      expect(host.textContent).not.toContain('Preparing the active Git view...');
    } finally {
      dispose();
    }
  });

  it('keeps branch delete review scoped to the widget while preview shape and git subview change', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const branch = {
      name: 'feature/demo',
      fullName: 'refs/heads/feature/demo',
      kind: 'local' as const,
      worktreePath: '',
    };
    const plainPreview = {
      repoRootPath: '/workspace/repo',
      name: 'feature/demo',
      fullName: 'refs/heads/feature/demo',
      kind: 'local' as const,
      requiresWorktreeRemoval: false,
      requiresDiscardConfirmation: false,
      safeDeleteAllowed: true,
      safeDeleteBaseRef: 'main',
      forceDeleteAllowed: true,
      forceDeleteRequiresConfirm: true,
      planFingerprint: 'plain-plan',
    };
    const linkedPreview = {
      ...plainPreview,
      requiresWorktreeRemoval: true,
      planFingerprint: 'linked-plan',
      linkedWorktree: {
        worktreePath: '/workspace/repo-linked',
        accessible: true,
        summary: {
          stagedCount: 0,
          unstagedCount: 0,
          untrackedCount: 1,
          conflictedCount: 0,
        },
        staged: [],
        unstaged: [],
        untracked: [],
        conflicted: [],
      },
    };
    let setSubview!: (view: 'changes' | 'branches' | 'history') => void;
    let setPreview!: (preview: typeof plainPreview | typeof linkedPreview) => void;

    const dispose = render(() => {
      const [subview, updateSubview] = createSignal<'changes' | 'branches' | 'history'>('branches');
      const [preview, updatePreview] = createSignal<typeof plainPreview | typeof linkedPreview>(plainPreview);
      setSubview = (next) => updateSubview(next);
      setPreview = (next) => updatePreview(() => next);

      return (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div {...{ [FLOE_DIALOG_SURFACE_HOST_ATTR]: 'true' }} class="h-[620px]">
                <GitWorkspace
                  mode="git"
                  onModeChange={() => {}}
                  subview={subview()}
                  onSubviewChange={updateSubview}
                  width={280}
                  open
                  currentPath="/workspace/repo/src"
                  repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: 'abc1234' }}
                  repoSummary={{
                    repoRootPath: '/workspace/repo',
                    headRef: 'main',
                    headCommit: 'abc1234',
                    aheadCount: 0,
                    behindCount: 0,
                    workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                  }}
                  workspace={{
                    repoRootPath: '/workspace/repo',
                    summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                    staged: [],
                    unstaged: [],
                    untracked: [],
                    conflicted: [],
                  }}
                  branches={{
                    repoRootPath: '/workspace/repo',
                    currentRef: 'main',
                    local: [
                      { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
                      branch,
                    ],
                    remote: [],
                  }}
                  selectedBranch={branch}
                  deleteReviewOpen
                  deleteReviewBranch={branch}
                  deletePreview={preview()}
                  onCloseDeleteReview={() => {}}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      );
    }, host);

    try {
      await settleDialog();

      const surfaceHost = host.querySelector(`[${FLOE_DIALOG_SURFACE_HOST_ATTR}="true"]`) as HTMLElement | null;
      let dialog = surfaceHost?.querySelector('[role="dialog"]') as HTMLElement | null;
      expect(dialog).toBeTruthy();
      expect(dialog?.closest('[data-floe-dialog-mode]')?.getAttribute('data-floe-dialog-mode')).toBe('surface');
      expect(dialog?.textContent).toContain('Delete Branch');
      expect(dialog?.textContent).toContain('Leave your current worktree and uncommitted files untouched.');

      setPreview(linkedPreview);
      await settleDialog();

      dialog = surfaceHost?.querySelector('[role="dialog"]') as HTMLElement | null;
      expect(dialog).toBeTruthy();
      expect(dialog?.textContent).toContain('Delete Branch and Worktree');
      expect(dialog?.textContent).toContain('/workspace/repo-linked');

      setSubview('changes');
      await settleDialog();

      dialog = surfaceHost?.querySelector('[role="dialog"]') as HTMLElement | null;
      expect(dialog).toBeTruthy();
      expect(dialog?.closest('[data-floe-dialog-mode]')?.getAttribute('data-floe-dialog-mode')).toBe('surface');
      expect(dialog?.textContent).toContain('/workspace/repo-linked');
    } finally {
      dispose();
    }
  });
});
