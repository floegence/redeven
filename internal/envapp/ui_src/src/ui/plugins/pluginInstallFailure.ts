import { PluginPlatformRequestError } from '@floegence/redevplugin-ui';

import type {
  PluginInstallFailure,
  PluginInstallFailureRecovery,
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
  | 'trust'
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
    case 'PLUGIN_RELEASE_REF_VERIFICATION_FAILED':
    case 'PLUGIN_RELEASE_REF_POLICY_DENIED':
    case 'PLUGIN_SIGNATURE_INVALID':
    case 'PLUGIN_TRUST_STATE_DENIED':
    case 'PLUGIN_TRUST_VERIFICATION_REQUIRED':
    case 'PLUGIN_TRUST_VERIFICATION_INVALID': return 'trust';
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
  retryable: boolean;
  hasReviewedCommand: boolean;
}>): PluginInstallFailure {
  return {
    source: 'execution',
    code: input.code,
    ...(input.stage ? { stage: input.stage } : {}),
    retryable: input.retryable,
    recovery: executionRecovery(input.code, input.retryable, input.hasReviewedCommand),
  };
}

export function submissionInstallFailure(error: unknown): PluginInstallFailure {
  if (error instanceof PluginPlatformRequestError) {
    if (error.mutationOutcome === 'unknown' || error.mutationOutcome === 'committed') {
      return {
        source: 'submission',
        code: error.errorCode,
        retryable: true,
        recovery: 'replay_submission',
      };
    }
    return {
      source: 'submission',
      code: error.errorCode,
      retryable: false,
      recovery: 'review_again',
    };
  }
  return {
    source: 'submission',
    code: 'PLUGIN_INSTALL_SUBMISSION_UNKNOWN',
    retryable: true,
    recovery: 'replay_submission',
  };
}

export function inventoryInstallFailure(): PluginInstallFailure {
  return {
    source: 'inventory',
    code: 'PLUGIN_INVENTORY_REFRESH_FAILED',
    retryable: true,
    recovery: 'refresh_inventory',
  };
}

export function setupInstallFailure(): PluginInstallFailure {
  return {
    source: 'setup',
    code: 'PLUGIN_APPROVED_SETUP_FAILED',
    retryable: true,
    recovery: 'retry_setup',
  };
}

function executionRecovery(
  code: string,
  retryable: boolean,
  hasReviewedCommand: boolean,
): PluginInstallFailureRecovery {
  if (!hasReviewedCommand) return 'review_again';
  if (code === 'PLUGIN_RETAINED_DATA_INCOMPATIBLE') return 'erase_retained_data';
  return retryable ? 'retry_install' : 'none';
}
