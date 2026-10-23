// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import type { FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, deferred, flush, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

it('keeps loading focused on progress while sidebar navigation can leave the pending read', async () => {
  const pending = deferred<ReturnType<typeof liveBootstrap>>();
  const selected = thread();
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [selected], loadThread: () => pending.promise },
    { focusThreadRequest: { request_id: 'loading', thread_id: selected.thread_id } });
  await waitFor(() => surface.querySelector('.flower-thread-loading') !== null);
  expect(surface.querySelector('.flower-thread-loading button')).toBeNull();
  expect(surface.querySelector('.flower-thread-loading [role="progressbar"]')).not.toBeNull();
  const button = surface.querySelector<HTMLButtonElement>('.flower-new-chat-button');
  expect(button).not.toBeNull();
  button!.click();
  await waitFor(() => surface.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === '');
  pending.resolve(liveBootstrap(selected));
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(surface.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id')).toBe('');
});

it('offers only retry in a failed conversation and recovers without replacing the draft', async () => {
  const selected = thread();
  let recovered = false;
  const loadThread = vi.fn(async () => {
    if (!recovered) throw new Error('Conversation preparation failed');
    return liveBootstrap(selected);
  });
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [selected], loadThread },
    { focusThreadRequest: { request_id: 'failed', thread_id: selected.thread_id } });
  await waitFor(() => surface.querySelector('.flower-thread-load-error') !== null);
  const actions = [...surface.querySelectorAll<HTMLButtonElement>('.flower-thread-load-error button')];
  expect(actions.map(button => button.textContent?.trim())).toEqual(['Retry']);
  const editor = surface.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  editor.value = 'Keep my draft';
  editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  recovered = true;
  actions[0]!.click();
  await waitFor(() => !surface.querySelector('.flower-thread-load-error') && Boolean(surface.querySelector('[data-flower-message-id]')));
  expect(loadThread.mock.calls.length).toBeGreaterThan(1);
  expect(surface.querySelector('.flower-composer textarea')).toBe(editor);
  expect(editor.value).toBe('Keep my draft');
});

it('keeps stream recovery reachable while the initial detail read is pending', async () => {
  const selected = thread();
  const pending = deferred<ReturnType<typeof liveBootstrap>>();
  const failure = deferred<void>();
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), loadThread: () => pending.promise,
    connectLiveStream: async function* (): AsyncIterable<FlowerLiveStreamEnvelope> {
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [selected] };
      await failure.promise;
      throw new Error('Private stream diagnostic');
    },
  }, { focusThreadRequest: { request_id: 'pending-sync', thread_id: selected.thread_id } });
  await waitFor(() => Boolean(surface.querySelector('.flower-thread-loading')));
  failure.resolve();
  await waitFor(() => Boolean(surface.querySelector('.flower-workspace-sync button')));
  expect(surface.querySelector('.flower-thread-loading button')).toBeNull();
  expect(surface.querySelector('.flower-model-status-sync')).toBeNull();
  expect(surface.querySelector('.flower-thread-load-error')).toBeNull();
});

it('shows one initial-read failure when live synchronization also fails', async () => {
  const selected = thread();
  const failure = deferred<void>();
  const pending = deferred<ReturnType<typeof liveBootstrap>>();
  let recovered = false;
  const loadThread = vi.fn(async () => recovered ? liveBootstrap(selected, 2) : pending.promise);
  let attempts = 0;
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), loadThread, loadHistory: loadThread,
    connectLiveStream: async function* (input): AsyncIterable<FlowerLiveStreamEnvelope> {
      const attempt = ++attempts;
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [selected] };
      if (attempt === 1) { await failure.promise; throw new Error('Private stream diagnostic'); }
      if (!input.signal.aborted) await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  }, { focusThreadRequest: { request_id: 'failed-sync', thread_id: selected.thread_id } });
  await waitFor(() => Boolean(surface.querySelector('.flower-thread-loading')));
  pending.reject(new Error('Conversation preparation failed'));
  await waitFor(() => Boolean(surface.querySelector('.flower-thread-load-error')));
  failure.resolve();
  await flush();
  expect(surface.querySelector('.flower-workspace-sync')).toBeNull();
  expect(surface.querySelector('.flower-model-status-sync')).toBeNull();
  expect(surface.querySelectorAll('[role="alert"]')).toHaveLength(1);
  const actions = surface.querySelectorAll<HTMLButtonElement>('.flower-thread-load-error button');
  expect([...actions].map(button => button.textContent?.trim())).toEqual(['Retry']);
  recovered = true;
  actions[0]!.click();
  await waitFor(() => !surface.querySelector('.flower-thread-load-error') && Boolean(surface.querySelector('[data-flower-message-id]')));
  expect(surface.querySelector('.flower-workspace-sync')).toBeNull();
  expect(surface.querySelector('.flower-model-status-sync')).toBeNull();
});
