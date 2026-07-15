import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cancelRuntime: vi.fn(),
  createOperation: vi.fn(),
  fetchStatus: vi.fn(),
  cancelDesktop: vi.fn(),
  desktopAvailable: vi.fn(),
  prepareDesktop: vi.fn(),
}));

vi.mock('./codeRuntimeApi', () => ({
  cancelCodeRuntimeSetupOperation: mocks.cancelRuntime,
  createCodeRuntimeSetupOperation: mocks.createOperation,
  fetchCodeRuntimeStatus: mocks.fetchStatus,
}));

vi.mock('./desktopCodeWorkspaceBridge', () => ({
  cancelWorkspaceEnginePreparation: mocks.cancelDesktop,
  desktopCodeWorkspacePrepareAvailable: mocks.desktopAvailable,
  prepareWorkspaceEngineWithDesktop: mocks.prepareDesktop,
}));

import {
  browserEditorInstallMethodAvailable,
  cancelBrowserEditorSetup,
  defaultBrowserEditorInstallMethod,
  prepareBrowserEditorSetup,
} from './browserEditorSetup';

function completedStatus() {
  return {
    active_runtime: { detection_state: 'ready', present: true, source: 'managed' },
    managed_runtime: { detection_state: 'ready', present: true, source: 'managed' },
    managed_prefix: '/runtime',
    shared_runtime_root: '/shared',
    managed_runtime_source: 'managed',
    installed_versions: [],
    operation: {
      action: 'prepare_workspace_engine',
      operation_id: 'browser-editor:remote',
      install_method: 'remote_download',
      state: 'succeeded',
    },
    updated_at_unix_ms: 1,
  } as const;
}

describe('browserEditorSetup', () => {
  beforeEach(() => {
    mocks.cancelRuntime.mockReset();
    mocks.createOperation.mockReset();
    mocks.fetchStatus.mockReset();
    mocks.cancelDesktop.mockReset();
    mocks.desktopAvailable.mockReset();
    mocks.prepareDesktop.mockReset();
    mocks.desktopAvailable.mockReturnValue(true);
    mocks.cancelRuntime.mockResolvedValue(completedStatus());
    mocks.cancelDesktop.mockResolvedValue({ ok: true, cancelled: true });
  });

  it('recomputes the default method from current Desktop bridge availability', () => {
    expect(defaultBrowserEditorInstallMethod()).toBe('desktop_transfer');
    expect(browserEditorInstallMethodAvailable('desktop_transfer')).toBe(true);
    expect(browserEditorInstallMethodAvailable('remote_download')).toBe(true);

    mocks.desktopAvailable.mockReturnValue(false);
    expect(defaultBrowserEditorInstallMethod()).toBe('remote_download');
    expect(browserEditorInstallMethodAvailable('desktop_transfer')).toBe(false);
    expect(browserEditorInstallMethodAvailable('remote_download')).toBe(true);
  });

  it('uses only the selected Desktop transfer path', async () => {
    mocks.prepareDesktop.mockResolvedValue({ ok: true, prepared: true, status: completedStatus() });
    const controller = new AbortController();
    const onProgress = vi.fn();

    const result = await prepareBrowserEditorSetup({
      operationID: 'browser-editor:desktop',
      installMethod: 'desktop_transfer',
      signal: controller.signal,
      onProgress,
    });

    expect(result.ok).toBe(true);
    expect(mocks.prepareDesktop).toHaveBeenCalledWith({
      operationID: 'browser-editor:desktop',
      status: undefined,
      signal: controller.signal,
      onProgress,
    });
    expect(mocks.createOperation).not.toHaveBeenCalled();
  });

  it('creates a fixed-source Runtime operation for environment download', async () => {
    mocks.createOperation.mockResolvedValue({
      operation_id: 'browser-editor:remote',
      install_method: 'remote_download',
      state: 'running',
      chunk_size_bytes: 0,
      expected_bytes: 0,
      received_bytes: 0,
    });
    mocks.fetchStatus.mockResolvedValue(completedStatus());

    const result = await prepareBrowserEditorSetup({
      operationID: 'browser-editor:remote',
      installMethod: 'remote_download',
    });

    expect(result).toMatchObject({ ok: true, prepared: true });
    expect(mocks.createOperation).toHaveBeenCalledWith({
      operationID: 'browser-editor:remote',
      installMethod: 'remote_download',
      signal: undefined,
    });
    expect(mocks.prepareDesktop).not.toHaveBeenCalled();
  });

  it('does not switch methods when the selected environment download fails', async () => {
    mocks.createOperation.mockRejectedValue(new Error('environment network unavailable'));

    await expect(prepareBrowserEditorSetup({
      operationID: 'browser-editor:remote',
      installMethod: 'remote_download',
    })).rejects.toMatchObject({
      source: 'runtime_status',
      message: 'environment network unavailable',
    });
    expect(mocks.prepareDesktop).not.toHaveBeenCalled();
  });

  it('maps Runtime failure codes to structured environment failure sources', async () => {
    mocks.createOperation.mockResolvedValue({
      operation_id: 'browser-editor:remote',
      install_method: 'remote_download',
      state: 'running',
    });
    mocks.fetchStatus.mockResolvedValue({
      ...completedStatus(),
      operation: {
        ...completedStatus().operation,
        state: 'failed',
        last_error_code: 'artifact_validation_failed',
        last_error: 'opaque verification failure',
      },
    });

    await expect(prepareBrowserEditorSetup({
      operationID: 'browser-editor:remote',
      installMethod: 'remote_download',
    })).rejects.toMatchObject({
      source: 'package_verification',
      message: 'opaque verification failure',
    });
  });

  it('attempts both cancellation paths and surfaces cancellation failures', async () => {
    mocks.cancelRuntime.mockRejectedValue(new Error('Runtime cancel failed.'));
    mocks.cancelDesktop.mockResolvedValue({ ok: false, cancelled: false, message: 'Desktop cancel failed.' });

    await expect(cancelBrowserEditorSetup('browser-editor:desktop', 'desktop_transfer'))
      .rejects.toThrow('Runtime cancel failed. Desktop cancel failed.');
    expect(mocks.cancelRuntime).toHaveBeenCalledWith('browser-editor:desktop');
    expect(mocks.cancelDesktop).toHaveBeenCalledWith('browser-editor:desktop');
  });

  it('does not call Desktop cancellation for environment download', async () => {
    await cancelBrowserEditorSetup('browser-editor:remote', 'remote_download');

    expect(mocks.cancelRuntime).toHaveBeenCalledWith('browser-editor:remote');
    expect(mocks.cancelDesktop).not.toHaveBeenCalled();
  });
});
