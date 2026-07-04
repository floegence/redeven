// @vitest-environment jsdom

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
    pluginID: 'com.redeven.official.containers',
    pluginInstanceID: 'plugininst_containers',
    displayName: 'Containers',
    description: 'Inspect Docker and Podman resources.',
    iconFallback: 'containers',
    publisher: 'Redeven',
    version: '1.0.0',
    lifecycleState: 'enabled',
    trustBadge: 'official',
    pinned: false,
    defaultLaunchTarget: {
      pluginInstanceID: 'plugininst_containers',
      surfaceID: 'containers.activity',
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
      pluginInstanceID: 'plugininst_containers',
      surfaceID: 'containers.activity',
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
    expect(onOpenPluginDetails).toHaveBeenCalledWith('com.redeven.official.containers');
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
});
