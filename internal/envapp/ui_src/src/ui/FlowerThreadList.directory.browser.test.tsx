import '../index.css';
import './flower-feature.css';
import { createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeProvider, builtInShellThemePresets, useTheme } from '@floegence/floe-webapp-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { FlowerThreadList } from '../../../../flower_ui/src/threads/FlowerThreadList';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import type { EnvAppTranslationKey } from './i18n';
import type { FlowerThreadListCopy } from '../../../../flower_ui/src/copy';
import type { FlowerThreadListItem } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const copy = DEFAULT_FLOWER_SURFACE_COPY.threadList;
const disposers: (() => void)[] = [];
const media = commands as unknown as { dragFlowerDirectoryWithMouse: () => Promise<{ preview: number; indicator: string | null; order: string[]; expanded: string; previewAfter: number }>; dragFlowerDirectoryWithTouch: () => Promise<{ indicator: string | null; order: string[] }>; scrollFlowerDirectoryWithTouch: () => Promise<number>; emulateMediaPreferences: (value: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
let scopeID = 0;
afterEach(async () => { while (disposers.length) disposers.pop()?.(); document.body.replaceChildren(); document.documentElement.removeAttribute('style'); document.documentElement.removeAttribute('data-floe-shell-theme'); document.documentElement.classList.remove('light', 'dark'); await media.emulateMediaPreferences({ reducedMotion: 'no-preference' }); });
async function frame() { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }
function item(id: string, path: string, index: number, pinned = false): FlowerThreadListItem {
  return { thread_id: id, title: id, title_status: 'ready', model_id: 'model', working_dir: path, pinned, pin_rank: pinned ? 10 : 0,
    created_at_ms: 1000 - index, updated_at_ms: 1000 - index, preview: '', status: 'idle', source_label: '', target_labels: [],
    read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } };
}
function mount(scope = `directory-test-${++scopeID}`, storage?: Pick<Storage, 'getItem' | 'setItem'>, theme?: string, localizedCopy: FlowerThreadListCopy = copy) {
  const host = document.createElement('div');
  host.className = 'flower-component-shell flower-surface';
  host.style.cssText = 'display:flex;flex-direction:column;width:272px;height:650px';
  document.body.append(host);
  const seed = [...Array.from({ length: 15 }, (_, i) => item(`alpha-${i}`, '/one/project', i, i === 14)),
    item('beta', '/two/project', 20), item('unassigned', '', 21)];
  const [items, setItems] = createSignal<readonly FlowerThreadListItem[]>(seed);
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal('');
  const [activeScope, setScope] = createSignal(scope);
  const onSelect = vi.fn(), onNew = vi.fn(), onMenu = vi.fn(), onMove = vi.fn();
  function Theme() { const context = useTheme(); onMount(() => context.selectShellTheme(theme!.includes('dark') ? 'dark' : 'light', theme!)); return null; }
  const list = () => <FlowerThreadList items={items()} activeThreadID={active()} preferenceScope={activeScope()} query={query()} copy={localizedCopy}
    preferenceStorage={storage}
    onQueryChange={setQuery} onSelect={onSelect} onRefresh={() => undefined} onNewInDirectory={onNew} canPin canRename
    onMenuAction={onMenu} onMovePinned={onMove} />;
  disposers.push(render(() => theme ? <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets, defaultSurfaceStyle: 'soft-neumorphic' } }}><Theme />{list()}</FloeProvider> : list(), host));
  const header = (path: string) => Array.from(host.querySelectorAll<HTMLElement>('[data-flower-directory-header]')).find(node => node.dataset.flowerDirectoryHeader === path)!;
  const order = () => Array.from(host.querySelectorAll<HTMLElement>('[data-flower-directory-header]')).map(node => node.dataset.flowerDirectoryHeader);
  return { host, items, setItems, setActive, setQuery, setScope, onSelect, onNew, onMenu, onMove, header, order, scope };
}

