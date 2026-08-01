import {
  pluginMutationOutcome,
  type PluginExternalPackageCommitResult,
  type PluginPlatformClient,
  type PluginRequestOptions,
} from '@floegence/redevplugin-ui';
import type { PluginLocalImportClient } from '@floegence/redevplugin-ui/local-import';

import { applyOfficialDevelopmentDelivery, officialPluginCatalog } from './officialPluginCatalog';
import { fetchLocalApiJSON, prepareLocalApiRequestInit } from '../services/localApi';
import { projectPluginInventory } from './pluginInventoryProjection';
import type {
  OfficialPluginCatalogItem,
  ExternalPluginCommitResult,
  ExternalPluginInspection,
  ExternalPluginInspectionRequest,
  PluginInventoryProjection,
  PluginManagementCommand,
  ReDevPluginRecord,
  PluginDevelopmentDelivery,
  PluginMarketSnapshot,
} from './pluginTypes';

const EXTERNAL_COMMIT_RECONCILIATION_TIMEOUT_MS = 60_000;

export type PluginLifecycleAPI = ReturnType<typeof createPluginLifecycleAPI>;

export class ExternalPackageInspectionTerminalError extends Error {}

export function createPluginLifecycleAPI(
  client: PluginPlatformClient,
  localImport?: PluginLocalImportClient,
  catalogSeed?: readonly OfficialPluginCatalogItem[],
  loadDevelopment: (signal?: AbortSignal) => Promise<PluginDevelopmentDelivery | undefined> = loadDevelopmentDelivery,
  loadMarket: (signal?: AbortSignal) => Promise<PluginMarketSnapshot> = loadPluginMarketSnapshot,
) {
  let catalog: readonly OfficialPluginCatalogItem[] = catalogSeed ?? [];
  let developmentDelivery: PluginDevelopmentDelivery | undefined;
  let developmentUpdateTargets = new Map<string, number>();
  const officialByPluginID = () => new Map(catalog.map((item) => [item.pluginID, item]));
  const externalCommitQueryOnlyInspections = new Set<string>();

  const listInstalledPlugins = async (options: PluginRequestOptions = {}): Promise<ReDevPluginRecord[]> => {
    const result = await client.catalog(options);
    return result.plugins;
  };

  const loadInventoryProjection = async (options: PluginRequestOptions = {}): Promise<PluginInventoryProjection> => {
    const installedPluginsPromise = listInstalledPlugins(options);
    const developmentPromise = loadDevelopment(options.signal);
    let marketUnavailable = false;
    if (catalogSeed === undefined) {
      try {
        catalog = officialPluginCatalog(await loadMarket(options.signal));
      } catch {
        catalog = [];
        marketUnavailable = true;
      }
    } else {
      catalog = catalogSeed;
    }
    developmentDelivery = await developmentPromise;
    if (developmentDelivery) catalog = applyOfficialDevelopmentDelivery(catalog, developmentDelivery);
    const installedPlugins = await installedPluginsPromise;
    const [permissions, securityPolicies, permissionRequirementResults] = await Promise.all([
      client.listPermissions({ active_only: true }, options),
      client.listSecurityPolicies(options),
      Promise.allSettled(installedPlugins.map((plugin) => client.getPermissionRequirements({
        plugin_instance_id: plugin.plugin_instance_id,
      }, options))),
    ]);
    const permissionRequirements = permissionRequirementResults.flatMap((result, index) => {
      if (result.status === 'fulfilled') return [result.value];
      const plugin = installedPlugins[index];
      if (plugin && isRecoverableContainersDevelopmentInstance(plugin, developmentDelivery)) return [];
      throw result.reason;
    });
    const projection = projectPluginInventory({
      officialCatalog: catalog,
      installedPlugins,
      permissionGrants: permissions.permissions,
      permissionRequirements,
      securityPolicies: securityPolicies.security_policies,
    });
    developmentUpdateTargets = new Map(projection.items.flatMap((item) => (
      item.pluginInstanceID
        && item.managementRevision !== undefined
        && item.officialCatalog?.distribution.developmentDelivery
        ? [[item.pluginInstanceID, item.managementRevision] as const]
        : []
    )));
    return { ...projection, marketUnavailable };
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

  const commitExternalPackage = async (
    inspection: ExternalPluginInspection,
    options: PluginRequestOptions = {},
    onProgress?: (result: PluginExternalPackageCommitResult) => void,
  ): Promise<ExternalPluginCommitResult> => {
    let result: PluginExternalPackageCommitResult;
    if (externalCommitQueryOnlyInspections.has(inspection.inspection_id)) {
      result = await client.queryExternalPackageCommit({
        inspection_id: inspection.inspection_id,
      }, options);
    } else {
      try {
        result = await client.commitExternalPackage({
          inspection_id: inspection.inspection_id,
          confirmation_digest: inspection.confirmation_digest,
        }, options);
      } catch (error) {
        if (pluginMutationOutcome(error) !== 'unknown') throw error;
        externalCommitQueryOnlyInspections.add(inspection.inspection_id);
        result = await client.queryExternalPackageCommit({
          inspection_id: inspection.inspection_id,
        }, options);
      }
    }
    if (result.status === 'in_progress') {
      externalCommitQueryOnlyInspections.add(inspection.inspection_id);
    }
    onProgress?.(result);
    const reconciliationDeadline = Date.now() + EXTERNAL_COMMIT_RECONCILIATION_TIMEOUT_MS;
    while (result.status === 'in_progress') {
      const remaining = reconciliationDeadline - Date.now();
      if (remaining <= 0) {
        throw new Error('External package commit reconciliation timed out');
      }
      await waitForExternalCommitRetry(result.retry_after_ms, options.signal, remaining);
      result = await client.queryExternalPackageCommit({
        inspection_id: inspection.inspection_id,
      }, options);
      onProgress?.(result);
    }
    externalCommitQueryOnlyInspections.delete(inspection.inspection_id);
    if (result.status === 'failed') {
      throw new ExternalPackageInspectionTerminalError(
        'The plugin host restarted before the installation completed. Inspect the package again.',
      );
    }
    return result;
  };

  const execute = async (
    command: PluginManagementCommand,
    options: PluginRequestOptions = {},
  ) => {
    switch (command.type) {
      case 'install': {
        const official = requireOfficialPlugin(officialByPluginID(), command.pluginID);
        return client.installReleaseRef({
          plugin_instance_id: official.pluginInstanceID,
          release_ref: official.distribution.releaseRef,
        }, options);
      }
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
        const development = official.distribution.developmentDelivery;
        if (development && command.targetVersion === development.version) {
          if (!localImport
            || developmentUpdateTargets.get(command.pluginInstanceID) !== command.expectedManagementRevision) {
            throw new Error('Containers development update target is invalid');
          }
          const response = await fetch(development.package_url, await prepareLocalApiRequestInit({ signal: options.signal }));
          if (!response.ok) throw new Error(`Containers development package could not be loaded (HTTP ${response.status})`);
          const blob = await response.blob();
          if (await sha256Hex(blob) !== development.package_sha256) {
            throw new Error('Containers development package hash does not match the reviewed delivery');
          }
          const result = await localImport.updateLocalPackage(
            command.pluginInstanceID, command.expectedManagementRevision, blob, { signal: options.signal },
          );
          developmentUpdateTargets.delete(command.pluginInstanceID);
          return result;
        }
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

  return Object.freeze({
    listInstalledPlugins,
    loadInventoryProjection,
    inspectExternalPackage,
    commitExternalPackage,
    execute,
  });
}

function isRecoverableContainersDevelopmentInstance(
  plugin: ReDevPluginRecord,
  delivery?: PluginDevelopmentDelivery,
): boolean {
  return Boolean(delivery
    && delivery.development_only === true
    && plugin.publisher_id === delivery.publisher_id
    && plugin.plugin_id === delivery.plugin_id
    && plugin.version === delivery.version
    && plugin.trust_state === 'unsigned_local');
}

async function loadDevelopmentDelivery(signal?: AbortSignal): Promise<PluginDevelopmentDelivery | undefined> {
  if (typeof window === 'undefined') return undefined;
  try {
    return await fetchLocalApiJSON<PluginDevelopmentDelivery>(
      '/_redeven_proxy/api/plugins/development-delivery/containers',
      { method: 'GET', signal },
    );
  } catch (error) {
    if (error instanceof Error && 'status' in error && (error as { status?: number }).status === 404) return undefined;
    throw error;
  }
}

async function loadPluginMarketSnapshot(signal?: AbortSignal): Promise<PluginMarketSnapshot> {
  return fetchLocalApiJSON<PluginMarketSnapshot>(
    '/_redeven_proxy/api/plugins/market/catalog',
    { method: 'GET', signal },
  );
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function waitForExternalCommitRetry(delayMs: number, signal?: AbortSignal, remainingMs = 5_000): Promise<void> {
  const boundedDelay = Math.min(5_000, Math.max(1, remainingMs), Math.max(100, Math.trunc(delayMs)));
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
