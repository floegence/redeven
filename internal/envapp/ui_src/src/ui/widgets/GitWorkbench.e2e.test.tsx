// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { redevenV1Contract } from '../protocol/redeven_v1';
import { GitWorkbench } from './GitWorkbench';

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function clickRepositoryMenuItem(host: HTMLElement, label: string) {
  const trigger = host.querySelector('button[aria-label="More actions"]') as HTMLButtonElement | null;
  expect(trigger).toBeTruthy();
  trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();
  const item = Array.from(document.body.querySelectorAll('[role="menu"] button')).find(
    (node) => node.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
  expect(item).toBeTruthy();
  item!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();
}

describe('GitWorkbench interactions', () => {
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

  it('keeps the global header lightweight while exposing repository sync actions', async () => {
    let refreshCount = 0;
    let fetchCount = 0;
    let pullCount = 0;
    let pushCount = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitWorkbench
                currentPath="/workspace/repo/src"
                subview="branches"
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'main',
                  headCommit: 'abc1234',
                  aheadCount: 2,
                  behindCount: 1,
                  workspaceSummary: { stagedCount: 1, unstagedCount: 2, untrackedCount: 0, conflictedCount: 0 },
                }}
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 1, unstagedCount: 2, untrackedCount: 0, conflictedCount: 0 },
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
                    { name: 'feature/demo', fullName: 'refs/heads/feature/demo', kind: 'local', authorTimeMs: Date.now() },
                  ],
                  remote: [],
                }}
                selectedBranch={{ name: 'feature/demo', fullName: 'refs/heads/feature/demo', kind: 'local', authorTimeMs: Date.now() }}
                onRefresh={() => {
                  refreshCount += 1;
                }}
                onBrowseFiles={() => {}}
                onOpenInTerminal={() => {}}
                onFetch={() => {
                  fetchCount += 1;
                }}
                onPull={() => {
                  pullCount += 1;
                }}
                onPush={() => {
                  pushCount += 1;
                }}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const pullButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Pull 1')) as HTMLButtonElement | undefined;
      const refreshButton = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement | null;
      expect(pullButton).toBeTruthy();
      expect(refreshButton).toBeTruthy();
      expect(refreshButton?.className).toContain('bg-background/72');
      expect(refreshButton?.className).not.toContain('redeven-surface-control--muted');
      expect(refreshButton?.className).not.toContain('border-input');
      expect(refreshButton?.className).not.toContain(' border ');
      expect(refreshButton?.className).not.toContain('border-input');
      pullButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await clickRepositoryMenuItem(host, 'Fetch');
      await clickRepositoryMenuItem(host, 'Push 2');
      refreshButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(host.querySelector('button[aria-label="Toggle browser sidebar"]')).toBeNull();
      expect(fetchCount).toBe(1);
      expect(pullCount).toBe(1);
      expect(pushCount).toBe(1);
      expect(refreshCount).toBe(1);
      expect(host.textContent).toContain('/workspace/repo');
      expect(host.textContent).toContain('Workspace');
      expect(host.textContent).toContain('No checked-out worktree');
      expect(host.textContent).toContain('This branch is not checked out in the active worktree.');
    } finally {
      dispose();
    }
  });

  it('keeps repository identity and the contextual primary action on one compact row', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitWorkbench
                currentPath="/workspace/repo/src"
                subview="branches"
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'main',
                  headCommit: 'abc1234',
                  aheadCount: 1,
                  workspaceSummary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
                }}
                branches={{
                  repoRootPath: '/workspace/repo',
                  currentRef: 'main',
                  local: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }],
                  remote: [],
                }}
                onOpenStash={() => {}}
                onFetch={() => {}}
                onPull={() => {}}
                onPush={() => {}}
                onRefresh={() => {}}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const pushButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Push 1')) as HTMLButtonElement | undefined;
      const header = host.querySelector('[data-git-repository-header="compact"]');
      expect(pushButton).toBeTruthy();
      expect(header).toBeTruthy();
      expect(pushButton?.parentElement?.className).toContain('items-center');
      expect(pushButton?.parentElement?.parentElement?.className).toContain('justify-between');
    } finally {
      dispose();
    }
  });

  it('renders detached HEAD explicitly in the header and disables pull and push', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitWorkbench
                currentPath="/workspace/repo/src"
                subview="history"
                repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'HEAD', headCommit: 'def56789abc12345' }}
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'HEAD',
                  headCommit: 'def56789abc12345',
                  detached: true,
                  workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
                }}
                commits={[]}
                onPull={() => {}}
                onPush={() => {}}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Detached HEAD');
      expect(host.textContent).toContain('def56789');
      expect(host.textContent).toContain('Viewing def56789 without a branch.');
      const moreButton = host.querySelector('button[aria-label="More actions"]') as HTMLButtonElement | null;
      expect(moreButton).toBeTruthy();
      moreButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      const menuButtons = Array.from(document.body.querySelectorAll('[role="menu"] button')) as HTMLButtonElement[];
      expect(menuButtons.find((node) => node.textContent?.includes('Pull'))?.disabled).toBe(true);
      expect(menuButtons.find((node) => node.textContent?.includes('Push'))?.disabled).toBe(true);
    } finally {
      dispose();
    }
  });

  it('offers a one-click checkout to the suggested reattach branch while detached', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onCheckoutBranch = vi.fn();

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitWorkbench
                currentPath="/workspace/repo/src"
                subview="changes"
                repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'HEAD', headCommit: 'def56789abc12345' }}
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'HEAD',
                  headCommit: 'def56789abc12345',
                  detached: true,
                  reattachBranch: { name: 'main', fullName: 'refs/heads/main', kind: 'local', headCommit: 'abc12345' },
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
                onCheckoutBranch={onCheckoutBranch}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      expect(host.textContent).toContain('Viewing def56789 without a branch.');
      expect(host.textContent).toContain('Last attached: main');
      const checkoutButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Checkout main')) as HTMLButtonElement | undefined;
      expect(checkoutButton).toBeTruthy();
      checkoutButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onCheckoutBranch).toHaveBeenCalledWith({
        name: 'main',
        fullName: 'refs/heads/main',
        kind: 'local',
        headCommit: 'abc12345',
      });
    } finally {
      dispose();
    }
  });

  it('opens the shared stash list from the header overflow menu', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onOpenStash = vi.fn();

    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitWorkbench
                currentPath="/workspace/repo/src"
                subview="changes"
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'main',
                  headCommit: 'abc1234',
                  stashCount: 2,
                  workspaceSummary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
                }}
                workspace={{
                  repoRootPath: '/workspace/repo',
                  summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
                  staged: [],
                  unstaged: [{ section: 'unstaged', changeType: 'modified', path: 'src/app.ts', displayPath: 'src/app.ts' }],
                  untracked: [],
                  conflicted: [],
                }}
                onOpenStash={onOpenStash}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      await clickRepositoryMenuItem(host, 'Stashes · 2');

      expect(onOpenStash).toHaveBeenCalledWith({
        tab: 'stashes',
        repoRootPath: '/workspace/repo',
        source: 'header',
      });
    } finally {
      dispose();
    }
  });

  it('opens repository actions from the identity header with a stable repository snapshot', async () => {
    const onAskFlower = vi.fn();
    const onOpenInTerminal = vi.fn();
    const onBrowseFiles = vi.fn();
    const onCopyText = vi.fn();
    const onOpenStash = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => (
      <LayoutProvider>
        <NotificationProvider>
          <ProtocolProvider contract={redevenV1Contract}>
            <div class="h-[640px]">
              <GitWorkbench
                currentPath="/workspace/repo/src"
                subview="changes"
                repoInfo={{ available: true, repoRootPath: '/workspace/repo', headRef: 'main', headCommit: 'abc1234' }}
                repoSummary={{
                  repoRootPath: '/workspace/repo',
                  headRef: 'main',
                  headCommit: 'abc1234',
                  stashCount: 2,
                  workspaceSummary: { stagedCount: 1, unstagedCount: 2, untrackedCount: 0, conflictedCount: 0 },
                }}
                onAskFlower={onAskFlower}
                onOpenInTerminal={onOpenInTerminal}
                onBrowseFiles={onBrowseFiles}
                onCopyText={onCopyText}
                onOpenStash={onOpenStash}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const target = host.querySelector('[data-git-repository-context-target="header"]') as HTMLElement | null;
      expect(target).toBeTruthy();
      const openMenu = async () => {
        target!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        await Promise.resolve();
        return Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      };

      let actions = await openMenu();
      actions.find((item) => item.textContent?.includes('Ask Flower'))!.click();
      expect(onAskFlower).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'repository',
        repoRootPath: '/workspace/repo',
        headRef: 'main',
        headCommit: 'abc1234',
        summary: expect.objectContaining({ stashCount: 2 }),
      }));

      actions = await openMenu();
      actions.find((item) => item.textContent?.includes('Open Terminal'))!.click();
      expect(onOpenInTerminal).toHaveBeenCalledWith({ path: '/workspace/repo', preferredName: 'repo' });

      actions = await openMenu();
      actions.find((item) => item.textContent?.includes('Browse Files'))!.click();
      expect(onBrowseFiles).toHaveBeenCalledWith({ path: '/workspace/repo', preferredName: 'repo' });

      actions = await openMenu();
      actions.find((item) => item.textContent?.includes('Stashes'))!.click();
      expect(onOpenStash).toHaveBeenCalledWith({ tab: 'stashes', repoRootPath: '/workspace/repo', source: 'header' });

      actions = await openMenu();
      actions.find((item) => item.textContent?.includes('Copy Absolute Path'))!.click();
      expect(onCopyText).toHaveBeenCalledWith('/workspace/repo');
    } finally {
      dispose();
    }
  });
});
