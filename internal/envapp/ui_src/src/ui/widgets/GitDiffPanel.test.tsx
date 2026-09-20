// @vitest-environment jsdom
import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitDiffFileContent, GitGetDiffContentResponse } from '../protocol/redeven_v1';
import { GitDiffPanel } from './GitDiffPanel';

const getDiffContent = vi.hoisted(() => vi.fn());
vi.mock('../protocol/redeven_v1', async () => ({
  ...await vi.importActual<typeof import('../protocol/redeven_v1')>('../protocol/redeven_v1'),
  useRedevenRpc: () => ({ git: { getDiffContent } }),
}));
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })));
});
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
afterEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('GitDiffPanel request ownership', () => {
  it.each(['preview', 'full'])('settles an absent %s result without stale patch content or a loading loop', async (mode) => {
    getDiffContent.mockImplementation(async (request) => request.mode === mode
      ? { repoRootPath: '/repo', mode }
      : { repoRootPath: '/repo', mode: 'preview', file: { path: 'gone.ts', patchText: '@@ -1 +1 @@\n-old\n+obsoleteValue' } });
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <LayoutProvider><NotificationProvider><GitDiffPanel open item={{ path: 'gone.ts' }} source={{ kind: 'workspace', repoRootPath: '/repo', workspaceSection: 'unstaged' }} emptyMessage="No changes remain" /></NotificationProvider></LayoutProvider>, host);
    try {
      await flush();
      if (mode === 'full') {
        Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.toLowerCase() === 'full context')!.click();
        await flush();
      }
      expect(host.querySelector('[data-git-diff-empty]'), host.textContent ?? '').not.toBeNull();
      expect(host.textContent).not.toContain('obsoleteValue');
      expect(host.textContent).not.toContain('Loading');
      expect(getDiffContent).toHaveBeenCalledTimes(mode === 'full' ? 2 : 1);
    } finally { dispose(); }
  });

  it('loads when mounted open, rejects late file results, and reloads refreshed summaries at the same path', async () => {
    const pending: Array<(value: GitGetDiffContentResponse) => void> = [];
    getDiffContent.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const [item, setItem] = createSignal<GitDiffFileContent>({ path: 'first.ts', changeType: 'modified' });
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => (
      <LayoutProvider><NotificationProvider>
        <GitDiffPanel open item={item()} source={{ kind: 'workspace', repoRootPath: '/repo', workspaceSection: 'unstaged' }} emptyMessage="Select a file" />
      </NotificationProvider></LayoutProvider>
    ), host);
    const result = (path: string, text: string): GitGetDiffContentResponse => ({ repoRootPath: '/repo', mode: 'preview', file: { path, changeType: 'modified', patchText: `@@ -1 +1 @@\n-old\n+${text}` } });
    try {
      await flush();
      expect(getDiffContent).toHaveBeenCalledTimes(1);
      setItem({ path: 'second.ts', changeType: 'modified' });
      await flush();
      expect(getDiffContent).toHaveBeenCalledTimes(2);
      pending[1](result('second.ts', 'currentValue'));
      await flush();
      pending[0](result('first.ts', 'obsoleteValue'));
      await flush();
      expect(host.textContent).toContain('currentValue');
      expect(host.textContent).not.toContain('obsoleteValue');
      setItem({ path: 'second.ts', changeType: 'modified', additions: 2 });
      await flush();
      expect(getDiffContent).toHaveBeenCalledTimes(3);
      expect(host.textContent).not.toContain('currentValue');
      pending[2](result('second.ts', 'refreshedValue'));
      await flush();
      expect(host.textContent).toContain('refreshedValue');
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally { dispose(); }
  });
});
