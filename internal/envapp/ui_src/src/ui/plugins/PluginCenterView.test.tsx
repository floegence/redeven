// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PluginCenterView } from './PluginCenterView';
import { EXAMPLE_PLUGIN_RELEASE_REF } from './examplePluginRelease.test-fixture';
import {
  OFFICIAL_PLUGIN_CATALOG_SEED,
  OFFICIAL_PLUGIN_MARKET_DETAIL,
} from './officialPluginCatalog.test-fixture';
import type {
  ExternalPluginCommitResult,
  ExternalPluginInspection,
  PluginInventoryProjection,
  PluginMarketDetail,
} from './pluginTypes';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

const metricsPlugin = {
  inventoryKey: 'catalog:metrics',
  pluginID: 'com.example.metrics',
  displayName: 'Metrics',
  description: 'Show neutral runtime metrics.',
  iconFallback: 'generic',
  category: 'infrastructure',
  searchKeywords: ['metrics', 'monitoring'],
  publisher: 'Redeven',
  lifecycleState: 'not_installed',
  trustBadge: 'official',
  pinned: false,
  officialCatalog: {
    pluginID: 'com.example.metrics',
    publisherID: 'com.example',
    pluginInstanceID: 'plugini_redeven_official_metrics',
    displayName: 'Metrics',
    description: 'Show neutral runtime metrics.',
    publisher: 'Redeven',
    latestVersion: '2.0.0',
    stableVersion: '2.0.0',
    minRedevenVersion: '0.9.0',
    minReDevPluginVersion: '3.0.0',
    rolloutState: 'stable',
    iconFallback: 'generic',
    category: 'infrastructure',
    searchKeywords: ['metrics', 'monitoring'],
    trustedSigningKeyIDs: ['example_signing_key_2026'],
    installPreview: OFFICIAL_PLUGIN_CATALOG_SEED[0]!.installPreview,
    distribution: {
      releaseRef: EXAMPLE_PLUGIN_RELEASE_REF,
      installSource: {
        sourceKind: 'package_url',
        url: OFFICIAL_PLUGIN_CATALOG_SEED[0]!.distribution.installSource.url,
      },
    },
  },
} satisfies PluginInventoryProjection['items'][number];

const databasePlugin = {
  ...metricsPlugin,
  inventoryKey: 'catalog:database',
  pluginID: 'com.example.database',
  displayName: 'Database Tools',
  description: 'Inspect local database connections.',
  iconFallback: 'database',
  category: 'data',
  searchKeywords: ['database'],
  officialCatalog: undefined,
} satisfies PluginInventoryProjection['items'][number];

const projection: PluginInventoryProjection = {
  items: [metricsPlugin, databasePlugin],
};

const metricsInstallCommand = {
  type: 'install' as const,
  pluginID: metricsPlugin.pluginID,
  source: 'official_catalog' as const,
  pluginInstanceID: metricsPlugin.officialCatalog.pluginInstanceID,
  releaseRef: metricsPlugin.officialCatalog.installPreview!.release_ref,
  releaseIdentityDigest: metricsPlugin.officialCatalog.installPreview!.release_identity_digest,
  manifestSHA256: metricsPlugin.officialCatalog.installPreview!.manifest_sha256,
  contractSetSHA256: metricsPlugin.officialCatalog.installPreview!.contract_set_sha256,
  summarySHA256: metricsPlugin.officialCatalog.installPreview!.summary_sha256,
};

