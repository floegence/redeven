import '../index.css';
import './flower-feature.css';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { FlowerActivityItem, FlowerLiveStreamConnectInput, FlowerRuntimeCurrentView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, deferred, renderSurfaceWithAdapter, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const now = 1_700_000_100_000;
const parentID = 'thread-operation-timing';
const target = { thread_id: 'child-timing', task_name: 'Research', task_description: 'Review current sources.', status: 'running' };

function operation(id: string, action: string, duration: number | undefined, overrides: Partial<FlowerActivityItem> = {}): FlowerActivityItem {
  return {
    item_id: id, tool_id: id, tool_name: 'subagents', kind: 'tool', renderer: 'subagent_operation',
    status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
    started_at_unix_ms: now - 10_000,
    ...(duration === undefined ? {} : { ended_at_unix_ms: now - 10_000 + duration }),
    payload: { action, targets: [target], requested_count: 1 },
    ...overrides,
  };
}

function current(version: number, settled = false): FlowerRuntimeCurrentView {
  const items = [
    operation('spawn-first', 'spawn', 250),
    operation('spawn-second', 'spawn', 750, { payload: { action: 'spawn', targets: [{ ...target, thread_id: 'other-child', task_name: 'Audit' }] } }),
    operation('completed-wait', 'wait', 3000, { payload: { action: 'wait', targets: [{ ...target, status: 'completed' }, { ...target, thread_id: 'other-child', task_name: 'Audit', status: 'completed' }], requested_count: 2, completed_count: 2 } }),
    operation('timeout-wait', 'wait', 2000, { payload: { action: 'wait', targets: [target], requested_count: 1, completed_count: 0, timed_out: true } }),
    operation('send-input', 'send_input', 500),
    operation('failed', 'inspect', 1000, { status: 'error' }),
    operation('canceled', 'wait', 500, { status: 'canceled' }),
    operation('declined', 'spawn', undefined, { status: 'declined', started_at_unix_ms: undefined, ended_at_unix_ms: now }),
    operation('missing-start', 'spawn', undefined, { started_at_unix_ms: undefined, ended_at_unix_ms: now }),
    operation('missing-end', 'wait', undefined),
    operation('active-wait', 'wait', undefined, { status: settled ? 'success' : 'running', started_at_unix_ms: now - 2000, ...(settled ? { ended_at_unix_ms: now + 60_000 } : {}) }),
  ];
  return {
    thread_id: parentID, turn_id: 'parent-turn', run_id: 'parent-run', view_version: version,
    activity: settled ? 'idle' : 'active', ...(settled ? { last_outcome: 'completed' as const } : { run_progress: { phase: 'streaming' as const } }),
    items: items.map(({ renderer, payload, ...activity }, index) => ({
      id: activity.item_id, turn_id: 'parent-turn', run_id: 'parent-run', ordinal: index + 1, kind: 'tool' as const,
      activity: { ...activity, presentation: { label: 'subagents', renderer, payload } },
    })),
    interactions: [],
  };
}

afterEach(() => vi.useRealTimers());

describe('Flower management operation execution timing', () => {
  it('freezes each completed operation across clock ticks, child reruns, terminal refresh and reload', async () => {
    await page.viewport(1100, 1000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const childRerun = deferred<void>();
    const completeParent = deferred<void>();
    let latest = current(1);
    let childRerunDelivered = false;
    let child = subagentSummary({ ...target, parent_thread_id: parentID, status: 'completed', created_at_ms: now - 90_000, updated_at_ms: now - 10_000 });
    let summary = thread({ thread_id: parentID, title: 'Operation timing', status: 'running', active_run_id: 'parent-run', run_progress: { phase: 'streaming', run_id: 'parent-run', turn_id: 'parent-turn' }, messages: [], subagents: [child] });
    const surfaceAdapter = {
      ...adapter(true),
      listThreads: vi.fn(async () => [summary]),
      loadThread: vi.fn(async () => ({ thread: { ...applyFlowerRuntimeCurrentView(summary, latest), subagents: [child] }, current: latest })),
      connectLiveStream: vi.fn(async function* (input: FlowerLiveStreamConnectInput) {
        yield { schema_version: 1, kind: 'ready' as const, summaries: [summary] };
        await childRerun.promise;
        child = { ...child, status: 'running', updated_at_ms: now + 60_000 };
        latest = current(2);
        yield { schema_version: 1, kind: 'thread.batch' as const, thread_id: parentID, current: latest, subagents: [child] };
        childRerunDelivered = true;
        await completeParent.promise;
        latest = current(3, true);
        summary = { ...summary, status: 'idle', active_run_id: undefined, run_progress: undefined };
        yield { schema_version: 1, kind: 'thread.batch' as const, thread_id: parentID, current: latest, subagents: [child] };
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }));
      }),
    } satisfies Parameters<typeof renderSurfaceWithAdapter>[0];
    const mount = async () => {
      const runtime = renderSurfaceWithAdapter(surfaceAdapter);
      runtime.style.height = '900px';
      await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${parentID}"] button`)));
      (runtime.querySelector(`[data-thread-id="${parentID}"] button`) as HTMLButtonElement).click();
      await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="active-wait"]')));
      return runtime;
    };
    const runtime = await mount();
    const row = (root: HTMLElement, id: string) => root.querySelector(`[data-flower-activity-item-id="${id}"]`)!;
    const duration = (root: HTMLElement, id: string) => row(root, id).querySelector('.flower-activity-inline-duration')?.textContent ?? '';
    const expected = { 'spawn-first': '250ms', 'spawn-second': '750ms', 'completed-wait': '3s', 'timeout-wait': '2s', 'send-input': '500ms', failed: '1s', canceled: '500ms', declined: '', 'missing-start': '', 'missing-end': '' };
    const checkSettledRows = (root: HTMLElement) => {
      for (const [id, label] of Object.entries(expected)) expect(duration(root, id), id).toBe(label);
      expect(row(root, 'completed-wait').textContent).toContain('2 subagents completed');
      expect(row(root, 'timeout-wait').textContent).toContain('Wait timed out');
    };
    checkSettledRows(runtime);
    const spawnRow = row(runtime, 'spawn-first');
    expect(spawnRow.querySelector('[data-flower-disclosure-trigger]')).toBeNull();
    expect(spawnRow.querySelector('[data-flower-subagent-capsule]')).not.toBeNull();
    expect(spawnRow.querySelector('.flower-subagent-capsule-status')?.textContent).not.toMatch(/\d+(?:ms|s|m)/);
    expect(duration(runtime, 'active-wait')).toBe('2s');

    vi.setSystemTime(now + 60_000);
    await waitFor(() => duration(runtime, 'active-wait') === '1m 2s');
    checkSettledRows(runtime);
    childRerun.resolve(undefined);
    await waitFor(() => childRerunDelivered);
    checkSettledRows(runtime);
    completeParent.resolve(undefined);
    await waitFor(() => row(runtime, 'active-wait').getAttribute('data-flower-activity-status') === 'success');
    vi.setSystemTime(now + 120_000);
    checkSettledRows(runtime);
    expect(duration(runtime, 'active-wait')).toBe('1m 2s');

    const reloaded = await mount();
    checkSettledRows(reloaded);
    expect(duration(reloaded, 'active-wait')).toBe('1m 2s');
  });
});
