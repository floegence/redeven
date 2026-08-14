import { describe, expect, it } from 'vitest';

import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { flowerThreadReadSnapshotKey, sameThreadSnapshot } from './flowerThreadListRefresh';

function summary(status: FlowerThreadSnapshot['status']): FlowerThreadSnapshot {
  return {
    thread_id: 'thread-a', title: 'A', title_status: 'ready', model_id: 'model', working_dir: '/',
    created_at_ms: 1, updated_at_ms: 2, status, source_label: 'test', target_labels: [], messages: [],
    read_status: {
      is_unread: false,
      snapshot: { activity_revision: 2, last_message_at_unix_ms: 2, activity_signature: status },
      read_state: { last_seen_activity_revision: 2, last_read_message_at_unix_ms: 2, last_seen_activity_signature: status },
    },
  };
}

describe('Flower thread summary identity', () => {
  it('changes when background status changes without requiring pointer input', () => {
    expect(sameThreadSnapshot(summary('running'), summary('waiting_approval'))).toBe(false);
  });

  it('keys the workspace read snapshot without replay cursors or generations', () => {
    expect(flowerThreadReadSnapshotKey(summary('running').read_status.snapshot)).toBe('2\u001e2\u001erunning\u001e');
  });
});
