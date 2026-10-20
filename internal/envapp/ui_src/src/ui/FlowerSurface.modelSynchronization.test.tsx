// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { FlowerLiveStreamConnectInput, FlowerLiveStreamEnvelope, FlowerModelDirectory } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, deferred, flowerSurfaceNotifications, renderSurfaceWithAdapterProps, settingsSnapshot, waitFor } from './FlowerSurface.navigation.testHarness';

const directory: FlowerModelDirectory = { current_model_id: 'openai/gpt-5.2', models: [{
  id: 'openai/gpt-5.2', label: 'OpenAI / gpt-5.2', source: 'runtime_config', state: 'ready', provider_id: 'openai', model_name: 'gpt-5.2',
}], sources: [{ id: 'openai', kind: 'runtime_config', state: 'ready' }] };

it('reacquires settings invalidated while loading and ends model loading with a usable snapshot', async () => {
  const stale = deferred<ReturnType<typeof settingsSnapshot>>();
  const loadSettings = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue(settingsSnapshot());
  const [revision, setRevision] = createSignal(0);
  const launchTurn = vi.fn(adapter().launchTurn);
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), loadSettings, loadModelDirectory: async () => directory, launchTurn,
    listThreads: async () => [],
  }, { settingsRevision: revision });
  await waitFor(() => loadSettings.mock.calls.length === 1);
  setRevision(1);
  stale.resolve(settingsSnapshot(false));
  await waitFor(() => loadSettings.mock.calls.length === 2 && Boolean(surface.querySelector('.flower-model-reasoning-model-label')));
  expect(surface.querySelector('.flower-setup-inline')).toBeNull();
  expect(surface.querySelector('.flower-model-reasoning-model-trigger [class*="animate-spin"]')).toBeNull();
  const editor = surface.querySelector<HTMLTextAreaElement>('textarea')!;
  editor.value = 'Send after invalidation'; editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(() => launchTurn.mock.calls.length === 1);
  expect(flowerSurfaceNotifications()).toEqual([]);
});

it('updates the directory from live transport without reloading settings or replacing the composer', async () => {
  const changed = deferred<void>();
  const loadSettings = vi.fn(async () => settingsSnapshot());
  const loadDirectory = vi.fn(async () => directory);
  const connectLiveStream = vi.fn(async function* (input: FlowerLiveStreamConnectInput): AsyncIterable<FlowerLiveStreamEnvelope> {
    yield { schema_version: 2, kind: 'ready', summaries: [] };
    await changed.promise;
    yield { schema_version: 2, kind: 'model_directory.changed' };
    if (!input.signal.aborted) await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }));
  });
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), loadSettings, loadModelDirectory: loadDirectory, connectLiveStream, listThreads: async () => [] }, {});
  await waitFor(() => loadDirectory.mock.calls.length > 0 && connectLiveStream.mock.calls.length === 1);
  const reads = loadDirectory.mock.calls.length;
  const editor = surface.querySelector<HTMLTextAreaElement>('textarea')!;
  editor.value = 'Preserve my draft'; editor.dispatchEvent(new InputEvent('input', { bubbles: true })); editor.focus();
  changed.resolve();
  await waitFor(() => loadDirectory.mock.calls.length > reads);
  expect(loadSettings).toHaveBeenCalledTimes(1);
  expect(connectLiveStream).toHaveBeenCalledTimes(1);
  expect(surface.querySelector('textarea')).toBe(editor);
  expect(editor.value).toBe('Preserve my draft');
  expect(document.activeElement).toBe(editor);
  expect(flowerSurfaceNotifications()).toEqual([]);
});
