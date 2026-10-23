import '../../index.css';
import '../flower-feature.css';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { FlowerThinkingDisclosure } from '../../../../../flower_ui/src/FlowerThinkingDisclosure';

let dispose: (() => void) | undefined;
const media = commands as unknown as {
  emulateMediaPreferences: (preferences: { reducedMotion?: 'reduce' | 'no-preference'; forcedColors?: 'active' | 'none' }) => Promise<void>;
};

afterEach(async () => {
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.classList.remove('dark', 'light');
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' });
});

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const [live, setLive] = createSignal(true);
  const [confirmed, setConfirmed] = createSignal(true);
  dispose = render(() => <FlowerThinkingDisclosure contentID="petal-test" content={() => 'Inspecting the request.'}
    live={live} liveConfirmed={confirmed} preserveOnEnd={() => false}
    label={() => live() && confirmed() ? 'Thinking...' : 'Thought process'}
    expandLabel={() => 'Expand thinking'} collapseLabel={() => 'Collapse thinking'}
    contentBody={() => <p>Inspecting the request.</p>} />, root);
  const flower = root.querySelector<HTMLElement>('.flower-thinking-flower')!;
  const petals = [...flower.querySelectorAll<HTMLElement>('.flower-thinking-ink')];
  const center = flower.querySelector<HTMLElement>('.flower-thinking-center-ink')!;
  const animations = () => flower.getAnimations({ subtree: true });
  const seek = (fraction: number) => {
    for (const animation of animations()) { animation.pause(); animation.currentTime = fraction * 2400; }
  };
  return { root, flower, petals, center, animations, seek, setLive, setConfirmed };
}

it('fills clockwise from each petal base, retains color, then fills the center and fades together', () => {
  const { flower, petals, center, animations, seek } = mount();
  expect(flower.getBoundingClientRect().width).toBe(16);
  expect(animations()).toHaveLength(6);
  expect(animations().every(animation => animation.effect!.getTiming().duration === 2400)).toBe(true);
  for (let i = 0; i < petals.length; i++) {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(petals[i].parentElement!).transform);
    expect(matrix.a).toBeCloseTo(Math.cos(i * 72 * Math.PI / 180), 5);
    expect(matrix.b).toBeCloseTo(Math.sin(i * 72 * Math.PI / 180), 5);
  }
  seek(0.1);
  const offset = new DOMMatrixReadOnly(getComputedStyle(petals[0]).transform).m42;
  expect(offset).toBeGreaterThan(0);
  expect(offset).toBeLessThan(petals[0].getBoundingClientRect().height);
  expect(getComputedStyle(petals[0]).maskImage).toContain('linear-gradient');
  expect(getComputedStyle(petals[0]).backgroundImage).toContain('radial-gradient');
  for (let i = 0; i < 5; i++) {
    seek(0.17 + i * 0.1);
    for (let j = 0; j <= i; j++) {
      expect(getComputedStyle(petals[j]).opacity).toBe('1');
      expect(new DOMMatrixReadOnly(getComputedStyle(petals[j]).transform).m42).toBeCloseTo(0);
    }
    for (let j = i + 2; j < 5; j++) expect(getComputedStyle(petals[j]).opacity).toBe('0');
    expect(getComputedStyle(center).opacity).toBe('0');
  }
  seek(0.66);
  expect(Number(getComputedStyle(center).opacity)).toBeGreaterThan(0);
  expect(Number(getComputedStyle(center).opacity)).toBeLessThan(1);
  for (const fraction of [0.72, 0.8]) {
    seek(fraction);
    for (const ink of [...petals, center]) expect(getComputedStyle(ink).opacity).toBe('1');
  }
  seek(0.88);
  const fading = petals.map(ink => getComputedStyle(ink).opacity);
  expect(new Set([...fading, getComputedStyle(center).opacity]).size).toBe(1);
  expect(Number(fading[0])).toBeGreaterThan(0);
  expect(Number(fading[0])).toBeLessThan(1);
  seek(0.98);
  for (const ink of [...petals, center]) expect(getComputedStyle(ink).opacity).toBe('0');
});

