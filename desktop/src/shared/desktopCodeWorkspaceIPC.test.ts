import { describe, expect, it } from 'vitest';

import {
  normalizeDesktopCodeWorkspaceCancelRequest,
  normalizeDesktopCodeWorkspacePackagePrepareRequest,
  normalizeDesktopCodeWorkspacePrepareRequest,
  normalizeDesktopCodeWorkspaceProgress,
  terminalDesktopCodeWorkspaceProgress,
} from './desktopCodeWorkspaceIPC';

describe('desktop code workspace IPC', () => {
  it('keeps valid operation ids on prepare requests', () => {
    expect(normalizeDesktopCodeWorkspacePrepareRequest({
      reason: 'start',
      operation_id: ' browser-editor:1 ',
    })).toEqual({ reason: 'start', operation_id: 'browser-editor:1' });
    expect(normalizeDesktopCodeWorkspacePackagePrepareRequest({
      operation_id: 'browser-editor:1',
      platform: { os: 'linux', arch: 'amd64', libc: 'glibc', platform_id: 'linux-amd64-glibc' },
    })).toEqual({
      operation_id: 'browser-editor:1',
      platform: { os: 'linux', arch: 'amd64', libc: 'glibc', platform_id: 'linux-amd64-glibc' },
    });
  });

  it('rejects invalid cancellation and progress payloads', () => {
    expect(normalizeDesktopCodeWorkspaceCancelRequest({ operation_id: '   ' })).toBeNull();
    expect(normalizeDesktopCodeWorkspaceProgress({
      operation_id: 'browser-editor:1',
      phase: 'unknown',
      state: 'running',
      updated_at_unix_ms: 1,
    })).toBeNull();
    expect(normalizeDesktopCodeWorkspaceProgress({
      operation_id: 'browser-editor:1',
      phase: 'upload',
      state: 'running',
      completed_bytes: -1,
      total_bytes: 10,
      updated_at_unix_ms: 1,
    })).toEqual({
      operation_id: 'browser-editor:1',
      phase: 'upload',
      state: 'running',
      total_bytes: 10,
      updated_at_unix_ms: 1,
    });
  });

  it('keeps the last confirmed bytes when a transfer terminates', () => {
    expect(terminalDesktopCodeWorkspaceProgress({
      phase: 'upload',
      state: 'running',
      completed_bytes: 96,
      total_bytes: 188,
    }, 'upload', 'cancelled')).toEqual({
      phase: 'upload',
      state: 'cancelled',
      completed_bytes: 96,
      total_bytes: 188,
    });

    expect(terminalDesktopCodeWorkspaceProgress({
      phase: 'download',
      state: 'completed',
      completed_bytes: 188,
      total_bytes: 188,
    }, 'package_validation', 'failed')).toEqual({
      phase: 'package_validation',
      state: 'failed',
    });
  });
});
