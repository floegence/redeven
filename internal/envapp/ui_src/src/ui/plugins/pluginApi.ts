import {
  pluginMutationOutcome,
  type PluginExternalPackageCommitResult,
  type PluginPlatformClient,
  type PluginReleaseInstallOperation,
  type PluginRequestOptions,
} from '@floegence/redevplugin-ui';

import { officialPluginCatalog } from './officialPluginCatalog';
import { fetchLocalApiJSON, fetchLocalApiJSONResponse, prepareLocalApiRequestInit } from '../services/localApi';
import { projectPluginInventory } from './pluginInventoryProjection';
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
} from './pluginTypes';

const EXTERNAL_COMMIT_RECONCILIATION_TIMEOUT_MS = 60_000;
// Host enable includes worker preflight, data namespace initialization, and
// surface publication. Keep this bounded, but allow a cold runtime to finish.
const POST_INSTALL_MUTATION_TIMEOUT_MS = 90_000;

export type PluginLifecycleAPI = ReturnType<typeof createPluginLifecycleAPI>;

export class ExternalPackageInspectionTerminalError extends Error {}

export function createPluginLifecycleAPI(
  client: PluginPlatformClient,
  catalogSeed?: readonly OfficialPluginCatalogItem[],
  loadMarket: (signal?: AbortSignal) => Promise<PluginMarketSnapshot> = loadPluginMarketSnapshot,
) {
  let catalog: readonly OfficialPluginCatalogItem[] = catalogSeed ?? [];
  const officialByPluginID = () => new Map(catalog.map((item) => [item.pluginID, item]));
  const externalCommitQueryOnlyInspections = new Set<string>();

  const listInstalledPlugins = async (options: PluginRequestOptions = {}): Promise<ReDevPluginRecord[]> => {
    const result = await client.catalog(options);
    return result.plugins;
  };

  const loadInventoryProjection = async (options: PluginRequestOptions = {}): Promise<PluginInventoryProjection> => {
    const installedPluginsPromise = listInstalledPlugins(options);
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
    const installedPlugins = await installedPluginsPromise;
    const [permissions, securityPolicies, permissionRequirementResults] = await Promise.all([
      client.listPermissions({ active_only: true }, options),
      client.listSecurityPolicies(options),
      Promise.allSettled(installedPlugins.map((plugin) => client.getPermissionRequirements({
        plugin_instance_id: plugin.plugin_instance_id,
      }, options))),
    ]);
    const permissionRequirements = permissionRequirementResults.flatMap((result) => {
      if (result.status === 'fulfilled') return [result.value];
      throw result.reason;
    });
    const projection = projectPluginInventory({
      officialCatalog: catalog,
      installedPlugins,
      permissionGrants: permissions.permissions,
      permissionRequirements,
      securityPolicies: securityPolicies.security_policies,
    });
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
    if (result.status === 'committed' && inspection.intent.action === 'install' && result.plugin?.plugin_instance_id) {
      const committedResult = result as ExternalPluginCommitResult;
      const requirements = await client.getPermissionRequirements({
        plugin_instance_id: committedResult.plugin.plugin_instance_id,
      }, options);
      const enabled = await authorizeAndEnablePlugin(
        committedResult.plugin.plugin_instance_id,
        requirements.required_permissions,
        options,
      );
      return {
        ...committedResult,
        plugin: {
          ...enabled,
          presentation: enabled.presentation ?? committedResult.plugin.presentation,
        },
      } as ExternalPluginCommitResult;
    }
    return result as ExternalPluginCommitResult;
  };

  const installOfficialRelease = async (
    command: Extract<PluginManagementCommand, { type: 'install' }>,
    requestID: string,
    options: PluginRequestOptions = {},
    onUpdate?: (operation: PluginReleaseInstallOperation) => void,
  ): Promise<PluginReleaseInstallOperation> => {
    const official = requireOfficialPlugin(officialByPluginID(), command.pluginID);
    const approvedPermissionIDs = [...(command.approvedPermissionIDs ?? [])];
    const operation = await client.startReleaseInstallOperation({
      request_id: requestID,
      plugin_instance_id: official.pluginInstanceID,
      release_ref: official.distribution.releaseRef,
      activate_after_install: true,
      ...(approvedPermissionIDs.length > 0 ? { approved_permission_ids: approvedPermissionIDs } : {}),
    }, options);
    onUpdate?.(operation);
    if (isReleaseInstallTerminal(operation)) return operation;
    return client.watchReleaseInstallOperation(operation.operation_id, {
      ...options,
      onUpdate,
    });
  };

  const listReleaseInstallOperations = async (
    options: PluginRequestOptions = {},
  ): Promise<PluginReleaseInstallOperation[]> => (
    (await client.listReleaseInstallOperations(options)).operations
  );

  const getReleaseInstallOperationByRequest = (
    requestID: string,
    options: PluginRequestOptions = {},
  ): Promise<PluginReleaseInstallOperation> => (
    client.getReleaseInstallOperationByRequest(requestID, options)
  );

  const watchReleaseInstallOperation = (
    operationID: string,
    options: PluginRequestOptions = {},
    onUpdate?: (operation: PluginReleaseInstallOperation) => void,
  ): Promise<PluginReleaseInstallOperation> => (
    client.watchReleaseInstallOperation(operationID, {
      ...options,
      ...(onUpdate ? { onUpdate } : {}),
    })
  );

  const refreshEnabledRuntimeState = (options: PluginRequestOptions = {}) => (
    client.refreshEnabledRuntimeState(options)
  );

  // The install confirmation is the user's authorization decision. The Host
  // remains authoritative for the required permission set and every revision.
  const authorizeAndEnablePlugin = async (
    pluginInstanceID: string,
    permissionIDs: readonly string[],
    options: PluginRequestOptions = {},
  ) => {
    const catalogResult = await client.catalog(options);
    const record = catalogResult.plugins.find((plugin) => plugin.plugin_instance_id === pluginInstanceID);
    if (!record) throw new Error('Installed plugin record was not found while authorizing installation');
    // The registry is the current lifecycle authority. A release-install
    // operation may still carry its original needs_attention activation
    // snapshot after a later enable mutation has committed.
    if (record.enable_state === 'enabled') return record;
    const [requirements, grants, policies] = await Promise.all([
      client.getPermissionRequirements({ plugin_instance_id: pluginInstanceID }, options),
      client.listPermissions({ active_only: true }, options),
      client.listSecurityPolicies(options),
    ]);
    const requested = [...new Set(permissionIDs.map((permissionID) => permissionID.trim()).filter(Boolean))];
    const required = new Set(requirements.required_permissions);
    if (requested.some((permissionID) => !required.has(permissionID))) {
      throw new Error('The installation requested a permission outside the Host-verified requirement set');
    }
    const policy = policies.security_policies.find((candidate) => candidate.plugin_instance_id === pluginInstanceID);
    let revisions = {
      policyRevision: record.policy_revision,
      managementRevision: record.management_revision,
      revokeEpoch: record.revoke_epoch,
    };
    for (const permissionID of requested) {
      const current = grants.permissions.find((grant) => (
        grant.plugin_instance_id === pluginInstanceID && grant.permission_id === permissionID && !grant.revoked_at
      ));
      if (current?.effect === 'deny') {
        throw new Error(`Permission ${permissionID} is explicitly denied`);
      }
      if (policy && !policy.allowed_permissions.includes(permissionID)) {
        throw new Error(`Permission ${permissionID} is blocked by environment policy`);
      }
      if (current?.effect === 'grant') continue;
      const result = await withPostInstallMutationTimeout(
        (signal) => client.grantPermission({
          plugin_instance_id: pluginInstanceID,
          permission_id: permissionID,
          expected_policy_revision: revisions.policyRevision,
          expected_management_revision: revisions.managementRevision,
          expected_revoke_epoch: revisions.revokeEpoch,
        }, { ...options, signal }),
        options.signal,
        `Granting ${permissionID}`,
      );
      revisions = {
        policyRevision: result.revisions.policy_revision,
        managementRevision: result.revisions.management_revision,
        revokeEpoch: result.revisions.revoke_epoch,
      };
    }
    return withPostInstallMutationTimeout(
      (signal) => client.enablePlugin({
        plugin_instance_id: pluginInstanceID,
        expected_management_revision: revisions.managementRevision,
      }, { ...options, signal }),
      options.signal,
      'Enabling the installed plugin',
    );
  };

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

  return Object.freeze({
    listInstalledPlugins,
    loadInventoryProjection,
    loadMarketDetail: loadPluginMarketDetail,
    inspectExternalPackage,
    commitExternalPackage,
    installOfficialRelease,
    listReleaseInstallOperations,
    getReleaseInstallOperationByRequest,
    watchReleaseInstallOperation,
    refreshEnabledRuntimeState,
    authorizeAndEnablePlugin,
    execute,
  });
}

async function withPostInstallMutationTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
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
    }, POST_INSTALL_MUTATION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

function isReleaseInstallTerminal(operation: PluginReleaseInstallOperation): boolean {
  return operation.status === 'succeeded' || operation.status === 'failed';
}

async function loadPluginMarketSnapshot(signal?: AbortSignal): Promise<PluginMarketSnapshot> {
  return fetchLocalApiJSON<PluginMarketSnapshot>(
    '/_redeven_proxy/api/plugins/market/catalog',
    { method: 'GET', signal },
  );
}

export async function loadPluginMarketDetail(pluginID: string, signal?: AbortSignal): Promise<PluginMarketDetail> {
  if (!/^[a-z][a-z0-9._-]{0,127}$/.test(pluginID)) throw new Error('Invalid plugin id');
  const response = await fetchLocalApiJSONResponse<PluginMarketDetail>(
    `/_redeven_proxy/api/plugins/market/plugins/${encodeURIComponent(pluginID)}`,
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
