// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { adapter, deferred, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

it('can leave a pending conversation read and start composing immediately', async () => {
  const pending = deferred<ReturnType<typeof liveBootstrap>>();
  const selected = thread();
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [selected], loadThread: () => pending.promise },
    { focusThreadRequest: { request_id: 'loading', thread_id: selected.thread_id } });
  await waitFor(() => surface.querySelector('.flower-thread-loading') !== null);
  const button = [...surface.querySelectorAll<HTMLButtonElement>('.flower-thread-loading button')].find(item => item.textContent?.trim() === 'New chat');
  expect(button).toBeDefined();
  button!.click();
  await waitFor(() => surface.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === '');
  pending.resolve(liveBootstrap(selected));
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(surface.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id')).toBe('');
});

it('offers conversation navigation and new chat alongside retry after a failed read', async () => {
  const selected = thread();
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [selected], loadThread: async () => { throw new Error('Conversation preparation failed'); } },
    { focusThreadRequest: { request_id: 'failed', thread_id: selected.thread_id } });
  await waitFor(() => surface.querySelector('.flower-thread-load-error') !== null);
  const actions = [...surface.querySelectorAll<HTMLButtonElement>('.flower-thread-load-error button')];
  expect(actions.map(button => button.textContent?.trim())).toEqual(expect.arrayContaining(['Retry', 'Flower conversations', 'New chat']));
});
