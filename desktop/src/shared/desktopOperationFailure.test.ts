import { describe, expect, it } from 'vitest';

import {
  formatDesktopOperationFailureForClipboard,
  normalizeDesktopOperationFailurePresentation,
} from './desktopOperationFailure';

describe('desktopOperationFailure', () => {
  it('normalizes user-facing failure copy separately from diagnostics', () => {
    expect(normalizeDesktopOperationFailurePresentation({
      code: 'ssh_connection_failed',
      severity: 'error',
      title: ' SSH Connection Failed ',
      summary: ' SSH connection to "dify" failed. ',
      detail: ' Desktop could not verify runtime status. ',
      recovery_hint: ' Check SSH config. ',
      target_label: ' dify ',
      diagnostics: [
        { channel: ' control_stderr ', label: ' SSH stderr ', text: ' ssh: Could not resolve hostname dify ' },
        { channel: 'empty', label: 'Empty', text: '   ' },
      ],
    })).toEqual({
      code: 'ssh_connection_failed',
      severity: 'error',
      title: 'SSH Connection Failed',
      summary: 'SSH connection to "dify" failed.',
      detail: 'Desktop could not verify runtime status.',
      recovery_hint: 'Check SSH config.',
      target_label: 'dify',
      diagnostics: [{
        channel: 'control_stderr',
        label: 'SSH stderr',
        text: 'ssh: Could not resolve hostname dify',
      }],
    });
  });

  it('formats clipboard details without promoting diagnostic stream names to the summary', () => {
    const text = formatDesktopOperationFailureForClipboard({
      code: 'ssh_connection_failed',
      severity: 'error',
      title: 'SSH Connection Failed',
      summary: 'SSH connection to "dify" failed.',
      diagnostics: [{
        channel: 'control_stderr',
        label: 'SSH stderr',
        text: 'ssh: Could not resolve hostname dify',
      }],
    });

    expect(text.split('\n')[1]).toBe('SSH connection to "dify" failed.');
    expect(text).toContain('SSH stderr (control_stderr):');
    expect(text).toContain('ssh: Could not resolve hostname dify');
  });

  it('normalizes host-command failure codes used by runtime management surfaces', () => {
    expect(normalizeDesktopOperationFailurePresentation({
      code: 'runtime_host_command_failed',
      severity: 'error',
      title: 'Container List Failed',
      summary: 'Desktop could not list running docker containers on dify.',
    })?.code).toBe('runtime_host_command_failed');
    expect(normalizeDesktopOperationFailurePresentation({
      code: 'ssh_runtime_stop_failed',
      severity: 'error',
      title: 'SSH Runtime Stop Failed',
      summary: 'Desktop could not stop the SSH runtime.',
    })?.code).toBe('ssh_runtime_stop_failed');
    expect(normalizeDesktopOperationFailurePresentation({
      code: 'local_runtime_stop_failed',
      severity: 'error',
      title: 'Runtime Stop Failed',
      summary: 'Desktop could not stop the local runtime.',
    })?.code).toBe('local_runtime_stop_failed');
    expect(normalizeDesktopOperationFailurePresentation({
      code: 'container_runtime_stop_failed',
      severity: 'error',
      title: 'Container Runtime Stop Failed',
      summary: 'Desktop could not stop the container runtime.',
    })?.code).toBe('container_runtime_stop_failed');
  });
});
