import '../index.css';
import './flower-feature.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { FlowerThreadList } from '../../../../flower_ui/src/threads/FlowerThreadList';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerThreadListItem } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const copy = DEFAULT_FLOWER_SURFACE_COPY.threadList;
const disposers: (() => void)[] = [];
const media = commands as unknown as { dragFlowerDirectoryWithTouch: () => Promise<{ indicator: string | null; order: string[] }>; scrollFlowerDirectoryWithTouch: () => Promise<number> };
let scopeID = 0;
afterEach(() => { while (disposers.length) disposers.pop()?.(); document.body.replaceChildren(); });
async function frame() { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }
function item(id: string, path: string, index: number, pinned = false): FlowerThreadListItem {
  return { thread_id: id, title: id, title_status: 'ready', model_id: 'model', working_dir: path, pinned, pin_rank: pinned ? 10 : 0,
    created_at_ms: 1000 - index, updated_at_ms: 1000 - index, preview: '', status: 'idle', source_label: '', target_labels: [],
    read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } };
}
function mount(scope = `directory-test-${++scopeID}`) {
  const host = document.createElement('div');
  host.className = 'flower-component-shell flower-surface';
  host.style.cssText = 'display:flex;flex-direction:column;width:272px;height:650px';
  document.body.append(host);
  const seed = [...Array.from({ length: 15 }, (_, i) => item(`alpha-${i}`, '/one/project', i, i === 14)),
    item('beta', '/two/project', 20), item('unassigned', '', 21)];
  const [items, setItems] = createSignal<readonly FlowerThreadListItem[]>(seed);
  const [query, setQuery] = createSignal('');
  const [activeScope, setScope] = createSignal(scope);
  const onSelect = vi.fn(), onNew = vi.fn(), onMenu = vi.fn();
  disposers.push(render(() => <FlowerThreadList items={items()} preferenceScope={activeScope()} query={query()} copy={copy}
    onQueryChange={setQuery} onSelect={onSelect} onRefresh={() => undefined} onNewInDirectory={onNew} canPin canRename
    onMenuAction={onMenu} onMovePinned={() => undefined} />, host));
  const header = (path: string) => Array.from(host.querySelectorAll<HTMLElement>('[data-flower-directory-header]')).find(node => node.dataset.flowerDirectoryHeader === path)!;
  const order = () => Array.from(host.querySelectorAll<HTMLElement>('[data-flower-directory-header]')).map(node => node.dataset.flowerDirectoryHeader);
  return { host, items, setItems, setQuery, setScope, onSelect, onNew, onMenu, header, order, scope };
}

describe('Flower directory navigation', () => {
  it('batches conversations and resets only the collapsed directory', async () => {
    const ui = mount();
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.viewByDirectory}"]`)!);
    expect(ui.order()).toEqual(['/one/project', '/two/project', '']);
    expect(ui.header('/one/project').querySelector('.flower-directory-name')?.textContent).toBe('/one/project');
    expect(ui.header('/two/project').querySelector('.flower-directory-name')?.textContent).toBe('/two/project');
    expect(ui.host.querySelectorAll('[data-flower-thread-card]')).toHaveLength(8);
    expect(ui.host.querySelector('[data-thread-id="alpha-14"] [data-flower-pin-head]')).not.toBeNull();
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>('.flower-directory-more')!);
    expect(ui.host.querySelectorAll('[data-flower-thread-card]')).toHaveLength(14);
    await userEvent.click(ui.header('/one/project').querySelector('button')!);
    expect(ui.host.querySelectorAll('[data-flower-thread-card]')).toHaveLength(2);
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
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.viewByDirectory}"]`)!);
    const start = ui.header('/two/project').querySelector<HTMLButtonElement>('.flower-directory-toggle')!;
    const rect = start.getBoundingClientRect();
    const target = ui.header('/one/project').getBoundingClientRect();
    start.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 1, button: 0, clientX: rect.x + 10, clientY: rect.y + 10 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, isPrimary: true, pointerId: 1, clientX: target.x + 10, clientY: target.y + 2 }));
    expect(ui.header('/one/project').dataset.dropBefore).toBe('true');
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
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.viewByDirectory}"]`)!);
    const header = ui.header('/two/project').querySelector<HTMLButtonElement>('.flower-directory-toggle')!;
    header.focus(); await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    ui.setScope(`${ui.scope}-other`);
    expect(ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.viewByTime}"]`)?.getAttribute('aria-pressed')).toBe('true');
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

  it('places the after marker beyond the whole expanded group and commits the same position', async () => {
    const ui = mount();
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.viewByDirectory}"]`)!);
    const earlier = ui.header('/two/project').querySelector<HTMLButtonElement>('.flower-directory-toggle')!;
    earlier.focus(); await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    const start = ui.header('/two/project').querySelector<HTMLButtonElement>('.flower-directory-toggle')!;
    const from = start.getBoundingClientRect();
    const end = Array.from(ui.host.querySelectorAll<HTMLElement>('[data-flower-directory-end]')).find(node => node.dataset.flowerDirectoryEnd === '/one/project')!;
    const to = end.getBoundingClientRect();
    start.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 3, button: 0, clientX: from.x + 10, clientY: from.y + 10 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, isPrimary: true, pointerId: 3, clientX: to.x + 10, clientY: to.bottom - 1 }));
    expect(end.dataset.dropAfter).toBe('true');
    expect(end.getBoundingClientRect().top).toBeGreaterThan(ui.host.querySelector('[data-thread-id="alpha-0"]')!.getBoundingClientRect().bottom);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, pointerId: 3, clientX: to.x + 10, clientY: to.bottom - 1 }));
    expect(ui.order()).toEqual(['/one/project', '/two/project', '']);
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
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.viewByDirectory}"]`)!);
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

  it('supports long-press reordering on touch without expanding a directory', async () => {
    const ui = mount();
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.viewByDirectory}"]`)!);
    const start = ui.header('/two/project').querySelector<HTMLButtonElement>('.flower-directory-toggle')!;
    const result = await media.dragFlowerDirectoryWithTouch();
    expect(result.indicator).toBe('true');
    expect(result.order).toEqual(['/two/project', '/one/project', '']);
    expect(start.getAttribute('aria-expanded')).toBe('true');
  });

  it('allows a touch swipe on a directory header to scroll the list', async () => {
    const ui = mount(); ui.host.style.height = '230px';
    await userEvent.click(ui.host.querySelector<HTMLButtonElement>(`[aria-label="${copy.viewByDirectory}"]`)!);
    expect(await media.scrollFlowerDirectoryWithTouch()).toBeGreaterThan(0);
    expect(ui.order()).toEqual(['/one/project', '/two/project', '']);
  });

  it.each([220, 272])('keeps header controls inside a %ipx rail', async width => {
    const ui = mount(); ui.host.style.width = `${width}px`;
    await frame();
    const header = ui.host.querySelector<HTMLElement>('.flower-thread-list-header')!;
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
    const header = ui.host.querySelector<HTMLElement>('.flower-thread-list-header')!;
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
