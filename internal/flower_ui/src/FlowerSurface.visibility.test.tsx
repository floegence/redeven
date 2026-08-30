// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  FlowerLiveStreamConnectInput,
  FlowerLiveStreamEnvelope,
} from './contracts/flowerSurfaceContracts';
import type { FlowerCompanionPresenceProjection } from './flowerCompanionPresence';
import {
  adapter,
  flush,
  liveBootstrap,
  readStatus,
  renderSurfaceWithAdapter,
  renderSurfaceWithAdapterProps,
  thread,
  waitFor,
} from '../../envapp/ui_src/src/ui/FlowerSurface.navigation.testHarness';

function setDocumentVisible(visible: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visible ? 'visible' : 'hidden',
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function waitForAbort(input: FlowerLiveStreamConnectInput): Promise<void> {
  if (input.signal.aborted) return;
  await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }));
}

function controlledWorkspaceStream(initial: readonly FlowerLiveStreamEnvelope[]) {
  const queued = [...initial];
  let wake: (() => void) | undefined;
  return {
    push(value: FlowerLiveStreamEnvelope) {
      queued.push(value);
      wake?.();
      wake = undefined;
    },
    async *connect(input: FlowerLiveStreamConnectInput): AsyncIterable<FlowerLiveStreamEnvelope> {
      while (!input.signal.aborted) {
        const value = queued.shift();
        if (value) {
          yield value;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          input.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
    },
  };
}

function latestPresence(
  presences: readonly FlowerCompanionPresenceProjection[],
  predicate: (presence: FlowerCompanionPresenceProjection) => boolean,
): FlowerCompanionPresenceProjection | undefined {
  return [...presences].reverse().find(predicate);
}

afterEach(() => setDocumentVisible(true));

describe('Flower workspace stream visibility', () => {
  it('keeps one Desktop workspace SSE while the document is hidden', async () => {
    const connectLiveStream = vi.fn(async function* (input: FlowerLiveStreamConnectInput) {
      yield { schema_version: 1 as const, kind: 'ready' as const, summaries: [] };
      await waitForAbort(input);
    });
    renderSurfaceWithAdapter({
      ...adapter(true),
      keepLiveWhenHidden: true,
      connectLiveStream,
    });

    await waitFor(() => connectLiveStream.mock.calls.length === 1);
    setDocumentVisible(false);
    await flush();
    setDocumentVisible(true);
    await flush();

    expect(connectLiveStream).toHaveBeenCalledTimes(1);
  });

  it('preserves cached detail while a Web workspace stream reconnects', async () => {
    const cached = thread({
      thread_id: 'thread-visible-cache',
      title: 'Visible cache',
      messages: [{
        id: 'message-visible-cache',
        role: 'assistant',
        content: 'Cached transcript remains visible.',
        status: 'complete',
        created_at_ms: 2,
      }],
    });
    const connectLiveStream = vi.fn(async function* (input: FlowerLiveStreamConnectInput) {
      yield { schema_version: 1 as const, kind: 'ready' as const, summaries: [cached] };
      await waitForAbort(input);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      keepLiveWhenHidden: false,
      listThreads: vi.fn(async () => [cached]),
      loadThread: vi.fn(async () => liveBootstrap(cached, 9)),
      connectLiveStream,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-visible-cache"] button')));
    (runtime.querySelector('[data-thread-id="thread-visible-cache"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Cached transcript remains visible.') ?? false);

    setDocumentVisible(false);
    await flush();
    expect(runtime.textContent).toContain('Cached transcript remains visible.');
    setDocumentVisible(true);
    await waitFor(() => connectLiveStream.mock.calls.length === 2);
    expect(runtime.textContent).toContain('Cached transcript remains visible.');
  });

  it('projects typed-current assistant output from the one workspace stream even when summaries omit detail and title', async () => {
    const threadID = 'thread-companion-live-tail';
    const turnID = 'turn-companion-live-tail';
    const runID = 'run-companion-live-tail';
    const summary = thread({
      thread_id: threadID,
      title: '',
      title_status: 'unset',
      status: 'running',
      active_run_id: runID,
      run_progress: { phase: 'streaming', run_id: runID, turn_id: turnID },
      messages: [],
    });
    const stream = controlledWorkspaceStream([{
      schema_version: 1,
      kind: 'ready',
      summaries: [summary],
    }]);
    const connectLiveStream = vi.fn(stream.connect);
    const presences: FlowerCompanionPresenceProjection[] = [];
    renderSurfaceWithAdapterProps({
      ...adapter(true),
      listThreads: vi.fn(async () => [summary]),
      connectLiveStream,
    }, {
      presentation: 'companion',
      companionPresenceOwner: true,
      onPresenceChange: (presence) => presences.push(presence),
    });

    await waitFor(() => presences.some((presence) => presence.priority_thread_id === threadID));
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        thread_id: threadID,
        view_version: 1,
        activity: 'active',
        run_id: runID,
        turn_id: turnID,
        run_progress: { phase: 'streaming' },
        items: [
          { id: 'user-live-tail', turn_id: turnID, run_id: 'run-fixture', ordinal: 1, kind: 'user', text: 'Report progress' },
          { id: 'assistant-live-tail', turn_id: turnID, run_id: 'run-fixture', ordinal: 2, kind: 'assistant', text: 'The first visible tokens', live: true },
        ],
      },
    });
    await waitFor(() => presences.some((presence) => presence.priority_thread_progress === 'The first visible tokens'));
    const first = latestPresence(presences, (presence) => presence.priority_thread_progress === 'The first visible tokens');
    expect(first).toMatchObject({
      priority_status: 'running',
      priority_thread_id: threadID,
      priority_run_id: runID,
      priority_thread_progress_kind: 'output',
    });
    expect(first?.priority_run_generation).toBeGreaterThan(0);

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        thread_id: threadID,
        view_version: 2,
        activity: 'active',
        run_id: runID,
        turn_id: turnID,
        run_progress: { phase: 'streaming' },
        items: [
          { id: 'user-live-tail', turn_id: turnID, run_id: 'run-fixture', ordinal: 1, kind: 'user', text: 'Report progress' },
          { id: 'assistant-live-tail', turn_id: turnID, run_id: 'run-fixture', ordinal: 2, kind: 'assistant', text: 'The first visible tokens now include the newest output', live: true },
        ],
      },
    });
    await waitFor(() => presences.some((presence) => presence.priority_thread_progress?.endsWith('the newest output') ?? false));
    expect(connectLiveStream).toHaveBeenCalledTimes(1);
  });

  it('emits one matching terminal receipt and keeps a safe failure visible until canonical read state clears it', async () => {
    const threadID = 'thread-companion-failure';
    const turnID = 'turn-companion-failure';
    const runID = 'run-companion-failure';
    const running = thread({
      thread_id: threadID,
      title: 'Validate deployment',
      status: 'running',
      active_run_id: runID,
      run_progress: { phase: 'preparing', run_id: runID, turn_id: turnID },
      messages: [],
      read_status: readStatus(false, 1, 'running'),
    });
    const failed = thread({
      ...running,
      status: 'failed',
      active_run_id: undefined,
      run_progress: null,
      read_status: readStatus(true, 3, 'failed'),
    });
    const stream = controlledWorkspaceStream([{ schema_version: 1, kind: 'ready', summaries: [running] }]);
    const connectLiveStream = vi.fn(stream.connect);
    const presences: FlowerCompanionPresenceProjection[] = [];
    renderSurfaceWithAdapterProps({
      ...adapter(true),
      listThreads: vi.fn(async () => [running]),
      connectLiveStream,
    }, {
      presentation: 'companion',
      companionPresenceOwner: true,
      onPresenceChange: (presence) => presences.push(presence),
    });

    await waitFor(() => presences.some((presence) => presence.priority_thread_id === threadID));
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        thread_id: threadID,
        view_version: 1,
        activity: 'active',
        run_id: runID,
        turn_id: turnID,
        run_progress: { phase: 'preparing' },
      },
    });
    await waitFor(() => presences.some((presence) => Number.isFinite(presence.priority_run_generation)));
    const generation = latestPresence(presences, (presence) => Number.isFinite(presence.priority_run_generation))?.priority_run_generation;

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        thread_id: threadID,
        view_version: 2,
        activity: 'idle',
        run_id: runID,
        turn_id: turnID,
        last_outcome: 'failed',
        error: 'Raw provider response must not be shown in the collapsed bar.',
        run_error_code: 'provider_rate_limited',
      },
    });
    await waitFor(() => presences.some((presence) => presence.terminal_transition?.outcome === 'failed'));
    const terminalPresence = latestPresence(presences, (presence) => presence.terminal_transition?.outcome === 'failed');
    expect(terminalPresence?.terminal_transition).toEqual({
      thread_id: threadID,
      run_id: runID,
      run_generation: generation,
      outcome: 'failed',
    });

    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [failed] });
    await waitFor(() => presences.some((presence) => presence.priority_status === 'failed'));
    const visibleFailure = latestPresence(presences, (presence) => presence.priority_status === 'failed');
    expect(visibleFailure).toMatchObject({
      priority_thread_id: threadID,
      priority_thread_progress_kind: 'error',
      unread_failed_count: 1,
    });
    expect(visibleFailure?.priority_thread_progress).toContain('rate limiting');
    expect(visibleFailure?.priority_thread_progress).not.toContain('Raw provider response');

    stream.push({
      schema_version: 1,
      kind: 'viewer.read_state',
      thread_id: threadID,
      read_status: readStatus(false, 3, 'failed'),
    });
    await waitFor(() => presences.at(-1)?.priority_status === 'idle');
    expect(presences.at(-1)).toMatchObject({ unread_failed_count: 0 });
    expect(connectLiveStream).toHaveBeenCalledTimes(1);
  });
});
