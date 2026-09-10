import '../index.css';
import './flower-feature.css';

import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import {
  adapter,
  renderSurfaceWithAdapter,
  settingsSnapshot,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

afterEach(() => {
  document.documentElement.classList.remove('dark');
});

describe('Flower setup browser presentation', () => {
  it('shows server search reasons in the model menu without blocking ordinary model selection', async () => {
    await page.viewport(1000, 760);
    const snapshot = settingsSnapshot();
    let modelID = 'search/vision';
    const loadSettings = async (): Promise<ReturnType<typeof settingsSnapshot>> => ({ ...snapshot, model_profile: {
        schema_version: 1, current_model_id: modelID, providers: [
          { id: 'search', type: 'deepseek', models: [{ model_name: 'vision', wire_model_name: 'deepseek-v4-flash-vision-exp', web_search: { status: 'available', reason: 'catalog_supported' } }] },
          { id: 'brave', type: 'openai_compatible', web_search: { mode: 'brave' }, models: [{ model_name: 'custom', web_search: { status: 'unavailable', reason: 'needs_credentials' } }] },
        ],
      }, provider_secrets: [
        { provider_id: 'search', provider_api_key_configured: true, web_search_api_key_configured: false },
        { provider_id: 'brave', provider_api_key_configured: true, web_search_api_key_configured: false },
      ] });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(), listThreads: async () => [], loadSettings,
      persistDefaultModel: async (next) => { modelID = next; return loadSettings(); },
    });
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-reasoning-model-trigger')));
    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => document.querySelectorAll('[data-web-search]').length === 2);
    expect(document.querySelector('[data-web-search="available"]')?.textContent).toBe('Web search');
    const unavailable = document.querySelector('[data-web-search="unavailable"]') as HTMLElement;
    expect(unavailable.textContent).toBe('Search API key required');
    const option = unavailable.closest('button') as HTMLButtonElement;
    expect(option.disabled).toBe(false);
    expect(unavailable.getBoundingClientRect().right).toBeLessThanOrEqual(option.getBoundingClientRect().right);
    option.click();
    await waitFor(() => runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent?.includes('custom') === true);
  });

  it('keeps the ordinary empty state with setup guidance confined to the composer footer', async () => {
    await page.viewport(1440, 900);
    document.documentElement.classList.add('dark');

    const runtime = renderSurfaceWithAdapter(adapter(false));
    await waitFor(() => Boolean(runtime.querySelector('.flower-empty-state') && runtime.querySelector('.flower-setup-inline')));

    const emptyState = runtime.querySelector('.flower-empty-state') as HTMLElement;
    const setupInline = runtime.querySelector('.flower-setup-inline') as HTMLElement;
    const iconGlow = emptyState.querySelector('.redeven-flower-soft-aura-glow') as HTMLElement;
    const iconGlowStyle = getComputedStyle(iconGlow);

    expect(runtime.querySelector('.flower-setup-guide')).toBeNull();
    expect(setupInline.textContent).toContain('Set up a model provider to start chatting.');
    expect(iconGlowStyle.backgroundImage).not.toBe('none');
    expect(iconGlowStyle.filter).toContain('blur');
  });

  it('keeps Desktop recovery status on one compact line at narrow widths', async () => {
    await page.viewport(360, 760);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(false),
      loadSettings: async () => ({
        defaults: { permission_type: 'approval_required' as const },
        model_profile: null,
        provider_secrets: [],
        model_source: {
          kind: 'desktop_model_source' as const,
          state: 'empty' as const,
          label: 'Desktop' as const,
        },
      }),
      listThreads: async () => [],
      modelSourceRecovery: {
        describe: () => 'Desktop is connected, but no usable model is available yet.',
        localSettings: { label: 'Local Flower settings', run: async () => undefined },
        runtimeSettings: { label: 'Runtime settings', run: async () => undefined },
        connectionCenter: { label: 'Connection center', run: async () => undefined },
      },
    });
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-source-status-footer')));

    const status = runtime.querySelector('.flower-model-source-status-footer') as HTMLElement;
    const message = status.querySelector('.flower-model-source-status-message') as HTMLElement;
    const actions = status.querySelector('.flower-model-source-status-actions') as HTMLElement;
    const messageStyle = getComputedStyle(message);
    const messageRect = message.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();

    expect(messageStyle.overflow).toBe('hidden');
    expect(messageStyle.textOverflow).toBe('ellipsis');
    expect(messageStyle.whiteSpace).toBe('nowrap');
    expect(message.title).toBe(message.textContent);
    expect(messageRect.right).toBeLessThanOrEqual(actionsRect.left + 1);
    expect(runtime.querySelector('.flower-setup-guide')).toBeNull();
  });
});
