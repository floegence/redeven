import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { PluginCenterDrawer } from './PluginCenterDrawer';
import { PluginCenterView } from './PluginCenterView';
import { PluginPanel } from './PluginPanel';
import type { PluginInventoryItem } from './pluginTypes';

const item: PluginInventoryItem = {
  inventoryKey: 'instance:weather', pluginID: 'com.example.weather',
  pluginInstanceID: 'weather', displayName: 'Weather',
  description: 'Local forecasts for your workspace.', publisher: 'Example Publisher',
  iconFallback: 'generic', category: 'development', searchKeywords: [],
  version: '1.0.0', managementRevision: 1, lifecycleState: 'enabled',
  trustBadge: 'community', pinned: false,
  defaultLaunchTarget: {
    pluginID: 'com.example.weather', pluginInstanceID: 'weather',
    surfaceID: 'forecast', displayName: 'Weather', expectedManagementRevision: 1,
  },
};

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

const browserCommands = commands as unknown as {
  dismissPluginCenterBackdrop: () => Promise<{ isolatedDuringExit: boolean }>;
  wheelScrollRegion: (request: { regionSelector: string; deltaY: number }) => Promise<{ before: number; after: number }>;
};

function mountWorkbench(items: PluginInventoryItem[] = [item]) {
  const host = document.createElement('div');
  document.body.append(host);
  const [open, setOpen] = createSignal(false);
  const [present, setPresent] = createSignal(false);
  const [launcher, setLauncher] = createSignal(false);
  const [selected, setSelected] = createSignal<string>();
  const [focusRequest, setFocusRequest] = createSignal(0);
  const onRefresh = vi.fn();
  const onBackground = vi.fn();
  const onWheel = vi.fn();
  const onCommand = vi.fn();
  let trigger: HTMLButtonElement | undefined;
  const openCenter = (key?: string) => {
    trigger?.focus();
    setSelected(key);
    setFocusRequest((value) => value + 1);
    setLauncher(false);
    setOpen(true);
  };
  dispose = render(() => <>
    <div data-test-workbench-background inert={open() || present()} aria-hidden={open() || present() || undefined}>
      <div class="workbench-surface" data-floe-dialog-surface-host="true" data-floe-surface-portal-layer="true"
        onWheel={onWheel} style={{ position: 'relative', height: '100vh' }}>
        <button type="button" data-test-background style={{ position: 'absolute', top: '4px', left: '4px' }} onClick={onBackground}>Canvas action</button>
        <button ref={trigger} type="button" data-test-launcher style={{ position: 'absolute', bottom: '24px', left: '48%' }} onClick={() => setLauncher(true)}>Plugins</button>
        <PluginPanel open={launcher()} placement="workbench" trigger={trigger} model={{ loading: false, tiles: [
          { kind: 'open_center', id: 'plugin-center', label: 'Plugin Center' },
          { kind: 'plugin', item, action: 'open_details' },
        ] }} onClose={() => setLauncher(false)} onOpenCenter={() => openCenter()}
          onOpenPluginDetails={openCenter} onOpenPluginSurface={() => undefined} onSetPluginPin={() => undefined} />
      </div>
    </div>
    <PluginCenterDrawer open={open()} onOpenChange={setOpen} onPresenceChange={setPresent} title="Plugin Center">
      <PluginCenterView visible={open()} focusRequest={focusRequest()} selectedInventoryKey={selected()}
        projection={{ items }} loading={false} canManagePlugins canOpenPluginSurfaces
        onRefresh={onRefresh} onCommand={onCommand} onClose={() => setOpen(false)} />
    </PluginCenterDrawer>
  </>, host);
  const enter = async (details = false) => {
    await page.elementLocator(host.querySelector('[data-test-launcher]')!).click();
    const selector = details ? `[data-plugin-panel-tile="${item.inventoryKey}"]` : '[data-plugin-center-market-action]';
    await expect.poll(() => document.querySelector(selector)).not.toBeNull();
    if (details) {
      await page.elementLocator(document.querySelector(selector)!).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Plugin information', exact: true }).click();
    } else {
      await page.elementLocator(document.querySelector(selector)!).click();
    }
    await expect.poll(() => document.querySelector('[data-floe-dialog-presentation="bottom-drawer"] [data-floe-dialog-panel]')?.getAttribute('data-floating-presence')).toBe('open');
  };
  return { host, enter, onRefresh, onBackground, onWheel, onCommand };
}

