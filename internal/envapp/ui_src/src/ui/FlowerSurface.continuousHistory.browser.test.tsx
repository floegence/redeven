import '../index.css';
import './flower-feature.css';
import { page } from 'vitest/browser';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowerHistoryRequest, FlowerLiveStreamEnvelope, FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { activityItem, activityTimeline, adapter, deferred, liveBootstrap, renderSurfaceWithAdapterProps, subagentDetail, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';

let warningSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warningSpy = vi.spyOn(console, 'warn'); });
afterEach(() => {
  const ownerWarnings = warningSpy.mock.calls.filter((args: unknown[]) => String(args[0]).includes('computations created outside'));
  warningSpy.mockRestore();
  expect(ownerWarnings).toEqual([]);
});

function selectPage(items: FlowerRuntimeCurrentItem[], request: FlowerHistoryRequest = {}) {
  if (request.item_ids) return items.filter(item => request.item_ids!.includes(item.id)).map(item => ({ ...item }));
  const limit = request.limit ?? 150;
  const anchor = request.anchor_id ? items.findIndex(item => item.id === request.anchor_id) + (request.anchor_offset ?? 0) : items.length;
  const first = request.direction === 'after' ? request.anchor_id ? anchor + 1 : 0
    : request.direction === 'around' ? Math.max(0, Math.min(items.length - limit, anchor - Math.floor(limit / 2)))
      : Math.max(0, anchor - limit);
  const end = request.direction === 'after' || request.direction === 'around' ? Math.min(items.length, first + limit) : anchor;
  return items.slice(first, end).map(item => ({ ...item }));
}
function pageBounds(items: FlowerRuntimeCurrentItem[], selected: FlowerRuntimeCurrentItem[]) {
  return { first_item_id: selected[0]?.id, last_item_id: selected.at(-1)?.id,
    has_before: selected.length > 0 && selected[0].id !== items[0].id,
    has_after: selected.length > 0 && selected.at(-1)!.id !== items.at(-1)!.id };
}
async function mountContinuous(count = 330, _varied = false, collapsed = false) {
  await page.viewport(1280, 900);
  const seed = thread({ thread_id: 'continuous-history', title: 'Continuous reading', messages: [] });
  const items: FlowerRuntimeCurrentItem[] = Array.from({ length: count }, (_, index) => ({
    id: 'entry-' + index, kind: 'assistant', turn_id: 'turn', run_id: 'run', ordinal: index + 1,
    text: collapsed ? 'Message ' + index : 'Message ' + index + '\n\nA readable paragraph for the continuous history viewport.', live: true,
  }));
  let version = 7;
  const events: FlowerLiveStreamEnvelope[] = [];
  let wake: (() => void) | undefined;
  const push = (value: FlowerLiveStreamEnvelope) => { events.push(value); wake?.(); };
  let afterSnapshot: ((revision: number) => void) | undefined;
  let pause: ReturnType<typeof deferred<void>> | undefined;
  let failure: unknown;
  let failureCount = 0;
  let responseHold: ReturnType<typeof deferred<void>> | undefined;
  let loseResponse = true;
  const releaseHistory = vi.fn(async () => undefined);
  const history = vi.fn(async (_id: string, request: FlowerHistoryRequest) => {
    if (failureCount > 0) { failureCount--; throw failure; }
    if (request.anchor_id && pause) { const pending = pause; pause = undefined; await pending.promise; }
    const selected = selectPage(items, request);
    const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, view_version: version, activity: 'active', run_progress: { phase: 'streaming' },
      turn_id: 'turn', run_id: 'run', turns: [], interactions: [], queue: [], items: selected,
      window: pageBounds(items, selected) };
    const callback = request.observer_id ? afterSnapshot : undefined; if (callback) afterSnapshot = undefined;
    if (responseHold && request.observer_id) {
      const hold = responseHold; responseHold = undefined;
      push({ schema_version: 3, kind: 'thread.batch', thread_id: seed.thread_id, reading_revision: request.reading_revision,
        current, window: current.window });
      await hold.promise;
      if (loseResponse) throw { code: 'transport' };
    }
    callback?.(request.reading_revision!);
    if (callback) await new Promise(resolve => setTimeout(resolve, 50));
    return { thread: applyFlowerRuntimeCurrentView(seed, current), current };
  });
  const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadHistory: history, releaseHistory,
    loadThread: async () => { throw new Error('Full thread reads are forbidden'); },
    async *connectLiveStream({ signal }) {
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'continuous-observer', summaries: [seed] };
      const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
      try { while (!signal.aborted) { const next = events.shift(); if (next) yield next; else await new Promise<void>(resolve => { wake = resolve; }); } }
      finally { signal.removeEventListener('abort', abort); }
    },
  }, { focusThreadRequest: { request_id: 'open-continuous', thread_id: seed.thread_id } });
  root.style.height = '780px';
  if (collapsed) {
    const style = document.createElement('style');
    style.textContent = '[data-flower-row-message-id]:not([data-flower-row-message-id="entry-' + (count - 1) + '"]) { display: none !important; }';
    root.append(style);
  }
  await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="entry-' + (count - 1) + '"]')));
  await new Promise(resolve => setTimeout(resolve, 300));
  const viewport = root.querySelector<HTMLDivElement>('.flower-chat-transcript')!;
  const scroll = (top: number, direction: number) => {
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: direction, bubbles: true }));
    viewport.scrollTop = top;
    viewport.dispatchEvent(new Event('scroll'));
  };
  const append = (index: number, suffix: string, revision: number) => {
    const before = items[index];
    const offset = new TextEncoder().encode(before.text!).length;
    items[index] = { ...before, text: before.text + suffix };
    const baseVersion = version++;
    push({ schema_version: 3, kind: 'thread.batch', thread_id: seed.thread_id, reading_revision: revision,
      update: { thread_id: seed.thread_id, turn_id: 'turn', run_id: 'run', base_version: baseVersion, view_version: version,
        facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
        items: [{ kind: 'append', item_id: before.id, append: { offset_bytes: offset, text: suffix } }] } });
  };
  return { root, history, releaseHistory, viewport, scroll, append, failNext(error: unknown, count = 1) { failure = error; failureCount = count; }, delayNextResponse() { loseResponse = false; const hold = deferred<void>(); responseHold = hold; return hold; }, loseNextResponse() { loseResponse = true; const hold = deferred<void>(); responseHold = hold; return hold; }, afterNextSnapshot(callback: (revision: number) => void) { afterSnapshot = callback; }, pauseNext() { const pending = deferred<void>(); pause = pending; return pending; } };
}

