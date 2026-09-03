import {
  type PluginExecution,
  type PluginPlatformClient,
} from '@floegence/redevplugin-ui';
import { describe, expect, it, vi } from 'vitest';

import { fetchLocalApi, fetchLocalApiJSONResponse } from '../services/localApi';
import { connectPluginMarketEventStream, createPluginLifecycleAPI, loadPluginMarketDetail } from './pluginApi';
import { OFFICIAL_PLUGIN_CATALOG_SEED, OFFICIAL_PLUGIN_MARKET_SNAPSHOT } from './officialPluginCatalog.test-fixture';
import { EXAMPLE_PLUGIN_RELEASE_REF } from './examplePluginRelease.test-fixture';
import type { ReDevPluginRecord } from './pluginTypes';

vi.mock('../services/localApi', () => ({
  fetchLocalApi: vi.fn(),
  fetchLocalApiJSON: vi.fn(),
  fetchLocalApiJSONResponse: vi.fn(),
  prepareLocalApiRequestInit: vi.fn(async (init: RequestInit) => init),
}));

const examplePlugin = OFFICIAL_PLUGIN_CATALOG_SEED[0];
const officialInstallCommand = {
  type: 'install' as const,
  pluginID: examplePlugin.pluginID,
  source: 'official_catalog' as const,
  pluginInstanceID: examplePlugin.pluginInstanceID,
  releaseRef: examplePlugin.installPreview!.release_ref,
  releaseIdentityDigest: examplePlugin.installPreview!.release_identity_digest,
  manifestSHA256: examplePlugin.installPreview!.manifest_sha256,
  contractSetSHA256: examplePlugin.installPreview!.contract_set_sha256,
  summarySHA256: examplePlugin.installPreview!.summary_sha256,
};

