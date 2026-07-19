// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PluginCenterView } from './PluginCenterView';
import { OFFICIAL_CONTAINERS_RELEASE_REF } from './officialContainersRelease.generated';
import type { PluginInventoryProjection } from './pluginTypes';

let dispose: (() => void) | undefined;

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
    publisherID: 'com.redeven.official',
    pluginInstanceID: 'plugini_redeven_official_containers',
    displayName: 'Containers',
    description: 'Manage Docker and Podman resources.',
    publisher: 'Redeven',
    latestVersion: '2.0.0',
    stableVersion: '2.0.0',
    minRedevenVersion: '0.9.0',
    minReDevPluginVersion: '0.5.1',
    rolloutState: 'stable',
    defaultSurfaceID: 'containers.dashboard',
    iconFallback: 'containers',
    distribution: {
      releaseRef: OFFICIAL_CONTAINERS_RELEASE_REF,
    },
  },
} satisfies PluginInventoryProjection['items'][number];

const databasePlugin = {
  ...containersPlugin,
  pluginID: 'com.redeven.official.database',
  displayName: 'Database Tools',
  description: 'Inspect local database connections.',
  iconFallback: 'database',
  officialCatalog: undefined,
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
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
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
          version: '2.0.0',
          managementRevision: 7,
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
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
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
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const install = mount.querySelector('[data-plugin-action="install"]') as HTMLButtonElement;
    expect(install.disabled).toBe(false);
    expect(install.textContent).toContain('Install');
    expect(containersPlugin.officialCatalog.distribution.releaseRef).toBe(OFFICIAL_CONTAINERS_RELEASE_REF);
    install.click();
    expect(onCommand).toHaveBeenCalledWith({
      type: 'install',
      pluginID: 'com.redeven.official.containers',
      source: 'official_catalog',
    }, expect.any(AbortSignal));
  });

  it('disables management actions when the runtime user cannot manage plugins', () => {
    const installedProjection: PluginInventoryProjection = {
      items: [
        {
          ...containersPlugin,
          pluginInstanceID: 'plugininst_containers',
          version: '2.0.0',
          managementRevision: 7,
          lifecycleState: 'enabled',
          defaultLaunchTarget: {
            pluginID: 'com.redeven.official.containers',
            pluginInstanceID: 'plugininst_containers',
            surfaceID: 'containers.dashboard',
            expectedManagementRevision: 7,
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
        onRefresh={vi.fn()}
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
          version: '2.0.0',
          managementRevision: 11,
          lifecycleState: 'enabled',
          defaultLaunchTarget: {
            pluginID: 'com.redeven.official.containers',
            pluginInstanceID: 'plugininst_containers',
            surfaceID: 'containers.dashboard',
            expectedManagementRevision: 11,
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
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const open = mount.querySelector('[data-plugin-action="open"]') as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    open.click();
    expect(onCommand).toHaveBeenCalledWith({
      type: 'open_surface',
      pluginID: 'com.redeven.official.containers',
      pluginInstanceID: 'plugininst_containers',
      surfaceID: 'containers.dashboard',
      expectedManagementRevision: 11,
      placement: 'activity',
    }, expect.any(AbortSignal));
  });

  it('updates official catalog packages through the bundled lifecycle API', () => {
    const onCommand = vi.fn();
    const updatesProjection: PluginInventoryProjection = {
      items: [
        {
          ...containersPlugin,
          pluginInstanceID: 'plugininst_containers',
          version: '1.9.0',
          managementRevision: 13,
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
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    const update = mount.querySelector('[data-plugin-action="update"]') as HTMLButtonElement;
    expect(update.disabled).toBe(false);
    update.click();
    expect(onCommand).toHaveBeenCalledWith({
      type: 'update',
      pluginID: 'com.redeven.official.containers',
      pluginInstanceID: 'plugininst_containers',
      expectedManagementRevision: 13,
      targetVersion: '2.0.0',
    }, expect.any(AbortSignal));
  });

  it('does not offer enable for plugins that need trust attention or updates', () => {
    const needsAttentionProjection: PluginInventoryProjection = {
      items: [
        {
          ...containersPlugin,
          pluginInstanceID: 'plugininst_containers',
          version: '2.0.0',
          managementRevision: 17,
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
          version: '1.9.0',
          managementRevision: 19,
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
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
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
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    expect(mount.querySelector('[data-plugin-action="update"]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-action="enable"]')).toBeNull();
  });

  it('uses explicit inventory and refresh props without owning an implicit API client', () => {
    const onRefresh = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        error={null}
        canManagePlugins
        canOpenPluginSurfaces={false}
        onRefresh={onRefresh}
        onCommand={vi.fn()}
      />
    ), mount);

    (mount.querySelector('[data-plugin-center-refresh]') as HTMLButtonElement).click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('admits one management mutation at a time and supplies an abort signal', async () => {
    let finish!: () => void;
    const onCommand = vi.fn((_command, signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        error={null}
        canManagePlugins
        canOpenPluginSurfaces={false}
        onRefresh={vi.fn()}
        onCommand={onCommand}
      />
    ), mount);

    const install = mount.querySelector('[data-plugin-action="install"]') as HTMLButtonElement;
    install.click();
    install.click();
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(install.disabled).toBe(true);

    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(install.disabled).toBe(false);
  });
});
