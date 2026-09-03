import { describe, expect, it } from 'vitest';

import { classifyDesktopRuntimeBlockedLaunchReport } from '../shared/desktopRuntimeHealth';
import { desktopOperationFailureFromBlockedLaunchReport } from './runtimeBlockedLaunchFailure';

const incompatibleReport = {
  status: 'blocked' as const,
  code: 'startup_failed',
  message: 'wrong database kind: expected portforward_registry_v1, got portforward_registry',
  diagnostics: {
    failure_code: 'runtime_state_incompatible',
    state_dir: '/home/dev/.redeven/local-environment',
  },
};

describe('blocked Runtime launch failure', () => {
  it('creates the one reinstall failure contract with the original report', () => {
    const classification = classifyDesktopRuntimeBlockedLaunchReport(incompatibleReport);
    const failure = desktopOperationFailureFromBlockedLaunchReport({
      report: incompatibleReport,
      classification,
      targetLabel: 'orange',
      diagnostics: [{ channel: 'control_stderr', label: 'SSH stderr', text: 'connection log' }],
    });

    expect(failure?.presentation).toMatchObject({
      code: 'reinstall_required',
      target_label: 'orange',
      detail: incompatibleReport.message,
      diagnostics: [{
        channel: 'runtime_startup_report',
        text: expect.stringContaining('failure code: runtime_state_incompatible'),
      }, {
        channel: 'control_stderr',
        text: 'connection log',
      }],
    });
  });

  it('does not reinterpret other blocked launch states as reinstall failures', () => {
    expect(desktopOperationFailureFromBlockedLaunchReport({
      report: {
        status: 'blocked',
        code: 'not_running',
        message: 'Runtime is not running.',
      },
      targetLabel: 'orange',
    })).toBeNull();
  });
});