it.each([{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 1024, height: 768 }, { width: 720, height: 450 }])(
  'keeps the drawer contained and details reachable at $width × $height', async ({ width, height }) => {
    await page.viewport(width, height);
    const fixture = mountWorkbench();
    await fixture.enter();
    const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
    await expect.poll(() => panel.getBoundingClientRect().bottom).toBe(height - 20);
    const rect = panel.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(64);
    expect(rect.width).toBe(Math.min(1400, width - 48));
    expect(rect.bottom).toBe(height - 20);
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
    expect(panel.closest('[inert]')).toBeNull();
    expect(document.activeElement).toBe(panel.querySelector('[data-plugin-center-search]'));
    await page.elementLocator(panel.querySelector('[data-plugin-center-item]')!).click();
    const details = panel.querySelector<HTMLElement>('[data-plugin-center-details]')!;
    const master = panel.querySelector<HTMLElement>('[data-plugin-center-master]')!;
    expect(document.activeElement).toBe(details.querySelector('[data-plugin-center-detail-heading]'));
    if (panel.clientWidth >= 1100) {
      expect(details.clientWidth).toBe(399);
      expect(master.getBoundingClientRect().right).toBe(details.getBoundingClientRect().left);
      await page.elementLocator(master.querySelector('[data-plugin-center-card-primary]')!).click();
      expect(fixture.onCommand).toHaveBeenCalledOnce();
    } else {
      expect(getComputedStyle(master).display).toBe('none');
      await userEvent.keyboard('{Escape}');
      expect(panel.querySelector('[data-plugin-center-details]')).toBeNull();
      expect(panel.isConnected).toBe(true);
    }
  },
);

it('keeps nested confirmation focus and Escape independent from the drawer', async () => {
  await page.viewport(1024, 768);
  const fixture = mountWorkbench();
  await fixture.enter(true);
  const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
  expect(panel.querySelector('[data-plugin-center-details]')?.getAttribute('data-plugin-center-details')).toBe(item.inventoryKey);
  await page.elementLocator(panel.querySelector('[data-plugin-center-install-external]')!).click();
  await page.getByRole('menuitem', { name: 'Install from source' }).click();
  await expect.poll(() => document.querySelectorAll('[data-floe-dialog-panel]').length).toBe(2);
  const child = [...document.querySelectorAll<HTMLElement>('[data-floe-dialog-panel]')].find((element) => element !== panel)!;
  expect(child.getAttribute('aria-modal')).toBe('true');
  for (let index = 0; index < 12; index++) {
    await userEvent.keyboard(index < 6 ? '{Tab}' : '{Shift>}{Tab}{/Shift}');
    expect(child.contains(document.activeElement)).toBe(true);
  }
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => child.isConnected).toBe(false);
  expect(panel.isConnected).toBe(true);
  await expect.poll(() => panel.contains(document.activeElement)).toBe(true);
  expect(panel.querySelector('[data-plugin-center-details]')).not.toBeNull();
  await userEvent.keyboard('{Escape}');
  expect(panel.querySelector('[data-plugin-center-details]')).toBeNull();
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => panel.isConnected).toBe(false);
});

