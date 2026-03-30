import { describe, expect, it } from 'vitest';

import {
  codeRuntimeOperationCancelled,
  codeRuntimeOperationFailed,
  codeRuntimeOperationNeedsAttention,
  codeRuntimeOperationSucceeded,
  type CodeRuntimeStatus,
} from './codeRuntimeApi';

function makeStatus(state: CodeRuntimeStatus['operation']['state']): CodeRuntimeStatus {
  return {
    supported_version: '4.108.2',
    active_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: '/Users/test/.redeven/apps/code/runtime/managed/bin/code-server',
      installed_version: '4.108.2',
    },
    managed_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: '/Users/test/.redeven/apps/code/runtime/managed/bin/code-server',
      installed_version: '4.108.2',
    },
    managed_prefix: '/Users/test/.redeven/apps/code/runtime/managed',
    installer_script_url: 'https://raw.githubusercontent.com/coder/code-server/v4.108.2/install.sh',
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
});
