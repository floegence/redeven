import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { PluginCenterView } from './PluginCenterView';
import type { PluginInventoryItem } from './pluginTypes';

const mediaCommands = commands as unknown as {
  emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void>;
};

const item: PluginInventoryItem = {
  inventoryKey: 'instance:weather', pluginID: 'com.example.weather',
  pluginInstanceID: 'weather', displayName: 'Weather',
  description: 'Local forecasts for your workspace.', publisher: 'Example Publisher',
  iconFallback: 'generic', category: 'development', searchKeywords: [],
  version: '1.0.0', managementRevision: 1, lifecycleState: 'update_available',
  trustBadge: 'community', pinned: false,
  defaultLaunchTarget: {
    pluginID: 'com.example.weather', pluginInstanceID: 'weather',
    surfaceID: 'forecast', displayName: 'Weather', expectedManagementRevision: 1,
  },
};

let dispose: (() => void) | undefined;
const originalRootStyle = document.documentElement.getAttribute('style');
const originalRootClass = document.documentElement.className;
const originalTheme = document.documentElement.getAttribute('data-floe-shell-theme');

afterEach(async () => {
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.className = originalRootClass;
  for (const [name, value] of [['style', originalRootStyle], ['data-floe-shell-theme', originalTheme]] as const) {
    if (value === null) document.documentElement.removeAttribute(name);
    else document.documentElement.setAttribute(name, value);
  }
  await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
});

function luminance(color: string): number {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d')!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function expectReadable(button: HTMLButtonElement): void {
  const style = getComputedStyle(button);
  const foreground = luminance(style.color);
  const background = luminance(style.backgroundColor);
  expect((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)).toBeGreaterThanOrEqual(4.5);
  expect(getComputedStyle(button.querySelector('svg path')!).stroke).toBe(style.color);
  expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth);
}

it.each(builtInShellThemePresets)('distinguishes update review with readable card and detail actions in $name', async (preset) => {
  await page.viewport(1440, 900);
  await mediaCommands.emulateMediaPreferences({ reducedMotion: 'reduce' });
  const root = document.documentElement;
  root.classList.toggle('dark', preset.mode === 'dark');
  root.classList.toggle('light', preset.mode === 'light');
  root.dataset.floeShellTheme = preset.name;
  for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) {
    if (value) root.style.setProperty(name, value);
  }
  const host = document.createElement('div');
  host.style.height = '100vh';
  document.body.appendChild(host);
  const [canManage, setCanManage] = createSignal(true);
  const onCommand = vi.fn();
  dispose = render(() => <PluginCenterView
    projection={{ items: [item, { ...item, inventoryKey: 'instance:notes', pluginInstanceID: 'notes', displayName: 'Notes', lifecycleState: 'enabled' }] }}
    loading={false} canManagePlugins={canManage()} canOpenPluginSurfaces
    onRefresh={() => undefined} onCommand={onCommand}
  />, host);

  const card = host.querySelector<HTMLButtonElement>('[data-plugin-center-card-primary="instance:weather"]')!;
  const open = host.querySelector<HTMLButtonElement>('[data-plugin-center-card-primary="instance:notes"]')!;
  expect(card.textContent).toContain('Review update');
  expect(open.textContent).toContain('Open');
  expect(getComputedStyle(card).backgroundColor).not.toBe(getComputedStyle(open).backgroundColor);
  expectReadable(card);
  const idleBackground = getComputedStyle(card).backgroundColor;
  await page.elementLocator(card).hover();
  await expect.poll(() => getComputedStyle(card).backgroundColor).not.toBe(idleBackground);
  expectReadable(card);
  await userEvent.keyboard('{Tab}');
  card.focus();
  expect(card.matches(':focus-visible')).toBe(true);
  expect(getComputedStyle(card).boxShadow).not.toBe('none');

  host.querySelector<HTMLButtonElement>('[data-plugin-center-item="instance:weather"]')!.click();
  const detail = host.querySelector<HTMLButtonElement>('[data-plugin-action="update-external"]')!;
  await page.elementLocator(host.querySelector<HTMLElement>('[data-plugin-center-detail-heading]')!).hover();
  await expect.poll(() => getComputedStyle(detail).backgroundColor).toBe(idleBackground);
  expectReadable(detail);
  await page.elementLocator(detail).hover();
  await expect.poll(() => getComputedStyle(detail).backgroundColor).not.toBe(idleBackground);
  expectReadable(detail);

  setCanManage(false);
  expect(card.disabled).toBe(true);
  expect(detail.disabled).toBe(true);
  expect(getComputedStyle(card).cursor).toBe('not-allowed');
  expect(Number(getComputedStyle(card).opacity)).toBeLessThan(1);
  card.click();
  detail.click();
  expect(onCommand).not.toHaveBeenCalled();
});
