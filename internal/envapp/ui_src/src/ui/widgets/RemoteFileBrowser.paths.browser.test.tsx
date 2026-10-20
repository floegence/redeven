import '../../index.css';
import { FloeConfigProvider, LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { createSignal, Show } from 'solid-js';
import { DirectoryPicker } from '@floegence/floe-webapp-core/ui';
import { useEnvFilesystemPicker } from '../services/filesystemPicker';
import { bindSessionHTTP, envDirectoryFavorites } from '../services/sessionHTTP';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvContext, type EnvContextValue } from '../pages/EnvContext';
import { DownloadContext } from '../downloads/DownloadContext';
import { createDownloadManager } from '../downloads/createDownloadManager';
import { FilePreviewContext } from './FilePreviewContext';
import { createFilePreviewController } from './createFilePreviewController';
import { RemoteFileBrowser } from './RemoteFileBrowser';
import { I18nProvider, type RedevenLocale } from '../i18n';
import { writeStoredLanguagePreference } from '../i18n/storage';

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
let releaseFavorites: (() => void) | undefined;
function FavoritePickerFixture() {
  const picker = useEnvFilesystemPicker();
  const [open, setOpen] = createSignal(false);
  return <><button data-testid="open-favorites-picker" onClick={() => setOpen(true)}>Choose directory</button><DirectoryPicker {...picker} open={open()} onOpenChange={setOpen} initialPath={home} onSelect={() => {}} /></>;
}
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
afterEach(() => { releaseFavorites?.(); releaseFavorites = undefined; dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks(); writeStoredLanguagePreference('en-US'); });

async function mountFiles(initialPath: string, placement: 'activity' | 'workbench' = 'activity', options: { storage?: Map<string, string>; restore?: boolean; unavailable?: boolean; picker?: boolean; locale?: RedevenLocale } = {}) {
  writeStoredLanguagePreference(options.locale ?? 'en-US');
  await page.viewport(1440, 900);
  const storage = options.storage ?? new Map<string, string>();
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
    return <I18nProvider><FloeConfigProvider config={{ storage: { namespace: 'files-path-test', adapter: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); },
      removeItem: (key) => { storage.delete(key); },
    } } }}><LayoutProvider><NotificationProvider>
      <EnvContext.Provider value={context}><DownloadContext.Provider value={downloads}>
        <FilePreviewContext.Provider value={{ controller: preview, openPreview: preview.openPreview, closePreview: preview.closePreview }}>
          <div data-testid="files-surface" style={{ height: '740px', width: '1200px', transform: placement === 'workbench' ? 'translate(20px, 10px) scale(0.9)' : undefined }}>
            <RemoteFileBrowser initialPathOverride={options.restore ? undefined : initialPath} widgetId={placement === 'workbench' ? 'paths-widget' : undefined}
              onCommittedPathChange={(path, rootId) => { setCommitted(path); setRoot(rootId ?? ''); }} onTitleChange={setTitle} />
          </div>
          <Show when={options.picker}><FavoritePickerFixture /></Show>
          <output data-testid="committed-path">{committed()}</output>
          <output data-testid="committed-root">{root()}</output>
          <output data-testid="files-title">{title()}</output>
        </FilePreviewContext.Provider>
      </DownloadContext.Provider></EnvContext.Provider>
    </NotificationProvider></LayoutProvider></FloeConfigProvider></I18nProvider>;
  }, host);
  if (options.unavailable) {
    await expect.poll(() => host.querySelector('[data-testid="file-browser-navigation-failure"]')).not.toBeNull();
  } else {
    await expect.poll(() => host.querySelector('[data-testid="committed-path"]')?.textContent).toBe(initialPath);
  }
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

