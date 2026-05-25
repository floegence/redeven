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
    managed_runtime_version: '4.109.1',
    managed_runtime_source: 'managed',
    installed_versions: [
      {
        version: '4.109.1',
        binary_path: '/Users/test/.redeven/shared/code-server/darwin-arm64/versions/4.109.1/bin/code-server',
        selected_by_local_environment: true,
        removable: false,
        detection_state: 'ready',
      },
    ],
    operation: {
      action: 'prepare_workspace_engine',
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

  it('labels Browser Editor setup, update, and retry actions', () => {
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
      managed_runtime_source: 'none',
    })).toBe('Set up browser editor');

    expect(codeRuntimeManagedActionLabel(makeStatus('idle'))).toBe('Update browser editor');

    expect(codeRuntimeManagedActionLabel({
      ...makeStatus('failed'),
      operation: {
        action: 'prepare_workspace_engine',
        state: 'failed',
        last_error: 'Download failed.',
        log_tail: [],
      },
    })).toBe('Retry setup');
  });
});
