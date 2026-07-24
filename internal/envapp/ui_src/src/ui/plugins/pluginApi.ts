import {
  pluginMutationOutcome,
  type PluginExternalPackageCommitResult,
  type PluginPlatformClient,
  type PluginRequestOptions,
} from '@floegence/redevplugin-ui';

import { officialPluginCatalog } from './officialPluginCatalog';
import { projectPluginInventory } from './pluginInventoryProjection';
import type {
  OfficialPluginCatalogItem,
  ExternalPluginCommitResult,
  ExternalPluginInspection,
  ExternalPluginInspectionRequest,
  PluginInventoryProjection,
  PluginManagementCommand,
  ReDevPluginRecord,
} from './pluginTypes';

const EXTERNAL_COMMIT_RECONCILIATION_TIMEOUT_MS = 60_000;

export type PluginLifecycleAPI = ReturnType<typeof createPluginLifecycleAPI>;

export class ExternalPackageInspectionTerminalError extends Error {}

export function createPluginLifecycleAPI(
  client: PluginPlatformClient,
  catalog: readonly OfficialPluginCatalogItem[] = officialPluginCatalog(),
) {
  const officialByPluginID = new Map(catalog.map((item) => [item.pluginID, item]));
  const externalCommitQueryOnlyInspections = new Set<string>();

  const listInstalledPlugins = async (options: PluginRequestOptions = {}): Promise<ReDevPluginRecord[]> => {
    const result = await client.catalog(options);
    return result.plugins;
  };

  const loadInventoryProjection = async (options: PluginRequestOptions = {}): Promise<PluginInventoryProjection> => {
    const installedPlugins = await listInstalledPlugins(options);
    const [permissions, securityPolicies, permissionRequirements] = await Promise.all([
      client.listPermissions({ active_only: true }, options),
      client.listSecurityPolicies(options),
      Promise.all(installedPlugins.map((plugin) => client.getPermissionRequirements({
        plugin_instance_id: plugin.plugin_instance_id,
      }, options))),
    ]);
    return projectPluginInventory({
      officialCatalog: catalog,
      installedPlugins,
      permissionGrants: permissions.permissions,
      permissionRequirements,
      securityPolicies: securityPolicies.security_policies,
    });
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
        const official = requireOfficialPlugin(officialByPluginID, command.pluginID);
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
        const official = requireOfficialPlugin(officialByPluginID, command.pluginID);
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
