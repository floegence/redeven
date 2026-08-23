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
      snapshot: { activity_revision: 2, last_message_at_unix_ms: 2, activity_signature: 'idle' },
      read_state: { last_seen_activity_revision: 2, last_read_message_at_unix_ms: 2, last_seen_activity_signature: 'idle' },
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
      model_io_status: { phase: 'finalizing', run_id: 'run-b', updated_at_ms: 3 },
    }))).toBe(true);
  });

  it('rejects a terminal snapshot without an active identity', () => {
    expect(flowerThreadHasActiveTurnEvidence(snapshot({ status: 'success' }))).toBe(false);
  });
});
