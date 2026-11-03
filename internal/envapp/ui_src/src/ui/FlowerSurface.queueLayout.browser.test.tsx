import '../index.css';
import './flower-feature.css';

import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { commands, page } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
  document.documentElement.classList.remove('light', 'dark');
});

async function mountQueue(count = 1) {
  const selected = thread({
    thread_id: 'compact-queue', status: 'running', active_run_id: 'running',
    queued_turn_count: count,
    queued_turns: Array.from({ length: count }, (_, index) => ({
      queue_id: `queue-${index}`, created_at_ms: index + 1,
      prompt: 'Review the browser interaction, report any problems, and suggest improvements. '.repeat(3),
    })),
  });
  const view = liveBootstrap(selected);
  const current = { ...view.current!, queue: view.current!.queue!.map(item => ({ ...item, input_fingerprint: 'a'.repeat(64) })) };
  const runtime = renderSurfaceWithAdapterProps({
    ...adapter(true), listThreads: async () => [selected],
    loadThread: async () => ({ thread: applyFlowerRuntimeCurrentView(view.thread, current), current }),
    prepareQueuedTurnDraft: vi.fn(), takeBackQueuedTurn: vi.fn(),
    sendQueuedTurnNow: vi.fn(), deleteQueuedTurn: vi.fn(), reorderQueuedTurns: vi.fn(),
  }, { focusThreadRequest: { request_id: 'compact-queue-layout', thread_id: selected.thread_id } });
  runtime.style.cssText = 'width:100%;height:100dvh';
  await waitFor(() => runtime.querySelectorAll('[data-flower-queued-turn-dock-id]').length === count);
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return runtime;
}

const appearances = ['light', 'dark'].flatMap(mode => ['standard', 'soft-neumorphic'].flatMap(material =>
  [1440, 375, 320].map(width => ({ mode, material, width }))));

it.each(appearances)('keeps the queue compact and its actions reachable at $width px in $mode/$material', async ({ mode, material, width }) => {
  await page.viewport(width, 800);
  const preset = builtInShellThemePresets.find(item => item.mode === mode)!;
  const root = document.documentElement;
  root.classList.add(mode);
  root.dataset.floeShellTheme = preset.name;
  root.dataset.floeSurfaceStyle = material;
  for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) if (value) root.style.setProperty(name, value);
  const runtime = await mountQueue();
  const dock = runtime.querySelector<HTMLElement>('.flower-queued-turn-dock')!;
  const row = dock.querySelector<HTMLElement>('[role="listitem"]')!;
  const label = row.querySelector<HTMLElement>('.flower-queued-turn-label')!;
  const actions = row.querySelector<HTMLElement>('.flower-queued-turn-actions')!;
  const buttons = [...actions.querySelectorAll<HTMLButtonElement>('button')];
  const composer = runtime.querySelector<HTMLElement>('.flower-composer')!;
  const before = row.getBoundingClientRect();
  buttons[0].focus();
  await expect.poll(() => getComputedStyle(actions).opacity).toBe('1');
  await page.screenshot({ element: runtime, path: `__screenshots__/compact-queue-${mode}-${material}-${width}.png` });

  expect.soft(dock.getBoundingClientRect().height, 'one queued message uses at most 34px').toBeLessThanOrEqual(34);
  expect.soft(composer.getBoundingClientRect().top - dock.getBoundingClientRect().bottom, 'queue stays close to composer').toBeLessThanOrEqual(5);
  expect.soft(getComputedStyle(dock).boxShadow, 'no raised outer frame').toBe('none');
  expect.soft(parseFloat(getComputedStyle(dock).borderTopWidth), 'no nested outer border').toBe(0);
  expect.soft(label.scrollWidth, 'long message retains its full text behind an ellipsis').toBeGreaterThan(label.clientWidth);
  expect.soft(label.getBoundingClientRect().width, 'message remains readable beside actions').toBeGreaterThan(60);
  expect.soft(label.title).toBe(label.textContent);
  expect.soft(buttons).toHaveLength(3);
  for (const button of buttons) {
    const bounds = button.getBoundingClientRect();
    expect.soft(button.getAttribute('aria-label')).toBeTruthy();
    expect.soft(bounds.width).toBeGreaterThanOrEqual(24);
    expect.soft(bounds.height).toBeGreaterThanOrEqual(24);
    expect.soft(bounds.right).toBeLessThanOrEqual(before.right + 1);
    expect.soft(bounds.top).toBeGreaterThanOrEqual(before.top);
    expect.soft(bounds.bottom).toBeLessThanOrEqual(before.bottom + 1);
  }
  expect.soft(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
  expect.soft(row.getBoundingClientRect().height, 'keyboard focus does not move the row').toBe(before.height);
  expect.soft(getComputedStyle(buttons[0]).outlineStyle, 'keyboard actions retain visible focus').not.toBe('none');
});

it('bounds a long queue in a short window and scrolls the final action into reach', async () => {
  await page.viewport(375, 520);
  const runtime = await mountQueue(12);
  const dock = runtime.querySelector<HTMLElement>('.flower-queued-turn-dock')!;
  const rows = [...dock.querySelectorAll<HTMLElement>('[role="listitem"]')];
  expect(dock.getBoundingClientRect().height).toBeLessThanOrEqual(156);
  expect(dock.scrollHeight).toBeGreaterThan(dock.clientHeight);
  rows.at(-1)!.querySelector<HTMLButtonElement>('[data-flower-queued-turn-delete]')!.focus();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  expect(dock.scrollTop).toBeGreaterThan(0);
  expect(rows.at(-1)!.getBoundingClientRect().bottom).toBeLessThanOrEqual(dock.getBoundingClientRect().bottom + 1);
  const composer = runtime.querySelector<HTMLElement>('.flower-composer')!.getBoundingClientRect();
  expect(composer.bottom).toBeLessThanOrEqual(520);
  expect(composer.height).toBeGreaterThan(60);
});

it('keeps touch actions visible without a hover or focus requirement', async () => {
  const touch = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
  await touch.emulateTouchInput(true);
  try {
    await page.viewport(375, 800);
    const runtime = await mountQueue();
    const row = runtime.querySelector<HTMLElement>('[data-flower-queued-turn-dock-id]')!;
    const actions = row.querySelector<HTMLElement>('.flower-queued-turn-actions')!;
    expect(window.matchMedia('(pointer: coarse)').matches).toBe(true);
    expect(getComputedStyle(actions).opacity).toBe('1');
    expect(row.getBoundingClientRect().height).toBe(32);
    for (const button of actions.querySelectorAll<HTMLButtonElement>('button')) {
      expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(24);
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    }
  } finally {
    await touch.emulateTouchInput(false);
  }
});
