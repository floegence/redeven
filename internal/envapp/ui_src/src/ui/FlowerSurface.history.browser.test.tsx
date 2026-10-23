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
async function mount(tool = false) {
  await page.viewport(1280, 900);
  const seed = thread({ thread_id: 'history', title: 'Bounded history', messages: [] });
  const peer = thread({ thread_id: 'peer', title: 'Another conversation' });
  const body = vi.fn(async (_tid: string, _id: string, _signal: AbortSignal): Promise<FlowerRuntimeCurrentItem> => ({ ...fixture('latest'), text: 'Preview text expanded body!!' }));
  const full = vi.fn(async () => { throw new Error('Full history must not be requested'); });
  const values: FlowerLiveStreamEnvelope[] = [{ schema_version: 2, kind: 'ready', observer_id: 'observer', summaries: [seed, peer] }];
  let wake: (() => void) | undefined;
  const history = vi.fn(async (id: string, request: FlowerHistoryRequest) => {
    const older = request.direction === 'before';
    const item: FlowerRuntimeCurrentItem = tool ? { id: 'history-tool', kind: 'tool', ordinal: 1, turn_id: 'turn', run_id: 'run',
      activity_bodies: [{ entry_id: 'activity', bytes: 10000, sha256: 'hash' }],
      activity: { item_id: 'history-tool', tool_id: 'history-tool', tool_name: 'terminal.exec', kind: 'tool', status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false } }
      : fixture(older ? 'old' : 'latest', !older);
    const current: FlowerRuntimeCurrentView = { thread_id: id, turn_id: 'turn', run_id: 'run', view_version: 7, activity: 'idle', last_outcome: 'completed',
      items: [item], turns: [], interactions: [], queue: [], window: { first_item_id: item.id, last_item_id: item.id, has_before: !older, has_after: older } };
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
  await waitFor(() => Boolean(root.querySelector(tool ? '[data-flower-activity-item-id]' : '.flower-history-text-preview')));
  return { root, history, body, full, rename, push(value: FlowerLiveStreamEnvelope) { values.push(value); wake?.(); } };
}

describe('bounded Flower history', () => {
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

  it('requests only the current page and loads full text only after expansion', async () => {
    const { root, full, body, history } = await mount();
    expect(full).not.toHaveBeenCalled(); expect(body).not.toHaveBeenCalled();
    expect(history.mock.calls.at(-1)![1]).toMatchObject({ observer_id: 'observer' });
    await page.screenshot({ element: root, path: '__screenshots__/flower-history-preview.png' });
    root.querySelector<HTMLButtonElement>('.flower-history-body-control button')!.click();
    await waitFor(() => root.textContent?.includes('Preview text expanded body!!') === true);
    expect(body).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.flower-history-text-preview')).toBeNull();
  });
  it('moves through same-version pages and returns to the latest without fetching the whole thread', async () => {
    const { root, history, full, body } = await mount();
    root.querySelector<HTMLButtonElement>('.flower-history-navigation button')!.click();
    await waitFor(() => root.textContent?.includes('Older conversation') === true);
    expect(history.mock.calls.at(-1)![1]).toMatchObject({ direction: 'before', anchor_id: 'latest' });
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.flower-history-navigation button')];
    expect(buttons).toHaveLength(2);
    buttons[0].click();
    await waitFor(() => Boolean(root.querySelector('.flower-history-text-preview')));
    expect(history.mock.calls.at(-1)![1]).toMatchObject({ direction: 'after', anchor_id: 'old' });
    expect(full).not.toHaveBeenCalled(); expect(body).not.toHaveBeenCalled();
  });
  it('cancels an expanded body read when switching conversations and rejects its late result', async () => {
    const { root, body, history } = await mount();
    let complete!: (item: FlowerRuntimeCurrentItem) => void;
    body.mockImplementationOnce(async () => new Promise<FlowerRuntimeCurrentItem>(resolve => { complete = resolve; }));
    root.querySelector<HTMLButtonElement>('.flower-history-body-control button')!.click();
    await waitFor(() => body.mock.calls.length === 1);
    const signal = body.mock.calls[0][2];
    root.querySelector<HTMLButtonElement>('[data-thread-id="peer"] button')!.click();
    await waitFor(() => signal.aborted && history.mock.calls.at(-1)?.[0] === 'peer');
    complete({ ...fixture('latest'), text: 'Late stale body must not appear' });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(root.textContent).not.toContain('Late stale body must not appear');
    expect(root.querySelector('.flower-history-body-control button')?.hasAttribute('disabled')).toBe(false);
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
    expect(root.querySelector('.flower-history-text-preview')).toBeNull();
    expect(history.mock.calls.at(-1)![1]).toMatchObject({ anchor_id: 'latest', observer_id: 'observer' });
  });

  it('updates unselected conversation status without a detail download', async () => {
    const { root, history, push, full } = await mount();
    const count = history.mock.calls.length;
    push({ schema_version: 2, kind: 'thread.batch', thread_id: 'peer', facts_only: true,
      update: { thread_id: 'peer', turn_id: 'peer-turn', run_id: 'peer-run', base_version: 1, view_version: 2,
        facts: { activity: 'active', attention: { input_count: 1 }, queue_count: 0, run_progress: { phase: 'tool_execution' } } } });
    await waitFor(() => root.querySelector('[data-thread-id="peer"]')?.textContent?.includes('Another conversation') === true);
    expect(history).toHaveBeenCalledTimes(count); expect(full).not.toHaveBeenCalled();
  });
});
