import '../index.css';
import './flower-feature.css';

import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { FlowerActivityItem, FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
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

function mount(messages = [operation('spawn', 'spawn', 1)], count = 1, options: Partial<ReturnType<typeof adapter>> = {}, parentStatus: 'running' | 'idle' = 'running') {
  const summaries = targets.slice(0, count).map(target => subagentSummary({ ...target, parent_thread_id: parentID, title: target.task_name, created_at_ms: Date.now() - 60_000, updated_at_ms: Date.now() }));
  const snapshot = thread({ thread_id: parentID, status: parentStatus, messages, subagents: summaries });
  const loadDetail = vi.fn(async (_parent: string, child: string) => detailFor(summaries.find(summary => summary.thread_id === child)!));
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [snapshot]),
    loadThread: vi.fn(async () => liveBootstrap(snapshot)), loadSubagentDetail: loadDetail, ...options,
    ...(options.connectLiveStream ? { async *connectLiveStream(input) {
      yield { schema_version: 3 as const, kind: 'ready' as const, baseline_complete: true, summaries: [snapshot] };
      yield* options.connectLiveStream!(input);
    } } : {}),
  },
  { focusThreadRequest: { request_id: 'focus-capsules', thread_id: parentID } });
  runtime.style.height = '850px';
  return { runtime, summaries, loadDetail };
}

async function settleDetailWindow(surface: HTMLElement): Promise<void> {
  await waitFor(() => surface.dataset.floatingPresence === 'open');
  await Promise.all(surface.getAnimations().map(animation => animation.finished));
}

function row(runtime: HTMLElement, id: string) {
  return runtime.querySelector<HTMLElement>('[data-flower-activity-item-id="' + id + '"]')!;
}

const touch = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
afterEach(async () => {
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.style.fontSize = '';
  await touch.emulateTouchInput(false);
});

