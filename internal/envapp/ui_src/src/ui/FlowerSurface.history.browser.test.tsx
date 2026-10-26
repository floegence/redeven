import '../index.css';
import './flower-feature.css';
import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import type { FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView, FlowerHistoryRequest, FlowerLiveStreamEnvelope, FlowerSurfaceAdapter } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, deferred, disposeRenderedSurface, renderSurfaceWithAdapter, renderSurfaceWithAdapterProps, renderSurfaceWithDraftCoordinator, renderSurfaceWithFocusController, thread, waitFor } from './FlowerSurface.navigation.testHarness';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src';

function fixture(id: string, partial = false): FlowerRuntimeCurrentItem {
  return { id, kind: 'assistant', text: partial ? 'Preview text' : 'Older conversation', ordinal: id === 'latest' ? 2 : 1,
    turn_id: 'turn', run_id: 'run', ...(partial ? { body: { field: 'content', source_id: id, bytes: 28, preview_bytes: 12 } } : {}) };
}
async function mount(tool = false, pending = false, options: { count?: number; text?: string; fail?: boolean; kind?: 'user' | 'assistant'; live?: boolean; loadHistoryItem?: FlowerSurfaceAdapter['loadHistoryItem']; loadHistoryBody?: FlowerSurfaceAdapter['loadHistoryBody'] } = {}) {
  await page.viewport(1280, 900);
  const seed = thread({ thread_id: 'history', title: 'Bounded history', messages: [] });
  const peer = thread({ thread_id: 'peer', title: 'Another conversation' });
  const message = (id: string, partial = false): FlowerRuntimeCurrentItem => {
    const item = { ...fixture(id, partial), kind: options.kind ?? 'assistant', ...(options.live ? { live: true } : {}) };
    if (item.body && options.text) item.body = { ...item.body, bytes: new TextEncoder().encode(options.text).length };
    return options.live && item.body ? { ...item, body: { ...item.body, run_id: 'run' } } : item;
  };
  const body = vi.fn(options.loadHistoryItem ?? (async (_tid: string, _id: string, _signal: AbortSignal): Promise<FlowerRuntimeCurrentItem> => ({ ...message(_id), ...(options.count ? { ordinal: Number(_id) + 1 } : {}), text: options.text ?? 'Preview text expanded body!!' })));
  let complete!: (item: FlowerRuntimeCurrentItem) => void;
  if (pending) body.mockImplementationOnce(async () => new Promise<FlowerRuntimeCurrentItem>(resolve => { complete = resolve; }));
  if (options.fail) body.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'transport' }));
  const full = vi.fn(async () => { throw new Error('Full history must not be requested'); });
  const values: FlowerLiveStreamEnvelope[] = [{ schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'observer', summaries: [seed, peer] }];
  let wake: (() => void) | undefined;
  const history = vi.fn(async (id: string, request: FlowerHistoryRequest) => {
    const older = Boolean(request.anchor_id) && (request.direction === 'before' || request.direction === 'around');
    let item: FlowerRuntimeCurrentItem = tool ? { id: 'history-tool', kind: 'tool', ordinal: 1, turn_id: 'turn', run_id: 'run',
      activity_bodies: [{ entry_id: 'activity', bytes: 10000, sha256: 'hash' }],
      activity: { item_id: 'history-tool', tool_id: 'history-tool', tool_name: 'terminal.exec', kind: 'tool', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false } }
      : message(older ? 'old' : 'latest', !older);
    if (!tool && !older && options.text && item.body) item = { ...item, body: { ...item.body, bytes: new TextEncoder().encode(options.text).length } };
    const selected = request.item_ids ? request.item_ids.map(id => message(id, id === 'latest')) : [item];
    const current: FlowerRuntimeCurrentView = { thread_id: id, turn_id: 'turn', run_id: 'run', view_version: 7, activity: options.live ? 'active' : 'idle', ...(options.live ? { run_progress: { phase: 'streaming' as const } } : { last_outcome: 'completed' as const }),
      items: options.count ? Array.from({ length: options.count }, (_, index) => ({ ...message(String(index), true), ordinal: index + 1 })) : selected, turns: [], interactions: [], queue: [], window: { first_item_id: options.count ? '0' : selected[0]?.id, last_item_id: options.count ? String(options.count - 1) : selected.at(-1)?.id, has_before: !options.count && selected[0]?.id !== 'old', has_after: !options.count && selected.at(-1)?.id !== 'latest' } };
    return { thread: applyFlowerRuntimeCurrentView(id === 'peer' ? peer : seed, current), current };
  });
  const rename = vi.fn(async (id: string, title: string) => {
    const receipt = await history(id, {});
    return { ...receipt, thread: { ...receipt.thread, title, title_status: 'ready' as const, title_generation: 2 } };
  });
  const root = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [seed, peer]), loadThread: full, loadHistory: history, loadHistoryItem: body, loadHistoryBody: options.loadHistoryBody, renameThread: rename,
    async *connectLiveStream({ signal }) {
      const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
      try { while (!signal.aborted) { const next = values.shift(); if (next) yield next; else await new Promise<void>(resolve => { wake = resolve; }); } }
      finally { signal.removeEventListener('abort', abort); }
    },
  });
  root.style.height = '780px';
  await waitFor(() => Boolean(root.querySelector('[data-thread-id="history"] button')));
  root.querySelector<HTMLButtonElement>('[data-thread-id="history"] button')!.click();
  await waitFor(() => Boolean(root.querySelector(tool ? '[data-flower-activity-item-id]' : '.flower-history-message')));
  return { root, history, body, full, rename, complete: (item: FlowerRuntimeCurrentItem) => complete(item), push(value: FlowerLiveStreamEnvelope) { values.push(value); wake?.(); } };
}

