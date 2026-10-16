import '../index.css';
import './flower-feature.css';

import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowerActivityItem, FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { activityItem, activityTimeline, adapter, deferred, liveBootstrap, renderSurfaceWithAdapterProps, subagentDetail, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const parentID = 'capsule-parent';
const targets = Array.from({ length: 8 }, (_, index) => ({
  thread_id: 'capsule-child-' + index,
  task_name: index === 7 ? 'Review deployment compatibility and migration requirements across all supported environments' : 'Research task ' + (index + 1),
  task_description: 'Verify original evidence for task ' + (index + 1),
  status: ['running', 'waiting_input', 'completed', 'failed', 'queued', 'canceled', 'timed_out', 'running'][index]!,
}));

function operation(id: string, action: string, count: number, overrides: Partial<FlowerActivityItem> = {}) {
  return { id: 'message-' + id, turn_id: 'parent-turn', role: 'assistant' as const, content: '', status: 'complete' as const, created_at_ms: 100,
    blocks: [activityTimeline({ thread_id: parentID, run_id: 'parent-run', turn_id: 'parent-turn',
      items: [activityItem({ item_id: id, tool_id: id, tool_name: 'subagents', renderer: 'subagent_operation', status: 'success',
        payload: { action, targets: targets.slice(0, count), requested_count: count, completed_count: 0 }, ...overrides })] })] };
}

function detailFor(summary: ReturnType<typeof subagentSummary>) {
  const base = subagentDetail({ summary });
  return { ...base, current: { ...base.current, run_progress: { phase: 'streaming' as const }, items: base.current.items!.filter(item => item.kind !== 'tool') } };
}

function mount(messages = [operation('spawn', 'spawn', 1)], count = 1, options: Partial<ReturnType<typeof adapter>> = {}) {
  const summaries = targets.slice(0, count).map(target => subagentSummary({ ...target, parent_thread_id: parentID, title: target.task_name, created_at_ms: Date.now() - 60_000, updated_at_ms: Date.now() }));
  const snapshot = thread({ thread_id: parentID, status: 'running', messages, subagents: summaries });
  const loadDetail = vi.fn(async (_parent: string, child: string) => detailFor(summaries.find(summary => summary.thread_id === child)!));
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [snapshot]),
    loadThread: vi.fn(async () => liveBootstrap(snapshot)), loadSubagentDetail: loadDetail, ...options },
  { focusThreadRequest: { request_id: 'focus-capsules', thread_id: parentID } });
  runtime.style.height = '850px';
  return { runtime, summaries, loadDetail };
}

function row(runtime: HTMLElement, id: string) {
  return runtime.querySelector<HTMLElement>('[data-flower-activity-item-id="' + id + '"]')!;
}

afterEach(() => document.documentElement.classList.remove('dark', 'light'));

