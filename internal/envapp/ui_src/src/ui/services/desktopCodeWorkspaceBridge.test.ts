import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopCodeWorkspaceBridge } from './desktopCodeWorkspaceBridge';

let bridge: DesktopCodeWorkspaceBridge | null = null;
const appendChunk = vi.fn();
const completeSession = vi.fn();

vi.mock('./desktopHostWindow', () => ({
  readDesktopHostBridge: () => bridge,
}));

vi.mock('./codeRuntimeApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./codeRuntimeApi')>();
  return {
    ...actual,
    createCodeRuntimeImportSession: vi.fn(async () => ({
      upload_id: 'upload_1',
      operation_id: 'upload_1',
      chunk_size_bytes: 2,
      expected_bytes: 4,
    })),
    appendCodeRuntimeImportChunk: appendChunk,
    completeCodeRuntimeImportSession: completeSession,
  };
});

describe('desktopCodeWorkspaceBridge', () => {
  beforeEach(() => {
    appendChunk.mockReset();
    completeSession.mockReset();
    let chunkIndex = 0;
    appendChunk.mockImplementation(async () => {
      chunkIndex += 1;
      return {
        upload_id: 'upload_1',
        received_bytes: chunkIndex * 2,
        expected_bytes: 4,
        next_chunk_index: chunkIndex,
      };
    });
    completeSession.mockResolvedValue({ operation: { state: 'succeeded' } });
  });

  it('reports Runtime-confirmed progress for session-mediated uploads', async () => {
    const dispose = vi.fn(async () => ({ ok: true }));
    bridge = {
      prepareWorkspaceEngine: vi.fn(),
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
    const { prepareWorkspaceEngineThroughSession } = await import('./desktopCodeWorkspaceBridge');
    const progress: any[] = [];

    const result = await prepareWorkspaceEngineThroughSession({
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
    });

    expect(result).toMatchObject({ ok: true, prepared: true });
    expect(progress.map((item) => [item.phase, item.completed_bytes, item.total_bytes, item.state])).toEqual([
      ['upload', 0, 4, 'running'],
      ['upload', 2, 4, 'running'],
      ['upload', 4, 4, 'running'],
      ['upload', 4, 4, 'completed'],
    ]);
    expect(dispose).toHaveBeenCalledWith({ job_id: 'job_1' });
  });
});
