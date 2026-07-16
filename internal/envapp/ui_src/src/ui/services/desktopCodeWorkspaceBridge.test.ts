import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopCodeWorkspaceBridge } from './desktopCodeWorkspaceBridge';

let bridge: DesktopCodeWorkspaceBridge | null = null;
const appendChunk = vi.fn();
const cancelOperation = vi.fn();
const completeOperation = vi.fn();
const fetchStatus = vi.fn();
let receivedBytes = 0;

function setupStatus(state = 'running') {
  return {
    active_runtime: { detection_state: 'missing', present: false, source: 'none' },
    managed_runtime: { detection_state: 'missing', present: false, source: 'managed' },
    managed_prefix: '',
    shared_runtime_root: '',
    managed_runtime_source: 'none',
    installed_versions: [],
    operation: {
      action: 'prepare_workspace_engine',
      operation_id: 'browser-editor:1',
      install_method: 'desktop_transfer',
      state,
      stage: state === 'running' ? 'receiving' : 'finalizing',
      transfer: { received_bytes: receivedBytes, expected_bytes: 4 },
    },
    updated_at_unix_ms: receivedBytes + 1,
  };
}

vi.mock('./desktopHostWindow', () => ({
  readDesktopHostBridge: () => bridge,
}));

vi.mock('./codeRuntimeApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./codeRuntimeApi')>();
  return {
    ...actual,
    createCodeRuntimeSetupOperation: vi.fn(async () => ({
      operation_id: 'browser-editor:1',
      install_method: 'desktop_transfer',
      state: 'receiving',
      received_bytes: 0,
      chunk_size_bytes: 2,
      expected_bytes: 4,
      next_chunk_index: 0,
    })),
    appendCodeRuntimeSetupChunk: appendChunk,
    cancelCodeRuntimeSetupOperation: cancelOperation,
    completeCodeRuntimeSetupOperation: completeOperation,
    fetchCodeRuntimeStatus: fetchStatus,
  };
});

