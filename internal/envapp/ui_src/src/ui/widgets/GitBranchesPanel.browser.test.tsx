import '../../index.css';

import {
  LayoutProvider,
  NotificationProvider,
} from '@floegence/floe-webapp-core';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMocks = vi.hoisted(() => ({
  listWorkspacePage: vi.fn(),
}));

vi.mock('../protocol/redeven_v1', async () => {
  const actual = await vi.importActual<typeof import('../protocol/redeven_v1')>(
    '../protocol/redeven_v1',
  );
  return {
    ...actual,
    useRedevenRpc: () => ({
      git: {
        getBranchCompare: vi.fn(),
        getCommitDetail: vi.fn(),
        getDiffContent: vi.fn(),
        listWorkspacePage: rpcMocks.listWorkspacePage,
      },
    }),
  };
});

import {
  redevenV1Contract,
  type GitBranchSummary,
} from '../protocol/redeven_v1';
import type { GitBranchDetailPresentationState } from '../utils/gitWorkbench';
import { GitBranchesPanel } from './GitBranchesPanel';

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await Promise.resolve();
}

async function waitForCondition(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) {
    await settle();
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  expect(predicate(), message).toBe(true);
}

function rectMetrics(element: HTMLElement | null, name: string) {
  expect(element, `${name} should exist`).toBeTruthy();
  const rect = element!.getBoundingClientRect();
  return {
    top: Math.round(rect.top),
    height: Math.round(rect.height),
  };
}

function expectStableMetric(
  before: ReturnType<typeof rectMetrics>,
  after: ReturnType<typeof rectMetrics>,
  label: string,
) {
  expect(Math.abs(after.top - before.top), `${label} top shifted`).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - before.height), `${label} height shifted`).toBeLessThanOrEqual(1);
}

function readBranchLayout(host: HTMLElement) {
  return {
    header: rectMetrics(
      host.querySelector('[data-git-branch-header-layout]'),
      'branch header',
    ),
    summary: rectMetrics(
      host.querySelector('[data-git-branch-status-summary-state]'),
      'branch status summary',
    ),
    content: rectMetrics(
      host.querySelector('[data-git-branch-status-content-frame]'),
      'branch status content frame',
    ),
  };
}

describe('GitBranchesPanel rendered branch verification stability', () => {
  let host: HTMLDivElement | null = null;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    rpcMocks.listWorkspacePage.mockReset();
    rpcMocks.listWorkspacePage.mockResolvedValue({
      repoRootPath: '/workspace/repo',
      section: 'changes',
      summary: {
        stagedCount: 0,
        unstagedCount: 1,
        untrackedCount: 0,
        conflictedCount: 0,
      },
      totalCount: 1,
      scopeFileCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [
        {
          section: 'unstaged',
          changeType: 'modified',
          path: 'src/app.ts',
          displayPath: 'src/app.ts',
          additions: 4,
          deletions: 1,
        },
      ],
    });

    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    host?.remove();
    host = null;
  });

  it('keeps header, status summary, and content frame stable during branch verification', async () => {
    const branch: GitBranchSummary = {
      name: 'main',
      fullName: 'refs/heads/main',
      kind: 'local',
      current: true,
    };
    const [detailState, setDetailState] = createSignal<GitBranchDetailPresentationState>({
      kind: 'ready',
      branch,
    });

    dispose = render(
      () => (
        <LayoutProvider>
          <NotificationProvider>
            <ProtocolProvider contract={redevenV1Contract}>
              <div style={{ width: '980px', height: '620px' }}>
                <GitBranchesPanel
                  repoRootPath="/workspace/repo"
                  repoSummary={{
                    repoRootPath: '/workspace/repo',
                    headRef: 'main',
                    headCommit: '1111111111111111',
                    workspaceSummary: {
                      stagedCount: 0,
                      unstagedCount: 1,
                      untrackedCount: 0,
                      conflictedCount: 0,
                    },
                  }}
                  selectedBranch={branch}
                  branchDetailState={detailState()}
                  onMergeBranch={() => undefined}
                  onCheckoutBranch={() => undefined}
                  onDeleteBranch={() => undefined}
                />
              </div>
            </ProtocolProvider>
          </NotificationProvider>
        </LayoutProvider>
      ),
      host!,
    );

    await waitForCondition(
      () =>
        rpcMocks.listWorkspacePage.mock.calls.length > 0 &&
        !host!.querySelector('.git-branch-stable-placeholder'),
      'ready branch status should render before measuring stability',
    );
    const readyBefore = readBranchLayout(host!);

    setDetailState({ kind: 'verifying', branch });
    await settle();
    const verifying = readBranchLayout(host!);

    const visibleStatuses = Array.from(
      host!.querySelectorAll('.git-inline-loading-status'),
    ).filter((node) => node.getBoundingClientRect().width > 0);
    expect(visibleStatuses).toHaveLength(1);
    expect(visibleStatuses[0]?.textContent).toContain('Checking');
    expect(host!.textContent).not.toContain('Checking branch selection');

    setDetailState({ kind: 'ready', branch });
    await waitForCondition(
      () => !host!.querySelector('.git-branch-stable-placeholder'),
      'ready branch status should return after verification',
    );
    const readyAfter = readBranchLayout(host!);

    for (const key of ['header', 'summary', 'content'] as const) {
      expectStableMetric(readyBefore[key], verifying[key], `${key} during verification`);
      expectStableMetric(readyBefore[key], readyAfter[key], `${key} after verification`);
    }
  });
});
