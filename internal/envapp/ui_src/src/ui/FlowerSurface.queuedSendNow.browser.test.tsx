import './flower-feature.css';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { FlowerSurface, createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src';
import { withModelDirectoryFixture } from '../../../../flower_ui/testing/modelDirectoryFixture';
import type { FlowerLiveStreamEnvelope, FlowerSurfaceAdapter, FlowerThreadView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import { adapter, liveBootstrap, renderSurfaceWithAdapter, thread, waitFor } from './FlowerSurface.navigation.testHarness';

beforeEach(() => page.viewport(1280, 900));
const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });

function queuedThread(status: 'idle' | 'running' | 'waiting_user' | 'waiting_approval' = 'running', threadID = 'queued-send') {
  return thread({
    thread_id: threadID,
    status,
    queued_turn_count: 2,
    queued_turns: [
      { queue_id: 'queued-first', prompt: 'Send the first task', created_at_ms: 10 },
      { queue_id: 'queued-second', prompt: 'Keep the second task', created_at_ms: 11 },
    ],
  });
}

function sentView(value: ReturnType<typeof queuedThread>, version = 2): FlowerThreadView {
  return liveBootstrap(thread({
    ...value,
    status: 'running', active_run_id: 'run-send-now',
    run_progress: { run_id: 'run-send-now', turn_id: 'turn-send-now', phase: 'preparing' },
    queued_turns: [value.queued_turns![1]!], queued_turn_count: 1,
  }), version);
}

function mount(
  initial: ReturnType<typeof queuedThread>,
  sendNow: (threadID: string, queueID: string) => Promise<FlowerThreadView>,
  overrides: Partial<FlowerSurfaceAdapter> = {},
) {
  let current = liveBootstrap(initial, 1);
  const calls = vi.fn(async (threadID: string, queueID: string) => { current = await sendNow(threadID, queueID); });
  const runtime = renderSurfaceWithAdapter({
    ...adapter(true),
    listThreads: vi.fn(async () => [initial]),
    loadThread: vi.fn(async () => current),
    sendQueuedTurnNow: calls,
    ...overrides,
  });
  return { runtime, calls };
}

async function open(runtime: HTMLElement, threadID = 'queued-send') {
  await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${threadID}"] button`)));
  (runtime.querySelector(`[data-thread-id="${threadID}"] button`) as HTMLButtonElement).click();
  await waitFor(() => runtime.querySelectorAll('[data-flower-queued-turn-dock-id]').length === 2);
}

function sendButton(runtime: HTMLElement, queueID = 'queued-first') {
  return runtime.querySelector<HTMLButtonElement>(`[data-flower-queued-turn-dock-id="${queueID}"] .flower-queued-turn-send`)!;
}

function reactiveSurface(initial: FlowerSurfaceAdapter) {
  const runtime = document.createElement('div');
  document.body.append(runtime);
  const settings = async () => withModelDirectoryFixture(await initial.loadSettings());
  const prepare = (value: FlowerSurfaceAdapter): FlowerSurfaceAdapter => ({ ...value, loadSettings: settings,
    loadModelDirectory: async () => (await settings()).model_directory!,
  });
  const [value, setValue] = createSignal(prepare(initial));
  const drafts = createFlowerComposerDraftCoordinator();
  const dispose = render(() => <FlowerSurface adapter={value()} draftCoordinator={drafts} notify={() => {}} />, runtime);
  disposers.push(() => { dispose(); drafts.dispose(); runtime.remove(); });
  return { runtime, replaceAdapter: (next: FlowerSurfaceAdapter) => setValue(prepare(next)) };
}

function canonicalStream(value: ReturnType<typeof queuedThread>, version: number): NonNullable<FlowerSurfaceAdapter['connectLiveStream']> {
  return async function* ({ signal }) {
    yield { schema_version: 2, kind: 'ready', summaries: [value] };
    yield { schema_version: 2, kind: 'thread.batch', thread_id: value.thread_id, current: liveBootstrap(value, version).current };
    if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
  };
}