function metricsPermissionProjection(granted = false): PluginInventoryProjection {
  return {
    items: [{
      ...metricsPlugin,
      pluginInstanceID: 'plugininst_metrics',
      version: '2.0.0',
      managementRevision: 7,
      canDisable: true,
      lifecycleState: granted ? 'enabled' : 'needs_attention',
      attentionReason: granted ? undefined : 'permission_required',
      authorization: {
        grants: [],
        permissions: [{
          permissionID: 'metrics.read',
          group: 'read',
          requiredToOpen: true,
          methods: ['metrics.status'],
          requiredToOpenMethods: ['metrics.status'],
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

function openInventoryDetails(mount: HTMLElement, inventoryKey = 'catalog:metrics'): HTMLButtonElement {
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

describe('PluginCenterView', () => {
  it('shows one concise preparation state while the local plugin session initializes', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [] }}
        loading={false}
        preparing
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins={false}
        canOpenPluginSurfaces={false}
      />
    ), mount);

    const status = mount.querySelector('[data-plugin-center-preparing]');
    expect(status?.textContent).toContain('Preparing plugin features');
    expect(mount.querySelectorAll('[data-plugin-center-preparing]')).toHaveLength(1);
  });

  it('presents Discover plugins with a compact identity and independent install and detail actions', async () => {
    const onCommand = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [metricsPlugin] }}
        loading={false}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    const details = mount.querySelector('[data-plugin-center-item="catalog:metrics"]') as HTMLButtonElement;
    const install = mount.querySelector('[data-plugin-center-install="catalog:metrics"]') as HTMLButtonElement;
    expect(details).not.toBeNull();
    expect(install.textContent).toContain('Install');
    expect(install.closest('article')?.querySelector('.h-12.w-12')).not.toBeNull();
    install.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-plugin-install-review-dialog]')).not.toBeNull();
    expect(onCommand).not.toHaveBeenCalled();
    (document.querySelector('[data-plugin-install-review-confirm]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onCommand).toHaveBeenCalledWith(metricsInstallCommand, expect.any(AbortSignal));
    expect(document.querySelector('[data-external-plugin-dialog]')).toBeNull();
  });

  it('shows the installed Host version instead of the newer market version', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const installed = {
      ...metricsPlugin,
      pluginInstanceID: 'plugininst_metrics',
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

    const card = mount.querySelector('[data-plugin-directory-card="catalog:metrics"]');
    expect(card?.textContent).toContain('v1.9.0');
    expect(card?.textContent).not.toContain('v2.0.0');
  });

  it('omits a repeated author summary and redundant availability badge without replacing author copy', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => <PluginCenterView
      projection={{ items: [{ ...metricsPlugin, officialCatalog: undefined, description: metricsPlugin.displayName }] }}
      loading={false} onCommand={vi.fn()} onRefresh={vi.fn()} canManagePlugins canOpenPluginSurfaces
    />, mount);
    const card = mount.querySelector('[data-plugin-directory-card]')!;
    expect(card.textContent?.match(/Metrics/g)).toHaveLength(1);
    expect(card.textContent).not.toContain('Available');
    openInventoryDetails(mount);
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Metrics');
  });

  it('opens a real card action menu instead of treating the ellipsis as a detail button', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const installed = {
      ...metricsPlugin,
      pluginInstanceID: 'plugininst_metrics',
      version: '2.0.0',
      managementRevision: 23,
      lifecycleState: 'enabled' as const,
      defaultLaunchTarget: {
        pluginID: metricsPlugin.pluginID,
        pluginInstanceID: 'plugininst_metrics',
        surfaceID: 'metrics.dashboard',
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

    (mount.querySelector('[data-plugin-center-card-menu="catalog:metrics"]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(findDocumentButton('Open')).not.toBeNull();
    expect(findDocumentButton('Open in Workbench')).not.toBeNull();
    findDocumentButton('View plugin details').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Metrics');
  });

  it('keeps disabled card actions aligned with the lifecycle state', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const disabled = {
      ...metricsPlugin,
      pluginInstanceID: 'plugininst_metrics',
      version: '2.0.0',
      managementRevision: 23,
      lifecycleState: 'disabled' as const,
      defaultLaunchTarget: {
        pluginID: metricsPlugin.pluginID,
        pluginInstanceID: 'plugininst_metrics',
        surfaceID: 'metrics.dashboard',
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

    const card = mount.querySelector('[data-plugin-center-card-menu="catalog:metrics"]') as HTMLButtonElement;
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
      ...metricsPlugin,
      pluginInstanceID: 'plugininst_metrics',
      version: '2.0.0',
      managementRevision: 23,
      lifecycleState: 'needs_attention' as const,
      trustBadge: 'blocked' as const,
      attentionReason: 'trust_unavailable' as const,
      defaultLaunchTarget: {
        pluginID: metricsPlugin.pluginID,
        pluginInstanceID: 'plugininst_metrics',
        surfaceID: 'metrics.dashboard',
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

    const primary = mount.querySelector<HTMLButtonElement>('[data-plugin-center-card-primary="catalog:metrics"]');
    expect(primary?.textContent).toContain('View trust details');
    primary?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onCommand).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'open_surface' }), expect.anything());
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Metrics');
  });

  it('does not use market presentation when an installed record has no host presentation', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [{
          ...metricsPlugin,
          displayName: 'Installed Name',
          description: 'Installed summary',
          publisher: 'Installed Publisher',
          pluginInstanceID: 'plugininst_metrics',
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

    (mount.querySelector('[data-plugin-center-item="catalog:metrics"]') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const details = mount.querySelector('[data-plugin-center-details]')!;
    expect(details.querySelector('[data-plugin-center-detail-heading]')?.textContent).toContain('Installed Name');
    expect(details.textContent).toContain('Installed summary');
    expect(details.textContent).not.toContain('Show neutral runtime metrics.');
  });

  it('loads complete market author content only after an uninstalled plugin is selected', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const onLoadMarketDetail = vi.fn(async () => OFFICIAL_PLUGIN_MARKET_DETAIL);
    const marketItem = {
      ...metricsPlugin,
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
      'com.example.metrics',
      OFFICIAL_PLUGIN_CATALOG_SEED[0]!.marketGeneration,
      expect.any(AbortSignal),
    ));
    await vi.waitFor(() => expect(mount.querySelector('[data-plugin-author-description]')).not.toBeNull());
    const author = mount.querySelector<HTMLElement>('[data-plugin-author-content]')!;
    expect(author.querySelector('[lang="en-US"]')).not.toBeNull();
    expect(author.textContent).toContain('Shows neutral runtime metrics for general plugin platform tests.');
    expect(mount.querySelector('[data-plugin-author-highlights]')).not.toBeNull();
  });

  it('reloads selected market detail when the catalog generation changes', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const [currentProjection, setCurrentProjection] = createSignal<PluginInventoryProjection>({
      items: [{
        ...metricsPlugin,
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
        ...metricsPlugin,
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
      plugin_id: 'com.example.metrics',
      publisher_id: 'com.example',
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
        projection={{ items: [metricsPlugin] }}
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
    expect(mount.textContent).toContain('Show neutral runtime metrics.');
    expect(mount.querySelector('[data-plugin-center-install="catalog:metrics"]')).not.toBeNull();
    expect(findDocumentButton('Retry')).not.toBeNull();
  });

  it('keeps refresh status outside the card grid', () => {
    const [loading, setLoading] = createSignal(false);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [metricsPlugin] }}
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
      ...metricsPlugin,
      pluginInstanceID: 'plugininst_metrics',
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
    await vi.waitFor(() => expect(mount.querySelector('[data-plugin-center-update="catalog:metrics"]')).not.toBeNull());
    const update = mount.querySelector('[data-plugin-center-update="catalog:metrics"]') as HTMLButtonElement;
    expect(update.textContent).toContain('Review update');
    expect(update.closest('article')?.className).not.toContain('border-t-[var(--redeven-status-info-foreground)]');
    expect(update.className).toContain('h-9');
    expect(mount.querySelector('[data-plugin-center-list]')?.className).toContain('grid');
  });

  it('keeps the detail primary action and overflow menu in one action row', () => {
    const updateItem = {
      ...metricsPlugin,
      pluginInstanceID: 'plugininst_metrics',
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
        selectedInventoryKey="catalog:metrics"
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
    const target = { pluginID: 'com.example.metrics', pluginInstanceID: 'plugininst_metrics', surfaceID: 'metrics.dashboard', expectedManagementRevision: 13, preferredPlacement: 'activity' as const };
    const updateItem = {
      ...metricsPlugin,
      pluginInstanceID: 'plugininst_metrics',
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
        selectedInventoryKey="catalog:metrics"
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
        projection={{ items: [metricsPlugin] }}
        loading={false}
        selectedInventoryKey="catalog:metrics"
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
    expect(details.className).toContain('absolute');
    expect(details.className).not.toContain('sm:relative');
    expect(controls.className).toContain('shrink-0');
    expect(body.className).toContain('min-h-0');
    expect(body.className).toContain('flex-1');
    expect(body.className).toContain('overflow-y-auto');
    expect(controls.contains(actions)).toBe(true);
    expect(body.contains(actions)).toBe(false);
    expect(body.contains(author)).toBe(true);
  });

  it('groups required and optional permissions without changing switch semantics', () => {
    const permissionProjection = metricsPermissionProjection();
    permissionProjection.items[0].authorization!.permissions = [
      ...permissionProjection.items[0].authorization!.permissions,
      {
        ...permissionProjection.items[0].authorization!.permissions[0],
        permissionID: 'metrics.delete',
        group: 'delete',
        requiredToOpen: false,
        methods: ['metrics.delete'],
        requiredToOpenMethods: [],
      },
    ];
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={permissionProjection}
        loading={false}
        selectedInventoryKey="catalog:metrics"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    expect(mount.querySelector('[data-plugin-permission-group="required"] [data-plugin-permission="metrics.read"]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-permission-group="optional"] [data-plugin-permission="metrics.delete"]')).not.toBeNull();
    expect(mount.querySelectorAll('[data-plugin-permission] [role="switch"]')).toHaveLength(2);
  });

  it('exposes the active Plugin Center view with tab semantics', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [metricsPlugin] }}
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

    const installed = metricsPermissionProjection().items[0]!;
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

  it('renders a dedicated management shell outside Settings with local search', async () => {
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
    expect(mount.textContent).toContain('Metrics');
    expect(mount.textContent).not.toMatch(/Developer|Install from URL|Install from file|unsigned|marketplace/i);
    (mount.querySelector('[data-plugin-center-close]') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledOnce();

    const search = mount.querySelector('[data-plugin-center-search]') as HTMLInputElement;
    search.value = 'database';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));

    expect(mount.querySelector('[data-plugin-center-item="catalog:database"]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-item="catalog:metrics"]')).toBeNull();

    search.value = '';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (mount.querySelector('[data-plugin-center-filter="category"]') as HTMLElement).click();
    await Promise.resolve();
    findDocumentButton('Infrastructure').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mount.querySelector('[data-plugin-center-item="catalog:metrics"]')).not.toBeNull();
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
    expect(mount.querySelector('[data-plugin-center-item="catalog:metrics"]')).not.toBeNull();
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
      ...metricsPlugin,
      inventoryKey: 'instance:unsigned-metrics',
      pluginInstanceID: 'unsigned-metrics',
      managementRevision: 4,
      lifecycleState: 'needs_attention',
      trustBadge: 'unsigned',
      officialCatalog: undefined,
    } satisfies PluginInventoryProjection['items'][number];
    const officialInstalled = {
      ...metricsPlugin,
      inventoryKey: 'instance:official-metrics',
      pluginInstanceID: 'official-metrics',
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

    for (const [filter, label] of [
      ['category', 'Infrastructure'],
      ['source', 'External'],
      ['trust', 'Unsigned'],
      ['lifecycle', 'Needs attention'],
    ] as const) {
      (mount.querySelector(`[data-plugin-center-filter="${filter}"]`) as HTMLButtonElement).click();
      await Promise.resolve();
      findDocumentButton(label).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(mount.querySelector('[data-plugin-center-item="instance:unsigned-metrics"]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-item="instance:official-metrics"]')).toBeNull();
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
          ...metricsPlugin,
          pluginInstanceID: 'plugininst_metrics',
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
        selectedInventoryKey="catalog:metrics"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Metrics');
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Disabled');
  });

  it('consumes an exact shell selection once so inventory refresh does not reopen closed details', async () => {
    const [currentProjection, setCurrentProjection] = createSignal(metricsPermissionProjection());
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={currentProjection()}
        loading={false}
        selectedInventoryKey="catalog:metrics"
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
        projection={metricsPermissionProjection()}
        loading={false}
        selectedInventoryKey="catalog:metrics"
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
    expect(heading.textContent).toBe('Metrics');
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
        projection={metricsPermissionProjection()}
        loading={false}
        selectedInventoryKey="catalog:metrics"
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
        projection={metricsPermissionProjection(true)}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const item = mount.querySelector<HTMLButtonElement>('[data-plugin-center-item="catalog:metrics"]')!;
    item.click();
    await Promise.resolve();
    await Promise.resolve();
    const master = mount.querySelector<HTMLElement>('[data-plugin-center-master]')!;
    const details = mount.querySelector<HTMLElement>('[data-plugin-center-details]')!;
    expect(master.classList).toContain('hidden');
    expect(details.classList).toContain('block');

    const search = mount.querySelector<HTMLInputElement>('[data-plugin-center-search]')!;
    search.focus();
    search.value = 'metrics';
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
          ...metricsPlugin,
          pluginInstanceID: 'plugininst_metrics',
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
          selectedInventoryKey="catalog:metrics"
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
        ...metricsPlugin,
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
        selectedInventoryKey="catalog:metrics"
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

  it('opens the cached official install preview without a package inspection request', async () => {
    const onCommand = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [metricsPlugin] }}
        loading={false}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const install = mount.querySelector<HTMLButtonElement>('[data-plugin-center-install="catalog:metrics"]')!;
    install.click();
    await Promise.resolve();
    const review = document.querySelector<HTMLElement>('[data-plugin-install-review-dialog]')!;
    expect(review).not.toBeNull();
    expect(review.textContent).toContain('Metrics');
    expect(review.textContent).toContain('2.0.0');
    expect(review.textContent).not.toContain('sha256:');
    (document.querySelector('[data-plugin-install-review-confirm]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onCommand).toHaveBeenCalledWith(metricsInstallCommand, expect.any(AbortSignal));
  });

  it('opens an actionable loading dialog immediately when the market preview is missing', async () => {
    const missingPreview = {
      ...metricsPlugin,
      officialCatalog: {
        ...metricsPlugin.officialCatalog,
        installPreview: undefined,
      },
    };
    const [currentProjection, setCurrentProjection] = createSignal<PluginInventoryProjection>({ items: [missingPreview] });
    let completeRefresh: (() => void) | undefined;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => {
      completeRefresh = () => {
        setCurrentProjection({ items: [metricsPlugin] });
        resolve();
      };
    }));
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={currentProjection()}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={onRefresh}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    (mount.querySelector('[data-plugin-center-install="catalog:metrics"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-plugin-install-preview-loading]')).not.toBeNull();
    expect(document.querySelector('[data-plugin-install-review-confirm]')).toBeNull();
    expect(document.querySelector('[data-plugin-install-preview-loading]')?.closest('[role="dialog"]')).not.toBeNull();

    const previewDialog = document.querySelector('[data-plugin-install-preview-loading]')?.closest('[role="dialog"]') as HTMLElement;
    (previewDialog.querySelector('button') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(document.querySelector('[data-plugin-install-preview-loading]')).toBeNull();
    (mount.querySelector('[data-plugin-center-install="catalog:metrics"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-plugin-install-preview-loading]')).not.toBeNull();

    completeRefresh?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('[data-plugin-install-preview-loading]')).toBeNull();
    expect(document.querySelector('[data-plugin-install-review-dialog]')?.textContent).toContain('2.0.0');
  });

  it('fills a missing preview with one market detail request without refreshing Host inventory', async () => {
    const missingPreview = {
      ...metricsPlugin,
      officialCatalog: {
        ...metricsPlugin.officialCatalog,
        installPreview: undefined,
      },
    };
    const onRefresh = vi.fn();
    const onLoadMarketDetail = vi.fn(async () => OFFICIAL_PLUGIN_MARKET_DETAIL);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [missingPreview] }}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={onRefresh}
        onLoadMarketDetail={onLoadMarketDetail}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    (mount.querySelector('[data-plugin-center-install="catalog:metrics"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(onLoadMarketDetail).toHaveBeenCalledOnce());
    expect(onLoadMarketDetail).toHaveBeenCalledWith(
      metricsPlugin.pluginID,
      0,
      expect.any(AbortSignal),
    );
    expect(onRefresh).not.toHaveBeenCalled();
    await vi.waitFor(() => expect([...document.querySelectorAll<HTMLElement>('[data-plugin-install-review-dialog]')].at(-1)?.textContent).toContain('4.4.9'));
  });

  it('uses the current market release when the cached catalog version is stale', async () => {
    const missingPreview = {
      ...metricsPlugin,
      officialCatalog: {
        ...metricsPlugin.officialCatalog,
        latestVersion: '4.4.4',
        stableVersion: '4.4.4',
        installPreview: undefined,
      },
    };
    const currentDetail: PluginMarketDetail = {
      ...OFFICIAL_PLUGIN_MARKET_DETAIL,
      latest: OFFICIAL_PLUGIN_MARKET_DETAIL.latest.map((release) => ({
        ...release,
        version: '4.4.9',
        install_preview: release.install_preview
          ? { ...release.install_preview, release_ref: { ...release.install_preview.release_ref, version: '4.4.9' } }
          : undefined,
      })),
    };
    const onCommand = vi.fn(async () => undefined);
    const onLoadMarketDetail = vi.fn(async () => currentDetail);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [missingPreview] }}
        loading={false}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        onLoadMarketDetail={onLoadMarketDetail}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    (mount.querySelector('[data-plugin-center-install="catalog:metrics"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect([...document.querySelectorAll<HTMLButtonElement>('[data-plugin-install-review-confirm]')].at(-1)).not.toBeUndefined());
    await vi.waitFor(() => expect([...document.querySelectorAll<HTMLElement>('[data-plugin-install-review-dialog]')].at(-1)?.textContent).toContain('4.4.9'));
    [...document.querySelectorAll<HTMLButtonElement>('[data-plugin-install-review-confirm]')].at(-1)?.click();
    await vi.waitFor(() => expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'install',
      releaseRef: expect.objectContaining({ version: '4.4.9' }),
    }), expect.any(AbortSignal)));
  });

  it('keeps a failed preview refresh inside one actionable dialog', async () => {
    const missingPreview = {
      ...metricsPlugin,
      officialCatalog: {
        ...metricsPlugin.officialCatalog,
        installPreview: undefined,
      },
    };
    const onRefresh = vi.fn(() => Promise.reject(new Error('market offline')));
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [missingPreview] }}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={onRefresh}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    (mount.querySelector('[data-plugin-center-install="catalog:metrics"]') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-plugin-install-preview-error]')?.textContent).toContain('plugin catalog is unavailable');
    expect(document.querySelectorAll('[data-plugin-install-preview-retry]')).toHaveLength(1);
    expect(mount.querySelector('[data-plugin-install-error]')).toBeNull();
  });

  it('keeps the catalog usable while an install task is running', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        installOperations={[{
          pluginID: metricsPlugin.pluginID,
          pluginInstanceID: metricsPlugin.officialCatalog.pluginInstanceID,
          observation: 'watching',
          execution: {
            execution_id: 'release_install_metrics', plugin_instance_id: metricsPlugin.officialCatalog.pluginInstanceID,
            kind: 'operation', status: 'running', cursor: 3, cancelable: false,
            created_at: '2026-08-22T00:00:00Z', updated_at: '2026-08-22T00:00:01Z',
          },
          progress: [
            { task_id: 'release_install_metrics', request_id: 'request', stage: 'download', status: 'completed' },
            { task_id: 'release_install_metrics', request_id: 'request', stage: 'verify', status: 'running' },
          ],
        }]}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);
    const summary = mount.querySelector('[data-plugin-center-install-summary]');
    expect(summary).not.toBeNull();
    expect(summary?.querySelector('[data-plugin-install-stage]')).toBeNull();
    expect(summary?.querySelector('[data-plugin-install-progress]')?.getAttribute('aria-valuenow')).toBe('1');
    expect(summary?.textContent).toContain('Security check');
    expect(summary?.textContent).toContain('2 / 4');
    expect(mount.querySelector('[data-plugin-center-item="catalog:database"]')).not.toBeNull();
  });

  it('uses one finalizing label and locks only the target plugin', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        installOperations={[{
          pluginID: metricsPlugin.pluginID,
          pluginInstanceID: metricsPlugin.officialCatalog.pluginInstanceID,
          observation: 'finalizing',
          progress: [],
        }]}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const target = mount.querySelector<HTMLButtonElement>('[data-plugin-center-install-summary]')!;
    const other = mount.querySelector<HTMLButtonElement>('[data-plugin-center-install="catalog:database"]')!;
    expect(target.textContent).toContain('Finalizing installation...');
    expect(target.disabled).toBe(false);
    expect(mount.querySelector('[data-plugin-center-install="catalog:metrics"]')).toBeNull();
    expect(target.closest('[data-plugin-install-summary]')?.getAttribute('aria-busy')).toBe('true');
    expect(other.disabled).toBe(false);
    expect(mount.querySelector<HTMLInputElement>('[data-plugin-center-search]')!.disabled).toBe(false);
  });

  it('shows authoritative byte progress only on the target plugin while browsing remains available', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        installOperations={[{
          pluginID: metricsPlugin.pluginID,
          pluginInstanceID: metricsPlugin.officialCatalog.pluginInstanceID,
          observation: 'watching',
          execution: {
            execution_id: 'release_install_metrics',
            plugin_instance_id: metricsPlugin.officialCatalog.pluginInstanceID,
            kind: 'operation',
            status: 'running',
            cursor: 1,
            cancelable: false,
            created_at: '2026-08-05T08:00:00Z',
            updated_at: '2026-08-05T08:00:01Z',
          },
          progress: [{
            task_id: 'release_install_metrics',
            request_id: 'request_1',
            stage: 'download',
            status: 'running',
            completed: 262_144,
            total: 524_288,
          }],
        }]}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const target = mount.querySelector('[data-plugin-directory-card="catalog:metrics"]')!;
    const other = mount.querySelector('[data-plugin-directory-card="catalog:database"]')!;
    const progress = target.querySelector<HTMLElement>('[data-plugin-install-progress]')!;
    expect(target.querySelector('[data-plugin-install-stage]')).toBeNull();
    expect(progress.getAttribute('aria-valuenow')).toBe('262144');
    expect(progress.getAttribute('aria-valuemax')).toBe('524288');
    expect(progress.title).toContain('256');
    expect(target.querySelector('[data-plugin-center-install-summary]')?.textContent).toContain('50%');
    expect(target.querySelector('[data-plugin-center-install-summary]')?.textContent).toContain('Get package');
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
          pluginID: metricsPlugin.pluginID,
          pluginInstanceID: metricsPlugin.officialCatalog.pluginInstanceID,
          observation: 'watching',
          execution: {
            execution_id: 'release_install_metrics',
            plugin_instance_id: metricsPlugin.officialCatalog.pluginInstanceID,
            kind: 'operation',
            status: 'failed',
            cursor: 1,
            failure_code: 'PLUGIN_RELEASE_NETWORK',
            cancelable: false,
            created_at: '2026-08-05T08:00:00Z',
            updated_at: '2026-08-05T08:00:03Z',
            terminal_at: '2026-08-05T08:00:03Z',
          },
          progress: [],
          failure: { source: 'execution', code: 'PLUGIN_RELEASE_NETWORK', stage: 'download', retryable: true, recovery: 'retry_install' },
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
    expect(onRetryInstall).toHaveBeenCalledWith(metricsPlugin.officialCatalog.pluginInstanceID);
  });

  it('does not duplicate a coordinator error when an authoritative install failure is present', async () => {
    const [operations, setOperations] = createSignal<readonly typeof failedOperation[]>([]);
    const onCommand = vi.fn(async () => { setOperations([failedOperation]); });
    const failedOperation = {
      pluginID: metricsPlugin.pluginID,
      pluginInstanceID: metricsPlugin.officialCatalog.pluginInstanceID,
      observation: 'watching' as const,
      execution: {
        execution_id: 'release_install_metrics',
        plugin_instance_id: metricsPlugin.officialCatalog.pluginInstanceID,
        kind: 'operation' as const,
        status: 'failed' as const,
        cursor: 1,
        failure_code: 'PLUGIN_RELEASE_NETWORK',
        cancelable: false,
        created_at: '2026-08-05T08:00:00Z',
        updated_at: '2026-08-05T08:00:03Z',
        terminal_at: '2026-08-05T08:00:03Z',
      },
      progress: [],
      failure: { source: 'execution' as const, code: 'PLUGIN_RELEASE_NETWORK', stage: 'download' as const, retryable: true, recovery: 'retry_install' as const },
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [metricsPlugin] }}
        loading={false}
        installOperations={operations()}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    (mount.querySelector('[data-plugin-center-install="catalog:metrics"]') as HTMLButtonElement).click();
    await Promise.resolve();
    (document.querySelector('[data-plugin-install-review-confirm]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(onCommand).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('[data-plugin-install-execution]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-plugin-install-error]')).toHaveLength(0);
  });

  it('shows an incompatible-data recovery once and requires confirmation before deleting it', async () => {
    const onDiscardRetainedDataAndRetry = vi.fn(async () => undefined);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        selectedInventoryKey={metricsPlugin.inventoryKey}
        installOperations={[{
          pluginID: metricsPlugin.pluginID,
          pluginInstanceID: metricsPlugin.officialCatalog.pluginInstanceID,
          observation: 'watching',
          execution: {
            execution_id: 'release_install_metrics',
            plugin_instance_id: metricsPlugin.officialCatalog.pluginInstanceID,
            kind: 'operation',
            status: 'failed',
            cursor: 1,
            failure_code: 'PLUGIN_RETAINED_DATA_INCOMPATIBLE',
            cancelable: false,
            created_at: '2026-08-05T08:00:00Z',
            updated_at: '2026-08-05T08:00:03Z',
            terminal_at: '2026-08-05T08:00:03Z',
          },
          progress: [],
          failure: { source: 'execution', code: 'PLUGIN_RETAINED_DATA_INCOMPATIBLE', stage: 'install', retryable: false, recovery: 'erase_retained_data' },
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
    expect(document.querySelectorAll('[data-plugin-install-execution]')).toHaveLength(0);
    expect(onDiscardRetainedDataAndRetry).not.toHaveBeenCalled();

    (document.querySelector('[data-plugin-retained-data-confirm]') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onDiscardRetainedDataAndRetry).toHaveBeenCalledWith(metricsPlugin.officialCatalog.pluginInstanceID);
  });

  it('turns a same-session review-again action back into an exact confirmation', async () => {
    const onReviewOfficialInstall = vi.fn();
    const [operations, setOperations] = createSignal<readonly typeof failedOperation[]>([]);
    const onCommand = vi.fn(async () => { setOperations([failedOperation]); });
    const failedOperation = {
      pluginID: metricsPlugin.pluginID,
      pluginInstanceID: metricsPlugin.officialCatalog.pluginInstanceID,
      observation: 'failed' as const,
      execution: {
        execution_id: 'release_install_metrics',
        plugin_instance_id: metricsPlugin.officialCatalog.pluginInstanceID,
        kind: 'operation' as const,
        status: 'failed' as const,
        cursor: 1,
        failure_code: 'PLUGIN_RELEASE_NETWORK',
        cancelable: false,
        created_at: '2026-08-05T08:00:00Z',
        updated_at: '2026-08-05T08:00:03Z',
        terminal_at: '2026-08-05T08:00:03Z',
      },
      progress: [],
      failure: { source: 'execution' as const, code: 'PLUGIN_RELEASE_NETWORK', stage: 'download' as const, retryable: true, recovery: 'review_again' as const },
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [metricsPlugin] }}
        loading={false}
        installOperations={operations()}
        onReviewOfficialInstall={onReviewOfficialInstall}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    (mount.querySelector('[data-plugin-center-install="catalog:metrics"]') as HTMLButtonElement).click();
    await Promise.resolve();
    (document.querySelector('[data-plugin-install-review-confirm]') as HTMLButtonElement).click();
    await Promise.resolve();
    onReviewOfficialInstall.mockClear();
    (document.querySelector('[data-plugin-install-review-again]') as HTMLButtonElement).click();

    expect(onReviewOfficialInstall).toHaveBeenCalledWith(metricsPlugin.officialCatalog.pluginInstanceID);
    expect(document.querySelector('[data-plugin-install-review-confirm]')).not.toBeNull();
  });

  it('does not reopen a background install dialog after the user closes it', async () => {
    const [currentProjection, setCurrentProjection] = createSignal<PluginInventoryProjection>({ items: [metricsPlugin] });
    const [operations, setOperations] = createSignal<readonly any[]>([]);
    const onCommand = vi.fn(async () => {
      setOperations([{
        pluginID: metricsPlugin.pluginID,
        pluginInstanceID: metricsPlugin.officialCatalog.pluginInstanceID,
        observation: 'watching',
        execution: {
          execution_id: 'release_install_metrics',
          plugin_instance_id: metricsPlugin.officialCatalog.pluginInstanceID,
          kind: 'operation', status: 'running', cursor: 0, cancelable: false,
          created_at: '2026-08-05T08:00:00Z', updated_at: '2026-08-05T08:00:01Z',
        },
        progress: [],
      }]);
    });
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={currentProjection()}
        loading={false}
        installOperations={operations()}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    (mount.querySelector('[data-plugin-center-install="catalog:metrics"]') as HTMLButtonElement).click();
    await Promise.resolve();
    (document.querySelector('[data-plugin-install-review-confirm]') as HTMLButtonElement).click();
    await Promise.resolve();
    const dialog = document.querySelector('[data-plugin-install-review-dialog]')?.closest('[role="dialog"]') as HTMLElement;
    (dialog.querySelector('button') as HTMLButtonElement).click();
    setCurrentProjection({ items: [{
      ...metricsPlugin,
      inventoryKey: `instance:${metricsPlugin.officialCatalog.pluginInstanceID}`,
      pluginInstanceID: metricsPlugin.officialCatalog.pluginInstanceID,
      version: metricsPlugin.officialCatalog.latestVersion,
      managementRevision: 1,
      lifecycleState: 'enabled',
    }] });
    setOperations([]);
    await Promise.resolve();

    expect(document.querySelector('[data-plugin-install-review-dialog]')).toBeNull();
  });

  it('keeps the completion dialog on the current installed state and opens the plugin directly', async () => {
    const [currentProjection, setCurrentProjection] = createSignal<PluginInventoryProjection>({ items: [metricsPlugin] });
    const onCommand = vi.fn(async () => undefined);
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={currentProjection()}
        loading={false}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    (mount.querySelector('[data-plugin-center-install="catalog:metrics"]') as HTMLButtonElement).click();
    await Promise.resolve();
    (document.querySelector('[data-plugin-install-review-confirm]') as HTMLButtonElement).click();
    await Promise.resolve();
    const installed = {
      ...metricsPlugin,
      inventoryKey: `instance:${metricsPlugin.officialCatalog.pluginInstanceID}`,
      pluginInstanceID: metricsPlugin.officialCatalog.pluginInstanceID,
      version: metricsPlugin.officialCatalog.latestVersion,
      managementRevision: 7,
      lifecycleState: 'needs_attention' as const,
      attentionReason: 'permission_required' as const,
      defaultLaunchTarget: {
        pluginID: metricsPlugin.pluginID,
        pluginInstanceID: metricsPlugin.officialCatalog.pluginInstanceID,
        surfaceID: 'metrics.dashboard',
        expectedManagementRevision: 7,
        preferredPlacement: 'activity' as const,
      },
    };
    setCurrentProjection({ items: [installed] });
    await Promise.resolve();
    expect(document.querySelector('[data-plugin-install-review-dialog]')?.textContent).toContain('Needs attention');

    setCurrentProjection({ items: [{ ...installed, lifecycleState: 'enabled', attentionReason: undefined }] });
    await Promise.resolve();
    const dialog = document.querySelector('[data-plugin-install-review-dialog]')?.closest('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Enabled');
    expect(dialog.textContent).not.toContain('Needs attention');
    expect(dialog.textContent?.match(/Installation complete\./g)).toHaveLength(1);

    (dialog.querySelector('[data-plugin-install-open]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'open_surface',
      pluginInstanceID: metricsPlugin.officialCatalog.pluginInstanceID,
      surfaceID: 'metrics.dashboard',
    }), expect.any(AbortSignal));
    expect(document.querySelector('[data-plugin-install-review-dialog]')).toBeNull();
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
          pluginID: metricsPlugin.pluginID,
          pluginInstanceID: metricsPlugin.officialCatalog.pluginInstanceID,
          observation: 'watching',
          execution: {
            execution_id: 'release_install_metrics',
            plugin_instance_id: metricsPlugin.officialCatalog.pluginInstanceID,
            kind: 'operation',
            status: 'failed',
            cursor: 1,
            failure_code: 'PLUGIN_RELEASE_TIMEOUT',
            cancelable: false,
            created_at: '2026-08-05T08:00:00Z',
            updated_at: '2026-08-05T08:00:30Z',
            terminal_at: '2026-08-05T08:00:30Z',
          },
          progress: [],
          failure: { source: 'execution', code: 'PLUGIN_RELEASE_TIMEOUT', stage: 'download', retryable: true, recovery: 'retry_install' },
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
    expect(onRetryInstall).toHaveBeenCalledWith(metricsPlugin.officialCatalog.pluginInstanceID);
  });

  it('keeps a committed installation distinct when inventory refresh needs retrying', () => {
    const onRetryInstall = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [metricsPlugin] }}
        loading={false}
        installOperations={[{
          pluginID: metricsPlugin.pluginID,
          pluginInstanceID: metricsPlugin.officialCatalog.pluginInstanceID,
          observation: 'refresh_failed',
          execution: {
            execution_id: 'release_install_metrics',
            plugin_instance_id: metricsPlugin.officialCatalog.pluginInstanceID,
            kind: 'operation',
            status: 'completed',
            cursor: 1,
            cancelable: false,
            created_at: '2026-08-05T08:00:00Z',
            updated_at: '2026-08-05T08:00:03Z',
            terminal_at: '2026-08-05T08:00:03Z',
          },
          progress: [],
          failure: { source: 'inventory', code: 'PLUGIN_INVENTORY_REFRESH_FAILED', retryable: true, recovery: 'refresh_inventory' },
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
    expect(onRetryInstall).toHaveBeenCalledWith(metricsPlugin.officialCatalog.pluginInstanceID);
  });

  it('lets read-only users open surfaces while keeping management actions disabled', async () => {
    const onCommand = vi.fn();
    const installedProjection: PluginInventoryProjection = {
      items: [
        {
          ...metricsPlugin,
          pluginInstanceID: 'plugininst_metrics',
          version: '2.0.0',
          managementRevision: 7,
          canDisable: true,
          lifecycleState: 'enabled',
          defaultLaunchTarget: {
            pluginID: 'com.example.metrics',
            pluginInstanceID: 'plugininst_metrics',
            surfaceID: 'metrics.dashboard',
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
        ...metricsPlugin,
        pluginInstanceID: 'plugininst_metrics',
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
        projection={metricsPermissionProjection()}
        loading={false}
        error={null}
        selectedInventoryKey="catalog:metrics"
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const permissionSwitch = mount.querySelector('[data-plugin-permission="metrics.read"] [role="switch"]') as HTMLButtonElement;
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
      pluginInstanceID: 'plugininst_metrics',
      permissionID: 'metrics.read',
      expectedPolicyRevision: 3,
      expectedManagementRevision: 7,
      expectedRevokeEpoch: 2,
    }, expect.any(AbortSignal));
    expect(permissionSwitch.getAttribute('aria-checked')).toBe('false');
  });

  it('names the actual plugin in permission disclosure and confirmation', async () => {
    const externalProjection = metricsPermissionProjection();
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
    (mount.querySelector('[data-plugin-permission="metrics.read"] [role="switch"]') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.textContent).toContain('Grant Read data to Example Toolbox?');
    expect(document.body.textContent).not.toContain('Grant Read data to Metrics?');
  });

  it('distinguishes generic permission IDs in switches and confirmation', async () => {
    const externalProjection = metricsPermissionProjection();
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
    const policyProjection = metricsPermissionProjection();
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
        selectedInventoryKey="catalog:metrics"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const permission = mount.querySelector<HTMLElement>('[data-plugin-permission="metrics.read"]')!;
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
        projection={metricsPermissionProjection()}
        loading={false}
        error={null}
        selectedInventoryKey="catalog:metrics"
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const permissionSwitch = mount.querySelector('[data-plugin-permission="metrics.read"] [role="switch"]') as HTMLButtonElement;
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
          ...metricsPlugin,
          pluginInstanceID: 'plugininst_metrics',
          version: '2.0.0',
          managementRevision: 11,
          lifecycleState: 'enabled',
          defaultLaunchTarget: {
            pluginID: 'com.example.metrics',
            pluginInstanceID: 'plugininst_metrics',
            surfaceID: 'metrics.dashboard',
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
      pluginID: 'com.example.metrics',
      pluginInstanceID: 'plugininst_metrics',
      surfaceID: 'metrics.dashboard',
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
        plugin_instance_id: 'plugininst_metrics',
        expected_management_revision: 13,
      },
      plugin_id: metricsPlugin.pluginID,
      publisher_id: metricsPlugin.officialCatalog.publisherID,
      version: '2.0.0',
    }));
    const updatesProjection: PluginInventoryProjection = {
      items: [
        {
          ...metricsPlugin,
          pluginInstanceID: 'plugininst_metrics',
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
        plugin_instance_id: 'plugininst_metrics',
        expected_management_revision: 13,
      },
    }, expect.any(AbortSignal));
    await vi.waitFor(() => expect(document.querySelector('[data-plugin-update-submit]')).not.toBeNull());
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('refreshes the market before inspecting the current official release source', async () => {
    const inspection = externalInspectionForCenter();
    const oldItem = {
      ...metricsPlugin,
      pluginInstanceID: 'plugininst_metrics',
      version: '1.0.6',
      managementRevision: 13,
      lifecycleState: 'update_available' as const,
      officialCatalog: {
        ...metricsPlugin.officialCatalog,
        marketGeneration: 6,
        distribution: {
          ...metricsPlugin.officialCatalog.distribution,
          installSource: {
            sourceKind: 'package_url' as const,
            url: 'https://plugins.example.com/weather-1.0.6.redevplugin',
          },
        },
      },
    };
    const currentItem = {
      ...oldItem,
      officialCatalog: {
        ...oldItem.officialCatalog,
        latestVersion: '1.0.7',
        stableVersion: '1.0.7',
        marketGeneration: 7,
        distribution: {
          ...oldItem.officialCatalog.distribution,
          installSource: {
            sourceKind: 'package_url' as const,
            url: 'https://plugins.example.com/weather-1.0.7.redevplugin',
          },
        },
      },
    };
    const [currentProjection, setCurrentProjection] = createSignal<PluginInventoryProjection>({ items: [oldItem] });
    const order: string[] = [];
    const onRefresh = vi.fn(async () => {
      order.push('refresh');
      setCurrentProjection({ items: [currentItem] });
    });
    const onInspectExternal = vi.fn(async () => {
      order.push('inspect');
      return {
        ...inspection,
        intent: {
          action: 'update' as const,
          plugin_instance_id: 'plugininst_metrics',
          expected_management_revision: 13,
        },
        plugin_id: metricsPlugin.pluginID,
        publisher_id: metricsPlugin.officialCatalog.publisherID,
        version: '1.0.7',
      };
    });
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={currentProjection()}
        loading={false}
        error={null}
        onCommand={vi.fn()}
        onInspectExternal={onInspectExternal}
        onRefresh={onRefresh}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    openInventoryDetails(mount);
    (mount.querySelector('[data-plugin-action="update-external"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(onInspectExternal).toHaveBeenCalledOnce());
    expect(order).toEqual(['refresh', 'inspect']);
    expect(onInspectExternal).toHaveBeenCalledWith({
      sourceKind: 'package_url',
      url: 'https://plugins.example.com/weather-1.0.7.redevplugin',
      intent: {
        action: 'update',
        plugin_instance_id: 'plugininst_metrics',
        expected_management_revision: 13,
      },
    }, expect.any(AbortSignal));
  });

  it('shows a retryable catalog error without inspecting a cached official source', async () => {
    const updatesProjection: PluginInventoryProjection = {
      items: [{
        ...metricsPlugin,
        pluginInstanceID: 'plugininst_metrics',
        version: '1.9.0',
        managementRevision: 13,
        lifecycleState: 'update_available',
      }],
    };
    const onRefresh = vi.fn()
      .mockRejectedValueOnce(new Error('market offline'))
      .mockResolvedValue(undefined);
    const onInspectExternal = vi.fn(async () => ({
      ...externalInspectionForCenter(),
      intent: {
        action: 'update' as const,
        plugin_instance_id: 'plugininst_metrics',
        expected_management_revision: 13,
      },
      plugin_id: metricsPlugin.pluginID,
      publisher_id: metricsPlugin.officialCatalog.publisherID,
      version: '2.0.0',
    }));
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={updatesProjection}
        loading={false}
        error={null}
        onCommand={vi.fn()}
        onInspectExternal={onInspectExternal}
        onRefresh={onRefresh}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    openInventoryDetails(mount);
    (mount.querySelector('[data-plugin-action="update-external"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[data-plugin-update-retry]')).not.toBeNull());
    expect(document.querySelector('[data-plugin-update-dialog]')?.textContent).toContain('plugin catalog is unavailable');
    expect(onInspectExternal).not.toHaveBeenCalled();

    (document.querySelector('[data-plugin-update-retry]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(onInspectExternal).toHaveBeenCalledOnce());
    expect(onRefresh).toHaveBeenCalledTimes(2);
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
        plugin_instance_id: 'plugininst_metrics',
        expected_management_revision: 13,
      },
      plugin_id: metricsPlugin.pluginID,
      publisher_id: metricsPlugin.officialCatalog.publisherID,
      version: '2.0.0',
      signature_assessment: { ...inspection.signature_assessment, state: 'verified' as const },
    }));
    const updatesProjection: PluginInventoryProjection = {
      items: [{
        ...metricsPlugin,
        pluginInstanceID: 'plugininst_metrics',
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
      pluginID: metricsPlugin.pluginID,
      pluginInstanceID: 'plugininst_metrics',
      targetVersion: '2.0.0',
      expectedManagementRevision: 13,
    }, expect.any(AbortSignal));
    expect(onCommitExternal).not.toHaveBeenCalled();
  });

  it('does not offer enable for plugins that need trust attention or updates', () => {
    const needsAttentionProjection: PluginInventoryProjection = {
      items: [
        {
          ...metricsPlugin,
          pluginInstanceID: 'plugininst_metrics',
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
          ...metricsPlugin,
          pluginInstanceID: 'plugininst_metrics',
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
    const enabledProjection = metricsPermissionProjection(true);
    enabledProjection.items[0] = {
      ...enabledProjection.items[0],
      defaultLaunchTarget: {
        pluginID: 'com.example.metrics',
        pluginInstanceID: 'plugininst_metrics',
        surfaceID: 'metrics.dashboard',
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

    const open = mount.querySelector<HTMLButtonElement>('[data-plugin-center-card-primary="catalog:metrics"]');
    expect(open?.textContent).toContain('Open');
    expect(open?.disabled).toBe(true);
  });

  it('keeps Host-authorized actions available while presenting recovery status', async () => {
    const onCommand = vi.fn();
    const enabledProjection = metricsPermissionProjection(true);
    const metrics = {
      ...enabledProjection.items[0],
      defaultLaunchTarget: {
        pluginID: 'com.example.metrics',
        pluginInstanceID: 'plugininst_metrics',
        surfaceID: 'metrics.dashboard',
        preferredPlacement: 'activity',
        expectedManagementRevision: 7,
      },
    } as const;
    const database = {
      ...metrics,
      inventoryKey: 'catalog:database',
      pluginID: 'com.example.database',
      pluginInstanceID: 'plugininst_database',
      displayName: 'Database Tools',
      defaultLaunchTarget: {
        ...metrics.defaultLaunchTarget,
        pluginID: 'com.example.database',
        pluginInstanceID: 'plugininst_database',
        surfaceID: 'database.dashboard',
      },
      officialCatalog: undefined,
    } as const;
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [metrics, database] }}
        loading={false}
        error={null}
        canManagePlugins
        canOpenPluginSurfaces
        runtimeRecoveryByInstanceID={{
          plugininst_metrics: { state: 'ready' },
          plugininst_database: { state: 'recovering' },
        }}
        onRetryRuntimeRecovery={vi.fn()}
        onRefresh={vi.fn()}
        onCommand={onCommand}
      />
    ), mount);

    const readyOpen = mount.querySelector<HTMLButtonElement>('[data-plugin-center-card-primary="catalog:metrics"]');
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
      pluginInstanceID: 'plugininst_metrics',
    });
    expect(onCommand.mock.calls[1]?.[0]).toMatchObject({
      type: 'open_surface',
      pluginInstanceID: 'plugininst_database',
    });
  });

  it('presents typed revoked recovery guidance without suggesting a blind retry', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const enabledProjection = metricsPermissionProjection(true);
    enabledProjection.items[0] = {
      ...enabledProjection.items[0],
      defaultLaunchTarget: {
        pluginID: 'com.example.metrics',
        pluginInstanceID: 'plugininst_metrics',
        surfaceID: 'metrics.dashboard',
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
    expect(mount.querySelector<HTMLButtonElement>('[data-plugin-center-card-primary="catalog:metrics"]')?.disabled).toBe(true);
  });

  it('presents a bounded recovery timeout with one explicit retry and keeps Open disabled', () => {
    const onRetryRuntimeRecovery = vi.fn();
    const enabledProjection = metricsPermissionProjection(true);
    enabledProjection.items[0] = {
      ...enabledProjection.items[0],
      defaultLaunchTarget: {
        pluginID: 'com.example.metrics',
        pluginInstanceID: 'plugininst_metrics',
        surfaceID: 'metrics.dashboard',
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
    expect(mount.querySelector<HTMLButtonElement>('[data-plugin-center-card-primary="catalog:metrics"]')?.disabled).toBe(true);
  });

  it('explains that plugin surfaces remain unavailable while runtime recovery is active', () => {
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={metricsPermissionProjection(true)}
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
    const staleProjection = metricsPermissionProjection(false);
    staleProjection.items[0] = {
      ...staleProjection.items[0],
      lifecycleState: 'enabled',
      defaultLaunchTarget: {
        pluginID: 'com.example.metrics',
        pluginInstanceID: 'plugininst_metrics',
        surfaceID: 'metrics.dashboard',
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
        ...metricsPlugin,
        pluginInstanceID: 'plugininst_metrics',
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
      pluginInstanceID: 'plugininst_metrics',
      expectedManagementRevision: 23,
      dataRetention: 'delete_data',
    }, expect.any(AbortSignal));
  });

  it('restores keep data as the safe default after cancelling an uninstall', async () => {
    const onCommand = vi.fn();
    const installedProjection: PluginInventoryProjection = {
      items: [{
        ...metricsPlugin,
        pluginInstanceID: 'plugininst_metrics',
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
      pluginInstanceID: 'plugininst_metrics',
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
        ...metricsPlugin,
        pluginInstanceID: 'plugininst_metrics',
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
      ...metricsPlugin,
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
      ...metricsPlugin,
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
      ...metricsPermissionProjection().items[0],
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
      ...metricsPermissionProjection().items[0],
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
      ...metricsPlugin,
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
