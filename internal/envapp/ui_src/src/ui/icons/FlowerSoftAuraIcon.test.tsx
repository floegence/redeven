// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { FlowerNavigationIcon } from './FlowerSoftAuraIcon';

describe('FlowerNavigationIcon', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('uses the larger navigation-specific aura sizing', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => <FlowerNavigationIcon class="w-5 h-5" />, host);

    try {
      const root = host.firstElementChild as HTMLElement | null;
      expect(root).toBeTruthy();
      expect(root?.style.width).toBe('1.5rem');
      expect(root?.style.height).toBe('1.5rem');

      const glow = root?.querySelector('.redeven-flower-soft-aura-glow') as HTMLElement | null;
      expect(glow?.className).toContain('redeven-flower-soft-aura-nav-glow');

      const svg = root?.querySelector('svg') as SVGElement | null;
      expect(svg?.getAttribute('class')).toContain('redeven-flower-soft-aura-nav-svg');
    } finally {
      dispose();
    }
  });
});
