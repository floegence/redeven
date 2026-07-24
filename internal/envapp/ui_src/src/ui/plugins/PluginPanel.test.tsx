// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PluginPanel } from './PluginPanel';
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

describe('PluginPanel', () => {
  it('renders Plugin Center as the first tile and opens it', () => {
    const onOpenCenter = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginPanel
        open
        model={panelModel()}
        onClose={vi.fn()}
        onOpenCenter={onOpenCenter}
        onOpenPluginDetails={vi.fn()}
        onOpenPluginSurface={vi.fn()}
      />
    ), mount);

    const tiles = [...mount.querySelectorAll('[data-plugin-panel-tile]')];
    expect(tiles[0].textContent).toContain('Plugin Center');
    (tiles[0] as HTMLButtonElement).click();
    expect(onOpenCenter).toHaveBeenCalledTimes(1);
  });

  it('opens enabled plugins through the surface callback', () => {
    const onOpenPluginSurface = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginPanel
        open
        model={panelModel()}
        onClose={vi.fn()}
        onOpenCenter={vi.fn()}
        onOpenPluginDetails={vi.fn()}
        onOpenPluginSurface={onOpenPluginSurface}
      />
    ), mount);

    (mount.querySelectorAll('[data-plugin-panel-tile]')[1] as HTMLButtonElement).click();
    expect(onOpenPluginSurface).toHaveBeenCalledWith({
      pluginID: 'com.redeven.official.containers',
      pluginInstanceID: 'plugininst_containers',
      surfaceID: 'containers.dashboard',
      expectedManagementRevision: 23,
      preferredPlacement: 'activity',
    });
  });

  it('routes disabled plugins to details', () => {
    const onOpenPluginDetails = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginPanel
        open
        model={panelModel(pluginItem({ lifecycleState: 'disabled', attentionReason: 'disabled' }))}
        onClose={vi.fn()}
        onOpenCenter={vi.fn()}
        onOpenPluginDetails={onOpenPluginDetails}
        onOpenPluginSurface={vi.fn()}
      />
    ), mount);

    (mount.querySelectorAll('[data-plugin-panel-tile]')[1] as HTMLButtonElement).click();
    expect(onOpenPluginDetails).toHaveBeenCalledWith('instance:plugininst_containers');
  });

  it('closes on Escape and exposes pointer cursor classes for tiles', () => {
    const onClose = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginPanel
        open
        model={panelModel()}
        onClose={onClose}
        onOpenCenter={vi.fn()}
        onOpenPluginDetails={vi.fn()}
        onOpenPluginSurface={vi.fn()}
      />
    ), mount);

    for (const tile of mount.querySelectorAll('[data-plugin-panel-tile]')) {
      expect(tile.className).toContain('cursor-pointer');
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('defers outside close until click so the activity trigger can toggle cleanly', () => {
    const onClose = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginPanel
        open
        model={panelModel()}
        onClose={onClose}
        onOpenCenter={vi.fn()}
        onOpenPluginDetails={vi.fn()}
        onOpenPluginSurface={vi.fn()}
      />
    ), mount);

    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the panel, traps Tab, and restores the opening control', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const mount = document.createElement('div');
    document.body.append(mount);
    const [open, setOpen] = createSignal(true);

    dispose = render(() => (
      <PluginPanel
        open={open()}
        model={panelModel()}
        onClose={() => setOpen(false)}
        onOpenCenter={vi.fn()}
        onOpenPluginDetails={vi.fn()}
        onOpenPluginSurface={vi.fn()}
      />
    ), mount);
    await Promise.resolve();

    const focusable = [...mount.querySelectorAll<HTMLButtonElement>('button')];
    expect(document.activeElement).toBe(focusable[0]);
    focusable.at(-1)!.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusable[0]);

    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusable.at(-1));

    setOpen(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('does not restore the opening control after navigating to a plugin surface', async () => {
    const trigger = document.createElement('button');
    const target = document.createElement('button');
    document.body.append(trigger, target);
    trigger.focus();
    const mount = document.createElement('div');
    document.body.append(mount);
    const [open, setOpen] = createSignal(true);
    dispose = render(() => (
      <PluginPanel
        open={open()}
        model={panelModel()}
        onClose={() => setOpen(false)}
        onOpenCenter={vi.fn()}
        onOpenPluginDetails={vi.fn()}
        onOpenPluginSurface={() => target.focus()}
      />
    ), mount);
    await Promise.resolve();

    (mount.querySelectorAll('[data-plugin-panel-tile]')[1] as HTMLButtonElement).click();
    expect(document.activeElement).toBe(target);
    expect(document.activeElement).not.toBe(trigger);
  });
});
