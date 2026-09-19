import '../../index.css';
import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitGetCommitDetailResponse } from '../protocol/redeven_v1';
import { GitHistoryBrowser } from './GitHistoryBrowser';
import { GitBranchesPanel } from './GitBranchesPanel';

const rpc = vi.hoisted(() => ({ getCommitDetail: vi.fn() }));
vi.mock('@floegence/floe-webapp-protocol', async () => ({
  ...await vi.importActual<typeof import('@floegence/floe-webapp-protocol')>('@floegence/floe-webapp-protocol'),
  useProtocol: () => ({ session: () => ({ connected: true }) }),
}));
vi.mock('../protocol/redeven_v1', async () => ({
  ...await vi.importActual<typeof import('../protocol/redeven_v1')>('../protocol/redeven_v1'),
  useRedevenRpc: () => ({ git: rpc }),
}));

const commits = ['first', 'second', 'third'].map((name) => ({
  hash: name, shortHash: name, parents: [], subject: `Review ${name} commit`,
  authorName: 'Developer', authorTimeMs: 1706000000000,
}));
function response(index: number): GitGetCommitDetailResponse {
  return { repoRootPath: '/workspace/repo', commit: commits[index], files: Array.from({ length: 8 }, (_, file) => ({
    path: `src/${commits[index].hash}-${file}.ts`, changeType: 'modified', additions: 1, deletions: 1,
    patchText: `@@ -1 +1 @@\n-before\n+${commits[index].hash} content`,
  })) };
}
function geometry(host: HTMLElement) {
  return ['[data-git-diff-split]', '.git-diff-split__files', '.git-diff-split__files-header', '.git-diff-split__detail', '.git-diff-panel__toolbar'].map((selector) => {
    const element = host.querySelector(selector);
    expect(element, `${selector} remains present while loading`).not.toBeNull();
    const { x, y, width, height } = element!.getBoundingClientRect();
    return { x, y, width, height };
  });
}
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); document.documentElement.classList.remove('dark'); rpc.getCommitDetail.mockReset(); });

describe('Commit inspection loading geometry', () => {
  for (const entry of ['graph', 'branch'] as const) {
    it(`settles ${entry} loading into explicit error and empty states`, async () => {
      const host = document.createElement('div');
      Object.assign(host.style, { width: '980px', height: '850px' });
      document.body.append(host);
      let rejectDetail!: (error: Error) => void;
      rpc.getCommitDetail.mockImplementation(({ commit }: { commit: string }) => commit === 'first'
        ? new Promise((_resolve, reject) => { rejectDetail = reject; })
        : Promise.resolve({ ...response(1), files: [] }));
      const [selected, setSelected] = createSignal('first');
      dispose = render(() => <LayoutProvider><NotificationProvider>
        {entry === 'graph'
          ? <GitHistoryBrowser class="h-full" currentPath="/workspace/repo"
              repoInfo={{ available: true, repoRootPath: '/workspace/repo' }} selectedCommitHash={selected()}
              selectedCommit={commits.find((commit) => commit.hash === selected())} />
          : <GitBranchesPanel repoRootPath="/workspace/repo" selectedBranch={{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }}
              selectedBranchSubview="history" commits={commits} selectedCommitHash={selected()} onSelectCommit={setSelected} />}
      </NotificationProvider></LayoutProvider>, host);
      await expect.poll(() => host.querySelector('[data-git-content-skeleton="file-rail"]')).not.toBeNull();
      rejectDetail(new Error('Request failed.'));
      await expect.poll(() => host.textContent).toContain('Request failed.');
      expect(host.querySelector('[data-git-content-skeleton]')).toBeNull();
      setSelected('second');
      await expect.poll(() => host.textContent).toContain('Review second commit');
      await expect.poll(() => host.querySelector('[data-git-content-skeleton]')).toBeNull();
      expect(host.querySelector('.git-patch-viewer__viewport')).toBeNull();
      expect(host.textContent).not.toContain('Request failed.');
      expect(host.textContent).toContain(entry === 'branch' ? 'No changed files are available for this commit.' : 'Select a changed file');
    });
    for (const width of [1400, 980, 540]) {
      it(`preserves ${entry} inspection frames at ${width}px through pending and ready commits`, async () => {
        await page.viewport(1500, 1700);
        document.documentElement.classList.toggle('dark', width === 980);
        const host = document.createElement('div');
        Object.assign(host.style, { width: `${width}px`, height: width === 980 ? '1500px' : '850px' });
        document.body.append(host);
        const pending = new Map<string, (value: GitGetCommitDetailResponse) => void>();
        rpc.getCommitDetail.mockImplementation(({ commit }: { commit: string }) => commit === 'first'
          ? Promise.resolve(response(0)) : new Promise<GitGetCommitDetailResponse>((resolve) => pending.set(commit, resolve)));
        const [selected, setSelected] = createSignal('first');
        dispose = render(() => <LayoutProvider><NotificationProvider>
          {entry === 'graph'
            ? <GitHistoryBrowser class="h-full" currentPath="/workspace/repo"
                repoInfo={{ available: true, repoRootPath: '/workspace/repo' }} selectedCommitHash={selected()}
                selectedCommit={commits.find((commit) => commit.hash === selected())}
                onSwitchDetached={() => undefined} />
            : <GitBranchesPanel repoRootPath="/workspace/repo" selectedBranch={{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }}
                selectedBranchSubview="history" commits={commits} selectedCommitHash={selected()} onSelectCommit={setSelected}
                onSwitchDetached={() => undefined} />}
        </NotificationProvider></LayoutProvider>, host);
        await expect.poll(() => host.querySelector('.git-patch-viewer__viewport')?.textContent).toContain('first content');
        const before = geometry(host);
        const frame = host.querySelector('[data-git-diff-split]');
        setSelected('second');
        await expect.poll(() => pending.has('second')).toBe(true);
        expect(geometry(host)).toEqual(before);
        expect(host.querySelector('[data-git-diff-split]')).toBe(frame);
        expect(host.querySelector('[data-git-content-skeleton="file-rail"]')).not.toBeNull();
        expect(host.querySelector('.git-patch-viewer__viewport')).toBeNull();
        expect(host.querySelector<HTMLButtonElement>('[data-git-full-commit-message-trigger]')?.disabled).toBe(true);
        expect(host.textContent).toContain('Review second commit');
        expect(host.textContent).not.toContain('first-0.ts');
        const captureDirectory = import.meta.env.VITE_GIT_LOADING_CAPTURE;
        if (captureDirectory) await page.screenshot({ path: `${captureDirectory}/${entry}-${width}-loading.png` });
        setSelected('third');
        await expect.poll(() => pending.has('third')).toBe(true);
        pending.get('second')!(response(1));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        expect(host.querySelector('.git-patch-viewer__viewport'), 'late results must not replace the selected commit').toBeNull();
        expect(host.textContent).toContain('Review third commit');
        pending.get('third')!(response(2));
        await expect.poll(() => host.querySelector('.git-patch-viewer__viewport')?.textContent).toContain('third content');
        expect(geometry(host)).toEqual(before);
        expect(host.querySelector<HTMLButtonElement>('[data-git-full-commit-message-trigger]')?.disabled).toBe(false);
        expect(host.scrollWidth).toBe(host.clientWidth);
        if (captureDirectory) await page.screenshot({ path: `${captureDirectory}/${entry}-${width}-ready.png` });
      });
    }
  }
});
