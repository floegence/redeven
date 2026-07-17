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

describe('Flower setup guide browser presentation', () => {
  it('keeps ambient light on the Flower icon instead of painting the guide container', async () => {
    await page.viewport(1440, 900);
    document.documentElement.classList.add('dark');

    const runtime = renderSurfaceWithAdapter(adapter(false));
    await waitFor(() => Boolean(runtime.querySelector('.flower-setup-guide')));

    const guide = runtime.querySelector('.flower-setup-guide') as HTMLElement;
    const iconGlow = guide.querySelector('.redeven-flower-soft-aura-glow') as HTMLElement;
    const guideStyle = getComputedStyle(guide);
    const iconGlowStyle = getComputedStyle(iconGlow);

    expect(guideStyle.backgroundImage).toBe('none');
    expect(guideStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(iconGlowStyle.backgroundImage).not.toBe('none');
    expect(iconGlowStyle.filter).toContain('blur');
  });
});
