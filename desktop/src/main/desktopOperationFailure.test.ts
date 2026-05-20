import { describe, expect, it } from 'vitest';

import {
  DesktopOperationFailureError,
  desktopOperationFailurePresentation,
  diagnosticsFromRecentLogs,
  operationFailureFromUnknown,
} from './desktopOperationFailure';

describe('desktopOperationFailure main helpers', () => {
  it('preserves typed failure presentation across main-process boundaries', () => {
    const failure = desktopOperationFailurePresentation({
      code: 'ssh_connection_failed',
      title: 'SSH Connection Failed',
      summary: 'SSH connection to "dify" failed.',
      targetLabel: 'dify',
    });

    expect(operationFailureFromUnknown(new DesktopOperationFailureError(failure), desktopOperationFailurePresentation({
      title: 'Fallback',
      summary: 'Fallback summary.',
    }))).toEqual(failure);
  });

  it('converts recent logs into diagnostics without creating visible copy', () => {
    expect(diagnosticsFromRecentLogs({
      control_stderr: ' ssh: Could not resolve hostname dify ',
      master_stderr: '   ',
    }, {
      control_stderr: 'SSH command stderr',
    })).toEqual([{
      channel: 'control_stderr',
      label: 'SSH command stderr',
      text: 'ssh: Could not resolve hostname dify',
    }]);
  });
});
