import { describe, expect, it } from 'vitest';

import {
  BrowserEditorTransferEstimator,
  shouldRefreshBrowserEditorProgressText,
  type BrowserEditorSetupProgress,
} from './browserEditorSetupProgress';

function progress(completedBytes: number, state: BrowserEditorSetupProgress['state'] = 'running'): BrowserEditorSetupProgress {
  return {
    operation_id: 'browser-editor:1',
    phase: 'upload',
    state,
    completed_bytes: completedBytes,
    total_bytes: 100,
    updated_at_unix_ms: completedBytes + 1,
  };
}

describe('BrowserEditorTransferEstimator', () => {
  it('waits for two byte increases before exposing a smoothed ETA', () => {
    const estimator = new BrowserEditorTransferEstimator();
    estimator.update(progress(0), 0);
    estimator.update(progress(20), 1_000);
    expect(estimator.metrics(progress(20), 1_000).eta_seconds).toBeUndefined();

    estimator.update(progress(40), 2_000);
    const metrics = estimator.metrics(progress(40), 2_000);
    expect(metrics.percent).toBe(40);
    expect(metrics.bytes_per_second).toBeCloseTo(20);
    expect(metrics.eta_seconds).toBeCloseTo(3);
    expect(metrics.stalled).toBe(false);
  });

  it('hides ETA after a 15 second stall', () => {
    const estimator = new BrowserEditorTransferEstimator();
    estimator.update(progress(0), 0);
    estimator.update(progress(20), 1_000);
    estimator.update(progress(40), 2_000);

    const metrics = estimator.metrics(progress(40), 17_000);
    expect(metrics.stalled).toBe(true);
    expect(metrics.bytes_per_second).toBeUndefined();
    expect(metrics.eta_seconds).toBeUndefined();
  });

  it('distinguishes a complete transfer awaiting the completion handshake', () => {
    const estimator = new BrowserEditorTransferEstimator();
    estimator.update(progress(100), 0);

    expect(estimator.metrics(progress(100), 1_000)).toMatchObject({
      determinate: true,
      percent: 100,
      awaiting_confirmation: true,
      stalled: false,
    });
  });

  it('limits progress text refreshes while preserving important transitions', () => {
    expect(shouldRefreshBrowserEditorProgressText(progress(20), progress(30), 500)).toBe(false);
    expect(shouldRefreshBrowserEditorProgressText(progress(20), progress(30), 1_000)).toBe(true);
    expect(shouldRefreshBrowserEditorProgressText(progress(90), progress(100), 100)).toBe(true);
    expect(shouldRefreshBrowserEditorProgressText(progress(100), progress(100, 'completed'), 100)).toBe(true);
    expect(shouldRefreshBrowserEditorProgressText(progress(20), {
      ...progress(20),
      phase: 'verify',
    }, 100)).toBe(true);
  });
});
