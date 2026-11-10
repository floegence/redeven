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
  sourceKind: 'community', pinned: false,
  defaultLaunchTarget: {
    pluginID: 'com.example.weather', pluginInstanceID: 'weather',
    surfaceID: 'forecast', displayName: 'Weather', expectedManagementRevision: 1,
  },
};

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.classList.remove('light', 'dark');
});

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

it.each(['activity', 'workbench'] as const)('pins exclusively through pointer and keyboard context menus in %s', async (placement) => {
  await page.viewport(1280, 800);
  const fixture = mountLauncher(placement);
  await page.elementLocator(document.querySelector('[data-test-launcher]')!).click();
  const target = placement === 'activity' ? 'Activity Bar' : 'Workbench Dock';
  const tile = () => document.querySelector<HTMLButtonElement>('[data-plugin-panel-tile]')!;
  expect(document.querySelector('[data-plugin-quick-pin]')).toBeNull();
  expect(tile().parentElement?.querySelectorAll('button')).toHaveLength(1);
  await page.elementLocator(tile()).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin to ' + target, exact: true }).click();
  expect(fixture.onSetPin).toHaveBeenCalledWith(placement, item.inventoryKey, true);
  expect(fixture.onSetPin).toHaveBeenLastCalledWith(placement, item.inventoryKey, true);
  expect(fixture.onOpen).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await page.elementLocator(tile()).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unpin from ' + target, exact: true }).click();
  expect(fixture.onSetPin).toHaveBeenLastCalledWith(placement, item.inventoryKey, false);
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
  expect(fixture.onSetPin).toHaveBeenLastCalledWith(placement, item.inventoryKey, true);
  await page.screenshot({ path: '../../../.vitest-attachments/plugin-quick-pin-' + placement + '-clean-launcher.png' });
  await page.elementLocator(tile()).click({ button: 'right' });
  await page.screenshot({ path: '../../../.vitest-attachments/plugin-quick-pin-' + placement + '-context-menu.png' });
  await page.getByRole('menuitem', { name: 'Plugin information', exact: true }).click();
  expect(fixture.onDetails).toHaveBeenCalledWith(item.inventoryKey);
  expect(fixture.onOpen).not.toHaveBeenCalled();
});

it.each([320, 390, 768])('keeps the mobile launcher uncluttered and context menu accessible at %ipx', async (width) => {
  await page.viewport(width, 844);
  const fixture = mountLauncher('activity', true);
  const tile = document.querySelector<HTMLButtonElement>('[data-plugin-panel-tile]')!;
  expect(document.querySelector('[data-plugin-quick-pin]')).toBeNull();
  expect(tile.parentElement?.querySelectorAll('button')).toHaveLength(1);
  await page.elementLocator(tile).click({ button: 'right' });
  const action = page.getByRole('menuitem', { name: 'Pin to Activity Bar', exact: true });
  await expect.element(action).toBeVisible();
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!.getBoundingClientRect();
  expect(menu.left).toBeGreaterThanOrEqual(0);
  expect(menu.right).toBeLessThanOrEqual(width);
  await action.click();
  expect(fixture.onSetPin).toHaveBeenCalledWith('activity', item.inventoryKey, true);
  expect(fixture.onOpen).not.toHaveBeenCalled();
  await page.screenshot({ path: '../../../.vitest-attachments/plugin-quick-pin-mobile-' + width + '.png' });
});

it.each([
  [390, 'light'], [390, 'dark'],
  [1024, 'light'], [1024, 'dark'],
  [1440, 'light'], [1440, 'dark'],
] as const)('keeps Plugin Center pins unframed and reachable at %ipx in %s', async (width, theme) => {
  await page.viewport(width, 900);
  document.documentElement.classList.add(theme);
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
  const card = document.querySelector<HTMLElement>('[data-plugin-directory-card]')!;
  const cardPin = card.querySelector<HTMLButtonElement>('[data-plugin-quick-pin]')!;
  const expectUnframedPin = async (pin: HTMLButtonElement, pinned: boolean) => {
    // Move the pointer away so transient hover feedback is not mistaken for state.
    const away = pin.closest('[data-plugin-center-details]')?.querySelector('[data-plugin-center-detail-heading]')
      ?? document.querySelector('[data-plugin-center-item]')!;
    await page.elementLocator(away).hover();
    await expect.poll(() => getComputedStyle(pin).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(pin).borderWidth).toBe('0px');
    expect(getComputedStyle(pin).boxShadow).toBe('none');
    expect(pin.getAttribute('aria-pressed')).toBe(String(pinned));
    expect(getComputedStyle(pin.querySelector('svg')!).fill === 'none').toBe(!pinned);
    expect(pin.getBoundingClientRect().width).toBeGreaterThanOrEqual(width < 640 ? 44 : 32);
  };
  await expectUnframedPin(cardPin, false);
  await page.elementLocator(cardPin).click();
  await expectUnframedPin(cardPin, true);
  expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
  await page.screenshot({ path: '../../../.vitest-attachments/plugin-quick-pin-card-' + width + '-' + theme + '.png' });
  await page.elementLocator(document.querySelector('[data-plugin-center-item]')!).click();
  const details = document.querySelector<HTMLElement>('[data-plugin-center-details]')!;
  const pin = details.querySelector<HTMLButtonElement>('[data-plugin-quick-pin]')!;
  await expectUnframedPin(pin, true);
  await page.screenshot({ path: '../../../.vitest-attachments/plugin-quick-pin-detail-' + width + '-' + theme + '.png' });
  await page.elementLocator(pin).click();
  await expectUnframedPin(pin, false);
  expect(pins()).toEqual([]);
  expect(onCommand).not.toHaveBeenCalled();
  expect(details.scrollWidth).toBeLessThanOrEqual(details.clientWidth);
  // The shared Floe button keeps the normal keyboard focus and toggle behavior.
  pin.focus();
  await userEvent.keyboard('{Enter}');
  expect(pins()).toEqual([item.inventoryKey]);
  expect(document.activeElement).toBe(pin);
});
