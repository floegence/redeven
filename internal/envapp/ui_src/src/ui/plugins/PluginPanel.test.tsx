// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PluginPanel } from './PluginPanel';
import { buildPluginPanelModel } from './pluginInventoryProjection';
import type { PluginInventoryItem, PluginPanelModel } from './pluginTypes';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

function pluginItem(overrides: Partial<PluginInventoryItem> = {}): PluginInventoryItem {
  return {
    inventoryKey: 'instance:plugininst_containers',
    pluginID: 'com.redeven.official.containers',
    pluginInstanceID: 'plugininst_containers',
    displayName: 'Containers',
    description: 'Manage Docker and Podman resources.',
    iconFallback: 'containers',
    publisher: 'Redeven',
    version: '2.0.0',
    managementRevision: 23,
    lifecycleState: 'enabled',
    trustBadge: 'official',
    pinned: false,
    defaultLaunchTarget: {
      pluginID: 'com.redeven.official.containers',
      pluginInstanceID: 'plugininst_containers',
      surfaceID: 'containers.dashboard',
      expectedManagementRevision: 23,
      preferredPlacement: 'activity',
    },
    ...overrides,
  };
}

function panelModel(item: PluginInventoryItem = pluginItem()): PluginPanelModel {
  return {
    loading: false,
    tiles: [
      { kind: 'open_center', id: 'plugin-center', label: 'Plugin Center' },
      { kind: 'plugin', item, action: item.lifecycleState === 'enabled' ? 'open_surface' : 'open_details' },
    ],
  };
}

function createTrigger(): HTMLButtonElement {
  const trigger = document.createElement('button');
  trigger.textContent = 'Plugins';
  trigger.getBoundingClientRect = vi.fn(() => ({
    x: 8,
    y: 96,
    left: 8,
    top: 96,
    right: 48,
    bottom: 136,
    width: 40,
    height: 40,
    toJSON: () => ({}),
  }));
  document.body.append(trigger);
  return trigger;
}

function mountPanel(props: Partial<Parameters<typeof PluginPanel>[0]> = {}) {
  const mount = document.createElement('div');
  document.body.append(mount);
  dispose = render(() => (
    <PluginPanel
      open
      model={panelModel()}
      onClose={vi.fn()}
      onOpenCenter={vi.fn()}
      onOpenPluginDetails={vi.fn()}
      onOpenPluginSurface={vi.fn()}
      {...props}
    />
  ), mount);
}

