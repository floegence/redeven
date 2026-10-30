import '../../index.css';
import { FloeConfigProvider, LayoutProvider, ThemeProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { createDefaultWorkbenchState, type WorkbenchState, type WorkbenchWidgetDefinition } from '@floegence/floe-webapp-core/workbench';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { FileBrowserQuickAccess } from './FileBrowserQuickAccess';
import { filesystemPickerEnUS } from '../../../../../flower_ui/src/i18n/filesystemPickerMessages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { FileBrowserWorkspace } from './FileBrowserWorkspace';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { I18nProvider, useI18n, SUPPORTED_LOCALES, type EnvAppI18nContext } from '../i18n';
import { dictionaries } from '../i18n/locales/testDictionaries';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from '../i18n/storageKey';
import { RedevenWorkbenchSurface } from '../workbench/surface/RedevenWorkbenchSurface';
import { GitWorkspace } from './GitWorkspace';
import { redevenV1Contract } from '../protocol/redeven_v1';

const favorites = vi.hoisted(() => ({ paths: [] as string[], loading: false, error: undefined as string | undefined, onRefresh: vi.fn() }));
vi.mock('../services/directoryFavorites', async () => {
  const { filesystemPickerEnUS } = await import('../../../../../flower_ui/src/i18n/filesystemPickerMessages');
  return { useEnvDirectoryFavorites: () => ({ directoryFavorites: favorites, copy: { ...filesystemPickerEnUS, selectedCount: (count: number) => 'Selected: ' + count } }) };
});
const cleanups: (() => void)[] = [];
const longPath = '/Volumes/' + 'very-long-parent-directory/'.repeat(4) + 'JianDisk';
const home = '/Users/test';

beforeEach(() => { localStorage.removeItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY); favorites.paths = [longPath]; favorites.loading = false; favorites.error = undefined; favorites.onRefresh.mockClear(); });
afterEach(() => { cleanups.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); document.documentElement.classList.remove('dark'); });
async function settle() { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
function mountFiles(width = 240, scale = 1, height = 560, folderCount = 0, surfaceWidth = 1000) {
  const host = document.createElement('div'); document.body.append(host);
  const navigate = vi.fn(); const menu = vi.fn();
  cleanups.push(render(() => <FloeConfigProvider><LayoutProvider>
    <div style={{ width: surfaceWidth + 'px', height: height + 'px', transform: 'scale(' + scale + ')', 'transform-origin': 'top left' }}>
      <FileBrowserWorkspace mode="files" onModeChange={() => {}}
        files={Array.from({ length: folderCount }, (_, index) => ({ id: 'folder-' + index, name: 'Folder-' + index, path: '/Folder-' + index, type: 'folder' as const }))}
        currentPath={longPath} initialPath={longPath}
        homePath={home} instanceId="favorite-locations" resetKey={0} width={width} open
        roots={[
          { id: 'home', kind: 'home', label: 'Home', pathAbs: home, permissions: { read: true, write: true }, system: true },
          { id: 'computer', kind: 'computer', label: 'Computer', pathAbs: '/', permissions: { read: true, write: true }, system: true },
        ]} onRootSelect={navigate}
        resolveOverrideContextMenuItems={() => [{ id: 'remove-favorite', type: 'custom', label: 'Remove from favorites', onAction: (_items, event) => menu(event?.directory?.path) }]} />
    </div>
  </LayoutProvider></FloeConfigProvider>, host));
  return { host, navigate, menu };
}

describe('favorite directory locations', () => {
  it('keeps compact shortcuts outside the independently scrolling directory tree', async () => {
    await page.viewport(1100, 650);
    const { host } = mountFiles(); await settle();
    const locations = host.querySelector<HTMLElement>('[data-filesystem-locations]')!;
    const favorite = locations.querySelector<HTMLElement>('[data-directory-favorite-path]')!;
    const tree = host.querySelector<HTMLElement>('[data-testid="file-tree-scroll-region"]')!;
    expect(tree.contains(locations)).toBe(false);
    expect(locations.getBoundingClientRect().bottom - favorite.getBoundingClientRect().bottom).toBeLessThan(16);
    const outer = host.querySelector<HTMLElement>('[data-floe-shell-slot="sidebar"]')!.firstElementChild!;
    expect(outer.scrollWidth).toBe(outer.clientWidth);
    expect(outer.scrollHeight).toBe(outer.clientHeight);
  });

  it.each([['light', 240, 1], ['dark', 180, 1], ['light', 180, 0.7]] as const)('shares compact root rows in %s at %ipx and scale %s', async (theme, width, scale) => {
    await page.viewport(1100, 650);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { host } = mountFiles(width, scale); await settle();
    const locations = host.querySelector<HTMLElement>('[data-filesystem-locations]')!;
    const root = locations.querySelector<HTMLElement>('[data-filesystem-root-id="computer"]')!;
    const favorite = locations.querySelector<HTMLElement>('[data-directory-favorite-path]')!;
    expect(favorite).not.toBeNull();
    expect(favorite.closest('[data-testid="file-tree-scroll-region"]')).toBeNull();
    expect(favorite.getBoundingClientRect().top).toBeGreaterThanOrEqual(root.getBoundingClientRect().bottom);
    expect(Math.abs(favorite.getBoundingClientRect().height - root.getBoundingClientRect().height)).toBeLessThanOrEqual(scale);
    expect([...favorite.querySelector('svg')!.querySelectorAll('path')].map(path => path.getAttribute('d')))
      .toEqual([...root.querySelector('svg')!.querySelectorAll('path')].map(path => path.getAttribute('d')));
    const parent = favorite.querySelector<HTMLElement>('[data-directory-favorite-parent]')!;
    const name = favorite.querySelector<HTMLElement>('[data-directory-favorite-name]')!;
    expect(parent.scrollWidth).toBeGreaterThan(parent.clientWidth);
    expect(getComputedStyle(parent).textOverflow).toBe('ellipsis');
    expect(name.textContent).toBe('/JianDisk');
    expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
    expect(favorite.scrollWidth).toBeLessThanOrEqual(favorite.clientWidth);
    expect(name.getBoundingClientRect().height).toBeLessThan(favorite.getBoundingClientRect().height);
    const row = favorite.querySelector<HTMLButtonElement>('button')!;
    expect(row.getAttribute('aria-label')).toBe(longPath);
    expect(row.getAttribute('aria-current')).toBe('page');
    await userEvent.hover(row);
    await expect.element(page.getByRole('tooltip')).toHaveTextContent(longPath);
    await page.screenshot({ element: host, path: '../../../node_modules/.cache/directory-favorites/sidebar-' + theme + '-' + width + '-' + scale + '.png' });
  });

  it('preserves the captured directory on mouse, keyboard, and touch menu actions', async () => {
    await page.viewport(1100, 650);
    const { host, navigate, menu } = mountFiles(); await settle();
    const favorite = host.querySelector<HTMLElement>('[data-directory-favorite-path]')!;
    const row = favorite.querySelector<HTMLButtonElement>('button')!;
    row.click(); expect(navigate).toHaveBeenCalledWith(longPath); navigate.mockClear();
    for (const trigger of ['pointer', 'keyboard', 'touch']) {
      const button = trigger === 'touch' ? favorite.querySelector<HTMLButtonElement>('[data-directory-favorite-menu]')! : row;
      button.focus();
      if (trigger === 'pointer') row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 200 }));
      else if (trigger === 'keyboard') row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
      else await userEvent.click(button);
      await expect.element(page.getByRole('menuitem', { name: 'Remove from favorites' })).toBeVisible();
      await userEvent.keyboard('{Escape}'); await settle();
      expect(document.activeElement).toBe(button);
      button.click();
      if (button === row) {
        navigate.mockClear();
        row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
      }
      await userEvent.click(page.getByRole('menuitem', { name: 'Remove from favorites' }));
      await vi.waitFor(() => expect(menu.mock.calls).toEqual([[longPath]]));
      menu.mockClear();
      expect(navigate).not.toHaveBeenCalled();
    }
  });

  it('scrolls and filters many favorites while keeping the final keyboard target visible', async () => {
    await page.viewport(1100, 650);
    favorites.paths = Array.from({ length: 20 }, (_, index) => '/Volumes/Disk-' + index);
    const { host } = mountFiles(); await settle();
    const section = host.querySelector<HTMLElement>('section[aria-label="Quick access"]')!;
    const viewport = section.querySelector<HTMLElement>('[aria-busy]')!;
    for (const [attribute, value] of Object.entries(REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS)) expect(viewport.getAttribute(attribute)).toBe(value);
    const first = section.querySelector<HTMLButtonElement>('[aria-label="/Volumes/Disk-0"]')!;
    const last = section.querySelector<HTMLButtonElement>('[aria-label="/Volumes/Disk-19"]')!;
    first.focus(); first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })); await settle();
    expect(document.activeElement).toBe(last);
    expect(viewport.scrollTop).toBeGreaterThan(0);
    expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(viewport.getBoundingClientRect().bottom);
    await userEvent.fill(section.querySelector<HTMLInputElement>('input')!, 'Disk-19');
    expect(section.querySelectorAll('[data-directory-favorite-path]')).toHaveLength(1);
  });

  it.each([[560, 1], [280, 1], [400, 0.7]])('keeps root rows and favorites in one viewport with independent wheel scrolling at height %i and scale %s', async (height, scale) => {
    await page.viewport(1100, 650);
    favorites.paths = Array.from({ length: 80 }, (_, index) => '/Volumes/Disk-' + index);
    const { host } = mountFiles(180, scale, height, 40); await settle();
    const shortcutsSelector = '[data-testid="file-shortcuts-scroll-region"]';
    const treeSelector = '[data-testid="file-tree-scroll-region"]';
    const shortcuts = host.querySelector<HTMLElement>(shortcutsSelector)!;
    const tree = host.querySelector<HTMLElement>(treeSelector)!;
    const section = host.querySelector<HTMLElement>('[data-filesystem-locations]')!;
    const bounds = section.getBoundingClientRect();
    expect(bounds.height).toBeLessThanOrEqual(section.parentElement!.getBoundingClientRect().height * 0.45 + 1);
    expect(tree.clientHeight).toBeGreaterThan(shortcuts.clientHeight);
    expect(shortcuts.scrollHeight).toBeGreaterThan(shortcuts.clientHeight);
    expect(tree.scrollHeight).toBeGreaterThan(tree.clientHeight);
    for (const viewport of [shortcuts, tree]) {
      for (const [attribute, value] of Object.entries(REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS)) expect(viewport.getAttribute(attribute)).toBe(value);
    }
    const wheel = commands as unknown as { wheelScrollRegion: (request: { regionSelector: string; deltaY: number; preserveScroll?: boolean }) => Promise<{ before: number; after: number }> };
    const root = shortcuts.querySelector<HTMLElement>('[data-filesystem-root-id="home"]')!;
    const rootTop = root.getBoundingClientRect().top;
    const first = await wheel.wheelScrollRegion({ regionSelector: shortcutsSelector, deltaY: 240, preserveScroll: true });
    expect(first.after).toBeGreaterThan(first.before);
    expect(root.getBoundingClientRect().top).toBeLessThan(rootTop);
    expect(tree.scrollTop).toBe(0);
    const shortcutOffset = shortcuts.scrollTop;
    const second = await wheel.wheelScrollRegion({ regionSelector: treeSelector, deltaY: 200, preserveScroll: true });
    expect(second.after).toBeGreaterThan(second.before);
    expect(shortcuts.scrollTop).toBe(shortcutOffset);
    expect(section.getBoundingClientRect().top).toBe(bounds.top);
    const treeOffset = tree.scrollTop;
    const homeButton = root.querySelector<HTMLButtonElement>('button')!;
    homeButton.focus({ preventScroll: true });
    homeButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    await settle();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('/Volumes/Disk-79');
    expect(document.activeElement!.getBoundingClientRect().bottom).toBeLessThanOrEqual(shortcuts.getBoundingClientRect().bottom + 1);
    expect(tree.scrollTop).toBe(treeOffset);
    await wheel.wheelScrollRegion({ regionSelector: shortcutsSelector, deltaY: 1000, preserveScroll: true });
    expect(tree.scrollTop).toBe(treeOffset);
    expect(section.getBoundingClientRect().top).toBe(bounds.top);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    await page.screenshot({ element: host, path: '../../../node_modules/.cache/directory-favorites/many-' + height + '-' + scale + '.png' });
  });

  it.each([390, 640])('retains the shared list and filter in a %ipx mobile or desktop drawer', async surfaceWidth => {
    await page.viewport(surfaceWidth === 390 ? 390 : 1100, 700);
    favorites.paths = Array.from({ length: 30 }, (_, index) => '/Volumes/Disk-' + index);
    const { host, navigate } = mountFiles(240, 1, 600, 30, surfaceWidth);
    await settle();
    if (surfaceWidth === 640) {
      await userEvent.click(host.querySelector<HTMLButtonElement>('[aria-label="Toggle browser sidebar"]')!);
      await expect.poll(() => host.querySelector('[data-floe-drawer-side="left"]')).not.toBeNull();
    }
    const section = host.querySelector<HTMLElement>('[data-filesystem-locations]')!;
    expect(section.checkVisibility({ visibilityProperty: true })).toBe(true);
    const outer = host.querySelector<HTMLElement>('aside')!.firstElementChild!;
    expect(outer.scrollWidth).toBe(outer.clientWidth);
    const filter = section.querySelector<HTMLInputElement>('input')!;
    await userEvent.fill(filter, 'Computer');
    expect(section.querySelectorAll('[data-file-shortcut-path]')).toHaveLength(1);
    await userEvent.click(section.querySelector<HTMLButtonElement>('[aria-label="Computer"]')!);
    expect(navigate).toHaveBeenCalledWith('/');
    expect(filter.value).toBe('Computer');
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(filter);
    expect(section.checkVisibility({ visibilityProperty: true })).toBe(true);
    expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth);
  });
});

