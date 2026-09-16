import '../index.css';
import './flower-feature.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { FlowerThreadList } from '../../../../flower_ui/src/threads/FlowerThreadList';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerThreadListItem, FlowerThreadPinPosition } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const disposers: (() => void)[] = [];
const copy = DEFAULT_FLOWER_SURFACE_COPY.threadList;
const media = commands as unknown as { emulateMediaPreferences: (value: { reducedMotion?: 'reduce' | 'no-preference'; forcedColors?: 'active' | 'none' }) => Promise<void> };
afterEach(async () => {
  while (disposers.length) disposers.pop()?.();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.classList.remove('light', 'dark');
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' });
});
async function frame(count = 2) { for (let i = 0; i < count; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); }
function item(id: string, rank: number): FlowerThreadListItem {
  return { thread_id: id, title: id, title_status: 'ready', model_id: 'model', working_dir: '/project', pinned: rank > 0, pinned_at_ms: rank, pin_rank: rank,
    created_at_ms: 1, updated_at_ms: 1, preview: '', status: 'running', source_label: '', target_labels: [],
    read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } } };
}
function mount(seed = [item('first', 3), item('second', 2), item('third', 1)]) {
  const host = document.createElement('div');
  host.className = 'flower-component-shell flower-surface';
  host.style.cssText = 'display:block;width:272px;height:440px';
  document.body.append(host);
  const [items, setItems] = createSignal<readonly FlowerThreadListItem[]>(seed);
  const [query, setQuery] = createSignal('');
  const onMove = vi.fn((_id: string, _position: FlowerThreadPinPosition) => undefined);
  const onSelect = vi.fn();
  disposers.push(render(() => <FlowerThreadList items={items()} query={query()} activeThreadID="first" copy={copy}
    onQueryChange={setQuery} onSelect={onSelect} onRefresh={() => undefined} onMovePinned={onMove} canPin onMenuAction={() => undefined} />, host));
  return { host, items, setItems, setQuery, onMove, onSelect,
    row: (id: string) => host.querySelector<HTMLElement>(`[data-thread-id="${id}"]`)!,
    order: () => Array.from(host.querySelectorAll<HTMLElement>('[data-thread-id]')).map((row) => row.dataset.threadId) };
}

