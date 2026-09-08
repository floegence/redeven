import { describe, expect, it } from 'vitest';

import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { flowerThreadActivityRevision, sameThreadSnapshot } from './flowerThreadListRefresh';

function summary(status: FlowerThreadSnapshot['status']): FlowerThreadSnapshot {
  return {
    thread_id: 'thread-a', title: 'A', title_status: 'ready', title_generation: 1, model_id: 'model', working_dir: '/',
    settings_revision: 1,
    created_at_ms: 1, updated_at_ms: 2, status, source_label: 'test', target_labels: [], messages: [],
    read_status: {
      is_unread: false,
      snapshot: { activity_revision: 2 },
      read_state: { last_seen_activity_revision: 2 },
    },
  };
}

describe('Flower thread summary identity', () => {
  it('changes when background status changes without requiring pointer input', () => {
    expect(sameThreadSnapshot(summary('running'), summary('waiting_approval'))).toBe(false);
  });

  it('normalizes the workspace activity revision', () => {
    expect(flowerThreadActivityRevision(summary('running').read_status.snapshot)).toBe(2);
  });
});
