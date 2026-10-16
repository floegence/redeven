import '../index.css';
import './flower-feature.css';

import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, onTestFinished, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { SubagentAvatarStack } from '../../../../flower_ui/src/SubagentAvatarStack';
import type { FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';

afterEach(() => document.documentElement.classList.remove('dark', 'light'));

for (const theme of ['light', 'dark'] as const) {
  it(`caps running portraits at three, updates overflow live and retains gray settled portraits in ${theme} mode`, async () => {
    await page.viewport(1100, 850);
    document.documentElement.classList.add(theme);
    const children = Array.from({ length: 6 }, (_, index) => subagentSummary({
      parent_thread_id: 'header-parent', thread_id: 'header-child-' + index,
      task_name: 'Research task ' + index, status: 'running', created_at_ms: 100 + index, updated_at_ms: 200,
    }));
    const parent = thread({ thread_id: 'header-parent', subagents: children });
    let emit: ((event: FlowerLiveStreamEnvelope | null) => void) | undefined;
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true), listThreads: vi.fn(async () => [parent]), loadThread: vi.fn(async () => liveBootstrap(parent)),
      async *connectLiveStream({ signal }) {
        yield { schema_version: 1, kind: 'ready', summaries: [parent] };
        while (!signal.aborted) {
          const event = await new Promise<FlowerLiveStreamEnvelope | null>(resolve => {
            emit = resolve;
            signal.addEventListener('abort', () => resolve(null), { once: true });
          });
          emit = undefined;
          if (!event) return;
          yield event;
        }
      },
    }, { focusThreadRequest: { request_id: 'focus-header', thread_id: parent.thread_id } });
    runtime.style.height = '800px';
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-stack]')));
    const trigger = runtime.querySelector<HTMLButtonElement>('button[aria-controls="flower-subagents-dropdown"]')!;
    const stack = trigger.querySelector<HTMLElement>('[data-flower-subagent-stack]')!;
    expect(stack.querySelectorAll('[data-flower-subagent-avatar]')).toHaveLength(3);
    expect(stack.querySelector('[data-flower-subagent-overflow]')?.textContent).toBe('+3');
    expect(trigger.dataset.flowerSubagentCount).toBe('6');
    expect(trigger.getAttribute('aria-label')).toContain('Running');
    expect(getComputedStyle(trigger).cursor).toBe('pointer');
    expect([...stack.querySelectorAll<HTMLElement>('[data-flower-subagent-avatar]')].every(avatar => getComputedStyle(avatar).borderRadius === '50%')).toBe(true);
    await page.screenshot({ element: runtime.querySelector('.flower-chat-header')!, path: '__screenshots__/subagent-header/running-' + theme + '.png' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => document.querySelectorAll('[data-flower-subagent-row]').length === 6);
    expect(document.querySelector('[data-floe-surface-floating-layer]')).not.toBeNull();
    expect(stack.getAnimations({ subtree: true })).toHaveLength(0);
    const push = async (completed: number) => {
      await waitFor(() => emit !== undefined);
      emit!({ schema_version: 1, kind: 'thread.batch', thread_id: parent.thread_id,
        subagents: children.map((child, index) => ({ ...child, status: index < completed ? 'completed' : 'running' })),
      });
      await waitFor(() => stack.dataset.flowerSubagentStack === (completed === 6 ? 'settled' : 'running')
        && stack.querySelector('[data-flower-subagent-overflow]')?.textContent === (completed === 6 ? '+3' : completed < 3 ? '+' + (3 - completed) : undefined));
    };
    await push(1);
    expect(stack.querySelector('[data-flower-subagent-overflow]')?.textContent).toBe('+2');
    await push(2);
    expect(stack.querySelector('[data-flower-subagent-overflow]')?.textContent).toBe('+1');
    await push(3);
    expect(stack.querySelector('[data-flower-subagent-overflow]')).toBeNull();
    await push(4);
    expect(stack.querySelectorAll('[data-flower-subagent-avatar]')).toHaveLength(2);
    await push(5);
    expect(stack.querySelectorAll('[data-flower-subagent-avatar]')).toHaveLength(1);
    expect(stack.dataset.animating).toBe('false');
    await push(6);
    await waitFor(() => getComputedStyle(stack.querySelector('[data-flower-subagent-avatar]')!).filter === 'grayscale(1)');
    expect(stack.querySelectorAll('[data-flower-subagent-avatar]')).toHaveLength(3);
    expect(stack.getAnimations({ subtree: true })).toHaveLength(0);
    expect(trigger.getAttribute('aria-label')).toContain('Completed');
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
    await page.viewport(320, 750);
    const bounds = trigger.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(320);
    trigger.click();
    await waitFor(() => Boolean(document.querySelector('.flower-subagents-dropdown')));
    const dropdown = document.querySelector<HTMLElement>('.flower-subagents-dropdown')!;
    await waitFor(() => dropdown.getBoundingClientRect().right <= 320);
    expect(dropdown.scrollWidth).toBeLessThanOrEqual(dropdown.clientWidth + 1);
    await page.screenshot({ element: runtime.querySelector('.flower-chat-header')!, path: '__screenshots__/subagent-header/settled-' + theme + '.png' });
  });
}

