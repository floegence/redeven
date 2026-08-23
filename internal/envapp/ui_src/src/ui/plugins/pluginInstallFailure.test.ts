import { PluginPlatformRequestError } from '@floegence/redevplugin-ui';
import { describe, expect, it } from 'vitest';

import {
  executionInstallFailure,
  pluginFailureCategory,
  submissionInstallFailure,
  type PluginFailureCategory,
} from './pluginInstallFailure';

const installErrors: ReadonlyArray<readonly [string, PluginFailureCategory]> = [
  ['PLUGIN_MANIFEST_INVALID', 'manifest_invalid'],
  ['PLUGIN_PACKAGE_INVALID', 'package_invalid'],
  ['PLUGIN_PACKAGE_TOO_LARGE', 'package_too_large'],
  ['PLUGIN_PACKAGE_PATH_FORBIDDEN', 'package_path_forbidden'],
  ['PLUGIN_SIGNATURE_INVALID', 'trust'],
  ['PLUGIN_TRUST_STATE_DENIED', 'trust'],
  ['PLUGIN_TRUST_VERIFICATION_REQUIRED', 'trust'],
  ['PLUGIN_TRUST_VERIFICATION_INVALID', 'trust'],
  ['PLUGIN_RELEASE_REF_VERIFICATION_FAILED', 'trust'],
  ['PLUGIN_RELEASE_REF_POLICY_DENIED', 'trust'],
  ['PLUGIN_RELEASE_NETWORK', 'network'],
  ['PLUGIN_RELEASE_TIMEOUT', 'timeout'],
  ['PLUGIN_RELEASE_ASSET_MISSING', 'asset_missing'],
  ['PLUGIN_RELEASE_ASSET_INTEGRITY', 'asset_integrity'],
  ['PLUGIN_INSTALL_INTERRUPTED', 'interrupted'],
  ['PLUGIN_INSTALL_STATE_CONFLICT', 'state_conflict'],
  ['PLUGIN_RETAINED_DATA_INCOMPATIBLE', 'retained_data_incompatible'],
  ['PLUGIN_PERMISSION_DENIED', 'denied'],
  ['PLUGIN_ACTION_DENIED', 'denied'],
  ['PLUGIN_RUNTIME_UNAVAILABLE', 'runtime_unavailable'],
  ['PLUGIN_RUNTIME_VERSION_MISMATCH', 'runtime_incompatible'],
  ['PLUGIN_RUNTIME_CONTRACT_MISMATCH', 'runtime_incompatible'],
  ['PLUGIN_FEATURE_NOT_CONFIGURED', 'platform_unavailable'],
  ['PLUGIN_CONTRACT_MISMATCH', 'contract_mismatch'],
  ['PLUGIN_ADAPTER_FAILURE', 'internal'],
  ['PLUGIN_INTERNAL_FAILURE', 'internal'],
];

describe('plugin install failure projection', () => {
  it.each(installErrors)('projects %s through one stable category map', (code, expected) => {
    expect(pluginFailureCategory(code)).toBe(expected);
  });

  it('uses the platform retryable fact and never guesses it from the code', () => {
    expect(executionInstallFailure({
      code: 'PLUGIN_INTERNAL_FAILURE',
      stage: 'install',
      retryable: true,
      hasReviewedCommand: true,
    })).toMatchObject({ retryable: true, recovery: 'retry_install' });
    expect(executionInstallFailure({
      code: 'PLUGIN_RELEASE_NETWORK',
      stage: 'download',
      retryable: false,
      hasReviewedCommand: true,
    })).toMatchObject({ retryable: false, recovery: 'none' });
  });

  it('requires a fresh review when an exact reviewed command is unavailable', () => {
    expect(executionInstallFailure({
      code: 'PLUGIN_RELEASE_NETWORK',
      stage: 'download',
      retryable: true,
      hasReviewedCommand: false,
    }).recovery).toBe('review_again');
  });

  it('replays unknown or committed submissions but re-reviews definitely rejected submissions', () => {
    expect(submissionInstallFailure(new TypeError('connection lost')).recovery).toBe('replay_submission');
    expect(submissionInstallFailure(new PluginPlatformRequestError(
      'PLUGIN_INTERNAL_FAILURE',
      'response lost',
      {},
      'unknown',
    )).recovery).toBe('replay_submission');
    expect(submissionInstallFailure(new PluginPlatformRequestError(
      'PLUGIN_INTERNAL_FAILURE',
      'commit response lost',
      {},
      'committed',
    )).recovery).toBe('replay_submission');
    expect(submissionInstallFailure(new PluginPlatformRequestError(
      'PLUGIN_INVALID_REQUEST',
      'request rejected',
      {},
      'not_committed',
    )).recovery).toBe('review_again');
  });
});
