import {
  type PluginExecution,
  type PluginPlatformClient,
  type PluginRequestOptions,
} from '@floegence/redevplugin-ui';

import { officialPluginCatalog } from './officialPluginCatalog';
import { fetchLocalApi, fetchLocalApiJSON, fetchLocalApiJSONResponse, prepareLocalApiRequestInit } from '../services/localApi';
import { projectPluginInventory } from './pluginInventoryProjection';
import type {
  OfficialPluginCatalogItem,
  ExternalPluginCommitResult,
  ExternalPluginInspection,
  ExternalPluginInspectionRequest,
  PluginInventoryProjection,
  PluginManagementCommand,
  PluginOfficialInstallCommand,
  ReDevPluginRecord,
  PluginMarketRefreshEvent,
  PluginMarketSnapshot,
  PluginMarketDetail,
} from './pluginTypes';

const INVENTORY_MARKET_TIMEOUT_MS = 5_000;
const MARKET_REFRESH_TIMEOUT_MS = 20_000;

export type PluginMarketCatalogResult = Readonly<{
  generation: number;
  changed: boolean;
  stale: boolean;
}>;

export type PluginLifecycleAPI = ReturnType<typeof createPluginLifecycleAPI>;

export class ExternalPackageInspectionTerminalError extends Error {}

