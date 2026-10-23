// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import type { FlowerLiveStreamConnectInput, FlowerLiveStreamEnvelope, FlowerRuntimeCurrentView, FlowerSubagentDetail, FlowerThreadSnapshot, FlowerTurnLaunchInput } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  deferred,
  flush,
  liveBootstrap,
  renderSurfaceWithAdapter,
  renderSurfaceWithAdapterProps,
  runtimeCurrentView,
  subagentDetail,
  subagentSummary,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

const syncFailure = 'Live updates stopped because data could not be read or applied. Displayed state may be outdated.';
const stopUnconfirmed = 'Stop status is unconfirmed. Resync before trying again.';

describe('parent event synchronization boundaries', () => {
  it('offers canonical resynchronization when report reading is unavailable', async () => {
    const report = { id: 'report-unavailable', parent_thread_id: 'thread-report-unavailable', source_thread_id: 'child', source_turn_id: 'turn', source_run_id: 'run', source_entry_id: 'entry', kind: 'report' as const, received_at: '2026-10-18T00:00:00Z', admitted: false };
    const selected = thread({ thread_id: report.parent_thread_id, parent_events: { thread_id: report.parent_thread_id, events: [report], first_event_id: report.id, last_event_id: report.id } });
    const loadThread = vi.fn(async () => liveBootstrap(selected, 1));
    const launchTurn = vi.fn(); const stopThread = vi.fn();
    const surface = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: vi.fn(async () => [selected]), loadThread, readParentEvents: undefined, launchTurn, stopThread },
      { focusThreadRequest: { request_id: 'unavailable-report', thread_id: selected.thread_id } });
    await waitFor(() => Boolean(surface.querySelector('.flower-parent-event-reading button')));
    const retry = surface.querySelector<HTMLButtonElement>('.flower-parent-event-reading button')!;
    expect(retry.textContent).toBe('Retry'); expect(retry.disabled).toBe(false);
    expect(surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')?.disabled).toBe(false);
    const before = loadThread.mock.calls.length; retry.click();
    await waitFor(() => loadThread.mock.calls.length > before);
    expect(surface.querySelector('.flower-workspace-sync')).toBeNull();
    expect(stopThread).not.toHaveBeenCalled(); expect(launchTurn).not.toHaveBeenCalled();
  });
  it('rejects malformed canonical events before publication and resyncs without sending', async () => {
    const selected = thread({ thread_id: 'thread-parent-contract', parent_events: { thread_id: 'thread-parent-contract', events: [] } });
    const broken = deferred<void>();
    let connections = 0;
    const launchTurn = vi.fn();
    const loadThread = vi.fn(async () => liveBootstrap(selected, connections > 1 ? 3 : 1));
    const surface = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [selected]), loadThread, launchTurn,
      connectLiveStream: async function* (input): AsyncIterable<FlowerLiveStreamEnvelope> {
        connections++;
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [selected] };
        if (connections === 1) {
          await broken.promise;
          yield { schema_version: 3, kind: 'thread.batch', thread_id: selected.thread_id,
            current: { ...runtimeCurrentView(selected, 2), parent_events: JSON.parse('{"events":null}') } };
        }
        await waitForAbort(input);
      },
    });
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-parent-contract"] button')));
    selectThread(surface, selected.thread_id);
    await waitFor(() => surface.textContent?.includes('Plan deploy') ?? false);
    const message = surface.querySelector('[data-flower-message-id]');
    broken.resolve();
    await waitFor(() => Boolean(surface.querySelector('[data-flower-sync-state="failed"]')));
    expect(surface.querySelector('[data-flower-message-id]')).toBe(message);
    expect(surface.textContent).not.toContain(stopUnconfirmed);
    (surface.querySelector('.flower-workspace-sync button') as HTMLButtonElement).click();
    await waitFor(() => connections === 2 && !surface.querySelector('.flower-workspace-sync'));
    expect(surface.textContent).toContain('Plan deploy');
    expect(launchTurn).not.toHaveBeenCalled();
  });

  it('keeps report failures local while preserving drafts, navigation and same-page retry', async () => {
    const report = { id: 'report-local', parent_thread_id: 'thread-report-local', source_thread_id: 'child', source_turn_id: 'child-turn', source_run_id: 'child-run', source_entry_id: 'child-entry', kind: 'report' as const, received_at: '2026-10-18T00:00:00Z', admitted: false };
    const events = { thread_id: report.parent_thread_id, events: [report], first_event_id: report.id, last_event_id: report.id };
    const selected = thread({ thread_id: report.parent_thread_id, parent_events: events });
    const second = thread({ thread_id: 'thread-other-report', title: 'Other report conversation' });
    const readParentEvents = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...events, events: [{ ...report, message: 'Saved report recovered' }] });
    const stopThread = vi.fn(); const launchTurn = vi.fn();
    const surface = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [selected, second]),
      loadThread: vi.fn(async id => liveBootstrap(id === selected.thread_id ? selected : second, 1)), readParentEvents, stopThread, launchTurn });
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-report-local"] button')));
    selectThread(surface, selected.thread_id);
    await waitFor(() => Boolean(surface.querySelector('.flower-parent-event-reading')));
    expect(surface.querySelector('.flower-parent-event-reading')?.textContent).toContain('Unable to load reports');
    expect(surface.querySelector('.flower-workspace-sync')).toBeNull();
    expect(surface.textContent).not.toContain(stopUnconfirmed);
    const editor = surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    expect(editor.disabled).toBe(false);
    editor.value = 'Keep my report draft'; editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (surface.querySelector('.flower-parent-event-reading button') as HTMLButtonElement).click();
    await waitFor(() => surface.textContent?.includes('Saved report recovered') ?? false);
    expect(readParentEvents.mock.calls[1]).toEqual(readParentEvents.mock.calls[0]);
    expect(editor.value).toBe('Keep my report draft');
    selectThread(surface, second.thread_id); await waitFor(() => surface.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === second.thread_id);
    selectThread(surface, selected.thread_id); await waitFor(() => surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')?.value === 'Keep my report draft');
    expect(stopThread).not.toHaveBeenCalled(); expect(launchTurn).not.toHaveBeenCalled();
  });
});