describe('bounded Flower history', () => {
  it('reveals newly visited historical Markdown once, fully formatted and without height motion', async () => {
    const prefix = 'Preview text';
    const middle = [' table follows.', '', '| Item | Value |', '| --- | --- |', '| A | 1 |', '', '```ts', 'const ready = true;', ''].join(String.fromCharCode(10));
    const ending = ['```', '', '- Complete list', '', 'Settled final paragraph.'].join(String.fromCharCode(10));
    const text = prefix + middle + ending;
    const first = deferred<void>();
    const last = deferred<void>();
    const incremental = vi.fn<NonNullable<FlowerSurfaceAdapter['loadHistoryBody']>>(async (_tid, input) => {
      if (input.item_id === '0') await (input.offset_bytes === prefix.length ? first.promise : last.promise);
      const end = input.item_id === '0' && input.offset_bytes === prefix.length ? prefix.length + middle.length : text.length;
      return { ...input, thread_id: 'history', bytes: text.length, text: text.slice(input.offset_bytes, end) };
    });
    const { root } = await mount(false, false, { count: 44, text, loadHistoryBody: incremental });
    const viewport = root.querySelector<HTMLDivElement>('.flower-chat-transcript')!;
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
    viewport.scrollTop = 0; viewport.dispatchEvent(new Event('scroll'));
    await waitFor(() => incremental.mock.calls.some(call => call[1].item_id === '0'));
    const row = root.querySelector<HTMLElement>('[data-flower-message-id="0"]')!;
    expect(row.querySelector('.flower-history-text-loading')).not.toBeNull();
    first.resolve();
    await waitFor(() => incremental.mock.calls.some(call => call[1].item_id === '0' && call[1].offset_bytes > prefix.length));
    expect(row.querySelector('.flower-history-text-loading')).not.toBeNull();
    expect(row.querySelector('table, pre')).toBeNull();
    const frames: { top: number; height: number; tables: number; code: string; lists: number; text: string }[] = [];
    let sampling = true;
    const sample = () => {
      if (!sampling) return;
      if (!row.querySelector('.flower-history-text-loading')) {
        const rect = row.getBoundingClientRect();
        frames.push({ top: rect.top, height: rect.height, tables: row.querySelectorAll('table').length,
          code: row.querySelector('pre code')?.textContent ?? '', lists: row.querySelectorAll('li').length, text: row.textContent ?? '' });
      }
      requestAnimationFrame(() => setTimeout(sample, 0));
    };
    sample(); last.resolve();
    try {
      await waitFor(() => frames.length >= 20);
      const settled = frames[0];
      expect(settled.tables).toBe(1); expect(settled.lists).toBe(1);
      expect(settled.code).toContain('const ready = true;');
      expect(settled.text).toContain('Settled final paragraph.');
      expect(frames.every(frame => Math.abs(frame.top - settled.top) <= 1 && Math.abs(frame.height - settled.height) <= 1
        && frame.tables === settled.tables && frame.code === settled.code && frame.lists === settled.lists && frame.text === settled.text)).toBe(true);
      expect(row.getAnimations({ subtree: true })).toHaveLength(0);
    } finally { sampling = false; }
  });

  it('releases every observed node after live body hydration and disposal', async () => {
    const NativeObserver = globalThis.IntersectionObserver;
    const observed = new Map<IntersectionObserver, Set<Element>>();
    class TrackedObserver extends NativeObserver {
      observe(node: Element) { let nodes = observed.get(this); if (!nodes) observed.set(this, nodes = new Set()); nodes.add(node); super.observe(node); }
      unobserve(node: Element) { observed.get(this)?.delete(node); super.unobserve(node); }
      disconnect() { observed.delete(this); super.disconnect(); }
    }
    vi.stubGlobal('IntersectionObserver', TrackedObserver);
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        const { root, body, push, history } = await mount(false, false, { live: true });
        await waitFor(() => body.mock.calls.length > 0);
        const terminal: FlowerRuntimeCurrentView = { thread_id: 'history', turn_id: 'turn', run_id: 'run', view_version: 8, activity: 'idle', last_outcome: 'completed', items: [{ ...fixture('latest'), text: 'Finished output' }], turns: [], interactions: [], queue: [], window: { first_item_id: 'latest', last_item_id: 'latest', has_before: true, has_after: false } };
        const snapshot = applyFlowerRuntimeCurrentView(thread({ thread_id: 'history', title: 'Bounded history', messages: [] }), terminal);
        const readingRevision = history.mock.calls.at(-1)![1].reading_revision;
        history.mockResolvedValue({ thread: snapshot, current: terminal });
        push({ schema_version: 3, kind: 'summary.batch', summaries: [snapshot] });
        push({ schema_version: 3, kind: 'thread.batch', thread_id: 'history', reading_revision: readingRevision, update: {
          thread_id: 'history', base_version: 7, view_version: 8, turn_id: 'turn', run_id: 'run',
          facts: { activity: 'idle', attention: { input_count: 0, approval_count: 0 }, queue_count: 0, last_outcome: 'completed' },
          items: [{ kind: 'replace', item_id: 'latest', item: { ...fixture('latest'), text: 'Finished output' } }],
        } });
        await waitFor(() => root.textContent?.includes('Finished output') === true);
        disposeRenderedSurface(root);
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(root.querySelector('.flower-composer')).toBeNull();
        expect([...observed.values()].flatMap(nodes => [...nodes]).map(node => node.outerHTML.slice(0, 150))).toEqual([]);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('rebinds bounded history once after reconnect while retaining the transcript and draft', async () => {
    const seed = thread({ thread_id: 'rebind-history', title: 'Reconnect history', messages: [] });
    const disconnect = deferred<void>();
    const ready = deferred<void>();
    let attempts = 0;
    const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, turn_id: 'turn', run_id: 'run', view_version: 7,
      activity: 'idle', last_outcome: 'completed', items: [fixture('latest')], turns: [], interactions: [], queue: [],
      window: { first_item_id: 'latest', last_item_id: 'latest', has_before: false, has_after: false } };
    const history = vi.fn(async (_id: string, _request: FlowerHistoryRequest) => ({ thread: applyFlowerRuntimeCurrentView(seed, current), current }));
    const root = renderSurfaceWithAdapterProps({ ...adapter(true), loadHistory: history, listThreads: async () => [seed],
      async *connectLiveStream({ signal }) {
        const attempt = ++attempts;
        if (attempt > 1) await ready.promise;
        if (signal.aborted) return;
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'observer-' + attempt, summaries: [seed] };
        if (attempt === 1) { await disconnect.promise; return; }
        if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      },
    }, { focusThreadRequest: { request_id: 'open-rebind', thread_id: seed.thread_id } });
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="latest"]')));
    const bubble = root.querySelector('.flower-history-message .flower-message-bubble');
    const editor = root.querySelector<HTMLTextAreaElement>('textarea')!;
    editor.value = 'Preserve this unsent draft';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    disconnect.resolve();
    await waitFor(() => attempts === 2);
    expect(history).toHaveBeenCalledOnce();
    expect(root.querySelector('.flower-history-message .flower-message-bubble')).toBe(bubble);
    expect(root.querySelector('.flower-thread-loading')).toBeNull();
    ready.resolve();
    await waitFor(() => history.mock.calls.length === 2);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(history).toHaveBeenCalledTimes(2);
    expect(history.mock.calls[1][1]).toMatchObject({ observer_id: 'observer-2', reading_revision: expect.any(Number) });
    expect(root.querySelector('.flower-history-message .flower-message-bubble')).toBe(bubble);
    expect(root.querySelector('textarea')).toBe(editor);
    expect(editor.value).toBe('Preserve this unsent draft');
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  });

  it('releases pre-handshake navigation demand when another thread or disposal supersedes it', async () => {
    const seeds = ['a', 'b'].map(id => thread({ thread_id: 'waiting-' + id, messages: [] }));
    const ready = deferred<void>();
    const history = vi.fn(async (id: string) => {
      const current: FlowerRuntimeCurrentView = { thread_id: id, view_version: 1, activity: 'idle',
        items: [{ ...fixture('latest'), id: id + '-message' }], turns: [], interactions: [], queue: [] };
      return { thread: applyFlowerRuntimeCurrentView(seeds.find(seed => seed.thread_id === id)!, current), current };
    });
    const configured = { ...adapter(true), loadHistory: history, listThreads: async () => seeds,
      async *connectLiveStream({ signal }: { signal: AbortSignal }): AsyncIterable<FlowerLiveStreamEnvelope> {
        await ready.promise;
        if (signal.aborted) return;
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'wait-observer', summaries: seeds };
        if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      },
    };
    const control = renderSurfaceWithFocusController(configured, { request_id: 'wait-a', thread_id: seeds[0].thread_id });
    await waitFor(() => control.runtime.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === seeds[0].thread_id);
    control.setFocusThreadRequest({ request_id: 'wait-b', thread_id: seeds[1].thread_id });
    await waitFor(() => control.runtime.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === seeds[1].thread_id);
    const drafts = createFlowerComposerDraftCoordinator();
    const disposed = renderSurfaceWithDraftCoordinator(configured, drafts, { focusThreadRequest: { request_id: 'dispose-a', thread_id: seeds[0].thread_id } });
    await waitFor(() => disposed.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === seeds[0].thread_id);
    disposeRenderedSurface(disposed); drafts.dispose();
    expect(history).not.toHaveBeenCalled();
    ready.resolve();
    await waitFor(() => Boolean(control.runtime.querySelector('[data-flower-message-id="waiting-b-message"]')));
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(history).toHaveBeenCalledOnce();
    expect(history.mock.calls[0][0]).toBe(seeds[1].thread_id);
  });

  it('opens a deep link with one observer-bound history read after a delayed live handshake', async () => {
    const seed = thread({ thread_id: 'deep-history', title: 'Direct history', messages: [] });
    const ready = deferred<void>();
    const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, turn_id: 'turn', run_id: 'run', view_version: 7,
      activity: 'idle', last_outcome: 'completed', items: [fixture('latest')], turns: [], interactions: [], queue: [],
      window: { first_item_id: 'latest', last_item_id: 'latest', has_before: false, has_after: false } };
    const history = vi.fn(async (_id: string, _request: FlowerHistoryRequest) => ({ thread: applyFlowerRuntimeCurrentView(seed, current), current }));
    const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadHistory: history,
      async *connectLiveStream({ signal }) {
        await ready.promise;
        if (signal.aborted) return;
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'deep-observer', summaries: [seed] };
        if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      },
    }, { focusThreadRequest: { request_id: 'open-deep-history', thread_id: seed.thread_id } });
    await waitFor(() => root.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === seed.thread_id);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(history).not.toHaveBeenCalled();
    ready.resolve();
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="latest"]')));
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(history).toHaveBeenCalledOnce();
    expect(history.mock.calls[0][1]).toMatchObject({ observer_id: 'deep-observer', reading_revision: expect.any(Number) });
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  });

  it('satisfies a newer baseline received during the initial history request without fetching twice', async () => {
    const seed = thread({ thread_id: 'baseline-history', title: 'Delayed baseline', messages: [], updated_at_ms: 1 });
    const latest = thread({ ...seed, updated_at_ms: 10, read_status: { is_unread: false, snapshot: { activity_revision: 10 }, read_state: { last_seen_activity_revision: 10 } } });
    const complete = deferred<void>();
    const baseline = deferred<void>();
    const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, turn_id: 'turn', run_id: 'run', view_version: 7,
      activity: 'idle', last_outcome: 'completed', items: [fixture('latest')], turns: [], interactions: [], queue: [],
      window: { first_item_id: 'latest', last_item_id: 'latest', has_before: false, has_after: false } };
    const history = vi.fn(async () => { await complete.promise; return { thread: applyFlowerRuntimeCurrentView(latest, current), current }; });
    const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadHistory: history,
      async *connectLiveStream({ signal }) {
        yield { schema_version: 3, kind: 'ready', baseline_complete: false, observer_id: 'baseline-observer', summaries: [seed] };
        await baseline.promise;
        if (signal.aborted) return;
        yield { schema_version: 3, kind: 'summary.batch', baseline_complete: true, summaries: [latest] };
        if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      },
    }, { focusThreadRequest: { request_id: 'open-baseline-history', thread_id: seed.thread_id } });
    await waitFor(() => history.mock.calls.length === 1);
    baseline.resolve();
    await new Promise(resolve => setTimeout(resolve, 100));
    complete.resolve();
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="latest"]')));
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(history).toHaveBeenCalledOnce();
  });

  it('recovers one invalidated window without clearing content or looping on repeated pressure', async () => {
    const { root, history, push } = await mount();
    await waitFor(() => root.textContent?.includes('Preview text expanded body!!') === true);
    const bubble = root.querySelector('.flower-history-message .flower-message-bubble');
    const calls = history.mock.calls.length;
    const invalidate = () => push({ schema_version: 3, kind: 'thread.batch', thread_id: 'history', reading_revision: history.mock.calls.at(-1)![1].reading_revision, history_invalidated: { thread_id: 'history' } });
    invalidate();
    await waitFor(() => history.mock.calls.length === calls + 1);
    expect(root.querySelector('.flower-thread-loading')).toBeNull();
    expect(root.querySelector('.flower-history-message .flower-message-bubble')).toBe(bubble);
    invalidate();
    await waitFor(() => Boolean(root.querySelector('.flower-thread-sync-error')));
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(history.mock.calls.length).toBe(calls + 1);
    expect(root.querySelector('.flower-workspace-sync')).toBeNull();
    root.querySelector<HTMLButtonElement>('.flower-thread-sync-error button')!.click();
    await waitFor(() => history.mock.calls.length === calls + 2);
  });

  it('keeps visible live prose through slow reads, burst growth, and canonical completion', async () => {
    let finish!: (text: string) => void;
    const incremental = vi.fn<NonNullable<FlowerSurfaceAdapter['loadHistoryBody']>>(async (_tid, input) => ({ thread_id: 'history', bytes: input.through_bytes, ...input, text: await new Promise<string>(resolve => { finish = resolve; }) }));
    const { root, body, push, history } = await mount(false, false, { live: true, loadHistoryBody: incremental });
    await waitFor(() => incremental.mock.calls.length === 1);
    const bubble = root.querySelector('.flower-history-message .flower-message-bubble')!;
    expect(bubble.textContent).toContain('Preview text');
    expect(root.querySelector('.flower-history-text-loading')).toBeNull();
    let version = 7;
    const readingRevision = history.mock.calls.at(-1)![1].reading_revision;
    const grow = (bytes: number) => push({ schema_version: 3, kind: 'thread.batch', thread_id: 'history', reading_revision: readingRevision, update: { thread_id: 'history', turn_id: 'turn', run_id: 'run', base_version: version++, view_version: version, facts: { activity: 'active', attention: {}, queue_count: 0, run_progress: { phase: 'streaming' } }, items: [{ kind: 'body', item_id: 'latest', body: { field: 'content', source_id: 'latest', run_id: 'run', bytes, preview_bytes: 12 } }] } });
    for (let bytes = 29; bytes <= 128; bytes++) grow(bytes);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(incremental).toHaveBeenCalledOnce();
    expect(incremental.mock.calls[0][2].aborted).toBe(false);
    finish('x'.repeat(16));
    await waitFor(() => incremental.mock.calls.length === 2);
    expect(incremental.mock.calls[1][1]).toMatchObject({ offset_bytes: 28, through_bytes: 128 });
    expect(bubble.textContent).toContain('Preview text' + 'x'.repeat(16));
    expect(root.querySelector('.flower-history-message .flower-message-bubble')).toBe(bubble);
    finish('y'.repeat(100));
    await waitFor(() => bubble.textContent?.includes('y'.repeat(100)) === true);
    const text = 'Preview text' + 'x'.repeat(16) + 'y'.repeat(100);
    const canonical = { ...fixture('latest', true), body: { field: 'content', source_id: 'latest', bytes: 128, preview_bytes: 12 } };
    const terminal: FlowerRuntimeCurrentView = { thread_id: 'history', turn_id: 'turn', run_id: 'run', view_version: version + 1, activity: 'idle', last_outcome: 'completed', items: [canonical], turns: [], interactions: [], queue: [], window: { first_item_id: 'latest', last_item_id: 'latest', has_before: true, has_after: false } };
    const snapshot = applyFlowerRuntimeCurrentView(thread({ thread_id: 'history', title: 'Bounded history', messages: [] }), terminal);
    history.mockResolvedValue({ thread: snapshot, current: terminal });
    push({ schema_version: 3, kind: 'summary.batch', summaries: [snapshot] });
    push({ schema_version: 3, kind: 'thread.batch', thread_id: 'history', reading_revision: readingRevision, update: { thread_id: 'history', turn_id: 'turn', run_id: 'run', base_version: version++, view_version: version, facts: { activity: 'idle', attention: {}, queue_count: 0, last_outcome: 'completed' }, items: [{ kind: 'replace', item_id: 'latest', item: canonical }] } });
    await waitFor(() => incremental.mock.calls.length === 3);
    expect(incremental.mock.calls[2][1]).toMatchObject({ item_id: 'latest', offset_bytes: 12, through_bytes: 128 });
    expect(body).not.toHaveBeenCalled();
    expect(bubble.textContent).toContain(text);
    expect(root.querySelector('.flower-history-text-loading')).toBeNull();
    finish(text.slice(12));
    await waitFor(() => !root.querySelector('.flower-history-body-control'));
    expect(root.querySelector('.flower-history-message .flower-message-bubble')).toBe(bubble);
    expect(incremental).toHaveBeenCalledTimes(3);
  });
  it.each([false, true])('replaces live prose from the canonical preview without reusing its offset (refresh=%s)', async (refresh) => {
    const canonicalText = 'Preview text ' + 'Confirmed complete answer. '.repeat(30);
    const liveText = 'Preview text ' + 'Draft output that will change. '.repeat(35);
    let source = liveText;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const incremental = vi.fn<NonNullable<FlowerSurfaceAdapter['loadHistoryBody']>>(async (_tid, input) => {
      if (input.offset_bytes > input.through_bytes) throw Object.assign(new Error('invalid thread query'), { status: 400 });
      if (!input.run_id) await held;
      return { thread_id: 'history', bytes: new TextEncoder().encode(source).length, ...input, text: source.slice(input.offset_bytes, input.through_bytes) };
    });
    const { root, push, history, body, rename } = await mount(false, false, { live: true, text: liveText, loadHistoryBody: incremental });
    await waitFor(() => root.textContent?.includes(liveText) === true);
    const bubble = root.querySelector('.flower-history-message .flower-message-bubble');
    const viewport = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    const priorHeight = bubble!.getBoundingClientRect().height;
    const canonical = { ...fixture('latest', true), canonical_ordinal: 4,
      body: { field: 'content', source_id: 'latest', bytes: canonicalText.length, preview_bytes: 12 } };
    const terminal: FlowerRuntimeCurrentView = { thread_id: 'history', turn_id: 'turn', run_id: 'run', view_version: 8, activity: 'idle', last_outcome: 'completed', items: [canonical], turns: [], interactions: [], queue: [], window: { first_item_id: 'latest', last_item_id: 'latest', has_before: false, has_after: false } };
    const snapshot = applyFlowerRuntimeCurrentView(thread({ thread_id: 'history', title: 'Bounded history', messages: [] }), terminal);
    const revision = history.mock.calls.at(-1)![1].reading_revision;
    history.mockResolvedValue({ thread: snapshot, current: terminal });
    source = canonicalText;
    push({ schema_version: 3, kind: 'summary.batch', summaries: [snapshot] });
    if (refresh) {
      await page.getByRole('button', { name: 'Rename conversation' }).click();
      const input = root.querySelector<HTMLInputElement>('.flower-chat-header-title-input')!;
      input.value = 'Updated'; input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await waitFor(() => rename.mock.calls.length === 1);
    } else {
      push({ schema_version: 3, kind: 'thread.batch', thread_id: 'history', reading_revision: revision, update: { thread_id: 'history', turn_id: 'turn', run_id: 'run', base_version: 7, view_version: 8, facts: { activity: 'idle', attention: {}, queue_count: 0, last_outcome: 'completed' }, items: [{ kind: 'replace', item_id: 'latest', item: canonical }] } });
    }
    await waitFor(() => incremental.mock.calls.some(call => !call[1].run_id));
    expect(incremental.mock.calls.at(-1)![1].offset_bytes).toBe(12);
    expect(root.querySelector('.flower-history-message .flower-message-bubble')).toBe(bubble);
    expect(root.textContent).toContain(liveText);
    expect(bubble!.getBoundingClientRect().height).toBe(priorHeight);
    release();
    await waitFor(() => root.textContent?.includes(canonicalText) === true);
    expect(root.textContent).not.toContain(liveText);
    expect(root.querySelector('.flower-history-body-control')).toBeNull();
    expect(body).not.toHaveBeenCalled();
    const reads = incremental.mock.calls.length;
    viewport.scrollTop = 0; viewport.dispatchEvent(new Event('scroll'));
    await new Promise(resolve => setTimeout(resolve, 100));
    viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll'));
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(incremental.mock.calls.length).toBe(reads);
  });

  it('cancels obsolete live body reads when the canonical source is sealed', async () => {
    const incremental = vi.fn<NonNullable<FlowerSurfaceAdapter['loadHistoryBody']>>(async (_tid, input, signal) => {
      if (input.run_id) return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      return { thread_id: 'history', bytes: input.through_bytes, ...input, text: ' sealed content.' };
    });
    const { root, push, history } = await mount(false, false, { live: true, loadHistoryBody: incremental });
    await waitFor(() => incremental.mock.calls.length === 1);
    const signal = incremental.mock.calls[0][2];
    const canonical = { ...fixture('latest', true), body: { field: 'content', source_id: 'latest', entry_id: 'sealed-entry', bytes: 28, preview_bytes: 12 } };
    const terminal: FlowerRuntimeCurrentView = { thread_id: 'history', turn_id: 'turn', run_id: 'run', view_version: 8, activity: 'idle', last_outcome: 'completed', items: [canonical], turns: [], interactions: [], queue: [], window: { first_item_id: 'latest', last_item_id: 'latest', has_before: true, has_after: false } };
    const snapshot = applyFlowerRuntimeCurrentView(thread({ thread_id: 'history', title: 'Bounded history', messages: [] }), terminal);
    const readingRevision = history.mock.calls.at(-1)![1].reading_revision;
    history.mockResolvedValue({ thread: snapshot, current: terminal });
    push({ schema_version: 3, kind: 'summary.batch', summaries: [snapshot] });
    push({ schema_version: 3, kind: 'thread.batch', thread_id: 'history', reading_revision: readingRevision, update: { thread_id: 'history', turn_id: 'turn', run_id: 'run', base_version: 7, view_version: 8, facts: { activity: 'idle', attention: {}, queue_count: 0, last_outcome: 'completed' }, items: [{ kind: 'replace', item_id: 'latest', item: canonical }] } });
    await waitFor(() => root.textContent?.includes('Preview text sealed content.') === true);
    expect(signal.aborted).toBe(true);
    expect(incremental).toHaveBeenCalledTimes(2);
    expect(incremental.mock.calls[1][1]).toMatchObject({ entry_id: 'sealed-entry', offset_bytes: 12 });
    expect(root.querySelector('.flower-history-body-control')).toBeNull();
  });

  it('keeps user loading placeholders and hydrated text aligned to the transcript right edge', async () => {
    const text = 'Preview text ' + 'Review the complete historical request and preserve its references. '.repeat(8);
    const { root, body, complete } = await mount(false, true, { kind: 'user', text });
    await waitFor(() => body.mock.calls.length === 1);
    const row = root.querySelector<HTMLElement>('.flower-message-row-user')!;
    const shell = row.querySelector('.flower-history-message')!;
    const right = row.getBoundingClientRect().right;
    const loading = row.querySelector('.flower-history-text-loading')!;
    expect(Math.abs(loading.getBoundingClientRect().right - right)).toBeLessThanOrEqual(1);
    complete({ ...fixture('latest'), kind: 'user', text });
    await waitFor(() => !row.querySelector('.flower-history-text-loading'));
    const bubble = row.querySelector<HTMLElement>('.flower-message-bubble-user')!;
    expect(row.querySelector('.flower-history-message')).toBe(shell);
    expect(bubble.textContent?.trim()).toBe(text.trim());
    expect(Math.abs(bubble.getBoundingClientRect().right - right)).toBeLessThanOrEqual(1);
    expect(bubble.getBoundingClientRect().width).toBeCloseTo(row.getBoundingClientRect().width * 0.78, 0);
    expect(bubble.scrollWidth).toBeLessThanOrEqual(bubble.clientWidth + 1);
  });

  it('keeps tool output off the wire until disclosure, retries failures, and retains expanded content', async () => {
    const { root, body } = await mount(true);
    body.mockImplementationOnce(async () => { throw Object.assign(new Error('offline'), { code: 'transport' }); });
    body.mockImplementation(async () => ({ id: 'history-tool', kind: 'tool', ordinal: 1, turn_id: 'turn', run_id: 'run',
      activity: { item_id: 'history-tool', tool_id: 'history-tool', tool_name: 'terminal.exec', kind: 'tool', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
        presentation: { label: 'Inspect', renderer: 'terminal', payload: { operation: 'exec', command: 'inspect', output: 'Explicitly requested tool output', status: 'success' } } } }));
    expect(body).not.toHaveBeenCalled();
    const toggle = () => root.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="history-tool"] .flower-activity-inline-button')!;
    toggle().click();
    expect(root.querySelector('.flower-history-body-control button')).toBeNull();
    await waitFor(() => root.textContent?.includes('Explicitly requested tool output') === true);
    expect(body).toHaveBeenCalledTimes(2);
    toggle().click(); toggle().click();
    expect(body).toHaveBeenCalledTimes(2);
  });

  it('automatically renders complete long Markdown and HTML without an expansion action', async () => {
    const text = 'Preview text **expanded body** and `inline code`\n\n## Complete report\n\n'
      + 'Paragraph with retained context.\n\n'.repeat(1000)
      + '\n~~~html\n<!doctype html><html><body><h1>Report preview</h1></body></html>\n~~~\n\nFinal report section';
    const { root, full, body, history } = await mount(false, false, { text });
    expect(full).not.toHaveBeenCalled();
    expect(history.mock.calls.at(-1)![1]).toMatchObject({ observer_id: 'observer' });
    await waitFor(() => root.querySelector('strong')?.textContent === 'expanded body');
    expect(root.textContent).toContain('Final report section');
    expect(root.querySelector('code')?.textContent).toBe('inline code');
    expect(root.querySelector('.flower-history-text-loading')).toBeNull();
    expect(root.querySelector('.flower-history-body-control')).toBeNull();
    expect(root.querySelector('.flower-history-text-preview')).toBeNull();
    expect(body).toHaveBeenCalledTimes(1);
    await page.screenshot({ element: root, path: '__screenshots__/flower-history-readable.png' });
  });

  it('loads only visible messages with two concurrent requests in a 44-item page', async () => {
    const { root, body } = await mount(false, false, { count: 44,
      loadHistoryItem: async (_tid, _id, signal) => new Promise<FlowerRuntimeCurrentItem>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    });
    await waitFor(() => body.mock.calls.length >= 2);
    await new Promise(resolve => setTimeout(resolve, 150));
    const active = () => body.mock.calls.filter(call => !call[2].aborted);
    expect(active()).toHaveLength(2);
    expect(body.mock.calls.length).toBeLessThan(10);
    expect(root.querySelectorAll('.flower-history-text-loading')).toHaveLength(44);
    const viewport = root.querySelector<HTMLDivElement>('.flower-chat-transcript')!;
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event('scroll'));
    await waitFor(() => body.mock.calls.some(call => call[1] === '0'));
    expect(active().length).toBeLessThanOrEqual(2);
    expect(body.mock.calls.some(call => call[1] === '20')).toBe(false);
  });

  it('preserves the visible reading position when a message above it finishes loading', async () => {
    const { root, body } = await mount(false, true, { count: 44 });
    const reads = new Map<string, (item: FlowerRuntimeCurrentItem) => void>();
    body.mockImplementation(async (_tid, id, signal) => new Promise<FlowerRuntimeCurrentItem>((resolve, reject) => {
      reads.set(id, resolve);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    await waitFor(() => body.mock.calls.length >= 2);
    const viewport = root.querySelector<HTMLDivElement>('.flower-chat-transcript')!;
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event('scroll'));
    await waitFor(() => reads.has('0'));
    const firstMessage = root.querySelector<HTMLElement>('[data-flower-message-id="0"]')!;
    viewport.scrollTop += firstMessage.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top - 40;
    viewport.dispatchEvent(new Event('scroll'));
    await new Promise(resolve => setTimeout(resolve, 75));
    const anchor = [...root.querySelectorAll<HTMLElement>('[data-flower-message-id]')].find(element => element.getBoundingClientRect().top > viewport.getBoundingClientRect().top + 40)!;
    expect(anchor).toBeDefined();
    const top = anchor.getBoundingClientRect().top;
    reads.get('0')!({ ...fixture('0'), ordinal: 1, text: 'Preview text\n\n' + 'Expanded paragraph.\n\n'.repeat(40) });
    await waitFor(() => firstMessage.textContent?.includes('Expanded paragraph') === true);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(Math.abs(anchor.getBoundingClientRect().top - top)).toBeLessThanOrEqual(2);
    await new Promise(resolve => setTimeout(resolve, 280));
    expect(Math.abs(anchor.getBoundingClientRect().top - top)).toBeLessThanOrEqual(2);
  });

  it('retains a hydrated immutable message across an authoritative refresh without a second body read', async () => {
    const { root, body, rename } = await mount();
    await waitFor(() => root.textContent?.includes('Preview text expanded body!!') === true);
    root.querySelector<HTMLButtonElement>('.flower-chat-header-rename')!.click();
    const input = root.querySelector<HTMLInputElement>('.flower-chat-header-title-input')!;
    input.value = 'Readable history'; input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => rename.mock.calls.length === 1);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(body).toHaveBeenCalledOnce();
    expect(root.textContent).toContain('Preview text expanded body!!');
  });

  it('recovers a transient read automatically without stopping workspace sync', async () => {
    const { root, body } = await mount(false, false, { fail: true });
    expect(root.querySelector('.flower-history-body-control button')).toBeNull();
    expect(root.querySelector('.flower-workspace-sync')).toBeNull();
    await waitFor(() => root.textContent?.includes('Preview text expanded body!!') === true);
    expect(body).toHaveBeenCalledTimes(2);
  });
  it('offers an explicit retry after a body failure and resumes only the missing bytes', async () => {
    let ready = false;
    const incremental = vi.fn<NonNullable<FlowerSurfaceAdapter['loadHistoryBody']>>(async (_tid, input) => {
      if (!ready) throw Object.assign(new Error('invalid thread query'), { status: 400 });
      return { thread_id: 'history', bytes: input.through_bytes, ...input, text: ' expanded body!!' };
    });
    const { root, body } = await mount(false, false, { loadHistoryBody: incremental });
    await waitFor(() => Boolean(root.querySelector('.flower-history-body-control button')));
    expect(incremental).toHaveBeenCalledOnce();
    ready = true;
    root.querySelector<HTMLButtonElement>('.flower-history-body-control button')!.click();
    await waitFor(() => root.textContent?.includes('Preview text expanded body!!') === true);
    expect(incremental).toHaveBeenCalledTimes(2);
    expect(incremental.mock.calls[1][1].offset_bytes).toBe(12);
    expect(body).not.toHaveBeenCalled();
    expect(root.querySelector('.flower-history-body-control')).toBeNull();
  });

  it('cancels an expanded body read when switching conversations and rejects its late result', async () => {
    const { root, body, history, complete } = await mount(false, true);
    await waitFor(() => body.mock.calls.length === 1);
    const signal = body.mock.calls[0][2];
    root.querySelector<HTMLButtonElement>('[data-thread-id="peer"] button')!.click();
    await waitFor(() => signal.aborted && history.mock.calls.at(-1)?.[0] === 'peer');
    complete({ ...fixture('latest'), text: 'Late stale body must not appear' });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(root.textContent).not.toContain('Late stale body must not appear');
    expect(root.querySelector('.flower-history-body-control button')).toBeNull();
  });

  it('retries a failed older-page handoff without resetting the transcript or draft', async () => {
    const { root, history, full } = await mount(false, false, { text: 'Preview text' + '\n\nLong paragraph.'.repeat(120) });
    await waitFor(() => root.textContent?.includes('Long paragraph') === true);
    const editor = root.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    editor.value = 'Keep my draft'; editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const original = history.getMockImplementation()!;
    let rejected = false;
    history.mockImplementation(async (id, input) => {
      if (input.item_ids && !rejected) { rejected = true; throw Object.assign(new Error('invalid history window'), { status: 400 }); }
      return original(id, input);
    });
    const bubble = root.querySelector('.flower-history-message .flower-message-bubble');
    const viewport = root.querySelector<HTMLDivElement>('.flower-chat-transcript')!;
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    viewport.scrollTop = 0; viewport.dispatchEvent(new Event('scroll'));
    await waitFor(() => Boolean(root.querySelector('[role="alert"]')));
    expect(root.querySelector('.flower-history-message .flower-message-bubble')).toBe(bubble);
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
    const count = history.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(history).toHaveBeenCalledTimes(count);
    const retry = root.querySelector<HTMLButtonElement>('[role="alert"] button');
    expect(retry).not.toBeNull();
    retry!.click();
    await waitFor(() => root.textContent?.includes('Older conversation') === true);
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.querySelector('.flower-composer textarea')).toBe(editor);
    expect(editor.value).toBe('Keep my draft');
    expect(full).not.toHaveBeenCalled();
    expect(history.mock.calls.at(-1)?.[1].item_ids).toEqual(['old', 'latest']);
  });

  it('keeps the reading interval after a settings command returns its latest-page receipt', async () => {
    const { root, history, rename } = await mount(false, false, { text: 'Preview text' + '\n\nLong paragraph.'.repeat(120) });
    await waitFor(() => root.textContent?.includes('Long paragraph') === true);
    const viewport = root.querySelector<HTMLDivElement>('.flower-chat-transcript')!;
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    viewport.scrollTop = 0; viewport.dispatchEvent(new Event('scroll'));
    await waitFor(() => root.textContent?.includes('Older conversation') === true);
    root.querySelector<HTMLButtonElement>('.flower-chat-header-rename')!.click();
    const input = root.querySelector<HTMLInputElement>('.flower-chat-header-title-input')!;
    input.value = 'Renamed history';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => rename.mock.calls.length === 1 && history.mock.calls.at(-1)?.[1].item_ids?.[0] === 'old');
    expect(root.textContent).toContain('Older conversation');
    expect(root.querySelector('.flower-history-text-loading')).toBeNull();
    expect(history.mock.calls.at(-1)![1]).toMatchObject({ item_ids: ['old', 'latest'], observer_id: 'observer' });
  });

  it('updates unselected conversation status without a detail download', async () => {
    const { root, history, push, full } = await mount();
    const count = history.mock.calls.length;
    push({ schema_version: 3, kind: 'thread.batch', thread_id: 'peer', facts_only: true,
      update: { thread_id: 'peer', turn_id: 'peer-turn', run_id: 'peer-run', base_version: 1, view_version: 2,
        facts: { activity: 'active', attention: { input_count: 1 }, queue_count: 0, run_progress: { phase: 'tool_execution' } } } });
    await waitFor(() => root.querySelector('[data-thread-id="peer"]')?.textContent?.includes('Another conversation') === true);
    expect(history).toHaveBeenCalledTimes(count); expect(full).not.toHaveBeenCalled();
  });
});
