import '../index.css';
import './flower-feature.css';
import { page } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import type { FlowerLiveStreamEnvelope, FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView, FlowerSurfaceAdapter } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, deferred, disposeRenderedSurface, renderSurfaceWithAdapter, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const text = 'Synthetic reasoning with retained context. '.repeat(45);
const thinking = (id: string): FlowerRuntimeCurrentItem => ({ id, kind: 'thinking', ordinal: 0, turn_id: 'turn', run_id: 'run',
  text: text.slice(0, 1024), body: { source_id: id, field: 'reasoning', bytes: text.length, preview_bytes: 1024 } });
const tool = (id: string): FlowerRuntimeCurrentItem => ({ id, kind: 'tool', ordinal: 0, turn_id: 'turn', run_id: 'run',
  activity_bodies: [{ entry_id: id, bytes: 10000, sha256: 'synthetic' }],
  activity: { item_id: id, tool_id: id, tool_name: 'terminal.exec', kind: 'tool', status: 'success', severity: 'quiet',
    needs_attention: false, requires_approval: false, presentation: { label: 'Inspect ' + id, renderer: 'terminal', payload: { command: 'inspect ' + id } } } });
const frames = async (count = 3) => { for (let i = 0; i < count; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); };
afterEach(() => vi.restoreAllMocks());

async function mount(items: FlowerRuntimeCurrentItem[], pending = false, live = false) {
  await page.viewport(1280, 900);
  let current: FlowerRuntimeCurrentView = { thread_id: 'thinking-hydration', view_version: 1, turn_id: 'turn', run_id: 'run',
    activity: live ? 'active' : 'idle', ...(live ? { run_progress: { phase: 'streaming' as const } } : { last_outcome: 'completed' as const }), turns: [], interactions: [], queue: [],
    items: [...items, { id: 'answer', kind: 'assistant' as const, ordinal: 0, turn_id: 'turn', run_id: 'run', text: 'Completed answer.' }]
      .map((item, index) => ({ ...item, ordinal: index + 1, canonical_ordinal: index + 1,
        ...(live && item.kind === 'thinking' ? { live: true, body: { ...item.body!, run_id: 'run' } } : {}) })),
    window: { first_item_id: items[0].id, last_item_id: 'answer', has_before: false, has_after: false } };
  const seed = thread({ thread_id: current.thread_id, title: 'Thinking hydration', messages: [] });
  const result = () => ({ thread: applyFlowerRuntimeCurrentView(seed, current), current });
  const finish = deferred<void>();
  const read = vi.fn<NonNullable<FlowerSurfaceAdapter['loadHistoryBody']>>(async (_tid, input, signal) => {
    if (pending) await finish.promise;
    signal.throwIfAborted();
    return { ...input, thread_id: current.thread_id, bytes: text.length, text: text.slice(input.offset_bytes, input.through_bytes) };
  });
  const itemRead = vi.fn<NonNullable<FlowerSurfaceAdapter['loadHistoryItem']>>(async () => { throw new Error('No hidden tool or full item read is expected'); });
  const values: FlowerLiveStreamEnvelope[] = [];
  let wake: (() => void) | undefined;
  const root = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [seed]),
    loadThread: vi.fn(async () => result()), loadHistory: vi.fn(async () => result()), loadHistoryItem: itemRead, loadHistoryBody: read,
    async *connectLiveStream({ signal }) {
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [seed] };
      const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
      try { while (!signal.aborted) { const next = values.shift(); if (next) yield next; else await new Promise<void>(resolve => { wake = resolve; }); } }
      finally { signal.removeEventListener('abort', abort); }
    } });
  root.style.height = '780px';
  await waitFor(() => Boolean(root.querySelector('[data-thread-id="thinking-hydration"] button')));
  root.querySelector<HTMLButtonElement>('[data-thread-id="thinking-hydration"] button')!.click();
  await waitFor(() => Boolean(root.querySelector('.flower-tool-sequence-toggle')));
  await waitFor(() => root.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
  await frames();
  const header = root.querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
  const disclosure = (id: string) => root.querySelector<HTMLElement>('[data-flower-thinking-id="' + id + ':block:0"]')!;
  const openGroup = async () => {
    if (header.getAttribute('aria-expanded') === 'false') header.click();
    await waitFor(() => header.closest('.flower-tool-sequence-node')?.getAttribute('data-state') === 'open');
    await frames();
  };
  return { root, header, disclosure, openGroup, read, itemRead, finish, seal() {
    current = { ...current, view_version: current.view_version + 1, activity: 'idle', last_outcome: 'completed', run_progress: undefined,
      items: current.items?.map(item => ({ ...item, live: false })) };
    values.push({ schema_version: 3, kind: 'thread.batch', thread_id: current.thread_id, current }); wake?.();
  } };
}

