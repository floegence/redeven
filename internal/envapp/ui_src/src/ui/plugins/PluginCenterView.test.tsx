// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PluginCenterView } from './PluginCenterView';
import { OFFICIAL_CONTAINERS_RELEASE_REF } from './officialContainersRelease.generated';
import {
  OFFICIAL_PLUGIN_CATALOG_SEED,
  OFFICIAL_PLUGIN_MARKET_DETAIL,
} from './officialPluginCatalog.test-fixture';
import type {
  ExternalPluginCommitResult,
  ExternalPluginInspection,
  OfficialPluginReleaseInspection,
  PluginInventoryProjection,
  PluginMarketDetail,
} from './pluginTypes';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

const containersPlugin = {
  inventoryKey: 'catalog:containers',
  pluginID: 'com.redeven.official.containers',
  displayName: 'Containers',
  description: 'Manage Docker and Podman resources.',
  iconFallback: 'generic',
  category: 'infrastructure',
  searchKeywords: ['docker', 'podman'],
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
    minReDevPluginVersion: '3.0.0',
    rolloutState: 'stable',
    defaultSurfaceID: 'containers.dashboard',
    iconFallback: 'generic',
    category: 'infrastructure',
    searchKeywords: ['docker', 'podman'],
    trustedSigningKeyIDs: ['redeven_official_signing_2026_08'],
    distribution: {
      releaseRef: OFFICIAL_CONTAINERS_RELEASE_REF,
      installSource: {
        sourceKind: 'package_url',
        url: OFFICIAL_PLUGIN_CATALOG_SEED[0]!.distribution.installSource.url,
      },
    },
  },
} satisfies PluginInventoryProjection['items'][number];

const databasePlugin = {
  ...containersPlugin,
  inventoryKey: 'catalog:database',
  pluginID: 'com.redeven.official.database',
  displayName: 'Database Tools',
  description: 'Inspect local database connections.',
  iconFallback: 'database',
  category: 'data',
  searchKeywords: ['database'],
  officialCatalog: undefined,
} satisfies PluginInventoryProjection['items'][number];

const projection: PluginInventoryProjection = {
  items: [containersPlugin, databasePlugin],
};

function containersPermissionProjection(granted = false): PluginInventoryProjection {
  return {
    items: [{
      ...containersPlugin,
      pluginInstanceID: 'plugininst_containers',
      version: '2.0.0',
      managementRevision: 7,
      canDisable: true,
      lifecycleState: granted ? 'enabled' : 'needs_attention',
      attentionReason: granted ? undefined : 'permission_required',
      authorization: {
        grants: [],
        permissions: [{
          permissionID: 'containers.read',
          group: 'read',
          requiredToOpen: true,
          methods: ['containers.status'],
          requiredToOpenMethods: ['containers.status'],
          granted,
          deniedByGrant: false,
          blockedByPolicy: false,
          grantBlockedByPolicy: false,
          blockedToOpen: false,
        }],
        revisions: {
          policyRevision: 3,
          managementRevision: 7,
          revokeEpoch: 2,
        },
      },
    }],
  };
}

function findDocumentButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

function openInventoryDetails(mount: HTMLElement, inventoryKey = 'catalog:containers'): HTMLButtonElement {
  const item = mount.querySelector<HTMLButtonElement>(`[data-plugin-center-item="${inventoryKey}"]`);
  if (!item) throw new Error(`Plugin Center item not found: ${inventoryKey}`);
  item.click();
  return item;
}

function externalInspectionForCenter(): ExternalPluginInspection {
  const packageHash = 'sha256:8ecf6c0d206ee557c5528e2192b2594b5d097912b83028d43ff1336532b06d13';
  const manifestHash = 'sha256:f96534ca709165d0e30f6e7713a57ec0754f84f84ccadc2edc000f19dde7cc3d';
  const entriesHash = 'sha256:8a0048517719d934e52406dc6e9964d9ca165728d3e530d2c4df16f619bf17fa';
  return {
    inspection_id: 'inspection_external_center_test',
    expires_at: '2026-07-27T12:00:00Z',
    intent: { action: 'install', plugin_instance_id: 'plugini_external_beta' },
    publisher_id: 'com.example.publisher',
    plugin_id: 'com.example.toolbox',
    version: '1.2.3',
    inspected_hashes: { package_sha256: packageHash, manifest_sha256: manifestHash, entries_sha256: entriesHash },
    signature_assessment: {
      state: 'absent',
      reason_codes: [],
      assessed_hashes: { package_sha256: packageHash, manifest_sha256: manifestHash, entries_sha256: entriesHash },
      assessed_at: '2026-07-27T10:00:00Z',
    },
    source_provenance: {
      kind: 'package_url',
      source_origin: 'https://plugins.example.com',
      source_path: '/toolbox.redevplugin',
      redirect_chain: [],
      package_sha256: packageHash,
      resolved_at: '2026-07-27T10:00:00Z',
    },
    execution_approval: { state: 'pending', reason_codes: [], assessed_at: '2026-07-27T10:00:00Z' },
    update_eligibility: { state: 'manual_only', reason_codes: [], assessed_at: '2026-07-27T10:00:00Z' },
    security_summary: {
      summary_sha256: 'sha256:9b30eca232030072294fcabdc98df492609672c92d2d04a545d5790119d1822b',
      permissions: [],
      methods: [],
      capability_contracts: [],
      workers: [],
      network: [],
      storage: [],
      secret_refs: [],
      core_actions: [],
      intents: [],
      surfaces: [],
    },
  };
}

