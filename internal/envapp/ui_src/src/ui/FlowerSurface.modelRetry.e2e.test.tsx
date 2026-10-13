// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createFlowerModelReadResource } from '../../../../flower_ui/src/modelDirectory';
import type { FlowerModelDirectory } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, renderSurfaceWithAdapter, settingsSnapshot, waitFor } from './FlowerSurface.navigation.testHarness';

it('retries Desktop models only on explicit AI refresh and coalesces repeated clicks', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const retry = vi.fn(() => pending);
  const directory: FlowerModelDirectory = { current_model_id: '', models: [], sources: [{ id: 'desktop', kind: 'desktop_model_source', state: 'unavailable', reason: 'unbound' }] };
  const read = vi.fn(async () => directory);
  const resource = createFlowerModelReadResource({ scope: () => 'connection', loadConfiguration: async () => ({ ...settingsSnapshot(), model_profile: null }), loadDirectory: read });
  const surface = renderSurfaceWithAdapter({ ...adapter(), loadSettings: resource.loadSettings,
    loadModelDirectory: refresh => resource.loadDirectory(refresh, retry), subscribeModelDirectory: resource.subscribe });
  await waitFor(() => Boolean(surface.querySelector('.flower-model-source-status-refresh')));
  await resource.loadDirectory();
  expect(retry).not.toHaveBeenCalled();
  const refresh = surface.querySelector<HTMLButtonElement>('.flower-model-source-status-refresh')!;
  refresh.click(); refresh.click();
  await waitFor(() => retry.mock.calls.length === 1);
  expect(refresh.disabled).toBe(true);
  const priorReads = read.mock.calls.length;
  finish();
  await waitFor(() => read.mock.calls.length > priorReads);
  await waitFor(() => surface.querySelector<HTMLButtonElement>('.flower-model-source-status-refresh')?.disabled === false);
  expect(retry).toHaveBeenCalledTimes(1);
});