function encodingFailure(): Error & { code: string } {
  return Object.assign(new Error('internal encoding diagnostic'), { code: 'envelope_encoding_failed' });
}

async function waitForAbort(input: FlowerLiveStreamConnectInput): Promise<void> {
  if (input.signal.aborted) return;
  await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }));
}

function selectThread(surface: HTMLElement, threadID: string): void {
  (surface.querySelector(`[data-thread-id="${threadID}"] button`) as HTMLButtonElement).click();
}

function failedStream(summaries: readonly FlowerThreadSnapshot[]) {
  const firstFailure = deferred<void>();
  const attempts: FlowerLiveStreamConnectInput[] = [];
  const connectLiveStream = vi.fn(async function* (input: FlowerLiveStreamConnectInput): AsyncIterable<FlowerLiveStreamEnvelope> {
    attempts.push(input);
    yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries };
    if (attempts.length === 1) {
      await firstFailure.promise;
      throw encodingFailure();
    }
    await waitForAbort(input);
  });
  return { connectLiveStream, attempts, fail: () => firstFailure.resolve() };
}

describe('Flower workspace synchronization recovery', () => {
  it('keeps reconnect status visible through a 503 handshake and restores canonical progress automatically', async () => {
    const running = thread({ thread_id: 'thread-rebind', status: 'running' });
    const disconnect = deferred<void>(); const recovered = deferred<void>();
    let attempts = 0;
    const launchTurn = vi.fn(); const stopThread = vi.fn();
    const connectLiveStream = vi.fn(async function* (input: FlowerLiveStreamConnectInput): AsyncIterable<FlowerLiveStreamEnvelope> {
      const attempt = ++attempts;
      if (attempt === 2) throw Object.assign(new Error('runtime subscription recovering'), { status: 503, code: 'unexpected_status' });
      if (attempt > 2) await recovered.promise;
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [running] };
      if (attempt === 1) { await disconnect.promise; return; }
      await waitForAbort(input);
    });
    const surface = renderSurfaceWithAdapter({ ...adapter(true), connectLiveStream, launchTurn, stopThread,
      loadThread: vi.fn(async () => liveBootstrap(running, attempts > 1 ? 10 : 9)) });
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-rebind"] button')));
    selectThread(surface, running.thread_id);
    await waitFor(() => Boolean(surface.querySelector('[data-flower-progress-kind]')));
    const editor = surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    editor.value = 'Keep this draft while reconnecting';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    disconnect.resolve();
    await waitFor(() => attempts === 3, 2000);
    expect(surface.querySelector('.flower-model-status-lane [role="status"]')?.textContent).toContain('Reconnecting live updates');
    expect(surface.querySelector('[data-flower-progress-kind]')).toBeNull();
    expect(surface.querySelector('[data-flower-sync-state="failed"]')).toBeNull();
    expect(surface.textContent).toContain('Plan deploy');
    recovered.resolve();
    await waitFor(() => !surface.querySelector('.flower-workspace-sync') && Boolean(surface.querySelector('[data-flower-progress-kind]')));
    expect(surface.querySelector('[data-flower-progress-sync-state]')).toBeNull();
    expect(surface.querySelector('.flower-composer textarea')).toBe(editor);
    expect(editor.value).toBe('Keep this draft while reconnecting');
    expect(launchTurn).not.toHaveBeenCalled(); expect(stopThread).not.toHaveBeenCalled();
  });

  it('keeps a terminal sync failure actionable in the progress lane without showing stale execution', async () => {
    const running = thread({ thread_id: 'thread-sync-indicator', status: 'running' });
    const stream = failedStream([running]);
    const surface = renderSurfaceWithAdapter({ ...adapter(true), connectLiveStream: stream.connectLiveStream,
      loadThread: vi.fn(async () => liveBootstrap(running, stream.attempts.length > 1 ? 10 : 9)) });
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-sync-indicator"] button')));
    selectThread(surface, running.thread_id);
    await waitFor(() => Boolean(surface.querySelector('[data-flower-progress-kind]')));
    stream.fail();
    await waitFor(() => Boolean(surface.querySelector('[data-flower-sync-state="failed"]')));
    const lane = surface.querySelector('.flower-model-status-lane')!;
    expect(lane.querySelector('[role="status"]')?.textContent).toContain('Status unconfirmed');
    expect(lane.querySelector('[data-flower-progress-kind]')).toBeNull();
    expect(lane.querySelector('[data-floe-progress-shimmer]')).toBeNull();
    const retry = lane.querySelector<HTMLButtonElement>('button')!;
    expect(retry?.textContent).toBe('Resync');
    retry.click();
    await waitFor(() => stream.attempts.length === 2 && Boolean(surface.querySelector('[data-flower-progress-kind]')));
    expect(surface.querySelector('[data-flower-progress-sync-state]')).toBeNull();
  });

  it.each([
    [426, 'matching app and runtime version'],
    [429, 'Close unused Flower views'],
  ] as const)('shows actionable recovery for status %i without an automatic retry loop', async (status, guidance) => {
    const selected = thread({ thread_id: 'thread-explicit-recovery' });
    const failure = deferred<void>();
    let attempts = 0;
    const connectLiveStream = vi.fn(async function* (input: FlowerLiveStreamConnectInput): AsyncIterable<FlowerLiveStreamEnvelope> {
      const attempt = ++attempts;
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [selected] };
      if (attempt === 1) {
        await failure.promise;
        throw Object.assign(new Error('Private recovery diagnostic'), { status, code: 'unexpected_status' });
      }
      await waitForAbort(input);
    });
    const surface = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [selected]),
      loadThread: vi.fn(async () => liveBootstrap(selected, 9)), connectLiveStream });
    await waitFor(() => Boolean(surface.querySelector(`[data-thread-id="${selected.thread_id}"] button`)));
    selectThread(surface, selected.thread_id);
    await waitFor(() => surface.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === selected.thread_id && !surface.querySelector('main')?.hasAttribute('data-flower-pending-thread-id') && Boolean(surface.querySelector('.flower-composer textarea')));
    const editor = surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    editor.value = 'Preserve my recovery draft';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    failure.resolve();
    await waitFor(() => surface.querySelector('[data-flower-sync-state="failed"]') !== null);
    expect(surface.querySelector('.flower-workspace-sync')?.textContent).toContain(guidance);
    expect(surface.textContent).not.toContain('Private recovery diagnostic');
    await flush();
    expect(attempts).toBe(1);
    expect(editor.disabled).toBe(false);
    (surface.querySelector('.flower-workspace-sync button') as HTMLButtonElement).click();
    await waitFor(() => attempts === 2 && surface.querySelector('.flower-workspace-sync') === null);
    expect(editor.value).toBe('Preserve my recovery draft');
  });

  it('retains the displayed transcript while a reconnect delivers more baselines than the detail cache', async () => {
    const selected = thread({ thread_id: 'thread-selected-baseline', status: 'running' });
    const summaries = [selected, ...Array.from({ length: 23 }, (_, index) => thread({ thread_id: `thread-background-${index}`, title: `Background ${index}`, status: 'running' }))];
    const disconnect = deferred<void>(); const publishBaselines = deferred<void>(); const refresh = deferred<ReturnType<typeof liveBootstrap>>();
    let connections = 0;
    const loadThread = vi.fn(async () => connections > 1 ? refresh.promise : liveBootstrap(selected, 9));
    const surface = renderSurfaceWithAdapter({
      ...adapter(true), listThreads: vi.fn(async () => summaries), loadThread,
      connectLiveStream: async function* (input): AsyncIterable<FlowerLiveStreamEnvelope> {
        const connection = ++connections;
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries };
        if (connection === 1) { await disconnect.promise; return; }
        await publishBaselines.promise;
        for (const summary of summaries) yield { schema_version: 3, kind: 'thread.batch', thread_id: summary.thread_id, current: runtimeCurrentView(summary, 10) };
        await waitForAbort(input);
      },
    });
    await waitFor(() => Boolean(surface.querySelector(`[data-thread-id="${selected.thread_id}"] button`)));
    selectThread(surface, selected.thread_id);
    await waitFor(() => surface.textContent?.includes('Plan deploy') ?? false);
    const message = surface.querySelector('[data-flower-message-id]');
    disconnect.resolve();
    await waitFor(() => connections === 2);
    publishBaselines.resolve();
    await flush(); await flush();
    expect(surface.querySelector('.flower-thread-loading')).toBeNull();
    expect(surface.textContent).toContain('Plan deploy');
    expect(surface.querySelector('[data-flower-message-id]')).toBe(message);
    refresh.resolve(liveBootstrap(selected, 10));
    await flush();
    expect(loadThread).toHaveBeenCalledTimes(2);
  });

  it('keeps a valid empty conversation visible during a pending background refresh', async () => {
    const empty = thread({ thread_id: 'thread-empty-refresh', messages: [], status: 'idle', active_run_id: undefined });
    const stream = failedStream([empty]);
    const refresh = deferred<ReturnType<typeof liveBootstrap>>();
    const loadThread = vi.fn(async () => stream.attempts.length > 1 ? refresh.promise : liveBootstrap(empty, 9));
    const surface = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [empty]), loadThread, connectLiveStream: stream.connectLiveStream });
    await waitFor(() => Boolean(surface.querySelector(`[data-thread-id="${empty.thread_id}"] button`)));
    selectThread(surface, empty.thread_id);
    await waitFor(() => loadThread.mock.calls.length === 1 && !surface.querySelector('.flower-thread-loading'));
    stream.fail();
    await waitFor(() => Boolean(surface.querySelector('.flower-workspace-sync button')));
    (surface.querySelector('.flower-workspace-sync button') as HTMLButtonElement).click();
    await waitFor(() => loadThread.mock.calls.length === 2);
    expect(surface.querySelector('.flower-thread-loading')).toBeNull();
    expect(surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')?.disabled).toBe(false);
    refresh.resolve(liveBootstrap(empty, 10));
  });

  it('keeps a workspace failure visible without selection and through successful detail reads and navigation', async () => {
    const first = thread({ thread_id: 'thread-sync-first', title: 'First conversation' });
    const second = thread({ thread_id: 'thread-sync-second', title: 'Second conversation' });
    const stream = failedStream([first, second]);
    const loadThread = vi.fn(async (threadID: string) => liveBootstrap(threadID === first.thread_id ? first : second, 9));
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => ({ client_request_id: input.client_request_id, thread_id: second.thread_id }));
    const surface = renderSurfaceWithAdapter({
      ...adapter(true), listThreads: vi.fn(async () => [first, second]), loadThread, launchTurn,
      connectLiveStream: stream.connectLiveStream,
    });
    await waitFor(() => stream.connectLiveStream.mock.calls.length === 1);
    stream.fail();
    await waitFor(() => surface.querySelector('[data-flower-sync-state="failed"]') !== null);
    expect(surface.querySelector('.flower-workspace-sync')?.textContent).toContain(syncFailure);
    expect(surface.querySelector('.flower-workspace-sync button')?.textContent).toBe('Resync');
    expect(surface.textContent).not.toContain('internal encoding diagnostic');

    for (const selected of [first, second]) {
      await waitFor(() => Boolean(surface.querySelector(`[data-thread-id="${selected.thread_id}"] button`)));
      selectThread(surface, selected.thread_id);
      await waitFor(() => loadThread.mock.calls.some(([threadID]) => threadID === selected.thread_id)
        && surface.querySelector('main')?.getAttribute('data-flower-selected-thread-loading') === 'false');
      expect(surface.querySelector('[data-flower-sync-state="failed"]')?.textContent).toContain(syncFailure);
      expect(surface.textContent).toContain('Plan deploy');
    }
    const editor = surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    editor.value = 'Send while live updates are unavailable';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => !surface.querySelector<HTMLButtonElement>('.flower-composer-submit')!.disabled);
    surface.querySelector<HTMLButtonElement>('.flower-composer-submit')!.click();
    await waitFor(() => launchTurn.mock.calls.length === 1 && editor.value === ''
      && surface.querySelector<HTMLButtonElement>('.flower-composer-submit')?.getAttribute('aria-busy') !== 'true');
    expect(surface.querySelector('[data-flower-transport-delivery="accepted"]')).toBeNull();
    expect(launchTurn).toHaveBeenCalledTimes(1);
    expect(surface.querySelector('[data-flower-sync-state="failed"]')?.textContent).toContain(syncFailure);
    expect(stream.connectLiveStream).toHaveBeenCalledTimes(1);
  });

  it('keeps the same workspace recovery entry visible in Companion and an approval surface', async () => {
    const waiting = thread({ thread_id: 'thread-sync-approval', status: 'waiting_approval', approval_actions: [{
      action_id: 'approval-sync', origin: 'main_tool', run_id: 'run-sync', tool_id: 'tool-sync', tool_name: 'terminal.exec',
      state: 'requested', status: 'pending', requested_at_ms: 20_000, can_approve: true,
      surface_role: 'primary_action', summary: { label: 'Review deployment', command: 'printf approval' },
    }] });
    const stream = failedStream([waiting]);
    const surface = renderSurfaceWithAdapterProps({
      ...adapter(true), listThreads: vi.fn(async () => [waiting]), loadThread: vi.fn(async () => liveBootstrap(waiting, 9)),
      connectLiveStream: stream.connectLiveStream,
    }, { presentation: 'companion', companionOpen: true, engaged: true, transcriptVisible: true });
    await waitFor(() => Boolean(surface.querySelector(`[data-thread-id="${waiting.thread_id}"] button`)));
    selectThread(surface, waiting.thread_id);
    await waitFor(() => surface.querySelector('[data-flower-bottom-mode="approval"]') !== null);
    stream.fail();
    await waitFor(() => surface.querySelector('[data-flower-sync-state="failed"]') !== null);
    expect(surface.querySelector('.flower-workspace-sync')?.textContent).toContain(syncFailure);
    expect(surface.querySelector('[data-flower-bottom-mode="approval"]')).not.toBeNull();
    expect(surface.querySelector('.flower-composer-stop-thread')?.hasAttribute('disabled')).toBe(false);
    expect(surface.querySelector('.flower-composer-approval-decision')?.hasAttribute('disabled')).toBe(false);
  });

  it('resynchronizes repeated recovery clicks through one owner while retaining the current draft', async () => {
    const selected = thread({ thread_id: 'thread-sync-draft' });
    const stream = failedStream([selected]);
    const loadThread = vi.fn(async () => liveBootstrap(selected, 9));
    const surface = renderSurfaceWithAdapter({
      ...adapter(true), listThreads: vi.fn(async () => [selected]), loadThread,
      connectLiveStream: stream.connectLiveStream,
    });
    await waitFor(() => Boolean(surface.querySelector(`[data-thread-id="${selected.thread_id}"] button`)));
    selectThread(surface, selected.thread_id);
    await waitFor(() => surface.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === selected.thread_id && !surface.querySelector('main')?.hasAttribute('data-flower-pending-thread-id') && Boolean(surface.querySelector('.flower-composer textarea')));
    const editor = surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    editor.value = 'Keep this recovery draft';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    stream.fail();
    await waitFor(() => surface.querySelector('[data-flower-sync-state="failed"]') !== null);
    const readsBeforeRecovery = loadThread.mock.calls.length;
    const resync = surface.querySelector('.flower-workspace-sync button') as HTMLButtonElement;
    resync.click(); resync.click(); resync.click();
    await waitFor(() => stream.connectLiveStream.mock.calls.length >= 2 && surface.querySelector('.flower-workspace-sync') === null);
    await waitFor(() => loadThread.mock.calls.length > readsBeforeRecovery);
    expect(stream.attempts[0].signal.aborted).toBe(true);
    expect(stream.attempts.filter((attempt) => !attempt.signal.aborted)).toHaveLength(1);
    expect(surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')?.value).toBe('Keep this recovery draft');
    expect(surface.textContent).toContain('Plan deploy');
  });

  it('does not apply a late current from a replaced connection', async () => {
    const selected = thread({ thread_id: 'thread-sync-late', status: 'running' });
    const late = deferred<void>();
    const attempts: FlowerLiveStreamConnectInput[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, timeout, ...args) => {
      // Settings and stream reads share the same deadline; only unresolved waits expire.
      const delay = timeout === 15_000 ? 30 : timeout;
      return originalSetTimeout(handler, delay, ...args);
    });
    onTestFinished(() => timer.mockRestore());
    const connectLiveStream = vi.fn(async function* (input: FlowerLiveStreamConnectInput): AsyncIterable<FlowerLiveStreamEnvelope> {
      attempts.push(input);
      const attempt = attempts.length;
      if (attempt === 1) {
        await late.promise;
        yield { schema_version: 3, kind: 'thread.batch', thread_id: selected.thread_id,
          current: { ...runtimeCurrentView(selected, 99), items: [{ id: 'late-answer', turn_id: 'turn-1', run_id: selected.active_run_id!, ordinal: 2, kind: 'assistant', text: 'Obsolete connection output' }] } };
      } else yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [selected] };
      await waitForAbort(input);
    });
    const loadThread = vi.fn(async () => liveBootstrap(selected, 9));
    const surface = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [selected]), loadThread, connectLiveStream });
    await waitFor(() => connectLiveStream.mock.calls.length === 2 && surface.querySelector('.flower-warmup') === null);
    selectThread(surface, selected.thread_id);
    await waitFor(() => surface.textContent?.includes('Plan deploy') ?? false);
    expect(attempts[0].signal.aborted).toBe(true);
    late.resolve();
    await flush();
    await flush();
    expect(surface.textContent).not.toContain('Obsolete connection output');
    expect(attempts.filter((attempt) => !attempt.signal.aborted)).toHaveLength(1);
  });

  it('releases Stop after accepted cancellation cannot be confirmed and preserves the recovery notice', async () => {
    const running = thread({ thread_id: 'thread-stop-unconfirmed', status: 'running' });
    const stream = failedStream([running]);
    const stopAccepted = deferred<void>();
    let stopping = false;
    const stopThread = vi.fn(async () => { await stopAccepted.promise; stopping = true; });
    const loadThread = vi.fn(async () => {
      if (stopping) throw new Error('canonical read unavailable');
      return liveBootstrap(running, 9);
    });
    const surface = renderSurfaceWithAdapter({
      ...adapter(true), listThreads: vi.fn(async () => [running]), loadThread, stopThread,
      connectLiveStream: stream.connectLiveStream,
    });
    await waitFor(() => Boolean(surface.querySelector(`[data-thread-id="${running.thread_id}"] button`)));
    selectThread(surface, running.thread_id);
    await waitFor(() => surface.querySelector<HTMLButtonElement>('.flower-composer-submit')?.getAttribute('aria-label') === 'Stop');
    stream.fail();
    await waitFor(() => surface.querySelector('[data-flower-sync-state="failed"]') !== null);
    const stop = surface.querySelector<HTMLButtonElement>('.flower-composer-submit')!;
    stop.click(); stop.click();
    await waitFor(() => stopThread.mock.calls.length === 1);
    expect(stop.disabled).toBe(true);
    stopAccepted.resolve();
    await waitFor(() => surface.querySelector('.flower-workspace-sync')?.textContent?.includes(stopUnconfirmed) ?? false);
    await waitFor(() => !surface.querySelector<HTMLButtonElement>('.flower-composer-submit')!.disabled);
    expect(surface.querySelector<HTMLButtonElement>('.flower-composer-submit')?.getAttribute('aria-label')).toBe('Stop');
    expect(surface.querySelector('.flower-workspace-sync button')?.textContent).toBe('Resync');
    expect(surface.textContent).toContain('Plan deploy');
    expect(surface.textContent).not.toContain('canonical read unavailable');
  });

  it('accepts a lower fresh SubAgent version after resynchronization and ignores the previous epoch detail read', async () => {
    const child = subagentSummary({ parent_thread_id: 'parent-sync-epoch', thread_id: 'child-sync-epoch', status: 'completed' });
    const parent = thread({ thread_id: child.parent_thread_id, subagents: [child] });
    const firstDetail = deferred<FlowerSubagentDetail>();
    const publishChild = deferred<void>();
    const failure = deferred<void>();
    const attempts: FlowerLiveStreamConnectInput[] = [];
    const childCurrent = (text: string, version: number): FlowerRuntimeCurrentView => ({
      thread_id: child.thread_id, view_version: version, activity: 'idle', turn_id: 'child-turn-sync', last_outcome: 'completed',
      items: [{ id: `child-answer-${version}`, turn_id: 'child-turn-sync', run_id: 'child-run-sync', ordinal: 1, kind: 'assistant', text }],
    });
    const loadSubagentDetail = vi.fn()
      .mockImplementationOnce(() => firstDetail.promise)
      .mockResolvedValue(subagentDetail({ summary: child, current: childCurrent('Fresh child result after server restart', 1) }));
    const connectLiveStream = vi.fn(async function* (input: FlowerLiveStreamConnectInput): AsyncIterable<FlowerLiveStreamEnvelope> {
      attempts.push(input);
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [parent] };
      if (attempts.length === 1) {
        await publishChild.promise;
        yield { schema_version: 3, kind: 'thread.batch', thread_id: parent.thread_id,
          subagent_current: childCurrent('Previous server child version fifty', 50) };
        await failure.promise;
        throw encodingFailure();
      }
      await waitForAbort(input);
    });
    let selectionCommitted = false;
    const surface = renderSurfaceWithAdapterProps({
      ...adapter(true), listThreads: vi.fn(async () => [parent]), loadThread: vi.fn(async () => liveBootstrap(parent, 9)),
      loadSubagentDetail, connectLiveStream,
    }, { onThreadSelectionEvent: event => { if (event.phase === 'committed') selectionCommitted = true; } });
    await waitFor(() => surface.querySelector(`[data-thread-id="${parent.thread_id}"] button`) !== null);
    selectThread(surface, parent.thread_id);
    await waitFor(() => selectionCommitted && surface.querySelector('[data-flower-subagent-count]')?.getAttribute('data-flower-subagent-count') === '1');
    (surface.querySelector('button[aria-controls="flower-subagents-dropdown"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-disclosure]')));
    document.querySelector<HTMLButtonElement>('[data-flower-subagent-disclosure]')!.click();
    await waitFor(() => document.querySelector('[data-flower-subagent-row="0"]') !== null);
    (document.querySelector('[data-flower-subagent-row="0"]') as HTMLButtonElement).click();
    await waitFor(() => loadSubagentDetail.mock.calls.length === 1);
    publishChild.resolve();
    await waitFor(() => document.body.textContent?.includes('Previous server child version fifty') ?? false);
    failure.resolve();
    await waitFor(() => surface.querySelector('[data-flower-sync-state="failed"]') !== null);
    const dialogRecovery = document.querySelector('[data-flower-subagent-detail="open"] .flower-workspace-sync');
    expect(dialogRecovery?.textContent).toContain(syncFailure);
    expect(dialogRecovery?.querySelector('button')?.textContent).toBe('Resync');
    (surface.querySelector('.flower-workspace-sync button') as HTMLButtonElement).click();
    await waitFor(() => loadSubagentDetail.mock.calls.length === 2);
    await waitFor(() => document.body.textContent?.includes('Fresh child result after server restart') ?? false);
    firstDetail.resolve(subagentDetail({ summary: child, current: childCurrent('Late obsolete child detail', 99) }));
    await flush();
    await flush();
    expect(document.body.textContent).not.toContain('Previous server child version fifty');
    expect(document.body.textContent).not.toContain('Late obsolete child detail');
    expect(document.querySelector('[data-flower-subagent-detail="open"]')).not.toBeNull();
    expect(loadSubagentDetail).toHaveBeenCalledTimes(2);
  });
});