it('owns shortcut wheel and keyboard navigation inside a scaled Workbench surface', async () => {
  await page.viewport(1400, 900);
  favorites.paths = Array.from({ length: 80 }, (_, index) => '/Volumes/Disk-' + index);
  const host = document.createElement('div'); document.body.append(host);
  host.style.cssText = 'width:100vw;height:100vh';
  const definitions: WorkbenchWidgetDefinition[] = [{ type: 'test.files', label: 'Files', defaultTitle: 'Files', icon: () => null,
    body: () => <FileBrowserWorkspace mode="files" onModeChange={() => {}} files={[]} currentPath="/" initialPath="/"
      roots={[{ id: 'computer', kind: 'computer', label: 'Computer', pathAbs: '/', permissions: { read: true, write: true }, system: true }]}
      instanceId="quick-access-workbench" resetKey={0} width={240} open onRootSelect={() => {}} />,
    defaultSize: { width: 1000, height: 600 }, renderMode: 'projected_surface' }];
  const [state, setState] = createSignal<WorkbenchState>({ ...createDefaultWorkbenchState(definitions), mode: 'work',
    viewport: { x: 0, y: 0, scale: 0.7 }, selectedWidgetId: 'files', selectedObject: { kind: 'widget', id: 'files' },
    widgets: [{ id: 'files', type: 'test.files', title: 'Files', x: 80, y: 80, width: 1000, height: 600, z_index: 1, created_at_unix_ms: 1 }] });
  cleanups.push(render(() => <FloeConfigProvider><ThemeProvider><LayoutProvider>
    <RedevenWorkbenchSurface state={state} setState={setState} widgetDefinitions={definitions} />
  </LayoutProvider></ThemeProvider></FloeConfigProvider>, host));
  const selector = '[data-testid="file-shortcuts-scroll-region"]';
  await expect.poll(() => host.querySelector(selector)).not.toBeNull(); await settle();
  const viewport = host.querySelector<HTMLElement>(selector)!;
  const canvas = { ...state().viewport };
  const wheel = commands as unknown as { wheelScrollRegion: (request: { regionSelector: string; deltaY: number }) => Promise<{ before: number; after: number }> };
  const result = await wheel.wheelScrollRegion({ regionSelector: selector, deltaY: 200 });
  expect(result.after).toBeGreaterThan(result.before);
  expect(state().viewport).toEqual(canvas);
  const root = viewport.querySelector<HTMLButtonElement>('[aria-label="Computer"]')!;
  root.focus({ preventScroll: true }); root.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  await settle();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('/Volumes/Disk-79');
  expect(document.activeElement!.getBoundingClientRect().bottom).toBeLessThanOrEqual(viewport.getBoundingClientRect().bottom + 1);
  expect(state().viewport).toEqual(canvas);
});

