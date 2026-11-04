import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { ActivityBar } from '@floegence/floe-webapp-core/layout';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import {
  ActivityBarFlowerIcon, ActivityBarFolderIcon, ActivityBarTerminalIcon,
  ActivityBarMonitorIcon, ActivityBarCodespacesIcon, ActivityBarPortsIcon,
  ActivityBarHostApplicationsIcon, ActivityBarContainersIcon, ActivityBarTessivenIcon,
  ActivityBarPluginsIcon, ActivityBarSwitchIcon, ActivityBarSettingsIcon,
} from './ActivityBarDockIcons';

let dispose: (() => void) | undefined;
const media = commands as unknown as {
  emulateMediaPreferences: (preferences: { forcedColors?: 'active' | 'none'; reducedMotion?: 'reduce' | 'no-preference' }) => Promise<void>;
};
afterEach(async () => {
  await media.emulateMediaPreferences({ forcedColors: 'none', reducedMotion: 'no-preference' });
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.classList.remove('light', 'dark');
});

it.each(builtInShellThemePresets)('keeps every product icon readable and selected in $name', async (preset) => {
  await page.viewport(1100, 850);
  await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  const icons = [ActivityBarFlowerIcon, ActivityBarFolderIcon, ActivityBarTerminalIcon,
    ActivityBarMonitorIcon, ActivityBarCodespacesIcon, ActivityBarPortsIcon,
    ActivityBarHostApplicationsIcon, ActivityBarContainersIcon, ActivityBarTessivenIcon,
    ActivityBarPluginsIcon, ActivityBarSwitchIcon, ActivityBarSettingsIcon];
  const items = icons.map((icon, index) => ({ id: String(index), icon, label: 'Activity ' + index, collapseBehavior: 'preserve' as const }));
  const host = document.createElement('div'); document.body.append(host);
  const [active, setActive] = createSignal('0');
  dispose = render(() => <div class="bg-background text-foreground flex min-h-screen">
    <ActivityBar items={items} activeId={active()} onActiveChange={setActive} />
  </div>, host);
  const context = document.createElement('canvas').getContext('2d')!;
  const paint = (color: string, behind = [255, 255, 255]): number[] => {
    context.clearRect(0, 0, 1, 1); context.fillStyle = 'rgb(' + behind.join(',') + ')'; context.fillRect(0, 0, 1, 1);
    context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const background = (node: Element | null): number[] => node ? paint(getComputedStyle(node).backgroundColor, background(node.parentElement)) : [255, 255, 255];
  const luminance = (rgb: number[]) => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const name = preset.name;
  const root = document.documentElement;
  root.removeAttribute('style');
  root.classList.toggle('dark', preset.mode === 'dark');
  root.classList.toggle('light', preset.mode === 'light');
  root.dataset.floeShellTheme = name;
  for (const [token, value] of Object.entries(preset.semanticTokens ?? {})) if (value) root.style.setProperty(token, value);
  const flower = host.querySelector<SVGSVGElement>('[data-floe-rail-icon="flower"]')!;
  const petals = [...flower.querySelectorAll('path')];
  expect(petals).toHaveLength(5);
  const shape = petals.map(petal => [petal.getAttribute('d'), petal.getAttribute('transform')]);
  setActive('1');
  expect(flower.getAttribute('data-flower-active')).toBe('false');
  await expect.poll(() => {
    const style = getComputedStyle(petals[0]);
    const fill = paint(style.fill);
    const stroke = paint(style.stroke);
    return (Math.max(luminance(fill), luminance(stroke)) + .05) / (Math.min(luminance(fill), luminance(stroke)) + .05);
  }).toBeGreaterThanOrEqual(3);
  if (name === 'porcelain-light') await page.screenshot({ element: flower.closest('button')!, path: '__screenshots__/flower-navigation-idle.png' });
  for (const item of items) {
    const button = host.querySelector<HTMLButtonElement>('[aria-label="' + item.label + '"]')!;
    await userEvent.click(button);
    const svg = button.querySelector('svg')!;
    expect(svg.getAttribute('data-floe-rail-active')).toBe('true');
    expect(host.querySelectorAll('[data-floe-rail-active="true"]')).toHaveLength(1);
    expect(svg.getBoundingClientRect().width).toBe(20);
    if (item.id === '0') {
      if (name === 'porcelain-light') await page.screenshot({ element: flower.closest('button')!, path: '__screenshots__/flower-navigation-selected.png' });
      expect(flower.getAttribute('data-flower-active')).toBe('true');
      expect([...flower.querySelectorAll('path')]).toEqual(petals);
      expect(petals.map(petal => [petal.getAttribute('d'), petal.getAttribute('transform')])).toEqual(shape);
      for (const petal of petals) {
        const style = getComputedStyle(petal);
        expect(style.fill).toBe(getComputedStyle(flower).color);
        expect(Number(style.opacity)).toBe(1);
        expect(Number(style.strokeOpacity)).toBe(1);
        expect(parseFloat(style.strokeWidth) * 20 / 24).toBeGreaterThanOrEqual(1);
      }
      await expect.poll(() => {
        const style = getComputedStyle(petals[0]);
        const fill = paint(style.fill);
        const seam = paint(style.stroke);
        return (Math.max(luminance(fill), luminance(seam)) + .05) / (Math.min(luminance(fill), luminance(seam)) + .05);
      }).toBeGreaterThanOrEqual(3);
    }
    await expect.poll(() => {
      const fill = paint(getComputedStyle(button.querySelector('span')!).backgroundColor, background(button));
      const ink = paint(getComputedStyle(svg).color, fill);
      return (Math.max(luminance(fill), luminance(ink)) + .05) / (Math.min(luminance(fill), luminance(ink)) + .05);
    }).toBeGreaterThanOrEqual(3);
  }
  setActive('0');
  await page.screenshot({ element: host.querySelector('nav')!, path: '__screenshots__/activity-icons-' + name + '.png' });
});


it('preserves distinct petals and a selected fill in forced colors', async () => {
  await media.emulateMediaPreferences({ forcedColors: 'active', reducedMotion: 'reduce' });
  document.documentElement.classList.add('light');
  const host = document.createElement('div'); document.body.append(host);
  const [active, setActive] = createSignal('files');
  dispose = render(() => <ActivityBar items={[
    { id: 'flower', icon: ActivityBarFlowerIcon, label: 'Flower' },
    { id: 'files', icon: ActivityBarFolderIcon, label: 'Files' },
  ]} activeId={active()} onActiveChange={setActive} />, host);
  const svg = host.querySelector<SVGSVGElement>('[data-floe-rail-icon="flower"]')!;
  const petals = [...svg.querySelectorAll('path')];
  expect(petals).toHaveLength(5);
  const idleFill = getComputedStyle(petals[0]).fill;
  for (const petal of petals) expect(getComputedStyle(petal).fill).not.toBe(getComputedStyle(petal).stroke);
  await userEvent.click(svg.closest('button')!);
  expect(svg.getAttribute('data-flower-active')).toBe('true');
  expect(getComputedStyle(petals[0]).fill).not.toBe(idleFill);
  for (const petal of petals) expect(getComputedStyle(petal).fill).not.toBe(getComputedStyle(petal).stroke);
  expect(svg.getBoundingClientRect().width).toBe(20);
  await page.screenshot({ element: host, path: '__screenshots__/flower-navigation-forced-colors.png' });
});
