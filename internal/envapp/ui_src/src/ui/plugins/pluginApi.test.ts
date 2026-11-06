import { bindTestSessionHTTP } from '../../test/sessionHTTPFixture';
import {
  PluginPlatformRequestError,
  type PluginExecution,
  type PluginInspectedInstallOperation,
  type PluginPlatformClient,
} from '@floegence/redevplugin-ui';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { fetchLocalApi, fetchLocalApiJSONResponse } from '../services/localApi';
import { connectPluginMarketEventStream, createPluginLifecycleAPI, ExternalPackageInspectionTerminalError, loadPluginMarketDetail } from './pluginApi';
import { OFFICIAL_PLUGIN_CATALOG_SEED, OFFICIAL_PLUGIN_MARKET_SNAPSHOT } from './officialPluginCatalog.test-fixture';
import { EXAMPLE_PLUGIN_PACKAGE, exampleInspection } from './examplePluginPackage.test-fixture';
import type { ReDevPluginRecord } from './pluginTypes';

vi.mock('../services/localApi', () => ({
  fetchLocalApi: vi.fn(),
  fetchLocalApiJSON: vi.fn(),
  fetchLocalApiJSONResponse: vi.fn(),
  prepareLocalApiRequestInit: vi.fn(async (init: RequestInit) => init),
}));

const examplePlugin = OFFICIAL_PLUGIN_CATALOG_SEED[0];
function createClientHarness() {
  const mocks = {
    catalog: vi.fn(async (): Promise<{ plugins: ReDevPluginRecord[] }> => ({ plugins: [] })),
    listPermissions: vi.fn(async (): ReturnType<PluginPlatformClient['listPermissions']> => ({ permissions: [] })),
    listSecurityPolicies: vi.fn(async (): ReturnType<PluginPlatformClient['listSecurityPolicies']> => ({ security_policies: [] })),
    startInspectedInstall: vi.fn(async (_request: Parameters<PluginPlatformClient['startInspectedInstall']>[0]) => installReceipt()),
    getInspectedInstall: vi.fn(async () => installReceipt()),
    listInspectedInstalls: vi.fn(async (): Promise<{ operations: PluginInspectedInstallOperation[]; next_cursor: number }> => ({ operations: [], next_cursor: 0 })),
    inspectPluginUpdate: vi.fn(async () => exampleInspection()),
    listRepositoryPlugins: vi.fn(async () => []),
    setAutomaticUpdates: vi.fn(async () => generatedMetricsRecord),
    listExecutions: vi.fn(async () => ({ executions: [] as PluginExecution[] })),
    getExecution: vi.fn(async () => releaseInstallExecution()),
    listExecutionEvents: vi.fn(async () => ({ execution_id: 'release_install_4c9d48a3', events: [], cursor: 1 })),
    enablePlugin: vi.fn(async () => ({})),
    disablePlugin: vi.fn(async () => ({})),
    uninstallPlugin: vi.fn(async () => ({})),
    grantPermission: vi.fn(async () => ({})),
    revokePermission: vi.fn(async () => ({})),
    getPermissionRequirements: vi.fn(async ({ plugin_instance_id }: { plugin_instance_id: string }): ReturnType<PluginPlatformClient['getPermissionRequirements']> => ({
      plugin_instance_id,
      plugin_version: EXAMPLE_PLUGIN_PACKAGE.version,
      active_fingerprint: `sha256:${EXAMPLE_PLUGIN_PACKAGE.package_sha256}`,
      management_revision: 23,
      required_permissions: [],
      contracts: [],
    })),
    inspectExternalPackage: vi.fn(async () => ({})),
    inspectUploadedExternalPackage: vi.fn(async () => ({})),
    recoverEnabled: vi.fn(async (): ReturnType<PluginPlatformClient['recoverEnabled']> => ({ revision: 1, complete: true, results: [] })),
    retryRecovery: vi.fn(async () => ({ plugin_instance_id: examplePlugin.pluginInstanceID, active_fingerprint: generatedMetricsRecord.active_fingerprint, installed_at: generatedMetricsRecord.installed_at, management_revision: generatedMetricsRecord.management_revision, status: 'ready' as const })),
    listRetainedData: vi.fn(async () => ({ retained_data: [{
      plugin_instance_id: examplePlugin.pluginInstanceID,
      generation_id: 'gen-retained',
      state: 'retained' as const,
      revision: 4,
      shape_hash: 'a'.repeat(64),
    }] })),
    deleteRetainedData: vi.fn(async () => ({})),
  };
  return {
    mocks,
    lifecycle: createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient, OFFICIAL_PLUGIN_CATALOG_SEED,
    ),
  };
}

const generatedMetricsInstanceID = 'plugin_dea00daa09166c33302f92c9b090f62a';
const releaseInstallRequestID = '996224cb-c992-4fc3-b74a-9a100f306da4';