it.each([
  { status: 'waiting_input', label: 'Waiting', state: 'active' },
  { status: 'queued', label: 'Queued', state: 'active' },
  { status: 'unknown', label: 'Unknown', state: 'active' },
  { status: 'failed', label: 'Failed', state: 'settled' },
  { status: 'cancelled', label: 'Canceled', state: 'settled' },
] as const)('keeps $status distinct from completed work', async ({ status, label, state }) => {
  const child = subagentSummary({ parent_thread_id: 'status-parent', thread_id: 'status-child', status });
  const parent = thread({ thread_id: child.parent_thread_id, subagents: [child] });
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [parent]),
    loadThread: vi.fn(async () => liveBootstrap(parent)),
  }, { focusThreadRequest: { request_id: 'focus-status', thread_id: parent.thread_id } });
  await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-stack]')));
  const stack = runtime.querySelector<HTMLElement>('[data-flower-subagent-stack]')!;
  expect(stack.dataset.flowerSubagentStack).toBe(state);
  expect(stack.dataset.animating).toBe('false');
  expect(stack.querySelectorAll('[data-flower-subagent-avatar]')).toHaveLength(1);
  expect(stack.querySelector('[data-flower-subagent-overflow]')).toBeNull();
  const trigger = stack.closest('button')!;
  expect(trigger.getAttribute('aria-label')).toContain(label);
  expect(trigger.getAttribute('aria-label')).not.toContain('Completed');
});

it('pauses for focus, hover and hidden pages and keeps large overflow readable', async () => {
  const media = commands as unknown as { emulateMediaPreferences: (preferences: { reducedMotion: 'no-preference' }) => Promise<void> };
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  const host = document.createElement('div');
  document.body.append(host);
  const [ids, setIDs] = createSignal(['first', 'second']);
  const dispose = render(() => <button type="button"><SubagentAvatarStack threadIDs={ids()} state="running" animate /></button>, host);
  onTestFinished(() => { dispose(); host.remove(); });
  const stack = host.querySelector<HTMLElement>('[data-flower-subagent-stack]')!;
  const trigger = host.querySelector('button')!;
  await waitFor(() => stack.dataset.animating === 'true');
  expect(stack.querySelectorAll('[data-flower-subagent-avatar]')).toHaveLength(2);
  trigger.focus();
  expect(stack.dataset.animating).toBe('false');
  trigger.blur();
  expect(stack.dataset.animating).toBe('true');
  stack.dispatchEvent(new PointerEvent('pointerenter'));
  expect(stack.dataset.animating).toBe('false');
  stack.dispatchEvent(new PointerEvent('pointerleave'));
  expect(stack.dataset.animating).toBe('true');
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  onTestFinished(() => hidden.mockRestore());
  document.dispatchEvent(new Event('visibilitychange'));
  expect(stack.dataset.animating).toBe('false');
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(stack.dataset.animating).toBe('true');
  const initialFront = stack.querySelector<HTMLElement>('[data-front="true"]')!.dataset.flowerSubagentThreadId;
  const refresh = setInterval(() => setIDs(previous => [...previous]), 100);
  onTestFinished(() => clearInterval(refresh));
  await waitFor(() => stack.querySelector<HTMLElement>('[data-front="true"]')?.dataset.flowerSubagentThreadId !== initialFront, 5000);
  clearInterval(refresh);
  setIDs(Array.from({ length: 1003 }, (_, index) => 'overflow-' + index));
  expect(stack.querySelectorAll('[data-flower-subagent-avatar]')).toHaveLength(3);
  const overflow = stack.querySelector<HTMLElement>('[data-flower-subagent-overflow]')!;
  expect(overflow.textContent).toBe('+1000');
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  dispose();
  expect(host.childElementCount).toBe(0);
});

it('cycles every running identity through the foreground and honors reduced motion', async () => {
  await page.viewport(1100, 850);
  const media = commands as unknown as { emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  onTestFinished(() => media.emulateMediaPreferences({ reducedMotion: 'no-preference' }));
  const children = Array.from({ length: 4 }, (_, index) => subagentSummary({
    parent_thread_id: 'rotation-parent', thread_id: 'rotation-child-' + index, task_name: 'Task ' + index, status: 'running',
  }));
  const parent = thread({ thread_id: 'rotation-parent', subagents: children });
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [parent]),
    loadThread: vi.fn(async () => liveBootstrap(parent)),
  }, { focusThreadRequest: { request_id: 'focus-rotation', thread_id: parent.thread_id } });
  runtime.style.height = '800px';
  await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-stack]')));
  const stack = runtime.querySelector<HTMLElement>('[data-flower-subagent-stack]')!;
  const identities = new Set<string>();
  await waitFor(() => {
    const front = stack.querySelector<HTMLElement>('[data-front="true"]');
    if (front?.dataset.flowerSubagentThreadId) identities.add(front.dataset.flowerSubagentThreadId);
    expect(stack.querySelectorAll('[data-flower-subagent-avatar]')).toHaveLength(3);
    return identities.size === 4;
  }, 16000);
  expect([...identities].sort()).toEqual(children.map(child => child.thread_id).sort());
  await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  await waitFor(() => stack.dataset.animating === 'false');
  const fixed = stack.innerHTML;
  await new Promise(resolve => setTimeout(resolve, 2800));
  expect(stack.innerHTML).toBe(fixed);
  expect(stack.getAnimations({ subtree: true })).toHaveLength(0);
}, 22000);
