import '../../index.css';

import {
  LayoutProvider,
  NotificationProvider,
} from '@floegence/floe-webapp-core';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { createSignal } from 'solid-js';
import type { GitGetDiffContentRequest } from '../protocol/redeven_v1';
import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMocks = vi.hoisted(() => ({
  listWorkspacePage: vi.fn(),
  getCommitDetail: vi.fn(),
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
        getCommitDetail: rpcMocks.getCommitDetail,
        getDiffContent: vi.fn(async (request: GitGetDiffContentRequest) => ({
          repoRootPath: request.repoRootPath,
          mode: request.mode,
          file: { ...request.file, changeType: 'modified', patchText: '@@ -1 +1 @@\n-before\n+after' },
        })),
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
      host!.querySelectorAll('[data-git-content-skeleton="changed-files"][data-git-skeleton-busy="true"]'),
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
  it('shows one contained empty workspace across portrait and narrow widget sizes', async () => {
    await page.viewport(1280, 1700);
    rpcMocks.listWorkspacePage.mockResolvedValue({
      repoRootPath: '/workspace/repo', section: 'changes',
      summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
      totalCount: 0, scopeFileCount: 0, offset: 0, nextOffset: 0, hasMore: false, items: [],
    });
    Object.assign(host!.style, { width: '980px', height: '1500px' });
    const branch: GitBranchSummary = { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true };
    dispose = render(() => <LayoutProvider><NotificationProvider><ProtocolProvider contract={redevenV1Contract}>
      <GitBranchesPanel repoRootPath="/workspace/repo" selectedBranch={branch} />
    </ProtocolProvider></NotificationProvider></LayoutProvider>, host!);
    await waitForCondition(() => !!host!.querySelector('.git-branch-status-empty-state'), 'empty workspace loads');
    const frame = host!.querySelector<HTMLElement>('[data-git-branch-status-content-frame]')!;
    expect(frame.querySelector('.git-diff-split'), 'empty workspace has no file/diff divider').toBeNull();
    expect(frame.querySelector('[data-git-diff-panel]')).toBeNull();
    expect(frame.textContent).toContain('This worktree is clean.');
    for (const width of [980, 420]) {
      host!.style.width = `${width}px`;
      await settle();
      const state = frame.querySelector<HTMLElement>('.git-branch-status-empty-state')!;
      const bounds = frame.getBoundingClientRect();
      const copy = state.getBoundingClientRect();
      expect(frame.scrollWidth).toBe(frame.clientWidth);
      expect(copy.left).toBeGreaterThanOrEqual(bounds.left);
      expect(copy.right).toBeLessThanOrEqual(bounds.right);
      expect(Math.abs((copy.left + copy.right) / 2 - (bounds.left + bounds.right) / 2)).toBeLessThan(2);
    }
  });

  it('uses the full history height before selection and a bounded rail during portrait inspection', async () => {
    await page.viewport(1280, 1700);
    Object.assign(host!.style, { width: '980px', height: '1500px' });
    const commits = Array.from({ length: 50 }, (_, index) => ({
      hash: `commit-${index}`, shortHash: `hash${index}`, parents: index < 49 ? [`commit-${index + 1}`] : [],
      subject: `Review history entry ${index}`, authorName: 'Developer', authorTimeMs: 1706000000000,
    }));
    rpcMocks.getCommitDetail.mockImplementation(async ({ commit }: { commit: string }) => ({
      repoRootPath: '/workspace/repo', commit: commits.find((item) => item.hash === commit),
      files: [{ path: 'src/app.ts', changeType: 'modified', additions: 1, deletions: 1, patchText: '@@ -1 +1 @@\n-before\n+after' }],
    }));
    const branch: GitBranchSummary = { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true };
    const [selected, setSelected] = createSignal('');
    dispose = render(() => <LayoutProvider><NotificationProvider><ProtocolProvider contract={redevenV1Contract}>
      <GitBranchesPanel repoRootPath="/workspace/repo" selectedBranch={branch} selectedBranchSubview="history"
        commits={commits} selectedCommitHash={selected()} onSelectCommit={setSelected} />
    </ProtocolProvider></NotificationProvider></LayoutProvider>, host!);
    await waitForCondition(() => !!host!.querySelector('[data-commit-graph-row]'), 'history loads');
    const layout = host!.querySelector<HTMLElement>('.git-branch-history-layout')!;
    const graph = host!.querySelector<HTMLElement>('[data-commit-graph]')!;
    const navigation = graph.parentElement!;
    expect(navigation.clientHeight, 'unselected history uses available height').toBeGreaterThan(layout.clientHeight * 0.9);
    const first = host!.querySelector<HTMLButtonElement>('[data-commit-graph-row="commit-0"]')!;
    first.click();
    await waitForCondition(() => !!host!.querySelector('.git-patch-viewer__viewport'), 'selected diff loads');
    expect(navigation.clientHeight).toBeLessThanOrEqual(320);
    expect(navigation.clientHeight).toBeGreaterThanOrEqual(100);
    const detail = host!.querySelector<HTMLElement>('[data-git-branch-history-details]')!;
    expect(detail.getBoundingClientRect().top).toBeGreaterThan(navigation.getBoundingClientRect().bottom);
    expect(detail.clientHeight).toBeGreaterThan(layout.clientHeight * 0.6);
    expect(host!.scrollWidth).toBe(host!.clientWidth);
    const later = host!.querySelector<HTMLButtonElement>('[data-commit-graph-row="commit-20"]')!;
    later.click();
    await settle();
    expect(later.getBoundingClientRect().bottom).toBeLessThanOrEqual(navigation.getBoundingClientRect().bottom + 1);
    const close = host!.querySelector<HTMLButtonElement>('[aria-label="Close commit details"]')!;
    expect(close).not.toBeNull();
    close.click();
    await settle();
    expect(selected()).toBe('');
    expect(document.activeElement).toBe(later);
    expect(navigation.clientHeight).toBeGreaterThan(layout.clientHeight * 0.9);
    expect(host!.querySelector('[data-git-branch-history-details]')).toBeNull();
    expect(host!.querySelector('[data-commit-graph]')).toBe(graph);
    host!.style.width = '1400px';
    host!.style.height = '700px';
    later.click();
    await settle();
    const panel = host!.querySelector<HTMLElement>('.git-branch-history-detail-panel')!;
    expect(navigation.getBoundingClientRect().right).toBeLessThan(panel.getBoundingClientRect().left);
    expect(navigation.clientHeight).toBeGreaterThan(layout.clientHeight * 0.9);
    expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(host!.getBoundingClientRect().bottom);
  });

  it('aligns directory navigation and diff inspection in one frame before and after file selection', async () => {
    await page.viewport(1280, 1700);
    Object.assign(host!.style, { width: '980px', height: '1500px' });
    rpcMocks.listWorkspacePage.mockImplementation(async ({ directoryPath }: { directoryPath?: string }) => ({
      repoRootPath: '/workspace/repo', section: 'changes', directoryPath: directoryPath ?? '',
      summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
      totalCount: 1, scopeFileCount: 1, offset: 0, nextOffset: 1, hasMore: false,
      items: directoryPath ? [{ section: 'unstaged', changeType: 'modified', path: 'src/app.ts', displayPath: 'src/app.ts' }]
        : [{ section: 'changes', entryKind: 'directory', path: 'src', displayPath: 'src', directoryPath: 'src', descendantFileCount: 1, containsUnstaged: true }],
    }));
    const branch: GitBranchSummary = { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true };
    dispose = render(() => <LayoutProvider><NotificationProvider><ProtocolProvider contract={redevenV1Contract}>
      <GitBranchesPanel repoRootPath="/workspace/repo" selectedBranch={branch} />
    </ProtocolProvider></NotificationProvider></LayoutProvider>, host!);
    await waitForCondition(() => !!host!.querySelector('tr[aria-selected]'), 'directory inventory loads');
    const frame = host!.querySelector<HTMLElement>('[data-git-diff-split]')!;
    const rail = frame.querySelector<HTMLElement>('.git-diff-split__files')!;
    const detail = frame.querySelector<HTMLElement>('.git-diff-split__detail')!;
    const railHeader = rail.querySelector<HTMLElement>('.git-diff-split__files-header');
    const detailHeader = detail.querySelector<HTMLElement>('.git-diff-panel__toolbar')!;
    expect(railHeader, 'file navigation has a matching header').not.toBeNull();
    expect(railHeader!.getBoundingClientRect().top).toBe(detailHeader.getBoundingClientRect().top);
    expect(railHeader!.getBoundingClientRect().bottom).toBe(detailHeader.getBoundingClientRect().bottom);
    expect(getComputedStyle(frame).borderTopWidth).toBe('1px');
    expect(rail.getBoundingClientRect().bottom).toBe(detail.getBoundingClientRect().bottom);
    expect(detail.querySelector('.git-diff-panel__modes'), 'no inactive mode controls without a file').toBeNull();
    const empty = detail.querySelector<HTMLElement>('[data-git-diff-empty]')!;
    expect(empty).not.toBeNull();
    expect(empty.clientHeight).toBeGreaterThan(detail.clientHeight * 0.8);
    expect(frame.scrollWidth).toBe(frame.clientWidth);
    rail.querySelector<HTMLButtonElement>('tr button')!.click();
    await waitForCondition(() => !!detail.querySelector('.git-patch-viewer__viewport'), 'directory opens into file inspection');
    expect(detail.querySelector('.git-diff-panel__modes')).not.toBeNull();
    expect(railHeader!.getBoundingClientRect().bottom).toBe(detailHeader.getBoundingClientRect().bottom);
    expect(rail.querySelector('tbody tr')!.getBoundingClientRect().top).toBe(railHeader!.getBoundingClientRect().bottom);
    expect(rail.querySelector('tbody tr')!.getBoundingClientRect().height).toBe(30);
  });

});