describe('Subagent inline capsules', () => {
  it('opens one agent immediately with keyboard and no disclosure or switcher', async () => {
    await page.viewport(1100, 900);
    const pending = deferred<ReturnType<typeof subagentDetail>>();
    const { runtime, summaries } = mount(undefined, 1, { loadSubagentDetail: vi.fn(() => pending.promise) });
    await waitFor(() => Boolean(row(runtime, 'spawn')));
    const activity = row(runtime, 'spawn');
    expect(activity.querySelector('[aria-expanded], [data-flower-disclosure-trigger]')).toBeNull();
    const capsule = activity.querySelector<HTMLButtonElement>('[data-flower-subagent-capsule]')!;
    expect(capsule).not.toBeNull();
    const line = activity.querySelector<HTMLElement>('.flower-activity-inline-line')!;
    expect(line.contains(capsule)).toBe(true);
    expect(capsule.getBoundingClientRect().height).toBeLessThanOrEqual(28);
    expect(activity.getBoundingClientRect().height).toBeLessThanOrEqual(32);
    expect(activity.querySelector('.flower-activity-inline-title')?.textContent).not.toContain(targets[0]!.task_name);
    expect(capsule.querySelector('[data-flower-subagent-avatar]')).not.toBeNull();
    expect(capsule.getBoundingClientRect().width).toBeLessThan(activity.getBoundingClientRect().width - 50);
    expect(getComputedStyle(capsule).cursor).toBe('pointer');
    capsule.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-detail="open"]')));
    expect(document.querySelector('[data-flower-subagent-switcher]')).toBeNull();
    expect(document.querySelector('.flower-subagent-detail-loading')).not.toBeNull();
    pending.resolve(detailFor(summaries[0]!));
    await waitFor(() => Boolean(document.querySelector('.flower-subagent-detail-transcript')));
    expect(document.querySelector('.flower-subagent-detail-avatar')?.getAttribute('data-flower-subagent-avatar'))
      .toBe(capsule.querySelector('[data-flower-subagent-avatar]')?.getAttribute('data-flower-subagent-avatar'));
  });

  it('keeps a long single creation on the title line in a narrow transcript', async () => {
    await page.viewport(320, 750);
    const { runtime } = mount([operation('long-spawn', 'spawn', 1, {
      payload: { action: 'spawn', targets: [targets[7]], requested_count: 1 },
    })], 8);
    await waitFor(() => Boolean(row(runtime, 'long-spawn')));
    const activity = row(runtime, 'long-spawn');
    const line = activity.querySelector<HTMLElement>('.flower-activity-inline-line')!;
    const capsule = activity.querySelector<HTMLElement>('[data-flower-subagent-capsule]')!;
    const title = activity.querySelector<HTMLElement>('.flower-activity-inline-title')!;
    expect(line.contains(capsule)).toBe(true);
    expect(capsule.getBoundingClientRect().left).toBeGreaterThan(title.getBoundingClientRect().right);
    expect(activity.scrollWidth).toBeLessThanOrEqual(activity.clientWidth + 1);
    expect(capsule.getBoundingClientRect().right).toBeLessThanOrEqual(line.getBoundingClientRect().right);
    expect(capsule.getAttribute('aria-label')).toContain(targets[7]!.task_name);
    expect(getComputedStyle(capsule.querySelector('.flower-subagent-capsule-name')!).textOverflow).toBe('ellipsis');
    await page.screenshot({ path: '__screenshots__/subagent-capsules/single-inline-narrow.png' });
  });

  it.each(['spawn', 'list', 'inspect', 'wait', 'send_input', 'close', 'close_all'])('presents a single %s target without a disclosure', async (action) => {
    const { runtime } = mount([operation(action, action, 1)]);
    await waitFor(() => Boolean(row(runtime, action)));
    const activity = row(runtime, action);
    expect(activity.querySelectorAll('[data-flower-subagent-capsule]')).toHaveLength(1);
    expect(activity.querySelector('[aria-expanded], .flower-activity-inline-details')).toBeNull();
    expect(activity.querySelector('[data-flower-subagent-capsule]')?.getAttribute('aria-label')).toContain(targets[0]!.task_name);
  });

  for (const theme of ['light', 'dark'] as const) {
    it('wraps lifecycle operations and switches agents in ' + theme + ' mode', async () => {
      await page.viewport(1100, 900);
      document.documentElement.classList.add(theme);
      const actions = ['spawn', 'list', 'inspect', 'wait', 'send_input', 'close', 'close_all'];
      const { runtime, loadDetail } = mount(actions.map(action => operation(action, action, 8)), 8);
      await waitFor(() => Boolean(row(runtime, 'close_all')));
      for (const action of actions) {
        const activity = row(runtime, action);
        expect(activity.querySelectorAll('[data-flower-subagent-capsule]')).toHaveLength(8);
        expect(activity.querySelector('[aria-expanded], .flower-activity-inline-details')).toBeNull();
        expect(activity.textContent).not.toContain('capsule-child');
      }
      row(runtime, 'spawn').querySelector<HTMLButtonElement>('[data-flower-subagent-capsule]')!.click();
      await waitFor(() => Boolean(document.querySelector('.flower-subagent-detail-transcript')));
      const window = document.querySelector<HTMLElement>('.flower-subagent-detail-window')!;
      const geometry = window.closest<HTMLElement>('[data-floe-geometry-surface]')!;
      await waitFor(() => geometry.dataset.floatingPresence === 'open' && getComputedStyle(geometry).opacity === '1');
      const switcher = document.querySelector<HTMLElement>('[data-flower-subagent-switcher]')!;
      expect(switcher.querySelectorAll('button')).toHaveLength(8);
      expect(window.querySelector('.flower-subagent-detail-overview')?.contains(switcher)).toBe(true);
      const header = window.querySelector<HTMLElement>('[data-floe-floating-window-titlebar]')!;
      expect(header.textContent).toContain(targets[0]!.task_description);
      expect(header.querySelector('[data-flower-subagent-avatar]')).not.toBeNull();
      expect(window.querySelector('.flower-subagent-detail-description')).toBeNull();
      const overview = window.querySelector<HTMLElement>('.flower-subagent-detail-overview')!;
      expect(overview.getBoundingClientRect().height).toBeLessThan(56);
      expect(switcher.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
      const second = switcher.querySelector<HTMLButtonElement>('[data-flower-subagent-switch="capsule-child-1"]')!;
      second.click();
      await waitFor(() => second.getAttribute('aria-pressed') === 'true');
      expect(header.textContent).toContain(targets[1]!.task_description);
      expect(loadDetail).toHaveBeenLastCalledWith(parentID, 'capsule-child-1');
      expect(document.querySelectorAll('[data-flower-subagent-detail="open"]')).toHaveLength(1);
      expect(document.querySelector('.flower-subagent-detail-window')).toBe(window);
      await page.screenshot({ path: '__screenshots__/subagent-capsules/window-' + theme + '.png' });
      await page.viewport(320, 750);
      const list = row(runtime, 'spawn').querySelector<HTMLElement>('.flower-activity-subagents-list')!;
      await waitFor(() => window.getBoundingClientRect().width < 320);
      expect(getComputedStyle(list).flexWrap).toBe('wrap');
      expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth + 1);
      for (const capsule of runtime.querySelectorAll<HTMLElement>('[data-flower-subagent-capsule]')) {
        expect(capsule.scrollWidth).toBeLessThanOrEqual(capsule.clientWidth + 1);
      }
      expect(switcher.scrollWidth).toBeLessThanOrEqual(switcher.clientWidth + 1);
      await page.screenshot({ path: '__screenshots__/subagent-capsules/narrow-' + theme + '.png' });
    });
  }

  it.each(['spawn', 'wait'])('updates live %s status without rewriting historical outcomes or replacing focused capsules', async (action) => {
    let emit: ((value: FlowerLiveStreamEnvelope | null) => void) | undefined;
    const { runtime, summaries } = mount([operation('live', action, action === 'spawn' ? 1 : 2), operation('timeout', 'wait', 1, {
      payload: { action: 'wait', targets: targets.slice(0, 1), requested_count: 1, completed_count: 0, timed_out: true },
    })], 2, {
      async *connectLiveStream({ signal }) {
        while (!signal.aborted) {
          const value = await new Promise<FlowerLiveStreamEnvelope | null>(resolve => {
            emit = resolve;
            signal.addEventListener('abort', () => resolve(null), { once: true });
          });
          if (!value) return;
          emit = undefined;
          yield value;
        }
      },
    });
    await waitFor(() => Boolean(row(runtime, 'timeout')) && Boolean(emit));
    const activity = row(runtime, 'live');
    const title = activity.querySelector('.flower-activity-inline-title')!.textContent;
    const capsule = activity.querySelector<HTMLButtonElement>('[data-flower-subagent-capsule="capsule-child-0"]')!;
    capsule.focus();
    emit!({ schema_version: 1, kind: 'thread.batch', thread_id: parentID, subagents: summaries.map(summary => ({ ...summary, status: 'completed' })) });
    await waitFor(() => capsule.dataset.flowerSubagentStatus === 'completed');
    expect(document.activeElement).toBe(capsule);
    expect(activity.querySelector('[data-flower-subagent-capsule="capsule-child-0"]')).toBe(capsule);
    expect(activity.querySelector('.flower-activity-inline-title')!.textContent).toBe(title);
    expect(row(runtime, 'timeout').textContent).toContain('Wait timed out');
    expect(row(runtime, 'timeout').querySelector('[data-flower-subagent-capsule]')?.getAttribute('data-flower-subagent-status')).toBe('completed');
  });

  it('shows failed creation inline without inventing a clickable agent', async () => {
    const { runtime } = mount([operation('failed', 'spawn', 0, { status: 'error',
      payload: { action: 'spawn', targets: [], error: { message: 'The child limit was reached.' } } })], 0);
    await waitFor(() => Boolean(row(runtime, 'failed')));
    const activity = row(runtime, 'failed');
    expect(activity.textContent).toContain('Failed to create subagent');
    expect(activity.textContent).toContain('The child limit was reached.');
    expect(activity.querySelector('[data-flower-subagent-capsule], [aria-expanded]')).toBeNull();
  });
});
