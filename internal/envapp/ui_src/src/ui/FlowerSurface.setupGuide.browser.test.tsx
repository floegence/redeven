import '../index.css';
import './flower-feature.css';

import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import {
  adapter,
  renderSurfaceWithAdapter,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

afterEach(() => {
  document.documentElement.classList.remove('dark');
});

describe('Flower setup browser presentation', () => {
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