it('retains search, filters, selection and scroll while excluding background input through exit', async () => {
  await page.viewport(1440, 900);
  const items = Array.from({ length: 60 }, (_, index) => ({ ...item, inventoryKey: `instance:weather-${index}`, displayName: `Weather ${index}` }));
  const fixture = mountWorkbench(items);
  await fixture.enter();
  const search = document.querySelector<HTMLInputElement>('[data-plugin-center-search]')!;
  await page.elementLocator(search).fill('Weather');
  await page.elementLocator(document.querySelector('[data-plugin-center-filter="source"]')!).click();
  await page.getByRole('menuitem', { name: 'External', exact: true }).click();
  const list = document.querySelector<HTMLElement>('[data-plugin-center-list]')!;
  const scroll = await browserCommands.wheelScrollRegion({ regionSelector: '[data-plugin-center-list]', deltaY: 550 });
  expect(scroll.after).toBeGreaterThan(scroll.before);
  expect(fixture.onWheel).not.toHaveBeenCalled();
  const savedScroll = list.scrollTop;
  expect((await browserCommands.dismissPluginCenterBackdrop()).isolatedDuringExit).toBe(true);
  expect(fixture.onBackground).not.toHaveBeenCalled();
  await expect.poll(() => document.querySelector('[data-floe-dialog-panel]')).toBeNull();
  await page.elementLocator(fixture.host.querySelector('[data-test-background]')!).click();
  expect(fixture.onBackground).toHaveBeenCalledOnce();
  await fixture.enter();
  expect(document.querySelector('[data-plugin-center-search]')).toBe(search);
  expect(search.value).toBe('Weather');
  expect(document.querySelector('[data-plugin-center-filter="source"]')?.textContent).toContain('External');
  expect(list.scrollTop).toBe(savedScroll);
  await page.elementLocator(list.querySelectorAll('[data-plugin-center-item]')[6]).click();
  const selectedKey = document.querySelector('[data-plugin-center-details]')!.getAttribute('data-plugin-center-details');
  await page.elementLocator(document.querySelector('[data-plugin-center-close]')!).click();
  await expect.poll(() => document.querySelector('[data-floe-dialog-panel]')).toBeNull();
  await fixture.enter();
  expect(document.querySelector('[data-plugin-center-details]')!.getAttribute('data-plugin-center-details')).toBe(selectedKey);
  expect(document.activeElement).toBe(search);
});

it('returns from a narrow uninstall confirmation to visible details and preserves failed Open feedback', async () => {
  await page.viewport(1024, 768);
  const fixture = mountWorkbench();
  await fixture.enter();
  const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
  fixture.onCommand.mockRejectedValueOnce(new Error('The plugin component could not be opened.'));
  await page.elementLocator(panel.querySelector('[data-plugin-center-card-primary]')!).click();
  await expect.poll(() => panel.querySelector('[data-plugin-center-error]')?.textContent).toContain('could not be opened');
  expect(panel.isConnected).toBe(true);
  await page.elementLocator(panel.querySelector('[data-plugin-center-card-menu]')!).click();
  await page.getByRole('menuitem', { name: 'Uninstall', exact: true }).click();
  await expect.poll(() => document.querySelectorAll('[data-floe-dialog-panel]').length).toBe(2);
  const confirmation = [...document.querySelectorAll<HTMLElement>('[data-floe-dialog-panel]')].find((element) => element !== panel)!;
  await expect.poll(() => confirmation.contains(document.activeElement)).toBe(true);
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => confirmation.isConnected).toBe(false);
  await expect.poll(() => document.activeElement).toBe(panel.querySelector('[data-plugin-center-detail-heading]'));
  expect(panel.isConnected).toBe(true);
});

it('opens an interactive management surface outside the inert Workbench after a Dock interaction', async () => {
  await page.viewport(1440, 900);
  const host = document.createElement('div');
  document.body.append(host);
  const [open, setOpen] = createSignal(false);
  const onRefresh = vi.fn();
  dispose = render(() => <>
    <div inert={open()} aria-hidden={open() || undefined}>
      <div class="workbench-surface" data-floe-dialog-surface-host="true" data-floe-surface-portal-layer="true" style={{ position: 'relative', height: '100vh' }}>
        <button type="button" data-test-dock onClick={() => setOpen(true)}>Plugins</button>
      </div>
    </div>
    <PluginCenterDrawer open={open()} onOpenChange={setOpen} title="Plugin Center">
      <PluginCenterView projection={{ items: [item] }} loading={false} canManagePlugins canOpenPluginSurfaces onRefresh={onRefresh} onCommand={vi.fn()} onClose={() => setOpen(false)} />
    </PluginCenterDrawer>
  </>, host);
  await page.elementLocator(host.querySelector('[data-test-dock]')!).click();
  const search = document.querySelector<HTMLInputElement>('[data-plugin-center-search]')!;
  expect(search.closest('[inert]')).toBeNull();
  await page.elementLocator(search).fill('Weather');
  await page.elementLocator(document.querySelector('[data-plugin-center-refresh]')!).click();
  expect(onRefresh).toHaveBeenCalledOnce();
  await page.elementLocator(document.querySelector('[data-plugin-center-close]')!).click();
  await expect.poll(() => document.querySelector('[data-floe-dialog-mode]')).toBeNull();
  expect(host.querySelector('[inert]')).toBeNull();
});
