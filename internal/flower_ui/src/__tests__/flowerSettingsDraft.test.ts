import { describe, expect, it } from 'vitest';

import { projectFlowerThreadListItem } from '../flowerSurfaceModel';
import type { FlowerThreadReadStatus, FlowerThreadSnapshot } from '../contracts/flowerSurfaceContracts';

function readStatus(isUnread = false): FlowerThreadReadStatus {
  return {
    is_unread: isUnread,
    snapshot: {
      activity_revision: 2,
      last_message_at_unix_ms: 2,
      activity_signature: 'status:success\u001factivity:2',
    },
    read_state: {
      last_seen_activity_revision: isUnread ? 1 : 2,
      last_read_message_at_unix_ms: isUnread ? 1 : 2,
      last_seen_activity_signature: isUnread ? 'status:running\u001factivity:1' : 'status:success\u001factivity:2',
    },
  };
}

describe('Flower thread list projection', () => {
  it('uses the latest non-empty message as the shared thread preview', () => {
    const thread: FlowerThreadSnapshot = {
      thread_id: 'thread-1',
      title: 'Transfer plan',
      model_id: 'primary/gpt-4.1',
      working_dir: '/workspace/redeven',
      pinned_at_ms: 123,
      created_at_ms: 1,
      updated_at_ms: 2,
      status: 'success',
      source_label: 'env A',
      target_labels: ['env B'],
      read_status: readStatus(false),
      messages: [
        { id: 'm1', role: 'user', content: 'Plan this transfer', status: 'complete', created_at_ms: 1 },
        { id: 'm2', role: 'assistant', content: 'Destination preview is ready.', status: 'complete', created_at_ms: 2 },
      ],
    };

    expect(projectFlowerThreadListItem(thread)).toMatchObject({
      thread_id: 'thread-1',
      working_dir: '/workspace/redeven',
      pinned: true,
      pinned_at_ms: 123,
      preview: 'Destination preview is ready.',
      source_label: 'env A',
      target_labels: ['env B'],
      status: 'success',
      read_status: readStatus(false),
    });
    expect(projectFlowerThreadListItem({ ...thread, read_status: readStatus(true) })).toMatchObject({
      thread_id: 'thread-1',
      read_status: readStatus(true),
    });
  });
});
