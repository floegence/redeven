// @vitest-environment jsdom

import { LayoutProvider } from '@floegence/floe-webapp-core';
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

  it('keeps global git controls interactive and exposes the mobile selector toggle for detail views', () => {
    let refreshCount = 0;
    let openSidebarCount = 0;
    let nextSubview = '';
    let nextMode = '';
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <ProtocolProvider contract={redevenV1Contract}>
          <div class="h-[640px]">
            <GitWorkbench
          mode="git"
          onModeChange={(value) => {
            nextMode = value;
          }}
          currentPath="/workspace/repo/src"
          subview="branches"
          onSubviewChange={(value) => {
            nextSubview = value;
          }}
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
          compare={{
            repoRootPath: '/workspace/repo',
            baseRef: 'main',
            targetRef: 'feature/demo',
            targetAheadCount: 1,
            targetBehindCount: 0,
            commits: [],
            files: [],
          }}
          commits={[]}
          showSidebarToggle
          onOpenSidebar={() => {
            openSidebarCount += 1;
          }}
          onRefresh={() => {
            refreshCount += 1;
          }}
            />
          </div>
        </ProtocolProvider>
      </LayoutProvider>
    ), host);

    try {
      const refreshButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Refresh'));
      expect(refreshButton).toBeTruthy();
      refreshButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const subviewButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('History'));
      expect(subviewButton).toBeTruthy();
      subviewButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const filesModeButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Files');
      expect(filesModeButton).toBeTruthy();
      filesModeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const openSidebarButton = host.querySelector('button[aria-label="Open Git sidebar"]');
      expect(openSidebarButton).toBeTruthy();
      openSidebarButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(refreshCount).toBe(1);
      expect(nextSubview).toBe('history');
      expect(nextMode).toBe('files');
      expect(openSidebarCount).toBe(1);
    } finally {
      dispose();
    }
  });
});
