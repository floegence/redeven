import { describe, expect, it } from 'vitest';

import { createConnectionRecoveryPresentation } from './createConnectionRecoveryPresentation';
import type { ConnectionRecoverySnapshot } from './createRuntimeReconnectController';

function snapshot(overrides: Partial<ConnectionRecoverySnapshot> = {}): ConnectionRecoverySnapshot {
  return {
    generation: 1,
    revision: 1,
    state: 'recovering',
    phase: 'runtime_probe',
    started_at_unix_ms: 100,
    runtime_probe_attempt_count: 1,
    protocol_attempt_count: 0,
    availability_status: 'offline',
    protocol_connected: false,
    secure_session: 'pending',
    ...overrides,
  };
}

describe('createConnectionRecoveryPresentation', () => {
  it('omits Desktop transport when the browser session has no Desktop recovery source', () => {
    const presentation = createConnectionRecoveryPresentation(snapshot());

    expect(presentation.steps.map((step) => step.id)).toEqual([
      'interrupted',
      'runtime_probe',
      'protocol_connect',
      'secure_session',
      'completed',
    ]);
    expect(presentation.steps.find((step) => step.id === 'runtime_probe')).toMatchObject({
      status: 'active',
      attempt_count: 1,
    });
    expect(presentation.completed_step_count).toBe(1);
    expect(presentation.progress_percent).toBe(20);
  });

  it('uses only real completed steps and exact attempt counts for Desktop recovery', () => {
    const presentation = createConnectionRecoveryPresentation(snapshot({
      phase: 'desktop_transport',
      runtime_probe_attempt_count: 0,
      desktop_transport: {
        generation: 4,
        revision: 8,
        phase: 'waiting',
        attempt_count: 3,
        started_at_unix_ms: 100,
        next_attempt_at_unix_ms: 5_000,
        actions: ['retry_now'],
      },
      next_retry_at_unix_ms: 5_000,
    }));

    expect(presentation.steps).toHaveLength(6);
    expect(presentation.steps.find((step) => step.id === 'desktop_transport')).toMatchObject({
      status: 'active',
      attempt_count: 3,
      next_retry_at_unix_ms: 5_000,
    });
    expect(presentation.completed_step_count).toBe(1);
  });

  it('marks every required step complete only after secure session recovery succeeds', () => {
    const presentation = createConnectionRecoveryPresentation(snapshot({
      state: 'succeeded',
      phase: 'completed',
      availability_status: 'online',
      protocol_connected: true,
      secure_session: 'ready',
      runtime_probe_attempt_count: 2,
      protocol_attempt_count: 3,
      recovered_at_unix_ms: 400,
    }));

    expect(presentation.steps.every((step) => step.status === 'complete')).toBe(true);
    expect(presentation.progress_percent).toBe(100);
  });
});