describe('Subagent inline capsules', () => {
  it.each([
    { width: 1100, coarse: false, fontSize: 16, theme: 'light' },
    { width: 320, coarse: false, fontSize: 16, theme: 'dark' },
    { width: 540, coarse: true, fontSize: 20, theme: 'light' },
  ])('keeps delayed creation fields on one stable title line without additional reads ($width, coarse=$coarse)', async ({ width, coarse, fontSize, theme }) => {
    await page.viewport(width, 900);
    document.documentElement.classList.add(theme);
    document.documentElement.style.fontSize = fontSize + 'px';
    await touch.emulateTouchInput(coarse);
    const pending = deferred<(typeof targets)[number]>();
    const action = deferred<{ action: string; requested_count: number }>();
    const loadActivityValue = vi.fn(async (_thread: string, request: { item_id: string; path: string }) => ({
      thread_id: parentID, item_id: request.item_id, turn_id: 'parent-turn', run_id: 'parent-run', path: request.path,
      value: request.path === '/payload' ? await action.promise : await pending.promise,
    }));
    const { runtime, loadDetail } = mount([operation('delayed-spawn', 'spawn', 1, { payload: undefined,
      field_summary: { version: 'spawn-v1', renderer: 'subagent_operation', fields: [
        { path: '/payload/action', kind: 'string', bytes: 5 },
        { path: '/payload/requested_count', kind: 'scalar', value: 1 },
        { path: '/payload/targets', kind: 'array', count: 1 },
      ] },
    }), operation('following', 'spawn', 1)], 1, { loadActivityValue });
    await waitFor(() => loadActivityValue.mock.calls.length === 2);
    const activity = row(runtime, 'delayed-spawn');
    const line = activity.querySelector<HTMLElement>('.flower-activity-inline-line')!;
    const field = activity.querySelector<HTMLElement>('.flower-activity-field-rows')!;
    const height = activity.getBoundingClientRect().height;
    const followingTop = row(runtime, 'following').getBoundingClientRect().top;
    expect(line.contains(field)).toBe(true);
    expect(height).toBe(fontSize * (coarse ? 3 : 2));
    const frames: { height: number; following: number }[] = [];
    let sampling = true;
    onTestFinished(() => { sampling = false; });
    const sample = () => {
      if (!sampling || !activity.isConnected) return;
      frames.push({ height: activity.getBoundingClientRect().height, following: row(runtime, 'following').getBoundingClientRect().top });
      if (sampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    const longName = targets[7]!.task_name;
    pending.resolve({ ...targets[0]!, task_name: longName });
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(activity.getBoundingClientRect().height).toBe(height);
    action.resolve({ action: 'spawn', requested_count: 1 });
    await waitFor(() => activity.textContent?.includes('Created subagent') === true && Boolean(activity.querySelector('[data-flower-subagent-capsule]')));
    const capsule = activity.querySelector<HTMLButtonElement>('[data-flower-subagent-capsule]')!;
    expect(line.contains(capsule)).toBe(true);
    expect(activity.querySelector('.flower-activity-field-rows')).toBe(field);
    expect(activity.getBoundingClientRect().height).toBe(height);
    expect(row(runtime, 'following').getBoundingClientRect().top).toBe(followingTop);
    expect(activity.querySelectorAll('.flower-subagent-capsule-name')).toHaveLength(1);
    expect(capsule.querySelector('[data-flower-subagent-avatar]')).not.toBeNull();
    expect(capsule.getAttribute('aria-label')).toContain(longName);
    expect(activity.scrollWidth).toBeLessThanOrEqual(activity.clientWidth + 1);
    expect(capsule.getBoundingClientRect().right).toBeLessThanOrEqual(line.getBoundingClientRect().right);
    expect(getComputedStyle(capsule.querySelector('.flower-subagent-capsule-name')!).textOverflow).toBe('ellipsis');
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { sampling = false; resolve(); })));
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every(frame => frame.height === height && Math.abs(frame.following - followingTop) <= 1)).toBe(true);
    expect(loadActivityValue.mock.calls.map(call => call[1].path).sort()).toEqual(['/payload', '/payload/targets/0']);
    expect(loadDetail).not.toHaveBeenCalled();
    await page.screenshot({ path: '__screenshots__/subagent-capsules/field-inline-' + width + '.png' });
    capsule.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => loadDetail.mock.calls.length === 1);
    expect(loadActivityValue).toHaveBeenCalledTimes(2);
  });

  it('keeps consecutive deferred creations stable while reading and reopening their sequence', async () => {
    await page.viewport(1100, 900);
    const pending = targets.slice(0, 4).map(() => deferred<(typeof targets)[number]>());
    const loadActivityValue = vi.fn(async (_thread: string, request: { item_id: string; path: string }) => ({
      thread_id: parentID, item_id: request.item_id, turn_id: 'parent-turn', run_id: 'parent-run', path: request.path,
      value: request.path === '/payload' ? { action: 'spawn', requested_count: 1 }
        : await pending[Number(request.item_id.slice(-1))]!.promise,
    }));
    const messages = [
      ...Array.from({ length: 16 }, (_, index) => operation('earlier-' + index, 'spawn', 1)),
      ...pending.map((_, index) => operation('batch-' + index, 'spawn', 1, { payload: undefined,
        field_summary: { version: 'batch-v1', renderer: 'subagent_operation', fields: [
          { path: '/payload/action', kind: 'string', bytes: 5 },
          { path: '/payload/requested_count', kind: 'scalar', value: 1 },
          { path: '/payload/targets', kind: 'array', count: 1 },
        ] },
      })),
    ];
    const snapshot = thread({ thread_id: parentID, status: 'running', active_run_id: 'parent-run', messages,
      subagents: targets.slice(0, 4).map(target => subagentSummary({ ...target, parent_thread_id: parentID })),
      turns: [{ turn_id: 'parent-turn', run_id: 'parent-run', started_at: '2026-10-28T10:00:00Z',
        elapsed_ms: 0, waiting_ms: 0, work_duration_ms: 0, intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false }],
    });
    const current = { ...liveBootstrap(snapshot).current, items: messages.map((message, index) => {
      const { renderer, payload, field_summary, ...activity } = message.blocks[0]!.items[0]!;
      return { id: activity.item_id, kind: 'tool' as const, turn_id: 'parent-turn', run_id: 'parent-run', ordinal: index + 1,
        activity: { ...activity, ...(field_summary ? {} : { presentation: { renderer, payload } }) },
        ...(field_summary ? { activity_summary: field_summary } : {}),
      };
    }) };
    const projected = applyFlowerRuntimeCurrentView(snapshot, current);
    const loadDetail = vi.fn();
    const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), loadActivityValue, loadSubagentDetail: loadDetail,
      listThreads: vi.fn(async () => [projected]), loadThread: vi.fn(async () => ({ thread: projected, current })),
    }, { focusThreadRequest: { request_id: 'focus-batch', thread_id: parentID } });
    runtime.style.height = '850px';
    await waitFor(() => loadActivityValue.mock.calls.filter(call => call[1].path === '/payload/targets/0').length === 2);
    const body = runtime.querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    body.dispatchEvent(new WheelEvent('wheel', { deltaY: -24 }));
    body.scrollTop -= 24;
    body.dispatchEvent(new Event('scroll'));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const scrollTop = body.scrollTop;
    const geometry = pending.map((_, index) => {
      const rect = row(runtime, 'batch-' + index).getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    });
    for (const index of [0, 1, 2, 3]) {
      pending[index]!.resolve(targets[index]!);
      await waitFor(() => Boolean(row(runtime, 'batch-' + index).querySelector('[data-flower-subagent-capsule]')));
      expect(body.scrollTop).toBe(scrollTop);
      for (let i = 0; i < pending.length; i++) {
        const rect = row(runtime, 'batch-' + i).getBoundingClientRect();
        expect(rect.height).toBe(geometry[i]!.height);
        expect(Math.abs(rect.top - geometry[i]!.top)).toBeLessThanOrEqual(1);
      }
    }
    const field = row(runtime, 'batch-3').querySelector('.flower-activity-field-rows');
    const toggle = runtime.querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
    toggle.click();
    await waitFor(() => toggle.getAttribute('aria-expanded') === 'false');
    toggle.click();
    await waitFor(() => toggle.getAttribute('aria-expanded') === 'true');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(row(runtime, 'batch-3').querySelector('.flower-activity-field-rows')).toBe(field);
    expect(loadActivityValue).toHaveBeenCalledTimes(8);
    expect(loadDetail).not.toHaveBeenCalled();
  });

  it('keeps a target read failure in the reserved line without retrying or hiding it', async () => {
    const pending = deferred<never>();
    const loadActivityValue = vi.fn(async (_thread: string, request: { item_id: string; path: string }) => ({
      thread_id: parentID, item_id: request.item_id, turn_id: 'parent-turn', run_id: 'parent-run', path: request.path,
      value: request.path === '/payload' ? { action: 'spawn', requested_count: 1 } : await pending.promise,
    }));
    const { runtime, loadDetail } = mount([operation('failed-field', 'spawn', 1, { payload: undefined,
      field_summary: { version: 'failure-v1', renderer: 'subagent_operation', fields: [
        { path: '/payload/action', kind: 'string', bytes: 5 },
        { path: '/payload/targets', kind: 'array', count: 1 },
      ] },
    })], 1, { loadActivityValue });
    await waitFor(() => loadActivityValue.mock.calls.length === 2);
    const activity = row(runtime, 'failed-field');
    const height = activity.getBoundingClientRect().height;
    pending.reject(new Error('Unavailable target'));
    await waitFor(() => activity.querySelector('[role="status"]')?.textContent?.includes('Could not load') === true);
    expect(activity.getBoundingClientRect().height).toBe(height);
    expect(activity.querySelector('.flower-activity-inline-line')!.contains(activity.querySelector('[role="status"]'))).toBe(true);
    expect(activity.querySelector('[data-flower-subagent-capsule]')).toBeNull();
    expect(loadActivityValue).toHaveBeenCalledTimes(2);
    expect(loadDetail).not.toHaveBeenCalled();
  });

  it('preserves child navigation when operation targets arrive as visible fields', async () => {
    const loadActivityValue = vi.fn(async (_thread: string, request: { item_id: string; path: string }) => ({
      thread_id: parentID, item_id: request.item_id, turn_id: 'parent-turn', run_id: 'parent-run', path: request.path,
      value: request.path === '/payload' ? { action: 'inspect', requested_count: 1 } : targets[0],
    }));
    const { runtime, loadDetail } = mount([operation('field-child', 'inspect', 1, { payload: undefined,
      field_summary: { version: 'field-v1', renderer: 'subagent_operation', fields: [
        { path: '/payload/action', kind: 'string', bytes: 7 },
        { path: '/payload/requested_count', kind: 'scalar', value: 1 },
        { path: '/payload/targets', kind: 'array', count: 1 },
      ] },
    })], 1, { loadActivityValue });
    await waitFor(() => Boolean(row(runtime, 'field-child')?.querySelector('[data-flower-subagent-capsule]')));
    const capsule = row(runtime, 'field-child').querySelector<HTMLButtonElement>('[data-flower-subagent-capsule]')!;
    capsule.click();
    await waitFor(() => loadDetail.mock.calls.length === 1);
    expect(loadDetail.mock.calls[0].slice(0, 2)).toEqual([parentID, targets[0]!.thread_id]);
    expect(loadActivityValue.mock.calls.every(call => ['/payload', '/payload/targets/0'].includes(call[1].path))).toBe(true);
  });
  it('keeps foreign field-backed targets informational without child navigation', async () => {
    const loadActivityValue = vi.fn(async (_thread: string, request: { item_id: string; path: string }) => ({
      thread_id: parentID, item_id: request.item_id, turn_id: 'parent-turn', run_id: 'parent-run', path: request.path,
      value: request.path === '/payload' ? { action: 'inspect', requested_count: 1 } : targets[0],
    }));
    const { runtime, loadDetail } = mount([operation('foreign-field-child', 'inspect', 1, { payload: undefined,
      field_summary: { version: 'field-v1', renderer: 'subagent_operation', fields: [
        { path: '/payload/action', kind: 'string', bytes: 7 },
        { path: '/payload/requested_count', kind: 'scalar', value: 1 },
        { path: '/payload/targets', kind: 'array', count: 1 },
      ] },
    })], 0, { loadActivityValue });
    await waitFor(() => Boolean(row(runtime, 'foreign-field-child')?.querySelector('[data-flower-subagent-identity]')));
    const activity = row(runtime, 'foreign-field-child');
    const identity = activity.querySelector<HTMLElement>('[data-flower-subagent-identity]')!;
    expect(identity.title).toContain(targets[0]!.task_name);
    expect(identity.querySelector('[data-flower-subagent-avatar]')).not.toBeNull();
    expect(activity.querySelector('.flower-activity-inline-line')!.contains(identity)).toBe(true);
    expect(activity.querySelector('[data-flower-subagent-capsule]')).toBeNull();
    expect(identity.tagName).toBe('SPAN');
    expect(identity.hasAttribute('tabindex')).toBe(false);
    expect(loadActivityValue).toHaveBeenCalledTimes(2);
    expect(loadDetail).not.toHaveBeenCalled();
  });

  it('renders live child text at streaming cadence while the parent is idle', async () => {
    const summary = subagentSummary({ ...targets[0]!, parent_thread_id: parentID, title: targets[0]!.task_name });
    const base = detailFor(summary);
    const detail = { ...base, current: { ...base.current, activity: 'active' as const, items: [{ id: 'live-child', kind: 'assistant' as const, turn_id: base.current.turn_id!, run_id: base.current.run_id!, ordinal: 1, text: 'Child remains live', live: true }] } };
    const { runtime } = mount(undefined, 1, { loadSubagentDetail: vi.fn(async () => detail) }, 'idle');
    await waitFor(() => Boolean(row(runtime, 'spawn')));
    row(runtime, 'spawn').querySelector<HTMLButtonElement>('[data-flower-subagent-capsule]')!.click();
    await waitFor(() => Boolean(document.querySelector('[data-flower-message-id="live-child"]')));
    expect(document.querySelector('[data-flower-message-id="live-child"] .flower-message-bubble-streaming')).not.toBeNull();
  });

  it('renders inherited child activity without a broken source-child action', async () => {
    const loadDetail = vi.fn();
    const { runtime } = mount([operation('inherited', 'spawn', 1)], 0, { loadSubagentDetail: loadDetail });
    await waitFor(() => Boolean(row(runtime, 'inherited')));
    expect(row(runtime, 'inherited').querySelector('[data-flower-subagent-identity]')?.getAttribute('title')).toContain(targets[0]!.task_name);
    expect(row(runtime, 'inherited').querySelector('[data-flower-subagent-avatar]')).not.toBeNull();
    expect(row(runtime, 'inherited').querySelector('[data-flower-subagent-capsule]')).toBeNull();
    expect(document.querySelector('[data-flower-subagent-detail="open"]')).toBeNull();
    expect(loadDetail).not.toHaveBeenCalled();
  });

  it('ignores source children even if a foreign summary appears in a fork snapshot', async () => {
    const loadDetail = vi.fn();
    const inherited = operation('fork-history', 'spawn', 1);
    const snapshot = thread({ thread_id: 'fork-thread', messages: [{ ...inherited, blocks: [
      { ...inherited.blocks[0]!, thread_id: 'fork-thread' },
    ] }],
      subagents: [subagentSummary({ ...targets[0]!, parent_thread_id: parentID })] });
    const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [snapshot]),
      loadThread: vi.fn(async () => liveBootstrap(snapshot)), loadSubagentDetail: loadDetail },
    { focusThreadRequest: { request_id: 'fork-scope', thread_id: 'fork-thread' } });
    await waitFor(() => Boolean(row(runtime, 'fork-history')));
    expect(runtime.querySelector('[data-flower-subagent-capsule]')).toBeNull();
    expect(loadDetail).not.toHaveBeenCalled();
  });

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

  it.each(['spawn', 'list', 'status', 'inspect', 'wait', 'send_input', 'close', 'close_all'])('presents a single %s target without a disclosure', async (action) => {
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
      const actions = ['spawn', 'list', 'status', 'inspect', 'wait', 'send_input', 'close', 'close_all'];
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
      await settleDetailWindow(window);
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
      expect(loadDetail).toHaveBeenLastCalledWith(parentID, 'capsule-child-1', undefined, expect.any(AbortSignal));
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

  it.each([1100, 700, 320])('keeps avatar coordinates through deferred detail and metadata changes at %spx', async (width) => {
    await page.viewport(width, 900);
    const requests: Array<ReturnType<typeof deferred<ReturnType<typeof subagentDetail>>>> = [];
    const { runtime, summaries } = mount([operation('spawn', 'spawn', 8)], 8, {
      loadSubagentDetail: vi.fn(() => {
        const request = deferred<ReturnType<typeof subagentDetail>>();
        requests.push(request);
        return request.promise;
      }),
    });
    await waitFor(() => Boolean(row(runtime, 'spawn')));
    row(runtime, 'spawn').querySelector<HTMLButtonElement>('[data-flower-subagent-capsule]')!.click();
    await waitFor(() => requests.length === 1 && Boolean(document.querySelector('.flower-subagent-detail-window')));
    const surface = document.querySelector<HTMLElement>('.flower-subagent-detail-window')!;
    await settleDetailWindow(surface);
    const switcher = surface.querySelector<HTMLElement>('[data-flower-subagent-switcher]')!;
    const buttons = [...switcher.querySelectorAll<HTMLButtonElement>('button')];
    const bounds = (element: HTMLElement) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return [x, y, width, height];
    };
    const positions = buttons.map(bounds);
    const windowBounds = bounds(surface);
    const overview = surface.querySelector<HTMLElement>('.flower-subagent-detail-overview')!;
    const overviewBounds = bounds(overview);
    const checkGeometry = () => {
      expect(buttons.map(bounds)).toEqual(positions);
      expect(bounds(surface)).toEqual(windowBounds);
      expect(bounds(overview)).toEqual(overviewBounds);
      expect(switcher.scrollWidth).toBeLessThanOrEqual(switcher.clientWidth + 1);
      expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
    };
    const modelContext = {
      snapshot: { sections: [{ key: 'skills', title: 'Skills', text: 'Current child catalog' }] },
      entry_id: 'child-facts', path_depth: 1, turn_id: 'child-turn', run_id: 'child-run',
      updated_at: '2026-10-16T12:00:00Z', changed_keys: ['skills'], removed_keys: [],
    };
    requests[0]!.resolve({ ...detailFor(summaries[0]!), model_context: modelContext });
    await waitFor(() => Boolean(surface.querySelector('.flower-composer-context-progress')));
    checkGeometry();
    surface.querySelector<HTMLElement>('.flower-composer-context-progress')!.click();
    const contextPanel = surface.querySelector<HTMLElement>('.flower-composer-context-tooltip')!;
    await waitFor(() => getComputedStyle(contextPanel).opacity === '1');
    expect(contextPanel.getBoundingClientRect().left).toBeGreaterThanOrEqual(surface.getBoundingClientRect().left);
    expect(contextPanel.getBoundingClientRect().right).toBeLessThanOrEqual(surface.getBoundingClientRect().right);
    expect(contextPanel.getBoundingClientRect().top).toBeGreaterThanOrEqual(overview.getBoundingClientRect().bottom);
    checkGeometry();
    for (const index of [1, 2, 6, 0]) {
      const target = buttons.find(button => button.dataset.flowerSubagentSwitch === summaries[index]!.thread_id)!;
      target.focus();
      const requestCount = requests.length;
      target.click();
      await waitFor(() => requests.length === requestCount + 1);
      expect(surface.querySelector('.flower-subagent-detail-loading')).not.toBeNull();
      // Even a cached child must renew its baseline before exposing content.
      if (index === 0) expect(surface.querySelector<HTMLElement>('.flower-subagent-detail-timeline')!.checkVisibility({ visibilityProperty: true })).toBe(false);
      if (index === 0) expect(surface.querySelector('.flower-subagent-detail-transcript')).not.toBeNull();
      checkGeometry();
      const detail = detailFor(summaries[index]!);
      requests.at(-1)!.resolve(index === 0 ? { ...detail, model_context: modelContext } : {
        ...detail, current: { ...detail.current, activity: 'idle', run_progress: undefined },
      });
      await waitFor(() => Boolean(surface.querySelector('.flower-subagent-detail-transcript'))
        && surface.querySelector('.flower-subagent-detail-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
      checkGeometry();
      expect(document.activeElement).toBe(target);
      expect(surface.querySelector('[data-flower-subagent-switch="' + summaries[index]!.thread_id + '"]')).toBe(target);
      expect(target.getAttribute('aria-pressed')).toBe('true');
    }
    await page.screenshot({ path: '__screenshots__/subagent-capsules/stable-switcher-' + width + '.png' });
  });

  it('keeps creation order and focused avatar positions through live membership updates', async () => {
    await page.viewport(1100, 900);
    let emit: ((value: FlowerLiveStreamEnvelope | null) => void) | undefined;
    const { runtime, summaries } = mount([operation('spawn', 'spawn', 8)], 8, {
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
    await waitFor(() => Boolean(row(runtime, 'spawn')) && Boolean(emit));
    // Inventory order and equal creation timestamps must not inherit status priority.
    const creationOrder = [summaries[3]!, summaries[1]!, ...summaries.filter((_, index) => index !== 3 && index !== 1)];
    const createdAt = summaries[0]!.created_at_ms!;
    const inventory = creationOrder.map((summary, index) => ({ ...summary, created_at_ms: createdAt + Math.floor(index / 2) }));
    emit!({ schema_version: 3, kind: 'thread.batch', thread_id: parentID, subagents: inventory });
    await waitFor(() => Boolean(emit));
    row(runtime, 'spawn').querySelector<HTMLButtonElement>('[data-flower-subagent-capsule]')!.click();
    await waitFor(() => Boolean(document.querySelector('.flower-subagent-detail-transcript')));
    const surface = document.querySelector<HTMLElement>('.flower-subagent-detail-window')!;
    await settleDetailWindow(surface);
    const switcher = surface.querySelector<HTMLElement>('[data-flower-subagent-switcher]')!;
    const buttons = [...switcher.querySelectorAll<HTMLButtonElement>('button')];
    const positions = buttons.map(button => button.getBoundingClientRect().x);
    const focused = buttons.find(button => button.dataset.flowerSubagentSwitch === summaries[0]!.thread_id)!;
    focused.focus();
    emit!({ schema_version: 3, kind: 'thread.batch', thread_id: parentID,
      subagents: [...inventory].reverse().map((summary, index) => ({ ...summary, status: index === 0 ? 'running' : 'completed', task_name: 'Renamed task ' + index, updated_at_ms: Date.now() + index * 100 })) });
    await waitFor(() => Boolean(emit) && focused.title.includes('Completed'));
    expect([...switcher.querySelectorAll<HTMLButtonElement>('button')].map(button => button.dataset.flowerSubagentSwitch))
      .toEqual(buttons.map(button => button.dataset.flowerSubagentSwitch));
    expect(buttons.map(button => button.getBoundingClientRect().x)).toEqual(positions);
    expect(document.activeElement).toBe(focused);
    expect(buttons.map(button => button.dataset.flowerSubagentSwitch)).toEqual([1, 3, 0, 2, 4, 5, 6, 7].map(index => summaries[index]!.thread_id));
  });

  it.each(['spawn', 'wait'])('preserves recorded %s status and focused capsules through live inventory changes', async (action) => {
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
    emit!({ schema_version: 3, kind: 'thread.batch', thread_id: parentID, subagents: summaries.map(summary => ({ ...summary, status: 'completed' })) });
    await waitFor(() => Boolean(emit));
    expect(capsule.dataset.flowerSubagentStatus).toBe('running');
    expect(document.activeElement).toBe(capsule);
    expect(activity.querySelector('[data-flower-subagent-capsule="capsule-child-0"]')).toBe(capsule);
    expect(activity.querySelector('.flower-activity-inline-title')!.textContent).toBe(title);
    expect(row(runtime, 'timeout').textContent).toContain('Wait timed out');
    expect(row(runtime, 'timeout').querySelector('[data-flower-subagent-capsule]')?.getAttribute('data-flower-subagent-status')).toBe('running');
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
