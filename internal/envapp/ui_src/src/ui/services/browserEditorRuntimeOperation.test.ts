import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createOperation: vi.fn(),
  fetchStatus: vi.fn(),
}));

vi.mock('./codeRuntimeApi', () => ({
  createCodeRuntimeSetupOperation: mocks.createOperation,
  fetchCodeRuntimeStatus: mocks.fetchStatus,
}));

import { LocalApiError } from './localApi';
import type { CodeRuntimeStatus } from './codeRuntimeApi';
import {
  CODE_RUNTIME_OPERATION_CONFLICT_ERROR_CODE,
  BrowserEditorRuntimeCreateError,
  browserEditorRuntimeOperationAbsenceConfirmed,
  observeBrowserEditorRuntimeOperation,
  startOrReconcileBrowserEditorRuntimeOperation,
} from './browserEditorRuntimeOperation';

function runtimeStatus(args: Readonly<{
  action?: 'prepare_workspace_engine' | 'remove_local_environment_version' | '';
  operationID?: string;
  installMethod?: 'desktop_transfer' | 'remote_download';
  state?: 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  stage?: string;
  errorCode?: string;
  errorMessage?: string;
}> = {}): CodeRuntimeStatus {
  return {
    active_runtime: { detection_state: 'missing', present: false, source: 'none' },
    managed_runtime: { detection_state: 'missing', present: false, source: 'managed' },
    managed_prefix: '/runtime',
    shared_runtime_root: '/shared',
    managed_runtime_source: 'none',
    installed_versions: [],
    operation: {
      action: args.action ?? 'prepare_workspace_engine',
      operation_id: args.operationID ?? 'browser-editor:requested',
      install_method: args.installMethod ?? 'remote_download',
      state: args.state ?? 'running',
      stage: args.stage ?? 'resolving_catalog',
      ...(args.errorCode ? { last_error_code: args.errorCode } : {}),
      ...(args.errorMessage ? { last_error: args.errorMessage } : {}),
    },
    updated_at_unix_ms: 1,
  } as CodeRuntimeStatus;
}

function conflictError() {
  return new LocalApiError({
    message: 'another browser editor setup operation is already running',
    status: 409,
    code: CODE_RUNTIME_OPERATION_CONFLICT_ERROR_CODE,
  });
}

