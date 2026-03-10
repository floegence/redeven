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

  it('keeps the global header lightweight while exposing refresh only when no sidebar toggle is requested', () => {
    let refreshCount = 0;
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
                compare={{
                  repoRootPath: '/workspace/repo',
                  baseRef: 'main',
                  targetRef: 'feature/demo',
                  targetAheadCount: 1,
                  targetBehindCount: 0,
                  commits: [],
                  files: [],
                }}
                onRefresh={() => {
                  refreshCount += 1;
                }}
              />
            </div>
          </ProtocolProvider>
        </NotificationProvider>
      </LayoutProvider>
    ), host);

    try {
      const refreshButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Refresh')) as HTMLButtonElement | undefined;
      expect(refreshButton).toBeTruthy();
      expect(refreshButton?.className).toContain('bg-background/72');
      expect(refreshButton?.className).not.toContain('border-input');
      refreshButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(host.querySelector('button[aria-label="Toggle browser sidebar"]')).toBeNull();
      expect(refreshCount).toBe(1);
      expect(host.textContent).toContain('Branches');
      expect(host.textContent).toContain('/workspace/repo');
      expect(host.textContent).toContain('3 changes');
      expect(host.textContent).toContain('2 pending');
      expect(host.textContent).toContain('Branch Snapshot');
    } finally {
      dispose();
    }
  });
});
