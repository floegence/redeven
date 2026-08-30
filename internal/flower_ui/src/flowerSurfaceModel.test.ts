import { describe, expect, it } from 'vitest';
import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { flowerThreadHasActiveTurnEvidence } from './flowerSurfaceModel';

function snapshot(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  return {
    thread_id: 'thread-active-evidence',
    title: 'Active evidence',
    title_status: 'ready',
    model_id: 'provider/model',
    working_dir: '/workspace',
    settings_revision: 1,
    created_at_ms: 1,
    updated_at_ms: 2,
    status: 'idle',
    source_label: 'Local Environment',
    target_labels: [],
    messages: [],
    read_status: {
      is_unread: false,
      snapshot: { activity_revision: 2 },
      read_state: { last_seen_activity_revision: 2 },
    },
    ...overrides,
  };
}

describe('flowerThreadHasActiveTurnEvidence', () => {
  it.each(['running', 'waiting_approval', 'waiting_user'] as const)('accepts %s as active evidence', (status) => {
    expect(flowerThreadHasActiveTurnEvidence(snapshot({ status }))).toBe(true);
  });

  it('accepts retained turn identities even when status is stale', () => {
    expect(flowerThreadHasActiveTurnEvidence(snapshot({ active_run_id: 'run-a' }))).toBe(true);
    expect(flowerThreadHasActiveTurnEvidence(snapshot({
      active_run_id: 'run-b',
      run_progress: { phase: 'finalizing', run_id: 'run-b', turn_id: 'turn-b' },
    }))).toBe(true);
  });

  it('rejects a terminal snapshot without an active identity', () => {
    expect(flowerThreadHasActiveTurnEvidence(snapshot({ status: 'success' }))).toBe(false);
  });
});
