import '../index.css';
import './flower-feature.css';
import { page } from 'vitest/browser';
import { expect, it, vi } from 'vitest';
import unavailableBaseline from '../../../../flower_ui/src/testdata/unavailableThreadBaseline.json';
import { createRuntimeFlowerSurfaceAdapter } from '../../../../flower_ui/src/runtimeFlowerSurfaceAdapter';
import { flowerLiveWireFixture } from '../../../../flower_ui/src/test/flowerLiveWireFixture';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

it('isolates an actual Go unavailable summary while another conversation sends and completes', async () => {
  await page.viewport(1280, 900);
  const base = adapter(true);
  const values: unknown[] = [unavailableBaseline];
  let wake: (() => void) | undefined;
  const healthy = thread({ thread_id: 'healthy-history', title: 'Healthy history', status: 'idle', created_at_ms: 1793894400000, updated_at_ms: 1793894400000 });
  const initial = liveBootstrap(healthy, 1);
  const launch = vi.fn(async (input: Parameters<typeof base.launchTurn>[0]) => ({ client_request_id: input.client_request_id, thread_id: healthy.thread_id }));
  const runtime = createRuntimeFlowerSurfaceAdapter({
    ...base, launchTurn: launch, resolveStorageGeneration: async () => 'e'.repeat(32),
    loadModelDirectory: async () => ({ current_model_id: 'openai/gpt-5-mini', sources: [{ id: 'openai', kind: 'runtime_config', state: 'ready' }], models: [{ id: 'openai/gpt-5-mini', label: 'Fixture model', source: 'runtime_config', state: 'ready', provider_id: 'openai', provider_name: 'Fixture', provider_type: 'openai', model_name: 'gpt-5-mini' }] }),
    mapperOptions: { runtimeID: 'fixture', runtimeKind: 'env_local', sourceLabel: 'Test', targetLabels: [] },
    transport: {
      listThreads: async () => ({ threads: unavailableBaseline.summaries.map(value => ({ ...value, read_status: healthy.read_status })) }),
      loadThread: async () => { throw new Error('Use bounded history'); },
      loadHistory: async id => { expect(id).toBe(healthy.thread_id); return { thread: { ...unavailableBaseline.summaries[1], read_status: healthy.read_status }, current: initial.current }; },
      loadSubagentDetail: async () => ({ detail: undefined }),
      markThreadRead: async () => ({ read_status: healthy.read_status }),
      patchThread: async () => ({ thread: undefined }), forkThread: async () => ({ thread: undefined }),
      submitApproval: async () => { throw new Error('unused'); },
      async *connectLiveStream({ signal }) {
        const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
        try {
          while (!signal.aborted) {
            const value = values.shift();
            if (value) yield* flowerLiveWireFixture(value);
            else await new Promise<void>(resolve => { wake = resolve; });
          }
        } finally { signal.removeEventListener('abort', abort); }
      },
    },
  });
  const root = renderSurfaceWithAdapterProps(runtime, {}); root.style.height = '780px';
  await waitFor(() => Boolean(root.querySelector('[data-thread-id="unavailable-history"] button')));
  root.querySelector<HTMLButtonElement>('[data-thread-id="unavailable-history"] button')!.click();
  await waitFor(() => root.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === 'unavailable-history');
  await waitFor(() => !root.querySelector('main')?.hasAttribute('data-flower-pending-thread-id'));
  expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  expect(root.textContent).toContain('unavailable');
  root.querySelector<HTMLButtonElement>('[data-thread-id="healthy-history"] button')!.click();
  await waitFor(() => root.querySelector('main')?.getAttribute('data-flower-selected-thread-id') === healthy.thread_id && !root.querySelector('main')?.hasAttribute('data-flower-pending-thread-id'));
  const editor = root.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  await waitFor(() => !editor.disabled);
  editor.value = 'Continue healthy conversation'; editor.dispatchEvent(new Event('input', { bubbles: true }));
  root.querySelector<HTMLButtonElement>('[data-flower-primary-action="send"]')!.click();
  await waitFor(() => launch.mock.calls.length === 1);
  await waitFor(() => root.textContent?.includes('Received, syncing') === true);
  expect(root.textContent).not.toContain('Waiting to queue');
  const requestID = launch.mock.calls[0][0].client_request_id;
  values.push({ schema_version: 3, kind: 'thread.batch', thread_id: healthy.thread_id, current: {
    thread_id: healthy.thread_id, view_version: 2, activity: 'idle', last_outcome: 'completed', turn_id: 'turn-finished', run_id: 'run-finished', queue: [], interactions: [],
    items: [
      { id: 'sent-message', ordinal: 1, kind: 'user', turn_id: 'turn-finished', run_id: 'run-finished', request_key: requestID, text: 'Continue healthy conversation' },
      { id: 'completed-reply', ordinal: 2, kind: 'assistant', turn_id: 'turn-finished', run_id: 'run-finished', text: 'Healthy conversation completed' },
    ],
  } }); wake?.();
  await waitFor(() => root.textContent?.includes('Healthy conversation completed') === true);
  expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  expect(launch).toHaveBeenCalledTimes(1);
});
