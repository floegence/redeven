import '../../index.css';

import { FloeConfigProvider, LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { commands, page } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { EnvContext, type EnvContextValue } from '../pages/EnvContext';
import { DownloadContext } from '../downloads/DownloadContext';
import { createDownloadManager } from '../downloads/createDownloadManager';
import { FilePreviewContext } from './FilePreviewContext';
import { createFilePreviewController } from './createFilePreviewController';
import { FileBrowserSurfaceContext } from './FileBrowserSurfaceContext';
import { FileBrowserSurfaceHost } from './FileBrowserSurfaceHost';
import { createFileBrowserSurfaceController } from './createFileBrowserSurfaceController';

const transport = vi.hoisted(() => ({ session: {}, list: vi.fn(), context: vi.fn(), repo: vi.fn(), capabilities: vi.fn(), subscriptions: 0 }));
const media = commands as unknown as {
  emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' | null }) => Promise<void>;
};
vi.mock('@floegence/floe-webapp-protocol', async () => ({
  ...await vi.importActual<typeof import('@floegence/floe-webapp-protocol')>('@floegence/floe-webapp-protocol'),
  useProtocol: () => ({ session: () => transport.session, status: () => 'connected' }),
}));
vi.mock('../protocol/redeven_v1', async () => ({
  ...await vi.importActual<typeof import('../protocol/redeven_v1')>('../protocol/redeven_v1'),
  useRedevenRpc: () => ({ fs: { list: transport.list, getPathContext: transport.context }, git: { resolveRepo: transport.repo, getCapabilities: transport.capabilities } }),
}));
vi.mock('../services/gitWorkspaceRuntime', async () => {
  const actual = await vi.importActual<typeof import('../services/gitWorkspaceRuntime')>('../services/gitWorkspaceRuntime');
  return {
    ...actual,
    subscribeGitWorkspaceInvalidation: (...args: Parameters<typeof actual.subscribeGitWorkspaceInvalidation>) => {
      const unsubscribe = actual.subscribeGitWorkspaceInvalidation(...args);
      transport.subscriptions += 1;
      return () => { transport.subscriptions -= 1; unsubscribe(); };
    },
  };
});

let dispose: (() => void) | undefined;
afterEach(async () => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.restoreAllMocks();
  await media.emulateMediaPreferences({ reducedMotion: null });
});

it('keeps a populated Files window responsive through repeated exits without extra loads or retained subscriptions', async () => {
  await page.viewport(1440, 900);
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  transport.session = {};
  transport.subscriptions = 0;
  transport.list.mockReset().mockResolvedValue({ entries: Array.from({ length: 1000 }, (_, i) => ({
    name: 'entry-' + i, path: '/workspace/entry-' + i, isDirectory: true,
  })) });
  transport.context.mockReset().mockResolvedValue({ homePathAbs: '/workspace', defaultRootId: 'workspace', roots: [
    { id: 'workspace', label: 'Workspace', pathAbs: '/workspace', kind: 'custom', permissions: { read: true, write: true } },
  ] });
  transport.repo.mockReset().mockResolvedValue({ available: false, gitAvailable: false });
  transport.capabilities.mockReset().mockResolvedValue({});
  const controller = createFileBrowserSurfaceController();
  const host = document.createElement('div');
  document.body.append(host);
  let underlayActions = 0;
  dispose = render(() => {
    const preview = createFilePreviewController({ client: () => null, rpc: () => null, canWrite: () => false });
    const downloads = createDownloadManager({ source: { open: async () => { throw new Error('Downloads are outside this fixture'); } } });
    const context = { env_id: () => 'floating-files-performance', env: () => ({ permissions: { can_read: true, can_write: true, can_execute: false } }),
      settingsSeq: () => 0, viewMode: () => 'activity', filesSidebarOpen: () => true, setFilesSidebarOpen: () => {},
    } as unknown as EnvContextValue;
    return <FloeConfigProvider><LayoutProvider><NotificationProvider>
      <EnvContext.Provider value={context}><DownloadContext.Provider value={downloads}>
        <FilePreviewContext.Provider value={{ controller: preview, openPreview: preview.openPreview, closePreview: preview.closePreview }}>
          <FileBrowserSurfaceContext.Provider value={{ controller, openBrowser: async params => { controller.openSurface(params); }, closeBrowser: controller.closeSurface }}>
            <button type="button" data-testid="underlay-action" onClick={() => { underlayActions += 1; }}>Underlay action</button>
            <FileBrowserSurfaceHost />
          </FileBrowserSurfaceContext.Provider>
        </FilePreviewContext.Provider>
      </DownloadContext.Provider></EnvContext.Provider>
    </NotificationProvider></LayoutProvider></FloeConfigProvider>;
  }, host);
  const closeMs: number[] = [];
  const exitMs: number[] = [];
  const frameMs: number[] = [];
  const geometry = () => document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]');
  for (let cycle = 0; cycle < 5; cycle += 1) {
    const underlay = host.querySelector<HTMLButtonElement>('[data-testid="underlay-action"]')!;
    underlay.focus();
    controller.openSurface({ path: '/workspace', title: 'Workspace files' });
    await expect.poll(() => geometry()?.dataset.floatingPresence).toBe('open');
    const firstItem = () => document.querySelector<HTMLElement>('[data-file-browser-item-path="/workspace/entry-0"]');
    await expect.poll(firstItem).not.toBeNull();
    // Let initial discovery and geometry persistence settle before measuring close.
    await new Promise(resolve => setTimeout(resolve, 200));
    const window = geometry()!;
    const item = firstItem()!;
    const loads = [transport.list.mock.calls.length, transport.context.mock.calls.length, transport.repo.mock.calls.length];
    expect(transport.subscriptions).toBe(1);
    const started = performance.now();
    window.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="close"]')!.click();
    closeMs.push(performance.now() - started);
    expect(controller.open()).toBe(false);
    await Promise.resolve();
    expect(document.activeElement).toBe(underlay);
    expect(window.inert).toBe(true);
    underlay.click();
    expect(underlayActions).toBe(cycle + 1);
    let lastFrame = performance.now();
    while (geometry() && performance.now() - started < 1000) {
      expect(firstItem()).toBe(item);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const now = performance.now();
      frameMs.push(now - lastFrame);
      lastFrame = now;
    }
    exitMs.push(performance.now() - started);
    expect(geometry()).toBeNull();
    expect(firstItem()).toBeNull();
    expect(transport.subscriptions).toBe(0);
    expect([transport.list.mock.calls.length, transport.context.mock.calls.length, transport.repo.mock.calls.length]).toEqual(loads);
  }
  expect(Math.max(...closeMs)).toBeLessThan(50);
  expect(Math.max(...exitMs)).toBeLessThan(500);
  expect(Math.max(...frameMs)).toBeLessThan(50);
  console.info('[floating-files-close]', JSON.stringify({ entries: 1000, cycles: 5, closeMs, exitMs, maxFrameMs: Math.max(...frameMs), activeSubscriptions: transport.subscriptions }));
}, 15000);
