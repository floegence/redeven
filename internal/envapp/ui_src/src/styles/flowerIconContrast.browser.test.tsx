import '../index.css';
import '../ui/flower-feature.css';

import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { render } from 'solid-js/web';
import { commands, page } from 'vitest/browser';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { FlowerIcon } from '../../../../flower_ui/src/icons/FlowerIcon';
import { FlowerNavigationIcon, FlowerWorkbenchIcon } from '../../../../flower_ui/src/icons/FlowerSoftAuraIcon';
import { FlowerProgressIndicator } from '../../../../flower_ui/src/chat/FlowerProgressIndicator';

let dispose: (() => void) | undefined;
let flowerAsset: string;
const media = commands as unknown as {
  emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void>;
};

beforeAll(async () => {
  const response = await fetch(`${import.meta.env.BASE_URL}flower.svg`);
  expect(response.ok).toBe(true);
  flowerAsset = await response.text();
});

afterEach(async () => {
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
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
      <div class="h-6 w-6" data-static-icon />
    </div>)}
  </div>, host);
  const asset = new DOMParser().parseFromString(flowerAsset, 'image/svg+xml');
  expect(asset.querySelector('parsererror')).toBeNull();
  for (const target of host.querySelectorAll('[data-static-icon]')) {
    target.append(document.importNode(asset.documentElement, true));
  }
  return host;
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

it('keeps the bloom recognizable at navigation, title and progress sizes across shell themes', async () => {
  await page.viewport(960, 500);
  const host = mount();
  const { rgb, composite, contrast } = contrastChecks();
  for (const preset of builtInShellThemePresets) {
    const root = document.documentElement;
    root.removeAttribute('style');
    root.classList.toggle('dark', preset.mode === 'dark');
    root.classList.toggle('light', preset.mode === 'light');
    root.dataset.floeShellTheme = preset.name;
    for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) {
      if (value) root.style.setProperty(name, value);
    }
    for (const surface of host.querySelectorAll<HTMLElement>('[data-icon-surface]')) {
      const background = rgb(getComputedStyle(surface).backgroundColor);
      expect(surface.querySelector('[data-static-icon] svg')?.querySelectorAll('path')).toHaveLength(5);
      for (const petal of surface.querySelectorAll<SVGPathElement>('svg path')) {
        const style = getComputedStyle(petal);
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

it('animates only the progress flower center and respects reduced motion', async () => {
  const host = mount();
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  const progress = host.querySelector<HTMLElement>('.flower-model-status-flower')!;
  const center = progress.querySelector<SVGCircleElement>('circle')!;
  expect(getComputedStyle(progress).animationName).toBe('none');
  expect(getComputedStyle(center).animationName).not.toBe('none');
  for (const petal of progress.querySelectorAll('path')) expect(getComputedStyle(petal).animationName).toBe('none');
  for (const icon of host.querySelectorAll('.redeven-flower-soft-aura')) {
    expect(icon.getAnimations({ subtree: true })).toHaveLength(0);
  }
  await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  expect(progress.getAnimations({ subtree: true })).toHaveLength(0);
  expect(getComputedStyle(center).transform).toBe('none');
});