describe('Flower pinned conversation interaction', () => {
  it('moves a pin with keyboard menu activation without selecting it', async () => {
    const ui = mount();
    await frame();
    const trigger = ui.row('first').querySelector<HTMLButtonElement>('.flower-thread-card-select-button')!;
    trigger.focus();
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    await frame();
    const down = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((button) => button.textContent === copy.movePinnedDown)!;
    down.focus();
    await userEvent.keyboard('{Enter}');
    expect(ui.onMove).toHaveBeenCalledExactlyOnceWith('first', { anchor_thread_id: 'second', placement: 'after' });
    expect(document.activeElement).toBe(trigger);
    expect(ui.onSelect).not.toHaveBeenCalled();
  });
  it('retains focus when a background reorder disables the focused move action', async () => {
    const ui = mount();
    await frame();
    ui.row('first').querySelector<HTMLButtonElement>('.flower-thread-card-menu-button')!.click();
    await frame();
    const menu = document.querySelector('[role="menu"]');
    const down = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((button) => button.textContent === copy.movePinnedDown)!;
    down.focus();
    ui.setItems(ui.items().map((entry) => ({ ...entry, pin_rank: entry.thread_id === 'first' ? 1 : 5 })));
    await frame();
    expect(document.querySelector('[role="menu"]')).toBe(menu);
    expect(document.activeElement).toBe(down);
    down.click();
    expect(ui.onMove).not.toHaveBeenCalled();
    ui.setItems(ui.items().map((entry) => entry.thread_id === 'first' ? { ...entry, pinned: false, pin_rank: 0 } : entry));
    await frame();
    expect(document.querySelector('[role="menu"]')).toBe(menu);
    expect(menu?.contains(document.activeElement)).toBe(true);
  });
  it('reorders with a real pointer drag from the reserved handle', async () => {
    const ui = mount();
    await frame();
    await userEvent.hover(ui.row('first'));
    await userEvent.dragAndDrop(ui.row('first').querySelector('.flower-thread-drag-handle')!, ui.row('third'));
    expect(ui.onMove).toHaveBeenCalledTimes(1);
    expect(ui.onMove.mock.calls[0][0]).toBe('first');
    expect(ui.onMove.mock.calls[0][1].anchor_thread_id).toBe('third');
    expect(ui.onSelect).not.toHaveBeenCalled();
  });

  it('scrolls at the list edge and cancels a gesture with Escape', async () => {
    const ui = mount(Array.from({ length: 40 }, (_, i) => item(i === 0 ? 'first' : String(i), 40 - i)));
    const list = ui.host.querySelector<HTMLElement>('.flower-thread-list')!;
    list.style.height = '440px';
    await frame();
    const scroll = ui.host.querySelector<HTMLElement>('.flower-scroll')!;
    const dataTransfer = new DataTransfer();
    ui.row('first').querySelector('.flower-thread-drag-handle')!.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    scroll.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientY: scroll.getBoundingClientRect().bottom - 1 }));
    await frame(8);
    expect(scroll.scrollTop).toBeGreaterThan(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const stoppedAt = scroll.scrollTop;
    await frame(3);
    expect(scroll.scrollTop).toBe(stoppedAt);
    scroll.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    expect(ui.onMove).not.toHaveBeenCalled();
  });

  it('retains menu, focused action, row and wave through 300 updates, group changes and background reorders', async () => {
    const ui = mount();
    await frame();
    const row = ui.row('first');
    const wave = row.querySelector<HTMLElement>('.flower-thread-wave-bar')!;
    const animation = wave.getAnimations()[0];
    (row.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement).click();
    await frame();
    const menu = document.querySelector('[role="menu"]')!;
    const pinAction = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((button) => button.textContent === copy.unpin)!;
    pinAction.focus();
    const focused = document.activeElement;
    const retainedActions = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    const initialTime = Number(animation.currentTime);
    for (let i = 0; i < 300; i++) {
      ui.setItems(ui.items().map((entry) => ({ ...entry, title: entry.thread_id + ' updated ' + i, updated_at_ms: i + 2,
        pin_rank: entry.thread_id === 'first' ? (i % 2 ? 4 : 1) : entry.pin_rank })));
      await Promise.resolve();
    }
    await frame();
    expect(ui.row('first')).toBe(row);
    expect(document.querySelector('[role="menu"]')).toBe(menu);
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]'))).toEqual(retainedActions);
    expect(document.activeElement).toBe(focused);
    expect(wave.getAnimations()[0]).toBe(animation);
    expect(Number(animation.currentTime)).toBeGreaterThan(initialTime);
    ui.setItems(ui.items().map((entry) => entry.thread_id === 'first' ? { ...entry, pinned: false, pinned_at_ms: 0, pin_rank: 0 } : entry));
    await frame();
    expect(ui.row('first')).toBe(row);
    expect(wave.getAnimations()[0]).toBe(animation);
    expect(document.querySelector('[role="menu"]')).toBe(menu);
    ui.setItems(ui.items().map((entry) => entry.thread_id === 'first' ? { ...entry, status: 'success' } : entry));
    await frame();
    expect(row.querySelector('.flower-thread-wave-bar')).toBeNull();
    expect(document.querySelector('[role="menu"]')).toBe(menu);
  });

  it('preserves wave phase and focus when state-preserving DOM moves are unavailable', async () => {
    const ui = mount();
    await frame(4);
    const parent = ui.row('first').parentElement!;
    Object.defineProperty(parent, 'moveBefore', { value: undefined, configurable: true });
    const wave = ui.row('second').querySelector<HTMLElement>('.flower-thread-wave-bar')!;
    const select = ui.row('second').querySelector<HTMLButtonElement>('.flower-thread-card-select-button')!;
    select.focus();
    const before = Number(wave.getAnimations()[0].currentTime);
    ui.setItems(ui.items().map((entry) => entry.thread_id === 'second' ? { ...entry, pin_rank: 5 } : entry));
    await frame();
    expect(document.activeElement).toBe(select);
    expect(Number(wave.getAnimations()[0].currentTime)).toBeGreaterThanOrEqual(before);
  });

  it('freezes drag order across live updates, commits one relative move, and never selects a conversation', async () => {
    const ui = mount();
    await frame();
    const first = ui.row('first');
    const dataTransfer = new DataTransfer();
    first.querySelector('.flower-thread-drag-handle')!.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    ui.setItems(ui.items().map((entry) => ({ ...entry, title: 'Updated ' + entry.title, pin_rank: 4 - (entry.pin_rank ?? 0) })));
    await frame();
    expect(ui.order()).toEqual(['first', 'second', 'third']);
    const third = ui.row('third');
    third.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientY: third.getBoundingClientRect().bottom - 1 }));
    expect(third.dataset.flowerThreadDrop).toBe('after');
    third.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    first.querySelector('.flower-thread-drag-handle')!.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
    expect(ui.onMove).toHaveBeenCalledExactlyOnceWith('first', { anchor_thread_id: 'third', placement: 'after' });
    expect(ui.onSelect).not.toHaveBeenCalled();
    expect(ui.row('first')).toBe(first);
  });

  it('cancels invalidated drag targets and keeps the search rule and menu boundaries explicit', async () => {
    const ui = mount();
    await frame();
    const dataTransfer = new DataTransfer();
    ui.row('first').querySelector('.flower-thread-drag-handle')!.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    const third = ui.row('third');
    third.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientY: third.getBoundingClientRect().bottom - 1 }));
    ui.setItems(ui.items().map((entry) => entry.thread_id === 'third' ? { ...entry, pinned: false, pin_rank: 0 } : entry));
    await frame();
    third.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    expect(ui.onMove).not.toHaveBeenCalled();
    (ui.row('first').querySelector('.flower-thread-card-menu-button') as HTMLButtonElement).click();
    await frame();
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(buttons.find((button) => button.textContent?.includes(copy.movePinnedUp))?.getAttribute('aria-disabled')).toBe('true');
    buttons.find((button) => button.textContent?.includes(copy.movePinnedDown))!.click();
    expect(ui.onMove).toHaveBeenCalledWith('first', { anchor_thread_id: 'second', placement: 'after' });
    ui.setQuery('first');
    await frame();
    expect(ui.host.querySelector<HTMLButtonElement>('.flower-thread-drag-handle')?.disabled).toBe(true);
    const clear = ui.host.querySelector<HTMLButtonElement>('.flower-thread-clear-sort-search')!;
    expect(clear.textContent).toBe(copy.clearSearchToReorder);
    clear.click();
    await frame();
    expect(ui.order()).toHaveLength(3);
  });
});

