import { describe, expect, it } from 'vitest';

import {
  codeRuntimeManagedActionLabel,
  codeRuntimeOperationCancelled,
  codeRuntimeOperationFailed,
  codeRuntimeOperationNeedsAttention,
  codeRuntimeOperationSucceeded,
  type CodeRuntimeStatus,
} from './codeRuntimeApi';

function makeStatus(state: CodeRuntimeStatus['operation']['state']): CodeRuntimeStatus {
  return {
    active_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: '/Users/test/.redeven/shared/code-server/darwin-arm64/versions/4.109.1/bin/code-server',
      version: '4.109.1',
    },
    managed_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: '/Users/test/.redeven/shared/code-server/darwin-arm64/versions/4.109.1/bin/code-server',
      version: '4.109.1',
    },
    managed_prefix: '/Users/test/.redeven/local-environment/apps/code/runtime/managed',
    shared_runtime_root: '/Users/test/.redeven/shared/code-server/darwin-arm64',
    environment_selection_version: '4.109.1',
    environment_selection_source: 'environment',
    local_environment_default_version: '4.109.1',
    installed_versions: [
      {
        version: '4.109.1',
        binary_path: '/Users/test/.redeven/shared/code-server/darwin-arm64/versions/4.109.1/bin/code-server',
        selection_count: 1,
        selected_by_current_environment: true,
        default_for_new_environments: true,
        removable: false,
        detection_state: 'ready',
      },
    ],
    installer_script_url: 'https://code-server.dev/install.sh',
    operation: {
      action: 'install',
      state,
      log_tail: [],
    },
    updated_at_unix_ms: 1,
  };
}

describe('codeRuntimeApi selectors', () => {
  it('treats failed and cancelled operations as attention states', () => {
    expect(codeRuntimeOperationNeedsAttention(makeStatus('failed'))).toBe(true);
    expect(codeRuntimeOperationNeedsAttention(makeStatus('cancelled'))).toBe(true);
    expect(codeRuntimeOperationNeedsAttention(makeStatus('running'))).toBe(false);
  });

  it('exposes terminal outcome helpers', () => {
    expect(codeRuntimeOperationSucceeded(makeStatus('succeeded'))).toBe(true);
    expect(codeRuntimeOperationFailed(makeStatus('failed'))).toBe(true);
    expect(codeRuntimeOperationCancelled(makeStatus('cancelled'))).toBe(true);
    expect(codeRuntimeOperationSucceeded(makeStatus('idle'))).toBe(false);
  });

  it('labels install actions around Local Environment-scoped reuse', () => {
    expect(codeRuntimeManagedActionLabel({
      ...makeStatus('idle'),
      installed_versions: [],
      active_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'none',
      },
      managed_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'managed',
      },
      environment_selection_source: 'none',
    })).toBe('Install and use for this environment');

    expect(codeRuntimeManagedActionLabel(makeStatus('idle'))).toBe('Install latest and use for this environment');
  });
});