describe('Flower directory navigation', () => {
  it('batches conversations and resets only the collapsed directory', async () => {
    const ui = mount();
    await userEvent.click(page.getByRole("radio", { name: copy.viewByDirectory }).element() as HTMLButtonElement);
    expect(ui.order()).toEqual(['/one/project', '/two/project', '']);
    expect(ui.header('/one/project').querySelector('.flower-directory-name')?.textContent).toBe('/one/project');
    expect(ui.header('/two/project').querySelector('.flower-directory-name')?.textContent).toBe('/two/project');
    expect(ui.host.querySelectorAll('[data-flower-thread-card]')).toHaveLength(8);
    expect(ui.host.querySelector('[data-thread-id="alpha-14"] [data-flower-pin-head]')).not.toBeNull();
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>('.flower-directory-more')!);
    expect(ui.host.querySelectorAll('[data-flower-thread-card]')).toHaveLength(14);
    await userEvent.click(ui.header('/one/project').querySelector('button')!);
    await expect.poll(() => ui.host.querySelectorAll('[data-flower-thread-card]').length).toBe(2);
    await userEvent.click(ui.header('/one/project').querySelector('button')!);
    expect(ui.host.querySelectorAll('[data-flower-thread-card]')).toHaveLength(8);
    await userEvent.click(ui.header('/two/project').querySelector<HTMLButtonElement>('.flower-directory-new')!);
    expect(ui.onNew).toHaveBeenCalledExactlyOnceWith('/two/project');
    ui.setQuery('/two');
    expect(ui.order()).toEqual(['/two/project']);
    ui.setQuery('');
  });

  it('shows the insertion boundary before release, commits there, cancels, and supports the keyboard', async () => {
    const ui = mount();
    await userEvent.click(page.getByRole("radio", { name: copy.viewByDirectory }).element() as HTMLButtonElement);
    const start = ui.header('/two/project').querySelector<HTMLButtonElement>('.flower-directory-toggle')!;
    const rect = start.getBoundingClientRect();
    const target = ui.header('/one/project').getBoundingClientRect();
    start.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 1, button: 0, clientX: rect.x + 10, clientY: rect.y + 10 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, isPrimary: true, pointerId: 1, clientX: target.x + 10, clientY: target.y + 2 }));
    expect(ui.header('/one/project').dataset.dropBefore).toBe('true');
    expect(parseFloat(getComputedStyle(ui.header('/one/project'), '::before').top)).toBeGreaterThanOrEqual(0);
    expect(ui.order()).toEqual(['/one/project', '/two/project', '']);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, pointerId: 1, clientX: target.x + 10, clientY: target.y + 2 }));
    expect(ui.order()).toEqual(['/two/project', '/one/project', '']);
    const moved = ui.header('/two/project').querySelector<HTMLButtonElement>('.flower-directory-toggle')!;
    moved.focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(ui.order()).toEqual(['/one/project', '/two/project', '']);
    expect(document.activeElement).toBe(moved);
    const after = ui.header('/one/project').getBoundingClientRect();
    moved.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 2, button: 0, clientX: after.x + 10, clientY: after.y + 10 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, isPrimary: true, pointerId: 2, clientX: after.x + 10, clientY: after.y + 2 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ui.order()).toEqual(['/one/project', '/two/project', '']);
    expect(ui.host.querySelector('[data-drop-before="true"]')).toBeNull();
  });

  it('persists preferences per environment and presents actionable conversations in the workspace panel', async () => {
    const ui = mount();
    await userEvent.click(page.getByRole("radio", { name: copy.viewByDirectory }).element() as HTMLButtonElement);
    const header = ui.header('/two/project').querySelector<HTMLButtonElement>('.flower-directory-toggle')!;
    header.focus(); await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    ui.setScope(`${ui.scope}-other`);
    expect(page.getByRole('radio', { name: copy.viewByTime }).element().getAttribute('aria-checked')).toBe('true');
    ui.setScope(ui.scope);
    expect(ui.order()[0]).toBe('/two/project');
    const trigger = ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.workspaces}"]`)!;
    ui.setQuery('/two');
    await userEvent.click(trigger);
    await frame();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    const workspace = Array.from(dialog.querySelectorAll<HTMLElement>('[data-flower-workspace]')).find(node => node.dataset.flowerWorkspace === '/one/project')!;
    expect(workspace.querySelectorAll('.flower-workspace-thread')).toHaveLength(6);
    await userEvent.click(workspace.querySelector<HTMLButtonElement>('.flower-directory-more')!);
    expect(workspace.querySelectorAll('.flower-workspace-thread')).toHaveLength(12);
    await userEvent.click(workspace.querySelector<HTMLButtonElement>('.flower-workspace-thread-pin')!);
    expect(ui.onMenu).toHaveBeenCalledWith('pin', expect.objectContaining({ thread_id: 'alpha-14' }));
    await userEvent.click(workspace.querySelector<HTMLButtonElement>('.flower-workspace-thread-select')!);
    expect(ui.onSelect).toHaveBeenCalledWith('alpha-14');
  });

  it('restores view and order from host storage after the renderer is recreated', async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const ui = mount('desktop-restart', storage);
    await userEvent.click(page.getByRole("radio", { name: copy.viewByDirectory }).element() as HTMLButtonElement);
    const toggle = ui.header('/two/project').querySelector<HTMLButtonElement>('.flower-directory-toggle')!;
    toggle.focus(); await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(values.size).toBe(1);
    disposers.pop()?.(); ui.host.remove();
    const restored = mount('desktop-restart', storage);
    expect(restored.host.querySelector<HTMLButtonElement>(`[role="radio"]:last-child`)?.getAttribute('aria-checked')).toBe('true');
    expect(restored.order()[0]).toBe('/two/project');
  });

  it('migrates an existing browser preference once to durable host storage', () => {
    const key = 'redeven.flower.directoryList.migrate-old';
    localStorage.setItem(key, JSON.stringify({ mode: 'directory', order: ['/two/project'] }));
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const ui = mount('migrate-old', storage);
    expect(ui.order()[0]).toBe('/two/project');
    expect(JSON.parse(values.get(key)!)).toEqual({ mode: 'directory', order: ['/two/project'] });
    localStorage.removeItem(key);
  });

  it('retains the old preference for the current session when migration cannot write it', () => {
    const key = 'redeven.flower.directoryList.migration-write-failure';
    localStorage.setItem(key, JSON.stringify({ mode: 'directory', order: ['/two/project'] }));
    const storage = { getItem: () => null, setItem: () => { throw new Error('storage unavailable'); } };
    const ui = mount('migration-write-failure', storage);
    expect(ui.order()[0]).toBe('/two/project');
    localStorage.removeItem(key);
  });

  it('animates explicit disclosure reversals and respects reduced motion', async () => {
    const ui = mount();
    await userEvent.click(page.getByRole('radio', { name: copy.viewByDirectory }));
    const toggle = ui.header('/one/project').querySelector<HTMLButtonElement>('.flower-directory-toggle')!;
    toggle.click();
    const second = ui.header('/two/project');
    expect(second.getAnimations().some(animation => animation.id === 'flower-thread-layout')).toBe(true);
    const retainedRow = ui.host.querySelector<HTMLElement>('[data-thread-id="alpha-0"]')!;
    expect(retainedRow.inert).toBe(true);
    expect(retainedRow.getAttribute('aria-hidden')).toBe('true');
    const closing = second.getAnimations().find(animation => animation.id === 'flower-thread-layout')!;
    closing.pause(); closing.currentTime = 80;
    const beforeReverse = second.getBoundingClientRect().top;
    toggle.click();
    expect(second.getAnimations().some(animation => animation.id === 'flower-thread-layout')).toBe(true);
    expect(Math.abs(second.getBoundingClientRect().top - beforeReverse)).toBeLessThan(1);
    expect(ui.host.querySelector('[data-thread-id="alpha-0"]')).toBe(retainedRow);
    expect(retainedRow.inert).toBe(false);
    expect(retainedRow.hasAttribute('aria-hidden')).toBe(false);
    await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
    for (const animation of second.getAnimations()) animation.finish();
    toggle.click();
    expect(second.getAnimations().some(animation => animation.id === 'flower-thread-layout' && animation.playState === 'running')).toBe(false);
    expect(retainedRow.isConnected).toBe(false);
  });

  it.each(['porcelain-light', 'porcelain-dark'])('uses legible workspace geometry in %s', async theme => {
    await page.viewport(1280, 900);
    const ui = mount(undefined, undefined, theme);
    ui.setItems([...ui.items(), item('A long conversation title about a detailed workspace review', '/a/very/long/path/to/the/workspace', 33)]);
    await userEvent.click(page.getByRole('radio', { name: copy.viewByDirectory }));
    const active = page.getByRole('radio', { name: copy.viewByDirectory }).element();
    const inactive = page.getByRole('radio', { name: copy.viewByTime }).element();
    expect(getComputedStyle(active).backgroundColor).not.toBe(getComputedStyle(inactive).backgroundColor);
    const row = ui.host.querySelector<HTMLElement>('[data-thread-id="alpha-0"] .flower-thread-list-title')!;
    const more = ui.host.querySelector<HTMLElement>('.flower-thread-rows > .flower-directory-more')!;
    expect(Math.abs((more.getBoundingClientRect().left + parseFloat(getComputedStyle(more).paddingLeft)) - row.getBoundingClientRect().left)).toBeLessThanOrEqual(1);
    await page.screenshot({ element: ui.host, path: `__screenshots__/flower-sidebar-${theme}.png` });
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.workspaces}"]`)!);
    await expect.poll(() => document.querySelector<HTMLElement>('[role="dialog"]')?.getBoundingClientRect().width).toBeGreaterThan(800);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(getComputedStyle(dialog.querySelector('.flower-workspaces-grid')!).gridTemplateColumns.split(' ')).toHaveLength(2);
    expect(dialog.querySelector<HTMLElement>('.flower-workspace-thread-title')!.getBoundingClientRect().width).toBeGreaterThan(180);
    await page.screenshot({ element: dialog, path: `__screenshots__/flower-workspaces-${theme}.png` });
    await userEvent.fill(dialog.querySelector<HTMLInputElement>('.flower-workspaces-search input')!, 'alpha-10');
    expect(dialog.querySelectorAll('[data-flower-workspace]')).toHaveLength(1);
    expect(dialog.querySelector('.flower-workspace-thread-title')?.textContent).toBe('alpha-10');
  });

  it('packs uneven workspace cards without gaps or overlap before and after loading more', async () => {
    await page.viewport(1280, 900);
    const ui = mount();
    ui.setItems([...ui.items(), item('delta', '/four/project', 25)]);
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.workspaces}"]`)!);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const cards = () => Array.from(dialog.querySelectorAll<HTMLElement>('[data-flower-workspace]'));
    const assertPacked = () => {
      const rects = cards().map(card => card.getBoundingClientRect());
      let stacked = 0;
      for (const rect of rects) {
        const above = rects.filter(other => other !== rect && Math.abs(other.left - rect.left) < 1 && other.bottom <= rect.top + 1)
          .sort((a, b) => b.bottom - a.bottom)[0];
        if (above) { expect(rect.top - above.bottom).toBeLessThanOrEqual(13); stacked++; }
        for (const other of rects) if (other !== rect) {
          const overlapX = Math.min(rect.right, other.right) - Math.max(rect.left, other.left);
          const overlapY = Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top);
          expect(overlapX <= 1 || overlapY <= 1).toBe(true);
        }
      }
      expect(stacked).toBeGreaterThan(0);
    };
    assertPacked();
    const alpha = cards().find(card => card.dataset.flowerWorkspace === '/one/project')!;
    for (const animation of dialog.getAnimations({ subtree: true })) if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
    const columns = cards().map(card => [card, card.getBoundingClientRect().left] as const);
    await userEvent.click(alpha.querySelector<HTMLButtonElement>('.flower-directory-more')!);
    for (const animation of dialog.getAnimations({ subtree: true })) if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
    expect(alpha.querySelectorAll('.flower-workspace-thread')).toHaveLength(12);
    for (const [card, left] of columns) expect(card.getBoundingClientRect().left).toBe(left);
    assertPacked();
  });

  it('reveals and scrolls to a conversation selected from the panel after filtering and collapsing its directory', async () => {
    const ui = mount(); ui.host.style.height = '260px';
    await userEvent.click(page.getByRole("radio", { name: copy.viewByDirectory }).element() as HTMLButtonElement);
    await userEvent.click(ui.header('/one/project').querySelector<HTMLButtonElement>('.flower-directory-toggle')!);
    ui.setQuery('/two');
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.workspaces}"]`)!);
    await frame();
    const workspace = Array.from(document.querySelectorAll<HTMLElement>('[data-flower-workspace]')).find(node => node.dataset.flowerWorkspace === '/one/project')!;
    await userEvent.click(workspace.querySelector<HTMLButtonElement>('.flower-directory-more')!);
    const target = Array.from(workspace.querySelectorAll<HTMLButtonElement>('.flower-workspace-thread-select')).find(node => node.textContent?.includes('alpha-10'))!;
    await userEvent.click(target);
    await frame(); await frame();
    expect(ui.onSelect).toHaveBeenCalledWith('alpha-10');
    expect(ui.header('/one/project').querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
    const row = ui.host.querySelector<HTMLElement>('[data-thread-id="alpha-10"]')!;
    const scroll = ui.host.querySelector<HTMLElement>('.flower-thread-list .flower-scroll')!;
    expect(row).not.toBeNull();
    expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(scroll.getBoundingClientRect().top - 1);
    expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(scroll.getBoundingClientRect().bottom + 1);
  });

  it('keeps one visible pin and moves pins only among their directory neighbours', async () => {
    const ui = mount();
    ui.setItems([...ui.items(), { ...item('other-pin', '/two/project', 22, true), pin_rank: 9 }, { ...item('second-pin', '/one/project', 23, true), pin_rank: 8 }]);
    await userEvent.click(page.getByRole("radio", { name: copy.viewByDirectory }).element() as HTMLButtonElement);
    const row = ui.host.querySelector<HTMLElement>('[data-thread-id="alpha-14"]')!;
    await userEvent.hover(row);
    expect(getComputedStyle(row.querySelector<HTMLElement>('.flower-thread-card-summary')!).opacity).toBe('0');
    await userEvent.click(row.querySelector<HTMLButtonElement>('.flower-thread-card-menu-button')!);
    await frame();
    await userEvent.click(page.getByRole('menuitem', { name: copy.movePinnedDown, exact: true }));
    expect(ui.onMove).toHaveBeenCalledExactlyOnceWith('alpha-14', { anchor_thread_id: 'second-pin', placement: 'after' });
  });

  it('keeps a newly pinned or unpinned row rendered and focused beyond the initial batch', async () => {
    const ui = mount(); ui.host.style.height = '300px';
    ui.setItems(ui.items().map(entry => entry.working_dir === '/one/project' && entry.thread_id !== 'alpha-14'
      ? { ...entry, pinned: Number(entry.thread_id.slice(6)) < 7, pin_rank: 20 - Number(entry.thread_id.slice(6)) } : entry));
    ui.onMenu.mockImplementation((_action, changed: FlowerThreadListItem) => ui.setItems(ui.items().map(entry => entry.thread_id === changed.thread_id
      ? { ...entry, pinned: !entry.pinned, pin_rank: entry.pinned ? 0 : 1 } : entry)));
    await userEvent.click(page.getByRole('radio', { name: copy.viewByDirectory }));
    const pinned = ui.host.querySelector<HTMLElement>('[data-thread-id="alpha-0"]')!;
    const unpin = pinned.querySelector<HTMLButtonElement>('.flower-thread-card-pin-button')!;
    unpin.focus(); unpin.click();
    await frame();
    expect(ui.host.querySelector('[data-thread-id="alpha-0"]')).toBe(pinned);
    expect(document.activeElement).toBe(unpin);
    expect(pinned.getBoundingClientRect().bottom).toBeLessThanOrEqual(ui.host.querySelector('.flower-scroll')!.getBoundingClientRect().bottom + 1);
    const ordinary = ui.host.querySelector<HTMLElement>('[data-thread-id="alpha-8"]')!;
    const pin = ordinary.querySelector<HTMLButtonElement>('.flower-thread-card-pin-button')!;
    pin.focus(); pin.click();
    await frame();
    expect(ui.host.querySelector('[data-thread-id="alpha-8"]')).toBe(ordinary);
    expect(document.activeElement).toBe(pin);
    expect(ordinary.getBoundingClientRect().bottom).toBeLessThanOrEqual(ui.host.querySelector('.flower-scroll')!.getBoundingClientRect().bottom + 1);
  });

  it('keeps a panel conversation and its focused pin control when unpinning moves it past the visible batch', async () => {
    const ui = mount();
    ui.setItems(ui.items().map(entry => entry.working_dir === '/one/project'
      ? { ...entry, pinned: Number(entry.thread_id.slice(6)) < 7, pin_rank: 20 - Number(entry.thread_id.slice(6)) } : entry));
    ui.onMenu.mockImplementation((_action, changed: FlowerThreadListItem) => ui.setItems(ui.items().map(entry => entry.thread_id === changed.thread_id
      ? { ...entry, pinned: !entry.pinned, pin_rank: entry.pinned ? 0 : 1 } : entry)));
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.workspaces}"]`)!);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const workspace = Array.from(dialog.querySelectorAll<HTMLElement>('[data-flower-workspace]')).find(node => node.dataset.flowerWorkspace === '/one/project')!;
    const pin = workspace.querySelector<HTMLButtonElement>(`[aria-label="${copy.unpin}: alpha-0"]`)!;
    const row = pin.parentElement!;
    pin.focus(); pin.click();
    await frame();
    expect(workspace.isConnected).toBe(true);
    expect(row.isConnected).toBe(true);
    expect(document.activeElement).toBe(pin);
    expect(pin.getAttribute('aria-pressed')).toBe('false');
  });

  it('reveals a pin appended past the first batch after other conversations become pinned', async () => {
    const ui = mount();
    await userEvent.click(page.getByRole('radio', { name: copy.viewByDirectory }));
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>('[data-thread-id="alpha-0"] .flower-thread-card-menu-button')!);
    ui.setItems(ui.items().map(entry => {
      const number = Number(entry.thread_id.slice(6));
      return entry.working_dir === '/one/project' && number >= 1 && number <= 5 ? { ...entry, pinned: true, pin_rank: 6 - number } : entry;
    }));
    ui.onMenu.mockImplementation((_action, changed: FlowerThreadListItem) => ui.setItems(ui.items().map(entry => entry.thread_id === changed.thread_id
      ? { ...entry, pinned: true, pin_rank: 1 } : entry.pinned ? { ...entry, pin_rank: (entry.pin_rank ?? 0) + 1 } : entry)));
    await userEvent.click(page.getByRole('menuitem', { name: copy.pin, exact: true }));
    await frame();
    const row = ui.host.querySelector<HTMLElement>('[data-thread-id="alpha-0"]');
    expect(row).not.toBeNull();
    expect(row?.dataset.pinned).toBe('true');
    expect(row!.getBoundingClientRect().bottom).toBeLessThanOrEqual(ui.host.querySelector('.flower-scroll')!.getBoundingClientRect().bottom + 1);
  });

  it('places the after marker beyond the whole expanded group and commits the same position', async () => {
    const ui = mount();
    await userEvent.click(page.getByRole("radio", { name: copy.viewByDirectory }).element() as HTMLButtonElement);
    const earlier = ui.header('/two/project').querySelector<HTMLButtonElement>('.flower-directory-toggle')!;
    earlier.focus(); await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    for (const animation of ui.host.getAnimations({ subtree: true })) animation.finish();
    const start = ui.header('/two/project').querySelector<HTMLButtonElement>('.flower-directory-toggle')!;
    const from = start.getBoundingClientRect();
    const end = Array.from(ui.host.querySelectorAll<HTMLElement>('[data-flower-directory-end]')).find(node => node.dataset.flowerDirectoryEnd === '/one/project')!;
    const to = end.getBoundingClientRect();
    start.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 3, button: 0, clientX: from.x + 10, clientY: from.y + 10 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, isPrimary: true, pointerId: 3, clientX: to.x + 10, clientY: to.bottom - 1 }));
    await frame();
    expect(end.dataset.dropAfter).toBe('true');
    expect(end.getBoundingClientRect().top).toBeGreaterThan(ui.host.querySelector('[data-thread-id="alpha-0"]')!.getBoundingClientRect().bottom);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, pointerId: 3, clientX: to.x + 10, clientY: to.bottom - 1 }));
    expect(ui.order()).toEqual(['/one/project', '/two/project', '']);
  });

  it('keeps search fixed while workspace results scroll and shows running pinned work', async () => {
    await page.viewport(1280, 700);
    const ui = mount(undefined, undefined, 'porcelain-dark');
    ui.setItems([...ui.items(), ...Array.from({ length: 16 }, (_, i) => item(`extra-${i}`, `/work/group-${i}`, i + 50)),
      { ...item('running-pin', '/one/project', 99, true), status: 'running' }]);
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.workspaces}"]`)!);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    for (const animation of dialog.getAnimations({ subtree: true })) if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
    const search = dialog.querySelector<HTMLInputElement>('.flower-workspaces-search input')!;
    const top = search.getBoundingClientRect().top;
    const viewport = dialog.querySelector<HTMLElement>('.flower-workspaces-scroll')!;
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    viewport.scrollTop = 250;
    expect(search.getBoundingClientRect().top).toBe(top);
    expect(dialog.getBoundingClientRect().bottom).toBeLessThanOrEqual(700);
    expect(dialog.querySelector('[data-flower-workspace-thread-id="running-pin"] .flower-thread-wave')).not.toBeNull();
    const wave = dialog.querySelector<HTMLElement>('[data-flower-workspace-thread-id="running-pin"] .flower-thread-wave')!;
    expect(getComputedStyle(wave).display).toBe('flex');
    const cards = [...dialog.querySelectorAll('[data-flower-workspace]')];
    search.focus();
    ui.setItems(ui.items().map(entry => ({ ...entry, updated_at_ms: entry.updated_at_ms + 1 })));
    expect([...dialog.querySelectorAll('[data-flower-workspace]')]).toEqual(cards);
    expect(document.activeElement).toBe(search);
    expect(viewport.scrollTop).toBe(250);
  });

  it('switches views without replacing running rows and suppresses motion when requested', async () => {
    const ui = mount();
    ui.setItems(ui.items().map(entry => entry.thread_id === 'alpha-0' ? { ...entry, status: 'running' } : entry));
    const row = ui.host.querySelector<HTMLElement>('[data-thread-id="alpha-0"]')!;
    const wave = row.querySelector('.flower-thread-wave-bar');
    await userEvent.click(page.getByRole('radio', { name: copy.viewByDirectory }));
    expect(ui.host.querySelector('[data-thread-id="alpha-0"]')).toBe(row);
    expect(row.querySelector('.flower-thread-wave-bar')).toBe(wave);
    expect(ui.host.querySelector('.flower-thread-rows')!.getAnimations().some(animation => animation.id === 'flower-thread-view')).toBe(true);
    await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
    for (const animation of ui.host.getAnimations({ subtree: true })) if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
    await userEvent.click(page.getByRole('radio', { name: copy.viewByTime }));
    expect(ui.host.querySelector('.flower-thread-rows')!.getAnimations().some(animation => animation.playState === 'running')).toBe(false);
  });

  it.each(['porcelain-light', 'porcelain-dark'])('qualifies realistic localized navigation in %s', async theme => {
    await page.viewport(1440, 960);
    const i18n = createTestI18nHelpers('zh-CN');
    const localized = createLocalizedFlowerSurfaceCopy({ locale: 'zh-CN', t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) }).threadList;
    const ui = mount(undefined, undefined, theme, localized);
    ui.host.style.width = '300px'; ui.host.style.height = '820px';
    const titles = ['打磨工作区导航与对话列表', '梳理桌面端设置与快捷操作', '核对运行中会话的状态更新', '优化文件预览与编辑体验', '检查触屏拖动和键盘排序', '完善浅色与深色主题', '验证长列表中的选中定位', '整理设计验收记录'];
    ui.setItems(['redeven', 'floe-webapp', 'floret', 'design'].flatMap((dir, group) => titles.slice(0, group === 3 ? 3 : 8).map((title, i) => ({
      ...item(`${dir}-${i}`, `/workspace/floegence/${dir}`, group * 10 + i, i === 0), title,
      created_at_ms: Date.now() - ((group * 10 + i) * 3600000),
      status: i === 1 && group === 0 ? 'running' : 'idle',
    }))));
    ui.setActive('redeven-0');
    await userEvent.click(page.getByRole('radio', { name: localized.viewByDirectory }));
    for (const animation of ui.host.getAnimations({ subtree: true })) if (animation.id) animation.finish();
    await page.screenshot({ element: ui.host, path: `__screenshots__/flower-navigation-zh-${theme}.png` });
    const handle = ui.header('/workspace/floegence/floe-webapp').querySelector<HTMLButtonElement>('.flower-directory-drag-handle')!;
    const from = handle.getBoundingClientRect(), target = ui.header('/workspace/floegence/redeven').getBoundingClientRect();
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 9, button: 0, clientX: from.x + 6, clientY: from.y + 10 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, isPrimary: true, pointerId: 9, clientX: from.x + 6, clientY: target.top + 12 }));
    await frame();
    await page.screenshot({ element: ui.host, path: `__screenshots__/flower-directory-drag-zh-${theme}.png` });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>(`[aria-label="${localized.workspaces}"]`)!);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    for (const animation of dialog.getAnimations({ subtree: true })) if (animation.id || animation.effect?.getTiming().iterations !== Infinity) animation.finish();
    await page.screenshot({ element: dialog, path: `__screenshots__/flower-overview-zh-${theme}.png` });
    await page.viewport(390, 844);
    for (const animation of dialog.getAnimations({ subtree: true })) if (animation.id || animation.effect?.getTiming().iterations !== Infinity) animation.finish();
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    await page.screenshot({ element: dialog, path: `__screenshots__/flower-overview-mobile-zh-${theme}.png` });
  });

  it('restores focus after closing the workspace panel and opens a directory draft from it', async () => {
    const ui = mount();
    const trigger = ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.workspaces}"]`)!;
    await userEvent.click(trigger);
    await frame();
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.activeElement).toBe(trigger);
    await userEvent.click(trigger);
    await frame();
    const workspace = Array.from(document.querySelectorAll<HTMLElement>('[data-flower-workspace]')).find(node => node.dataset.flowerWorkspace === '/two/project')!;
    await userEvent.click(workspace.querySelector<HTMLButtonElement>('.flower-directory-new')!);
    expect(ui.onNew).toHaveBeenCalledExactlyOnceWith('/two/project');
  });

  it('retains the open row menu and its target during a live summary refresh', async () => {
    const ui = mount();
    await userEvent.click(page.getByRole("radio", { name: copy.viewByDirectory }).element() as HTMLButtonElement);
    const row = ui.host.querySelector<HTMLElement>('[data-thread-id="alpha-0"]')!;
    await userEvent.click(row.querySelector<HTMLButtonElement>('.flower-thread-card-menu-button')!);
    await frame();
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const focused = document.activeElement;
    ui.setItems(ui.items().map(entry => entry.thread_id === 'alpha-0' ? { ...entry, title: 'Updated title', status: 'running' as const } : entry));
    expect(ui.host.querySelector('[data-thread-id="alpha-0"]')).toBe(row);
    expect(document.querySelector('[role="menu"]')).toBe(menu);
    expect(document.activeElement).toBe(focused);
    expect(menu.getAttribute('aria-label')).toContain('Updated title');
  });

  it('reorders using the native mouse without collapsing the source directory', async () => {
    const ui = mount();
    await userEvent.click(page.getByRole('radio', { name: copy.viewByDirectory }));
    const result = await media.dragFlowerDirectoryWithMouse();
    expect(result).toEqual({ preview: 1, indicator: 'true', order: ['/two/project', '/one/project', ''], expanded: 'true', previewAfter: 0 });
    expect(ui.order()).toEqual(result.order);
  });

  it('supports long-press reordering on touch without expanding a directory', async () => {
    const ui = mount();
    await userEvent.click(page.getByRole("radio", { name: copy.viewByDirectory }).element() as HTMLButtonElement);
    const start = ui.header('/two/project').querySelector<HTMLButtonElement>('.flower-directory-toggle')!;
    const result = await media.dragFlowerDirectoryWithTouch();
    expect(result.indicator).toBe('true');
    expect(result.order).toEqual(['/two/project', '/one/project', '']);
    expect(start.getAttribute('aria-expanded')).toBe('true');
  });

  it('makes a directory drag visible, follows the pointer and removes feedback on cancel', async () => {
    const ui = mount();
    await userEvent.click(page.getByRole('radio', { name: copy.viewByDirectory }));
    const handle = ui.header('/two/project').querySelector<HTMLButtonElement>('.flower-directory-drag-handle');
    expect(handle).not.toBeNull();
    const from = handle!.getBoundingClientRect();
    handle!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 7, button: 0, clientX: from.x + 8, clientY: from.y + 8 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, isPrimary: true, pointerId: 7, clientX: from.x + 20, clientY: from.y - 20 }));
    await frame();
    const preview = document.querySelector<HTMLElement>('[data-flower-directory-drag-preview]')!;
    expect(preview).not.toBeNull();
    expect(preview.getAttribute('aria-hidden')).toBe('true');
    const initial = preview.getBoundingClientRect();
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, isPrimary: true, pointerId: 7, clientX: from.x + 28, clientY: from.y - 70 }));
    await frame();
    expect(preview.getBoundingClientRect().top).toBeLessThan(initial.top - 40);
    expect(getComputedStyle(preview).pointerEvents).toBe('none');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('[data-flower-directory-drag-preview]')).toBeNull();
    expect(ui.host.querySelector('[data-drop-before="true"], [data-drop-after="true"]')).toBeNull();
    expect(ui.order()).toEqual(['/one/project', '/two/project', '']);
  });

  it('autoscrolls a held drag and cancels when released outside the rail', async () => {
    const ui = mount(); ui.host.style.height = '320px';
    ui.setItems(Array.from({ length: 18 }, (_, i) => item(`group-${i}`, `/work/group-${i}`, i)));
    await userEvent.click(page.getByRole('radio', { name: copy.viewByDirectory }));
    const viewport = ui.host.querySelector<HTMLElement>('.flower-scroll')!;
    const handle = ui.host.querySelector<HTMLButtonElement>('.flower-directory-drag-handle')!;
    const from = handle.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
    const initialOrder = ui.order();
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 8, button: 0, clientX: from.x + 8, clientY: from.y + 8 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, isPrimary: true, pointerId: 8, clientX: from.x + 8, clientY: bounds.bottom - 3 }));
    await expect.poll(() => viewport.scrollTop).toBeGreaterThan(30);
    const first = viewport.scrollTop;
    await expect.poll(() => viewport.scrollTop).toBeGreaterThan(first + 20);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, pointerId: 8, clientX: bounds.right + 100, clientY: bounds.bottom - 3 }));
    expect(ui.order()).toEqual(initialOrder);
    expect(document.querySelector('[data-flower-directory-drag-preview]')).toBeNull();
    const stopped = viewport.scrollTop;
    await frame(); await frame();
    expect(viewport.scrollTop).toBe(stopped);
    expect(document.documentElement.style.cursor).not.toBe('grabbing');
  });

  it('allows a touch swipe on a directory header to scroll the list', async () => {
    const ui = mount(); ui.host.style.height = '230px';
    await userEvent.click(page.getByRole("radio", { name: copy.viewByDirectory }).element() as HTMLButtonElement);
    expect(await media.scrollFlowerDirectoryWithTouch()).toBeGreaterThan(0);
    expect(ui.order()).toEqual(['/one/project', '/two/project', '']);
  });

  it.each([220, 272])('keeps header controls inside a %ipx rail', async width => {
    const ui = mount(); ui.host.style.width = `${width}px`;
    await frame();
    const header = ui.host.querySelector<HTMLElement>('.flower-thread-list-toolbar')!;
    const controls = Array.from(header.querySelectorAll<HTMLElement>('button'));
    for (const control of controls) {
      const bounds = control.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(header.getBoundingClientRect().left - 1);
      expect(bounds.right).toBeLessThanOrEqual(header.getBoundingClientRect().right + 1);
    }
  });

  it('keeps the header usable for every shipped language at minimum width', async () => {
    const ui = mount(); ui.host.style.width = '220px';
    const translations = [['Time', 'Directory'], ['时间', '目录'], ['時間', '目錄'], ['時間', 'フォルダー'], ['시간', '폴더'],
      ['Zeit', 'Ordner'], ['Date', 'Dossier'], ['Fecha', 'Carpeta'], ['Data', 'Pasta'], ['Время', 'Папка']];
    const buttons = ui.host.querySelectorAll<HTMLElement>('.flower-thread-view-switch button span');
    const header = ui.host.querySelector<HTMLElement>('.flower-thread-list-toolbar')!;
    for (const [time, directory] of translations) {
      buttons[0].textContent = time; buttons[1].textContent = directory;
      await frame();
      const bounds = header.getBoundingClientRect();
      for (const button of Array.from(header.querySelectorAll<HTMLElement>('button'))) {
        expect(button.getBoundingClientRect().right, `${time} / ${directory}`).toBeLessThanOrEqual(bounds.right + 1);
      }
    }
  });

  it('fits the workspace panel on a phone', async () => {
    await page.viewport(390, 844);
    const ui = mount();
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.workspaces}"]`)!);
    await frame();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(390);
    expect(getComputedStyle(dialog.querySelector('.flower-workspaces-grid')!).gridTemplateColumns.split(' ')).toHaveLength(1);
    await page.viewport(1280, 900);
  });
});