it('removes animations on disconnect and completion, and restarts only confirmed live thinking', () => {
  const { animations, setConfirmed, setLive, petals, center } = mount();
  setConfirmed(false);
  expect(animations()).toHaveLength(0);
  for (const ink of [...petals, center]) expect(getComputedStyle(ink).opacity).toBe('1');
  setConfirmed(true);
  expect(animations()).toHaveLength(6);
  setLive(false);
  expect(animations()).toHaveLength(0);
  setConfirmed(false);
  setConfirmed(true);
  expect(animations()).toHaveLength(0);
});

it('keeps every shipped theme legible with a light warm center, including live theme switches', () => {
  const { flower, animations, seek } = mount();
  const originalAnimations = animations();
  const context = document.createElement('canvas').getContext('2d')!;
  const probe = document.createElement('span');
  flower.append(probe);
  const rgb = (token: string) => {
    probe.style.color = 'var(' + token + ')';
    context.fillStyle = getComputedStyle(probe).color;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const luminance = (channels: number[]) => channels.map(channel => {
    const n = channel / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a: number[], b: number[]) => {
    const first = luminance(a), second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  };
  for (const theme of builtInShellThemePresets) {
    document.documentElement.dataset.floeShellTheme = theme.name;
    document.documentElement.classList.toggle('dark', theme.mode === 'dark');
    document.documentElement.classList.toggle('light', theme.mode === 'light');
    seek(0.76);
    expect(animations(), theme.name).toEqual(originalAnimations);
    const background = rgb('--flower-thinking-empty');
    expect(contrast(rgb('--flower-thinking-outline'), background), theme.name + ': boundary').toBeGreaterThanOrEqual(3);
    expect(contrast(rgb('--flower-thinking-fill'), background), theme.name + ': fill').toBeGreaterThanOrEqual(3);
    const gold = rgb('--flower-thinking-gold');
    expect(luminance(gold), theme.name + ': bright center').toBeGreaterThan(0.65);
    expect(gold[0]).toBeGreaterThan(gold[2]);
    expect(gold[1]).toBeGreaterThan(gold[2]);
  }
});

it('fills the entire center without a dark rim or separating halo in every theme', () => {
  const { center, seek, setLive } = mount();
  const expectSeamlessCenter = () => {
    const surface = center.parentElement!;
    const style = getComputedStyle(surface);
    expect(style.borderTopWidth).toBe('0px');
    expect(style.boxShadow).toBe('none');
    expect(getComputedStyle(center).opacity).toBe('1');
    expect(center.getBoundingClientRect().width).toBeCloseTo(surface.getBoundingClientRect().width);
    expect(center.getBoundingClientRect().height).toBeCloseTo(surface.getBoundingClientRect().height);
  };
  for (const theme of builtInShellThemePresets) {
    document.documentElement.dataset.floeShellTheme = theme.name;
    document.documentElement.classList.toggle('dark', theme.mode === 'dark');
    document.documentElement.classList.toggle('light', theme.mode === 'light');
    for (const fraction of [0.72, 0.8]) {
      seek(fraction);
      expectSeamlessCenter();
    }
  }
  setLive(false);
  expectSeamlessCenter();
});

it('shows a static full flower for reduced motion and system boundaries in forced colors', async () => {
  const { animations, petals, center } = mount();
  await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  expect(animations()).toHaveLength(0);
  for (const ink of [...petals, center]) {
    expect(getComputedStyle(ink).opacity).toBe('1');
    expect(getComputedStyle(ink).transform).toBe('none');
  }
  expect(getComputedStyle(center.parentElement!).borderTopWidth).toBe('0px');
  expect(getComputedStyle(center.parentElement!).boxShadow).toBe('none');
  await media.emulateMediaPreferences({ forcedColors: 'active' });
  expect(getComputedStyle(petals[0]).backgroundImage).toBe('none');
  expect(getComputedStyle(petals[0]).maskImage).toBe('none');
  expect(getComputedStyle(center).backgroundImage).toBe('none');
  expect(getComputedStyle(center.parentElement!).borderTopStyle).toBe('solid');
  expect(getComputedStyle(center.parentElement!).borderTopColor).not.toBe(getComputedStyle(center).backgroundColor);
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  expect(animations()).toHaveLength(6);
});
