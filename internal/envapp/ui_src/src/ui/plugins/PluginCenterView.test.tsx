// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginCenterView } from './PluginCenterView';
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

const containersPlugin = {
  pluginID: 'com.redeven.official.containers',
  displayName: 'Containers',
  description: 'Manage Docker and Podman resources.',
  iconFallback: 'containers',
  publisher: 'Redeven',
  lifecycleState: 'not_installed',
  trustBadge: 'official',
  pinned: false,
  officialCatalog: {
    pluginID: 'com.redeven.official.containers',
    displayName: 'Containers',
    description: 'Manage Docker and Podman resources.',
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
    },
  },
} satisfies PluginInventoryProjection['items'][number];

const databasePlugin = {
  ...containersPlugin,
  pluginID: 'com.redeven.official.database',
  displayName: 'Database Tools',
  description: 'Inspect local database connections.',
  iconFallback: 'database',
  officialCatalog: {
    ...containersPlugin.officialCatalog,
    pluginID: 'com.redeven.official.database',
    displayName: 'Database Tools',
    description: 'Inspect local database connections.',
    defaultSurfaceID: 'database.activity',
    iconFallback: 'database',
    distribution: {
      ...containersPlugin.officialCatalog.distribution,
      artifactName: 'database-1.0.0.redevplugin',
      officialArtifactPath: 'official/database/1.0.0/database-1.0.0.redevplugin',
    },
  },
} satisfies PluginInventoryProjection['items'][number];

const projection: PluginInventoryProjection = {
  items: [containersPlugin, databasePlugin],
};

describe('PluginCenterView', () => {
  it('renders a dedicated management shell outside Settings with local search', () => {
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        error={null}
        onCommand={vi.fn()}
        canManagePlugins
      />
    ), mount);

    expect(mount.querySelector('[data-plugin-center-view]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-shell]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-list]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-details]')).not.toBeNull();
    expect(mount.querySelector('[data-settings-nav-item="plugins"]')).toBeNull();
    expect(mount.textContent).toContain('Installed');
    expect(mount.textContent).toContain('Discover');
    expect(mount.textContent).toContain('Updates');
    expect(mount.textContent).toContain('Containers');
    expect(mount.textContent).not.toMatch(/Developer|Install from URL|Install from file|unsigned|marketplace/i);

    const search = mount.querySelector('[data-plugin-center-search]') as HTMLInputElement;
    search.value = 'database';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));

    expect(mount.querySelector('[data-plugin-center-item="com.redeven.official.database"]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-item="com.redeven.official.containers"]')).toBeNull();
  });

  it('selects a plugin details inspector from an explicit shell request', () => {
    const installedProjection: PluginInventoryProjection = {
      items: [
        {
          ...containersPlugin,
          pluginInstanceID: 'plugininst_containers',
          version: '1.0.0',
          lifecycleState: 'disabled',
          attentionReason: 'disabled',
        },
      ],
    };
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={installedProjection}
        loading={false}
        error={null}
        selectedPluginID="com.redeven.official.containers"
        onCommand={vi.fn()}
        canManagePlugins
      />
    ), mount);

    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Containers');
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Disabled');
  });

  it('allows official catalog installation through the bundled lifecycle API', () => {
    const onCommand = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        error={null}
        onCommand={onCommand}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const install = mount.querySelector('[data-plugin-action="install"]') as HTMLButtonElement;
    expect(install.disabled).toBe(false);
    expect(install.textContent).toContain('Install');
    install.click();
    expect(onCommand).toHaveBeenCalledWith({
      type: 'install',
      pluginID: 'com.redeven.official.containers',
      source: 'official_catalog',
    });
  });

  it('disables management actions when the runtime user cannot manage plugins', () => {
    const installedProjection: PluginInventoryProjection = {
      items: [
        {
          ...containersPlugin,
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
      <PluginCenterView
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

  it('allows enabled official plugin surfaces to open through the sandbox host', () => {
    const onCommand = vi.fn();
    const installedProjection: PluginInventoryProjection = {
      items: [
        {
          ...containersPlugin,
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
      <PluginCenterView
        projection={installedProjection}
        loading={false}
        error={null}
        onCommand={onCommand}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const open = mount.querySelector('[data-plugin-action="open"]') as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    open.click();
    expect(onCommand).toHaveBeenCalledWith({
      type: 'open_surface',
      pluginInstanceID: 'plugininst_containers',
      surfaceID: 'containers.activity',
      placement: 'activity',
    });
  });

  it('updates official catalog packages through the bundled lifecycle API', () => {
    const onCommand = vi.fn();
    const updatesProjection: PluginInventoryProjection = {
      items: [
        {
          ...containersPlugin,
          pluginInstanceID: 'plugininst_containers',
          version: '0.9.0',
          lifecycleState: 'update_available',
        },
      ],
    };
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={updatesProjection}
        loading={false}
        error={null}
        onCommand={onCommand}
        canManagePlugins
      />
    ), mount);

    const update = mount.querySelector('[data-plugin-action="update"]') as HTMLButtonElement;
    expect(update.disabled).toBe(false);
    update.click();
    expect(onCommand).toHaveBeenCalledWith({
      type: 'update',
      pluginID: 'com.redeven.official.containers',
      pluginInstanceID: 'plugininst_containers',
      targetVersion: '1.0.0',
    });
  });

  it('does not offer enable for plugins that need trust attention or updates', () => {
    const needsAttentionProjection: PluginInventoryProjection = {
      items: [
        {
          ...containersPlugin,
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
          ...containersPlugin,
          pluginInstanceID: 'plugininst_containers',
          version: '0.9.0',
          lifecycleState: 'update_available',
        },
      ],
    };
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
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
      <PluginCenterView
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

    dispose = render(() => <PluginCenterView />, mount);

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pluginApiMocks.loadPluginInventoryProjection).toHaveBeenCalledTimes(1);
    expect(mount.textContent).toContain('Containers');
  });
});