describe('Files directory favorites across published pickers', () => {
  it.each([
    ['en-US', 'Favorite', 'Unfavorite'],
    ['zh-CN', '收藏', '取消收藏'],
    ['zh-TW', '收藏', '取消收藏'],
    ['ja-JP', 'お気に入りに追加', 'お気に入りから削除'],
    ['ko-KR', '즐겨찾기 추가', '즐겨찾기 해제'],
    ['de-DE', 'Favorisieren', 'Favorit entfernen'],
    ['es-ES', 'Añadir a favoritos', 'Quitar de favoritos'],
    ['fr-FR', 'Ajouter aux favoris', 'Retirer des favoris'],
    ['pt-BR', 'Favoritar', 'Desfavoritar'],
    ['ru-RU', 'В избранное', 'Убрать из избранного'],
  ] as const)('uses concise favorite actions in %s menus and star labels', async (locale, favorite, unfavorite) => {
    let paths: string[] = [];
    let revision = 0;
    releaseFavorites = bindSessionHTTP({fetch: async (_input, init) => {
      if (init?.method === 'PUT' || init?.method === 'DELETE') {
        const { path } = JSON.parse(String(init.body)) as { path: string };
        paths = init.method === 'PUT' ? [path] : [];
        revision++;
      }
      return new Response(JSON.stringify({ok:true,data:{paths,revision}}));
    }, events: async function*(){}});
    const f = await mountFiles(target, 'activity', {locale});
    const favorites = envDirectoryFavorites(() => 'Failed')!;
    await favorites.onRefresh!();
    const background = f.host.querySelector<HTMLElement>('[data-testid="file-browser-content-scroll-region"]')!;
    const openMenu = async (label: string) => {
      background.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true,button:2,clientX:200,clientY:260}));
      await expect.poll(() => document.querySelector('[data-file-menu-item="directory-favorite"]')?.textContent?.trim()).toBe(label);
    };
    await openMenu(favorite);
    document.querySelector<HTMLElement>('[data-file-menu-item="directory-favorite"]')!.click();
    await expect.poll(() => favorites.paths).toEqual([target]);
    const star = [...f.host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === unfavorite + ': ' + target)!;
    expect(star).toBeTruthy();
    expect(star.title).toBe(unfavorite);
    await openMenu(unfavorite);
    document.querySelector<HTMLElement>('[data-file-menu-item="directory-favorite"]')!.click();
    await expect.poll(() => favorites.paths).toEqual([]);
    await expect.poll(() => star.getAttribute('aria-label')).toBe(favorite + ': ' + target);
  });

  it.each(['activity', 'workbench'] as const)('shares folder, tree, background and toolbar actions in %s', async placement => {
    let paths: string[] = [];
    let revision = 0;
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT' || init?.method === 'DELETE') {
        const {path} = JSON.parse(String(init.body)) as {path: string};
        const favorite = init.method === 'PUT';
        if (paths.includes(path) !== favorite) {
          paths = favorite ? [path, ...paths] : paths.filter(item => item !== path);
          revision++;
        }
      }
      return new Response(JSON.stringify({ok:true,data:{paths,revision}}));
    });
    releaseFavorites = bindSessionHTTP({fetch, events: async function*(){}});
    const list = transport.list.getMockImplementation()!;
    transport.list.mockImplementation(async (input: {path:string}) => {
      const response = await list(input);
      return input.path === target ? {entries:[...response.entries,{name:'readme.txt',path:target + '/readme.txt',isDirectory:false}]} : response;
    });
    const f = await mountFiles(target, placement, {picker:true});
    const favorites = envDirectoryFavorites(() => 'Failed')!;
    await favorites.onRefresh!();
    const childPath = target + '/child';
    const openMenu = async (element: HTMLElement) => {
      element.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true,button:2,clientX:200,clientY:260}));
      await expect.poll(() => document.querySelector('[data-file-menu-item="directory-favorite"]')).not.toBeNull();
    };
    const chooseFavorite = async () => {
      document.querySelector<HTMLElement>('[data-file-menu-item="directory-favorite"]')!.click();
      await expect.poll(() => favorites.pendingPaths?.length).toBe(0);
    };
    for (const view of ['List','Grid']) {
      [...f.host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === view)!.click();
      await openMenu(f.host.querySelector<HTMLElement>('[data-file-browser-item-path="' + childPath + '"]')!);
      await chooseFavorite();
      await expect.poll(() => favorites.paths.includes(childPath)).toBe(view === 'List');
      expect(f.committedPath()).toBe(target);
    }
    const treeParent = f.host.querySelector<HTMLElement>('[data-tree-row-path="' + target + '"]')!;
    treeParent.parentElement!.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click();
    await expect.poll(() => f.host.querySelector('[data-tree-row-path="' + childPath + '"]')).not.toBeNull();
    await openMenu(f.host.querySelector<HTMLElement>('[data-tree-row-path="' + childPath + '"]')!);
    await chooseFavorite();
    await expect.poll(() => favorites.paths).toContain(childPath);
    await openMenu(f.host.querySelector<HTMLElement>('[data-testid="file-browser-content-scroll-region"]')!);
    await chooseFavorite();
    await expect.poll(() => favorites.paths).toEqual([target,childPath]);
    const root = f.host.querySelector<HTMLElement>('[data-filesystem-root-path="/"]')!;
    await openMenu(root);
    expect(document.querySelector('[data-file-menu-item="delete"]')).toBeNull();
    await chooseFavorite();
    await expect.poll(() => favorites.paths).toEqual(['/',target,childPath]);
    const rootButton = root.querySelector<HTMLButtonElement>('button')!;
    rootButton.focus(); rootButton.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'F10',shiftKey:true}));
    await expect.poll(() => document.querySelector('[data-file-menu-item="directory-favorite"]')).not.toBeNull();
    await chooseFavorite();
    await expect.poll(() => favorites.paths).toEqual([target,childPath]);
    const file = f.host.querySelector<HTMLElement>('[data-file-browser-item-path="' + target + '/readme.txt"]')!;
    file.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:200,clientY:260}));
    await expect.poll(() => document.querySelector('[role="menu"]')).not.toBeNull();
    expect(document.querySelector('[data-file-menu-item="directory-favorite"]')).toBeNull();
    document.querySelector<HTMLElement>('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    const currentStar = [...f.host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === 'Unfavorite: ' + target)!;
    expect(currentStar).toBeTruthy();
    currentStar.click();
    await expect.poll(() => favorites.paths).toEqual([childPath]);
    f.host.querySelector<HTMLButtonElement>('[data-testid="open-favorites-picker"]')!.click();
    await page.getByRole('tab', {name:'Favorites',exact:true}).click();
    await expect.poll(() => document.querySelector('[data-picker-favorite-path="' + childPath + '"]')).not.toBeNull();
    const selectedBefore = f.committedPath();
    document.querySelector<HTMLButtonElement>('[data-picker-favorite-path="' + childPath + '"]')!.click();
    await expect.poll(() => transport.list.mock.calls.some(([input]) => input.path === childPath)).toBe(true);
    expect(f.committedPath()).toBe(selectedBefore);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    const sidebar = f.host.querySelector<HTMLElement>('section[aria-label="Favorites"]')!;
    sidebar.querySelector<HTMLButtonElement>('button[title="' + childPath + '"]')!.click();
    await expect.poll(f.committedPath).toBe(childPath);
  });
});

