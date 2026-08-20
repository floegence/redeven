import {
  type PluginExecution,
  type PluginEvent,
  type PluginPlatformClient,
  type PluginRequestOptions,
} from '@floegence/redevplugin-ui';

import { officialPluginCatalog } from './officialPluginCatalog';
import { fetchLocalApiJSON, fetchLocalApiJSONResponse, prepareLocalApiRequestInit } from '../services/localApi';
import { projectPluginInventory } from './pluginInventoryProjection';
import { fetchAuthenticatedReDevPlugin } from './pluginPlatform';
import type {
  OfficialPluginCatalogItem,
  ExternalPluginCommitResult,
  ExternalPluginInspection,
  ExternalPluginInspectionRequest,
  PluginInventoryProjection,
  PluginManagementCommand,
  ReDevPluginRecord,
  PluginMarketSnapshot,
  PluginMarketDetail,
  OfficialPluginReleaseInspection,
} from './pluginTypes';

const INVENTORY_MARKET_TIMEOUT_MS = 5_000;
const INVENTORY_ICON_TIMEOUT_MS = 5_000;

export type PluginLifecycleAPI = ReturnType<typeof createPluginLifecycleAPI>;

export class ExternalPackageInspectionTerminalError extends Error {}

export function createPluginLifecycleAPI(
  client: PluginPlatformClient,
  catalogSeed?: readonly OfficialPluginCatalogItem[],
  loadMarket: (signal?: AbortSignal) => Promise<PluginMarketSnapshot> = loadPluginMarketSnapshot,
  loadInstalledIcon: (url: string, signal?: AbortSignal) => Promise<string> = loadInstalledPluginIcon,
) {
  let catalog: readonly OfficialPluginCatalogItem[] = catalogSeed ?? [];
  let marketUnavailable = false;
  let marketGeneration: number | undefined;
  let marketRefreshPromise: Promise<boolean> | undefined;
  const installedIconLoads = new Map<string, Promise<void>>();
  const installedIconURLBySource = new Map<string, string>();
  const loadedInstalledIconURLs = new Set<string>();
  let disposed = false;
  const officialByPluginID = () => new Map(catalog.map((item) => [item.pluginID, item]));
  const listInstalledPlugins = async (options: PluginRequestOptions = {}): Promise<ReDevPluginRecord[]> => {
    const result = await client.catalog(options);
    return result.plugins;
  };

  const refreshMarketCatalog = async (options: PluginRequestOptions = {}): Promise<boolean> => {
    if (catalogSeed !== undefined) {
      catalog = catalogSeed;
      marketUnavailable = false;
      return false;
    }
    if (marketRefreshPromise) return marketRefreshPromise;
    const refresh = withAbortTimeout(
      (signal) => loadMarket(signal),
      options.signal,
      INVENTORY_MARKET_TIMEOUT_MS,
      'Loading the plugin market',
    ).then((snapshot) => {
      if (snapshot.stale || snapshot.source === 'cache') {
        throw new Error('The plugin market is using stale cached data');
      }
      const nextCatalog = officialPluginCatalog(snapshot);
      const changed = marketGeneration !== snapshot.generation
        || catalog.length !== nextCatalog.length;
      catalog = nextCatalog;
      marketGeneration = snapshot.generation;
      marketUnavailable = false;
      return changed;
    }).catch((error) => {
      marketUnavailable = true;
      throw error;
    }).finally(() => {
      marketRefreshPromise = undefined;
    });
    marketRefreshPromise = refresh;
    return refresh;
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
    const items = projection.items.map((item) => {
      if (!item.pluginInstanceID || !item.iconURL?.startsWith('/_redevplugin/api/plugins/')) return item;
      const sourceURL = item.iconURL;
      const loadedIconURL = installedIconURLBySource.get(sourceURL);
      if (loadedIconURL) return { ...item, iconURL: loadedIconURL };
      if (!installedIconLoads.has(sourceURL)) {
        const load = withAbortTimeout(
            (signal) => loadInstalledIcon(item.iconURL!, signal),
            options.signal,
            INVENTORY_ICON_TIMEOUT_MS,
            `Loading the icon for ${item.pluginInstanceID}`,
          )
          .then((objectURL) => {
            if (disposed) URL.revokeObjectURL(objectURL);
            else {
              installedIconURLBySource.set(sourceURL, objectURL);
              loadedInstalledIconURLs.add(objectURL);
            }
          })
          .catch(() => undefined)
          .finally(() => installedIconLoads.delete(sourceURL));
        installedIconLoads.set(sourceURL, load);
      }
      return { ...item, iconURL: undefined };
    });
    return {
      ...projection,
      items: items.map((item) => (
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

  const inspectOfficialRelease = async (
    pluginID: string,
    options: PluginRequestOptions = {},
  ): Promise<OfficialPluginReleaseInspection> => {
    const official = requireOfficialPlugin(officialByPluginID(), pluginID);
    return client.inspectReleasePackage({
      plugin_instance_id: official.pluginInstanceID,
      release_ref: official.distribution.releaseRef,
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
    command: Extract<PluginManagementCommand, { type: 'install' }>,
    requestID: string,
    options: PluginRequestOptions = {},
    onUpdate?: (execution: PluginExecution, events: readonly PluginEvent[]) => void,
  ): Promise<PluginExecution> => {
    const official = requireOfficialPlugin(officialByPluginID(), command.pluginID);
    let execution = await client.startReleaseInstallExecution({
      request_id: requestID,
      plugin_instance_id: official.pluginInstanceID,
      release_ref: official.distribution.releaseRef,
    }, options);
    onUpdate?.(execution, []);
    let cursor = execution.cursor;
    while (!isExecutionTerminal(execution)) {
      await waitForExecutionRetry(options.signal);
      const eventList = await client.listExecutionEvents(execution.execution_id, { after_cursor: cursor }, options);
      cursor = eventList.cursor;
      execution = await client.getExecution(execution.execution_id, options);
      onUpdate?.(execution, eventList.events);
    }
    return execution;
  };

  const listReleaseInstallExecutions = async (
    options: PluginRequestOptions = {},
  ): Promise<PluginExecution[]> => (
    (await client.listExecutions({ limit: 100 }, options)).executions
  );

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
  ) => client.listExecutionEvents(executionID, { after_cursor: cursor }, options);

  const recoverEnabled = (options: PluginRequestOptions = {}) => client.recoverEnabled(options);
  const retryRecovery = (pluginInstanceID: string, options: PluginRequestOptions = {}) => (
    client.retryRecovery(pluginInstanceID, options)
  );

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
        return client.grantPermission({
          plugin_instance_id: command.pluginInstanceID,
          permission_id: command.permissionID,
          expected_policy_revision: command.expectedPolicyRevision,
          expected_management_revision: command.expectedManagementRevision,
          expected_revoke_epoch: command.expectedRevokeEpoch,
        }, options);
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

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    installedIconLoads.clear();
    installedIconURLBySource.clear();
    for (const objectURL of loadedInstalledIconURLs) URL.revokeObjectURL(objectURL);
    loadedInstalledIconURLs.clear();
  };

  return Object.freeze({
    listInstalledPlugins,
    refreshMarketCatalog,
    loadInventoryProjection,
    loadMarketDetail: loadPluginMarketDetail,
    inspectOfficialRelease,
    inspectExternalPackage,
    installExternalPackage,
    installOfficialRelease,
    listReleaseInstallExecutions,
    getReleaseInstallExecution,
    listReleaseInstallExecutionEvents,
    recoverEnabled,
    retryRecovery,
    execute,
    dispose,
  });
}

async function loadInstalledPluginIcon(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetchAuthenticatedReDevPlugin(url, { method: 'GET', signal });
  if (!response.ok) throw new Error(`Installed plugin icon request failed with HTTP ${response.status}`);
  const blob = await response.blob();
  if (blob.type !== 'image/png' && blob.type !== 'image/webp') throw new Error('Installed plugin icon media type is invalid');
  const objectURL = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectURL;
    await image.decode();
    return objectURL;
  } catch (error) {
    URL.revokeObjectURL(objectURL);
    throw error;
  }
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

function isExecutionTerminal(execution: PluginExecution): boolean {
  return execution.status === 'completed'
    || execution.status === 'canceled'
    || execution.status === 'failed'
    || execution.status === 'orphaned';
}

function waitForExecutionRetry(signal?: AbortSignal): Promise<void> {
  return waitForAbortableDelay(250, signal);
}

async function loadPluginMarketSnapshot(signal?: AbortSignal): Promise<PluginMarketSnapshot> {
  return fetchLocalApiJSON<PluginMarketSnapshot>(
    '/_redeven_proxy/api/plugins/market/catalog',
    { method: 'GET', signal },
  );
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

function waitForAbortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  const boundedDelay = Math.min(5_000, Math.max(1, Math.trunc(delayMs)));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, boundedDelay);
    const abort = () => {
      globalThis.clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
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
