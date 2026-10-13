// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowerSurface, createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { createFlowerModelReadResource } from '../../../../flower_ui/src/modelDirectory';
import type { FlowerModelDirectory } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, deferred, settingsSnapshot, waitFor } from './FlowerSurface.navigation.testHarness';

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); });

const directory: FlowerModelDirectory = {
  current_model_id: 'openai/gpt-5.2',
  models: [{ id: 'openai/gpt-5.2', label: 'OpenAI / gpt-5.2', source: 'runtime_config',
    provider_id: 'openai', model_name: 'gpt-5.2', state: 'ready' }],
  sources: [{ id: 'openai', kind: 'runtime_config', state: 'ready' }],
};

function mount(models: FlowerModelDirectory, loadModelDirectory: () => Promise<FlowerModelDirectory>) {
  const base = adapter();
  const launchTurn = vi.fn(base.launchTurn);
  const resource = createFlowerModelReadResource({ scope: () => 'test',
    loadConfiguration: async () => ({ ...settingsSnapshot(), model_directory: models }),
    loadDirectory: loadModelDirectory,
  });
  host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FlowerSurface adapter={{ ...base,
    loadSettings: resource.loadSettings, loadModelDirectory: resource.loadDirectory,
    subscribeModelDirectory: resource.subscribe, listThreads: async () => [], launchTurn,
  }} notify={vi.fn()} draftCoordinator={createFlowerComposerDraftCoordinator()} />, host);
  return launchTurn;
}

describe('Flower model availability independent of inventory reads', () => {
  it.each(['failed', 'pending'] as const)('sends with saved backend metadata while the directory read is %s', async (state) => {
    const pending = deferred<FlowerModelDirectory>();
    const launchTurn = mount(directory, () => state === 'pending' ? pending.promise : Promise.reject(new Error('offline')));
    await waitFor(() => host.querySelector('.flower-model-reasoning-model-label')?.textContent?.includes('gpt-5.2') === true);
    const editor = host.querySelector<HTMLTextAreaElement>('textarea')!;
    editor.value = 'Use my configured model'; editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(host.querySelector('.flower-setup-inline')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('.flower-composer-submit')!.disabled).toBe(false);
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => launchTurn.mock.calls.length === 1);
    expect(launchTurn.mock.calls[0][0]).toMatchObject({ model_id: 'openai/gpt-5.2', prompt: 'Use my configured model' });
    pending.resolve(directory);
  });

  it.each([
    ['missing_keys', DEFAULT_FLOWER_SURFACE_COPY.chat.modelUnavailableMissingKeys],
    ['provider_disabled', DEFAULT_FLOWER_SURFACE_COPY.chat.modelUnavailableProviderDisabled],
    ['model_missing', DEFAULT_FLOWER_SURFACE_COPY.chat.modelUnavailableModelMissing],
  ])('explains %s and preserves the draft even when another model is ready', async (reason, message) => {
    const models: FlowerModelDirectory = { ...directory, models: [
      { ...directory.models[0], state: 'unavailable', reason },
      { ...directory.models[0], id: 'openai/replacement', model_name: 'replacement' },
    ] };
    const launchTurn = mount(models, async () => models);
    await waitFor(() => host.querySelector('.flower-setup-inline')?.textContent === message);
    const editor = host.querySelector<HTMLTextAreaElement>('textarea')!;
    editor.value = 'Preserve my draft'; editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(host.querySelector<HTMLButtonElement>('.flower-composer-submit')!.disabled).toBe(true);
    expect(editor.disabled).toBe(false);
    expect(editor.value).toBe('Preserve my draft');
    expect(launchTurn).not.toHaveBeenCalled();
  });
});