describe('Canonical managed facts on the existing workspace transport', () => {
 const sourceUsage = { confirmed: { available:true, measured:true, characters_available:true, phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1, input_tokens: 100, context_window_tokens: 1000,
  characters: { source: 'prepared_characters_v1', unit: 'unicode_code_points', total_characters: (60), categories: [{ category: 'model_context', characters: 60, details: [{ key: 'skills', characters: 60 }] }] } } } as const;

 it.each([false, true])('updates background detail without changing selection (with current: %s)', async withCurrent => {
  const first = thread({ thread_id: 'facts-background-first', title: 'First conversation' });
  const second = thread({ thread_id: 'facts-background-second', title: 'Second conversation' });
  const publish = deferred<void>();
  const facts = { snapshot: { sections: [{ key: 'skills', title: 'Skills', text: 'Background catalog changed' }] }, entry_id: 'facts-background', path_depth: 1,
   turn_id: 'turn-facts', run_id: 'run-facts', updated_at: '2026-10-15T12:00:00Z', changed_keys: ['skills'], removed_keys: [] };
  const connectLiveStream = vi.fn(async function* (input: FlowerLiveStreamConnectInput): AsyncIterable<FlowerLiveStreamEnvelope> {
   yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [first, second] };
   await publish.promise;
   yield { schema_version: 3, kind: 'thread.batch', thread_id: second.thread_id,
    ...(withCurrent ? { current: liveBootstrap(second).current } : {}), model_context: facts, context_usage: sourceUsage };
   await waitForAbort(input);
  });
  const surface = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [first, second]),
   loadThread: vi.fn(async (id: string) => liveBootstrap(id === first.thread_id ? first : second)), connectLiveStream });
  await waitFor(() => Boolean(surface.querySelector('[data-thread-id="facts-background-first"] button')));
  selectThread(surface, second.thread_id);
  await waitFor(() => surface.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === second.thread_id
    && !surface.querySelector('main')?.hasAttribute('data-flower-pending-thread-id')
    && surface.querySelector('main')?.getAttribute('data-flower-selected-thread-loading') === 'false');
  selectThread(surface, first.thread_id);
  await waitFor(() => surface.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === first.thread_id
    && !surface.querySelector('main')?.hasAttribute('data-flower-pending-thread-id')
    && surface.querySelector('main')?.getAttribute('data-flower-selected-thread-loading') === 'false');
  publish.resolve(); await flush();
  expect(surface.querySelector('.flower-model-context-details')?.textContent ?? '').not.toContain('Background catalog changed');
  selectThread(surface, second.thread_id);
  await waitFor(() => !surface.querySelector('.flower-thread-loading') && Boolean(surface.querySelector('[role="progressbar"]')));
  await flush();
  const contextTrigger = surface.querySelector('[role="progressbar"]') as HTMLElement;
  contextTrigger.focus();
  const panel = document.getElementById(contextTrigger.getAttribute('aria-controls')!)!;
  await waitFor(() => panel.querySelector('[data-category="skills"]')?.textContent?.includes('60 chars') ?? false);
  expect(document.activeElement).toBe(contextTrigger);
  expect(surface.textContent).not.toContain('Background catalog changed');
  expect(surface.querySelectorAll('.flower-user-message')).toHaveLength(0);
  expect(connectLiveStream).toHaveBeenCalledTimes(1);
 });
 it('accepts child facts at an unchanged canonical view version', async () => {
  const child = subagentSummary({ parent_thread_id: 'facts-parent', thread_id: 'facts-child', status: 'completed' });
  const parent = thread({ thread_id: child.parent_thread_id, subagents: [child] });
  const detail = subagentDetail({ summary: child, current: { thread_id: child.thread_id, view_version: 4, activity: 'idle', items: [] } });
  const publish = deferred<void>();
  const clear = deferred<void>();
  const stale = deferred<void>();
  const facts = { snapshot: { sections: [{ key: 'skills', title: 'Skills', text: 'Current child catalog' }] }, entry_id: 'child-facts', path_depth: 1,
   turn_id: 'turn-child', run_id: 'run-child', updated_at: '2026-10-15T12:00:00Z', changed_keys: ['skills'], removed_keys: [] };
  const connectLiveStream = vi.fn(async function* (input: FlowerLiveStreamConnectInput): AsyncIterable<FlowerLiveStreamEnvelope> {
   yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [parent] };
   await publish.promise;
   yield { schema_version: 3, kind: 'thread.batch', thread_id: parent.thread_id, subagent_current: detail.current, model_context: facts, context_usage: sourceUsage };
   await clear.promise;
   yield { schema_version: 3, kind: 'thread.batch', thread_id: parent.thread_id, subagent_current: detail.current, model_context: null, context_usage: null, context_compactions: [], timeline_decorations: [] };
   await stale.promise;
   yield { schema_version: 3, kind: 'thread.batch', thread_id: parent.thread_id, subagent_current: { ...detail.current, view_version: 3 }, model_context: facts, context_usage: sourceUsage };
   await waitForAbort(input);
  });
  const loadThread = vi.fn(async () => liveBootstrap(parent));
  const surface = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [parent]), loadThread,
   loadSubagentDetail: vi.fn(async () => detail), connectLiveStream });
  await waitFor(() => Boolean(surface.querySelector('[data-thread-id="facts-parent"] button')));
  selectThread(surface, parent.thread_id);
  await waitFor(() => loadThread.mock.calls.length > 0 && !surface.querySelector('.flower-thread-loading'));
  await waitFor(() => surface.querySelector('[data-flower-subagent-count]')?.getAttribute('data-flower-subagent-count') === '1');
  (surface.querySelector('button[aria-controls="flower-subagents-dropdown"]') as HTMLButtonElement).click();
  await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-disclosure]')));
  document.querySelector<HTMLButtonElement>('[data-flower-subagent-disclosure]')!.click();
  await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-row="0"]')));
  (document.querySelector('[data-flower-subagent-row="0"]') as HTMLButtonElement).click();
  await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-detail="open"]')));
  await flush();publish.resolve();
  await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-detail="open"] [role="progressbar"]')));
  const contextTrigger = document.querySelector<HTMLElement>('[data-flower-subagent-detail="open"] [role="progressbar"]')!;
  contextTrigger.focus();
  const panel = document.getElementById(contextTrigger.getAttribute('aria-controls')!)!;
  await waitFor(() => panel.querySelector('[data-category="skills"]')?.textContent?.includes('60 chars') ?? false);
  expect(document.body.textContent).not.toContain('Current child catalog');
  expect(surface.querySelector('.flower-composer [data-category="skills"]')).toBeNull();
  clear.resolve();
  await waitFor(() => !document.querySelector('[data-flower-subagent-detail="open"] [role="progressbar"]'));
  stale.resolve();
  await flush(); await flush();
  expect(document.querySelector('[data-flower-subagent-detail="open"] [role="progressbar"]')).toBeNull();
 });
});