function releaseInstallExecution(
  overrides: Partial<PluginExecution> = {},
): PluginExecution {
  return {
    execution_id: 'release_install_4c9d48a3',
    plugin_instance_id: examplePlugin.pluginInstanceID,
    kind: 'operation',
    status: 'completed',
    cursor: 1,
    cancelable: false,
    created_at: '2026-08-05T08:00:00Z',
    updated_at: '2026-08-05T08:00:01Z',
    terminal_at: '2026-08-05T08:00:01Z',
    ...overrides,
  };
}
const generatedMetricsRecord: ReDevPluginRecord = {
  plugin_instance_id: generatedMetricsInstanceID,
  publisher_id: examplePlugin.publisherID,
  plugin_id: examplePlugin.pluginID,
  version: EXAMPLE_PLUGIN_PACKAGE.version,
  active_fingerprint: `sha256:${EXAMPLE_PLUGIN_PACKAGE.package_sha256}`,
  package_hash: `sha256:${EXAMPLE_PLUGIN_PACKAGE.package_sha256}`,
  manifest_hash: `sha256:${EXAMPLE_PLUGIN_PACKAGE.manifest_sha256}`,
  entries_hash: `sha256:${EXAMPLE_PLUGIN_PACKAGE.entries_sha256}`,
  source_provenance: { kind: 'github_repository', repository_id: '1289352675', release_id: '21', asset_id: '22', repository_url: 'https://github.com/example/example-plugins', owner: 'example', repository: 'example-plugins', resolved_commit_sha: 'a'.repeat(40), release_tag: 'metrics-v4.4.9', asset_name: 'metrics-4.4.9.redevplugin', package_sha256: `sha256:${EXAMPLE_PLUGIN_PACKAGE.package_sha256}`, resolved_at: '2026-11-05T00:00:00Z' },
  automatic_updates: false,
  enable_state: 'enabled',
  policy_revision: 3,
  management_revision: 23,
  revoke_epoch: 0,
  manifest: {
    schema_version: 'redevplugin.manifest.v9',
    publisher: { publisher_id: examplePlugin.publisherID, display_name: examplePlugin.publisher },
    plugin: {
      plugin_id: examplePlugin.pluginID, display_name: examplePlugin.displayName,
      version: EXAMPLE_PLUGIN_PACKAGE.version,
    },
    api: { major: 1 },
    permissions: [],
    presentation: { locales: { default: 'en-US' } },
    surfaces: [{
      surface_id: 'metrics.dashboard', kind: 'view', intent: 'primary',
      label: examplePlugin.displayName, entry: 'ui/index.html', web: { root: 'ui', spa: false },
    }],
    workers: [],
    methods: [],
  },
  package_entries: [],
  installed_at: '2026-07-04T10:00:00Z',
  updated_at: '2026-07-04T10:01:00Z',
};

