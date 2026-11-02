import '../../index.css';

import { Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { NotificationProvider } from '@floegence/floe-webapp-core';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { PluginPanel } from './PluginPanel';
import { PluginCenterView } from './PluginCenterView';
import type { PluginInventoryItem } from './pluginTypes';
import type { PluginPinPlacement } from './pluginDockPins';

const item: PluginInventoryItem = {
  inventoryKey: 'instance:weather', pluginID: 'com.example.weather',
  pluginInstanceID: 'weather', displayName: 'Weather',
  description: 'Local forecasts for your workspace.', publisher: 'Example Publisher',
  iconFallback: 'generic', category: 'utilities', searchKeywords: [],
  version: '1.0.0', managementRevision: 1, lifecycleState: 'enabled',
  trustBadge: 'community', pinned: false,
  defaultLaunchTarget: {
    pluginID: 'com.example.weather', pluginInstanceID: 'weather',
    surfaceID: 'forecast', displayName: 'Weather', expectedManagementRevision: 1,
  },
};

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

function mountLauncher(placement: PluginPinPlacement, mobile = false) {
  const host = document.createElement('div');
  document.body.append(host);
  const [open, setOpen] = createSignal(mobile);
  const [pins, setPins] = createSignal<string[]>([]);
  const onOpen = vi.fn();
  const onDetails = vi.fn();
  const onSetPin = vi.fn((_: PluginPinPlacement, key: string, pinned: boolean) => { setPins(pinned ? [key] : []); });
  let trigger: HTMLButtonElement | undefined;
  dispose = render(() => <NotificationProvider>
    <div class={placement === 'workbench' ? 'workbench-surface' : 'bg-background'}
      data-floe-dialog-surface-host={placement === 'workbench' ? 'true' : undefined}
      data-floe-surface-portal-layer={placement === 'workbench' ? 'true' : undefined}
      style={{ position: 'relative', height: '100vh' }}>
      <Show when={!mobile}><button type="button" ref={trigger} data-test-launcher
        style={placement === 'workbench' ? { position: 'absolute', bottom: '24px', left: '48%' } : { position: 'absolute', top: '80px', left: '8px' }}
        onClick={() => setOpen(true)}>Plugins</button></Show>
      <PluginPanel open={open()} mobile={mobile} contentOnly={mobile} placement={placement} trigger={trigger}
        model={{ loading: false, tiles: [{ kind: 'plugin', item, action: 'open_surface' }] }}
        pinnedInventoryKeys={pins()} onSetPluginPin={onSetPin}
        onClose={() => setOpen(false)} onOpenCenter={() => undefined}
        onOpenPluginDetails={onDetails} onOpenPluginSurface={onOpen} />
    </div>
  </NotificationProvider>, host);
  return { onSetPin, onOpen, onDetails };
}

it.each(['activity', 'workbench'] as const)('keeps quick pins, pointer menus and keyboard menus synchronized in %s', async (placement) => {
  await page.viewport(1280, 800);
  const fixture = mountLauncher(placement);
  await page.elementLocator(document.querySelector('[data-test-launcher]')!).click();
  const target = placement === 'activity' ? 'Activity Bar' : 'Workbench Dock';
  const tile = () => document.querySelector<HTMLButtonElement>('[data-plugin-panel-tile]')!;
  const pin = () => document.querySelector<HTMLButtonElement>('[data-plugin-quick-pin]')!;
  await page.getByRole('button', { name: 'Weather: Pin to ' + target, exact: true }).click();
  expect(fixture.onSetPin).toHaveBeenCalledWith(placement, item.inventoryKey, true);
  await expect.poll(() => pin().getAttribute('aria-pressed')).toBe('true');
  expect(fixture.onOpen).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await page.elementLocator(tile()).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unpin from ' + target, exact: true }).click();
  await expect.poll(() => pin().getAttribute('aria-pressed')).toBe('false');
  await expect.poll(() => document.activeElement).toBe(tile());
  await userEvent.keyboard('{Shift>}{F10}{/Shift}');
  await expect.element(page.getByRole('menuitem', { name: 'Pin to ' + target, exact: true })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(tile());
  await userEvent.keyboard('{Shift>}{F10}{/Shift}');
  await expect.poll(() => document.activeElement?.getAttribute('data-floating-menu-item-id')).toBe('plugin-information');
  await userEvent.keyboard('{End}');
  await expect.poll(() => document.activeElement?.getAttribute('data-floating-menu-item-id')).toBe('plugin-pin-toggle');
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => pin().getAttribute('aria-pressed')).toBe('true');
  await page.screenshot({ path: '../../../.vitest-attachments/plugin-quick-pin-' + placement + '-quick-pin.png' });
  await page.elementLocator(tile()).click({ button: 'right' });
  await page.screenshot({ path: '../../../.vitest-attachments/plugin-quick-pin-' + placement + '-context-menu.png' });
  await page.getByRole('menuitem', { name: 'Plugin information', exact: true }).click();
  expect(fixture.onDetails).toHaveBeenCalledWith(item.inventoryKey);
  expect(fixture.onOpen).not.toHaveBeenCalled();
});

it.each([320, 390, 768])('keeps the mobile pin target visible and separate at %ipx', async (width) => {
  await page.viewport(width, 844);
  const fixture = mountLauncher('activity', true);
  const pin = document.querySelector<HTMLButtonElement>('[data-plugin-quick-pin]')!;
  const box = pin.getBoundingClientRect();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.right).toBeLessThanOrEqual(width);
  expect(pin.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))).toBe(true);
  await page.elementLocator(pin).click();
  expect(fixture.onSetPin).toHaveBeenCalledWith('activity', item.inventoryKey, true);
  expect(fixture.onOpen).not.toHaveBeenCalled();
  await page.screenshot({ path: '../../../.vitest-attachments/plugin-quick-pin-mobile-' + width + '.png' });
});

it.each([390, 1024, 1440])('keeps Plugin Center card and detail pin actions reachable at %ipx', async (width) => {
  await page.viewport(width, 900);
  const host = document.createElement('div');
  host.style.height = '100vh';
  document.body.append(host);
  const [pins, setPins] = createSignal<string[]>([]);
  const onCommand = vi.fn();
  dispose = render(() => <NotificationProvider><PluginCenterView
    projection={{ items: [item] }} loading={false} canManagePlugins canOpenPluginSurfaces
    onRefresh={() => undefined} onCommand={onCommand} activityPinnedInventoryKeys={pins()}
    onSetActivityPin={(key, pinned) => { setPins(pinned ? [key] : []); }}
  /></NotificationProvider>, host);
  await page.getByRole('button', { name: 'Weather: Pin to Activity Bar', exact: true }).click();
  const card = document.querySelector<HTMLElement>('[data-plugin-directory-card]')!;
  expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
  await page.elementLocator(document.querySelector('[data-plugin-center-item]')!).click();
  const details = document.querySelector<HTMLElement>('[data-plugin-center-details]')!;
  const pin = details.querySelector<HTMLButtonElement>('[data-plugin-quick-pin]')!;
  expect(pin.getAttribute('aria-pressed')).toBe('true');
  await page.elementLocator(pin).click();
  expect(pins()).toEqual([]);
  expect(onCommand).not.toHaveBeenCalled();
  expect(details.scrollWidth).toBeLessThanOrEqual(details.clientWidth);
  await page.screenshot({ path: '../../../.vitest-attachments/plugin-quick-pin-center-' + width + '.png' });
});
