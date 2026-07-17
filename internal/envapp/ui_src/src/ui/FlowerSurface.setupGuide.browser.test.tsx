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
});