export function createPluginLifecycleAPI(
  client: PluginPlatformClient,
  catalogSeed?: readonly OfficialPluginCatalogItem[],
  loadMarket: (signal?: AbortSignal) => Promise<PluginMarketSnapshot> = loadPluginMarketSnapshot,
  refreshMarket: (signal?: AbortSignal) => Promise<PluginMarketSnapshot> = refreshPluginMarketSnapshot,
) {
  let catalog: readonly OfficialPluginCatalogItem[] = catalogSeed ?? [];
  let marketUnavailable = false;
  let marketGeneration: number | undefined;
  const officialByPluginID = () => new Map(catalog.map((item) => [item.pluginID, item]));
  const listInstalledPlugins = async (options: PluginRequestOptions = {}): Promise<ReDevPluginRecord[]> => {
    const result = await client.catalog(options);
    return result.plugins;
  };

  const acceptMarketSnapshot = (snapshot: PluginMarketSnapshot, requireFresh: boolean): PluginMarketCatalogResult => {
    const nextCatalog = officialPluginCatalog(snapshot);
    if (marketGeneration !== undefined && snapshot.generation < marketGeneration) {
      return { generation: marketGeneration, changed: false, stale: marketUnavailable };
    }
    const changed = marketGeneration !== snapshot.generation;
    catalog = nextCatalog;
    marketGeneration = snapshot.generation;
    marketUnavailable = false;
    if (snapshot.stale || snapshot.source === 'cache') {
      marketUnavailable = catalog.length === 0;
      if (requireFresh) throw new Error('The plugin market is using stale cached data');
    }
    return {
      generation: snapshot.generation,
      changed,
      stale: snapshot.stale || snapshot.source === 'cache',
    };
  };

  const loadCachedMarketCatalog = async (options: PluginRequestOptions = {}): Promise<PluginMarketCatalogResult> => {
    if (catalogSeed !== undefined) {
      catalog = catalogSeed;
      marketUnavailable = false;
      return { generation: marketGeneration ?? 0, changed: false, stale: false };
    }
    try {
      const snapshot = await withAbortTimeout(
        (signal) => loadMarket(signal),
        options.signal,
        INVENTORY_MARKET_TIMEOUT_MS,
        'Loading the plugin market',
      );
      return acceptMarketSnapshot(snapshot, false);
    } catch (error) {
      marketUnavailable = catalog.length === 0;
      throw error;
    }
  };

  const refreshMarketCatalog = async (options: PluginRequestOptions = {}): Promise<PluginMarketCatalogResult> => {
    if (catalogSeed !== undefined) {
      catalog = catalogSeed;
      marketUnavailable = false;
      return { generation: marketGeneration ?? 0, changed: false, stale: false };
    }
    try {
      const snapshot = await withAbortTimeout(
        (signal) => refreshMarket(signal),
        options.signal,
        MARKET_REFRESH_TIMEOUT_MS,
        'Refreshing the plugin market',
      );
      return acceptMarketSnapshot(snapshot, true);
    } catch (error) {
      marketUnavailable = catalog.length === 0;
      throw error;
    }
  };

  const loadInventoryProjection = async (options: PluginRequestOptions = {}): Promise<PluginInventoryProjection> => {
    const installedPluginsPromise = listInstalledPlugins(options);
    const installedPlugins = await installedPluginsPromise;
    if (catalogSeed !== undefined) {
      catalog = catalogSeed;
    }
    const [permissionsResult, securityPoliciesResult, permissionRequirementResults] = installedPlugins.length > 0
      ? await Promise.all([
      withAbortTimeout(
        (signal) => client.listPermissions({ active_only: true }, { ...options, signal }),
        options.signal,
        INVENTORY_MARKET_TIMEOUT_MS,
        'Loading plugin permissions',
      ).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason }),
      ),
      withAbortTimeout(
        (signal) => client.listSecurityPolicies({ ...options, signal }),
        options.signal,
        INVENTORY_MARKET_TIMEOUT_MS,
        'Loading plugin security policies',
      ).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason }),
      ),
      Promise.all(installedPlugins.map((plugin) => withAbortTimeout(
        (signal) => client.getPermissionRequirements({
          plugin_instance_id: plugin.plugin_instance_id,
        }, { ...options, signal }),
        options.signal,
        INVENTORY_MARKET_TIMEOUT_MS,
        `Loading permissions for ${plugin.plugin_instance_id}`,
      ).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason }),
      ))),
    ])
      : [
          { status: 'fulfilled' as const, value: { permissions: [] } },
          { status: 'fulfilled' as const, value: { security_policies: [] } },
          [],
        ] as const;
    const permissionRequirements = permissionRequirementResults.flatMap((result) => (
      result.status === 'fulfilled' ? [result.value] : []
    ));
    const supplementalUnavailable = permissionsResult.status === 'rejected'
      || securityPoliciesResult.status === 'rejected';
    const unavailablePluginIDs = new Set(permissionRequirementResults.flatMap((result, index) => (
      result.status === 'rejected' ? [installedPlugins[index]?.plugin_instance_id] : []
    )).filter((value): value is string => Boolean(value)));
    const projection = projectPluginInventory({
      officialCatalog: catalog,
      installedPlugins,
      permissionGrants: permissionsResult.status === 'fulfilled' ? permissionsResult.value.permissions : [],
      permissionRequirements,
      securityPolicies: securityPoliciesResult.status === 'fulfilled' ? securityPoliciesResult.value.security_policies : [],
    });
    return {
      ...projection,
      items: projection.items.map((item) => (
        item.pluginInstanceID && (supplementalUnavailable || unavailablePluginIDs.has(item.pluginInstanceID))
          ? { ...item, lifecycleState: 'needs_attention' as const, attentionReason: 'diagnostic_error' as const }
          : item
      )),
      marketUnavailable,
    };
  };

  const inspectExternalPackage = async (
    request: ExternalPluginInspectionRequest,
    options: PluginRequestOptions = {},
  ): Promise<ExternalPluginInspection> => {
    if (request.sourceKind === 'package_upload') {
      return client.inspectUploadedExternalPackage(request.intent, request.file, options);
    }
    return client.inspectExternalPackage({
      intent: request.intent,
      source: request.sourceKind === 'package_url'
        ? { kind: 'package_url', url: request.url }
        : {
            kind: 'github_repository',
            url: request.url,
            ...(request.tag?.trim() ? { tag: request.tag.trim() } : {}),
          },
    }, options);
  };

  const installExternalPackage = async (
    inspection: ExternalPluginInspection,
    options: PluginRequestOptions = {},
  ): Promise<ExternalPluginCommitResult> => (
    client.installInspectedPackage({
      inspection_id: inspection.inspection_id,
      expected_package_sha256: inspection.inspected_hashes.package_sha256,
    }, options)
  );

  const installOfficialRelease = async (
    command: PluginOfficialInstallCommand,
    requestID: string,
    options: PluginRequestOptions = {},
  ): Promise<PluginExecution> => (
    client.startReleaseInstallExecution({
      request_id: requestID,
      plugin_instance_id: command.pluginInstanceID,
      release_ref: command.releaseRef,
      release_identity_digest: command.releaseIdentityDigest,
      manifest_sha256: command.manifestSHA256,
      contract_set_sha256: command.contractSetSHA256,
      summary_sha256: command.summarySHA256,
    } as Parameters<PluginPlatformClient['startReleaseInstallExecution']>[0], options)
  );

  const listReleaseInstallExecutions = async (
    options: PluginRequestOptions = {},
  ): Promise<PluginExecution[]> => {
    const executions: PluginExecution[] = [];
    let cursor: number | undefined;
    do {
      const page = await client.listReleaseInstallExecutions({
        limit: 500,
        ...(cursor === undefined ? {} : { cursor }),
      }, options);
      executions.push(...page.executions);
      cursor = page.next_cursor;
    } while (cursor !== undefined);
    return executions;
  };

  const getReleaseInstallExecution = (
    executionID: string,
    options: PluginRequestOptions = {},
  ): Promise<PluginExecution> => (
    client.getExecution(executionID, options)
  );

  const listReleaseInstallExecutionEvents = (
    executionID: string,
    cursor: number,
    options: PluginRequestOptions = {},
  ) => client.listExecutionEvents(executionID, { after_cursor: cursor, limit: 1_000 }, options);

  const getIncompatibleRetainedDataRevision = async (
    pluginInstanceID: string,
    options: PluginRequestOptions = {},
  ): Promise<number> => {
    const result = await client.listRetainedData({ plugin_instance_id: pluginInstanceID }, options);
    if (result.retained_data.length !== 1) {
      throw new Error('The incompatible retained plugin data is no longer available');
    }
    return result.retained_data[0]!.revision;
  };

  const deleteIncompatibleRetainedData = async (
    pluginInstanceID: string,
    expectedRevision: number,
    options: PluginRequestOptions = {},
  ): Promise<void> => {
    const result = await client.listRetainedData({ plugin_instance_id: pluginInstanceID }, options);
    if (result.retained_data.length === 0) return;
    if (result.retained_data.length !== 1 || result.retained_data[0]!.revision !== expectedRevision) {
      throw new Error('The retained plugin data changed after confirmation');
    }
    await client.deleteRetainedData({
      plugin_instance_id: pluginInstanceID,
      expected_binding_revision: expectedRevision,
    }, options);
  };

  const recoverEnabled = (options: PluginRequestOptions = {}) => client.recoverEnabled(options);
  const retryRecovery = (pluginInstanceID: string, options: PluginRequestOptions = {}) => (
    client.retryRecovery(pluginInstanceID, options)
  );
  const grantPermission = (
    command: Extract<PluginManagementCommand, { type: 'grant_permission' }>,
    options: PluginRequestOptions = {},
  ) => client.grantPermission({
    plugin_instance_id: command.pluginInstanceID,
    permission_id: command.permissionID,
    expected_policy_revision: command.expectedPolicyRevision,
    expected_management_revision: command.expectedManagementRevision,
    expected_revoke_epoch: command.expectedRevokeEpoch,
  }, options);

  const execute = async (
    command: Exclude<PluginManagementCommand, { type: 'install' }>,
    options: PluginRequestOptions = {},
  ) => {
    switch (command.type) {
      case 'enable':
        return client.enablePlugin({
          plugin_instance_id: command.pluginInstanceID,
          expected_management_revision: command.expectedManagementRevision,
        }, options);
      case 'disable':
        return client.disablePlugin({
          plugin_instance_id: command.pluginInstanceID,
          expected_management_revision: command.expectedManagementRevision,
          reason: 'user_disabled',
        }, options);
      case 'uninstall':
        return client.uninstallPlugin({
          plugin_instance_id: command.pluginInstanceID,
          expected_management_revision: command.expectedManagementRevision,
          delete_data: command.dataRetention === 'delete_data',
        }, options);
      case 'update': {
        const official = requireOfficialPlugin(officialByPluginID(), command.pluginID);
        if (command.targetVersion !== official.distribution.releaseRef.version) {
          throw new Error('Official plugin update target does not match its signed release reference');
        }
        return client.updateReleaseRef({
          plugin_instance_id: command.pluginInstanceID,
          expected_management_revision: command.expectedManagementRevision,
          release_ref: official.distribution.releaseRef,
        }, options);
      }
      case 'grant_permission':
        return grantPermission(command, options);
      case 'revoke_permission':
        return client.revokePermission({
          plugin_instance_id: command.pluginInstanceID,
          permission_id: command.permissionID,
          expected_policy_revision: command.expectedPolicyRevision,
          expected_management_revision: command.expectedManagementRevision,
          expected_revoke_epoch: command.expectedRevokeEpoch,
          reason: 'user_revoked',
        }, options);
      default:
        return assertNever(command);
    }
  };

  return Object.freeze({
    listInstalledPlugins,
    loadCachedMarketCatalog,
    refreshMarketCatalog,
    loadInventoryProjection,
    loadMarketDetail: loadPluginMarketDetail,
    inspectExternalPackage,
    installExternalPackage,
    installOfficialRelease,
    listReleaseInstallExecutions,
    getReleaseInstallExecution,
    listReleaseInstallExecutionEvents,
    getIncompatibleRetainedDataRevision,
    deleteIncompatibleRetainedData,
    recoverEnabled,
    retryRecovery,
    grantPermission,
    execute,
  });
}

