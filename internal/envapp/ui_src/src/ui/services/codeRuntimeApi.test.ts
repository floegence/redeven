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
      binary_path: '/Users/test/.redeven/apps/code/runtime/managed/bin/code-server',
    },
    managed_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: '/Users/test/.redeven/apps/code/runtime/managed/bin/code-server',
    },
    managed_prefix: '/Users/test/.redeven/apps/code/runtime/managed',
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

  it('labels the managed action around latest-stable install semantics', () => {
    expect(codeRuntimeManagedActionLabel({
      ...makeStatus('idle'),
      managed_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'managed',
      },
    })).toBe('Install latest');
    expect(codeRuntimeManagedActionLabel(makeStatus('idle'))).toBe('Update to latest');
  });
});
