import { describe, expect, it, vi } from 'vitest';

import type { FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  inputRequest,
  liveBootstrap,
  renderSurfaceWithAdapter,
  runtimeCurrentView,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

function controlledWorkspaceStream(initial: readonly FlowerLiveStreamEnvelope[]) {
  const queued = [...initial];
  let wake: (() => void) | undefined;
  return {
    push(value: FlowerLiveStreamEnvelope) {
      queued.push(value);
      wake?.();
      wake = undefined;
    },
    async *connect({ signal }: Readonly<{ signal: AbortSignal }>): AsyncIterable<FlowerLiveStreamEnvelope> {
      while (!signal.aborted) {
        const value = queued.shift();
        if (value) {
          yield value;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
    },
  };
}

describe('Flower final thread cache and workspace transport', () => {
  it('keeps waiting-user navigation interactive and applies background state without pointer activity', async () => {
    const waiting = thread({
      thread_id: 'thread-a', title: 'Waiting A', status: 'waiting_user', active_run_id: 'turn-a',
      input_request: inputRequest({ prompt_id: 'prompt-a' }),
    });
    const idle = thread({ thread_id: 'thread-b', title: 'Thread B', status: 'idle' });
    const stream = controlledWorkspaceStream([{
      schema_version: 1,
      kind: 'ready',
      summaries: [waiting, idle],
    }]);
    const surfaceAdapter = {
      ...adapter(true),
      listThreads: vi.fn(async () => [waiting, idle]),
      loadThread: vi.fn(async (threadID: string) => liveBootstrap(threadID === 'thread-a' ? waiting : idle, 1)),
      connectLiveStream: stream.connect,
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-a"]')));
    const cardA = runtime.querySelector('[data-thread-id="thread-a"]') as HTMLElement;
    const cardB = runtime.querySelector('[data-thread-id="thread-b"]') as HTMLElement;
    expect(cardA.closest('[inert]')).toBeNull();
    expect(getComputedStyle(cardB).pointerEvents).not.toBe('none');

    const selectB = cardB.querySelector('button') as HTMLButtonElement;
    const rect = selectB.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + Math.max(1, rect.width / 2), rect.top + Math.max(1, rect.height / 2));
    expect(target?.closest('[data-thread-id]')).toBe(cardB);
    (target as HTMLElement).click();
    await waitFor(() => cardB.getAttribute('data-flower-thread-active') === 'true');

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: 'thread-a',
      current: {
        ...runtimeCurrentView(thread({ ...waiting, status: 'running', input_request: undefined }), 2),
        interactions: [{
          id: 'approval-a',
          kind: 'approval',
          tool_call_id: 'tool-a',
          resolved: false,
          approval: {
            label: 'Run deployment',
            tool_name: 'terminal.exec',
            tool_call_id: 'tool-a',
          },
        }],
      },
    });
    await waitFor(() => cardA.getAttribute('data-flower-thread-status') === 'waiting_approval');
    expect(cardB.getAttribute('data-flower-thread-active')).toBe('true');
    expect(runtime.querySelector('.flower-composer-mark-row')).toBeNull();
  });

  it('recovers a waiting approval when only the selected summary arrives', async () => {
    const running = thread({
      thread_id: 'thread-summary-approval',
      title: 'Summary approval',
      status: 'running',
      active_run_id: 'turn-a',
    });
    const approvalAction = {
      action_id: 'approval-summary',
      origin: 'main_tool' as const,
      run_id: 'turn-a',
      tool_id: 'tool-a',
      tool_name: 'terminal.exec',
      state: 'requested' as const,
      status: 'pending' as const,
      requested_at_ms: 4,
      can_approve: true,
      queue_order: 1,
      summary: { label: 'Run command' },
    };
    const waiting = thread({
      ...running,
      status: 'waiting_approval',
      approval_pending: true,
      approval_pending_count: 1,
      approval_actions: [approvalAction],
      updated_at_ms: 4,
    });
    const stream = controlledWorkspaceStream([{
      schema_version: 1,
      kind: 'ready',
      summaries: [running],
    }]);
    let latest = running;
    const surfaceAdapter = {
      ...adapter(true),
      listThreads: vi.fn(async () => [latest]),
      loadThread: vi.fn(async () => liveBootstrap(latest, latest === waiting ? 4 : 1)),
      connectLiveStream: stream.connect,
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-summary-approval"]')));
    (runtime.querySelector('[data-thread-id="thread-summary-approval"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-thread-status="running"]') !== null);

    latest = waiting;
    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [waiting] });

    await waitFor(() => runtime.querySelector('[data-flower-bottom-mode="approval"]') !== null);
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    expect(surfaceAdapter.loadThread.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
