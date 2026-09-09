// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ManagedOperation } from './managedServiceOperationController';
import {
  MANAGED_OPERATION_EXIT_MS,
  MANAGED_OPERATION_MIN_VISIBLE_MS,
  createManagedServiceOperationPresentation,
} from './managedServiceOperationPresentation';

const runningOperation = (operationID = 'mop-brief'): ManagedOperation => ({
  operation_id: operationID,
  service_id: 'mws-brief',
  action: 'restart',
  state: 'running',
  stage: 'starting',
  progress_current: 2,
  progress_total: 4,
});

describe('managed service operation presentation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T08:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds a brief success until the minimum visible time and then finishes its exit', async () => {
    const presentation = createManagedServiceOperationPresentation({ isExpanded: () => false });
    const running = runningOperation();
    presentation.update(running);

    await vi.advanceTimersByTimeAsync(100);
    presentation.update({ ...running, state: 'succeeded', stage: 'completed', progress_current: 4 });
    presentation.release(running.operation_id);

    await vi.advanceTimersByTimeAsync(MANAGED_OPERATION_MIN_VISIBLE_MS - 101);
    expect(presentation.operationForService(running.service_id)?.state).toBe('succeeded');
    expect(presentation.phaseForService(running.service_id)).toBe('visible');

    await vi.advanceTimersByTimeAsync(1);
    expect(presentation.phaseForService(running.service_id)).toBe('exiting');

    await vi.advanceTimersByTimeAsync(MANAGED_OPERATION_EXIT_MS - 1);
    expect(presentation.operationForService(running.service_id)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(presentation.operationForService(running.service_id)).toBeNull();
    presentation.dispose();
  });

  it('does not flash when a submission is released before an operation is accepted', async () => {
    const presentation = createManagedServiceOperationPresentation({ isExpanded: () => false });
    const submitting = { ...runningOperation('submitting:mws-brief:restart'), state: 'submitting' };
    presentation.update(submitting);

    await vi.advanceTimersByTimeAsync(100);
    presentation.release(submitting.operation_id);

    await vi.advanceTimersByTimeAsync(MANAGED_OPERATION_MIN_VISIBLE_MS - 101);
    expect(presentation.operationForService(submitting.service_id)?.operation_id).toBe(submitting.operation_id);
    expect(presentation.phaseForService(submitting.service_id)).toBe('visible');

    await vi.advanceTimersByTimeAsync(1);
    expect(presentation.phaseForService(submitting.service_id)).toBe('exiting');
    await vi.advanceTimersByTimeAsync(MANAGED_OPERATION_EXIT_MS);
    expect(presentation.operationForService(submitting.service_id)).toBeNull();
    presentation.dispose();
  });

  it('waits for expanded released submissions to collapse before exiting', async () => {
    const expanded = new Set<string>();
    const presentation = createManagedServiceOperationPresentation({ isExpanded: (operationID) => expanded.has(operationID) });
    const submitting = { ...runningOperation('submitting:mws-brief:restart'), state: 'submitting' };
    expanded.add(submitting.operation_id);
    presentation.update(submitting);
    presentation.release(submitting.operation_id);

    await vi.advanceTimersByTimeAsync(MANAGED_OPERATION_MIN_VISIBLE_MS * 2);
    expect(presentation.phaseForService(submitting.service_id)).toBe('visible');

    expanded.delete(submitting.operation_id);
    presentation.reconcileExpansion(submitting.operation_id);
    expect(presentation.phaseForService(submitting.service_id)).toBe('exiting');
    await vi.advanceTimersByTimeAsync(MANAGED_OPERATION_EXIT_MS);
    expect(presentation.operationForService(submitting.service_id)).toBeNull();
    presentation.dispose();
  });

  it('keeps a completed operation available while its details are expanded', async () => {
    const expanded = new Set<string>();
    const presentation = createManagedServiceOperationPresentation({ isExpanded: (operationID) => expanded.has(operationID) });
    const running = runningOperation('mop-expanded');
    presentation.update(running);
    expanded.add(running.operation_id);
    presentation.update({ ...running, state: 'succeeded', stage: 'completed', progress_current: 4 });
    presentation.release(running.operation_id);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(presentation.operationForService(running.service_id)?.operation_id).toBe(running.operation_id);
    expect(presentation.phaseForService(running.service_id)).toBe('visible');

    expanded.delete(running.operation_id);
    presentation.reconcileExpansion(running.operation_id);
    expect(presentation.phaseForService(running.service_id)).toBe('exiting');
    await vi.advanceTimersByTimeAsync(MANAGED_OPERATION_EXIT_MS);
    expect(presentation.operationForService(running.service_id)).toBeNull();
    presentation.dispose();
  });

  it.each(['failed', 'cancelled', 'interrupted'])('retains %s results and lets a new operation replace them immediately', async (state) => {
    const presentation = createManagedServiceOperationPresentation({ isExpanded: () => false });
    const running = runningOperation('mop-failed');
    presentation.update(running);
    presentation.update({ ...running, state, stage: state, ...(state === 'failed' ? { error_code: 'START_FAILED' } : {}) });
    presentation.release(running.operation_id);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(presentation.operationForService(running.service_id)?.state).toBe(state);
    expect(presentation.phaseForService(running.service_id)).toBe('visible');

    const next = runningOperation('mop-next');
    presentation.update(next);
    expect(presentation.operationForService(running.service_id)?.operation_id).toBe(next.operation_id);
    expect(presentation.operationForService(running.service_id)?.state).toBe('running');
    presentation.dispose();
  });
});
