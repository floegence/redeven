import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchJSON = vi.hoisted(() => vi.fn());

vi.mock('./localApi', () => ({
  fetchLocalApiJSON: fetchJSON,
}));

import {
  appendCodeRuntimeSetupChunk,
  codeRuntimeManagedActionLabel,
  codeRuntimeOperationCancelled,
  codeRuntimeOperationFailed,
  codeRuntimeOperationNeedsAttention,
  codeRuntimeOperationSucceeded,
  createCodeRuntimeSetupOperation,
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

describe('codeRuntimeApi setup operation contract', () => {
  beforeEach(() => {
    fetchJSON.mockReset();
  });

  it('accepts the production environment-download response without Desktop upload fields', async () => {
    fetchJSON.mockResolvedValue({
      operation_id: 'browser-editor:remote',
      install_method: 'remote_download',
      state: 'running',
      received_bytes: 0,
      expected_bytes: 0,
      next_chunk_index: 0,
      created_at_unix_ms: 1,
    });

    await expect(createCodeRuntimeSetupOperation({
      operationID: 'browser-editor:remote',
      installMethod: 'remote_download',
    })).resolves.toEqual({
      operation_id: 'browser-editor:remote',
      install_method: 'remote_download',
      state: 'running',
    });
  });

  it('rejects a remote response with a Desktop-only operation state', async () => {
    fetchJSON.mockResolvedValue({
      operation_id: 'browser-editor:remote',
      install_method: 'remote_download',
      state: 'receiving',
    });

    await expect(createCodeRuntimeSetupOperation({
      operationID: 'browser-editor:remote',
      installMethod: 'remote_download',
    })).rejects.toThrow('Runtime did not return a valid Browser Editor setup operation.');
  });

  it.each([
    'chunk_size_bytes',
    'expected_bytes',
    'received_bytes',
    'next_chunk_index',
  ])('rejects a Desktop response missing %s', async (missingField) => {
    const response: Record<string, unknown> = {
      operation_id: 'browser-editor:desktop',
      install_method: 'desktop_transfer',
      state: 'receiving',
      chunk_size_bytes: 1024,
      expected_bytes: 4096,
      received_bytes: 0,
      next_chunk_index: 0,
    };
    delete response[missingField];
    fetchJSON.mockResolvedValue(response);

    await expect(createCodeRuntimeSetupOperation({
      operationID: 'browser-editor:desktop',
      installMethod: 'desktop_transfer',
      manifest: { version: '4.128.0' },
    })).rejects.toThrow('Runtime did not return a valid Browser Editor setup operation.');
  });

  it('returns strict positive Desktop upload fields unchanged', async () => {
    fetchJSON.mockResolvedValue({
      operation_id: 'browser-editor:desktop',
      install_method: 'desktop_transfer',
      state: 'receiving',
      chunk_size_bytes: 1024,
      expected_bytes: 4096,
      received_bytes: 1024,
      next_chunk_index: 1,
    });

    await expect(createCodeRuntimeSetupOperation({
      operationID: 'browser-editor:desktop',
      installMethod: 'desktop_transfer',
      manifest: { version: '4.128.0' },
    })).resolves.toMatchObject({
      chunk_size_bytes: 1024,
      expected_bytes: 4096,
      received_bytes: 1024,
      next_chunk_index: 1,
    });
  });

  it('rejects fractional Desktop upload fields', async () => {
    fetchJSON.mockResolvedValue({
      operation_id: 'browser-editor:desktop',
      install_method: 'desktop_transfer',
      state: 'receiving',
      chunk_size_bytes: 1024.5,
      expected_bytes: 4096,
      received_bytes: 0,
      next_chunk_index: 0,
    });

    await expect(createCodeRuntimeSetupOperation({
      operationID: 'browser-editor:desktop',
      installMethod: 'desktop_transfer',
      manifest: { version: '4.128.0' },
    })).rejects.toThrow('Runtime did not return a valid Browser Editor setup operation.');
  });

  it('rejects invalid Runtime-confirmed upload cursors instead of clamping them', async () => {
    fetchJSON.mockResolvedValue({
      operation_id: 'browser-editor:desktop',
      received_bytes: -1,
      expected_bytes: 4096,
      next_chunk_index: -1,
    });

    await expect(appendCodeRuntimeSetupChunk(
      'browser-editor:desktop',
      0,
      new Uint8Array(new ArrayBuffer(1)),
    )).rejects.toThrow('Runtime did not return a valid Browser Editor setup chunk result.');
  });

  it('rejects an invalid chunk request cursor before sending it', async () => {
    await expect(appendCodeRuntimeSetupChunk(
      'browser-editor:desktop',
      -1,
      new Uint8Array(new ArrayBuffer(1)),
    )).rejects.toThrow('Browser Editor setup chunk index must be a non-negative safe integer.');
    expect(fetchJSON).not.toHaveBeenCalled();
  });
});
