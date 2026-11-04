import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ActivityBar } from '@floegence/floe-webapp-core/layout';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import {
  ActivityBarFlowerIcon, ActivityBarFolderIcon, ActivityBarTerminalIcon,
  ActivityBarMonitorIcon, ActivityBarCodespacesIcon, ActivityBarPortsIcon,
  ActivityBarHostApplicationsIcon, ActivityBarContainersIcon, ActivityBarTessivenIcon,
  ActivityBarPluginsIcon, ActivityBarSwitchIcon, ActivityBarSettingsIcon,
} from './ActivityBarDockIcons';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.classList.remove('light', 'dark');
});

it('keeps every product icon readable and selected through light and dark theme changes', async () => {
  await page.viewport(1100, 850);
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
  for (const name of ['porcelain-light', 'classic-light', 'classic-dark', 'soft-black']) {
    const preset = builtInShellThemePresets.find(preset => preset.name === name)!;
    const root = document.documentElement;
    root.removeAttribute('style');
    root.classList.toggle('dark', preset.mode === 'dark');
    root.classList.toggle('light', preset.mode === 'light');
    root.dataset.floeShellTheme = name;
    for (const [token, value] of Object.entries(preset.semanticTokens ?? {})) if (value) root.style.setProperty(token, value);
    for (const item of items) {
      const button = host.querySelector<HTMLButtonElement>('[aria-label="' + item.label + '"]')!;
      await userEvent.click(button);
      const svg = button.querySelector('svg')!;
      expect(svg.getAttribute('data-floe-rail-active')).toBe('true');
      expect(host.querySelectorAll('[data-floe-rail-active="true"]')).toHaveLength(1);
      expect(svg.getBoundingClientRect().width).toBe(20);
      await expect.poll(() => {
        const fill = paint(getComputedStyle(button.querySelector('span')!).backgroundColor, background(button));
        const ink = paint(getComputedStyle(svg).color, fill);
        return (Math.max(luminance(fill), luminance(ink)) + .05) / (Math.min(luminance(fill), luminance(ink)) + .05);
      }).toBeGreaterThanOrEqual(3);
    }
    setActive('0');
    await page.screenshot({ element: host.querySelector('nav')!, path: '__screenshots__/activity-icons-' + name + '.png' });
  }
});
