import '../index.css';

import { afterEach, describe, expect, it } from 'vitest';
import { expectSingleInputFocus } from './inputFocus.test-support';

type BoundaryProbe = Readonly<{
  border: string;
  background: string;
}>;

function colorChannels(value: string): readonly [number, number, number] {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas color context is unavailable.');
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return [red / 255, green / 255, blue / 255];
}

function relativeLuminance(value: string): number {
  const channels = colorChannels(value).map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function applyTheme(name: string, mode: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', mode === 'dark');
  document.documentElement.classList.toggle('light', mode === 'light');
  document.documentElement.dataset.floeShellTheme = name;
}

function mountBoundary(className: string, background: string): BoundaryProbe {
  const element = document.createElement('div');
  element.className = className;
  // The role owns color; an inline color would override ordinary stylesheet rules.
  element.style.borderWidth = '1px';
  element.style.borderStyle = 'solid';
  element.style.background = background;
  document.body.appendChild(element);
  const style = getComputedStyle(element);
  return { border: style.borderTopColor, background: style.backgroundColor };
}

function mountTokenBoundary(border: string, background: string): BoundaryProbe {
  const element = document.createElement('div');
  element.style.border = `1px solid ${border}`;
  element.style.background = background;
  document.body.appendChild(element);
  const style = getComputedStyle(element);
  return { border: style.borderTopColor, background: style.backgroundColor };
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('style');
});

describe('Classic Dark rendered boundary contract', () => {
  it('keeps decorative seams quiet and actual control boundaries distinct', () => {
    applyTheme('classic-dark', 'dark');

    const panel = mountBoundary('redeven-boundary-panel', 'var(--redeven-surface-panel)');
    const divider = mountBoundary('redeven-divider', 'var(--redeven-surface-panel)');
    const control = mountBoundary('redeven-surface-control', 'var(--redeven-surface-panel)');
    const overlay = mountBoundary('redeven-surface-overlay', 'var(--redeven-surface-overlay)');
    const chrome = mountTokenBoundary('var(--chrome-border)', 'var(--sidebar)');

    for (const seam of [panel, divider, overlay, chrome]) {
      expect(contrastRatio(seam.border, seam.background)).toBeGreaterThan(1.1);
      expect(contrastRatio(seam.border, seam.background)).toBeLessThan(1.6);
    }
    expect(contrastRatio(control.border, control.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(panel.border, panel.background)).toBeGreaterThan(contrastRatio(divider.border, divider.background));
  });

  it('keeps a real input boundary visible while allowing the shared focus color', () => {
    applyTheme('classic-dark', 'dark');
    const input = document.createElement('input');
    input.className = 'redeven-surface-control';
    input.style.borderWidth = '1px';
    input.style.borderStyle = 'solid';
    input.style.background = 'var(--redeven-surface-panel)';
    document.body.appendChild(input);

    const style = getComputedStyle(input);
    expect(contrastRatio(style.borderTopColor, style.backgroundColor)).toBeGreaterThanOrEqual(3);
    expectSingleInputFocus(input);
    expect(contrastRatio(style.borderTopColor, style.backgroundColor)).toBeGreaterThanOrEqual(3);
  });

  it('keeps Classic palette roles scoped away from other presets', () => {
    applyTheme('classic-dark', 'dark');
    const classicBorder = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();
    const classicInput = getComputedStyle(document.documentElement).getPropertyValue('--input').trim();

    applyTheme('nord', 'dark');
    const nordStyle = getComputedStyle(document.documentElement);
    expect(nordStyle.getPropertyValue('--border').trim()).not.toBe(classicBorder);
    expect(nordStyle.getPropertyValue('--input').trim()).not.toBe(classicInput);

    applyTheme('classic-light', 'light');
    const lightStyle = getComputedStyle(document.documentElement);
    expect(lightStyle.getPropertyValue('--border').trim()).toBe('#d4d8cd');
    expect(lightStyle.getPropertyValue('--input').trim()).toBe('#858e80');
  });
});