async function withAbortTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  timeoutMS: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = globalThis.setTimeout(() => {
      const error = new Error(`${label} timed out`);
      controller.abort(error);
      reject(error);
    }, timeoutMS);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

async function loadPluginMarketSnapshot(signal?: AbortSignal): Promise<PluginMarketSnapshot> {
  return fetchLocalApiJSON<PluginMarketSnapshot>(
    '/_redeven_proxy/api/plugins/market/catalog',
    { method: 'GET', signal },
  );
}

async function refreshPluginMarketSnapshot(signal?: AbortSignal): Promise<PluginMarketSnapshot> {
  return fetchLocalApiJSON<PluginMarketSnapshot>(
    '/_redeven_proxy/api/plugins/market/catalog/refresh',
    { method: 'POST', signal },
  );
}

export async function connectPluginMarketEventStream(args: {
  afterSeq: number;
  signal: AbortSignal;
  onEvent: (event: PluginMarketRefreshEvent) => void;
}): Promise<void> {
  const response = await fetchLocalApi(
    `/_redeven_proxy/api/plugins/market/catalog/events?after_seq=${encodeURIComponent(String(args.afterSeq))}`,
    { method: 'GET', headers: { Accept: 'text/event-stream' }, signal: args.signal },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `HTTP ${response.status}`);
  }
  if (!response.body) throw new Error('Plugin market event stream unavailable');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flushBlock = (block: string) => {
    const payload = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!payload) return;
    const event = normalizePluginMarketRefreshEvent(JSON.parse(payload));
    if (!event) throw new Error('Plugin market event stream returned an invalid event');
    args.onEvent(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        flushBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    buffer = buffer.replace(/\r\n/g, '\n');
    if (buffer.trim()) flushBlock(buffer.trim());
  } finally {
    reader.releaseLock();
  }
}

