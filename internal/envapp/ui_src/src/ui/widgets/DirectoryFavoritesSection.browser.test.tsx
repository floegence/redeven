import '../../index.css';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { DirectoryFavoritesSection } from './DirectoryFavoritesSection';
import { filesystemPickerEnUS } from '../../../../../flower_ui/src/i18n/filesystemPickerMessages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FileBrowserWorkspace } from './FileBrowserWorkspace';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';

const favorites = vi.hoisted(() => ({ paths: [] as string[], loading: false, error: undefined as string | undefined, onRefresh: vi.fn() }));
vi.mock('../services/directoryFavorites', async () => {
  const { filesystemPickerEnUS } = await import('../../../../../flower_ui/src/i18n/filesystemPickerMessages');
  return { useEnvDirectoryFavorites: () => ({ directoryFavorites: favorites, copy: { ...filesystemPickerEnUS, selectedCount: (count: number) => 'Selected: ' + count } }) };
});
const cleanups: (() => void)[] = [];
const longPath = '/Volumes/' + 'very-long-parent-directory/'.repeat(4) + 'JianDisk';
const home = '/Users/test';

beforeEach(() => { favorites.paths = [longPath]; favorites.loading = false; favorites.error = undefined; favorites.onRefresh.mockClear(); });
afterEach(() => { cleanups.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); document.documentElement.classList.remove('dark'); });
async function settle() { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
function mountFiles(width = 240, scale = 1) {
  const host = document.createElement('div'); document.body.append(host);
  const navigate = vi.fn(); const menu = vi.fn();
  cleanups.push(render(() => <FloeConfigProvider><LayoutProvider>
    <div style={{ width: '1000px', height: '560px', transform: 'scale(' + scale + ')', 'transform-origin': 'top left' }}>
      <FileBrowserWorkspace mode="files" onModeChange={() => {}} files={[]} currentPath={longPath} initialPath={longPath}
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
  it.each([['light', 240, 1], ['dark', 180, 1], ['light', 180, 0.7]] as const)('shares compact root rows in %s at %ipx and scale %s', async (theme, width, scale) => {
    await page.viewport(1100, 650);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { host } = mountFiles(width, scale); await settle();
    const locations = host.querySelector<HTMLElement>('[data-filesystem-locations]')!;
    const root = locations.querySelector<HTMLElement>('[data-filesystem-root-id="computer"]')!;
    const favorite = locations.querySelector<HTMLElement>('[data-directory-favorite-path]')!;
    expect(favorite).not.toBeNull();
    expect(favorite.closest('[data-testid="file-tree-scroll-region"]')).not.toBeNull();
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
    const section = host.querySelector<HTMLElement>('section[aria-label="Favorites"]')!;
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
});


it('keeps the following tree anchored through initial load, refresh and filtering', async () => {
  await page.viewport(1100, 650);
  const [state, setState] = createSignal({ paths: [] as string[], loading: true });
  const host = document.createElement('div'); document.body.append(host); host.style.width = '240px';
  cleanups.push(render(() => <FloeConfigProvider><DirectoryFavoritesSection favorites={state()} copy={{ ...filesystemPickerEnUS, selectedCount: count => String(count) }} onNavigate={() => {}} onContextMenu={() => {}} /><div data-following-tree>Directory tree</div></FloeConfigProvider>, host));
  await settle();
  const tree = host.querySelector<HTMLElement>('[data-following-tree]')!;
  const top = tree.getBoundingClientRect().top;
  const paths = Array.from({ length: 20 }, (_, index) => '/Volumes/Disk-' + index);
  setState({ paths, loading: false }); await settle();
  expect(tree.getBoundingClientRect().top).toBeCloseTo(top, 1);
  const first = host.querySelector<HTMLButtonElement>('[aria-label="/Volumes/Disk-0"]')!;
  first.focus(); setState({ paths, loading: true }); await settle();
  expect(document.activeElement).toBe(first);
  expect(tree.getBoundingClientRect().top).toBeCloseTo(top, 1);
  await userEvent.fill(host.querySelector<HTMLInputElement>('input')!, 'Disk-19');
  expect(tree.getBoundingClientRect().top).toBeCloseTo(top, 1);
  setState({ paths: [], loading: false }); await settle();
  expect(tree.getBoundingClientRect().top).toBeCloseTo(top, 1);
});
