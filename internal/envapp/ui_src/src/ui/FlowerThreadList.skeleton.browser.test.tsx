import '../index.css';
import './flower-feature.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { FlowerThreadList } from '../../../../flower_ui/src/threads/FlowerThreadList';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerThreadListItem } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const media = commands as unknown as { emulateTouchInput: (touch: boolean) => Promise<void> };
let dispose: (() => void) | undefined;
let host: HTMLDivElement;

afterEach(async () => {
  dispose?.();
  host?.remove();
  document.documentElement.style.removeProperty('font-size');
  await media.emulateTouchInput(false);
});

function threads(): FlowerThreadListItem[] {
  const now = Date.now();
  return Array.from({ length: 6 }, (_, index) => ({
    thread_id: `skeleton-${index}`, title: 'A conversation in the sidebar', title_status: 'ready',
    model_id: 'model', working_dir: '/project', pinned: false,
    created_at_ms: now, updated_at_ms: now,
    preview: '', status: 'idle', source_label: '', target_labels: [],
    read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } },
  }));
}

async function frame() {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

it.each([
  { touch: false, warmup: false }, { touch: true, warmup: false },
  { touch: false, warmup: true }, { touch: true, warmup: true },
])('matches loaded sidebar geometry with touch=$touch and warmup=$warmup', async ({ touch, warmup }) => {
  await page.viewport(1100, 800);
  await media.emulateTouchInput(touch);
  host = document.createElement('div');
  host.className = 'flower-surface flower-component-shell';
  host.style.cssText = 'display:flex;height:640px';
  document.body.append(host);
  const [loading, setLoading] = createSignal(true);
  const items = threads();
  dispose = render(() => <FlowerThreadList
    items={loading() ? [] : items} loading={!warmup && loading()} warmup={warmup && loading()} query="" activeThreadID=""
    onQueryChange={vi.fn()} onRefresh={vi.fn()} onSelect={vi.fn()} onMenuAction={vi.fn()}
  />, host);
  await document.fonts.ready;

  for (const root of [16, 20, 32]) {
    document.documentElement.style.fontSize = `${root}px`;
    for (const width of [180, 240, 320]) {
      host.style.width = `${width}px`;
      setLoading(true);
      await frame();
      const skeleton = host.querySelector<HTMLElement>('.flower-thread-warmup-list')!;
      expect(skeleton.getAttribute('role')).toBe('status');
      expect(skeleton.getAttribute('aria-label')).toBe(DEFAULT_FLOWER_SURFACE_COPY.threadList.warmupDescription);
      expect(skeleton.querySelectorAll('button, input, [tabindex]').length).toBe(0);
      expect(host.querySelector('input')!.disabled).toBe(true);
      const placeholders = [...skeleton.querySelectorAll<HTMLElement>('.flower-thread-warmup-card')];
      expect(placeholders.length).toBe(6);
      const group = skeleton.querySelector<HTMLElement>('.flower-thread-group-label');
      expect(group, 'reserve the same date-group heading before rows').not.toBeNull();
      const groupHeight = group!.getBoundingClientRect().height;
      const bounds = placeholders.map(row => row.getBoundingClientRect());
      const titleLeft = placeholders[0].querySelector('.flower-thread-warmup-line-title')!.getBoundingClientRect().left;
      const time = placeholders[0].querySelector<HTMLElement>('.flower-thread-warmup-time')!;
      const timeBounds = time.getBoundingClientRect();
      expect(getComputedStyle(time).display === 'none').toBe(touch);
      expect(placeholders[0].querySelector('.flower-thread-warmup-line-meta')).toBeNull();
      for (const row of placeholders) {
        expect(getComputedStyle(row).borderTopWidth).toBe('0px');
        expect(getComputedStyle(row).backgroundColor).toBe('rgba(0, 0, 0, 0)');
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
      }
      if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1' && !warmup && root === 16 && width === 240) {
        await page.screenshot({ element: host, path: `__screenshots__/flower-sidebar-skeleton-${touch ? 'touch' : 'desktop'}.png` });
      }
      setLoading(false);
      await frame();
      const rows = [...host.querySelectorAll<HTMLElement>('[data-flower-thread-card]')];
      const heading = host.querySelector<HTMLElement>('.flower-thread-group-label')!;
      expect(rows.length).toBe(bounds.length);
      expect(heading.getBoundingClientRect().height).toBe(groupHeight);
      for (const [index, row] of rows.entries()) {
        const loaded = row.getBoundingClientRect();
        expect(loaded.height, `row height at ${width}px / ${root}px`).toBe(bounds[index].height);
        expect(loaded.top, `row position at ${width}px / ${root}px`).toBe(bounds[index].top);
        expect(loaded.width).toBe(bounds[index].width);
      }
      expect(rows[0].querySelector('.flower-thread-list-title')!.getBoundingClientRect().left).toBe(titleLeft);
      if (!touch) {
        expect(rows[0].querySelector('.flower-thread-card-time')!.getBoundingClientRect().right).toBe(timeBounds.right);
      }
      expect(host.querySelector('.flower-thread-warmup-list')).toBeNull();
      expect(host.querySelector('input')!.disabled).toBe(false);
      if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1' && !warmup && root === 16 && width === 240) {
        await page.screenshot({ element: host, path: `__screenshots__/flower-sidebar-loaded-${touch ? 'touch' : 'desktop'}.png` });
      }
    }
  }
});

it('retains loaded conversations and search during refresh and warmup, then exposes the real empty state', async () => {
  host = document.createElement('div');
  host.className = 'flower-surface flower-component-shell';
  host.style.cssText = 'display:flex;width:240px;height:640px';
  document.body.append(host);
  const [items, setItems] = createSignal(threads());
  const [loading, setLoading] = createSignal(true);
  dispose = render(() => <FlowerThreadList
    items={items()} loading={loading()} warmup={loading()} query="" activeThreadID=""
    onQueryChange={vi.fn()} onRefresh={vi.fn()} onSelect={vi.fn()}
  />, host);
  await frame();
  expect(host.querySelectorAll('[data-flower-thread-card]').length).toBe(6);
  expect(host.querySelector('.flower-thread-warmup-list')).toBeNull();
  expect(host.querySelector('input')!.disabled).toBe(false);
  setLoading(false);
  setItems([]);
  await frame();
  expect(host.querySelector('.flower-thread-warmup-list')).toBeNull();
  expect(host.querySelector('.flower-thread-empty')?.textContent).toBe(DEFAULT_FLOWER_SURFACE_COPY.threadList.empty);
});
