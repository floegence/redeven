import { describe, expect, it } from 'vitest';

import { createConnectionRecoveryPresentation } from './createConnectionRecoveryPresentation';
import type { ConnectionRecoverySnapshot } from './createRuntimeReconnectController';

function snapshot(overrides: Partial<ConnectionRecoverySnapshot> = {}): ConnectionRecoverySnapshot {
  return {
    generation: 1,
    revision: 1,
    state: 'recovering',
    phase: 'protocol_connect',
    started_at_unix_ms: 100,
    protocol_attempt_count: 1,
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
      'protocol_connect',
      'secure_session',
      'completed',
    ]);
    expect(presentation.steps.find((step) => step.id === 'protocol_connect')).toMatchObject({
      status: 'active',
      attempt_count: 1,
    });
    expect(presentation.steps.filter((step) => step.status === 'complete')).toHaveLength(1);
  });

  it('uses only real completed steps and exact attempt counts for Desktop recovery', () => {
    const presentation = createConnectionRecoveryPresentation(snapshot({
      phase: 'desktop_transport',
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

    expect(presentation.steps).toHaveLength(5);
    expect(presentation.steps.find((step) => step.id === 'desktop_transport')).toMatchObject({
      status: 'active',
      attempt_count: 3,
      next_retry_at_unix_ms: 5_000,
    });
    expect(presentation.steps.filter((step) => step.status === 'complete')).toHaveLength(1);
  });

  it('marks every required step complete only after secure session recovery succeeds', () => {
    const presentation = createConnectionRecoveryPresentation(snapshot({
      state: 'succeeded',
      phase: 'completed',
      availability_status: 'online',
      protocol_connected: true,
      secure_session: 'ready',
      protocol_attempt_count: 3,
      recovered_at_unix_ms: 400,
    }));

    expect(presentation.steps.every((step) => step.status === 'complete')).toBe(true);
  });
});
