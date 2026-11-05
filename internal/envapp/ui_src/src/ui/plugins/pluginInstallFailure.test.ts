import { describe, expect, it } from 'vitest';

import {
  executionInstallFailure,
  pluginFailureCategory,
  type PluginFailureCategory,
} from './pluginInstallFailure';

const installErrors: ReadonlyArray<readonly [string, PluginFailureCategory]> = [
  ['PLUGIN_MANIFEST_INVALID', 'manifest_invalid'],
  ['PLUGIN_PACKAGE_INVALID', 'package_invalid'],
  ['PLUGIN_PACKAGE_TOO_LARGE', 'package_too_large'],
  ['PLUGIN_PACKAGE_PATH_FORBIDDEN', 'package_path_forbidden'],
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

  it.each(['PLUGIN_RELEASE_NETWORK', 'PLUGIN_INTERNAL_FAILURE', 'PLUGIN_RETAINED_DATA_INCOMPATIBLE'])('requires fresh review after terminal failure %s', (code) => {
    expect(executionInstallFailure({ code, stage: 'install' })).toMatchObject({ retryable: false, recovery: 'review_again' });
  });
});