async function mountChild(count = 330, _varied = false) {
    await page.viewport(1280, 900);
    const summary = subagentSummary({ parent_thread_id: 'history-parent', thread_id: 'history-child', task_name: 'Reader' });
    const parent = thread({ thread_id: summary.parent_thread_id, subagents: [summary], messages: [{
      id: 'spawn-message', role: 'assistant', content: '', status: 'complete', created_at_ms: 100, turn_id: 'parent-turn',
      blocks: [activityTimeline({ thread_id: summary.parent_thread_id, turn_id: 'parent-turn', run_id: 'parent-run', items: [activityItem({
        item_id: 'spawn', tool_id: 'spawn', tool_name: 'subagents', renderer: 'subagent_operation', status: 'success',
        payload: { action: 'spawn', targets: [{ thread_id: summary.thread_id, task_name: summary.task_name, status: 'running' }], requested_count: 1 },
      })] })],
    }] });
    const base = subagentDetail({ summary });
    const items: FlowerRuntimeCurrentItem[] = Array.from({ length: count }, (_, index) => ({
      id: 'child-entry-' + index, kind: 'assistant', turn_id: base.current.turn_id!, run_id: base.current.run_id!, ordinal: index + 1,
      text: 'Child message ' + index + '\n\nA readable paragraph.', live: true,
    }));
    let version = 10;
    let failNext = false;
    let paused: ReturnType<typeof deferred<void>> | undefined;
    let onSnapshot: (() => void) | undefined;
    const events: FlowerLiveStreamEnvelope[] = [];
    let wake: (() => void) | undefined;
    const releaseHistory = vi.fn(async () => undefined);
    const loadChild = vi.fn(async (_parent: string, _child: string, request?: FlowerHistoryRequest) => {
      if (request?.anchor_id && paused) { const pending = paused; paused = undefined; await pending.promise; }
      if (failNext) { failNext = false; throw { code: 'transport' }; }
      const selected = selectPage(items, request);
      if (request?.observer_id && onSnapshot) { const callback = onSnapshot; onSnapshot = undefined; callback(); await new Promise(resolve => setTimeout(resolve, 50)); }
      return { ...base, current: { ...base.current, run_progress: { phase: 'streaming' as const }, view_version: version, items: selected },
        window: pageBounds(items, selected) };
    });
    const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [parent],
      loadHistory: async () => liveBootstrap(parent), loadSubagentDetail: loadChild, releaseHistory,
      async *connectLiveStream({ signal }) {
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'child-reader', summaries: [parent] };
        const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
        try { while (!signal.aborted) { const value = events.shift(); if (value) yield value; else await new Promise<void>(resolve => { wake = resolve; }); } }
        finally { signal.removeEventListener('abort', abort); }
      },
    }, { focusThreadRequest: { request_id: 'open-parent', thread_id: parent.thread_id } });
    root.style.height = '780px';
    await waitFor(() => Boolean(root.querySelector('[data-flower-subagent-capsule]')));
    root.querySelector<HTMLButtonElement>('[data-flower-subagent-capsule]')!.click();
    await waitFor(() => Boolean(document.querySelector('[data-flower-message-id="child-entry-' + (count - 1) + '"]')));
    await waitFor(() => document.querySelector('.flower-subagent-detail-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
    await new Promise(resolve => setTimeout(resolve, 300));
    const viewport = document.querySelector<HTMLDivElement>('.flower-subagent-detail-transcript')!;
    return { root, summary, parent, items, events, loadChild, releaseHistory, viewport,
      nextVersion: () => version++, wake: () => wake?.(), failNext: () => { failNext = true; },
      pauseNext: () => { paused = deferred<void>(); return paused; }, afterNextSnapshot: (callback: () => void) => { onSnapshot = callback; },
      scroll: (top: number, delta: number) => { viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true })); viewport.scrollTop = top; viewport.dispatchEvent(new Event('scroll')); },
    };
}

