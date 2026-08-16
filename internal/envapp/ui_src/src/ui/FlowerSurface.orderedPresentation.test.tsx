// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerLiveStreamConnectInput,
  FlowerRuntimeCurrentView,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import {
  adapter,
  deferred,
  renderSurfaceWithAdapter,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

function installLocalStorage(): void {
  if (window.localStorage) return;
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } satisfies Storage,
  });
}

function orderedCurrent(stage: 'waiting' | 'running' | 'completed'): FlowerRuntimeCurrentView {
  const terminal = stage === 'completed';
  const status = stage === 'waiting' ? 'waiting' : stage === 'running' ? 'running' : 'success';
  return {
    thread_id: 'thread-ordered-dom',
    turn_id: 'turn-ordered-dom',
    view_version: stage === 'waiting' ? 1 : stage === 'running' ? 2 : 3,
    activity: terminal ? 'idle' : 'active',
    ...(terminal ? { last_outcome: 'completed' as const } : {}),
    items: [
      { id: 'user:ordered', turn_id: 'turn-ordered-dom', ordinal: 1, kind: 'user', text: 'Run one tool' },
      { id: 'thinking:ordered', turn_id: 'turn-ordered-dom', ordinal: 2, kind: 'thinking', text: 'Checking the command', live: false },
      {
        id: 'tool:ordered', turn_id: 'turn-ordered-dom', ordinal: 3, kind: 'tool',
        activity: {
          item_id: 'tool:ordered', tool_id: 'call-ordered', tool_name: 'terminal.exec', kind: 'tool', status,
          severity: 'quiet', needs_attention: stage === 'waiting', requires_approval: stage === 'waiting',
          presentation: { label: 'Run command', renderer: 'terminal', payload: { command: 'printf ordered' } },
        },
      },
      ...(terminal ? [{
        id: 'assistant:ordered', turn_id: 'turn-ordered-dom', ordinal: 4, kind: 'assistant' as const, text: 'ordered', live: false,
      }] : []),
    ],
    interactions: stage === 'waiting' ? [{
      id: 'approval:ordered', kind: 'approval', tool_call_id: 'call-ordered', resolved: false,
    }] : [{
      id: 'approval:ordered', kind: 'approval', tool_call_id: 'call-ordered', resolved: true, approved: true,
    }],
  };
}

describe('Flower ordered presentation DOM identity', () => {
  it('keeps existing message nodes across waiting, running, and completed replacements', async () => {
    installLocalStorage();
    const summary = thread({
      thread_id: 'thread-ordered-dom', title: 'Ordered DOM', status: 'waiting_approval', messages: [],
    });
    const publishRunning = deferred<void>();
    const publishCompleted = deferred<void>();
    const connectLiveStream = vi.fn(async function* (input: FlowerLiveStreamConnectInput) {
      yield { schema_version: 1 as const, kind: 'ready' as const, summaries: [summary] };
      await publishRunning.promise;
      yield {
        schema_version: 1 as const, kind: 'thread.batch' as const, thread_id: summary.thread_id,
        current: orderedCurrent('running'),
      };
      await publishCompleted.promise;
      yield {
        schema_version: 1 as const, kind: 'thread.batch' as const, thread_id: summary.thread_id,
        current: orderedCurrent('completed'),
      };
      await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }));
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [summary]),
      loadThread: vi.fn(async () => ({
        thread: applyFlowerRuntimeCurrentView(summary, orderedCurrent('waiting')),
        current: orderedCurrent('waiting'),
      })),
      connectLiveStream,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-ordered-dom"] button')));
    (runtime.querySelector('[data-thread-id="thread-ordered-dom"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-message-id="tool:ordered"]') !== null);
    const ids = ['user:ordered', 'thinking:ordered', 'tool:ordered'];
    const waitingNodes = ids.map((id) => runtime.querySelector(`[data-flower-message-id="${id}"]`));
    expect(waitingNodes.every(Boolean)).toBe(true);

    publishRunning.resolve(undefined);
    await waitFor(() => runtime.querySelector('[data-flower-activity-status="running"]') !== null);
    const runningNodes = ids.map((id) => runtime.querySelector(`[data-flower-message-id="${id}"]`));
    expect(runningNodes.map((node, index) => node?.isSameNode(waitingNodes[index]))).toEqual([true, true, true]);

    publishCompleted.resolve(undefined);
    await waitFor(() => runtime.querySelector('[data-flower-activity-status="success"]') !== null
      && runtime.querySelector('[data-flower-message-id="assistant:ordered"]') !== null);
    const completedNodes = ids.map((id) => runtime.querySelector(`[data-flower-message-id="${id}"]`));
    expect(completedNodes.map((node, index) => node?.isSameNode(waitingNodes[index]))).toEqual([true, true, true]);
    expect(Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id')))
      .toEqual([...ids, 'assistant:ordered']);
  });
});
