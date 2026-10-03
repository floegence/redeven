// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type { FlowerSettingsSnapshot } from './contracts/flowerSurfaceContracts';
import {
  adapter,
  renderSurfaceWithAdapter,
  settingsSnapshot,
  waitFor,
} from '../../envapp/ui_src/src/ui/FlowerSurface.navigation.testHarness';

const unavailable = 'Redeven AI is currently unavailable. Select another model or try again.';

function renderUnavailablePlatform(snapshot: FlowerSettingsSnapshot) {
  return renderSurfaceWithAdapter({
    ...adapter(true),
    loadSettings: vi.fn(async () => snapshot),
    listThreads: vi.fn(async () => []),
  });
}

describe('Flower platform model availability', () => {
  it('explains an initial platform catalog failure before any model has been selected', async () => {
    const surface = renderUnavailablePlatform({
      defaults: { permission_type: 'approval_required' },
      model_profile: null,
      provider_secrets: [],
      platform_model_source: { models: [], error: unavailable },
    });

    await waitFor(() => surface.textContent?.includes(unavailable) ?? false);
    expect(surface.querySelector('[data-setup-welcome="true"]')).toBeNull();
    expect(surface.querySelector('.flower-model-source-status[data-state="not_configured"]')).toBeNull();
    expect(surface.querySelector('[role="alert"] button')).not.toBeNull();
  });

  it.each([false, true])('keeps an unavailable selection when replacement platform models exist: %s', async (hasReplacement) => {
    const surface = renderUnavailablePlatform({
      ...settingsSnapshot(true),
      platform_model_source: { models: hasReplacement ? [{ id: 'platform/replacement', label: 'Replacement', input_modalities: ['text'] }] : [], current_model_id: 'platform/selected', error: unavailable },
    });

    await waitFor(() => surface.querySelector('[role="alert"]')?.textContent?.includes(unavailable) ?? false);
    const textarea = surface.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Keep the selected model';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect((surface.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('reloads the catalog from the unavailable notice and restores the selected platform model', async () => {
    const failed: FlowerSettingsSnapshot = {
      defaults: { permission_type: 'approval_required' },
      model_profile: null,
      provider_secrets: [],
      platform_model_source: { models: [], current_model_id: 'platform/selected', error: unavailable },
    };
    const recovered: FlowerSettingsSnapshot = {
      ...failed,
      platform_model_source: {
        current_model_id: 'platform/selected',
        models: [{ id: 'platform/selected', label: 'Redeven AI model', input_modalities: ['text'] }],
      },
    };
    const loadSettings = vi.fn().mockResolvedValueOnce(failed).mockResolvedValue(recovered);
    const surface = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings,
      listThreads: vi.fn(async () => []),
    });

    await waitFor(() => surface.textContent?.includes(unavailable) ?? false);
    (surface.querySelector('[role="alert"] button') as HTMLButtonElement).click();
    await waitFor(() => loadSettings.mock.calls.length === 2 && !surface.textContent?.includes(unavailable));
    const textarea = surface.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Continue using Redeven AI';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => !(surface.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
    expect(surface.textContent).toContain('Redeven AI model');
  });

  it('allows the selected local model to continue without a platform error banner', async () => {
    const surface = renderUnavailablePlatform({
      ...settingsSnapshot(true),
      platform_model_source: { models: [], error: unavailable },
    });

    await waitFor(() => Boolean(surface.querySelector('textarea')));
    const textarea = surface.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Use my configured model';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const submit = surface.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(submit && !submit.disabled);
    });
    expect(surface.textContent).not.toContain(unavailable);
  });
});