describe('desktopCodeWorkspaceBridge', () => {
  beforeEach(() => {
    appendChunk.mockReset();
    cancelOperation.mockReset();
    completeOperation.mockReset();
    fetchStatus.mockReset();
    receivedBytes = 0;
    appendChunk.mockImplementation(async () => {
      receivedBytes += 2;
      return {
        operation_id: 'browser-editor:1',
        received_bytes: receivedBytes,
        expected_bytes: 4,
        next_chunk_index: receivedBytes / 2,
      };
    });
    fetchStatus.mockImplementation(async () => setupStatus());
    completeOperation.mockImplementation(async () => setupStatus('succeeded'));
    cancelOperation.mockResolvedValue({ operation: { state: 'cancelled' } });
  });

  it('reports Runtime-confirmed progress for session-mediated uploads', async () => {
    const dispose = vi.fn(async () => ({ ok: true }));
    bridge = {
      prepareWorkspaceEnginePackage: vi.fn(async () => ({
        ok: true,
        job: {
          job_id: 'job_1',
          manifest: { engine: 'code-server' },
          archive_size_bytes: 4,
          chunk_size_bytes: 2,
          from_cache: false,
        },
      })),
      readWorkspaceEnginePackageChunk: vi.fn(async (request: any) => ({
        ok: true,
        chunk: new Uint8Array([1, 2]),
        offset_bytes: request.offset_bytes,
        length_bytes: 2,
        done: request.offset_bytes === 2,
      })),
      disposeWorkspaceEnginePackage: dispose,
    };
    const { prepareWorkspaceEngineWithDesktop } = await import('./desktopCodeWorkspaceBridge');
    const progress: any[] = [];
    const statuses: any[] = [];

    const result = await prepareWorkspaceEngineWithDesktop({
      operationID: 'browser-editor:1',
      status: {
        active_runtime: { detection_state: 'missing', present: false, source: 'none' },
        managed_runtime: { detection_state: 'missing', present: false, source: 'managed' },
        managed_prefix: '',
        shared_runtime_root: '',
        managed_runtime_source: 'none',
        installed_versions: [],
        platform: { os: 'linux', arch: 'amd64', libc: 'glibc', platform_id: 'linux-amd64-glibc' },
        operation: { state: 'idle' },
        updated_at_unix_ms: 1,
      },
      onProgress: (item) => progress.push(item),
      observer: { onRuntimeStatus: (status) => statuses.push(status) },
    });

    expect(result).toMatchObject({ ok: true, prepared: true });
    expect(progress).toEqual([]);
    expect(statuses.map((status) => [
      status.operation.state,
      status.operation.transfer.received_bytes,
      status.operation.transfer.expected_bytes,
    ])).toEqual([
      ['running', 0, 4],
      ['running', 2, 4],
      ['running', 4, 4],
      ['succeeded', 4, 4],
    ]);
    expect(dispose).toHaveBeenCalledWith({ job_id: 'job_1' });
  });

  it('terminates a created Runtime operation when Desktop package reading fails', async () => {
    const dispose = vi.fn(async () => ({ ok: true }));
    bridge = {
      prepareWorkspaceEnginePackage: vi.fn(async () => ({
        ok: true,
        job: {
          job_id: 'job_1',
          manifest: { engine: 'code-server' },
          archive_size_bytes: 4,
          chunk_size_bytes: 2,
          from_cache: false,
        },
      })),
      readWorkspaceEnginePackageChunk: vi.fn(async () => ({
        ok: false,
        message: 'Desktop package read failed.',
      })),
      disposeWorkspaceEnginePackage: dispose,
    };
    const { prepareWorkspaceEngineWithDesktop } = await import('./desktopCodeWorkspaceBridge');

    await expect(prepareWorkspaceEngineWithDesktop({
      operationID: 'browser-editor:1',
      status: {
        active_runtime: { detection_state: 'missing', present: false, source: 'none' },
        managed_runtime: { detection_state: 'missing', present: false, source: 'managed' },
        managed_prefix: '',
        shared_runtime_root: '',
        managed_runtime_source: 'none',
        installed_versions: [],
        platform: { os: 'linux', arch: 'amd64', libc: 'glibc', platform_id: 'linux-amd64-glibc' },
        operation: { state: 'idle' },
        updated_at_unix_ms: 1,
      },
    })).rejects.toMatchObject({
      source: 'desktop_upload',
      message: 'Desktop package read failed.',
    });

    expect(fetchStatus).toHaveBeenCalledOnce();
    expect(cancelOperation).toHaveBeenCalledWith('browser-editor:1');
    expect(dispose).toHaveBeenCalledWith({ job_id: 'job_1' });
  });

  it('preserves Desktop catalog failure codes without message classification', async () => {
    bridge = {
      prepareWorkspaceEnginePackage: vi.fn(async () => ({
        ok: false,
        error_code: 'desktop_release_lookup' as const,
        message: 'opaque failure',
      })),
      readWorkspaceEnginePackageChunk: vi.fn(),
    };
    const { prepareWorkspaceEngineWithDesktop } = await import('./desktopCodeWorkspaceBridge');

    await expect(prepareWorkspaceEngineWithDesktop({
      operationID: 'browser-editor:1',
      status: {
        active_runtime: { detection_state: 'missing', present: false, source: 'none' },
        managed_runtime: { detection_state: 'missing', present: false, source: 'managed' },
        managed_prefix: '',
        shared_runtime_root: '',
        managed_runtime_source: 'none',
        installed_versions: [],
        platform: { os: 'linux', arch: 'amd64', libc: 'glibc', platform_id: 'linux-amd64-glibc' },
        operation: { state: 'idle' },
        updated_at_unix_ms: 1,
      },
    })).rejects.toMatchObject({
      source: 'desktop_release_lookup',
      message: 'opaque failure',
    });
  });
});