it.each(['leading', 'middle', 'last'] as const)('hydrates an explicitly expanded %s thinking segment without reading hidden tools', async position => {
  const items = [tool('tool-a'), tool('tool-b')];
  items.splice(position === 'leading' ? 0 : position === 'middle' ? 1 : 2, 0, thinking('reasoning'));
  const { root, disclosure, openGroup, read, itemRead, finish } = await mount(items, true);
  expect(read).not.toHaveBeenCalled();
  await openGroup();
  expect(read).not.toHaveBeenCalled();
  const row = disclosure('reasoning');
  const button = row.querySelector<HTMLButtonElement>('.flower-thinking-toggle')!;
  button.click();
  expect(button.getAttribute('aria-expanded')).toBe('true');
  await waitFor(() => read.mock.calls.length === 1);
  expect(row.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(read.mock.calls[0][1]).toMatchObject({ item_id: 'reasoning', offset_bytes: 1024, through_bytes: text.length });
  finish.resolve();
  await waitFor(() => row.querySelector('.flower-message-plain-text')?.textContent === text);
  expect(disclosure('reasoning')).toBe(row);
  expect(row.querySelector('.flower-history-body-control')).toBeNull();
  button.click(); button.click(); await frames();
  expect(read).toHaveBeenCalledOnce();
  expect(itemRead).not.toHaveBeenCalled();
  expect(root.querySelector('.flower-activity-inline-details')).toBeNull();
});

it('keeps long unopened tool sequences and collapsed thinking free of body reads and thinking visibility observers', async () => {
  const observe = vi.spyOn(IntersectionObserver.prototype, 'observe');
  const items = Array.from({ length: 120 }, (_, index) => index % 10 === 9 ? thinking('reasoning-' + index) : tool('tool-' + index));
  const { root, header, openGroup, read, itemRead } = await mount(items);
  expect(header.getAttribute('aria-expanded')).toBe('false');
  expect(root.querySelector('.flower-thinking-disclosure, .flower-activity-inline-button')).toBeNull();
  await frames(12);
  expect(read).not.toHaveBeenCalled(); expect(itemRead).not.toHaveBeenCalled();
  await openGroup();
  const scroll = root.querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
  scroll.scrollTop = 0; scroll.dispatchEvent(new Event('scroll')); await frames();
  scroll.scrollTop = scroll.scrollHeight; scroll.dispatchEvent(new Event('scroll')); await frames();
  expect(read).not.toHaveBeenCalled(); expect(itemRead).not.toHaveBeenCalled();
  expect(observe.mock.calls.filter(([element]) => element.matches('.flower-history-message, .flower-thinking-disclosure'))).toHaveLength(0);
  header.click(); await frames(12);
  expect(read).not.toHaveBeenCalled(); expect(itemRead).not.toHaveBeenCalled();
});

it('cancels a moved thinking read on fold, resumes once, and releases its observer on disposal', async () => {
  const observe = vi.spyOn(IntersectionObserver.prototype, 'observe');
  const unobserve = vi.spyOn(IntersectionObserver.prototype, 'unobserve');
  const { root, header, disclosure, openGroup, read, itemRead, finish } = await mount([tool('tool'), thinking('reasoning')], true);
  await openGroup();
  const row = disclosure('reasoning');
  const button = row.querySelector<HTMLButtonElement>('.flower-thinking-toggle')!;
  button.click(); await waitFor(() => read.mock.calls.length === 1);
  expect(observe.mock.calls.some(([element]) => element === row)).toBe(true);
  button.click();
  await waitFor(() => read.mock.calls[0][2].aborted);
  expect(unobserve.mock.calls.some(([element]) => element === row)).toBe(true);
  expect(row.querySelector('[aria-busy="true"]')).toBeNull();
  button.click(); await waitFor(() => read.mock.calls.length === 2);
  header.click();
  await waitFor(() => read.mock.calls[1][2].aborted);
  finish.resolve(); await frames(12);
  expect(read).toHaveBeenCalledTimes(2);
  await openGroup();
  await waitFor(() => row.querySelector('.flower-message-plain-text')?.textContent === text);
  expect(read).toHaveBeenCalledTimes(3);
  expect(itemRead).not.toHaveBeenCalled();
  const observed = observe.mock.calls.filter(([element]) => element === row).length;
  disposeRenderedSurface(root); await frames();
  expect(unobserve.mock.calls.filter(([element]) => element === row)).toHaveLength(observed);
});

it('waits for an expanded thinking segment to enter its nested sequence viewport', async () => {
  const { root, disclosure, openGroup, read, itemRead } = await mount([tool('first'), thinking('reasoning'),
    ...Array.from({ length: 35 }, (_, index) => tool('later-' + index))]);
  await openGroup();
  const row = disclosure('reasoning');
  const scroll = root.querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
  expect(scroll.scrollTop).toBeGreaterThan(0);
  row.querySelector<HTMLButtonElement>('.flower-thinking-toggle')!.click();
  await frames(15);
  expect(read).not.toHaveBeenCalled();
  scroll.scrollTop = 0; scroll.dispatchEvent(new Event('scroll'));
  await waitFor(() => row.querySelector('.flower-message-plain-text')?.textContent === text);
  expect(read).toHaveBeenCalledOnce(); expect(itemRead).not.toHaveBeenCalled();
});

it('keeps one read and the same thinking node when an expanded live source becomes history', async () => {
  const { disclosure, openGroup, read, itemRead, finish, seal } = await mount([tool('tool'), thinking('reasoning')], true, true);
  await openGroup();
  const row = disclosure('reasoning');
  row.querySelector<HTMLButtonElement>('.flower-thinking-toggle')!.click();
  await waitFor(() => read.mock.calls.length === 1);
  seal();
  await waitFor(() => row.getAttribute('data-flower-thinking-active') === 'false');
  expect(read.mock.calls[0][2].aborted).toBe(false);
  finish.resolve();
  await waitFor(() => row.querySelector('.flower-message-plain-text')?.textContent === text);
  expect(disclosure('reasoning')).toBe(row);
  expect(row.querySelector('.flower-thinking-toggle')?.getAttribute('aria-expanded')).toBe('true');
  expect(read).toHaveBeenCalledOnce(); expect(itemRead).not.toHaveBeenCalled();
});

it('shows a retryable failure for the actual moved thinking request and reuses the loaded body', async () => {
  const { disclosure, openGroup, read, itemRead } = await mount([tool('tool'), thinking('reasoning')]);
  read.mockRejectedValueOnce({ status: 400 });
  await openGroup();
  const row = disclosure('reasoning');
  const toggle = row.querySelector<HTMLButtonElement>('.flower-thinking-toggle')!;
  toggle.click();
  await waitFor(() => Boolean(row.querySelector('.flower-history-body-control button')));
  expect(row.querySelector('.flower-history-body-control')?.getAttribute('aria-busy')).toBe('false');
  row.querySelector<HTMLButtonElement>('.flower-history-body-control button')!.click();
  await waitFor(() => row.querySelector('.flower-message-plain-text')?.textContent === text);
  toggle.click(); toggle.click(); await frames();
  expect(read).toHaveBeenCalledTimes(2); expect(itemRead).not.toHaveBeenCalled();
});
