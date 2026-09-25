import '../index.css';
import './flower-feature.css';

import { For } from 'solid-js';
import { render } from 'solid-js/web';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowerThreadCard } from '../../../../flower_ui/src/threads/FlowerThreadList';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { thread } from './FlowerSurface.navigation.testHarness';

const media = commands as unknown as { emulateTouchInput: (touch: boolean) => Promise<void> };
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(async () => {
  dispose?.(); host?.remove();
  document.documentElement.style.removeProperty('font-size');
  await media.emulateTouchInput(false);
});

it.each([false, true])('keeps every sidebar entry on one line with touch=%s', async touch => {
  await page.viewport(1100, 800);
  await media.emulateTouchInput(touch);
  host = document.createElement('div');
  host.className = 'flower-surface flower-component-shell';
  host.style.cssText = 'display:block;width:200px';
  document.body.append(host);
  const copy = DEFAULT_FLOWER_SURFACE_COPY.threadList;
  const localized = { ...copy, statuses: { ...copy.statuses,
    waiting_user: 'En attente de votre réponse à la question',
    waiting_approval: 'Waiting for your approval to continue',
  } };
  const items = ['waiting_user', 'waiting_approval', 'idle', 'running', 'running'].map((status, index) => ({
    ...thread({ thread_id: `compact-${index}`, title: 'A long conversation title with useful context', status: status as 'waiting_user' | 'waiting_approval' | 'idle' | 'running' }),
    pinned: false, preview: '',
    cancellation: index === 4 ? { thread_id: `compact-${index}`, turn_id: 'turn', run_id: 'run', source: 'user', mode: 'graceful' as const, requested_at: new Date().toISOString() } : undefined,
  }));
  const select = vi.fn();
  const menu = vi.fn();
  dispose = render(() => <For each={items}>{item => <FlowerThreadCard
    item={item} active={false} copy={localized} busyLabel={item.thread_id === 'compact-3' ? 'Saving conversation changes' : undefined} onSelect={select} onPin={vi.fn()} onContextMenu={menu}
  />}</For>, host);
  await document.fonts.ready;
  for (const root of [16, 20, 32]) {
    document.documentElement.style.fontSize = `${root}px`;
    for (const width of [180, 200, 240, 320]) {
      host.style.width = `${width}px`;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const rows = [...host.querySelectorAll<HTMLElement>('[data-flower-thread-card]')];
      const ordinaryHeight = rows[2].getBoundingClientRect().height;
      for (const row of rows) {
        expect.soft(row.getBoundingClientRect().height, `${width}px row at ${root}px text`).toBe(ordinaryHeight);
        expect.soft(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
      }
      for (const row of rows.slice(0, 2)) {
        const title = row.querySelector<HTMLElement>('.flower-thread-list-title')!;
        const status = row.querySelector<HTMLElement>('.flower-thread-card-action-indicator')!;
        const label = row.querySelector<HTMLElement>('.flower-thread-card-action-badge')!;
        expect.soft(status.getBoundingClientRect().top).toBeLessThan(title.getBoundingClientRect().bottom);
        expect.soft(status.getBoundingClientRect().bottom).toBeGreaterThan(title.getBoundingClientRect().top);
        expect.soft(status.querySelector('svg')).not.toBeNull();
        if (width <= 200) expect.soft(getComputedStyle(label).display).toBe('none');
        if (root === 16 && width >= 200) expect.soft(title.getBoundingClientRect().width).toBeGreaterThanOrEqual(90);
        expect.soft(row.querySelector('button')?.getAttribute('aria-label')).toContain(status.title);
      }
      expect(rows[3].querySelector('[role="status"]')?.textContent).toBe('Saving conversation changes');
      expect(rows[4].querySelector('[role="status"]')?.textContent).toBe(copy.stopping);
      if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1' && root === 16 && [200, 240].includes(width)) {
        await page.screenshot({ element: host, path: `__screenshots__/flower-compact-${width}-${touch ? 'touch' : 'desktop'}.png` });
      }
    }
  }
  document.documentElement.style.fontSize = '16px'; host.style.width = '200px';
  const first = host.querySelector<HTMLElement>('[data-flower-thread-card]')!;
  const title = first.querySelector<HTMLElement>('.flower-thread-list-title')!;
  const widthBefore = title.getBoundingClientRect().width;
  await userEvent.hover(first);
  expect(title.getBoundingClientRect().width).toBe(widthBefore);
  await userEvent.click(first.querySelector('.flower-thread-card-menu-button')!);
  expect(menu).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
});