describe('continuous history navigation', () => {
  it('holds an ordered live baseline until its historical tool group is complete', async () => {
    await page.viewport(1280, 900);
    const seed = thread({ thread_id: 'atomic-history', messages: [] });
    const held = deferred<void>();
    const items: FlowerRuntimeCurrentItem[] = [
      { id: 'start', kind: 'user', text: 'Inspect files', turn_id: 'large', run_id: 'large-run', ordinal: 1 },
      ...Array.from({ length: 180 }, (_, i): FlowerRuntimeCurrentItem => ({ id: `call-${i}`, kind: 'tool', turn_id: 'large', run_id: 'large-run', ordinal: i + 2,
        activity: { item_id: `call-${i}`, tool_id: `call-${i}`, kind: 'tool', tool_name: 'terminal.exec', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
          presentation: { label: `Inspect file ${i}`, renderer: 'terminal', payload: { command: `echo ${i}`, output: 'Done' } } } })),
      { id: 'done', kind: 'assistant', text: 'Complete', turn_id: 'large', run_id: 'large-run', ordinal: 182 },
      { id: 'tail-user', kind: 'user', text: 'Another request', turn_id: 'tail', run_id: 'tail-run', ordinal: 183 },
      { id: 'tail-final', kind: 'assistant', text: 'Latest answer.\n\n'.repeat(80), turn_id: 'tail', run_id: 'tail-run', ordinal: 184 },
    ].map(value => ({ ...value, kind: value.kind as FlowerRuntimeCurrentItem['kind'], canonical_ordinal: value.ordinal }));
    const events: FlowerLiveStreamEnvelope[] = [];
    let wake: (() => void) | undefined;
    let first = true;
    let preparing = false;
    const history = vi.fn(async (_id: string, request: FlowerHistoryRequest) => {
      if (request.anchor_id && request.limit === 150) { preparing = true; await held.promise; }
      const selected = first ? items.slice(-2) : selectPage(items, request); first = false;
      const ids = new Set(selected.map(item => item.id));
      const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, activity: 'idle', view_version: 1, items: selected,
        window: { ...pageBounds(items, selected), leaf_id: 'leaf' },
        turns: ['large', 'tail'].filter(id => selected.some(item => item.turn_id === id)).map(id => ({
          turn_id: id, run_id: `${id}-run`, started_at: id === 'large' ? '2026-10-01T00:00:00Z' : '2026-10-02T00:00:00Z',
          ended_at: id === 'large' ? '2026-10-01T00:01:00Z' : '2026-10-02T00:01:00Z', outcome: 'completed', elapsed_ms: 60000, waiting_ms: 0, work_duration_ms: 60000,
          final_boundary_complete: true, final_item_ids: [id === 'large' ? 'done' : 'tail-final'].filter(id => ids.has(id)),
        })) };
      if (request.item_ids && request.observer_id) {
        events.push({ schema_version: 3, kind: 'thread.batch', thread_id: seed.thread_id, reading_revision: request.reading_revision, current, window: current.window });
        wake?.();
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return { current, thread: applyFlowerRuntimeCurrentView(seed, current) };
    });
    const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadHistory: history,
      async *connectLiveStream({ signal }) {
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'atomic-reader', summaries: [seed] };
        const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
        try { while (!signal.aborted) { const next = events.shift(); if (next) yield next; else await new Promise<void>(resolve => { wake = resolve; }); } }
        finally { signal.removeEventListener('abort', abort); }
      },
    }, { focusThreadRequest: { request_id: 'atomic', thread_id: seed.thread_id } });
    root.style.height = '780px';
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="tail-final"]')));
    await new Promise(resolve => setTimeout(resolve, 300));
    const retained = root.querySelector('[data-flower-message-id="tail-final"]');
    const viewport = root.querySelector<HTMLDivElement>('.flower-chat-transcript')!;
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -900, bubbles: true }));
    viewport.scrollTop = 0; viewport.dispatchEvent(new Event('scroll'));
    await waitFor(() => preparing);
    expect(root.querySelector('[data-flower-turn-id="large"]')).toBeNull();
    held.resolve();
    await waitFor(() => Boolean(root.querySelector('[data-flower-turn-id="large"] .flower-turn-summary-button')));
    const summary = root.querySelector<HTMLButtonElement>('[data-flower-turn-id="large"] .flower-turn-summary-button')!;
    summary.click();
    await waitFor(() => root.querySelector('.flower-tool-sequence-toggle')?.textContent?.includes('180 tool calls') === true);
    expect(root.querySelector('[data-flower-message-id="tail-final"]')).toBe(retained);
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });
  it('publishes a complete 680-call turn and retains its inspected rows on warm scrolling', async () => {
    await page.viewport(1280, 900);
    const seed = thread({ thread_id: 'complete-turn-history', messages: [] });
    const held = deferred<void>();
    const items: FlowerRuntimeCurrentItem[] = [
      { id: 'large-user', kind: 'user', text: 'Inspect the complete sequence.', turn_id: 'large', run_id: 'large-run', ordinal: 1 },
      ...Array.from({ length: 680 }, (_, i): FlowerRuntimeCurrentItem => ({ id: `tool-${i}`, kind: 'tool', turn_id: 'large', run_id: 'large-run', ordinal: i + 2,
        activity: { item_id: `tool-${i}`, tool_id: `tool-${i}`, kind: 'tool', tool_name: 'terminal.exec', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
          presentation: { label: `Inspect file ${i}`, renderer: 'terminal', payload: { command: `echo ${i}`, output: 'Complete result' } } } })),
      { id: 'pending-thought', kind: 'thinking', turn_id: 'large', run_id: 'large-run', ordinal: 682, text: 'Preview',
        body: { field: 'content', source_id: 'pending-thought', bytes: 8000, preview_bytes: 7 } },
      { id: 'large-final', kind: 'assistant', turn_id: 'large', run_id: 'large-run', ordinal: 683, text: 'Complete answer.' },
      { id: 'tail-user', kind: 'user', turn_id: 'tail', run_id: 'tail-run', ordinal: 684, text: 'Another request.' },
      { id: 'tail-answer', kind: 'assistant', turn_id: 'tail', run_id: 'tail-run', ordinal: 685, text: 'Latest answer.' },
    ].map(value => ({ ...value, kind: value.kind as FlowerRuntimeCurrentItem['kind'], canonical_ordinal: value.ordinal * 2 }));
    const history = vi.fn(async (_id: string, request: FlowerHistoryRequest) => {
      if (request.anchor_id) await held.promise;
      const selected = selectPage(items, request), ids = new Set(selected.map(item => item.id));
      const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, activity: 'idle', view_version: 1, items: selected,
        window: { ...pageBounds(items, selected), leaf_id: 'complete-leaf' },
        turns: ['large', 'tail'].filter(id => selected.some(item => item.turn_id === id)).map(id => ({
          turn_id: id, run_id: `${id}-run`, started_at: id === 'large' ? '2026-10-01T00:00:00Z' : '2026-10-02T00:00:00Z',
          ended_at: id === 'large' ? '2026-10-01T00:01:00Z' : '2026-10-02T00:01:00Z', outcome: 'completed',
          elapsed_ms: 60000, waiting_ms: 0, work_duration_ms: 60000, final_boundary_complete: true,
          final_item_ids: [id === 'large' ? 'large-final' : 'tail-answer'].filter(id => ids.has(id)),
        })) };
      return { current, thread: applyFlowerRuntimeCurrentView(seed, current) };
    });
    const body = vi.fn(async () => { throw new Error('Unopened thinking must not read its body'); });
    const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadHistory: history, loadHistoryItem: body,
      async *connectLiveStream({ signal }) {
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'complete-reader', summaries: [seed] };
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      },
    }, { focusThreadRequest: { request_id: 'complete-history', thread_id: seed.thread_id } });
    root.style.height = '780px';
    await waitFor(() => history.mock.calls.length >= 2);
    expect(root.querySelector('.flower-tool-sequence-label')).toBeNull();
    held.resolve();
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="tail-answer"]')));
    await waitFor(() => Boolean(root.querySelector('[data-flower-turn-id="large"] .flower-turn-summary-button')));
    const summary = root.querySelector<HTMLButtonElement>('[data-flower-turn-id="large"] .flower-turn-summary-button')!;
    summary.click();
    await waitFor(() => Boolean(root.querySelector('.flower-tool-sequence-toggle')));
    const group = root.querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
    expect(group.textContent).toContain('680 tool calls');
    expect(group.textContent).toContain('1 thinking segment');
    if (group.getAttribute('aria-expanded') === 'false') group.click();
    await waitFor(() => group.closest('.flower-tool-sequence-node')?.getAttribute('data-state') === 'open');
    const inspected = root.querySelector('[data-flower-activity-item-id="tool-679"]');
    expect(inspected).not.toBeNull();
    const viewport = root.querySelector<HTMLDivElement>('.flower-chat-transcript')!;
    const calls = history.mock.calls.length;
    for (let pass = 0; pass < 3; pass++) {
      viewport.scrollTop = 0; viewport.dispatchEvent(new Event('scroll'));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll'));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      expect(root.querySelector('.flower-tool-sequence-toggle')).toBe(group);
      expect(group.textContent).toContain('680 tool calls');
      expect(group.getAttribute('aria-expanded')).toBe('true');
      expect(root.querySelector('[data-flower-activity-item-id="tool-679"]')).toBe(inspected);
    }
    group.click();
    await waitFor(() => group.closest('.flower-tool-sequence-node')?.getAttribute('data-state') === 'closed');
    viewport.scrollTop = 0; viewport.dispatchEvent(new Event('scroll'));
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(group.getAttribute('aria-expanded')).toBe('false');
    expect(history.mock.calls.length).toBe(calls);
    expect(body).not.toHaveBeenCalled();
    expect(history.mock.calls.every(([, request]) => (request.limit ?? request.item_ids?.length ?? 150) <= 150)).toBe(true);
  });

  it('bounds collapsed history reads to scroll demand, including input at an immovable edge', async () => {
    const { root, history, viewport, scroll } = await mountContinuous(600, false, true);
    scroll(0, -100);
    await waitFor(() => history.mock.calls.length >= 3);
    await new Promise(resolve => setTimeout(resolve, 350));
    const firstCalls = history.mock.calls.length;
    expect(firstCalls).toBeLessThanOrEqual(5);
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(history.mock.calls.length).toBe(firstCalls);
    const first = history.mock.calls.at(-1)![1].item_ids![0];
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    await waitFor(() => history.mock.calls.length > firstCalls);
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(history.mock.calls.at(-1)![1].item_ids![0]).not.toBe(first);
    const settled = history.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(history.mock.calls.length).toBe(settled);
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });
  it('retains the currently visible tail when the reader moves during interest installation', async () => {
    const { root, history, viewport, scroll, afterNextSnapshot } = await mountContinuous();
    const tail = root.querySelector<HTMLElement>('[data-flower-message-id="entry-329"]')!;
    let top = 0;
    afterNextSnapshot(() => {
      scroll(viewport.scrollHeight, 100);
      top = tail.getBoundingClientRect().top;
    });
    scroll(400, -100);
    await waitFor(() => history.mock.calls.length >= 3);
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(tail.isConnected).toBe(true);
    expect(Math.abs(tail.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
    expect(root.querySelector('.flower-history-error')).toBeNull();
  });
  it('continues scrolling with a selected opposite edge and refills the retained gap', async () => {
    const { root, history, viewport, scroll } = await mountContinuous();
    const tail = root.querySelector<HTMLElement>('[data-flower-message-id="entry-329"]')!;
    const range = document.createRange(); range.selectNodeContents(tail);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    const selectedText = selection.toString();
    scroll(400, -100);
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="entry-150"]')));
    expect(tail.isConnected).toBe(true);
    expect(selection.toString()).toBe(selectedText);
    const gap = root.querySelector<HTMLElement>('[data-flower-history-gap]')!;
    expect(gap).not.toBeNull();
    expect(gap.getBoundingClientRect().height).toBeGreaterThan(0);
    const count = history.mock.calls.length;
    scroll(viewport.scrollTop + gap.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 100, 100);
    await waitFor(() => history.mock.calls.length > count && Boolean(root.querySelector('[data-flower-message-id="entry-315"]')));
    expect(tail.isConnected).toBe(true);
    expect(selection.toString()).toBe(selectedText);
    expect(root.querySelectorAll('[data-flower-message-id]').length).toBeLessThanOrEqual(150);
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
    selection.removeAllRanges();
  });
  it('preserves child selections while crossing and refilling a history gap', async () => {
    const { root, viewport, scroll, loadChild } = await mountChild();
    const tail = viewport.querySelector<HTMLElement>('[data-flower-message-id="child-entry-329"]')!;
    const range = document.createRange(); range.selectNodeContents(tail);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    const selectedText = selection.toString();
    scroll(400, -100);
    await waitFor(() => Boolean(viewport.querySelector('[data-flower-message-id="child-entry-150"]')));
    expect(tail.isConnected).toBe(true);
    expect(selection.toString()).toBe(selectedText);
    const gap = viewport.querySelector<HTMLElement>('[data-flower-history-gap]')!;
    expect(gap).not.toBeNull();
    const calls = loadChild.mock.calls.length;
    scroll(viewport.scrollTop + gap.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 100, 100);
    await waitFor(() => loadChild.mock.calls.length > calls && Boolean(viewport.querySelector('[data-flower-message-id="child-entry-315"]')));
    expect(tail.isConnected).toBe(true);
    expect(selection.toString()).toBe(selectedText);
    expect(viewport.querySelectorAll('[data-flower-message-id]').length).toBeLessThanOrEqual(150);
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
    selection.removeAllRanges();
  });
  it.each(['main', 'child'] as const)('seeks directly into a distant %s gap and stays at the reading position', async surface => {
    const main = surface === 'main' ? await mountContinuous(1000, true) : undefined;
    const child = surface === 'child' ? await mountChild(1000, true) : undefined;
    const { viewport, scroll } = (main ?? child)!;
    const history = main?.history ?? child!.loadChild;
    const request = (call: readonly unknown[]) => call[main ? 1 : 2] as FlowerHistoryRequest;
    const prefix = main ? 'entry-' : 'child-entry-';
    const tail = viewport.querySelector<HTMLElement>('[data-flower-message-id="' + prefix + '999"]')!;
    const range = document.createRange(); range.selectNodeContents(tail);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    const selectedText = selection.toString();
    for (let i = 0; i < 12; i++) {
      const calls = history.mock.calls.length;
      scroll(400, -100);
      await waitFor(() => history.mock.calls.length >= calls + 2);
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    const gap = viewport.querySelector<HTMLElement>('[data-flower-history-gap]')!;
    const first = Number(gap.dataset.flowerHistoryGapFirst), last = Number(gap.dataset.flowerHistoryGapLast);
    expect(last - first).toBeGreaterThan(200);
    const midpoint = Math.floor((first + last) / 2);
    const calls = history.mock.calls.length;
    scroll(viewport.scrollTop + gap.getBoundingClientRect().top - viewport.getBoundingClientRect().top + gap.getBoundingClientRect().height / 2, 100);
    const expectedTop = gap.getBoundingClientRect().top + (midpoint - first) / (last - first) * gap.getBoundingClientRect().height;
    const target = () => viewport.querySelector<HTMLElement>('[data-flower-row-message-id="' + prefix + (midpoint - 1) + '"]');
    await waitFor(() => Boolean(target()));
    await new Promise(resolve => setTimeout(resolve, 250));
    const requests = history.mock.calls.slice(calls).map(request);
    expect(requests.some(value => value.anchor_offset)).toBe(true);
    expect(requests.length).toBeLessThanOrEqual(4);
    expect(Math.abs(target()!.getBoundingClientRect().top - expectedTop)).toBeLessThanOrEqual(1);
    const settledCalls = history.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(history.mock.calls.length).toBe(settledCalls);
    expect(tail.isConnected).toBe(true);
    expect(selection.toString()).toBe(selectedText);
    expect(viewport.querySelectorAll('[data-flower-message-id]').length).toBeLessThanOrEqual(150);
    selection.removeAllRanges();
  });
  it('returns to a tail interest by scrolling and keeps receiving new items', async () => {
    const { root, history, viewport, scroll, append } = await mountContinuous();
    scroll(400, -100);
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="entry-150"]')));
    for (let i = 0; i < 8 && (history.mock.calls.at(-1)![1].anchor_id || history.mock.calls.at(-1)![1].item_ids); i++) {
      const count = history.mock.calls.length;
      scroll(viewport.scrollHeight, 100);
      await waitFor(() => history.mock.calls.length > count);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const request = history.mock.calls.at(-1)![1];
    expect(request.anchor_id).toBeUndefined();
    expect(request.direction).toBe('before');
    append(329, ' newest-live-output', request.reading_revision!);
    await waitFor(() => root.querySelector('[data-flower-message-id="entry-329"]')?.textContent?.includes('newest-live-output') === true);
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
    expect(root.querySelector('.flower-history-navigation')).toBeNull();
  });
  it('resumes an exhausted edge read on connection restoration without a paging click', async () => {
    const { root, history, scroll, failNext } = await mountContinuous();
    failNext({ code: 'transport' }, 1000);
    scroll(400, -100);
    await new Promise(resolve => setTimeout(resolve, 5000));
    expect(history.mock.calls.length).toBeLessThanOrEqual(10);
    const exhaustedCount = history.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 2500));
    expect(history.mock.calls.length).toBe(exhaustedCount);
    const anchor = root.querySelector('[data-flower-message-id="entry-184"]');
    failNext(undefined, 0);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="entry-150"]')));
    expect(anchor?.isConnected).toBe(true);
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  });
  it('retains a child tail when scrolling changes during interest installation', async () => {
    const { viewport, loadChild, scroll, afterNextSnapshot } = await mountChild();
    const tail = viewport.querySelector<HTMLElement>('[data-flower-message-id="child-entry-329"]')!;
    let top = 0;
    afterNextSnapshot(() => { scroll(viewport.scrollHeight, 100); top = tail.getBoundingClientRect().top; });
    scroll(350, -100);
    await waitFor(() => loadChild.mock.calls.length >= 3);
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(tail.isConnected).toBe(true);
    expect(Math.abs(tail.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
    expect(document.querySelector('.flower-subagent-detail-loading')).toBeNull();
  });
  it('rejects a page from an earlier visit after closing and reopening the same child', async () => {
    const { root, viewport, loadChild, scroll, pauseNext } = await mountChild();
    const pending = pauseNext();
    scroll(350, -100);
    await waitFor(() => loadChild.mock.calls.length === 2);
    const overlay = document.querySelector<HTMLElement>('.flower-subagent-detail-window')!;
    const close = [...overlay.querySelectorAll<HTMLButtonElement>('button')].find(button => /close/i.test(button.getAttribute('aria-label') ?? ''));
    expect(close).toBeDefined(); close!.click();
    root.querySelector<HTMLButtonElement>('[data-flower-subagent-capsule]')!.click();
    await waitFor(() => loadChild.mock.calls.length === 3);
    await waitFor(() => Boolean(document.querySelector('[data-flower-message-id="child-entry-329"]')));
    const tail = document.querySelector('[data-flower-message-id="child-entry-329"]');
    pending.resolve();
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(loadChild).toHaveBeenCalledTimes(3);
    expect(tail?.isConnected).toBe(true);
    expect(document.querySelector('[data-flower-message-id="child-entry-150"]')).toBeNull();
    expect(viewport.isConnected).toBe(false);
  });
  it('scrolls child history without controls while retaining live updates through a transient read failure', async () => {
    const { summary, parent, items, events, loadChild, releaseHistory, viewport, nextVersion, wake, failNext } = await mountChild();
    const firstRevision = loadChild.mock.calls[0][2]!.reading_revision!;
    const releases = releaseHistory.mock.calls.length;
    failNext();
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    viewport.scrollTop = 350; viewport.dispatchEvent(new Event('scroll'));
    await waitFor(() => loadChild.mock.calls.length >= 2);
    expect(releaseHistory.mock.calls.length).toBe(releases);
    const item = items[184];
    const offset = new TextEncoder().encode(item.text!).length;
    items[184] = { ...item, text: item.text + ' child-live-growth' };
    const baseVersion = nextVersion();
    events.push({ schema_version: 3, kind: 'thread.batch', thread_id: parent.thread_id, reading_revision: firstRevision, subagent_update: {
      thread_id: summary.thread_id, turn_id: item.turn_id, run_id: item.run_id, base_version: baseVersion, view_version: baseVersion + 1,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
      items: [{ kind: 'append', item_id: item.id, append: { offset_bytes: offset, text: ' child-live-growth' } }],
    } }); wake();
    await waitFor(() => viewport.querySelector('[data-flower-message-id="child-entry-184"]')?.textContent?.includes('child-live-growth') === true);
    const retained = viewport.querySelector('[data-flower-message-id="child-entry-184"]');
    await waitFor(() => loadChild.mock.calls.length >= 3 && Boolean(viewport.querySelector('[data-flower-message-id="child-entry-150"]')));
    expect(retained?.isConnected).toBe(true);
    expect(document.querySelector('.flower-history-navigation button')).toBeNull();
    expect(document.querySelector('[data-flower-scroll-to-latest]')).toBeNull();
  });
  it('accepts the ordered live baseline and growth even when its HTTP response is lost', async () => {
    const { root, history, scroll, append, loseNextResponse } = await mountContinuous();
    const hold = loseNextResponse();
    scroll(400, -100);
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="entry-150"]')));
    append(184, ' response-independent-growth', history.mock.calls.at(-1)![1].reading_revision!);
    await waitFor(() => root.querySelector('[data-flower-message-id="entry-184"]')?.textContent?.includes('response-independent-growth') === true);
    hold.resolve();
    await waitFor(() => history.mock.calls.length >= 3);
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  });
  it('keeps accepted live growth when its older HTTP baseline arrives later', async () => {
    const { root, history, scroll, append, delayNextResponse } = await mountContinuous();
    const hold = delayNextResponse();
    scroll(400, -100);
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="entry-150"]')));
    append(184, ' retained-after-http', history.mock.calls.at(-1)![1].reading_revision!);
    await waitFor(() => root.querySelector('[data-flower-message-id="entry-184"]')?.textContent?.includes('retained-after-http') === true);
    const retained = root.querySelector('[data-flower-message-id="entry-184"]');
    hold.resolve();
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(retained?.isConnected).toBe(true);
    expect(retained?.textContent).toContain('retained-after-http');
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
    expect(root.querySelector('.flower-history-error')).toBeNull();
    expect(history.mock.calls.length).toBe(3);
  });
  it('retains the installed interest while a transient page failure recovers', async () => {
    const { root, history, releaseHistory, scroll, append, failNext } = await mountContinuous();
    const firstRevision = history.mock.calls[0][1].reading_revision!;
    const releases = releaseHistory.mock.calls.length;
    failNext({ code: 'transport' });
    scroll(400, -100);
    await waitFor(() => history.mock.calls.length >= 2);
    expect(releaseHistory.mock.calls.length).toBe(releases);
    append(184, ' live-through-recovery', firstRevision);
    await waitFor(() => root.querySelector('[data-flower-message-id="entry-184"]')?.textContent?.includes('live-through-recovery') === true);
    await waitFor(() => history.mock.calls.length >= 3 && Boolean(root.querySelector('[data-flower-message-id="entry-150"]')));
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  });
  it('keeps the old interest live and accepts new-interest growth arriving before its baseline response', async () => {
    const { root, history, scroll, pauseNext, append, afterNextSnapshot } = await mountContinuous();
    const firstRevision = history.mock.calls[0][1].reading_revision!;
    const paused = pauseNext();
    scroll(400, -100);
    await waitFor(() => history.mock.calls.length === 2);
    append(184, ' old-interest-growth', firstRevision);
    await waitFor(() => root.querySelector('[data-flower-message-id="entry-184"]')?.textContent?.includes('old-interest-growth') === true);
    const row = root.querySelector('[data-flower-message-id="entry-184"]');
    afterNextSnapshot(revision => append(184, ' new-interest-growth', revision));
    paused.resolve();
    await waitFor(() => row?.textContent?.includes('new-interest-growth') === true);
    expect(row?.isConnected).toBe(true);
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
    expect(root.querySelector('.flower-thread-loading')).toBeNull();
  });

  it('reads earlier and later windows through scrolling while preserving overlapping DOM and position', async () => {
    const { root, history, viewport, scroll } = await mountContinuous();
    const anchor = root.querySelector<HTMLElement>('[data-flower-message-id="entry-183"]')!;
    scroll(viewport.scrollTop + anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top, -100);
    const top = anchor.getBoundingClientRect().top;
    await waitFor(() => history.mock.calls.length >= 2 && Boolean(root.querySelector('[data-flower-message-id="entry-150"]')));
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(anchor.isConnected).toBe(true);
    expect(Math.abs(anchor.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
    expect(root.querySelector('.flower-history-navigation button')).toBeNull();
    expect(root.querySelector('[data-flower-scroll-to-latest]')).toBeNull();
    scroll(viewport.scrollHeight - viewport.clientHeight - 100, 100);
    await waitFor(() => history.mock.calls.length >= 3);
    expect(history.mock.calls.at(-1)![1].item_ids?.length).toBeLessThanOrEqual(150);
    expect(root.querySelectorAll('[data-flower-message-id]').length).toBeLessThanOrEqual(150);
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  });

  it('services scrolling that continues while a page request is in flight', async () => {
    const { root, history, viewport, scroll, pauseNext } = await mountContinuous();
    const paused = pauseNext();
    scroll(400, -100);
    await waitFor(() => history.mock.calls.length === 2);
    scroll(0, -100);
    paused.resolve();
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="entry-150"]')));
    expect(root.querySelector('.flower-thread-loading')).toBeNull();
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
    expect(viewport.scrollTop).toBeGreaterThan(0);
  });
});
