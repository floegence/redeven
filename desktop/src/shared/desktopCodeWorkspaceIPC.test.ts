import { describe, expect, it } from 'vitest';

import {
  normalizeDesktopCodeWorkspaceCancelRequest,
  normalizeDesktopCodeWorkspacePackagePrepareRequest,
  normalizeDesktopCodeWorkspacePackagePrepareResponse,
  normalizeDesktopCodeWorkspaceProgress,
  terminalDesktopCodeWorkspaceProgress,
} from './desktopCodeWorkspaceIPC';

describe('desktop code workspace IPC', () => {
  it('keeps valid operation ids on prepare requests', () => {
    expect(normalizeDesktopCodeWorkspacePackagePrepareRequest({
      operation_id: 'browser-editor:1',
      platform: { os: 'linux', arch: 'amd64', libc: 'glibc', platform_id: 'linux-amd64-glibc' },
    })).toEqual({
      operation_id: 'browser-editor:1',
      platform: { os: 'linux', arch: 'amd64', libc: 'glibc', platform_id: 'linux-amd64-glibc' },
    });
    expect(normalizeDesktopCodeWorkspacePackagePrepareRequest({
      platform: { os: 'linux', arch: 'amd64', libc: 'glibc', platform_id: 'linux-amd64-glibc' },
    })).toBeNull();
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
      phase: 'download',
      state: 'running',
      completed_bytes: -1,
      total_bytes: 10,
      updated_at_unix_ms: 1,
    })).toEqual({
      operation_id: 'browser-editor:1',
      phase: 'download',
      state: 'running',
      total_bytes: 10,
      updated_at_unix_ms: 1,
    });
  });

  it('keeps only stable package preparation failure codes', () => {
    expect(normalizeDesktopCodeWorkspacePackagePrepareResponse({
      ok: false,
      error_code: 'desktop_release_lookup',
      message: 'opaque failure',
    })).toEqual({
      ok: false,
      error_code: 'desktop_release_lookup',
      message: 'opaque failure',
    });
    expect(normalizeDesktopCodeWorkspacePackagePrepareResponse({
      ok: false,
      error_code: 'message-derived-code',
    })).toEqual({ ok: false, message: undefined });
  });

  it('keeps the last confirmed bytes when a transfer terminates', () => {
    expect(terminalDesktopCodeWorkspaceProgress({
      phase: 'download',
      state: 'running',
      completed_bytes: 96,
      total_bytes: 188,
    }, 'download', 'cancelled')).toEqual({
      phase: 'download',
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
