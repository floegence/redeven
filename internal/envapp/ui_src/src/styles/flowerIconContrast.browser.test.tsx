import '../index.css';
import '../ui/flower-feature.css';

import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { render } from 'solid-js/web';
import { commands, page } from 'vitest/browser';
import { afterEach, expect, it } from 'vitest';
import { FlowerIcon } from '../../../../flower_ui/src/icons/FlowerIcon';
import { FlowerNavigationIcon, FlowerWorkbenchIcon } from '../../../../flower_ui/src/icons/FlowerSoftAuraIcon';
import { FlowerProgressIndicator } from '../../../../flower_ui/src/chat/FlowerProgressIndicator';

let dispose: (() => void) | undefined;
const media = commands as unknown as {
  emulateMediaPreferences: (preferences: { reducedMotion?: 'reduce' | 'no-preference'; colorScheme?: 'light' | 'dark' | null }) => Promise<void>;
};

afterEach(async () => {
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference', colorScheme: null });
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.classList.remove('light', 'dark');
});

function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <div class="bg-background p-6 text-foreground">
    {['var(--background)', '#ffffff', '#f6f4f1', '#f2f4f7'].map(background => <div
      data-icon-surface
      style={{ background, padding: '20px', display: 'flex', gap: '24px', 'align-items': 'center', color: 'var(--primary)' }}
    >
      <FlowerNavigationIcon />
      <FlowerIcon class="h-5 w-5" />
      <FlowerWorkbenchIcon class="h-[18px] w-[18px]" />
      <FlowerProgressIndicator progress={{ kind: 'waiting_response', runID: 'icon-contrast' }} label="Waiting for model response" />
    </div>)}
  </div>, host);
  return host;
}

function applyTheme(preset: typeof builtInShellThemePresets[number]) {
  const root = document.documentElement;
  root.removeAttribute('style');
  root.classList.toggle('dark', preset.mode === 'dark');
  root.classList.toggle('light', preset.mode === 'light');
  root.dataset.floeShellTheme = preset.name;
  for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) {
    if (value) root.style.setProperty(name, value);
  }
}

function expectOriginalDarkArtwork(svg: SVGSVGElement, styleOf: typeof getComputedStyle, asset = false) {
  const petals = svg.querySelectorAll('path');
  expect(petals).toHaveLength(5);
  petals.forEach((petal, index) => {
    const style = styleOf(petal);
    expect(style.fill).toBe('rgb(255, 255, 255)');
    expect(style.stroke).toBe(asset ? 'rgb(100, 116, 139)' : style.color);
    expect(parseFloat(style.strokeWidth)).toBe(.45);
    expect(Number(style.strokeOpacity)).toBe(index % 2 === 0 ? .18 : .13);
    expect(Number(style.opacity)).toBe(index % 2 === 0 ? .95 : .85);
  });
  const center = svg.querySelector<SVGCircleElement>('circle[r="3"], circle[r="3.0"]')!;
  expect(styleOf(center).fill).toContain('url(');
  expect(styleOf(center).stroke).toBe('none');
  const gradient = svg.querySelector('radialGradient:last-child')!;
  expect([...gradient.querySelectorAll('stop')].map(stop => styleOf(stop).stopColor))
    .toEqual(['rgb(253, 230, 138)', 'rgb(251, 191, 36)', 'rgb(245, 158, 11)']);
  const core = svg.querySelector<SVGCircleElement>('circle[r="1.5"]')!;
  expect(styleOf(core).display).not.toBe('none');
  expect(styleOf(core).fill).toBe('rgb(245, 158, 11)');
  expect(Number(styleOf(core).opacity)).toBe(.45);
}

function contrastChecks() {
  const context = document.createElement('canvas').getContext('2d')!;
  const rgb = (value: string) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  };
  const composite = (color: number[], background: number[], opacity: number) => color.slice(0, 3)
    .map((channel, index) => channel * opacity + background[index] * (1 - opacity));
  const luminance = (color: number[]) => color.slice(0, 3).reduce((sum, channel, index) => {
    const value = channel / 255;
    return sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
  }, 0);
  const contrast = (a: number[], b: number[]) => (Math.max(luminance(a), luminance(b)) + .05)
    / (Math.min(luminance(a), luminance(b)) + .05);
  return { rgb, composite, contrast };
}