function luminance(color: string): number {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0,0,1,1);
  const channels = Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3).map((n) => {
    const x = n/255; return x<=0.04045 ? x/12.92 : ((x+0.055)/1.055)**2.4;
  });
  return channels[0]*0.2126 + channels[1]*0.7152 + channels[2]*0.0722;
}
function contrast(a: string, b: string) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); }

describe('Flower sidebar selection themes', () => {
  it('preserves a visible selection and keyboard focus in forced colors at narrow width', async () => {
    await media.emulateMediaPreferences({ forcedColors: 'active', reducedMotion: 'reduce' });
    const ui = mount();
    ui.host.style.width = '224px';
    await frame();
    const row = ui.row('first');
    const button = row.querySelector<HTMLButtonElement>('.flower-thread-card-select-button')!;
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(getComputedStyle(row, '::before').width).toBe('3px');
    expect(contrast(getComputedStyle(row, '::before').backgroundColor, getComputedStyle(row).backgroundColor)).toBeGreaterThanOrEqual(3);
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
  });
  it.each(builtInShellThemePresets)('keeps selection legible in $name', async (preset) => {
    await page.viewport(800,600);
    document.documentElement.dataset.floeShellTheme=preset.name;
    // Published semantic tokens contain the complete palette for each preset.
    for (const [token,value] of Object.entries(preset.semanticTokens ?? {})) if(value)document.documentElement.style.setProperty(token,value);
    const background = getComputedStyle(document.documentElement).getPropertyValue('--background');
    document.documentElement.classList.add(luminance(background)<0.2?'dark':'light');
    const ui=mount();await frame();
    const row=ui.row('first'),style=getComputedStyle(row);
    const title=getComputedStyle(row.querySelector('.flower-thread-list-title')!);
    const marker=getComputedStyle(row,'::before');
    expect(contrast(title.color,style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(marker.backgroundColor,style.backgroundColor)).toBeGreaterThanOrEqual(3);
    expect(marker.width).toBe('3px');
    expect(style.backgroundColor).not.toBe(getComputedStyle(ui.row('second')).backgroundColor);
    expect(row.querySelector('button[aria-current="true"]')).not.toBeNull();
    if (import.meta.env.VITE_FLOWER_SIDEBAR_SCREENSHOTS === '1') {
      ui.setItems(ui.items().map((entry) => entry.thread_id === 'third' ? { ...entry, title: 'Approval required', status: 'waiting_approval' } : entry));
      await userEvent.hover(ui.row('second'));
      await frame();
      await page.screenshot({ element: ui.host, path: `__screenshots__/sidebar-preview-${preset.name}.png` });
    }
    await media.emulateMediaPreferences({reducedMotion:'reduce'});
    await frame();
    expect(getComputedStyle(row.querySelector('.flower-thread-wave-bar')!).animationName).toBe('none');
  });
});
