import '../../index.css';
import { FloeConfigProvider, LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvContext, type EnvContextValue } from '../pages/EnvContext';
import { DownloadContext } from '../downloads/DownloadContext';
import { createDownloadManager } from '../downloads/createDownloadManager';
import { FilePreviewContext } from './FilePreviewContext';
import { createFilePreviewController } from './createFilePreviewController';
import { RemoteFileBrowser } from './RemoteFileBrowser';

const home = '/Users/tangjianyin';
const target = '/Volumes/JianDisk/code/floegence/floebrowser-projection-lifecycle';
const transport = vi.hoisted(() => ({ session: {}, list: vi.fn(), context: vi.fn(), repo: vi.fn(), capabilities: vi.fn() }));
vi.mock('@floegence/floe-webapp-protocol', async () => ({
  ...await vi.importActual<typeof import('@floegence/floe-webapp-protocol')>('@floegence/floe-webapp-protocol'),
  useProtocol: () => ({ session: () => transport.session, status: () => 'connected' }),
}));
vi.mock('../protocol/redeven_v1', async () => ({
  ...await vi.importActual<typeof import('../protocol/redeven_v1')>('../protocol/redeven_v1'),
  useRedevenRpc: () => ({
    fs: { list: transport.list, getPathContext: transport.context },
    git: { resolveRepo: transport.repo, getCapabilities: transport.capabilities },
  }),
}));

let dispose: (() => void) | undefined;
beforeEach(() => {
  transport.session = {};
  transport.list.mockReset().mockImplementation(async ({ path }: { path: string }) => {
    if (path.startsWith(`${home}/Volumes`)) throw { code: 404, message: 'not found' };
    const prefix = path === '/' ? '/' : `${path}/`;
    const children = new Set([home, target, '/srv/project', `${target}/child`]
      .filter((directory) => directory.startsWith(prefix))
      .map((directory) => directory.slice(prefix.length).split('/')[0]!));
    return { entries: [...children].map((name) => ({ name, path: `${prefix}${name}`, isDirectory: true })) };
  });
  transport.context.mockReset().mockResolvedValue({
    homePathAbs: home, defaultRootId: 'home', roots: [
      { id: 'home', label: 'Home', pathAbs: home, kind: 'home', permissions: { read: true, write: true } },
      { id: 'computer', label: 'Computer', pathAbs: '/', kind: 'computer', permissions: { read: true, write: false } },
      { id: 'project', label: 'Team project', pathAbs: '/srv/project', kind: 'custom', permissions: { read: true, write: false } },
    ],
  });
  transport.repo.mockReset().mockResolvedValue({ available: false, gitAvailable: false });
  transport.capabilities.mockReset().mockResolvedValue({});
});
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

async function mountFiles(initialPath: string, placement: 'activity' | 'workbench' = 'activity') {
  await page.viewport(1440, 900);
  const storage = new Map<string, string>();
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => {
    const [committed, setCommitted] = createSignal('');
    const [root, setRoot] = createSignal('');
    const [title, setTitle] = createSignal('');
    const preview = createFilePreviewController({ client: () => null, rpc: () => null, canWrite: () => false });
    const downloads = createDownloadManager({ source: { open: async () => { throw new Error('Downloads are outside this fixture'); } } });
    const context = {
      env_id: () => 'path-test', env: () => ({ permissions: { can_read: true, can_write: true, can_execute: false } }),
      settingsSeq: () => 0, viewMode: () => placement, filesSidebarOpen: () => true,
      setFilesSidebarOpen: () => {},
    } as unknown as EnvContextValue;
    return <FloeConfigProvider config={{ storage: { namespace: 'files-path-test', adapter: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); },
      removeItem: (key) => { storage.delete(key); },
    } } }}><LayoutProvider><NotificationProvider>
      <EnvContext.Provider value={context}><DownloadContext.Provider value={downloads}>
        <FilePreviewContext.Provider value={{ controller: preview, openPreview: preview.openPreview, closePreview: preview.closePreview }}>
          <div style={{ height: '740px', width: '1200px', transform: placement === 'workbench' ? 'translate(20px, 10px) scale(0.9)' : undefined }}>
            <RemoteFileBrowser initialPathOverride={initialPath} widgetId={placement === 'workbench' ? 'paths-widget' : undefined}
              onCommittedPathChange={(path, rootId) => { setCommitted(path); setRoot(rootId ?? ''); }} onTitleChange={setTitle} />
          </div>
          <output data-testid="committed-path">{committed()}</output>
          <output data-testid="committed-root">{root()}</output>
          <output data-testid="files-title">{title()}</output>
        </FilePreviewContext.Provider>
      </DownloadContext.Provider></EnvContext.Provider>
    </NotificationProvider></LayoutProvider></FloeConfigProvider>;
  }, host);
  await expect.poll(() => host.querySelector('[data-testid="committed-path"]')?.textContent).toBe(initialPath);
  const committedPath = () => host.querySelector('[data-testid="committed-path"]')?.textContent;
  const savedPaths = () => [...storage.entries()].filter(([key]) => key.includes('files:lastPath:')).map(([, value]) => JSON.parse(value));
  const enter = async (value: string) => {
    const breadcrumb = host.querySelector<HTMLElement>('nav[aria-label="Breadcrumb"]')!;
    const current = breadcrumb.querySelector<HTMLElement>('button[title="Go to path"]')!;
    expect(current).toBeTruthy();
    await userEvent.click(current);
    const input = page.getByRole('textbox', { name: 'Go to path', exact: true });
    await input.fill(value);
    await userEvent.keyboard('{Enter}');
  };
  transport.list.mockClear();
  return { host, storage, savedPaths, committedPath, enter };
}

