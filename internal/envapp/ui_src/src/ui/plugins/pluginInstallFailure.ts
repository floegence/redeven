import type {
  PluginInstallFailure,
} from './pluginTypes';

export type PluginFailureCategory =
  | 'network'
  | 'timeout'
  | 'asset_missing'
  | 'asset_integrity'
  | 'interrupted'
  | 'state_conflict'
  | 'retained_data_incompatible'
  | 'denied'
  | 'manifest_invalid'
  | 'package_invalid'
  | 'package_too_large'
  | 'package_path_forbidden'
  | 'runtime_unavailable'
  | 'runtime_incompatible'
  | 'platform_unavailable'
  | 'contract_mismatch'
  | 'internal';

export function pluginFailureCategory(code: string): PluginFailureCategory {
  switch (code) {
    case 'PLUGIN_RELEASE_NETWORK': return 'network';
    case 'PLUGIN_RELEASE_TIMEOUT': return 'timeout';
    case 'PLUGIN_RELEASE_ASSET_MISSING': return 'asset_missing';
    case 'PLUGIN_RELEASE_ASSET_INTEGRITY': return 'asset_integrity';
    case 'PLUGIN_INSTALL_INTERRUPTED': return 'interrupted';
    case 'PLUGIN_INSTALL_STATE_CONFLICT': return 'state_conflict';
    case 'PLUGIN_RETAINED_DATA_INCOMPATIBLE': return 'retained_data_incompatible';
    case 'PLUGIN_ACTION_DENIED':
    case 'PLUGIN_PERMISSION_DENIED': return 'denied';
    case 'PLUGIN_MANIFEST_INVALID': return 'manifest_invalid';
    case 'PLUGIN_PACKAGE_TOO_LARGE': return 'package_too_large';
    case 'PLUGIN_PACKAGE_PATH_FORBIDDEN': return 'package_path_forbidden';
    case 'PLUGIN_PACKAGE_INVALID': return 'package_invalid';
    case 'PLUGIN_RUNTIME_UNAVAILABLE':
      return 'runtime_unavailable';
    case 'PLUGIN_RUNTIME_VERSION_MISMATCH':
    case 'PLUGIN_RUNTIME_CONTRACT_MISMATCH': return 'runtime_incompatible';
    case 'PLUGIN_FEATURE_NOT_CONFIGURED': return 'platform_unavailable';
    case 'PLUGIN_CONTRACT_MISMATCH': return 'contract_mismatch';
    default: return 'internal';
  }
}

export function executionInstallFailure(input: Readonly<{
  code: string;
  stage?: PluginInstallFailure['stage'];
}>): PluginInstallFailure {
  return { source: 'execution', code: input.code,
    ...(input.stage ? { stage: input.stage } : {}),
    retryable: false, recovery: 'review_again' };
}

export function inventoryInstallFailure(): PluginInstallFailure {
  return { source: 'inventory', code: 'PLUGIN_INVENTORY_REFRESH_FAILED', retryable: true, recovery: 'refresh_inventory' };
}