describe('Flower queued send now', () => {
  it.each(['running', 'waiting_user', 'waiting_approval', 'idle'] as const)('enables Send now while the thread is %s', async status => {
    const value = queuedThread(status);
    const { runtime, calls } = mount(value, async () => sentView(value));
    await open(runtime);
    expect(sendButton(runtime)).toBeEnabled();
    sendButton(runtime).click();
    await waitFor(() => calls.mock.calls.length === 1);
    expect(calls).toHaveBeenCalledWith(value.thread_id, 'queued-first');
  });

  it('hides Send now when the adapter does not expose the capability and blocks read-only viewers', async () => {
    const value = queuedThread('idle');
    const absent = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [value]), loadThread: vi.fn(async () => liveBootstrap(value, 1)) });
    await open(absent);
    expect(sendButton(absent)).toBeNull();

    const readonly = renderSurfaceWithAdapter({ ...adapter(true), canMutate: false, listThreads: vi.fn(async () => [value]), loadThread: vi.fn(async () => liveBootstrap(value, 1)), sendQueuedTurnNow: vi.fn() });
    await open(readonly);
    expect(sendButton(readonly)).toBeDisabled();
  });

  it('blocks Send now while stop is pending', async () => {
    const value = { ...queuedThread('running'), cancellation: { thread_id: 'queued-send', turn_id: 'turn', run_id: 'run', source: 'user_stop', mode: 'graceful' as const, requested_at: '2026-01-01T00:00:00Z' } };
    const { runtime, calls } = mount(value, vi.fn(async () => liveBootstrap(value, 2)));
    await open(runtime);
    expect(sendButton(runtime)).toBeDisabled();
    expect(calls).not.toHaveBeenCalled();
  });

  it('guards double-click and disables all queue mutations on the same thread', async () => {
    const value = queuedThread();
    let resolve!: (view: FlowerThreadView) => void;
    const pending = new Promise<FlowerThreadView>(r => { resolve = r; });
    const { runtime, calls } = mount(value, () => pending, { deleteQueuedTurn: vi.fn(async () => {}) });
    await open(runtime);
    const first = sendButton(runtime);
    const second = sendButton(runtime, 'queued-second');
    const deleteSecond = runtime.querySelector<HTMLButtonElement>('[data-flower-queued-turn-dock-id="queued-second"] [data-flower-queued-turn-delete]')!;
    first.click(); first.click();
    await waitFor(() => calls.mock.calls.length === 1);
    expect(first.getAttribute('aria-busy')).toBe('true');
    expect(second).toBeDisabled();
    expect(deleteSecond).toBeDisabled();
    const row = first.closest('[data-flower-queued-turn-dock-id]')!;
    resolve(sentView(value));
    await waitFor(() => !row.isConnected);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('keeps queued rows stable when delete and reorder race a pending send', async () => {
    const value = queuedThread();
    let resolve!: (view: FlowerThreadView) => void;
    const pending = new Promise<FlowerThreadView>(r => { resolve = r; });
    const reorder = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    const { runtime } = mount(value, () => pending, { reorderQueuedTurns: reorder, deleteQueuedTurn: remove });
    await open(runtime);
    const rows = [...runtime.querySelectorAll('[data-flower-queued-turn-dock-id]')];
    sendButton(runtime).click();
    await waitFor(() => sendButton(runtime).getAttribute('aria-busy') === 'true');
    const dataTransfer = new DataTransfer();
    (rows[0] as HTMLElement).dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    (rows[1] as HTMLElement).dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientY: 999 }));
    (runtime.querySelector('[data-flower-queued-turn-dock-id="queued-second"] [data-flower-queued-turn-delete]') as HTMLButtonElement).click();
    expect(reorder).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect([...runtime.querySelectorAll('[data-flower-queued-turn-dock-id]')]).toEqual(rows);
    resolve(sentView(value));
  });

  it('keeps completion on the original thread when the user switches threads', async () => {
    const first = queuedThread('running', 'queued-first-thread');
    const second = queuedThread('idle', 'queued-second-thread');
    let resolve!: (view: FlowerThreadView) => void;
    const pending = new Promise<FlowerThreadView>(r => { resolve = r; });
    const { runtime } = mount(first, () => pending, { listThreads: vi.fn(async () => [first, second]), loadThread: vi.fn(async id => liveBootstrap(id === second.thread_id ? second : first, 1)) });
    await open(runtime, first.thread_id);
    sendButton(runtime).click();
    await waitFor(() => sendButton(runtime).getAttribute('aria-busy') === 'true');
    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${second.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${second.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === second.thread_id);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const retainedFocus = sendButton(runtime, 'queued-second');
    expect(retainedFocus).toBeEnabled();
    retainedFocus.focus();
    resolve(sentView(first));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(runtime.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id')).toBe(second.thread_id);
    expect(runtime.querySelector('[data-flower-queued-turn-dock-id="queued-first"]')).not.toBeNull();
    expect(document.activeElement).toBe(retainedFocus);
  });

  it.each(['rejected', 'unknown'] as const)('refreshes the frozen thread after a %s send and keeps the queue visible', async failureKind => {
    const value = queuedThread('running');
    const refreshed = { ...value, queued_turns: value.queued_turns!.slice(0, 1), queued_turn_count: 1 };
    const loadThread = vi.fn(async () => liveBootstrap(loadThread.mock.calls.length > 1 ? refreshed : value, loadThread.mock.calls.length > 1 ? 3 : 1));
    const { runtime, calls } = mount(value, async () => { throw flowerTurnAdmissionError(failureKind, new Error('send-now failed')); }, { loadThread });
    await open(runtime);
    sendButton(runtime).click();
    await waitFor(() => calls.mock.calls.length === 1);
    await waitFor(() => loadThread.mock.calls.length >= 2);
    expect(runtime.querySelector('[data-flower-queued-turn-dock-id="queued-first"]')).not.toBeNull();
    expect(runtime.querySelector('[data-flower-queued-turn-dock-id="queued-second"]')).toBeNull();
  });

  it('reconciles current evidence before the send-now HTTP promise resolves', async () => {
    const value = queuedThread('running');
    let resolve!: (view: FlowerThreadView) => void;
    const pending = new Promise<FlowerThreadView>(r => { resolve = r; });
    const envelopes: FlowerLiveStreamEnvelope[] = [];
    let wake = () => {};
    const { runtime } = mount(value, () => pending, { connectLiveStream: async function* ({ signal }) {
      yield { schema_version: 2, kind: 'ready', summaries: [value] };
      while (!signal.aborted) {
        const next = envelopes.shift();
        if (next) { yield next; continue; }
        await new Promise<void>(r => { wake = r; signal.addEventListener('abort', () => r(), { once: true }); });
      }
    } });
    await open(runtime);
    sendButton(runtime).click();
    await waitFor(() => sendButton(runtime).getAttribute('aria-busy') === 'true');
    envelopes.push({ schema_version: 2, kind: 'thread.batch', thread_id: value.thread_id, current: sentView(value, 2).current }); wake();
    await waitFor(() => runtime.querySelector('[data-flower-queued-turn-dock-id="queued-first"]') === null);
    resolve(sentView(value, 3));
  });

  it('waits for canonical current to remove a queue entry after an HTTP acknowledgement', async () => {
    const value = queuedThread('running');
    const envelopes: FlowerLiveStreamEnvelope[] = [];
    let wake = () => {};
    const { runtime, calls } = mount(value, async () => liveBootstrap(value, 1), { connectLiveStream: async function* ({ signal }) {
      yield { schema_version: 2, kind: 'ready', summaries: [value] };
      while (!signal.aborted) {
        const next = envelopes.shift();
        if (next) { yield next; continue; }
        await new Promise<void>(resolve => { wake = resolve; signal.addEventListener('abort', () => resolve(), { once: true }); });
      }
    } });
    await open(runtime);
    const row = runtime.querySelector('[data-flower-queued-turn-dock-id="queued-first"]');
    sendButton(runtime).click();
    await waitFor(() => calls.mock.calls.length === 1 && !sendButton(runtime).hasAttribute('aria-busy'));
    expect(runtime.querySelector('[data-flower-queued-turn-dock-id="queued-first"]')).toBe(row);
    envelopes.push({ schema_version: 2, kind: 'thread.batch', thread_id: value.thread_id, current: sentView(value, 2).current }); wake();
    await waitFor(() => runtime.querySelector('[data-flower-queued-turn-dock-id="queued-first"]') === null);
  });

  it('retries an unknown result with the same queue identity after refreshing canonical detail', async () => {
    const value = queuedThread('running');
    let attempts = 0;
    const { runtime, calls } = mount(value, async () => {
      if (++attempts === 1) throw flowerTurnAdmissionError('unknown', new Error('Response lost'));
      return sentView(value, 3);
    });
    await open(runtime);
    sendButton(runtime).click();
    await waitFor(() => calls.mock.calls.length === 1 && !sendButton(runtime).hasAttribute('aria-busy'));
    expect(runtime.querySelector('[data-flower-queued-turn-dock-id="queued-first"]')).not.toBeNull();
    sendButton(runtime).click();
    await waitFor(() => calls.mock.calls.length === 2);
    expect(calls.mock.calls[1]).toEqual(calls.mock.calls[0]);
    await waitFor(() => runtime.querySelector('[data-flower-queued-turn-dock-id="queued-first"]') === null);
  });

  it('discards an old connection HTTP result after the adapter reconnects', async () => {
    const value = queuedThread('running');
    const updated = { ...value, queued_turns: value.queued_turns!.map(turn => ({ ...turn, prompt: `New connection: ${turn.prompt}` })) };
    let resolve!: (view: FlowerThreadView) => void;
    const response = new Promise<FlowerThreadView>(r => { resolve = r; });
    const original: FlowerSurfaceAdapter = { ...adapter(true), listThreads: vi.fn(async () => [value]), loadThread: vi.fn(async () => liveBootstrap(value, 1)),
      sendQueuedTurnNow: vi.fn(async () => { await response; }), connectLiveStream: canonicalStream(value, 1) };
    const { runtime, replaceAdapter } = reactiveSurface(original);
    await open(runtime);
    sendButton(runtime).click();
    await waitFor(() => sendButton(runtime).getAttribute('aria-busy') === 'true');
    replaceAdapter({ ...original, loadThread: vi.fn(async () => liveBootstrap(updated, 3)), connectLiveStream: canonicalStream(updated, 3) });
    await waitFor(() => runtime.querySelector('[data-flower-queued-turn-dock-id="queued-first"]')?.textContent?.includes('New connection:') === true);
    resolve(sentView(value, 4));
    await waitFor(() => !sendButton(runtime).hasAttribute('aria-busy'));
    expect(runtime.querySelector('[data-flower-queued-turn-dock-id="queued-first"]')?.textContent).toContain('New connection:');
  });

  it('does not refresh an obsolete connection after a command failure', async () => {
    const value = queuedThread('running');
    let reject!: (error: Error) => void;
    const response = new Promise<FlowerThreadView>((_resolve, r) => { reject = r; });
    const loadOriginal = vi.fn(async () => liveBootstrap(value, 1));
    const original: FlowerSurfaceAdapter = { ...adapter(true), listThreads: vi.fn(async () => [value]), loadThread: loadOriginal,
      sendQueuedTurnNow: vi.fn(async () => { await response; }), connectLiveStream: canonicalStream(value, 1) };
    const { runtime, replaceAdapter } = reactiveSurface(original);
    await open(runtime);
    sendButton(runtime).click();
    await waitFor(() => sendButton(runtime).getAttribute('aria-busy') === 'true');
    const loadNew = vi.fn(async () => liveBootstrap(value, 3));
    replaceAdapter({ ...original, loadThread: loadNew, connectLiveStream: canonicalStream(value, 3) });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    loadOriginal.mockClear(); loadNew.mockClear();
    reject(flowerTurnAdmissionError('unknown', new Error('Response lost after reconnect')));
    await waitFor(() => !sendButton(runtime).hasAttribute('aria-busy'));
    expect(loadOriginal).not.toHaveBeenCalled();
    expect(loadNew).not.toHaveBeenCalled();
    expect(runtime.querySelector('[data-flower-queued-turn-dock-id="queued-first"]')).not.toBeNull();
  });
});

it('keeps an acknowledged send settled when its detail refresh fails and retries only synchronization', async () => {
  const value = queuedThread();
  const loadThread = vi.fn().mockResolvedValueOnce(liveBootstrap(value, 1)).mockRejectedValueOnce(new Error('Detail temporarily unavailable')).mockResolvedValue(sentView(value, 2));
  const sendQueuedTurnNow = vi.fn(async () => {});
  const runtime = renderSurfaceWithAdapter({ ...adapter(true), listThreads: async () => [value], loadThread, sendQueuedTurnNow });
  await open(runtime); sendButton(runtime).click();
  await waitFor(() => sendQueuedTurnNow.mock.calls.length === 1 && Boolean(runtime.querySelector('.flower-thread-sync-error')));
  expect(sendButton(runtime)).toBeEnabled();
  runtime.querySelector<HTMLButtonElement>('.flower-thread-sync-error button')!.click();
  await waitFor(() => runtime.querySelector('[data-flower-queued-turn-dock-id="queued-first"]') === null);
  expect(sendQueuedTurnNow).toHaveBeenCalledTimes(1);
});