describe('Files path entry through the published components and runtime navigation', () => {
  it.each([
    { start: home, placement: 'activity' as const },
    { start: '/', placement: 'workbench' as const },
  ])('opens an external absolute path from $start in $placement', async ({ start, placement }) => {
    const f = await mountFiles(start, placement);
    await f.enter(`${target}/`);
    await expect.poll(f.committedPath).toBe(target);
    expect(transport.list.mock.calls.some(([request]) => request.path === target)).toBe(true);
    expect(transport.list.mock.calls.some(([request]) => request.path.startsWith(`${home}/Volumes`))).toBe(false);
    expect(f.host.querySelector('[data-testid="committed-root"]')?.textContent).toBe('computer');
    expect(f.host.querySelector('[data-testid="files-title"]')?.textContent).toContain('floebrowser-projection-lifecycle');
    expect(f.host.querySelector(`[data-file-browser-item-path="${target}/child"]`)).not.toBeNull();
    await expect.poll(f.savedPaths).toContain(target);
  });

  it.each([
    [404, 'not found', 'This folder no longer exists or its volume is not mounted.'],
    [400, 'path is not a directory', 'The requested path is not a folder.'],
    [403, 'path outside filesystem scope', 'This folder is outside the filesystem roots authorized for this environment.'],
    [403, 'read permission denied', 'Your current session does not have permission to read this folder.'],
    [403, 'host filesystem permission denied', 'The operating system denied access to this folder.'],
    [503, 'connection lost', 'The connection is not ready or the filesystem service is temporarily unavailable. Your current location was kept.'],
  ])('retains the committed directory and input for runtime failure %s %s', async (code, message, copy) => {
    const f = await mountFiles(home);
    await expect.poll(f.savedPaths).toContain(home);
    transport.list.mockRejectedValue({ code, message });
    await f.enter(target);
    await expect.poll(() => f.host.querySelector('[data-testid="file-browser-header-status"]')?.textContent).toBe(copy);
    expect(f.committedPath()).toBe(home);
    expect(f.host.querySelector<HTMLInputElement>('input[aria-label="Go to path"]')?.value).toBe(target);
    expect(f.savedPaths()).toEqual([home]);
  });

  it('keeps the newer root selection when an older directory response arrives late', async () => {
    const f = await mountFiles(home);
    let resolve!: (value: { entries: [] }) => void;
    const response = new Promise<{ entries: [] }>((done) => { resolve = done; });
    transport.list.mockImplementation(({ path }: { path: string }) => path === target ? response : Promise.resolve({ entries: [] }));
    await f.enter(target);
    await expect.poll(() => transport.list.mock.calls.some(([request]) => request.path === target)).toBe(true);
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    resolve({ entries: [] });
    await expect.poll(() => f.host.querySelector('input[aria-label="Go to path"]')?.getAttribute('aria-invalid')).toBe('true');
    expect(f.committedPath()).toBe(home);
    await expect.poll(f.savedPaths).toEqual([home]);
  });
});