it.each([240, 180])('fits the shared Git sidebar inside its published %ipx outer shell', async width => {
  await page.viewport(1100, 650);
  const host = document.createElement('div'); document.body.append(host);
  host.style.cssText = 'width:1000px;height:500px';
  cleanups.push(render(() => <FloeConfigProvider><LayoutProvider><NotificationProvider><ProtocolProvider contract={redevenV1Contract}><GitWorkspace mode="git" onModeChange={() => {}}
    subview="changes" onSubviewChange={() => {}} currentPath="/workspace" width={width} open />
  </ProtocolProvider></NotificationProvider></LayoutProvider></FloeConfigProvider>, host));
  await settle();
  const outer = host.querySelector<HTMLElement>('aside')!.firstElementChild!;
  expect(outer.scrollWidth).toBe(outer.clientWidth);
  expect(outer.scrollHeight).toBe(outer.clientHeight);
});

it('shrinks short lists and holds the tree position while filtering, refreshing and resizing', async () => {
  await page.viewport(1100, 650);
  const [state, setState] = createSignal({ paths: ['/short'], loading: false });
  const host = document.createElement('div'); document.body.append(host);
  Object.assign(host.style, { width: '240px', height: '500px', display: 'flex', flexDirection: 'column' });
  cleanups.push(render(() => <FloeConfigProvider><FileBrowserQuickAccess favorites={state()}
    copy={{ ...filesystemPickerEnUS, selectedCount: count => String(count) }} onNavigate={() => {}} onContextMenu={() => {}} />
    <div data-following-tree class="min-h-0 flex-1 overflow-auto">Directory tree</div></FloeConfigProvider>, host));
  await settle();
  const tree = host.querySelector<HTMLElement>('[data-following-tree]')!;
  const section = host.querySelector<HTMLElement>('section')!;
  expect(section.clientHeight).toBeLessThan(50);
  const paths = Array.from({ length: 20 }, (_, index) => '/Volumes/Disk-' + index);
  setState({ paths, loading: false }); await settle();
  const top = tree.getBoundingClientRect().top;
  const first = host.querySelector<HTMLButtonElement>('[aria-label="/Volumes/Disk-0"]')!;
  first.focus(); setState({ paths, loading: true }); await settle();
  expect(document.activeElement).toBe(first);
  expect(tree.getBoundingClientRect().top).toBeCloseTo(top, 1);
  const viewport = host.querySelector<HTMLElement>('[data-testid="file-shortcuts-scroll-region"]')!;
  viewport.scrollTop = 120;
  const filter = host.querySelector<HTMLInputElement>('input')!;
  await userEvent.fill(filter, 'Disk-19'); await settle();
  expect(tree.getBoundingClientRect().top).toBeCloseTo(top, 1);
  expect(host.querySelectorAll('[data-file-shortcut-path]')).toHaveLength(1);
  setState({ paths, loading: false }); await settle();
  expect(document.activeElement).toBe(filter);
  expect(filter.value).toBe('Disk-19');
  expect(tree.getBoundingClientRect().top).toBeCloseTo(top, 1);
  await userEvent.keyboard('{Escape}'); await settle();
  expect(viewport.scrollTop).toBe(120);
  await userEvent.fill(filter, 'no-match'); await settle();
  expect(tree.getBoundingClientRect().top).toBeCloseTo(top, 1);
  host.style.height = '240px'; await settle();
  expect(section.getBoundingClientRect().height).toBeLessThanOrEqual(109);
  expect(tree.clientHeight).toBeGreaterThan(section.clientHeight);
  setState({ paths: ['/short'], loading: false });
  await userEvent.keyboard('{Escape}'); await settle();
  expect(section.clientHeight).toBeLessThan(50);
});