describe('Files path entry through the published components and runtime navigation', () => {
  it.each(['activity', 'workbench'] as const)('keeps long recovery paths and actions reachable in a narrow %s surface', async (placement) => {
    const longPath = `/Volumes/External drive/${'long-folder-'.repeat(16)}/project`;
    transport.list.mockRejectedValue({ code: 404, message: 'not found' });
    const f = await mountFiles(longPath, placement, { unavailable: true });
    const surface = f.host.querySelector<HTMLElement>('[data-testid="files-surface"]')!;
    surface.style.width = '640px';
    surface.style.height = '420px';
    const viewport = f.host.querySelector<HTMLElement>('[data-testid="file-browser-content-scroll-region"]')!;
    const path = viewport.querySelector<HTMLElement>('dd')!;
    expect(path.textContent).toBe(longPath);
    await expect.element(page.getByRole('heading', { name: 'project', exact: true })).toBeVisible();
    expect(getComputedStyle(path).textOverflow).not.toBe('ellipsis');
    expect(getComputedStyle(path).userSelect).toBe('text');
    await expect.poll(() => viewport.scrollWidth).toBe(viewport.clientWidth);
    expect(path.scrollWidth).toBe(path.clientWidth);
    await expect.element(page.getByRole('button', { name: 'Open Home', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open Home', exact: true }).click();
    await expect.poll(() => viewport.querySelector('dd')?.textContent).toBe(home);
    await expect.element(page.getByRole('heading', { name: 'tangjianyin', exact: true })).toBeVisible();
  });

  it('keeps readable file contents with a dismissible notice after a transient refresh failure', async () => {
    const f = await mountFiles(target);
    transport.list.mockRejectedValue({ code: 503, message: 'connection lost' });
    await page.getByRole('button', { name: 'Refresh current directory', exact: true }).click();
    await expect.poll(() => f.host.querySelector('[data-testid="file-browser-navigation-failure"]')).not.toBeNull();
    expect(f.host.querySelector(`[data-file-browser-item-path="${target}/child"]`)).not.toBeNull();
    expect(f.committedPath()).toBe(target);
    await page.getByRole('button', { name: 'Dismiss folder navigation error', exact: true }).click();
    expect(f.host.querySelector('[data-testid="file-browser-navigation-failure"]')).toBeNull();
    expect(f.host.querySelector(`[data-file-browser-item-path="${target}/child"]`)).not.toBeNull();
  });

  it.each(['activity', 'workbench'] as const)('keeps recovery readable and keyboard focus stable during a failed retry in %s', async (placement) => {
    transport.list.mockRejectedValue({ code: 404, message: 'not found' });
    const f = await mountFiles(target, placement, { unavailable: true });
    const panel = f.host.querySelector<HTMLElement>('[data-testid="file-browser-navigation-failure"]')!;
    const viewport = f.host.querySelector<HTMLElement>('[data-testid="file-browser-content-scroll-region"]')!;
    expect(viewport.contains(panel)).toBe(true);
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    const retryElement = retry.element();
    let reject!: (error: unknown) => void;
    transport.list.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    await retry.click();
    await expect.poll(() => panel.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(retryElement);
    expect(f.host.querySelector('.redeven-loading-curtain')).toBeNull();
    await userEvent.keyboard('{Enter}');
    expect(transport.list).toHaveBeenCalledTimes(1);
    reject({ code: 404, message: 'not found' });
    await expect.poll(() => panel.getAttribute('aria-busy')).toBe('false');
    expect(retry.element()).toBe(retryElement);
    expect(document.activeElement).toBe(retryElement);
    expect(f.committedPath()).toBe('');
    expect(f.savedPaths()).toEqual([]);

    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await page.getByRole('button', { name: 'Copy path', exact: true }).click();
    expect(write).toHaveBeenCalledWith(target);
    await expect.element(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  });

  it.each(['activity', 'workbench'] as const)('settles a deleted restored directory in %s until the user retries', async (placement) => {
    const existing = await mountFiles(target, placement);
    await expect.poll(existing.savedPaths).toContain(target);
    dispose?.();
    document.body.replaceChildren();
    const listExisting = transport.list.getMockImplementation()!;
    let available = false;
    let attempts = 0;
    transport.list.mockImplementation(async (request) => {
      if (request.path === target) {
        attempts += 1;
        if (!available) throw { code: 404, message: 'not found' };
      }
      return listExisting(request);
    });
    const restored = await mountFiles(target, placement, { storage: existing.storage, restore: true, unavailable: true });
    expect(attempts).toBe(1);
    expect(restored.committedPath()).toBe('');
    expect(restored.savedPaths()).toEqual([target]);
    expect(restored.host.querySelector('[data-testid="file-browser-content-scroll-region"]')?.textContent).not.toContain('This folder is empty');
    await page.getByRole('radio', { name: 'List', exact: true }).click();
    expect(attempts).toBe(1);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => restored.host.querySelector('[data-testid="file-browser-navigation-failure"]')).not.toBeNull();
    expect(attempts).toBe(2);
    expect(restored.savedPaths()).toEqual([target]);
    available = true;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(restored.committedPath).toBe(target);
    expect(attempts).toBe(3);
    expect(restored.host.querySelector('[data-testid="file-browser-navigation-failure"]')).toBeNull();
    expect(restored.host.querySelector(`[data-file-browser-item-path="${target}/child"]`)).not.toBeNull();
  });

  it('updates the recovery panel when the parent is unavailable and recovers through Home', async () => {
    const f = await mountFiles(target);
    const listExisting = transport.list.getMockImplementation()!;
    transport.list.mockImplementation(async (request) => {
      if (request.path.startsWith('/Volumes')) throw { code: 404, message: 'not found' };
      return listExisting(request);
    });
    await page.getByRole('button', { name: 'Refresh current directory', exact: true }).click();
    await expect.poll(() => f.host.querySelector('[data-testid="file-browser-navigation-failure"]')).not.toBeNull();
    await page.getByRole('button', { name: 'Open parent folder', exact: true }).click();
    await expect.poll(() => f.host.querySelector('[data-testid="file-browser-navigation-failure"] dd')?.textContent).toBe('/Volumes/JianDisk/code/floegence');
    expect(f.committedPath()).toBe(target);
    await page.getByRole('button', { name: 'Open Home', exact: true }).click();
    await expect.poll(f.committedPath).toBe(home);
    expect(f.host.querySelector('[data-testid="file-browser-navigation-failure"]')).toBeNull();
    await expect.poll(f.savedPaths).toContain(home);
  });

  it('keeps a deleted current directory unavailable until the user opens its parent', async () => {
    const f = await mountFiles(target);
    const listExisting = transport.list.getMockImplementation()!;
    transport.list.mockImplementation(async (request) => {
      if (request.path === target) throw { code: 404, message: 'not found' };
      return listExisting(request);
    });
    await page.getByRole('button', { name: 'Refresh current directory', exact: true }).click();
    await expect.poll(() => f.host.querySelector('[data-testid="file-browser-navigation-failure"]')).not.toBeNull();
    expect(f.committedPath()).toBe(target);
    expect(transport.list.mock.calls.map(([request]) => request.path)).toEqual([target]);
    expect(f.host.querySelector('[data-testid="file-browser-content-scroll-region"] [data-file-browser-item-path]')).toBeNull();
    await page.getByRole('button', { name: 'Open parent folder', exact: true }).click();
    await expect.poll(f.committedPath).toBe('/Volumes/JianDisk/code/floegence');
    await expect.poll(f.savedPaths).toContain('/Volumes/JianDisk/code/floegence');
    expect(f.host.querySelector('[data-testid="file-browser-navigation-failure"]')).toBeNull();
  });

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