describe('PluginPanel', () => {
  it('renders plugins as a vertical action list with Plugin Center in a separate footer', () => {
    const onOpenCenter = vi.fn();
    mountPanel({ onOpenCenter });

    const dialog = document.querySelector('[role="dialog"]')!;
    const plugin = dialog.querySelector('[data-plugin-panel-tile="instance:plugininst_containers"]')!;
    const center = dialog.querySelector('[data-plugin-panel-tile="plugin-center"]')!;
    expect(plugin.textContent).toContain('Open in Activity');
    expect(center.textContent).toContain('Plugin Center');
    expect(plugin.compareDocumentPosition(center) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    (center as HTMLButtonElement).click();
    expect(onOpenCenter).toHaveBeenCalledTimes(1);
  });

  it('keeps catalog-only plugins in Plugin Center and shows the installed-plugin empty state', () => {
    const catalogItem = pluginItem({
      inventoryKey: 'catalog:containers',
      pluginInstanceID: undefined,
      lifecycleState: 'not_installed',
      managementRevision: undefined,
      defaultLaunchTarget: undefined,
    });
    mountPanel({ model: buildPluginPanelModel({ items: [catalogItem] }) });

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('[data-plugin-panel-tile="catalog:containers"]')).toBeNull();
    expect(dialog.textContent).toContain('No installed plugins yet.');
    expect(dialog.querySelector('[data-plugin-panel-tile="plugin-center"]')).not.toBeNull();
  });

  it('opens enabled plugins through the existing surface action', () => {
    const onOpenPluginSurface = vi.fn();
    mountPanel({ onOpenPluginSurface });

    (document.querySelector('[data-plugin-panel-tile="instance:plugininst_containers"]') as HTMLButtonElement).click();
    expect(onOpenPluginSurface).toHaveBeenCalledWith({
      pluginID: 'com.redeven.official.containers',
      pluginInstanceID: 'plugininst_containers',
      surfaceID: 'containers.dashboard',
      expectedManagementRevision: 23,
      preferredPlacement: 'activity',
    });
  });

  it('shows the next lifecycle action and routes disabled plugins to details', () => {
    const onOpenPluginDetails = vi.fn();
    mountPanel({
      model: panelModel(pluginItem({ lifecycleState: 'disabled', attentionReason: 'disabled' })),
      onOpenPluginDetails,
    });

    const row = document.querySelector('[data-plugin-panel-tile="instance:plugininst_containers"]') as HTMLButtonElement;
    expect(row.textContent).toContain('Disabled');
    expect(row.textContent).toContain('Enable');
    row.click();
    expect(onOpenPluginDetails).toHaveBeenCalledWith('instance:plugininst_containers');
  });

  it('anchors the opaque desktop surface to the Activity Bar trigger', () => {
    const trigger = createTrigger();
    mountPanel({ id: 'plugin-switcher', trigger });

    const dialog = document.querySelector('#plugin-switcher')!;
    const floatingLayer = dialog.parentElement!;
    expect(floatingLayer.style.left).toBe('56px');
    expect(floatingLayer.style.top).toBe('96px');
    expect(dialog.className).toContain('bg-popover');
    expect(dialog.className).not.toContain('backdrop-blur');
    expect(dialog.getAttribute('aria-modal')).toBe('false');
  });

  it('clamps the anchored desktop surface inside the viewport', () => {
    const trigger = createTrigger();
    trigger.getBoundingClientRect = vi.fn(() => ({
      x: 960,
      y: 740,
      left: 960,
      top: 740,
      right: 1000,
      bottom: 780,
      width: 40,
      height: 40,
      toJSON: () => ({}),
    }));
    mountPanel({ trigger });

    const floatingLayer = document.querySelector('[role="dialog"]')!.parentElement!;
    expect(floatingLayer.style.left).toBe('648px');
    expect(floatingLayer.style.top).toBe('200px');
  });

  it('focuses the first action without trapping Tab and restores trigger focus after Escape', async () => {
    const trigger = createTrigger();
    trigger.focus();
    const [open, setOpen] = createSignal(true);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginPanel
        open={open()}
        trigger={trigger}
        model={panelModel()}
        onClose={() => setOpen(false)}
        onOpenCenter={vi.fn()}
        onOpenPluginDetails={vi.fn()}
        onOpenPluginSurface={vi.fn()}
      />
    ), mount);

    await Promise.resolve();
    const row = document.querySelector('[data-plugin-panel-tile="instance:plugininst_containers"]') as HTMLButtonElement;
    expect(document.activeElement).toBe(row);

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closes on an outside click, restores focus, and lets the trigger own its toggle', () => {
    const trigger = createTrigger();
    const [open, setOpen] = createSignal(true);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginPanel
        open={open()}
        trigger={trigger}
        model={panelModel()}
        onClose={() => setOpen(false)}
        onOpenCenter={vi.fn()}
        onOpenPluginDetails={vi.fn()}
        onOpenPluginSurface={vi.fn()}
      />
    ), mount);

    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(open()).toBe(true);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(open()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('uses a modal mobile sheet with 44px controls and restores focus after backdrop dismiss', async () => {
    const trigger = createTrigger();
    const shell = document.createElement('main');
    const preExistingInert = document.createElement('aside');
    preExistingInert.inert = true;
    document.body.append(shell, preExistingInert);
    trigger.focus();
    const [open, setOpen] = createSignal(true);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginPanel
        open={open()}
        mobile
        trigger={trigger}
        model={panelModel()}
        onClose={() => setOpen(false)}
        onOpenCenter={vi.fn()}
        onOpenPluginDetails={vi.fn()}
        onOpenPluginSurface={vi.fn()}
      />
    ), mount);
    await Promise.resolve();

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const close = document.querySelector('[aria-label="Close plugins"]') as HTMLButtonElement;
    expect(close.className).toContain('h-[44px]');
    expect(close.className).toContain('w-[44px]');
    expect(document.activeElement).toBe(close);
    expect(trigger.inert).toBe(true);
    expect(shell.inert).toBe(true);
    expect(preExistingInert.inert).toBe(true);

    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    const center = document.querySelector('[data-plugin-panel-tile="plugin-center"]') as HTMLButtonElement;
    expect(document.activeElement).toBe(center);
    center.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(close);

    const backdrop = dialog.parentElement!;
    backdrop.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(open()).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(Boolean(trigger.inert)).toBe(false);
    expect(Boolean(shell.inert)).toBe(false);
    expect(preExistingInert.inert).toBe(true);
  });

  it('does not steal focus back after navigating to a plugin surface', () => {
    const trigger = createTrigger();
    const target = document.createElement('button');
    document.body.append(target);
    trigger.focus();
    const [open, setOpen] = createSignal(true);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginPanel
        open={open()}
        trigger={trigger}
        model={panelModel()}
        onClose={() => setOpen(false)}
        onOpenCenter={vi.fn()}
        onOpenPluginDetails={vi.fn()}
        onOpenPluginSurface={() => target.focus()}
      />
    ), mount);

    (document.querySelector('[data-plugin-panel-tile="instance:plugininst_containers"]') as HTMLButtonElement).click();
    expect(document.activeElement).toBe(target);
  });
});