it('bounds a stalled Stop, preserves navigation and drafts, and confirms before another attempt', async () => {
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  const running = thread({ thread_id: 'thread-stalled-stop', status: 'running' });
  const other = thread({ thread_id: 'thread-other', title: 'Other chat' });
  const pending = deferred<void>();
  const stopThread = vi.fn(() => pending.promise);
  const loadThread = vi.fn(async (id: string) => liveBootstrap(id === other.thread_id ? other : running, 9));
  const [focus, setFocus] = createSignal({ request_id: 'initial', thread_id: running.thread_id });
  const surface = renderSurfaceWithAdapterProps({ ...adapter(),
    listThreads: vi.fn(async () => [running, other]), loadThread, stopThread,
  }, { get focusThreadRequest() { return focus(); } });
  await waitFor(() => surface.querySelector<HTMLButtonElement>('.flower-composer-submit')?.getAttribute('aria-label') === 'Stop');
  let expire!: () => void;
  const nativeSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, timeout, ...args) => {
    if (timeout === 120_000) { expire = () => (handler as () => void)(); }
    return nativeSetTimeout(handler, timeout, ...args);
  });
  surface.querySelector<HTMLButtonElement>('.flower-composer-submit')!.click();
  await waitFor(() => stopThread.mock.calls.length === 1 && Boolean(expire));
  setFocus({ request_id: 'leave', thread_id: other.thread_id });
  await waitFor(() => surface.textContent?.includes('Other chat') === true);
  const editor = surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  editor.value = 'Keep my draft';
  editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expire();
  await waitFor(() => surface.querySelector('.flower-workspace-sync')?.textContent?.includes(stopUnconfirmed) === true);
  pending.resolve();
  await flush();
  expect(surface.textContent).toContain('Other chat');
  expect(editor.value).toBe('Keep my draft');
  expect(stopThread).toHaveBeenCalledTimes(1);
  setFocus({ request_id: 'back', thread_id: running.thread_id });
  await waitFor(() => surface.querySelector<HTMLButtonElement>('.flower-composer-submit')?.getAttribute('aria-label') === 'Stop');
  expect(surface.querySelector<HTMLButtonElement>('.flower-composer-submit')!.disabled).toBe(false);
  const stopped = thread({ ...running, status: 'idle', active_run_id: undefined, run_progress: undefined, current_execution: undefined });
  loadThread.mockImplementation(async (id: string) => liveBootstrap(id === running.thread_id ? stopped : other, 10));
  surface.querySelector<HTMLButtonElement>('.flower-composer-submit')!.click();
  await waitFor(() => surface.querySelector<HTMLButtonElement>('.flower-composer-submit')?.getAttribute('aria-label') !== 'Stop');
  expect(stopThread).toHaveBeenCalledTimes(1);
});


