// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { adapter, renderSurfaceWithAdapter, settingsSnapshot, waitFor } from './FlowerSurface.navigation.testHarness';

it('retries Desktop models only on explicit AI refresh and coalesces repeated clicks', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const retryModelSource = vi.fn(() => pending);
  const loadSettings = vi.fn(async () => ({ ...settingsSnapshot(), model_profile: null, model_source: {
    kind: 'desktop_model_source' as const, state: 'unbound' as const, label: 'Desktop' as const,
  } }));
  const surface = renderSurfaceWithAdapter({ ...adapter(), loadSettings, retryModelSource });
  await waitFor(() => Boolean(surface.querySelector('.flower-model-source-status-refresh')));
  expect(retryModelSource).not.toHaveBeenCalled();
  const refresh = surface.querySelector<HTMLButtonElement>('.flower-model-source-status-refresh')!;
  refresh.click(); refresh.click();
  expect(retryModelSource).toHaveBeenCalledTimes(1);
  expect(refresh.disabled).toBe(true);
  const priorReads = loadSettings.mock.calls.length;
  finish();
  await waitFor(() => loadSettings.mock.calls.length > priorReads);
  expect(retryModelSource).toHaveBeenCalledTimes(1);
});