describe('plugin lifecycle client integration', () => {
  it('keeps the verified installed icon URL in the first inventory projection', async () => {
    const { mocks } = createClientHarness();
    const iconDigest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const iconPath = 'ui/assets/metrics.png';
    mocks.catalog.mockResolvedValue({
      plugins: [{
        ...generatedMetricsRecord,
        manifest: {
          ...generatedMetricsRecord.manifest,
          presentation: { ...generatedMetricsRecord.manifest.presentation, icon: { path: iconPath } },
        },
        package_entries: [{
          path: iconPath,
          size: 123,
          sha256: iconDigest,
          mode: '0644',
          content_type: 'image/png',
        }],
      }],
    });
    const lifecycle = createPluginLifecycleAPI(mocks as unknown as PluginPlatformClient, OFFICIAL_PLUGIN_CATALOG_SEED);

    const projection = await lifecycle.loadInventoryProjection();

    expect(projection.items.find((item) => item.pluginInstanceID === generatedMetricsInstanceID)?.iconURL)
      .toBe(`/_redevplugin/api/plugins/${encodeURIComponent(generatedMetricsInstanceID)}/icon/${iconDigest.slice(7)}`);
  });

  it('changes the icon URL when the installed package digest changes', async () => {
    const { mocks } = createClientHarness();
    const firstDigest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const secondDigest = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const iconPath = 'ui/assets/metrics.png';
    const record = {
      ...generatedMetricsRecord,
      manifest: {
        ...generatedMetricsRecord.manifest,
        presentation: { ...generatedMetricsRecord.manifest.presentation, icon: { path: iconPath } },
      },
      package_entries: [{
        path: iconPath,
        size: 123,
        sha256: firstDigest,
        mode: '0644',
        content_type: 'image/png' as const,
      }],
    };
    mocks.catalog.mockResolvedValue({ plugins: [record] });
    const lifecycle = createPluginLifecycleAPI(mocks as unknown as PluginPlatformClient, OFFICIAL_PLUGIN_CATALOG_SEED);
    const firstProjection = await lifecycle.loadInventoryProjection();
    mocks.catalog.mockResolvedValue({
      plugins: [{
        ...record,
        package_entries: [{
          path: iconPath,
          size: 123,
          sha256: secondDigest,
          mode: '0644',
          content_type: 'image/png',
        }],
      }],
    });
    const secondProjection = await lifecycle.loadInventoryProjection();

    expect(firstProjection.items.find((item) => item.pluginInstanceID === generatedMetricsInstanceID)?.iconURL)
      .toContain(firstDigest.slice(7));
    expect(secondProjection.items.find((item) => item.pluginInstanceID === generatedMetricsInstanceID)?.iconURL)
      .toContain(secondDigest.slice(7));
  });

  it('keeps an enabled registry record visible when lifecycle metadata reads fail', async () => {
    const { mocks, lifecycle } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedMetricsRecord] });
    mocks.listPermissions.mockRejectedValue(new Error('plugin session lifecycle is unavailable'));
    mocks.listSecurityPolicies.mockRejectedValue(new Error('plugin session lifecycle is unavailable'));
    mocks.getPermissionRequirements.mockRejectedValue(new Error('plugin session lifecycle is unavailable'));

    const projection = await lifecycle.loadInventoryProjection();
    const installed = projection.items.find((item) => item.pluginInstanceID === generatedMetricsInstanceID);
    expect(installed).toMatchObject({
      pluginInstanceID: generatedMetricsInstanceID,
      lifecycleState: 'needs_attention',
      attentionReason: 'diagnostic_error',
    });
    expect(installed?.lifecycleState).not.toBe('not_installed');
  });

  it('fails closed when the Host action state is absent', async () => {
    const { mocks, lifecycle } = createClientHarness();
    mocks.catalog.mockResolvedValue({
      plugins: [{
        ...generatedMetricsRecord,
      }],
    });
    mocks.listPermissions.mockResolvedValue({
      permissions: [{
        plugin_instance_id: generatedMetricsInstanceID,
        permission_id: 'metrics.read',
        effect: 'grant',
        granted_at: '2026-08-12T16:13:36Z',
      }],
    });
    mocks.listSecurityPolicies.mockResolvedValue({
      security_policies: [{
        plugin_instance_id: generatedMetricsInstanceID,
        allowed_permissions: ['metrics.read'],
        denied_methods: [],
        policy_revision: 3,
        management_revision: 23,
        revoke_epoch: 0,
        updated_at: '2026-08-12T16:13:36Z',
      }],
    });
    mocks.getPermissionRequirements.mockResolvedValue({
      plugin_instance_id: generatedMetricsInstanceID,
      plugin_version: EXAMPLE_PLUGIN_PACKAGE.version,
      active_fingerprint: `sha256:${EXAMPLE_PLUGIN_PACKAGE.package_sha256}`,
      management_revision: 23,
      required_permissions: ['metrics.read'],
      contracts: [],
    });

    const projection = await lifecycle.loadInventoryProjection();
    expect(projection.items).toEqual([
      expect.objectContaining({
        pluginInstanceID: generatedMetricsInstanceID,
        lifecycleState: 'enabled',
        defaultLaunchTarget: undefined,
      }),
    ]);
    expect(mocks.listPermissions).toHaveBeenCalledOnce();
    expect(mocks.listSecurityPolicies).toHaveBeenCalledOnce();
    expect(mocks.getPermissionRequirements).toHaveBeenCalledOnce();
  });

  it('preserves the market detail generation from the local proxy envelope', async () => {
    vi.mocked(fetchLocalApiJSONResponse).mockResolvedValueOnce({
      data: { plugin_id: 'com.example.plugin', presentation: { default_locale: 'en-US', locales: [] } },
      meta: { generation: 41 },
      headers: new Headers(),
      status: 200,
    });

    await expect(loadPluginMarketDetail('com.example.plugin', 41)).resolves.toMatchObject({
      plugin_id: 'com.example.plugin',
      generation: 41,
    });
    expect(fetchLocalApiJSONResponse).toHaveBeenCalledWith(
      '/_redeven_proxy/api/plugins/market/plugins/com.example.plugin?generation=41',
      expect.anything(),
    );
  });

  it('loads the official catalog from the frozen same-origin market snapshot', async () => {
    const { mocks } = createClientHarness();
    const loadMarket = vi.fn(async () => OFFICIAL_PLUGIN_MARKET_SNAPSHOT);
    const lifecycle = createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient,
      undefined,
      loadMarket,
    );

    await expect(lifecycle.loadCachedMarketCatalog()).resolves.toEqual({
      generation: OFFICIAL_PLUGIN_MARKET_SNAPSHOT.generation,
      changed: true,
      stale: false,
    });
    await expect(lifecycle.loadInventoryProjection()).resolves.toMatchObject({
      marketUnavailable: false,
      items: [expect.objectContaining({
        pluginID: 'github.repo.1289352675.metrics',
        lifecycleState: 'not_installed',
        officialCatalog: expect.objectContaining({ latestVersion: '4.4.9' }),
      })],
    });
    expect(loadMarket).toHaveBeenCalledOnce();
  });

  it('refreshes the market asynchronously without blocking the installed inventory', async () => {
    const { mocks } = createClientHarness();
    let resolveMarket!: (snapshot: typeof OFFICIAL_PLUGIN_MARKET_SNAPSHOT) => void;
    const refreshMarket = vi.fn(() => new Promise<typeof OFFICIAL_PLUGIN_MARKET_SNAPSHOT>((resolve) => {
      resolveMarket = resolve;
    }));
    const lifecycle = createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient,
      undefined,
      async () => { throw new Error('cache unavailable'); },
      refreshMarket,
    );

    await expect(lifecycle.loadInventoryProjection()).resolves.toMatchObject({
      items: [],
      marketUnavailable: false,
    });
    const refresh = lifecycle.refreshMarketCatalog();
    expect(refreshMarket).toHaveBeenCalledOnce();
    await expect(lifecycle.loadInventoryProjection()).resolves.toMatchObject({
      items: [],
      marketUnavailable: false,
    });

    resolveMarket(OFFICIAL_PLUGIN_MARKET_SNAPSHOT);
    await expect(refresh).resolves.toEqual({ generation: OFFICIAL_PLUGIN_MARKET_SNAPSHOT.generation, changed: true, stale: false });
    await expect(lifecycle.loadInventoryProjection()).resolves.toMatchObject({
      items: [expect.objectContaining({
        pluginID: 'github.repo.1289352675.metrics',
        officialCatalog: expect.objectContaining({ latestVersion: '4.4.9' }),
      })],
    });
  });

  it('allows a ten-second backend refresh without the former five-second UI timeout', async () => {
    vi.useFakeTimers();
    try {
      const { mocks } = createClientHarness();
      const lifecycle = createPluginLifecycleAPI(
        mocks as unknown as PluginPlatformClient,
        undefined,
        async () => { throw new Error('cache unavailable'); },
        () => new Promise((resolve) => {
          globalThis.setTimeout(() => resolve(OFFICIAL_PLUGIN_MARKET_SNAPSHOT), 10_000);
        }),
      );

      const refresh = lifecycle.refreshMarketCatalog();
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(refresh).resolves.toEqual({
        generation: OFFICIAL_PLUGIN_MARKET_SNAPSHOT.generation,
        changed: true,
        stale: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks an empty stale cache unavailable so the UI can offer a retry', async () => {
    const { mocks } = createClientHarness();
    const staleSnapshot = { ...OFFICIAL_PLUGIN_MARKET_SNAPSHOT, plugins: [], stale: true, source: 'cache' as const };
    const lifecycle = createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient,
      undefined,
      async () => { throw new Error('cache unavailable'); },
      async () => staleSnapshot,
    );

    await expect(lifecycle.refreshMarketCatalog()).rejects.toThrow('stale cached data');
    await expect(lifecycle.loadInventoryProjection()).resolves.toMatchObject({
      marketUnavailable: true,
      items: [],
    });
  });

  it('keeps stale catalog entries visible without treating them as a current update check', async () => {
    const { mocks } = createClientHarness();
    const staleSnapshot = { ...OFFICIAL_PLUGIN_MARKET_SNAPSHOT, stale: true, source: 'cache' as const };
    const lifecycle = createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient,
      undefined,
      async () => staleSnapshot,
      async () => staleSnapshot,
    );

    await expect(lifecycle.loadCachedMarketCatalog()).resolves.toEqual({
      generation: OFFICIAL_PLUGIN_MARKET_SNAPSHOT.generation,
      changed: true,
      stale: true,
    });
    await expect(lifecycle.refreshMarketCatalog()).rejects.toThrow('stale cached data');
    await expect(lifecycle.loadInventoryProjection()).resolves.toMatchObject({
      marketUnavailable: false,
      items: [expect.objectContaining({
        pluginID: 'github.repo.1289352675.metrics',
        officialCatalog: expect.objectContaining({ latestVersion: '4.4.9' }),
      })],
    });
  });

  it('parses background market events from the authenticated local stream', async () => {
    vi.mocked(fetchLocalApi).mockResolvedValueOnce(new Response([
      ': keepalive',
      '',
      'event: message',
      'data: {"seq":7,"state":"ready","generation":41,"stale":false,"checked_at":"2026-09-03T01:00:00Z"}',
      '',
      '',
    ].join('\r\n'), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));
    const onEvent = vi.fn();
    const signal = new AbortController().signal;

    await connectPluginMarketEventStream({ afterSeq: 6, signal, onEvent });

    expect(fetchLocalApi).toHaveBeenCalledWith(
      '/_redeven_proxy/api/plugins/market/catalog/events?after_seq=6',
      expect.objectContaining({ method: 'GET', signal }),
    );
    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      seq: 7,
      state: 'ready',
      generation: 41,
      stale: false,
    }));
  });

  it('rejects invalid market stream events without mutating catalog state', async () => {
    vi.mocked(fetchLocalApi).mockResolvedValueOnce(new Response(
      'data: {"seq":0,"state":"ready","generation":41,"stale":false}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));

    await expect(connectPluginMarketEventStream({
      afterSeq: 0,
      signal: new AbortController().signal,
      onEvent: vi.fn(),
    })).rejects.toThrow('invalid event');
  });

  it('projects installed plugins without waiting for the market snapshot', async () => {
    const { mocks } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedMetricsRecord] });
    const lifecycle = createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient,
      undefined,
      async () => { throw new Error('market unavailable'); },
    );

    await expect(lifecycle.loadInventoryProjection()).resolves.toMatchObject({
      marketUnavailable: false,
      items: [expect.objectContaining({
        pluginInstanceID: generatedMetricsInstanceID,
        pluginID: 'github.repo.1289352675.metrics',
      })],
    });
  });

  it('projects installed plugins without waiting for an unresponsive market snapshot', async () => {
    vi.useFakeTimers();
    const { mocks } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedMetricsRecord] });
    const lifecycle = createPluginLifecycleAPI(
      mocks as unknown as PluginPlatformClient,
      undefined,
      () => new Promise(() => {}),
    );

    const loading = lifecycle.loadInventoryProjection();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(loading).resolves.toMatchObject({
      marketUnavailable: false,
      items: [expect.objectContaining({
        pluginInstanceID: generatedMetricsInstanceID,
        pluginID: 'github.repo.1289352675.metrics',
      })],
    });
    vi.useRealTimers();
  });

  it('loads inventory exclusively through the platform catalog client', async () => {
    const { lifecycle, mocks } = createClientHarness();

    await expect(lifecycle.listInstalledPlugins()).resolves.toEqual([]);
    expect(mocks.catalog).toHaveBeenCalledOnce();
    expect(mocks.catalog).toHaveBeenCalledWith({});
  });

  it('forwards the exact released recovery installation identity unchanged', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const snapshot = { revision: 1, complete: false, results: [{
      plugin_instance_id: generatedMetricsRecord.plugin_instance_id,
      active_fingerprint: generatedMetricsRecord.active_fingerprint,
      installed_at: generatedMetricsRecord.installed_at,
      management_revision: generatedMetricsRecord.management_revision,
      status: 'failed' as const, reason: 'unknown' as const, action: 'retry' as const,
    }] };
    mocks.recoverEnabled.mockResolvedValueOnce(snapshot);
    expect(await lifecycle.recoverEnabled()).toEqual(snapshot);
  });

  it('reads the Host-owned enabled plugin recovery snapshot', async () => {
    const { lifecycle, mocks } = createClientHarness();

    await expect(lifecycle.recoverEnabled()).resolves.toEqual({ revision: 1, complete: true, results: [] });
    expect(mocks.recoverEnabled).toHaveBeenCalledOnce();
    expect(mocks.recoverEnabled).toHaveBeenCalledWith({});
  });

  it('loads catalog before projecting grants, policies, and per-instance permission requirements', async () => {
    const { lifecycle, mocks } = createClientHarness();
    let releaseCatalog!: () => void;
    mocks.catalog.mockImplementation(() => new Promise((resolve) => {
      releaseCatalog = () => resolve({ plugins: [generatedMetricsRecord] });
    }));

    const loading = lifecycle.loadInventoryProjection();
    await Promise.resolve();

    expect(mocks.catalog).toHaveBeenCalledWith({});
    expect(mocks.listPermissions).not.toHaveBeenCalled();
    expect(mocks.listSecurityPolicies).not.toHaveBeenCalled();
    releaseCatalog();
    await expect(loading).resolves.toMatchObject({ items: expect.any(Array) });
    expect(mocks.listPermissions).toHaveBeenCalledWith(
      { active_only: true },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.listSecurityPolicies).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.getPermissionRequirements).toHaveBeenCalledWith(
      { plugin_instance_id: generatedMetricsInstanceID },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('keeps the installed record when permission requirements are unavailable', async () => {
    const { lifecycle, mocks } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedMetricsRecord] });
    mocks.getPermissionRequirements.mockRejectedValue(new Error('permission requirements unavailable'));

    await expect(lifecycle.loadInventoryProjection()).resolves.toMatchObject({
      items: [expect.objectContaining({
        pluginInstanceID: generatedMetricsInstanceID,
        lifecycleState: 'needs_attention',
        attentionReason: 'diagnostic_error',
      })],
    });
  });

  it('starts only the exact inspected package with a stable request id', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const inspection = exampleInspection();
    await lifecycle.startInspectedInstall(inspection, releaseInstallRequestID);
    expect(mocks.startInspectedInstall).toHaveBeenCalledExactlyOnceWith({ request_id: releaseInstallRequestID, inspection_id: inspection.inspection_id, expected_package_sha256: inspection.inspected_hashes.package_sha256 }, {});
  });

  it('shares a single submission for concurrent requests for the same inspection', async () => {
    const { lifecycle, mocks } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedMetricsRecord] });
    let finish!: (receipt: PluginInspectedInstallOperation) => void;
    mocks.startInspectedInstall.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const inspection = exampleInspection();
    const first = lifecycle.installExternalPackage(inspection);
    const second = lifecycle.installExternalPackage(inspection);
    expect(first).toBe(second);
    finish(installReceipt());
    await Promise.all([first, second]);
    expect(mocks.startInspectedInstall).toHaveBeenCalledTimes(1);
  });

  it('lists durable receipts until the explicit zero cursor', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const receipt = installReceipt();
    mocks.listInspectedInstalls.mockResolvedValueOnce({ operations: [receipt], next_cursor: 101 }).mockResolvedValueOnce({ operations: [], next_cursor: 0 });
    expect(await lifecycle.listInspectedInstalls()).toEqual([receipt]);
    expect(mocks.listInspectedInstalls).toHaveBeenNthCalledWith(1, { limit: 500, cursor: 0 }, {});
    expect(mocks.listInspectedInstalls).toHaveBeenNthCalledWith(2, { limit: 500, cursor: 101 }, {});
  });

  it('reconciles a lost submission response without submitting a second operation', async () => {
    const { lifecycle, mocks } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedMetricsRecord] });
    mocks.startInspectedInstall.mockRejectedValueOnce(new Error('lost response'));
    expect((await lifecycle.installExternalPackage(exampleInspection())).plugin).toBe(generatedMetricsRecord);
    expect(mocks.startInspectedInstall).toHaveBeenCalledTimes(1);
    expect(mocks.getInspectedInstall).toHaveBeenCalledTimes(1);
  });

  it('honors committed receipt outcome even when execution failed after commit', async () => {
    const { lifecycle, mocks } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedMetricsRecord] });
    const receipt = installReceipt(); receipt.execution.status = 'failed';
    mocks.startInspectedInstall.mockResolvedValue(receipt);
    expect((await lifecycle.installExternalPackage(exampleInspection())).operation.mutation_outcome).toBe('committed');
  });

  it('never replays an unknown durable outcome', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const receipt = installReceipt(); receipt.execution.status = 'orphaned'; receipt.mutation_outcome = 'unknown';
    mocks.startInspectedInstall.mockResolvedValue(receipt); mocks.getInspectedInstall.mockResolvedValue(receipt);
    const inspection = exampleInspection();
    await expect(lifecycle.installExternalPackage(inspection)).rejects.toMatchObject({ mutationOutcome: 'unknown' });
    await expect(lifecycle.installExternalPackage(inspection)).rejects.toMatchObject({ mutationOutcome: 'unknown' });
    expect(mocks.startInspectedInstall).toHaveBeenCalledTimes(1);
  });

  it('requires new review when the original absent request is definitively rejected', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const inspection = exampleInspection();
    const receipt = installReceipt(); receipt.execution.status = 'orphaned'; receipt.mutation_outcome = 'unknown';
    mocks.startInspectedInstall.mockResolvedValueOnce(receipt);
    await expect(lifecycle.installExternalPackage(inspection)).rejects.toMatchObject({ mutationOutcome: 'unknown' });
    mocks.getInspectedInstall.mockRejectedValueOnce(new PluginPlatformRequestError('PLUGIN_EXECUTION_NOT_FOUND', 'absent'));
    mocks.startInspectedInstall.mockRejectedValueOnce(new PluginPlatformRequestError('PLUGIN_INVALID_REQUEST', 'expired', {}, 'not_committed'));
    await expect(lifecycle.installExternalPackage(inspection)).rejects.toBeInstanceOf(ExternalPackageInspectionTerminalError);
    expect(mocks.startInspectedInstall.mock.calls[0]![0].request_id).toBe(mocks.startInspectedInstall.mock.calls[1]![0].request_id);
  });
  it('checks updates through the saved original source', async () => {
    const { lifecycle, mocks } = createClientHarness();
    await lifecycle.inspectExternalPackage({ sourceKind: 'installed_source', pluginInstanceID: 'instance-1', expectedManagementRevision: 17 });
    expect(mocks.inspectPluginUpdate).toHaveBeenCalledExactlyOnceWith({ plugin_instance_id: 'instance-1', expected_management_revision: 17 }, {});
  });

  it('requires fresh review when an unsubmitted inspection has expired', async () => {
    const { lifecycle, mocks } = createClientHarness();
    await expect(lifecycle.installExternalPackage(exampleInspection({ expires_at: '2000-01-01T00:00:00Z' })))
      .rejects.toBeInstanceOf(ExternalPackageInspectionTerminalError);
    expect(mocks.startInspectedInstall).not.toHaveBeenCalled();
  });

  it('returns the committed receipt when the inventory request fails', async () => {
    const { lifecycle, mocks } = createClientHarness();
    mocks.catalog.mockRejectedValueOnce(new Error('inventory unavailable'));
    const result = await lifecycle.installExternalPackage(exampleInspection());
    expect(result.operation.mutation_outcome).toBe('committed');
    expect(result.plugin).toBeUndefined();
    expect(mocks.startInspectedInstall).toHaveBeenCalledTimes(1);
  });

  it('requires fresh review after a terminal not-committed receipt', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const receipt = installReceipt();
    receipt.execution.status = 'failed';
    receipt.mutation_outcome = 'not_committed';
    mocks.startInspectedInstall.mockResolvedValueOnce(receipt);
    await expect(lifecycle.installExternalPackage(exampleInspection())).rejects.toBeInstanceOf(ExternalPackageInspectionTerminalError);
  });

  it('queries an admitted receipt after inspection expiry without resubmitting', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const inspection = exampleInspection();
    const receipt = installReceipt();
    receipt.execution.status = 'orphaned'; receipt.mutation_outcome = 'unknown';
    mocks.startInspectedInstall.mockResolvedValueOnce(receipt);
    await expect(lifecycle.installExternalPackage(inspection)).rejects.toMatchObject({ mutationOutcome: 'unknown' });
    mocks.catalog.mockResolvedValueOnce({ plugins: [generatedMetricsRecord] });
    const result = await lifecycle.installExternalPackage({ ...inspection, expires_at: '2000-01-01T00:00:00Z' });
    expect(result.operation.mutation_outcome).toBe('committed');
    expect(mocks.startInspectedInstall).toHaveBeenCalledTimes(1);
    expect(mocks.getInspectedInstall).toHaveBeenCalledTimes(1);
  });

  it('propagates management revisions through enable, disable, and uninstall mutations', async () => {
    const { lifecycle, mocks } = createClientHarness();

    await lifecycle.execute({
      type: 'enable',
      pluginInstanceID: examplePlugin.pluginInstanceID,
      expectedManagementRevision: 4,
    });
    await lifecycle.execute({
      type: 'disable',
      pluginInstanceID: examplePlugin.pluginInstanceID,
      expectedManagementRevision: 5,
    });
    await lifecycle.execute({
      type: 'uninstall',
      pluginInstanceID: examplePlugin.pluginInstanceID,
      expectedManagementRevision: 6,
      dataRetention: 'delete_data',
    });

    expect(mocks.enablePlugin).toHaveBeenCalledWith({
      plugin_instance_id: examplePlugin.pluginInstanceID,
      expected_management_revision: 4,
    }, {});
    expect(mocks.disablePlugin).toHaveBeenCalledWith({
      plugin_instance_id: examplePlugin.pluginInstanceID,
      expected_management_revision: 5,
      reason: 'user_disabled',
    }, {});
    expect(mocks.uninstallPlugin).toHaveBeenCalledWith({
      plugin_instance_id: examplePlugin.pluginInstanceID,
      expected_management_revision: 6,
      delete_data: true,
    }, {});
  });

  it('binds grant and revoke mutations to the exact authorization revisions', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const revisions = {
      expectedPolicyRevision: 11,
      expectedManagementRevision: 17,
      expectedRevokeEpoch: 4,
    };

    await lifecycle.execute({
      type: 'grant_permission',
      pluginInstanceID: examplePlugin.pluginInstanceID,
      permissionID: 'metrics.read',
      ...revisions,
    });
    await lifecycle.execute({
      type: 'revoke_permission',
      pluginInstanceID: examplePlugin.pluginInstanceID,
      permissionID: 'metrics.execute',
      ...revisions,
    });

    expect(mocks.grantPermission).toHaveBeenCalledWith({
      plugin_instance_id: examplePlugin.pluginInstanceID,
      permission_id: 'metrics.read',
      expected_policy_revision: 11,
      expected_management_revision: 17,
      expected_revoke_epoch: 4,
    }, {});
    expect(mocks.revokePermission).toHaveBeenCalledWith({
      plugin_instance_id: examplePlugin.pluginInstanceID,
      permission_id: 'metrics.execute',
      expected_policy_revision: 11,
      expected_management_revision: 17,
      expected_revoke_epoch: 4,
      reason: 'user_revoked',
    }, {});
  });

  it('maps package URL and GitHub selections to closed platform inspection requests', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const signal = new AbortController().signal;
    await lifecycle.inspectExternalPackage({
      sourceKind: 'package_url',
      url: 'https://plugins.example.com/toolbox.redevplugin',
      intent: { action: 'install' },
    }, { signal });
    await lifecycle.inspectExternalPackage({
      sourceKind: 'github_repository',
      url: 'https://github.com/example/toolbox',
      tag: ' v1.2.3 ',
      intent: {
        action: 'update',
        plugin_instance_id: 'plugini_external_12345678',
        expected_management_revision: 9,
      },
    }, { signal });

    expect(mocks.inspectExternalPackage).toHaveBeenNthCalledWith(1, {
      intent: { action: 'install' },
      source: { kind: 'package_url', url: 'https://plugins.example.com/toolbox.redevplugin' },
    }, { signal });
    expect(mocks.inspectExternalPackage).toHaveBeenNthCalledWith(2, {
      intent: {
        action: 'update',
        plugin_instance_id: 'plugini_external_12345678',
        expected_management_revision: 9,
      },
      source: { kind: 'github_repository', host: 'redeven', url: 'https://github.com/example/toolbox', tag: 'v1.2.3' },
    }, { signal });
  });

  it('passes uploaded packages through the dedicated binary inspection API', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const file = new File(['package'], 'toolbox.redevplugin', { type: 'application/vnd.redevplugin.package+zip' });
    const signal = new AbortController().signal;
    const intent = {
      action: 'update' as const,
      plugin_instance_id: 'plugini_external_12345678',
      expected_management_revision: 9,
    };

    await lifecycle.inspectExternalPackage({ sourceKind: 'package_upload', file, intent }, { signal });

    expect(mocks.inspectUploadedExternalPackage).toHaveBeenCalledWith(intent, file, { signal });
    expect(mocks.inspectExternalPackage).not.toHaveBeenCalled();
  });

  it('commits inspected updates without granting permissions', async () => {
    const { lifecycle, mocks } = createClientHarness();
    mocks.catalog.mockResolvedValue({ plugins: [generatedMetricsRecord] });
    const inspection = exampleInspection({ intent: { action: 'update', plugin_instance_id: generatedMetricsInstanceID, expected_management_revision: 9 } });
    await lifecycle.installExternalPackage(inspection);
    expect(mocks.grantPermission).not.toHaveBeenCalled();
    expect(mocks.enablePlugin).not.toHaveBeenCalled();
    expect(mocks.startInspectedInstall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ inspection_id: inspection.inspection_id, expected_package_sha256: inspection.inspected_hashes.package_sha256 }), {});
  });

});