it('keeps the outlined bloom recognizable across light shell themes', async () => {
  await page.viewport(960, 500);
  await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  const host = mount();
  const { rgb, composite, contrast } = contrastChecks();
  for (const preset of builtInShellThemePresets.filter(preset => preset.mode === 'light')) {
    applyTheme(preset);
    for (const surface of host.querySelectorAll<HTMLElement>('[data-icon-surface]')) {
      const background = rgb(getComputedStyle(surface).backgroundColor);
      for (const petal of surface.querySelectorAll<SVGPathElement>('svg path')) {
        const style = getComputedStyle(petal);
        expect(style.stroke).toBe('rgb(105, 119, 136)');
        expect(Number(style.strokeOpacity)).toBe(1);
        expect(Number(style.opacity)).toBe(1);
        const fill = composite(rgb(style.fill), background, Number(style.fillOpacity) * Number(style.opacity));
        const stroke = composite(rgb(style.stroke), background, Number(style.strokeOpacity) * Number(style.opacity));
        expect.soft(Math.max(contrast(fill, background), contrast(stroke, background)), `${preset.name}: visible petal boundary`).toBeGreaterThanOrEqual(3);
      }
    }
  }
  const progress = host.querySelector<SVGSVGElement>('.flower-model-status-flower-icon')!;
  expect(progress.getBoundingClientRect().width).toBe(16);
  const petal = progress.querySelector('path')!;
  const strokePixels = parseFloat(getComputedStyle(petal).strokeWidth) * progress.getBoundingClientRect().width / progress.viewBox.baseVal.width;
  expect(strokePixels, 'the 16px progress icon keeps a near-one-pixel outline').toBeGreaterThanOrEqual(.9);
  await page.screenshot({ element: host, path: '__screenshots__/flower-icon-contrast.png' });
});

it('preserves the original bloom in every dark theme after switching from light', async () => {
  await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  const host = mount();
  const icons = [...host.querySelectorAll<SVGSVGElement>('svg')];
  for (const preset of builtInShellThemePresets.filter(preset => preset.mode === 'dark')) {
    applyTheme(builtInShellThemePresets.find(preset => preset.mode === 'light')!);
    expect(getComputedStyle(icons[0].querySelector('path')!).stroke).toBe('rgb(105, 119, 136)');
    applyTheme(preset);
    for (const icon of icons) expectOriginalDarkArtwork(icon, getComputedStyle);
  }
  await page.screenshot({ element: host, path: '__screenshots__/flower-icon-dark.png' });
});

it.each(['light', 'dark'] as const)('uses the matching %s artwork in the standalone SVG', async (mode) => {
  await media.emulateMediaPreferences({ colorScheme: mode });
  const frame = document.createElement('iframe');
  frame.width = '16';
  frame.height = '16';
  frame.style.colorScheme = mode;
  frame.src = `${import.meta.env.BASE_URL}flower.svg`;
  await new Promise<void>((resolve, reject) => {
    frame.onload = () => resolve();
    frame.onerror = () => reject(new Error('Flower SVG could not load'));
    document.body.append(frame);
  });
  const svg = frame.contentDocument!.documentElement as unknown as SVGSVGElement;
  const styleOf = frame.contentWindow!.getComputedStyle.bind(frame.contentWindow);
  if (mode === 'dark') {
    expectOriginalDarkArtwork(svg, styleOf, true);
    expect(styleOf(svg.querySelector('circle[r="11"]')!).display).not.toBe('none');
  } else {
    for (const petal of svg.querySelectorAll('path')) {
      expect(styleOf(petal).stroke).toBe('rgb(105, 119, 136)');
      expect(parseFloat(styleOf(petal).strokeWidth)).toBe(1.4);
      expect(Number(styleOf(petal).opacity)).toBe(1);
    }
  }
});

it.each(['light', 'dark'])('rotates the whole progress flower and respects reduced motion in %s mode', async (mode) => {
  document.documentElement.classList.add(mode);
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  const host = mount();
  const flowers = host.querySelectorAll<HTMLElement>('.flower-model-status-flower');
  expect(flowers).toHaveLength(4);
  for (const progress of flowers) {
    const style = getComputedStyle(progress);
    expect(style.animationName).toBe('flower-model-status-flower-twirl');
    expect(style.animationDuration).toBe('2.6s');
    expect(style.animationIterationCount).toBe('infinite');
    const animations = progress.getAnimations();
    expect(animations).toHaveLength(1);
    const animation = animations[0];
    expect(animation.playState).toBe('running');
    animation.pause();
    animation.currentTime = 0;
    const initialTransform = getComputedStyle(progress).transform;
    animation.currentTime = 884;
    const rotatedTransform = getComputedStyle(progress).transform;
    expect(rotatedTransform).not.toBe(initialTransform);
    const matrix = new DOMMatrixReadOnly(rotatedTransform);
    expect(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI).toBeCloseTo(142, 1);
    for (const part of progress.querySelectorAll('path, circle')) {
      expect(getComputedStyle(part).animationName).toBe('none');
    }
  }
  for (const icon of host.querySelectorAll('.redeven-flower-soft-aura')) {
    expect(icon.getAnimations({ subtree: true })).toHaveLength(0);
  }
  await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  for (const progress of flowers) {
    expect(progress.getAnimations({ subtree: true })).toHaveLength(0);
    expect(getComputedStyle(progress).transform).toBe('none');
  }
});
