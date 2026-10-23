import '../index.css';
import './flower-feature.css';
import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import type { FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView, FlowerHistoryRequest, FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, renderSurfaceWithAdapter, thread, waitFor } from './FlowerSurface.navigation.testHarness';

function fixture(id: string, partial = false): FlowerRuntimeCurrentItem {
  return { id, kind: 'assistant', text: partial ? 'Preview text' : 'Older conversation', ordinal: id === 'latest' ? 2 : 1,
    turn_id: 'turn', run_id: 'run', ...(partial ? { body: { field: 'content', source_id: id, bytes: 28, preview_bytes: 12 } } : {}) };
}
async function mount(tool = false, pending = false, options: { count?: number; text?: string; fail?: boolean; kind?: 'user' | 'assistant' } = {}) {
  await page.viewport(1280, 900);
  const seed = thread({ thread_id: 'history', title: 'Bounded history', messages: [] });
  const peer = thread({ thread_id: 'peer', title: 'Another conversation' });
  const message = (id: string, partial = false): FlowerRuntimeCurrentItem => ({ ...fixture(id, partial), kind: options.kind ?? 'assistant' });
  const body = vi.fn(async (_tid: string, _id: string, _signal: AbortSignal): Promise<FlowerRuntimeCurrentItem> => ({ ...message(_id), ...(options.count ? { ordinal: Number(_id) + 1 } : {}), text: options.text ?? 'Preview text expanded body!!' }));
  let complete!: (item: FlowerRuntimeCurrentItem) => void;
  if (pending) body.mockImplementationOnce(async () => new Promise<FlowerRuntimeCurrentItem>(resolve => { complete = resolve; }));
  if (options.fail) body.mockRejectedValueOnce(new Error('offline'));
  const full = vi.fn(async () => { throw new Error('Full history must not be requested'); });
  const values: FlowerLiveStreamEnvelope[] = [{ schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'observer', summaries: [seed, peer] }];
  let wake: (() => void) | undefined;
  const history = vi.fn(async (id: string, request: FlowerHistoryRequest) => {
    const older = request.direction === 'before';
    let item: FlowerRuntimeCurrentItem = tool ? { id: 'history-tool', kind: 'tool', ordinal: 1, turn_id: 'turn', run_id: 'run',
      activity_bodies: [{ entry_id: 'activity', bytes: 10000, sha256: 'hash' }],
      activity: { item_id: 'history-tool', tool_id: 'history-tool', tool_name: 'terminal.exec', kind: 'tool', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false } }
      : message(older ? 'old' : 'latest', !older);
    if (!tool && !older && options.text && item.body) item = { ...item, body: { ...item.body, bytes: new TextEncoder().encode(options.text).length } };
    const current: FlowerRuntimeCurrentView = { thread_id: id, turn_id: 'turn', run_id: 'run', view_version: 7, activity: 'idle', last_outcome: 'completed',
      items: options.count ? Array.from({ length: options.count }, (_, index) => ({ ...message(String(index), true), ordinal: index + 1 })) : [item], turns: [], interactions: [], queue: [], window: { first_item_id: options.count ? '0' : item.id, last_item_id: options.count ? String(options.count - 1) : item.id, has_before: !older, has_after: older } };
    return { thread: applyFlowerRuntimeCurrentView(id === 'peer' ? peer : seed, current), current };
  });
  const rename = vi.fn(async (id: string, title: string) => {
    const receipt = await history(id, {});
    return { ...receipt, thread: { ...receipt.thread, title, title_status: 'ready' as const, title_generation: 2 } };
  });
  const root = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [seed, peer]), loadThread: full, loadHistory: history, loadHistoryItem: body, renameThread: rename,
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
    body.mockImplementationOnce(async () => { throw new Error('offline'); });
    body.mockImplementation(async () => ({ id: 'history-tool', kind: 'tool', ordinal: 1, turn_id: 'turn', run_id: 'run',
      activity: { item_id: 'history-tool', tool_id: 'history-tool', tool_name: 'terminal.exec', kind: 'tool', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
        presentation: { label: 'Inspect', renderer: 'terminal', payload: { operation: 'exec', command: 'inspect', output: 'Explicitly requested tool output', status: 'success' } } } }));
    expect(body).not.toHaveBeenCalled();
    const toggle = () => root.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="history-tool"] .flower-activity-inline-button')!;
    toggle().click();
    await waitFor(() => root.textContent?.includes('Could not load this content') === true);
    root.querySelector<HTMLButtonElement>('.flower-history-body-control button')!.click();
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
    const { root, body } = await mount(false, true, { count: 44 });
    body.mockImplementation(async (_tid, _id, signal) => new Promise<FlowerRuntimeCurrentItem>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })));
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

  it('offers a local retry after an automatic read fails without stopping workspace sync', async () => {
    const { root, body } = await mount(false, false, { fail: true });
    await waitFor(() => root.textContent?.includes('Could not load this content') === true);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(body).toHaveBeenCalledOnce();
    expect(root.querySelector('.flower-workspace-sync')).toBeNull();
    root.querySelector<HTMLButtonElement>('.flower-history-body-control button')!.click();
    await waitFor(() => root.textContent?.includes('Preview text expanded body!!') === true);
    expect(body).toHaveBeenCalledTimes(2);
  });
  it('moves through same-version pages and returns to the latest without fetching the whole thread', async () => {
    const { root, history, full } = await mount();
    root.querySelector<HTMLButtonElement>('.flower-history-navigation button')!.click();
    await waitFor(() => root.textContent?.includes('Older conversation') === true);
    expect(history.mock.calls.at(-1)![1]).toMatchObject({ direction: 'before', anchor_id: 'latest' });
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.flower-history-navigation button')];
    expect(buttons).toHaveLength(2);
    buttons[0].click();
    await waitFor(() => Boolean(root.querySelector('.flower-history-message')));
    expect(history.mock.calls.at(-1)![1]).toMatchObject({ direction: 'after', anchor_id: 'old' });
    expect(full).not.toHaveBeenCalled();
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

  it('keeps the reading interval after a settings command returns its latest-page receipt', async () => {
    const { root, history, rename } = await mount();
    root.querySelector<HTMLButtonElement>('.flower-history-navigation button')!.click();
    await waitFor(() => root.textContent?.includes('Older conversation') === true);
    root.querySelector<HTMLButtonElement>('.flower-chat-header-rename')!.click();
    const input = root.querySelector<HTMLInputElement>('.flower-chat-header-title-input')!;
    input.value = 'Renamed history';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => rename.mock.calls.length === 1 && history.mock.calls.at(-1)?.[1].direction === 'before');
    expect(root.textContent).toContain('Older conversation');
    expect(root.querySelector('.flower-history-text-loading')).toBeNull();
    expect(history.mock.calls.at(-1)![1]).toMatchObject({ anchor_id: 'latest', observer_id: 'observer' });
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
