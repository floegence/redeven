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
  createBrowserEditorSetupOrchestration,
  defaultBrowserEditorInstallMethod,
  prepareBrowserEditorSetup,
} from './browserEditorSetup';
import { LocalApiError } from './localApi';
import { CODE_RUNTIME_OPERATION_CONFLICT_ERROR_CODE } from './browserEditorRuntimeOperation';

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
    mocks.cancelRuntime.mockResolvedValue({
      ...completedStatus(),
      operation: {
        ...completedStatus().operation,
        state: 'cancelled',
      },
    });
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
    mocks.prepareDesktop.mockResolvedValue({ state: 'succeeded', ok: true, prepared: true, status: completedStatus() });
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
      observer: {
        onOperationObserved: undefined,
        onRuntimeStatus: undefined,
      },
    });
    expect(mocks.createOperation).not.toHaveBeenCalled();
  });

  it('creates a fixed-source Runtime operation for environment download', async () => {
    mocks.createOperation.mockResolvedValue({
      operation_id: 'browser-editor:remote',
      install_method: 'remote_download',
      state: 'running',
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
    mocks.fetchStatus.mockResolvedValue({
      ...completedStatus(),
      operation: { state: 'idle' },
    });

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

    const result = await prepareBrowserEditorSetup({
      operationID: 'browser-editor:remote',
      installMethod: 'remote_download',
    });

    expect(result).toMatchObject({
      state: 'failed',
      source: 'package_verification',
      message: 'opaque verification failure',
    });
  });

  it('switches orchestration to an existing operation identity without local progress', async () => {
    const existingStatus = {
      ...completedStatus(),
      operation: {
        ...completedStatus().operation,
        operation_id: 'browser-editor:existing',
        install_method: 'desktop_transfer',
      },
    } as const;
    mocks.createOperation.mockRejectedValue(new LocalApiError({
      message: 'another browser editor setup operation is already running',
      status: 409,
      code: CODE_RUNTIME_OPERATION_CONFLICT_ERROR_CODE,
    }));
    mocks.fetchStatus.mockResolvedValue(existingStatus);
    const snapshots: any[] = [];
    const orchestration = createBrowserEditorSetupOrchestration({
      operationID: 'browser-editor:requested',
      installMethod: 'remote_download',
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });

    await expect(orchestration.run()).resolves.toMatchObject({ state: 'succeeded' });
    expect(orchestration.snapshot()).toMatchObject({
      operation: {
        operationID: 'browser-editor:existing',
        installMethod: 'desktop_transfer',
      },
      operationObserved: true,
      localProgress: null,
      phase: 'terminal',
    });
    expect(snapshots.every((snapshot) => snapshot.localProgress === null)).toBe(true);
    expect(mocks.createOperation).toHaveBeenCalledOnce();
  });

  it('cancels the Runtime operation using its observed identity', async () => {
    const runningStatus = {
      ...completedStatus(),
      operation: {
        ...completedStatus().operation,
        operation_id: 'browser-editor:existing',
        state: 'running',
      },
    } as const;
    const cancelledStatus = {
      ...runningStatus,
      operation: {
        ...runningStatus.operation,
        state: 'cancelled',
      },
    } as const;
    mocks.createOperation.mockRejectedValue(new LocalApiError({
      message: 'another browser editor setup operation is already running',
      status: 409,
      code: CODE_RUNTIME_OPERATION_CONFLICT_ERROR_CODE,
    }));
    mocks.fetchStatus.mockResolvedValue(runningStatus);
    mocks.cancelRuntime.mockResolvedValue(cancelledStatus);
    const orchestration = createBrowserEditorSetupOrchestration({
      operationID: 'browser-editor:requested',
      installMethod: 'remote_download',
    });

    const resultPromise = orchestration.run();
    await vi.waitFor(() => {
      expect(orchestration.snapshot().operation.operationID).toBe('browser-editor:existing');
    });
    await orchestration.cancel();

    await expect(resultPromise).resolves.toMatchObject({
      state: 'cancelled',
      status: cancelledStatus,
    });
    expect(mocks.cancelRuntime).toHaveBeenCalledWith('browser-editor:existing');
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