function externalCommitForCenter(source: ExternalPluginInspection): ExternalPluginCommitResult {
  const packageHash = source.inspected_hashes.package_sha256;
  return {
    plugin: {
      plugin_instance_id: source.intent.plugin_instance_id,
      publisher_id: source.publisher_id,
      plugin_id: source.plugin_id,
      version: source.version,
      active_fingerprint: packageHash,
      package_hash: packageHash,
      manifest_hash: source.inspected_hashes.manifest_sha256,
      entries_hash: source.inspected_hashes.entries_sha256,
      trust_state: 'unsigned_local',
      trust_assessment: { trust_state: 'unsigned_local', verified_hashes: source.inspected_hashes },
      signature_assessment: source.signature_assessment,
      source_provenance: source.source_provenance,
      execution_approval: { ...source.execution_approval, state: 'user_approved' },
      update_eligibility: source.update_eligibility,
      security_summary: source.security_summary,
      enable_state: 'enabled',
      policy_revision: 1,
      management_revision: 1,
      revoke_epoch: 0,
      manifest: {
        schema_version: 'redevplugin.manifest.v9',
        publisher: { publisher_id: source.publisher_id, display_name: 'Example Publisher' },
        plugin: {
          plugin_id: source.plugin_id,
          display_name: 'Toolbox Beta',
          version: source.version,
        },
        api: { major: 1 },
        permissions: [],
        presentation: { locales: { default: 'en-US' } },
        surfaces: [],
        workers: [],
        methods: [],
      },
      package_entries: [],
      installed_at: '2026-07-27T10:01:00Z',
      updated_at: '2026-07-27T10:01:00Z',
    },
    signature_assessment: source.signature_assessment,
    source_provenance: source.source_provenance,
    execution_approval: { ...source.execution_approval, state: 'user_approved' },
    update_eligibility: source.update_eligibility,
    security_summary: source.security_summary,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function officialInspection(
  item: PluginInventoryProjection['items'][number] = containersPlugin,
  permissions: readonly Readonly<{
    permission_id: string;
    methods: readonly string[];
    required: boolean;
    effects: readonly ('read' | 'write' | 'delete' | 'execute' | 'admin')[];
  }>[] = [],
): OfficialPluginReleaseInspection {
  return {
    plugin_instance_id: item.officialCatalog!.pluginInstanceID,
    release_ref: item.officialCatalog!.distribution.releaseRef,
    inspected_hashes: item.officialCatalog!.distribution.releaseRef.expected_hashes,
    presentation: {
      default_locale: 'en-US',
      locales: [{
        locale: 'en-US', plugin_name: item.displayName, summary: item.description,
        description: [], highlights: [], keywords: [], surfaces: [], settings: [],
      }],
    },
    presentation_sha256: 'sha256:' + 'a'.repeat(64),
    security_summary: {
      summary_sha256: 'sha256:' + 'b'.repeat(64),
      permissions: permissions.map((permission) => ({
        ...permission,
        methods: [...permission.methods],
        effects: [...permission.effects],
      })),
      methods: [], capability_contracts: [], workers: [], network: [], storage: [], secret_refs: [], core_actions: [], intents: [], surfaces: [],
    },
  } as unknown as OfficialPluginReleaseInspection;
}

describe('PluginCenterView', () => {
  it('presents Discover plugins with a compact identity and independent install and detail actions', async () => {
    const onCommand = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [containersPlugin] }}
        loading={false}
        onInspectOfficial={vi.fn(async () => ({
          plugin_instance_id: containersPlugin.officialCatalog.pluginInstanceID,
          release_ref: OFFICIAL_CONTAINERS_RELEASE_REF,
          inspected_hashes: OFFICIAL_CONTAINERS_RELEASE_REF.expected_hashes,
          presentation: {
            default_locale: 'en-US',
            locales: [{
              locale: 'en-US', plugin_name: 'Containers', summary: 'Manage containers.',
              description: [], highlights: [], keywords: [], surfaces: [], settings: [],
            }],
          },
          presentation_sha256: 'sha256:' + 'a'.repeat(64),
          security_summary: {
            summary_sha256: 'sha256:' + 'b'.repeat(64),
            permissions: [], methods: [], capability_contracts: [], workers: [], network: [], storage: [], secret_refs: [], core_actions: [], intents: [], surfaces: [],
          },
        }))}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    const details = mount.querySelector('[data-plugin-center-item="catalog:containers"]') as HTMLButtonElement;
    const install = mount.querySelector('[data-plugin-center-install="catalog:containers"]') as HTMLButtonElement;
    expect(details).not.toBeNull();
    expect(install.textContent).toContain('Install');
    expect(install.closest('article')?.querySelector('.h-12.w-12')).not.toBeNull();
    install.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-plugin-install-review-dialog]')).not.toBeNull();
    expect(onCommand).not.toHaveBeenCalled();
    (document.querySelector('[data-plugin-install-review-confirm]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onCommand).toHaveBeenCalledWith({
      type: 'install', pluginID: 'com.redeven.official.containers', source: 'official_catalog',
    }, expect.any(AbortSignal));
    expect(document.querySelector('[data-external-plugin-dialog]')).toBeNull();
  });

  it('shows the installed Host version instead of the newer market version', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const installed = {
      ...containersPlugin,
      pluginInstanceID: 'plugininst_containers',
      version: '1.9.0',
      managementRevision: 23,
      lifecycleState: 'disabled' as const,
    };
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [installed] }}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const card = mount.querySelector('[data-plugin-directory-card="catalog:containers"]');
    expect(card?.textContent).toContain('v1.9.0');
    expect(card?.textContent).not.toContain('v2.0.0');
  });

  it('opens a real card action menu instead of treating the ellipsis as a detail button', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const installed = {
      ...containersPlugin,
      pluginInstanceID: 'plugininst_containers',
      version: '2.0.0',
      managementRevision: 23,
      lifecycleState: 'enabled' as const,
      defaultLaunchTarget: {
        pluginID: containersPlugin.pluginID,
        pluginInstanceID: 'plugininst_containers',
        surfaceID: 'containers.dashboard',
        expectedManagementRevision: 23,
        preferredPlacement: 'activity' as const,
      },
    };
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [installed] }}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    (mount.querySelector('[data-plugin-center-card-menu="catalog:containers"]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(findDocumentButton('Open')).not.toBeNull();
    expect(findDocumentButton('Open in Workbench')).not.toBeNull();
    findDocumentButton('View plugin details').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Containers');
  });

  it('keeps disabled card actions aligned with the lifecycle state', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const disabled = {
      ...containersPlugin,
      pluginInstanceID: 'plugininst_containers',
      version: '2.0.0',
      managementRevision: 23,
      lifecycleState: 'disabled' as const,
      defaultLaunchTarget: {
        pluginID: containersPlugin.pluginID,
        pluginInstanceID: 'plugininst_containers',
        surfaceID: 'containers.dashboard',
        expectedManagementRevision: 23,
        preferredPlacement: 'activity' as const,
      },
    };
    const onCommand = vi.fn();
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [disabled] }}
        loading={false}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const card = mount.querySelector('[data-plugin-center-card-menu="catalog:containers"]') as HTMLButtonElement;
    card.click();
    await Promise.resolve();
    expect([...document.querySelectorAll('[role="menu"]')].some((menu) => menu.textContent?.includes('Open in Activity'))).toBe(false);
    expect([...document.querySelectorAll('[role="menu"]')].some((menu) => menu.textContent?.includes('Open in Workbench'))).toBe(false);
    expect(findDocumentButton('Enable')).not.toBeNull();
    expect(findDocumentButton('View plugin details')).not.toBeNull();
  });

  it('routes blocked primary actions to details instead of opening a surface', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const blocked = {
      ...containersPlugin,
      pluginInstanceID: 'plugininst_containers',
      version: '2.0.0',
      managementRevision: 23,
      lifecycleState: 'needs_attention' as const,
      trustBadge: 'blocked' as const,
      attentionReason: 'trust_unavailable' as const,
      defaultLaunchTarget: {
        pluginID: containersPlugin.pluginID,
        pluginInstanceID: 'plugininst_containers',
        surfaceID: 'containers.dashboard',
        expectedManagementRevision: 23,
        preferredPlacement: 'activity' as const,
      },
    };
    const onCommand = vi.fn();
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [blocked] }}
        loading={false}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const primary = mount.querySelector<HTMLButtonElement>('[data-plugin-center-card-primary="catalog:containers"]');
    expect(primary?.textContent).toContain('View trust details');
    primary?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onCommand).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'open_surface' }), expect.anything());
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Containers');
  });

  it('does not use market presentation when an installed record has no host presentation', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [{
          ...containersPlugin,
          displayName: 'Installed Name',
          description: 'Installed summary',
          publisher: 'Installed Publisher',
          pluginInstanceID: 'plugininst_containers',
          version: '2.0.0',
          lifecycleState: 'disabled',
        }] }}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    (mount.querySelector('[data-plugin-center-item="catalog:containers"]') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const details = mount.querySelector('[data-plugin-center-details]')!;
    expect(details.querySelector('[data-plugin-center-detail-heading]')?.textContent).toContain('Installed Name');
    expect(details.textContent).toContain('Installed summary');
    expect(details.textContent).not.toContain('Manage Docker and Podman resources.');
  });

  it('loads complete market author content only after an uninstalled plugin is selected', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const onLoadMarketDetail = vi.fn(async () => OFFICIAL_PLUGIN_MARKET_DETAIL);
    const marketItem = {
      ...containersPlugin,
      officialCatalog: OFFICIAL_PLUGIN_CATALOG_SEED[0],
    } satisfies PluginInventoryProjection['items'][number];
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [marketItem] }}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        onLoadMarketDetail={onLoadMarketDetail}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    expect(onLoadMarketDetail).not.toHaveBeenCalled();
    expect(mount.querySelector('[data-plugin-author-description]')).toBeNull();
    openInventoryDetails(mount);

    await vi.waitFor(() => expect(onLoadMarketDetail).toHaveBeenCalledWith(
      'com.redeven.official.containers',
      OFFICIAL_PLUGIN_CATALOG_SEED[0]!.marketGeneration,
      expect.any(AbortSignal),
    ));
    await vi.waitFor(() => expect(mount.querySelector('[data-plugin-author-description]')).not.toBeNull());
    const author = mount.querySelector<HTMLElement>('[data-plugin-author-content]')!;
    expect(author.querySelector('[lang="en-US"]')).not.toBeNull();
    expect(author.textContent).toContain('Manage Docker and Podman containers, images, volumes, logs, and statistics');
    expect(mount.querySelector('[data-plugin-author-highlights]')).not.toBeNull();
  });

  it('reloads selected market detail when the catalog generation changes', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const [currentProjection, setCurrentProjection] = createSignal<PluginInventoryProjection>({
      items: [{
        ...containersPlugin,
        officialCatalog: OFFICIAL_PLUGIN_CATALOG_SEED[0],
      }],
    });
    let generation = OFFICIAL_PLUGIN_CATALOG_SEED[0]!.marketGeneration!;
    const onLoadMarketDetail = vi.fn(async () => ({
      ...OFFICIAL_PLUGIN_MARKET_DETAIL,
      generation,
    }));
    dispose = render(() => (
      <PluginCenterView
        projection={currentProjection()}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        onLoadMarketDetail={onLoadMarketDetail}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    openInventoryDetails(mount);
    await vi.waitFor(() => expect(onLoadMarketDetail).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(mount.querySelector('[data-plugin-author-description]')).not.toBeNull());

    generation += 1;
    setCurrentProjection({
      items: [{
        ...containersPlugin,
        officialCatalog: {
          ...OFFICIAL_PLUGIN_CATALOG_SEED[0]!,
          marketGeneration: generation,
        },
      }],
    });

    await vi.waitFor(() => expect(onLoadMarketDetail).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(mount.querySelector('[data-plugin-author-description]')).not.toBeNull());
  });

  it('fails closed when market detail has no generation evidence', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const onLoadMarketDetail = vi.fn(async (): Promise<PluginMarketDetail> => ({
      plugin_id: 'com.redeven.official.containers',
      publisher_id: 'com.redeven.official',
      presentation: { default_locale: 'en-US', locales: [] },
      categories: ['infrastructure'],
      channels: ['stable'],
      repository: { provider: 'github', repository_id: 1, owner: 'example', name: 'plugin', url: 'https://github.com/example/plugin' },
      compatibility: { min_redeven_version: '1.0.0', min_redevplugin_version: '3.0.0' },
      status: 'active',
      latest: [],
    }));
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [containersPlugin] }}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        onLoadMarketDetail={onLoadMarketDetail}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    openInventoryDetails(mount);
    await vi.waitFor(() => expect(onLoadMarketDetail).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(mount.textContent).toContain('The plugin catalog is unavailable'));
    expect(mount.querySelector('[data-plugin-author-description]')).toBeNull();
    expect(mount.textContent).toContain('Manage Docker and Podman resources.');
    expect(mount.querySelector('[data-plugin-center-install="catalog:containers"]')).not.toBeNull();
    expect(findDocumentButton('Retry')).not.toBeNull();
  });

  it('keeps refresh status outside the card grid', () => {
    const [loading, setLoading] = createSignal(false);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [containersPlugin] }}
        loading={loading()}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    const grid = mount.querySelector('[data-plugin-center-list]')!;
    expect(grid.children).toHaveLength(1);
    setLoading(true);
    expect(grid.children).toHaveLength(1);
    expect(grid.getAttribute('aria-busy')).toBe('true');
    expect(mount.querySelector('[data-plugin-center-loading]')?.parentElement).not.toBe(grid);
  });

  it('offers an update action directly in the Updates list', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const updateItem = {
      ...containersPlugin,
      pluginInstanceID: 'plugininst_containers',
      version: '1.9.0',
      managementRevision: 13,
      lifecycleState: 'update_available' as const,
    };
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [updateItem] }}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    (mount.querySelector('#plugin-center-tab-updates') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(mount.querySelector('[data-plugin-center-update="catalog:containers"]')).not.toBeNull());
    const update = mount.querySelector('[data-plugin-center-update="catalog:containers"]') as HTMLButtonElement;
    expect(update.textContent).toContain('Review update');
    expect(update.closest('article')?.className).toContain('border-t-2');
    expect(mount.querySelector('[data-plugin-center-list]')?.className).toContain('grid');
  });

  it('keeps the detail primary action and overflow menu in one action row', () => {
    const updateItem = {
      ...containersPlugin,
      pluginInstanceID: 'plugininst_containers',
      version: '1.9.0',
      managementRevision: 13,
      lifecycleState: 'update_available' as const,
      canDisable: true,
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [updateItem] }}
        loading={false}
        selectedInventoryKey="catalog:containers"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    const row = mount.querySelector('[data-plugin-action-row]');
    const primary = mount.querySelector('[data-plugin-action="update-external"]');
    const overflow = mount.querySelector('[data-plugin-action="more"]');
    expect(row).not.toBeNull();
    expect(primary?.parentElement).toBe(row);
    expect(overflow?.closest('[data-plugin-action-row]')).toBe(row);
    expect(row?.className).toContain('items-center');
    expect(row?.className).not.toContain('flex-col');
  });

  it('offers both open destinations from the detail overflow for a runnable update', () => {
    const target = { pluginID: 'com.redeven.official.containers', pluginInstanceID: 'plugininst_containers', surfaceID: 'containers.dashboard', expectedManagementRevision: 13, preferredPlacement: 'activity' as const };
    const updateItem = {
      ...containersPlugin,
      pluginInstanceID: 'plugininst_containers',
      version: '1.9.0',
      managementRevision: 13,
      lifecycleState: 'update_available' as const,
      canDisable: true,
      defaultLaunchTarget: target,
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [updateItem] }}
        loading={false}
        selectedInventoryKey="catalog:containers"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    (mount.querySelector('[data-plugin-action="more"]') as HTMLButtonElement).click();
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.textContent).toContain('Open');
    expect(menu.textContent).toContain('Open in Workbench');
  });

  it('keeps identity and primary actions outside the independently scrolling detail body', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [containersPlugin] }}
        loading={false}
        selectedInventoryKey="catalog:containers"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    const details = mount.querySelector<HTMLElement>('[data-plugin-center-details]')!;
    const controls = details.querySelector<HTMLElement>('[data-plugin-detail-controls]')!;
    const body = details.querySelector<HTMLElement>('[data-plugin-detail-scroll-body]')!;
    const actions = details.querySelector<HTMLElement>('[data-plugin-action-row]')!;
    const author = details.querySelector<HTMLElement>('[data-plugin-author-content]')!;

    expect(details.className).toContain('overflow-hidden');
    expect(details.className).not.toContain('overflow-y-auto');
    expect(controls.className).toContain('shrink-0');
    expect(body.className).toContain('min-h-0');
    expect(body.className).toContain('flex-1');
    expect(body.className).toContain('overflow-y-auto');
    expect(controls.contains(actions)).toBe(true);
    expect(body.contains(actions)).toBe(false);
    expect(body.contains(author)).toBe(true);
  });

  it('groups required and optional permissions without changing switch semantics', () => {
    const permissionProjection = containersPermissionProjection();
    permissionProjection.items[0].authorization!.permissions = [
      ...permissionProjection.items[0].authorization!.permissions,
      {
        ...permissionProjection.items[0].authorization!.permissions[0],
        permissionID: 'containers.delete',
        group: 'delete',
        requiredToOpen: false,
        methods: ['containers.delete'],
        requiredToOpenMethods: [],
      },
    ];
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={permissionProjection}
        loading={false}
        selectedInventoryKey="catalog:containers"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    expect(mount.querySelector('[data-plugin-permission-group="required"] [data-plugin-permission="containers.read"]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-permission-group="optional"] [data-plugin-permission="containers.delete"]')).not.toBeNull();
    expect(mount.querySelectorAll('[data-plugin-permission] [role="switch"]')).toHaveLength(2);
  });

  it('exposes the active Plugin Center view with tab semantics', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [containersPlugin] }}
        loading={false}
        canManagePlugins
        canOpenPluginSurfaces
        onRefresh={() => undefined}
        onCommand={() => undefined}
      />
    ), mount);

    const discover = mount.querySelector('[role="tab"][aria-selected="true"]');
    const panel = mount.querySelector('[role="tabpanel"]');
    expect(discover?.id).toBe('plugin-center-tab-discover');
    expect(panel?.getAttribute('aria-labelledby')).toBe(discover?.id);
    expect(discover?.getAttribute('aria-controls')).toBe(panel?.id);

    (discover as HTMLButtonElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(mount.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('plugin-center-tab-installed');
  });

  it('adopts the first installed projection after mounting with an empty inventory', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const [currentProjection, setCurrentProjection] = createSignal<PluginInventoryProjection>({ items: [] });
    dispose = render(() => (
      <PluginCenterView
        projection={currentProjection()}
        loading={false}
        canManagePlugins
        canOpenPluginSurfaces
        onRefresh={() => undefined}
        onCommand={() => undefined}
      />
    ), mount);

    const installed = containersPermissionProjection().items[0]!;
    setCurrentProjection({
      items: [{
        ...installed,
        inventoryKey: `instance:${installed.pluginInstanceID}`,
        officialCatalog: undefined,
      }],
    });

    expect(mount.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('plugin-center-tab-installed');
    expect(mount.querySelector('[data-plugin-center-item^="instance:"]')).not.toBeNull();
  });

  it('renders a dedicated management shell outside Settings with local search', () => {
    const mount = document.createElement('div');
    const onClose = vi.fn();
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        error={null}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        onClose={onClose}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    expect(mount.querySelector('[data-plugin-center-view]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-shell]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-list]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-details]')).toBeNull();
    expect(mount.querySelector('[data-settings-nav-item="plugins"]')).toBeNull();
    expect(mount.textContent).toContain('Installed');
    expect(mount.textContent).toContain('Discover');
    expect(mount.textContent).toContain('Updates');
    expect(mount.textContent).toContain('Containers');
    expect(mount.textContent).not.toMatch(/Developer|Install from URL|Install from file|unsigned|marketplace/i);
    (mount.querySelector('[data-plugin-center-close]') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledOnce();

    const search = mount.querySelector('[data-plugin-center-search]') as HTMLInputElement;
    search.value = 'database';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));

    expect(mount.querySelector('[data-plugin-center-item="catalog:database"]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-item="catalog:containers"]')).toBeNull();

    search.value = '';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (mount.querySelector('[data-plugin-center-category="infrastructure"]') as HTMLButtonElement).click();
    expect(mount.querySelector('[data-plugin-center-item="catalog:containers"]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-item="catalog:database"]')).toBeNull();
  });

  it('keeps header controls within narrow viewports by wrapping search onto its own row', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    const search = mount.querySelector('[data-plugin-center-search]') as HTMLInputElement;
    const searchField = search.parentElement as HTMLElement;
    const actions = searchField.parentElement as HTMLElement;
    // Toolbar wraps on narrow viewports: actions container has flex-wrap and w-full
    expect(actions.classList).toContain('flex-wrap');
    expect(actions.classList).toContain('w-full');
    // Search occupies a controlled second row on narrow screens.
    expect(searchField.classList).toContain('order-last');
    expect(searchField.classList).toContain('w-full');
    expect(searchField.classList).toContain('min-w-0');
  });

  it('keeps installed plugins usable while the market is unavailable', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const onRefresh = vi.fn();

    dispose = render(() => (
      <PluginCenterView
        projection={{ ...projection, marketUnavailable: true }}
        loading={false}
        error={null}
        onCommand={vi.fn()}
        onRefresh={onRefresh}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    const alert = mount.querySelector('[data-plugin-center-error]');
    expect(alert?.textContent).toContain('The plugin catalog is unavailable');
    expect(mount.querySelector('[data-plugin-center-item="catalog:containers"]')).not.toBeNull();
    (alert?.querySelector('button') as HTMLButtonElement).click();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('keeps external installation in the administrative overflow menu', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    expect(mount.textContent).not.toContain('Install from source');
    (mount.querySelector('[data-plugin-center-install-external]') as HTMLButtonElement).click();
    await Promise.resolve();
    findDocumentButton('Install from source').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-external-plugin-dialog]')).not.toBeNull();
  });

  it('combines source, trust, lifecycle, and category filters without rebuilding identity', async () => {
    const externalCommunity = {
      ...databasePlugin,
      inventoryKey: 'instance:community-database',
      pluginInstanceID: 'community-database',
      managementRevision: 2,
      lifecycleState: 'disabled',
      trustBadge: 'community',
    } satisfies PluginInventoryProjection['items'][number];
    const externalUnsigned = {
      ...containersPlugin,
      inventoryKey: 'instance:unsigned-containers',
      pluginInstanceID: 'unsigned-containers',
      managementRevision: 4,
      lifecycleState: 'needs_attention',
      trustBadge: 'unsigned',
      officialCatalog: undefined,
    } satisfies PluginInventoryProjection['items'][number];
    const officialInstalled = {
      ...containersPlugin,
      inventoryKey: 'instance:official-containers',
      pluginInstanceID: 'official-containers',
      managementRevision: 7,
      lifecycleState: 'enabled',
    } satisfies PluginInventoryProjection['items'][number];
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [officialInstalled, externalCommunity, externalUnsigned] }}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    (mount.querySelector('[data-plugin-center-category="infrastructure"]') as HTMLButtonElement).click();
    for (const [filter, label] of [
      ['source', 'External'],
      ['trust', 'Unsigned'],
      ['lifecycle', 'Needs attention'],
    ] as const) {
      (mount.querySelector(`[data-plugin-center-filter="${filter}"]`) as HTMLButtonElement).click();
      await Promise.resolve();
      findDocumentButton(label).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(mount.querySelector('[data-plugin-center-item="instance:unsigned-containers"]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-item="instance:official-containers"]')).toBeNull();
    expect(mount.querySelector('[data-plugin-center-item="instance:community-database"]')).toBeNull();
  });

  it('keeps filter dimensions, current values, chevrons, and clear action visible', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    const source = mount.querySelector<HTMLElement>('[data-plugin-center-filter="source"]')!;
    const trust = mount.querySelector<HTMLElement>('[data-plugin-center-filter="trust"]')!;
    const lifecycle = mount.querySelector<HTMLElement>('[data-plugin-center-filter="lifecycle"]')!;
    expect(source.textContent).toContain('Plugin source: All');
    expect(trust.textContent).toContain('Trust: All');
    expect(lifecycle.textContent).toContain('Lifecycle: All');
    for (const trigger of [source, trust, lifecycle]) {
      const owner = trigger.closest<HTMLElement>('[data-floe-dropdown-trigger]')!;
      expect(owner.getAttribute('aria-haspopup')).toBe('menu');
      expect(owner.tabIndex).toBe(0);
      expect(trigger.tabIndex).toBe(-1);
      expect(trigger.matches('button, [role="button"]')).toBe(false);
      expect(trigger.querySelector('svg')).not.toBeNull();
    }

    source.click();
    await Promise.resolve();
    findDocumentButton('Official').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(source.textContent).toContain('Plugin source: Official');
    const clear = mount.querySelector<HTMLElement>('[data-plugin-center-clear-filters]')!;
    expect(clear).not.toBeNull();
    expect(clear.closest('[data-plugin-center-filter-scroll]')).toBeNull();

    (mount.querySelector('[data-plugin-center-clear-filters]') as HTMLButtonElement).click();
    expect(source.textContent).toContain('Plugin source: All');
    expect(mount.querySelector('[data-plugin-center-clear-filters]')).toBeNull();
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
        selectedInventoryKey="catalog:containers"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Containers');
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Disabled');
  });

  it('consumes an exact shell selection once so inventory refresh does not reopen closed details', async () => {
    const [currentProjection, setCurrentProjection] = createSignal(containersPermissionProjection());
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={currentProjection()}
        loading={false}
        selectedInventoryKey="catalog:containers"
        focusRequest={1}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    await Promise.resolve();
    expect(mount.querySelector('[data-plugin-center-details]')).not.toBeNull();
    (mount.querySelector('[data-plugin-center-mobile-back]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(mount.querySelector('[data-plugin-center-details]')).toBeNull();

    setCurrentProjection({ items: currentProjection().items.map((item) => ({ ...item })) });
    await Promise.resolve();
    await Promise.resolve();
    expect(mount.querySelector('[data-plugin-center-details]')).toBeNull();
  });

  it('moves desktop focus into the requested plugin details inspector', async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={containersPermissionProjection()}
        loading={false}
        selectedInventoryKey="catalog:containers"
        focusRequest={1}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    await Promise.resolve();
    await Promise.resolve();
    const heading = mount.querySelector<HTMLHeadingElement>('[data-plugin-center-detail-heading]')!;
    expect(document.activeElement).toBe(heading);
    expect(heading.textContent).toBe('Containers');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  });

  it('reopens mobile details for every explicit shell focus request while kept alive', async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    const [focusRequest, setFocusRequest] = createSignal(1);
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={containersPermissionProjection()}
        loading={false}
        selectedInventoryKey="catalog:containers"
        focusRequest={focusRequest()}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    await Promise.resolve();
    const back = mount.querySelector<HTMLButtonElement>('[data-plugin-center-mobile-back]')!;
    expect(document.activeElement).toBe(back);
    back.click();
    await Promise.resolve();
    expect(getComputedStyle(mount.querySelector<HTMLElement>('[data-plugin-center-master]')!).display).not.toBe('none');

    setFocusRequest(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(getComputedStyle(mount.querySelector<HTMLElement>('[data-plugin-center-details]')!).display).not.toBe('none');
    expect(document.activeElement).toBe(mount.querySelector<HTMLButtonElement>('[data-plugin-center-mobile-back]'));

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  });

  it('returns mobile details to the list for search and tab changes without losing the initiating focus', async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={containersPermissionProjection(true)}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const item = mount.querySelector<HTMLButtonElement>('[data-plugin-center-item="catalog:containers"]')!;
    item.click();
    await Promise.resolve();
    await Promise.resolve();
    const master = mount.querySelector<HTMLElement>('[data-plugin-center-master]')!;
    const details = mount.querySelector<HTMLElement>('[data-plugin-center-details]')!;
    expect(master.classList).toContain('hidden');
    expect(details.classList).toContain('block');

    const search = mount.querySelector<HTMLInputElement>('[data-plugin-center-search]')!;
    search.focus();
    search.value = 'containers';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(master.classList).toContain('flex');
    expect(mount.querySelector('[data-plugin-center-details]')).toBeNull();
    expect(document.activeElement).toBe(search);

    item.click();
    await Promise.resolve();
    await Promise.resolve();
    const discover = mount.querySelector<HTMLButtonElement>('#plugin-center-tab-discover')!;
    discover.focus();
    discover.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(master.classList).toContain('flex');
    expect(mount.querySelector('[data-plugin-center-details]')).toBeNull();
    expect(document.activeElement).toBe(discover);
    expect(discover.getAttribute('aria-selected')).toBe('true');

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  });

  it.each([
    {
      action: 'trust',
      label: 'View trust details',
      attentionReason: 'trust_unavailable',
      trustBadge: 'unavailable',
      recovery: 'Review the trust and approval reason codes and source below.',
      evidence: ['attention_reason=trust_unavailable', 'trust=unavailable', 'rollout_state=stable'],
    },
    {
      action: 'runtime',
      label: 'View runtime requirement',
      attentionReason: 'runtime_missing',
      trustBadge: 'official',
      recovery: 'Update Redeven or ReDevPlugin to the required version',
      evidence: ['attention_reason=runtime_missing', 'trust=official', 'rollout_state=stable'],
    },
    {
      action: 'diagnostics',
      label: 'View issue',
      attentionReason: 'diagnostic_error',
      trustBadge: 'official',
      recovery: 'Resolve the reported host or package issue shown below',
      evidence: ['attention_reason=diagnostic_error', 'trust=official', 'rollout_state=stable'],
    },
  ] as const)(
    'focuses the real $action evidence and recovery from its primary action',
    ({ action, label, attentionReason, trustBadge, recovery, evidence }) => {
      const mount = document.createElement('div');
      document.body.append(mount);
      const issueProjection: PluginInventoryProjection = {
        items: [{
          ...containersPlugin,
          pluginInstanceID: 'plugininst_containers',
          version: '2.0.0',
          managementRevision: 7,
          lifecycleState: 'needs_attention',
          attentionReason,
          trustBadge,
        }],
      };
      dispose = render(() => (
        <PluginCenterView
          projection={issueProjection}
          loading={false}
          selectedInventoryKey="catalog:containers"
          onCommand={vi.fn()}
          onRefresh={vi.fn()}
          canManagePlugins
          canOpenPluginSurfaces
        />
      ), mount);

      const issue = mount.querySelector<HTMLElement>('[data-plugin-issue-details]')!;
      const technicalDetails = issue.querySelector<HTMLDetailsElement>('[data-plugin-issue-evidence]')!;
      const technicalSummary = technicalDetails.querySelector<HTMLElement>('summary')!;
      const scrollIntoView = vi.fn();
      Object.defineProperty(technicalSummary, 'scrollIntoView', { configurable: true, value: scrollIntoView });
      const primary = mount.querySelector<HTMLButtonElement>(`[data-plugin-action="${action}"]`)!;
      expect(primary.textContent).toContain(label);
      primary.click();

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
      expect(document.activeElement).toBe(technicalSummary);
      expect(technicalDetails.open).toBe(false);
      expect(issue.textContent).toContain(recovery);
      const issueEvidence = issue.querySelector('[data-plugin-issue-evidence]')?.textContent ?? '';
      for (const fact of evidence) expect(issueEvidence).toContain(fact);
      expect(issue.textContent).toContain('0.9.0');
      expect(issue.textContent).toContain('3.0.0');
    },
  );

  it('describes and focuses technical details for an enabled plugin without a launch surface', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const backgroundProjection: PluginInventoryProjection = {
      items: [{
        ...containersPlugin,
        pluginInstanceID: 'plugininst_background',
        managementRevision: 9,
        lifecycleState: 'enabled',
        defaultLaunchTarget: undefined,
      }],
    };
    dispose = render(() => (
      <PluginCenterView
        projection={backgroundProjection}
        loading={false}
        selectedInventoryKey="catalog:containers"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const details = mount.querySelector<HTMLDetailsElement>('[data-plugin-technical-details]')!;
    const summary = details.querySelector<HTMLElement>('summary')!;
    const scrollIntoView = vi.fn();
    Object.defineProperty(details, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    const primary = mount.querySelector<HTMLButtonElement>('[data-plugin-action="details"]')!;
    expect(primary.textContent).toContain('Technical details');
    expect(primary.textContent).not.toContain('View issue');

    primary.click();

    expect(details.open).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
    expect(document.activeElement).toBe(summary);
  });

  it('opens an immediate loading dialog and then shows the complete authoritative review', async () => {
    const onCommand = vi.fn();
    const inspection = deferred<OfficialPluginReleaseInspection>();
    const onInspectOfficial = vi.fn(() => inspection.promise);
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        error={null}
        onCommand={onCommand}
        onInspectOfficial={onInspectOfficial}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const install = mount.querySelector('[data-plugin-center-install="catalog:containers"]') as HTMLButtonElement;
    expect(install.disabled).toBe(false);
    expect(install.textContent).toContain('Install');
    expect(containersPlugin.officialCatalog.distribution.releaseRef).toBe(OFFICIAL_CONTAINERS_RELEASE_REF);
    install.click();

    expect(install.disabled).toBe(true);
    expect(install.getAttribute('aria-busy')).toBe('true');
    expect(install.textContent).toContain('Checking package');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const loadingReview = document.querySelector<HTMLElement>('[data-plugin-install-review-dialog]')!;
    expect(loadingReview).not.toBeNull();
    expect(loadingReview.getAttribute('data-plugin-install-loading')).toBe('true');
    expect(loadingReview.textContent).toContain('Getting plugin information');
    expect(document.querySelector('[data-plugin-install-review-confirm]')).toBeNull();
    install.click();
    expect(onInspectOfficial).toHaveBeenCalledTimes(1);

    inspection.resolve(officialInspection(containersPlugin, [
      { permission_id: 'containers.read', methods: ['containers.list', 'containers.inspect'], required: true, effects: ['read'] },
      { permission_id: 'containers.read', methods: ['containers.list'], required: true, effects: ['read'] },
      { permission_id: 'containers.delete', methods: ['containers.remove'], required: false, effects: ['delete'] },
    ]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onInspectOfficial).toHaveBeenCalledWith(containersPlugin, expect.any(AbortSignal));
    const review = document.querySelector<HTMLElement>('[data-plugin-install-review-dialog]')!;
    expect(review).not.toBeNull();
    expect(review.getAttribute('data-plugin-install-loading')).toBeNull();
    expect(review.textContent).not.toContain('Inspecting');
    const readPermission = review.querySelector<HTMLElement>('[data-plugin-install-permission="containers.read"]')!;
    const deletePermission = review.querySelector<HTMLElement>('[data-plugin-install-permission="containers.delete"]')!;
    expect(readPermission.textContent).toContain('Containers read');
    expect(readPermission.textContent).toContain('containers.read');
    expect(readPermission.textContent).toContain('Read');
    expect(readPermission.textContent).toContain('Required to open');
    expect(deletePermission.textContent).toContain('Containers delete');
    expect(deletePermission.textContent).toContain('containers.delete');
    expect(deletePermission.textContent).toContain('Delete');
    expect(deletePermission.textContent).toContain('Optional');
    expect(onCommand).not.toHaveBeenCalled();
    (document.querySelector('[data-plugin-install-review-confirm]') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onCommand).toHaveBeenCalledWith({
      type: 'install',
      pluginID: 'com.redeven.official.containers',
      source: 'official_catalog',
    }, expect.any(AbortSignal));
    expect(document.querySelector('[data-external-plugin-dialog]')).toBeNull();
  });

  it('prefetches only the selected official detail and reuses its exact inspection for review', async () => {
    const inspection = deferred<OfficialPluginReleaseInspection>();
    let prefetchSignal: AbortSignal | undefined;
    const onInspectOfficial = vi.fn((_item: PluginInventoryProjection['items'][number], signal: AbortSignal) => {
      prefetchSignal = signal;
      return inspection.promise;
    });
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        onCommand={vi.fn()}
        onInspectOfficial={onInspectOfficial}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    openInventoryDetails(mount);
    await Promise.resolve();
    expect(onInspectOfficial).toHaveBeenCalledTimes(1);
    mount.querySelector<HTMLButtonElement>('[data-plugin-center-drawer-close]')!.click();
    expect(prefetchSignal?.aborted).toBe(false);
    openInventoryDetails(mount);
    expect(onInspectOfficial).toHaveBeenCalledTimes(1);
    const install = mount.querySelector('[data-plugin-action="install"]') as HTMLButtonElement;
    expect(install.disabled).toBe(false);
    install.click();
    expect(install.disabled).toBe(true);
    expect(install.textContent).toContain('Checking package');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector<HTMLElement>('[data-plugin-install-review-dialog]')?.getAttribute('data-plugin-install-loading')).toBe('true');
    expect(onInspectOfficial).toHaveBeenCalledTimes(1);

    inspection.resolve(officialInspection(containersPlugin, [
      { permission_id: 'containers.read', methods: ['containers.list'], required: true, effects: ['read'] },
    ]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-plugin-install-review-dialog]')).not.toBeNull();
  });

  it('invalidates an in-flight prefetch when the exact official release identity changes', async () => {
    const first = deferred<OfficialPluginReleaseInspection>();
    const second = deferred<OfficialPluginReleaseInspection>();
    const signals: AbortSignal[] = [];
    const onInspectOfficial = vi.fn((_item: PluginInventoryProjection['items'][number], signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? first.promise : second.promise;
    });
    const nextRelease = {
      ...containersPlugin,
      officialCatalog: {
        ...containersPlugin.officialCatalog,
        marketGeneration: 42,
        distribution: {
          ...containersPlugin.officialCatalog.distribution,
          releaseRef: {
            ...containersPlugin.officialCatalog.distribution.releaseRef,
            release_metadata_sha256: 'c'.repeat(64),
          },
        },
      },
    } satisfies PluginInventoryProjection['items'][number];
    const [currentProjection, setCurrentProjection] = createSignal<PluginInventoryProjection>({ items: [containersPlugin] });
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={currentProjection()}
        loading={false}
        selectedInventoryKey="catalog:containers"
        onCommand={vi.fn()}
        onInspectOfficial={onInspectOfficial}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    await Promise.resolve();
    expect(onInspectOfficial).toHaveBeenCalledTimes(1);
    setCurrentProjection({ items: [nextRelease] });
    await Promise.resolve();
    expect(signals[0]?.aborted).toBe(true);
    expect(onInspectOfficial).toHaveBeenCalledTimes(2);
    first.resolve(officialInspection(containersPlugin));
    await Promise.resolve();
    expect(document.querySelector('[data-plugin-install-review-dialog]')).toBeNull();

    mount.querySelector<HTMLButtonElement>('[data-plugin-action="install"]')!.click();
    second.resolve(officialInspection(nextRelease));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-plugin-install-review-dialog]')).not.toBeNull();
  });

  it('aborts task-owned inspection work when Plugin Center is disposed', async () => {
    const inspection = deferred<OfficialPluginReleaseInspection>();
    let signal: AbortSignal | undefined;
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [containersPlugin] }}
        loading={false}
        selectedInventoryKey="catalog:containers"
        onCommand={vi.fn()}
        onInspectOfficial={vi.fn((_item, requestSignal) => {
          signal = requestSignal;
          return inspection.promise;
        })}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    await Promise.resolve();
    expect(signal?.aborted).toBe(false);
    dispose();
    dispose = undefined;
    expect(signal?.aborted).toBe(true);
  });

  it('discards stale inspection completion when another official release becomes the review target', async () => {
    const databaseOfficial = {
      ...containersPlugin,
      inventoryKey: 'catalog:database-tools',
      pluginID: 'com.redeven.official.database-tools',
      displayName: 'Database Tools',
      description: 'Inspect local database connections.',
      officialCatalog: {
        ...containersPlugin.officialCatalog,
        pluginID: 'com.redeven.official.database-tools',
        pluginInstanceID: 'plugini_redeven_official_database_tools',
        displayName: 'Database Tools',
        distribution: {
          ...containersPlugin.officialCatalog.distribution,
          releaseRef: {
            ...containersPlugin.officialCatalog.distribution.releaseRef,
            plugin_id: 'com.redeven.official.database-tools',
          },
        },
      },
    } satisfies PluginInventoryProjection['items'][number];
    const first = deferred<OfficialPluginReleaseInspection>();
    const second = deferred<OfficialPluginReleaseInspection>();
    const onInspectOfficial = vi.fn((item: PluginInventoryProjection['items'][number]) => (
      item.pluginID === containersPlugin.pluginID ? first.promise : second.promise
    ));
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [containersPlugin, databaseOfficial] }}
        loading={false}
        onCommand={vi.fn()}
        onInspectOfficial={onInspectOfficial}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    mount.querySelector<HTMLButtonElement>('[data-plugin-center-install="catalog:containers"]')!.click();
    mount.querySelector<HTMLButtonElement>('[data-plugin-center-install="catalog:database-tools"]')!.click();
    first.resolve(officialInspection(containersPlugin));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector<HTMLElement>('[data-plugin-install-review-dialog]')?.getAttribute('data-plugin-install-loading')).toBe('true');

    second.resolve(officialInspection(databaseOfficial));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-plugin-install-review-dialog]')?.textContent).toContain('Database Tools');
    expect(document.querySelector('[data-plugin-install-review-dialog]')?.textContent).not.toContain('Manage Docker');
  });

  it('recovers an official install action after inspection failure and supports an immediate retry', async () => {
    const failed = deferred<OfficialPluginReleaseInspection>();
    const retry = deferred<OfficialPluginReleaseInspection>();
    const onInspectOfficial = vi.fn()
      .mockImplementationOnce(() => failed.promise)
      .mockImplementationOnce(() => retry.promise);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [containersPlugin] }}
        loading={false}
        onCommand={vi.fn()}
        onInspectOfficial={onInspectOfficial}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const install = mount.querySelector<HTMLButtonElement>('[data-plugin-center-install="catalog:containers"]')!;
    install.click();
    failed.reject(new Error('Package verification service is unavailable'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(install.disabled).toBe(false);
    const error = mount.querySelector<HTMLElement>('[data-plugin-install-inspection-error="catalog:containers"]')!;
    expect(error.textContent).toContain('Package verification service is unavailable');
    expect(error.textContent).toContain('Retry');

    error.querySelector<HTMLButtonElement>('button')!.click();
    expect(install.disabled).toBe(true);
    expect(onInspectOfficial).toHaveBeenCalledTimes(2);
    retry.resolve(officialInspection());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-plugin-install-review-dialog]')).not.toBeNull();
  });

  it('keeps a completed exact inspection reusable when review is canceled', async () => {
    const onInspectOfficial = vi.fn(async () => officialInspection());
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [containersPlugin] }}
        loading={false}
        onCommand={vi.fn()}
        onInspectOfficial={onInspectOfficial}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const install = mount.querySelector<HTMLButtonElement>('[data-plugin-center-install="catalog:containers"]')!;
    install.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    findDocumentButton('Cancel').click();
    expect(document.querySelector('[data-plugin-install-review-dialog]')).toBeNull();
    install.click();
    expect(document.querySelector('[data-plugin-install-review-dialog]')).not.toBeNull();
    expect(onInspectOfficial).toHaveBeenCalledTimes(1);
  });

  it('shows authoritative byte progress only on the target plugin while browsing remains available', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        installOperations={[{
          pluginID: containersPlugin.pluginID,
          pluginInstanceID: containersPlugin.officialCatalog.pluginInstanceID,
          observation: 'watching',
          execution: {
            execution_id: 'release_install_containers',
            plugin_instance_id: containersPlugin.officialCatalog.pluginInstanceID,
            kind: 'operation',
            status: 'running',
            cursor: 1,
            cancelable: false,
            created_at: '2026-08-05T08:00:00Z',
            updated_at: '2026-08-05T08:00:01Z',
          },
          events: [{
            execution_id: 'release_install_containers',
            sequence: 1,
            kind: 'progress',
            payload: { phase: 'download_package', progress: { kind: 'bytes', completed: 262_144, total: 524_288 } },
          }],
        }]}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const target = mount.querySelector('[data-plugin-directory-card="catalog:containers"]')!;
    const other = mount.querySelector('[data-plugin-directory-card="catalog:database"]')!;
    const progress = target.querySelector<HTMLElement>('[data-plugin-install-progress]')!;
    expect(target.querySelector('[data-plugin-install-execution]')?.textContent).toContain('Downloading plugin package');
    expect(progress.getAttribute('aria-valuenow')).toBe('262144');
    expect(progress.getAttribute('aria-valuemax')).toBe('524288');
    expect(other.querySelector('[data-plugin-install-execution]')).toBeNull();

    (mount.querySelector('[data-plugin-center-item="catalog:database"]') as HTMLButtonElement).click();
    expect(mount.querySelector('[data-plugin-center-details="catalog:database"]')).not.toBeNull();
    const search = mount.querySelector<HTMLInputElement>('[data-plugin-center-search]')!;
    expect(search.disabled).toBe(false);
  });

  it('localizes a retryable release failure and retries only the failed target', () => {
    const onRetryInstall = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        installOperations={[{
          pluginID: containersPlugin.pluginID,
          pluginInstanceID: containersPlugin.officialCatalog.pluginInstanceID,
          observation: 'watching',
          execution: {
            execution_id: 'release_install_containers',
            plugin_instance_id: containersPlugin.officialCatalog.pluginInstanceID,
            kind: 'operation',
            status: 'failed',
            cursor: 1,
            failure_code: 'PLUGIN_RELEASE_NETWORK',
            cancelable: false,
            created_at: '2026-08-05T08:00:00Z',
            updated_at: '2026-08-05T08:00:03Z',
            terminal_at: '2026-08-05T08:00:03Z',
          },
          events: [],
        }]}
        onRetryInstall={onRetryInstall}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const status = mount.querySelector('[data-plugin-install-execution]')!;
    expect(status.textContent).toContain('The plugin release could not be reached');
    expect(status.textContent).not.toContain('PLUGIN_RELEASE_NETWORK');
    (status.querySelector('[data-plugin-install-retry]') as HTMLButtonElement).click();
    expect(onRetryInstall).toHaveBeenCalledWith(containersPlugin.officialCatalog.pluginInstanceID);
  });

  it('shows an incompatible-data recovery once and requires confirmation before deleting it', async () => {
    const onDiscardRetainedDataAndRetry = vi.fn(async () => undefined);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        selectedInventoryKey={containersPlugin.inventoryKey}
        installOperations={[{
          pluginID: containersPlugin.pluginID,
          pluginInstanceID: containersPlugin.officialCatalog.pluginInstanceID,
          observation: 'watching',
          execution: {
            execution_id: 'release_install_containers',
            plugin_instance_id: containersPlugin.officialCatalog.pluginInstanceID,
            kind: 'operation',
            status: 'failed',
            cursor: 1,
            failure_code: 'PLUGIN_RETAINED_DATA_INCOMPATIBLE',
            cancelable: false,
            created_at: '2026-08-05T08:00:00Z',
            updated_at: '2026-08-05T08:00:03Z',
            terminal_at: '2026-08-05T08:00:03Z',
          },
          events: [],
        }]}
        onDiscardRetainedDataAndRetry={onDiscardRetainedDataAndRetry}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const statuses = document.querySelectorAll('[data-plugin-install-execution]');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toContain('historical data is incompatible');
    (statuses[0]?.querySelector('[data-plugin-install-resolve-retained-data]') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.textContent).toContain('Erase the plugin historical data and install the current version?');
    expect(onDiscardRetainedDataAndRetry).not.toHaveBeenCalled();

    (document.querySelector('[data-plugin-retained-data-confirm]') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onDiscardRetainedDataAndRetry).toHaveBeenCalledWith(containersPlugin.officialCatalog.pluginInstanceID);
  });

  it('keeps a release trust timeout retryable and distinct from permission denial', () => {
    const onRetryInstall = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        installOperations={[{
          pluginID: containersPlugin.pluginID,
          pluginInstanceID: containersPlugin.officialCatalog.pluginInstanceID,
          observation: 'watching',
          execution: {
            execution_id: 'release_install_containers',
            plugin_instance_id: containersPlugin.officialCatalog.pluginInstanceID,
            kind: 'operation',
            status: 'failed',
            cursor: 1,
            failure_code: 'PLUGIN_RELEASE_TIMEOUT',
            cancelable: false,
            created_at: '2026-08-05T08:00:00Z',
            updated_at: '2026-08-05T08:00:30Z',
            terminal_at: '2026-08-05T08:00:30Z',
          },
          events: [],
        }]}
        onRetryInstall={onRetryInstall}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const status = mount.querySelector('[data-plugin-install-execution]')!;
    expect(status.textContent).toContain('did not respond in time');
    expect(status.textContent?.toLowerCase()).not.toContain('permission');
    (status.querySelector('[data-plugin-install-retry]') as HTMLButtonElement).click();
    expect(onRetryInstall).toHaveBeenCalledWith(containersPlugin.officialCatalog.pluginInstanceID);
  });

  it('keeps a committed installation distinct when inventory refresh needs retrying', () => {
    const onRetryInstall = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [containersPlugin] }}
        loading={false}
        installOperations={[{
          pluginID: containersPlugin.pluginID,
          pluginInstanceID: containersPlugin.officialCatalog.pluginInstanceID,
          observation: 'refresh_failed',
          execution: {
            execution_id: 'release_install_containers',
            plugin_instance_id: containersPlugin.officialCatalog.pluginInstanceID,
            kind: 'operation',
            status: 'completed',
            cursor: 1,
            cancelable: false,
            created_at: '2026-08-05T08:00:00Z',
            updated_at: '2026-08-05T08:00:03Z',
            terminal_at: '2026-08-05T08:00:03Z',
          },
          events: [],
        }]}
        onRetryInstall={onRetryInstall}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const status = mount.querySelector('[data-plugin-install-execution]')!;
    expect(status.textContent).toContain('installed, but Plugin Center could not refresh');
    expect(status.textContent).not.toContain('installation failed');
    (status.querySelector('[data-plugin-install-retry]') as HTMLButtonElement).click();
    expect(onRetryInstall).toHaveBeenCalledWith(containersPlugin.officialCatalog.pluginInstanceID);
  });

  it('lets read-only users open surfaces while keeping management actions disabled', async () => {
    const onCommand = vi.fn();
    const installedProjection: PluginInventoryProjection = {
      items: [
        {
          ...containersPlugin,
          pluginInstanceID: 'plugininst_containers',
          version: '2.0.0',
          managementRevision: 7,
          canDisable: true,
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
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins={false}
        canOpenPluginSurfaces
      />
    ), mount);

    openInventoryDetails(mount);
    expect(mount.querySelector('[data-plugin-center-install-external]')).toBeNull();
    const openActivity = mount.querySelector('[data-plugin-action="open"]') as HTMLButtonElement;
    expect(openActivity.disabled).toBe(false);
    expect(mount.querySelector('[data-plugin-action="open-workbench"]')).toBeNull();
    (mount.querySelector('[data-plugin-action="more"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(findDocumentButton('Open in Workbench').disabled).toBe(false);
    expect(findDocumentButton('Disable').disabled).toBe(true);
    expect(findDocumentButton('Uninstall').disabled).toBe(true);
    openActivity.click();
    await vi.waitFor(() => expect(onCommand).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect((mount.querySelector('[data-plugin-action="more"]') as HTMLButtonElement).disabled).toBe(false));
    (mount.querySelector('[data-plugin-action="more"]') as HTMLButtonElement).click();
    await Promise.resolve();
    findDocumentButton('Open in Workbench').click();
    await vi.waitFor(() => expect(onCommand).toHaveBeenCalledTimes(2));
    expect(onCommand).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'open_surface', placement: 'activity' }), expect.any(AbortSignal));
    expect(onCommand).toHaveBeenNthCalledWith(1, expect.objectContaining({ keepPluginCenter: true }), expect.any(AbortSignal));
    expect(onCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'open_surface', placement: 'workbench' }), expect.any(AbortSignal));
  });

  it('keeps Disable available for an enabled plugin that needs permission attention', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const installedProjection: PluginInventoryProjection = {
      items: [{
        ...containersPlugin,
        pluginInstanceID: 'plugininst_containers',
        managementRevision: 7,
        canDisable: true,
        lifecycleState: 'needs_attention',
        attentionReason: 'permission_required',
      }],
    };

    dispose = render(() => (
      <PluginCenterView
        projection={installedProjection}
        loading={false}
        error={null}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    openInventoryDetails(mount);
    (mount.querySelector('[data-plugin-action="more"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(findDocumentButton('Disable').disabled).toBe(false);
  });

  it('keeps permission switches model-driven across cancellation and confirmed grant', async () => {
    const onCommand = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={containersPermissionProjection()}
        loading={false}
        error={null}
        selectedInventoryKey="catalog:containers"
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const permissionSwitch = mount.querySelector('[data-plugin-permission="containers.read"] [role="switch"]') as HTMLButtonElement;
    expect(permissionSwitch.getAttribute('aria-checked')).toBe('false');

    permissionSwitch.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(permissionSwitch.getAttribute('aria-checked')).toBe('false');
    expect(findDocumentButton('Cancel').className).toContain('min-h-[46px]');
    expect(findDocumentButton('Grant').className).toContain('min-h-[46px]');
    findDocumentButton('Cancel').click();
    await Promise.resolve();
    expect(permissionSwitch.getAttribute('aria-checked')).toBe('false');
    expect(onCommand).not.toHaveBeenCalled();

    permissionSwitch.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    findDocumentButton('Grant').click();
    await Promise.resolve();

    expect(onCommand).toHaveBeenCalledWith({
      type: 'grant_permission',
      pluginInstanceID: 'plugininst_containers',
      permissionID: 'containers.read',
      expectedPolicyRevision: 3,
      expectedManagementRevision: 7,
      expectedRevokeEpoch: 2,
    }, expect.any(AbortSignal));
    expect(permissionSwitch.getAttribute('aria-checked')).toBe('false');
  });

  it('names the actual plugin in permission disclosure and confirmation', async () => {
    const externalProjection = containersPermissionProjection();
    externalProjection.items[0] = {
      ...externalProjection.items[0],
      inventoryKey: 'instance:plugininst_toolbox',
      pluginID: 'com.example.toolbox',
      pluginInstanceID: 'plugininst_toolbox',
      displayName: 'Example Toolbox',
      trustBadge: 'unsigned',
      officialCatalog: undefined,
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={externalProjection}
        loading={false}
        selectedInventoryKey="instance:plugininst_toolbox"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    expect(mount.textContent).toContain('Example Toolbox permissions');
    (mount.querySelector('[data-plugin-permission="containers.read"] [role="switch"]') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.textContent).toContain('Grant View containers to Example Toolbox?');
    expect(document.body.textContent).not.toContain('Grant View containers to Containers?');
  });

  it('distinguishes generic permission IDs in switches and confirmation', async () => {
    const externalProjection = containersPermissionProjection();
    const base = externalProjection.items[0];
    externalProjection.items[0] = {
      ...base,
      inventoryKey: 'instance:plugininst_toolbox',
      pluginID: 'com.example.toolbox',
      pluginInstanceID: 'plugininst_toolbox',
      displayName: 'Example Toolbox',
      trustBadge: 'unsigned',
      officialCatalog: undefined,
      authorization: {
        ...base.authorization!,
        permissions: [
          { ...base.authorization!.permissions[0], permissionID: 'workspace.read', group: 'other', requiredToOpen: false, methods: ['workspace.list'] },
          { ...base.authorization!.permissions[0], permissionID: 'workspace.write', group: 'other', requiredToOpen: false, methods: ['workspace.write'] },
        ],
      },
    };
    const onCommand = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={externalProjection}
        loading={false}
        selectedInventoryKey="instance:plugininst_toolbox"
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const readSwitch = mount.querySelector('[data-plugin-permission="workspace.read"] [role="switch"]') as HTMLButtonElement;
    const writeSwitch = mount.querySelector('[data-plugin-permission="workspace.write"] [role="switch"]') as HTMLButtonElement;
    expect(readSwitch.getAttribute('aria-label')).toBe('Change Workspace read permission');
    expect(writeSwitch.getAttribute('aria-label')).toBe('Change Workspace write permission');
    expect(mount.textContent).toContain('Optional');
    const permissionNames = mount.querySelectorAll<HTMLElement>('[data-plugin-permission-name]');
    expect([...permissionNames].map((name) => name.textContent)).toEqual(['Workspace read', 'Workspace write']);
    const technicalDetails = mount.querySelectorAll<HTMLDetailsElement>('[data-plugin-permission-technical-details]');
    expect(technicalDetails).toHaveLength(2);
    expect([...technicalDetails].every((details) => !details.open)).toBe(true);
    expect([...technicalDetails].every((details) => !details.querySelector('summary')?.textContent?.includes('workspace.'))).toBe(true);
    expect(technicalDetails[1].textContent).toContain('workspace.write');
    writeSwitch.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.textContent).toContain('Grant Workspace write to Example Toolbox?');
    findDocumentButton('Grant').click();
    await Promise.resolve();
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'grant_permission',
      pluginInstanceID: 'plugininst_toolbox',
      permissionID: 'workspace.write',
    }), expect.any(AbortSignal));
  });

  it('explains why a policy-managed optional permission cannot be granted', () => {
    const policyProjection = containersPermissionProjection();
    const item = policyProjection.items[0];
    policyProjection.items[0] = {
      ...item,
      authorization: {
        ...item.authorization!,
        permissions: [{
          ...item.authorization!.permissions[0],
          requiredToOpen: false,
          blockedByPolicy: true,
          grantBlockedByPolicy: true,
        }],
      },
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={policyProjection}
        loading={false}
        selectedInventoryKey="catalog:containers"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const permission = mount.querySelector<HTMLElement>('[data-plugin-permission="containers.read"]')!;
    expect(permission.textContent).toContain('Optional');
    expect(permission.textContent).toContain('Managed by policy');
    expect(permission.textContent).toContain('cannot be granted under the current environment policy');
    expect(permission.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true);
  });

  it('keeps the projected permission state unchanged when a confirmed mutation fails', async () => {
    const onCommand = vi.fn(async () => {
      throw new Error('permission update failed');
    });
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={containersPermissionProjection()}
        loading={false}
        error={null}
        selectedInventoryKey="catalog:containers"
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const permissionSwitch = mount.querySelector('[data-plugin-permission="containers.read"] [role="switch"]') as HTMLButtonElement;
    permissionSwitch.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    findDocumentButton('Grant').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(permissionSwitch.getAttribute('aria-checked')).toBe('false');
    expect(mount.textContent).toContain('permission update failed');
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

    openInventoryDetails(mount);
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
      keepPluginCenter: true,
    }, expect.any(AbortSignal));
  });

  it('opens official catalog updates in the dedicated review without submitting', async () => {
    const onCommand = vi.fn();
    const inspection = externalInspectionForCenter();
    const onInspectExternal = vi.fn(async () => ({
      ...inspection,
      intent: {
        action: 'update' as const,
        plugin_instance_id: 'plugininst_containers',
        expected_management_revision: 13,
      },
      plugin_id: containersPlugin.pluginID,
      publisher_id: containersPlugin.officialCatalog.publisherID,
      version: '2.0.0',
    }));
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
        onInspectExternal={onInspectExternal}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    openInventoryDetails(mount);
    const update = mount.querySelector('[data-plugin-action="update-external"]') as HTMLButtonElement;
    expect(update.disabled).toBe(false);
    update.click();
    await vi.waitFor(() => expect(document.querySelector('[data-plugin-update-dialog]')).not.toBeNull());
    expect(onCommand).not.toHaveBeenCalled();
    expect(document.querySelector('[data-external-plugin-dialog]')).toBeNull();
    expect(onInspectExternal).toHaveBeenCalledWith({
      sourceKind: 'package_url',
      url: OFFICIAL_PLUGIN_CATALOG_SEED[0]!.distribution.installSource.url,
      intent: {
        action: 'update',
        plugin_instance_id: 'plugininst_containers',
        expected_management_revision: 13,
      },
    }, expect.any(AbortSignal));
    await vi.waitFor(() => expect(document.querySelector('[data-plugin-update-submit]')).not.toBeNull());
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('submits official catalog updates through the platform release command', async () => {
    const onCommand = vi.fn(async () => undefined);
    const onCommitExternal = vi.fn(async () => externalCommitForCenter(externalInspectionForCenter()));
    const inspection = externalInspectionForCenter();
    const onInspectExternal = vi.fn(async () => ({
      ...inspection,
      expires_at: '2099-08-08T12:00:00Z',
      intent: {
        action: 'update' as const,
        plugin_instance_id: 'plugininst_containers',
        expected_management_revision: 13,
      },
      plugin_id: containersPlugin.pluginID,
      publisher_id: containersPlugin.officialCatalog.publisherID,
      version: '2.0.0',
      signature_assessment: { ...inspection.signature_assessment, state: 'verified' as const },
    }));
    const updatesProjection: PluginInventoryProjection = {
      items: [{
        ...containersPlugin,
        pluginInstanceID: 'plugininst_containers',
        version: '1.9.0',
        managementRevision: 13,
        lifecycleState: 'update_available',
      }],
    };
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={updatesProjection}
        loading={false}
        error={null}
        onCommand={onCommand}
        onInspectExternal={onInspectExternal}
        onCommitExternal={onCommitExternal}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    openInventoryDetails(mount);
    (mount.querySelector('[data-plugin-action="update-external"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[data-plugin-update-submit]')).not.toBeNull());
    findDocumentButton('Update to v2.0.0').click();
    await vi.waitFor(() => expect(onCommand).toHaveBeenCalledOnce());

    expect(onCommand).toHaveBeenCalledWith({
      type: 'update',
      pluginID: containersPlugin.pluginID,
      pluginInstanceID: 'plugininst_containers',
      targetVersion: '2.0.0',
      expectedManagementRevision: 13,
    }, expect.any(AbortSignal));
    expect(onCommitExternal).not.toHaveBeenCalled();
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

    openInventoryDetails(mount);
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

    openInventoryDetails(mount);
    expect(mount.querySelector('[data-plugin-action="update-external"]')).not.toBeNull();
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

  it('disables only the refresh control while a background refresh is pending', async () => {
    let releaseRefresh!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    }));
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

    const refresh = mount.querySelector('[data-plugin-center-refresh]') as HTMLButtonElement;
    refresh.click();
    await Promise.resolve();

    expect(refresh.disabled).toBe(true);
    expect(mount.querySelector('[data-plugin-center-loading]')).toBeNull();
    expect(mount.querySelector('[data-plugin-center-item]')).not.toBeNull();

    releaseRefresh();
    await vi.waitFor(() => expect(refresh.disabled).toBe(false));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('keeps enabled surfaces closed and exposes an explicit retry after runtime recovery fails', () => {
    const onRetryRuntimeRecovery = vi.fn();
    const enabledProjection = containersPermissionProjection(true);
    enabledProjection.items[0] = {
      ...enabledProjection.items[0],
      defaultLaunchTarget: {
        pluginID: 'com.redeven.official.containers',
        pluginInstanceID: 'plugininst_containers',
        surfaceID: 'containers.dashboard',
        preferredPlacement: 'activity',
        expectedManagementRevision: 7,
      },
    };
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={enabledProjection}
        loading={false}
        error={null}
        canManagePlugins
        canOpenPluginSurfaces={false}
        runtimeRecovery={{
          state: 'failed',
          error: 'Activation evidence is unavailable.',
        }}
        onRetryRuntimeRecovery={onRetryRuntimeRecovery}
        onRefresh={vi.fn()}
        onCommand={vi.fn()}
      />
    ), mount);

    const recovery = mount.querySelector<HTMLElement>('[data-plugin-runtime-recovery="failed"]');
    expect(recovery?.textContent).toContain('Activation evidence is unavailable.');
    expect(recovery?.textContent).toContain('Review the error above, then retry runtime recovery.');
    expect(recovery?.textContent).not.toContain('restart the runtime');
    const retry = recovery?.querySelector<HTMLButtonElement>('[data-plugin-runtime-recovery-retry]');
    expect(retry?.disabled).toBe(false);
    retry?.click();
    retry?.click();
    expect(onRetryRuntimeRecovery).toHaveBeenCalledOnce();
    expect(retry?.disabled).toBe(true);

    const open = mount.querySelector<HTMLButtonElement>('[data-plugin-center-card-primary="catalog:containers"]');
    expect(open?.textContent).toContain('Open');
    expect(open?.disabled).toBe(true);
  });

  it('keeps Host-authorized actions available while presenting recovery status', async () => {
    const onCommand = vi.fn();
    const enabledProjection = containersPermissionProjection(true);
    const containers = {
      ...enabledProjection.items[0],
      defaultLaunchTarget: {
        pluginID: 'com.redeven.official.containers',
        pluginInstanceID: 'plugininst_containers',
        surfaceID: 'containers.dashboard',
        preferredPlacement: 'activity',
        expectedManagementRevision: 7,
      },
    } as const;
    const database = {
      ...containers,
      inventoryKey: 'catalog:database',
      pluginID: 'com.redeven.official.database',
      pluginInstanceID: 'plugininst_database',
      displayName: 'Database Tools',
      defaultLaunchTarget: {
        ...containers.defaultLaunchTarget,
        pluginID: 'com.redeven.official.database',
        pluginInstanceID: 'plugininst_database',
        surfaceID: 'database.dashboard',
      },
      officialCatalog: undefined,
    } as const;
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [containers, database] }}
        loading={false}
        error={null}
        canManagePlugins
        canOpenPluginSurfaces
        runtimeRecoveryByInstanceID={{
          plugininst_containers: { state: 'ready' },
          plugininst_database: { state: 'recovering' },
        }}
        onRetryRuntimeRecovery={vi.fn()}
        onRefresh={vi.fn()}
        onCommand={onCommand}
      />
    ), mount);

    const readyOpen = mount.querySelector<HTMLButtonElement>('[data-plugin-center-card-primary="catalog:containers"]');
    const recoveringOpen = mount.querySelector<HTMLButtonElement>('[data-plugin-center-card-primary="catalog:database"]');
    expect(readyOpen?.disabled).toBe(false);
    expect(recoveringOpen?.disabled).toBe(false);
    expect(mount.querySelector('[data-plugin-runtime-recovery="recovering"]')?.textContent)
      .toContain('This plugin is still recovering.');

    readyOpen?.click();
    await Promise.resolve();
    recoveringOpen?.click();
    expect(onCommand).toHaveBeenCalledTimes(2);
    expect(onCommand.mock.calls[0]?.[0]).toMatchObject({
      type: 'open_surface',
      pluginInstanceID: 'plugininst_containers',
    });
    expect(onCommand.mock.calls[1]?.[0]).toMatchObject({
      type: 'open_surface',
      pluginInstanceID: 'plugininst_database',
    });
  });

  it('presents typed revoked recovery guidance without suggesting a blind retry', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const enabledProjection = containersPermissionProjection(true);
    enabledProjection.items[0] = {
      ...enabledProjection.items[0],
      defaultLaunchTarget: {
        pluginID: 'com.redeven.official.containers',
        pluginInstanceID: 'plugininst_containers',
        surfaceID: 'containers.dashboard',
        preferredPlacement: 'activity',
        expectedManagementRevision: 7,
      },
    };
    const runtimeRecovery = {
      state: 'failed',
      error: 'Plugin trust was revoked; reinstall from a trusted source',
      reason: 'trust_revoked',
      action: 'reinstall',
    } as const;

    dispose = render(() => (
      <PluginCenterView
        projection={enabledProjection}
        loading={false}
        error={null}
        canManagePlugins
        canOpenPluginSurfaces={false}
        runtimeRecovery={runtimeRecovery}
        onRetryRuntimeRecovery={vi.fn()}
        onRefresh={vi.fn()}
        onCommand={vi.fn()}
      />
    ), mount);

    const recovery = mount.querySelector<HTMLElement>('[data-plugin-runtime-recovery="failed"]');
    expect(recovery?.textContent).toContain('This plugin release is no longer trusted.');
    expect(recovery?.textContent).toContain('Reinstall the plugin from a trusted source');
    expect(recovery?.textContent).not.toContain('then retry runtime recovery');
    expect(mount.querySelector<HTMLButtonElement>('[data-plugin-center-card-primary="catalog:containers"]')?.disabled).toBe(true);
  });

  it('presents a bounded recovery timeout with one explicit retry and keeps Open disabled', () => {
    const onRetryRuntimeRecovery = vi.fn();
    const enabledProjection = containersPermissionProjection(true);
    enabledProjection.items[0] = {
      ...enabledProjection.items[0],
      defaultLaunchTarget: {
        pluginID: 'com.redeven.official.containers',
        pluginInstanceID: 'plugininst_containers',
        surfaceID: 'containers.dashboard',
        preferredPlacement: 'activity',
        expectedManagementRevision: 7,
      },
    };

    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={enabledProjection}
        loading={false}
        error={null}
        canManagePlugins
        canOpenPluginSurfaces={false}
        runtimeRecovery={{
          state: 'failed',
          error: 'Plugin runtime recovery exceeded its bounded deadline',
          reason: 'recovery_timeout',
          action: 'retry',
        }}
        onRetryRuntimeRecovery={onRetryRuntimeRecovery}
        onRefresh={vi.fn()}
        onCommand={vi.fn()}
      />
    ), mount);

    const recovery = mount.querySelector<HTMLElement>('[data-plugin-runtime-recovery="failed"]');
    expect(recovery?.textContent).toContain('Plugin runtime recovery took longer than expected.');
    expect(recovery?.textContent).toContain('Review the error above, then retry runtime recovery.');
    const retry = recovery?.querySelector<HTMLButtonElement>('[data-plugin-runtime-recovery-retry]');
    retry?.click();
    retry?.click();
    expect(onRetryRuntimeRecovery).toHaveBeenCalledOnce();
    expect(retry?.disabled).toBe(true);
    expect(mount.querySelector<HTMLButtonElement>('[data-plugin-center-card-primary="catalog:containers"]')?.disabled).toBe(true);
  });

  it('explains that plugin surfaces remain unavailable while runtime recovery is active', () => {
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={containersPermissionProjection(true)}
        loading={false}
        error={null}
        canManagePlugins
        canOpenPluginSurfaces={false}
        runtimeRecovery={{ state: 'recovering' }}
        onRetryRuntimeRecovery={vi.fn()}
        onRefresh={vi.fn()}
        onCommand={vi.fn()}
      />
    ), mount);

    const recovery = mount.querySelector<HTMLElement>('[data-plugin-runtime-recovery="recovering"]');
    expect(recovery?.textContent).toContain('Plugin runtime access is being restored.');
    expect(recovery?.textContent).toContain('Plugin surfaces will remain unavailable until recovery completes.');
    expect(recovery?.querySelector('[data-plugin-runtime-recovery-retry]')).toBeNull();
  });

  it('uses the combined authorization state instead of a stale enabled lifecycle', () => {
    const staleProjection = containersPermissionProjection(false);
    staleProjection.items[0] = {
      ...staleProjection.items[0],
      lifecycleState: 'enabled',
      defaultLaunchTarget: {
        pluginID: 'com.redeven.official.containers',
        pluginInstanceID: 'plugininst_containers',
        surfaceID: 'containers.dashboard',
        expectedManagementRevision: 7,
        preferredPlacement: 'activity',
      },
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={staleProjection}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    openInventoryDetails(mount);
    expect(mount.querySelector('[data-plugin-primary-actions]')?.textContent).toContain('Enable');
    expect(mount.querySelector('[data-plugin-action="open"]')).toBeNull();
    expect(mount.querySelector('[data-plugin-action="open-workbench"]')).toBeNull();
  });

  it('submits delete-data uninstall directly after the explicit retention choice', async () => {
    const onCommand = vi.fn();
    const installedProjection: PluginInventoryProjection = {
      items: [{
        ...containersPlugin,
        pluginInstanceID: 'plugininst_containers',
        version: '2.0.0',
        managementRevision: 23,
        lifecycleState: 'disabled',
      }],
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={installedProjection}
        loading={false}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    openInventoryDetails(mount);
    (mount.querySelector('[data-plugin-action="more"]') as HTMLButtonElement).click();
    await Promise.resolve();
    findDocumentButton('Uninstall').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const choices = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(choices).toHaveLength(2);
    expect(choices[0]?.getAttribute('aria-checked')).toBe('true');
    expect(choices[1]?.getAttribute('aria-checked')).toBe('false');
    expect((document.querySelector('[data-plugin-uninstall-confirm]') as HTMLButtonElement).className).toContain('min-h-[46px]');
    choices[1]?.click();
    (document.querySelector('[data-plugin-uninstall-confirm]') as HTMLButtonElement).click();

    expect(onCommand).toHaveBeenCalledWith({
      type: 'uninstall',
      pluginInstanceID: 'plugininst_containers',
      expectedManagementRevision: 23,
      dataRetention: 'delete_data',
    }, expect.any(AbortSignal));
  });

  it('restores keep data as the safe default after cancelling an uninstall', async () => {
    const onCommand = vi.fn();
    const installedProjection: PluginInventoryProjection = {
      items: [{
        ...containersPlugin,
        pluginInstanceID: 'plugininst_containers',
        version: '2.0.0',
        managementRevision: 23,
        lifecycleState: 'disabled',
      }],
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={installedProjection}
        loading={false}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    openInventoryDetails(mount);
    const openUninstall = async () => {
      (mount.querySelector('[data-plugin-action="more"]') as HTMLButtonElement).click();
      await Promise.resolve();
      findDocumentButton('Uninstall').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await openUninstall();
    const choices = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    choices[1]?.click();
    findDocumentButton('Cancel').click();
    await Promise.resolve();

    await openUninstall();
    const reopenedChoices = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(reopenedChoices[0]?.getAttribute('aria-checked')).toBe('true');
    expect(reopenedChoices[1]?.getAttribute('aria-checked')).toBe('false');
    (document.querySelector('[data-plugin-uninstall-confirm]') as HTMLButtonElement).click();
    expect(onCommand).toHaveBeenCalledWith({
      type: 'uninstall',
      pluginInstanceID: 'plugininst_containers',
      expectedManagementRevision: 23,
      dataRetention: 'keep_data',
    }, expect.any(AbortSignal));
  });

  it('binds Plugin Center errors to a retry action and administrator guidance', () => {
    const onRefresh = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        error={new Error('Inventory unavailable')}
        onCommand={vi.fn()}
        onRefresh={onRefresh}
        canManagePlugins={false}
        canOpenPluginSurfaces
      />
    ), mount);

    const error = mount.querySelector('[data-plugin-center-error]')!;
    expect(error.textContent).toContain('Inventory unavailable');
    expect(error.textContent).toContain('environment administrator');
    findDocumentButton('Retry').click();
    expect(onRefresh).toHaveBeenCalledOnce();
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

    const installedProjection: PluginInventoryProjection = {
      items: [{
        ...containersPlugin,
        pluginInstanceID: 'plugininst_containers',
        version: '2.0.0',
        managementRevision: 7,
        canDisable: true,
        lifecycleState: 'enabled',
      }],
    };
    dispose = render(() => (
      <PluginCenterView
        projection={installedProjection}
        loading={false}
        error={null}
        canManagePlugins
        canOpenPluginSurfaces={false}
        onRefresh={vi.fn()}
        onCommand={onCommand}
      />
    ), mount);

    openInventoryDetails(mount);
    (mount.querySelector('[data-plugin-action="more"]') as HTMLButtonElement).click();
    await Promise.resolve();
    const disable = findDocumentButton('Disable');
    disable.click();
    disable.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onCommand).toHaveBeenCalledTimes(1);
    (mount.querySelector('[data-plugin-action="more"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(findDocumentButton('Disable').disabled).toBe(true);

    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(findDocumentButton('Disable').disabled).toBe(false);
  });

  it('selects same-plugin-id instances independently by inventory key', () => {
    const first = {
      ...containersPlugin,
      inventoryKey: 'instance:plugini_toolbox_alpha',
      pluginID: 'com.example.toolbox',
      pluginInstanceID: 'plugini_toolbox_alpha',
      displayName: 'Toolbox Alpha',
      description: 'First independently installed instance.',
      publisher: 'Example Publisher',
      version: '1.0.0',
      managementRevision: 3,
      lifecycleState: 'disabled',
      trustBadge: 'unsigned',
      officialCatalog: undefined,
    } satisfies PluginInventoryProjection['items'][number];
    const second = {
      ...first,
      inventoryKey: 'instance:plugini_toolbox_beta',
      pluginInstanceID: 'plugini_toolbox_beta',
      displayName: 'Toolbox Beta',
      description: 'Second independently installed instance.',
      managementRevision: 8,
    } satisfies PluginInventoryProjection['items'][number];
    const mount = document.createElement('div');
    document.body.append(mount);

    const matchingCatalog = {
      ...containersPlugin,
      inventoryKey: 'catalog:toolbox',
      pluginID: 'com.example.toolbox',
      displayName: 'Toolbox Catalog',
      officialCatalog: undefined,
    } satisfies PluginInventoryProjection['items'][number];

    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [matchingCatalog, first, second] }}
        loading={false}
        error={null}
        selectedInventoryKey="instance:plugini_toolbox_beta"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Toolbox Beta');
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).not.toContain('Toolbox Catalog');
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).not.toContain('Toolbox Alpha');
    const beta = mount.querySelector('[data-plugin-center-item="instance:plugini_toolbox_beta"]') as HTMLButtonElement;
    const alpha = mount.querySelector('[data-plugin-center-item="instance:plugini_toolbox_alpha"]') as HTMLButtonElement;
    expect(beta.getAttribute('aria-current')).toBe('true');
    expect(alpha.getAttribute('aria-current')).toBeNull();
    alpha.click();
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Toolbox Alpha');
    expect(beta.getAttribute('aria-current')).toBeNull();
    expect(alpha.getAttribute('aria-current')).toBe('true');
  });

  it('keeps the exact committed instance selected while retained filters exclude it', async () => {
    const inspected = externalInspectionForCenter();
    const committed = externalCommitForCenter(inspected);
    const alpha = {
      ...containersPermissionProjection().items[0],
      inventoryKey: 'instance:toolbox-alpha',
      pluginID: 'com.example.toolbox',
      pluginInstanceID: 'toolbox-alpha',
      displayName: 'Toolbox Alpha',
      description: 'Existing external plugin instance.',
      publisher: 'Example Publisher',
      version: '1.0.0',
      managementRevision: 3,
      lifecycleState: 'disabled',
      trustBadge: 'unsigned',
      officialCatalog: undefined,
    } satisfies PluginInventoryProjection['items'][number];
    const beta = {
      ...containersPermissionProjection().items[0],
      inventoryKey: 'instance:plugini_external_beta',
      pluginID: 'com.example.toolbox',
      pluginInstanceID: 'plugini_external_beta',
      displayName: 'Toolbox Beta',
      description: 'Newly committed external plugin instance.',
      publisher: 'Example Publisher',
      version: '1.2.3',
      managementRevision: 1,
      lifecycleState: 'needs_attention',
      trustBadge: 'unsigned',
      officialCatalog: undefined,
    } satisfies PluginInventoryProjection['items'][number];
    const [currentProjection, setCurrentProjection] = createSignal<PluginInventoryProjection>({ items: [alpha] });
    const onRefresh = vi.fn(async () => setCurrentProjection({ items: [alpha, beta] }));
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={currentProjection()}
        loading={false}
        onInspectExternal={vi.fn(async () => inspected)}
        onCommitExternal={vi.fn(async () => committed)}
        onCommand={vi.fn()}
        onRefresh={onRefresh}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    const search = mount.querySelector<HTMLInputElement>('[data-plugin-center-search]')!;
    search.value = 'Alpha';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (mount.querySelector('[data-plugin-center-install-external]') as HTMLButtonElement).click();
    await Promise.resolve();
    findDocumentButton('Install from source').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const source = document.querySelector<HTMLInputElement>('[data-external-plugin-dialog] input[type="url"]')!;
    source.value = 'https://plugins.example.com/toolbox.redevplugin';
    source.dispatchEvent(new InputEvent('input', { bubbles: true }));
    findDocumentButton('Review package').click();
    await Promise.resolve();
    await Promise.resolve();
    document.querySelector<HTMLInputElement>('[data-external-plugin-confirmation] input[type="checkbox"]')!.click();
    findDocumentButton('Install plugin').click();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(mount.querySelector('[data-plugin-center-item="instance:plugini_external_beta"]')).toBeNull();
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Toolbox Beta');
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).not.toContain('Toolbox Alpha');

    expect(document.body.textContent).not.toContain('Review required permissions');
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Toolbox Beta');
  });

  it('preserves an exact shell detail request when retained filters exclude it', async () => {
    const alpha = {
      ...containersPlugin,
      inventoryKey: 'instance:toolbox-alpha',
      pluginID: 'com.example.toolbox',
      pluginInstanceID: 'toolbox-alpha',
      displayName: 'Toolbox Alpha',
      managementRevision: 3,
      lifecycleState: 'disabled',
      officialCatalog: undefined,
    } satisfies PluginInventoryProjection['items'][number];
    const beta = {
      ...alpha,
      inventoryKey: 'instance:toolbox-beta',
      pluginInstanceID: 'toolbox-beta',
      displayName: 'Toolbox Beta',
      managementRevision: 8,
    } satisfies PluginInventoryProjection['items'][number];
    const [selectedKey, setSelectedKey] = createSignal<string>();
    const [focusRequest, setFocusRequest] = createSignal(0);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [alpha, beta] }}
        loading={false}
        selectedInventoryKey={selectedKey()}
        focusRequest={focusRequest()}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    const search = mount.querySelector<HTMLInputElement>('[data-plugin-center-search]')!;
    search.value = 'Alpha';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(mount.querySelector('[data-plugin-center-item="instance:toolbox-beta"]')).toBeNull();

    setSelectedKey('instance:toolbox-beta');
    setFocusRequest(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Toolbox Beta');
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).not.toContain('Toolbox Alpha');

    const back = mount.querySelector<HTMLButtonElement>('[data-plugin-center-mobile-back]')!;
    back.focus();
    back.click();
    await Promise.resolve();
    expect(mount.querySelector('[data-plugin-center-details]')).toBeNull();
    expect(document.activeElement).toBe(search);
  });
});