function normalizePluginMarketRefreshEvent(value: unknown): PluginMarketRefreshEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<PluginMarketRefreshEvent>;
  if (!Number.isSafeInteger(candidate.seq) || Number(candidate.seq) <= 0
    || !Number.isSafeInteger(candidate.generation) || Number(candidate.generation) < -1
    || (candidate.state !== 'refreshing' && candidate.state !== 'ready' && candidate.state !== 'refresh_failed')
    || typeof candidate.stale !== 'boolean') return null;
  if (candidate.checked_at !== undefined && typeof candidate.checked_at !== 'string') return null;
  if (candidate.next_refresh_at !== undefined && typeof candidate.next_refresh_at !== 'string') return null;
  return candidate as PluginMarketRefreshEvent;
}

export async function loadPluginMarketDetail(pluginID: string, generation: number, signal?: AbortSignal): Promise<PluginMarketDetail> {
  if (!/^[a-z][a-z0-9._-]{0,127}$/.test(pluginID)) throw new Error('Invalid plugin id');
  if (!Number.isSafeInteger(generation) || generation < 0) throw new Error('Invalid plugin market generation');
  const response = await fetchLocalApiJSONResponse<PluginMarketDetail>(
    `/_redeven_proxy/api/plugins/market/plugins/${encodeURIComponent(pluginID)}?generation=${generation}`,
    await prepareLocalApiRequestInit({ signal }),
  );
  const meta = response.meta as { generation?: unknown } | undefined;
  return {
    ...response.data,
    ...(Number.isSafeInteger(meta?.generation) && (meta?.generation as number) >= 0
      ? { generation: meta?.generation as number }
      : {}),
  };
}

function requireOfficialPlugin(
  catalog: ReadonlyMap<string, OfficialPluginCatalogItem>,
  pluginID: string,
): OfficialPluginCatalogItem {
  const item = catalog.get(pluginID);
  if (!item) {
    throw new Error('Official plugin release is unavailable');
  }
  return item;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported plugin lifecycle command: ${JSON.stringify(value)}`);
}
