// @vitest-environment jsdom

import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { redevenV1Contract } from '../protocol/redeven_v1';
import { GitWorkbench } from './GitWorkbench';

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

  it('keeps the global header lightweight while exposing repository sync actions', () => {
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
      const fetchButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Fetch')) as HTMLButtonElement | undefined;
      const pullButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Pull')) as HTMLButtonElement | undefined;
      const pushButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Push')) as HTMLButtonElement | undefined;
      const refreshButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Refresh')) as HTMLButtonElement | undefined;
      expect(fetchButton).toBeTruthy();
      expect(pullButton).toBeTruthy();
      expect(pushButton).toBeTruthy();
      expect(refreshButton).toBeTruthy();
      expect(refreshButton?.className).toContain('bg-background/72');
      expect(refreshButton?.className).not.toContain('border-input');
      fetchButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      pullButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      pushButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      refreshButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(host.querySelector('button[aria-label="Toggle browser sidebar"]')).toBeNull();
      expect(fetchCount).toBe(1);
      expect(pullCount).toBe(1);
      expect(pushCount).toBe(1);
      expect(refreshCount).toBe(1);
      expect(host.textContent).toContain('Branches');
      expect(host.textContent).toContain('/workspace/repo');
      expect(host.textContent).toContain('Status');
      expect(host.textContent).toContain('Branch is not checked out');
      expect(host.textContent).toContain('Status is only available for checked-out local worktrees.');
    } finally {
      dispose();
    }
  });

  it('renders detached HEAD explicitly in the header and disables pull and push', () => {
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
      const pullButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Pull')) as HTMLButtonElement | undefined;
      const pushButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Push')) as HTMLButtonElement | undefined;
      expect(host.textContent).toContain('Detached HEAD');
      expect(host.textContent).toContain('def56789');
      expect(host.textContent).toContain('Pull and push are unavailable while HEAD is detached.');
      expect(pullButton?.disabled).toBe(true);
      expect(pushButton?.disabled).toBe(true);
    } finally {
      dispose();
    }
  });
});