it('keeps root geometry stable while refreshing a successfully empty favorites list', async () => {
  const [loading, setLoading] = createSignal(false);
  const host = document.createElement('div'); document.body.append(host);
  host.style.cssText = 'width:240px;height:500px;display:flex;flex-direction:column';
  cleanups.push(render(() => <FloeConfigProvider><FileBrowserQuickAccess
    roots={[{ id: 'home', kind: 'home', label: 'Home', pathAbs: '/home/test', permissions: { read: true, write: true }, system: true }]}
    favorites={{ paths: [], get loading() { return loading(); } }}
    copy={{ ...filesystemPickerEnUS, selectedCount: count => String(count) }} onNavigate={() => {}} onContextMenu={() => {}} />
    <div data-following-tree class="min-h-0 flex-1">Directory tree</div></FloeConfigProvider>, host));
  await settle();
  const tree = host.querySelector<HTMLElement>('[data-following-tree]')!;
  const top = tree.getBoundingClientRect().top;
  setLoading(true); await settle();
  expect(tree.getBoundingClientRect().top).toBe(top);
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  setLoading(false); await settle();
  expect(tree.getBoundingClientRect().top).toBe(top);
});

it('keeps translated quick access usable in every shipped locale at narrow width', async () => {
  await page.viewport(1100, 650);
  let i18n: EnvAppI18nContext | undefined;
  const Probe = () => { i18n = useI18n(); return null; };
  const host = document.createElement('div'); document.body.append(host);
  Object.assign(host.style, { width: '180px', height: '350px', display: 'flex', flexDirection: 'column' });
  cleanups.push(render(() => <FloeConfigProvider><I18nProvider><Probe /><FileBrowserQuickAccess
    favorites={{ paths: Array.from({ length: 20 }, (_, index) => '/Volumes/Disk-' + index) }}
    copy={{ ...filesystemPickerEnUS, selectedCount: count => String(count) }} onNavigate={() => {}} onContextMenu={() => {}} />
    </I18nProvider></FloeConfigProvider>, host));
  await settle();
  for (const locale of SUPPORTED_LOCALES) {
    await i18n!.setLocalePreference(locale); await settle();
    const section = host.querySelector<HTMLElement>('section')!;
    const filter = section.querySelector<HTMLInputElement>('input')!;
    expect(section.getAttribute('aria-label')).toBe(dictionaries[locale].files.quickAccess);
    expect(filter.getAttribute('aria-label')).toBe(dictionaries[locale].files.filterLocations);
    await userEvent.fill(filter, 'unmatched');
    expect(section.querySelector('[role="status"]')?.textContent).toBe(dictionaries[locale].files.noMatchingLocations);
    expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth);
    await userEvent.keyboard('{Escape}');
  }
  await i18n!.setLocalePreference('en-US');
});
