// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { FlowerContextMenuIcon, FlowerNavigationIcon, FlowerWorkbenchIcon } from './FlowerSoftAuraIcon';

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

describe('FlowerContextMenuIcon', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reuses the compact workbench styling without forcing a larger inline size', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => <FlowerContextMenuIcon class="w-3.5 h-3.5 opacity-60" />, host);

    try {
      const root = host.firstElementChild as HTMLElement | null;
      expect(root).toBeTruthy();
      expect(root?.style.width).toBe('');
      expect(root?.style.height).toBe('');
      expect(root?.className).toContain('w-3.5');
      expect(root?.className).toContain('h-3.5');

      const glow = root?.querySelector('.redeven-flower-soft-aura-glow') as HTMLElement | null;
      expect(glow?.className).toContain('redeven-flower-soft-aura-workbench-glow');

      const svg = root?.querySelector('svg') as SVGElement | null;
      expect(svg?.getAttribute('class')).toContain('redeven-flower-soft-aura-workbench-svg');
    } finally {
      dispose();
    }
  });
});

describe('FlowerWorkbenchIcon', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('uses the compact workbench-specific aura tuning without forcing navigation size', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => <FlowerWorkbenchIcon class="h-[18px] w-[18px]" />, host);

    try {
      const root = host.firstElementChild as HTMLElement | null;
      expect(root).toBeTruthy();
      expect(root?.style.width).toBe('');
      expect(root?.style.height).toBe('');

      const glow = root?.querySelector('.redeven-flower-soft-aura-glow') as HTMLElement | null;
      expect(glow?.className).toContain('redeven-flower-soft-aura-workbench-glow');

      const svg = root?.querySelector('svg') as SVGElement | null;
      expect(svg?.getAttribute('class')).toContain('redeven-flower-soft-aura-workbench-svg');
    } finally {
      dispose();
    }
  });
});