function createClientHarness() {
  const mocks = {
    catalog: vi.fn(async (): Promise<{ plugins: ReDevPluginRecord[] }> => ({ plugins: [] })),
    listPermissions: vi.fn(async (): ReturnType<PluginPlatformClient['listPermissions']> => ({ permissions: [] })),
    listSecurityPolicies: vi.fn(async (): ReturnType<PluginPlatformClient['listSecurityPolicies']> => ({ security_policies: [] })),
    installReleaseRef: vi.fn(async () => ({})),
    startReleaseInstallExecution: vi.fn(async () => releaseInstallExecution()),
    listExecutions: vi.fn(async () => ({ executions: [] as PluginExecution[] })),
    listReleaseInstallExecutions: vi.fn(async (): ReturnType<PluginPlatformClient['listReleaseInstallExecutions']> => ({ executions: [] as PluginExecution[] })),
    getExecution: vi.fn(async () => releaseInstallExecution()),
    listExecutionEvents: vi.fn(async () => ({ execution_id: 'release_install_4c9d48a3', events: [], cursor: 1 })),
    updateReleaseRef: vi.fn(async () => ({})),
    enablePlugin: vi.fn(async () => ({})),
    disablePlugin: vi.fn(async () => ({})),
    uninstallPlugin: vi.fn(async () => ({})),
    grantPermission: vi.fn(async () => ({})),
    revokePermission: vi.fn(async () => ({})),
    getPermissionRequirements: vi.fn(async ({ plugin_instance_id }: { plugin_instance_id: string }): ReturnType<PluginPlatformClient['getPermissionRequirements']> => ({
      plugin_instance_id,
      plugin_version: EXAMPLE_PLUGIN_RELEASE_REF.version,
      active_fingerprint: EXAMPLE_PLUGIN_RELEASE_REF.expected_hashes.package_sha256,
      management_revision: 23,
      required_permissions: [],
      contracts: [],
    })),
    inspectReleasePackage: vi.fn(async () => ({
      plugin_instance_id: examplePlugin.pluginInstanceID,
      release_ref: EXAMPLE_PLUGIN_RELEASE_REF,
      inspected_hashes: EXAMPLE_PLUGIN_RELEASE_REF.expected_hashes,
      presentation: generatedMetricsRecord.presentation,
      presentation_sha256: 'sha256:' + 'a'.repeat(64),
      security_summary: {
        summary_sha256: 'sha256:' + 'b'.repeat(64),
        permissions: [{ permission_id: 'metrics.read', methods: ['metrics.list'], required: true, effects: ['read'] }],
        methods: [], capability_contracts: [], workers: [], network: [], storage: [], secret_refs: [], core_actions: [], intents: [], surfaces: [],
      },
    })),
    inspectExternalPackage: vi.fn(async () => ({})),
    inspectUploadedExternalPackage: vi.fn(async () => ({})),
    installInspectedPackage: vi.fn(async () => ({})),
    recoverEnabled: vi.fn(async () => ({ revision: 1, complete: true, results: [] })),
    retryRecovery: vi.fn(async () => ({ plugin_instance_id: examplePlugin.pluginInstanceID, status: 'ready' as const })),
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
  version: EXAMPLE_PLUGIN_RELEASE_REF.version,
  active_fingerprint: EXAMPLE_PLUGIN_RELEASE_REF.expected_hashes.package_sha256,
  package_hash: EXAMPLE_PLUGIN_RELEASE_REF.expected_hashes.package_sha256,
  manifest_hash: EXAMPLE_PLUGIN_RELEASE_REF.expected_hashes.manifest_sha256,
  entries_hash: EXAMPLE_PLUGIN_RELEASE_REF.expected_hashes.entries_sha256,
  trust_state: 'untrusted',
  trust_assessment: {
    trust_state: 'untrusted',
    verified_hashes: {
      package_sha256: EXAMPLE_PLUGIN_RELEASE_REF.expected_hashes.package_sha256,
      manifest_sha256: EXAMPLE_PLUGIN_RELEASE_REF.expected_hashes.manifest_sha256,
      entries_sha256: EXAMPLE_PLUGIN_RELEASE_REF.expected_hashes.entries_sha256,
    },
  },
  enable_state: 'enabled',
  policy_revision: 3,
  management_revision: 23,
  revoke_epoch: 0,
  manifest: {
    schema_version: 'redevplugin.manifest.v9',
    publisher: { publisher_id: examplePlugin.publisherID, display_name: examplePlugin.publisher },
    plugin: {
      plugin_id: examplePlugin.pluginID, display_name: examplePlugin.displayName,
      version: EXAMPLE_PLUGIN_RELEASE_REF.version,
    },
    api: { major: 1 },
    permissions: [],
    presentation: { locales: { default: 'en-US' } },
    surfaces: [{
      surface_id: 'metrics.dashboard', kind: 'view', intent: 'primary',
      label: examplePlugin.displayName, entry: 'ui/index.html',
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
        trust_state: 'verified',
        trust_assessment: {
          ...generatedMetricsRecord.trust_assessment,
          trust_state: 'verified',
        },
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
      plugin_version: EXAMPLE_PLUGIN_RELEASE_REF.version,
      active_fingerprint: EXAMPLE_PLUGIN_RELEASE_REF.expected_hashes.package_sha256,
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
        pluginID: 'com.example.metrics',
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
        pluginID: 'com.example.metrics',
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
        pluginID: 'com.example.metrics',
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
      { status: 200 },
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
        pluginID: 'com.example.metrics',
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
        pluginID: 'com.example.metrics',
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

  it('starts the generated signed release installation with one stable request id', async () => {
    const { lifecycle, mocks } = createClientHarness();

    await expect(lifecycle.installOfficialRelease(officialInstallCommand, releaseInstallRequestID)).resolves.toMatchObject({
      status: 'completed',
    });

    expect(mocks.startReleaseInstallExecution).toHaveBeenCalledWith({
      request_id: releaseInstallRequestID,
      plugin_instance_id: examplePlugin.pluginInstanceID,
      release_ref: EXAMPLE_PLUGIN_RELEASE_REF,
      release_identity_digest: examplePlugin.installPreview!.release_identity_digest,
      manifest_sha256: examplePlugin.installPreview!.manifest_sha256,
      contract_set_sha256: examplePlugin.installPreview!.contract_set_sha256,
      summary_sha256: examplePlugin.installPreview!.summary_sha256,
    }, {});
    expect(mocks.installReleaseRef).not.toHaveBeenCalled();
    expect(mocks.listExecutionEvents).not.toHaveBeenCalled();
    expect(mocks.getExecution).not.toHaveBeenCalled();
    expect(EXAMPLE_PLUGIN_RELEASE_REF).toMatchObject({
      publisher_id: examplePlugin.publisherID,
      plugin_id: examplePlugin.pluginID,
      version: examplePlugin.stableVersion,
    });
  });

  it('returns an already terminal release installation execution', async () => {
    const { lifecycle, mocks } = createClientHarness();
    mocks.startReleaseInstallExecution.mockResolvedValueOnce(releaseInstallExecution({
      status: 'failed',
      failure_code: 'PLUGIN_RELEASE_NETWORK',
    }));

    await expect(lifecycle.installOfficialRelease(officialInstallCommand, releaseInstallRequestID)).resolves.toMatchObject({
      status: 'failed',
      failure_code: 'PLUGIN_RELEASE_NETWORK',
    });
    expect(mocks.listExecutionEvents).not.toHaveBeenCalled();
  });

  it('lists and reads release installation executions through the unified client helpers', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const execution = releaseInstallExecution();
    mocks.listReleaseInstallExecutions
      .mockResolvedValueOnce({ executions: [execution], next_cursor: 101 })
      .mockResolvedValueOnce({ executions: [] });
    mocks.getExecution.mockResolvedValueOnce(execution);

    await expect(lifecycle.listReleaseInstallExecutions()).resolves.toEqual([execution]);
    await expect(lifecycle.getReleaseInstallExecution(execution.execution_id)).resolves.toEqual(execution);
    await expect(lifecycle.listReleaseInstallExecutionEvents(execution.execution_id, 0)).resolves.toMatchObject({ cursor: 1 });

    expect(mocks.listReleaseInstallExecutions).toHaveBeenNthCalledWith(1, { limit: 500 }, {});
    expect(mocks.listReleaseInstallExecutions).toHaveBeenNthCalledWith(2, { limit: 500, cursor: 101 }, {});
    expect(mocks.getExecution).toHaveBeenCalledWith(execution.execution_id, {});
    expect(mocks.listExecutionEvents).toHaveBeenCalledWith(execution.execution_id, { after_cursor: 0, limit: 1_000 }, {});
  });

  it('deletes the exact retained data revision before an incompatible-data reinstall', async () => {
    const { lifecycle, mocks } = createClientHarness();

    const revision = await lifecycle.getIncompatibleRetainedDataRevision(examplePlugin.pluginInstanceID);
    await lifecycle.deleteIncompatibleRetainedData(examplePlugin.pluginInstanceID, revision);

    expect(mocks.listRetainedData).toHaveBeenNthCalledWith(1, {
      plugin_instance_id: examplePlugin.pluginInstanceID,
    }, {});
    expect(mocks.listRetainedData).toHaveBeenNthCalledWith(2, {
      plugin_instance_id: examplePlugin.pluginInstanceID,
    }, {});
    expect(mocks.deleteRetainedData).toHaveBeenCalledWith({
      plugin_instance_id: examplePlugin.pluginInstanceID,
      expected_binding_revision: 4,
    }, {});
  });

  it('treats an already absent confirmed retained binding as a reconciled delete', async () => {
    const { lifecycle, mocks } = createClientHarness();
    mocks.listRetainedData.mockResolvedValueOnce({ retained_data: [] });

    await lifecycle.deleteIncompatibleRetainedData(examplePlugin.pluginInstanceID, 4);

    expect(mocks.deleteRetainedData).not.toHaveBeenCalled();
  });

  it('rejects deleting retained data when the confirmed revision changed', async () => {
    const { lifecycle, mocks } = createClientHarness();
    mocks.listRetainedData.mockResolvedValueOnce({ retained_data: [{
      plugin_instance_id: examplePlugin.pluginInstanceID,
      generation_id: 'gen-new',
      state: 'retained',
      revision: 5,
      shape_hash: 'b'.repeat(64),
    }] });

    await expect(lifecycle.deleteIncompatibleRetainedData(
      examplePlugin.pluginInstanceID,
      4,
    )).rejects.toThrow('changed after confirmation');
    expect(mocks.deleteRetainedData).not.toHaveBeenCalled();
  });

  it('updates the exact installed instance with its management revision and generated release ref', async () => {
    const { lifecycle, mocks } = createClientHarness();

    await lifecycle.execute({
      type: 'update',
      pluginID: examplePlugin.pluginID,
      pluginInstanceID: examplePlugin.pluginInstanceID,
      expectedManagementRevision: 17,
      targetVersion: EXAMPLE_PLUGIN_RELEASE_REF.version,
    });

    expect(mocks.updateReleaseRef).toHaveBeenCalledWith({
      plugin_instance_id: examplePlugin.pluginInstanceID,
      expected_management_revision: 17,
      release_ref: EXAMPLE_PLUGIN_RELEASE_REF,
    }, {});
  });

  it('rejects an update whose requested version is not the signed release version', async () => {
    const { lifecycle, mocks } = createClientHarness();

    await expect(lifecycle.execute({
      type: 'update',
      pluginID: examplePlugin.pluginID,
      pluginInstanceID: examplePlugin.pluginInstanceID,
      expectedManagementRevision: 17,
      targetVersion: '1.9.9',
    })).rejects.toThrow('does not match its signed release reference');
    expect(mocks.updateReleaseRef).not.toHaveBeenCalled();
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
      source: { kind: 'github_repository', url: 'https://github.com/example/toolbox', tag: 'v1.2.3' },
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

  it('installs a fresh inspection with its exact digest and the confirmed activation intent', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const inspection = {
      inspection_id: 'inspection_external_12345678',
      inspected_hashes: {
        package_sha256: '684a09cfd858448baa7d52c3d30932d7684a09cfd858448baa7d52c3d30932d7',
        manifest_sha256: '1'.repeat(64),
        entries_sha256: '2'.repeat(64),
      },
      intent: { action: 'install' as const },
      security_summary: {
        permissions: [
          { permission_id: 'metrics.read', methods: ['metrics.list'] },
          { permission_id: 'metrics.execute', methods: ['metrics.start'] },
        ],
      },
    };
    const installed = { plugin: { plugin_instance_id: 'plugini_external_12345678' } };
    mocks.installInspectedPackage.mockResolvedValue(installed);

    await expect(lifecycle.installExternalPackage(inspection as never)).resolves.toBe(installed);

    expect(mocks.installInspectedPackage).toHaveBeenCalledWith({
      inspection_id: inspection.inspection_id,
      expected_package_sha256: inspection.inspected_hashes.package_sha256,
    }, {});
  });

  it('commits an external update without changing its enable intent or adding grants', async () => {
    const { lifecycle, mocks } = createClientHarness();
    const inspection = {
      inspection_id: 'inspection_external_update_12345678',
      inspected_hashes: {
        package_sha256: '684a09cfd858448baa7d52c3d30932d7684a09cfd858448baa7d52c3d30932d7',
      },
      intent: {
        action: 'update' as const,
        plugin_instance_id: 'plugini_external_12345678',
        expected_management_revision: 9,
      },
      security_summary: {
        permissions: [{ permission_id: 'workspace.read', methods: ['workspace.list'] }],
      },
    };

    await lifecycle.installExternalPackage(inspection as never);

    expect(mocks.installInspectedPackage).toHaveBeenCalledWith({
      inspection_id: inspection.inspection_id,
      expected_package_sha256: inspection.inspected_hashes.package_sha256,
    }, {});
  });
});
