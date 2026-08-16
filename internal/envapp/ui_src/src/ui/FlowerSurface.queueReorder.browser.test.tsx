import { describe, expect, it, vi } from 'vitest';

import {
  adapter,
  liveBootstrap,
  renderSurfaceWithAdapter,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

describe('FlowerSurface queued turn reorder', () => {
  it('commits the reversed canonical order through native drag events', async () => {
    const first = { queue_id: 'queue-first', prompt: 'First queued turn', created_at_ms: 10 };
    const second = { queue_id: 'queue-second', prompt: 'Second queued turn', created_at_ms: 11 };
    const queuedThread = thread({
      thread_id: 'thread-queued-reorder-browser',
      title: 'Queued reorder',
      status: 'running',
      queued_turn_count: 2,
      queued_turns: [first, second],
    });
    const reorderQueuedTurns = vi.fn(async (_threadID: string, orderedQueueIDs: readonly string[]) => liveBootstrap(thread({
      ...queuedThread,
      queued_turns: orderedQueueIDs.map((queueID) => queueID === first.queue_id ? first : second),
      updated_at_ms: queuedThread.updated_at_ms + 1,
    }), 2));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [queuedThread]),
      loadThread: vi.fn(async () => liveBootstrap(queuedThread, 1)),
      reorderQueuedTurns,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-queued-reorder-browser"] button')));
    (runtime.querySelector('[data-thread-id="thread-queued-reorder-browser"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('[data-flower-queued-turn-dock-id]').length === 2);
    const items = Array.from(runtime.querySelectorAll<HTMLElement>('[data-flower-queued-turn-dock-id]'));
    const dataTransfer = new DataTransfer();

    items[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    expect(items[0].getAttribute('data-flower-queued-turn-dragging')).toBe('true');
    items[1].dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: items[1].getBoundingClientRect().bottom + 1,
      dataTransfer,
    }));
    items[1].dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientY: items[1].getBoundingClientRect().bottom + 1,
      dataTransfer,
    }));

    await waitFor(() => reorderQueuedTurns.mock.calls.length === 1);
    expect(reorderQueuedTurns).toHaveBeenCalledWith(queuedThread.thread_id, [second.queue_id, first.queue_id]);
    await waitFor(() => Array.from(runtime.querySelectorAll('[data-flower-queued-turn-dock-id]')).map((item) => (
      item.getAttribute('data-flower-queued-turn-dock-id')
    )).join(',') === `${second.queue_id},${first.queue_id}`);
  });
});