let releaseTestTransport: (() => void) | undefined;
beforeEach(async () => {
  releaseTestTransport = await bindTestSessionHTTP((input, init) => fetchLocalApi(input instanceof Request ? input.url : String(input), init));
});
afterEach(() => releaseTestTransport?.());

it('forwards exact recovery targets, reviewed plans and cancellation through the released SDK', async () => {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const source = { plugin_instance_id: 'plugin_saved', generation_id: 'saved', state: 'retained' as const, revision: 3, shape_hash: 'a'.repeat(64) };
  const target = { ...source, plugin_instance_id: 'plugin_current', generation_id: 'current', state: 'active' as const };
  const inspection = { plan: { source, target, target_management_revision: 7, target_active_fingerprint: 'b'.repeat(64), retained_at: '2026-10-30T10:00:00Z' }, plan_hash: 'c'.repeat(64) };
  const result = { active: { ...target, generation_id: source.generation_id }, retained: { ...source, generation_id: target.generation_id }, management_revision: 8 };
  const client = {
    listRetainedData: vi.fn(async () => ({ retained_data: [source] })),
    inspectRetainedRecovery: vi.fn(async () => inspection),
    commitRetainedRecovery: vi.fn(async () => result),
    getRetainedRecoveryStatus: vi.fn(async () => ({ state: 'applied', result })),
  };
  const lifecycle = createPluginLifecycleAPI(client as unknown as PluginPlatformClient, []);
  expect(await lifecycle.listRecoverableData(target.plugin_instance_id, options)).toEqual({ retained_data: [source] });
  expect(client.listRetainedData).toHaveBeenCalledWith({ target_plugin_instance_id: target.plugin_instance_id }, options);
  const request = { source_plugin_instance_id: source.plugin_instance_id, target_plugin_instance_id: target.plugin_instance_id };
  expect(await lifecycle.inspectRetainedRecovery(request, options)).toBe(inspection);
  expect(client.inspectRetainedRecovery).toHaveBeenCalledWith(request, options);
  expect(await lifecycle.commitRetainedRecovery(inspection, options)).toBe(result);
  expect(client.commitRetainedRecovery).toHaveBeenCalledExactlyOnceWith(inspection, options);
  expect(await lifecycle.getRetainedRecoveryStatus(inspection, options)).toEqual({ state: 'applied', result });
  expect(client.getRetainedRecoveryStatus).toHaveBeenCalledWith(inspection, options);
  expect(client.commitRetainedRecovery).toHaveBeenCalledTimes(1);
});

function installReceipt(): PluginInspectedInstallOperation {
  return { execution: { ...releaseInstallExecution(), plugin_instance_id: generatedMetricsInstanceID }, request_id: releaseInstallRequestID, inspection_id: 'inspection-1', plugin_id: EXAMPLE_PLUGIN_PACKAGE.plugin_id, version: EXAMPLE_PLUGIN_PACKAGE.version, package_sha256: `sha256:${EXAMPLE_PLUGIN_PACKAGE.package_sha256}`, mutation_outcome: 'committed' };
}
