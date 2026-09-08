import { describe, expect, it, vi } from 'vitest';
import { adapter, deferred, flush, liveBootstrap, renderSurfaceWithAdapter, runtimeCurrentView, thread, waitFor } from './FlowerSurface.navigation.testHarness';

function select(runtime: HTMLElement, id: string) {
  (runtime.querySelector(`[data-thread-id="${id}"] button`) as HTMLButtonElement).click();
}
function title(runtime: HTMLElement) { return runtime.querySelector('.flower-chat-header-title')?.textContent; }

describe('Flower canonical title synchronization', () => {
  it('keeps the generated title through body updates and a late initial detail response', async () => {
    const initial = thread({ thread_id: 'title-race', title: '', title_status: 'unset', title_generation: 0, messages: [] });
    const named = thread({ ...initial, title: 'Hi', title_status: 'ready', title_generation: 2 });
    const completed = thread({ ...initial, messages: [{ id: 'answer', turn_id: 'turn-answer', role: 'assistant', content: 'Hello from Flower.', status: 'complete', created_at_ms: 3 }] });
    const detail = deferred<ReturnType<typeof liveBootstrap>>();
    const publishTitle = deferred<void>();
    const publishBody = deferred<void>();
    const loadThread = vi.fn(() => detail.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true), listThreads: vi.fn(async () => [initial]), loadThread,
      connectLiveStream: async function* ({ signal }) {
        yield { schema_version: 1, kind: 'ready' as const, summaries: [initial] };
        await publishTitle.promise;
        yield { schema_version: 1, kind: 'summary.batch' as const, summaries: [named] };
        await publishBody.promise;
        yield { schema_version: 1, kind: 'thread.batch' as const, thread_id: initial.thread_id, current: runtimeCurrentView(completed, 2) };
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      },
    });
    await waitFor(() => !!runtime.querySelector('[data-thread-id="title-race"] button'));
    select(runtime, initial.thread_id);
    await waitFor(() => loadThread.mock.calls.length === 1);
    publishTitle.resolve();
    await waitFor(() => title(runtime) === 'Hi');
    publishBody.resolve();
    await waitFor(() => runtime.textContent?.includes('Hello from Flower.') ?? false);
    detail.resolve(liveBootstrap(initial, 1));
    await flush();
    expect(title(runtime)).toBe('Hi');
    expect(runtime.querySelector('[data-thread-id="title-race"]')?.textContent).toContain('Hi');
    expect(runtime.textContent).toContain('Hello from Flower.');
    expect(loadThread).toHaveBeenCalledTimes(1);
  });

  it('updates two windows without reloading their message history', async () => {
    const initial = thread({ thread_id: 'shared-title', title: 'First request', title_status: 'pending', title_generation: 2 });
    const named = thread({ ...initial, title: 'Conversation title', title_status: 'ready' });
    const publishTitle = deferred<void>();
    const windows = Array.from({ length: 2 }, () => {
      const loadThread = vi.fn(async () => liveBootstrap(initial, 1));
      const runtime = renderSurfaceWithAdapter({
        ...adapter(true), listThreads: vi.fn(async () => [initial]), loadThread,
        connectLiveStream: async function* ({ signal }) {
          yield { schema_version: 1, kind: 'ready' as const, summaries: [initial] };
          await publishTitle.promise;
          yield { schema_version: 1, kind: 'summary.batch' as const, summaries: [named] };
          yield { schema_version: 1, kind: 'thread.batch' as const, thread_id: initial.thread_id, current: runtimeCurrentView(initial, 2) };
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        },
      });
      return { runtime, loadThread };
    });
    for (const { runtime } of windows) {
      await waitFor(() => !!runtime.querySelector('[data-thread-id="shared-title"] button'));
      select(runtime, initial.thread_id);
      await waitFor(() => title(runtime) === 'First request');
    }
    await waitFor(() => windows.every(({ loadThread }) => loadThread.mock.calls.length === 1));
    publishTitle.resolve();
    await waitFor(() => windows.every(({ runtime }) => title(runtime) === 'Conversation title'));
    await flush();
    for (const { runtime, loadThread } of windows) {
      expect(runtime.querySelector('[data-thread-id="shared-title"]')?.textContent).toContain('Conversation title');
      expect(loadThread).toHaveBeenCalledTimes(1);
    }
  });
});