describe('browserEditorRuntimeOperation', () => {
  beforeEach(() => {
    mocks.createOperation.mockReset();
    mocks.fetchStatus.mockReset();
  });

  it('adopts the real operation identity and method after a typed 409 conflict', async () => {
    const existing = runtimeStatus({
      operationID: 'browser-editor:existing',
      installMethod: 'desktop_transfer',
    });
    mocks.createOperation.mockRejectedValue(conflictError());
    mocks.fetchStatus.mockResolvedValue(existing);
    const observed = vi.fn();
    const statuses = vi.fn();

    await expect(startOrReconcileBrowserEditorRuntimeOperation({
      operationID: 'browser-editor:requested',
      installMethod: 'remote_download',
      observer: { onOperationObserved: observed, onRuntimeStatus: statuses },
    })).resolves.toEqual({
      kind: 'existing',
      identity: {
        operationID: 'browser-editor:existing',
        installMethod: 'desktop_transfer',
      },
      status: existing,
    });
    expect(mocks.createOperation).toHaveBeenCalledOnce();
    expect(observed).toHaveBeenCalledWith({
      operationID: 'browser-editor:existing',
      installMethod: 'desktop_transfer',
    });
    expect(statuses).toHaveBeenCalledWith(existing);
  });

  it('reports another active Runtime action as blocked', async () => {
    const removal = runtimeStatus({
      action: 'remove_local_environment_version',
      operationID: 'remove:1',
      state: 'running',
    });
    mocks.createOperation.mockRejectedValue(conflictError());
    mocks.fetchStatus.mockResolvedValue(removal);

    await expect(startOrReconcileBrowserEditorRuntimeOperation({
      operationID: 'browser-editor:requested',
      installMethod: 'remote_download',
    })).resolves.toMatchObject({ kind: 'blocked', status: removal });
    expect(mocks.createOperation).toHaveBeenCalledOnce();
  });

  it('adopts an ambiguous create only when Runtime reports the exact requested identity', async () => {
    const exact = runtimeStatus();
    mocks.createOperation.mockRejectedValue(new TypeError('connection closed'));
    mocks.fetchStatus.mockResolvedValue(exact);

    await expect(startOrReconcileBrowserEditorRuntimeOperation({
      operationID: 'browser-editor:requested',
      installMethod: 'remote_download',
    })).resolves.toMatchObject({ kind: 'existing', status: exact });
    expect(mocks.createOperation).toHaveBeenCalledOnce();
  });

  it('does not resend POST when ambiguous reconciliation finds a different operation', async () => {
    mocks.createOperation.mockRejectedValue(new TypeError('connection closed'));
    mocks.fetchStatus.mockResolvedValue(runtimeStatus({ operationID: 'browser-editor:different' }));
    const observed = vi.fn();

    const error = await startOrReconcileBrowserEditorRuntimeOperation({
      operationID: 'browser-editor:requested',
      installMethod: 'remote_download',
      observer: { onOperationObserved: observed },
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(BrowserEditorRuntimeCreateError);
    expect(browserEditorRuntimeOperationAbsenceConfirmed(error)).toBe(true);
    expect(mocks.createOperation).toHaveBeenCalledOnce();
    expect(observed).not.toHaveBeenCalled();
  });

  it('keeps an unavailable reconciliation status explicitly indeterminate', async () => {
    mocks.createOperation.mockRejectedValue(new TypeError('connection closed'));
    mocks.fetchStatus.mockRejectedValue(new Error('status unavailable'));

    const error = await startOrReconcileBrowserEditorRuntimeOperation({
      operationID: 'browser-editor:requested',
      installMethod: 'remote_download',
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(BrowserEditorRuntimeCreateError);
    expect(browserEditorRuntimeOperationAbsenceConfirmed(error)).toBe(false);
    expect(mocks.createOperation).toHaveBeenCalledOnce();
  });

  it('publishes every Runtime poll and returns structured failure state', async () => {
    vi.useFakeTimers();
    const running = runtimeStatus({ state: 'running', stage: 'downloading' });
    const failed = runtimeStatus({
      state: 'failed',
      stage: 'verifying',
      errorCode: 'artifact_validation_failed',
      errorMessage: 'verification failed',
    });
    mocks.fetchStatus.mockResolvedValueOnce(failed);
    const statuses = vi.fn();

    const resultPromise = observeBrowserEditorRuntimeOperation({
      identity: {
        operationID: 'browser-editor:requested',
        installMethod: 'remote_download',
      },
      initialStatus: running,
      observer: { onRuntimeStatus: statuses },
    });
    await vi.advanceTimersByTimeAsync(750);

    await expect(resultPromise).resolves.toMatchObject({
      state: 'failed',
      source: 'package_verification',
      message: 'verification failed',
    });
    expect(statuses.mock.calls.map(([status]) => status)).toEqual([running, failed]);
    vi.useRealTimers();
  });

  it('returns Runtime cancellation as a terminal result', async () => {
    const cancelled = runtimeStatus({ state: 'cancelled' });

    await expect(observeBrowserEditorRuntimeOperation({
      identity: {
        operationID: 'browser-editor:requested',
        installMethod: 'remote_download',
      },
      initialStatus: cancelled,
    })).resolves.toMatchObject({ state: 'cancelled', cancelled: true, status: cancelled });
  });

  it('continues observing after a transient Runtime status read failure', async () => {
    vi.useFakeTimers();
    const succeeded = runtimeStatus({ state: 'succeeded' });
    mocks.fetchStatus
      .mockRejectedValueOnce(new Error('temporary status failure'))
      .mockResolvedValueOnce(succeeded);

    const resultPromise = observeBrowserEditorRuntimeOperation({
      identity: {
        operationID: 'browser-editor:requested',
        installMethod: 'remote_download',
      },
    });
    await vi.advanceTimersByTimeAsync(750);

    await expect(resultPromise).resolves.toMatchObject({ state: 'succeeded', status: succeeded });
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