it('bounds Stop confirmation reads and ignores their late terminal detail', async () => {
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  const running = thread({ thread_id: 'thread-stop-detail-timeout', status: 'running' });
  const confirmation = deferred<ReturnType<typeof liveBootstrap>>();
  let stopped = false;
  const loadThread = vi.fn(async () => stopped ? confirmation.promise : liveBootstrap(running, 9));
  const stopThread = vi.fn(async () => { stopped = true; });
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: vi.fn(async () => [running]), loadThread, stopThread },
    { focusThreadRequest: { request_id: 'detail-timeout', thread_id: running.thread_id } });
  await waitFor(() => surface.querySelector<HTMLButtonElement>('.flower-composer-submit')?.getAttribute('aria-label') === 'Stop');
  let expire!: () => void;
  const nativeSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, timeout, ...args) => {
    if (timeout === 15_000) expire = () => (handler as () => void)();
    return nativeSetTimeout(handler, timeout, ...args);
  });
  surface.querySelector<HTMLButtonElement>('.flower-composer-submit')!.click();
  await waitFor(() => stopThread.mock.calls.length === 1 && Boolean(expire));
  expire();
  await waitFor(() => surface.querySelector('.flower-workspace-sync')?.textContent?.includes(stopUnconfirmed) === true);
  expect(surface.querySelector<HTMLButtonElement>('.flower-composer-submit')!.disabled).toBe(false);
  expect(surface.querySelector('.flower-workspace-sync button')?.textContent).toBe('Resync');
  confirmation.resolve(liveBootstrap(thread({ ...running, status: 'success', error: undefined }), 10));
  await flush();
  expect(surface.querySelector<HTMLButtonElement>('.flower-composer-submit')?.getAttribute('aria-label')).toBe('Stop');
  expect(stopThread).toHaveBeenCalledTimes(1);
});
