// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginCenterSection } from './PluginCenterSection';
import type { PluginInventoryProjection } from './pluginTypes';

const pluginApiMocks = vi.hoisted(() => ({
  executePluginLifecycleCommand: vi.fn(async () => ({})),
  loadPluginInventoryProjection: vi.fn(),
}));

vi.mock('./pluginApi', () => ({
  executePluginLifecycleCommand: pluginApiMocks.executePluginLifecycleCommand,
  loadPluginInventoryProjection: pluginApiMocks.loadPluginInventoryProjection,
}));

let dispose: (() => void) | undefined;

beforeEach(() => {
  pluginApiMocks.executePluginLifecycleCommand.mockClear();
  pluginApiMocks.loadPluginInventoryProjection.mockReset();
  pluginApiMocks.loadPluginInventoryProjection.mockResolvedValue(projection);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

const projection: PluginInventoryProjection = {
  items: [
    {
      pluginID: 'com.redeven.official.containers',
      displayName: 'Containers',
      description: 'Inspect Docker and Podman resources.',
      iconFallback: 'containers',
      publisher: 'Redeven',
      lifecycleState: 'not_installed',
      trustBadge: 'official',
      pinned: false,
      officialCatalog: {
        pluginID: 'com.redeven.official.containers',
        displayName: 'Containers',
        description: 'Inspect Docker and Podman resources.',
        publisher: 'Redeven',
        latestVersion: '1.0.0',
        stableVersion: '1.0.0',
        minRedevenVersion: '0.1.0',
        minReDevPluginVersion: '0.1.1',
        rolloutState: 'stable',
        defaultSurfaceID: 'containers.activity',
        iconFallback: 'containers',
        distribution: {
          releaseChannel: 'github_release_and_redeven_cdn',
          artifactName: 'containers-1.0.0.redevplugin',
          officialArtifactPath: 'official/containers/1.0.0/containers-1.0.0.redevplugin',
          requiresHostDistributionInstallAPI: true,
        },
      },
    },
  ],
};

describe('PluginCenterSection', () => {
  it('renders Installed, Discover, and Updates without developer install entry points', () => {
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterSection
        projection={projection}
        loading={false}
        error={null}
        onCommand={vi.fn()}
        canManagePlugins
      />
    ), mount);

    expect(mount.textContent).toContain('Installed');
    expect(mount.textContent).toContain('Discover');
    expect(mount.textContent).toContain('Updates');
    expect(mount.textContent).toContain('Containers');
    expect(mount.textContent).not.toMatch(/Developer|Install from URL|Install from file|unsigned|marketplace/i);
  });

  it('keeps official install unavailable until the host distribution install API exists', () => {
    const onCommand = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterSection
        projection={projection}
        loading={false}
        error={null}
        onCommand={onCommand}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const install = mount.querySelector('[data-plugin-action="install"]') as HTMLButtonElement;
    expect(install.disabled).toBe(true);
    expect(install.textContent).toContain('Install');
    expect(mount.textContent).toContain('Host distribution install API required');
    install.click();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('disables management actions when the runtime user cannot manage plugins', () => {
    const installedProjection: PluginInventoryProjection = {
      items: [
        {
          ...projection.items[0],
          pluginInstanceID: 'plugininst_containers',
          version: '1.0.0',
          lifecycleState: 'enabled',
          defaultLaunchTarget: {
            pluginInstanceID: 'plugininst_containers',
            surfaceID: 'containers.activity',
            preferredPlacement: 'activity',
          },
        },
      ],
    };
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterSection
        projection={installedProjection}
        loading={false}
        error={null}
        onCommand={vi.fn()}
        canManagePlugins={false}
        canOpenPluginSurfaces
      />
    ), mount);

    expect((mount.querySelector('[data-plugin-action="open"]') as HTMLButtonElement).disabled).toBe(true);
    expect((mount.querySelector('[data-plugin-action="disable"]') as HTMLButtonElement).disabled).toBe(true);
    expect((mount.querySelector('[data-plugin-action="uninstall"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not allow surface open until the released surface host is wired', () => {
    const onCommand = vi.fn();
    const installedProjection: PluginInventoryProjection = {
      items: [
        {
          ...projection.items[0],
          pluginInstanceID: 'plugininst_containers',
          version: '1.0.0',
          lifecycleState: 'enabled',
          defaultLaunchTarget: {
            pluginInstanceID: 'plugininst_containers',
            surfaceID: 'containers.activity',
            preferredPlacement: 'activity',
          },
        },
      ],
    };
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterSection
        projection={installedProjection}
        loading={false}
        error={null}
        onCommand={onCommand}
        canManagePlugins
      />
    ), mount);

    const open = mount.querySelector('[data-plugin-action="open"]') as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    open.click();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('does not offer enable for plugins that need trust attention or updates', () => {
    const needsAttentionProjection: PluginInventoryProjection = {
      items: [
        {
          ...projection.items[0],
          pluginInstanceID: 'plugininst_containers',
          version: '1.0.0',
          lifecycleState: 'needs_attention',
          trustBadge: 'unavailable',
          attentionReason: 'trust_unavailable',
        },
      ],
    };
    const updatesProjection: PluginInventoryProjection = {
      items: [
        {
          ...projection.items[0],
          pluginInstanceID: 'plugininst_containers',
          version: '0.9.0',
          lifecycleState: 'update_available',
        },
      ],
    };
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterSection
        projection={needsAttentionProjection}
        loading={false}
        error={null}
        onCommand={vi.fn()}
        canManagePlugins
      />
    ), mount);

    expect(mount.textContent).toContain('Needs attention');
    expect(mount.querySelector('[data-plugin-action="enable"]')).toBeNull();
    expect(mount.querySelector('[data-plugin-action="open"]')).toBeNull();

    dispose();
    mount.innerHTML = '';
    dispose = render(() => (
      <PluginCenterSection
        projection={updatesProjection}
        loading={false}
        error={null}
        onCommand={vi.fn()}
        canManagePlugins
      />
    ), mount);

    expect(mount.querySelector('[data-plugin-action="update"]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-action="enable"]')).toBeNull();
  });

  it('loads live plugin inventory when no projection is injected', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => <PluginCenterSection />, mount);

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pluginApiMocks.loadPluginInventoryProjection).toHaveBeenCalledTimes(1);
    expect(mount.textContent).toContain('Containers');
  });
});
