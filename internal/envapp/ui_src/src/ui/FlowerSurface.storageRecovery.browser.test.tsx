import '../index.css';
import './flower-feature.css';
import { expect, it, vi } from 'vitest';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { createTransportOutbox } from '../../../../flower_ui/src/transportOutbox';
import type { FlowerTurnLaunchInput } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, deferred, launchReceipt, liveBootstrap, renderSurfaceWithAdapter, thread, wait, waitFor } from './FlowerSurface.navigation.testHarness';

it('preserves old outbox input after restoration and never refreshes its generation or retries it', async () => {
  const initial = thread({ thread_id: 'thread-restored', messages: [], status: 'idle' });
  const original = createTransportOutbox().put({
    requestId: 'storage-old-request', threadId: initial.thread_id,
    input: { client_request_id: 'storage-old-request', thread_id: initial.thread_id, prompt: 'Keep my old input', storage_generation: 'a'.repeat(32) },
    attachmentLabels: [], createdAtMs: Date.now(),
  });
  await original.flushPersistence();
  original.dispose();
  const resolveStorageGeneration = vi.fn(async () => 'b'.repeat(32));
  const launchTurn = vi.fn(async (_input: FlowerTurnLaunchInput) => {
    throw Object.assign(new Error('data restored'), { code: 'AI_STORAGE_RESTORED', admission_kind: 'rejected' });
  });
  const bootstrap = liveBootstrap(initial, 1);
  const current = { ...bootstrap.current, restored_inputs: [{ id: 'old-queue', input: { text: 'Preserved queue text' } }] };
  const runtime = renderSurfaceWithAdapter({
    ...adapter(true), launchTurn, resolveStorageGeneration,
    listThreads: vi.fn(async () => [initial]),
    connectLiveStream: async function* ({ signal }) {
      yield { schema_version: 1, kind: 'ready', summaries: [initial] };
      await new Promise<void>((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
    },
    loadThread: vi.fn(async () => ({ thread: applyFlowerRuntimeCurrentView(initial, current), current })),
  });
  await waitFor(() => runtime.querySelector('[data-thread-id="thread-restored"] button') !== null);
  (runtime.querySelector('[data-thread-id="thread-restored"] button') as HTMLButtonElement).click();
  await waitFor(() => runtime.textContent?.includes('Preserved queue text') === true);
  await waitFor(() => launchTurn.mock.calls.length === 1);
  await waitFor(() => runtime.querySelector('[data-flower-transport-outbox-id="storage-old-request"]')?.textContent?.includes('Copy') === true);
  await wait(600);
  expect(launchTurn).toHaveBeenCalledTimes(1);
  expect(launchTurn.mock.calls[0]?.[0].storage_generation).toBe('a'.repeat(32));
  expect(resolveStorageGeneration).not.toHaveBeenCalled();
  const restored = runtime.querySelector('[data-flower-restored-input-id="old-queue"]')!;
  expect(restored.textContent).toContain('Preserved queue text');
  expect([...restored.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Copy input']);
  const cleared = original.drop('storage-old-request');
  await cleared.flushPersistence();
  cleared.dispose();
});

it('waits for the current dataset generation before sending an explicit new task', async () => {
  const generation = deferred<string>();
  const resolveStorageGeneration = vi.fn(() => generation.promise);
  const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceipt('thread-new-storage', 'turn-new-storage', 'start', input.client_request_id));
  const runtime = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => []), resolveStorageGeneration, launchTurn });
  await waitFor(() => runtime.querySelector('textarea') !== null);
  const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = 'Start a new task with restored data';
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await waitFor(() => Boolean(runtime.querySelector<HTMLButtonElement>('.flower-composer-submit') && !runtime.querySelector<HTMLButtonElement>('.flower-composer-submit')!.disabled));
  runtime.querySelector<HTMLButtonElement>('.flower-composer-submit')!.click();
  await waitFor(() => resolveStorageGeneration.mock.calls.length === 1);
  expect(launchTurn).not.toHaveBeenCalled();
  generation.resolve('b'.repeat(32));
  await waitFor(() => launchTurn.mock.calls.length === 1);
  expect(launchTurn.mock.calls[0]?.[0].storage_generation).toBe('b'.repeat(32));
});
