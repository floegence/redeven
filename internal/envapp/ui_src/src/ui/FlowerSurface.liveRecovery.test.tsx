// @vitest-environment jsdom

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
const stopUnconfirmed = 'Stop submitted; status has not synchronized. Resync to confirm.';

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
    yield { schema_version: 1, kind: 'ready', summaries };
    if (attempts.length === 1) {
      await firstFailure.promise;
      throw encodingFailure();
    }
    await waitForAbort(input);
  });
  return { connectLiveStream, attempts, fail: () => firstFailure.resolve() };
}

describe('Flower workspace synchronization recovery', () => {
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
        yield { schema_version: 1, kind: 'ready', summaries };
        if (connection === 1) { await disconnect.promise; return; }
        await publishBaselines.promise;
        for (const summary of summaries) yield { schema_version: 1, kind: 'thread.batch', thread_id: summary.thread_id, current: runtimeCurrentView(summary, 10) };
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
    await waitFor(() => Boolean(surface.querySelector('.flower-composer textarea')));
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
    let shortenFirstHandshake = true;
    const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, timeout, ...args) => {
      const delay = shortenFirstHandshake && timeout === 15_000 ? 30 : timeout;
      if (delay === 30) shortenFirstHandshake = false;
      return originalSetTimeout(handler, delay, ...args);
    });
    onTestFinished(() => timer.mockRestore());
    const connectLiveStream = vi.fn(async function* (input: FlowerLiveStreamConnectInput): AsyncIterable<FlowerLiveStreamEnvelope> {
      attempts.push(input);
      const attempt = attempts.length;
      if (attempt === 1) {
        await late.promise;
        yield { schema_version: 1, kind: 'thread.batch', thread_id: selected.thread_id,
          current: { ...runtimeCurrentView(selected, 99), items: [{ id: 'late-answer', turn_id: 'turn-1', run_id: selected.active_run_id!, ordinal: 2, kind: 'assistant', text: 'Obsolete connection output' }] } };
      } else yield { schema_version: 1, kind: 'ready', summaries: [selected] };
      await waitForAbort(input);
    });
    const loadThread = vi.fn(async () => liveBootstrap(selected, 9));
    const surface = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [selected]), loadThread, connectLiveStream });
    await waitFor(() => Boolean(surface.querySelector(`[data-thread-id="${selected.thread_id}"] button`)));
    await waitFor(() => surface.querySelector('[data-flower-sync-state="failed"]') !== null);
    (surface.querySelector('.flower-workspace-sync button') as HTMLButtonElement).click();
    await waitFor(() => connectLiveStream.mock.calls.length === 2 && surface.querySelector('.flower-workspace-sync') === null);
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
      yield { schema_version: 1, kind: 'ready', summaries: [parent] };
      if (attempts.length === 1) {
        await publishChild.promise;
        yield { schema_version: 1, kind: 'thread.batch', thread_id: parent.thread_id,
          subagent_current: childCurrent('Previous server child version fifty', 50) };
        await failure.promise;
        throw encodingFailure();
      }
      await waitForAbort(input);
    });
    const surface = renderSurfaceWithAdapter({
      ...adapter(true), listThreads: vi.fn(async () => [parent]), loadThread: vi.fn(async () => liveBootstrap(parent, 9)),
      loadSubagentDetail, connectLiveStream,
    });
    await waitFor(() => surface.querySelector(`[data-thread-id="${parent.thread_id}"] button`) !== null);
    selectThread(surface, parent.thread_id);
    await waitFor(() => surface.querySelector('button[aria-controls="flower-subagents-dropdown"]') !== null);
    (surface.querySelector('button[aria-controls="flower-subagents-dropdown"]') as HTMLButtonElement).click();
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
