import { describe, expect, it } from 'vitest';

import type { FlowerThreadListItem, FlowerThreadReadStatus } from './contracts/flowerSurfaceContracts';
import { projectFlowerCompanionPresence, type FlowerCompanionThreadListItem } from './flowerCompanionPresence';

function readStatus(isUnread = false): FlowerThreadReadStatus {
  return {
    is_unread: isUnread,
    snapshot: {
      activity_revision: isUnread ? 2 : 1,
      last_message_at_unix_ms: 1,
      activity_signature: isUnread ? 'status:success\u001factivity:2' : 'status:idle\u001factivity:1',
    },
    read_state: {
      last_seen_activity_revision: 1,
      last_read_message_at_unix_ms: 1,
      last_seen_activity_signature: 'status:idle\u001factivity:1',
    },
  };
}

function thread(overrides: Partial<FlowerCompanionThreadListItem> = {}): FlowerCompanionThreadListItem {
  const item: FlowerThreadListItem = {
    thread_id: 'thread-1',
    title: 'Thread',
    title_status: 'ready',
    model_id: 'default/model',
    working_dir: '/workspace/redeven',
    pinned: false,
    created_at_ms: 1,
    updated_at_ms: 1,
    preview: '',
    status: 'idle',
    source_label: 'this host',
    target_labels: [],
    read_status: readStatus(),
  };
  return { ...item, ...overrides };
}

describe('projectFlowerCompanionPresence', () => {
  it('counts each thread in its highest-priority category without parsing content', () => {
    const presence = projectFlowerCompanionPresence([
      thread({ thread_id: 'attention', status: 'waiting_approval', queued_turn_count: 2 }),
      thread({ thread_id: 'failed', status: 'failed', read_status: readStatus(true) }),
      thread({ thread_id: 'running', status: 'running', queued_turn_count: 1 }),
      thread({ thread_id: 'queued', queued_turn_count: 3 }),
      thread({ thread_id: 'canceled', status: 'canceled', read_status: readStatus(true) }),
      thread({ thread_id: 'completed', status: 'success', read_status: readStatus(true) }),
      thread({ thread_id: 'read-failure', status: 'failed', read_status: readStatus(false) }),
    ], true);

    expect(presence).toEqual({
      priority_status: 'attention',
      priority_count: 1,
      priority_thread_title: 'Thread',
      attention_count: 1,
      unread_failed_count: 1,
      running_count: 1,
      queued_count: 1,
      unread_canceled_count: 1,
      unread_completed_count: 1,
    });
  });

  it('projects the first canonical thread title for the highest-priority live status', () => {
    expect(projectFlowerCompanionPresence([
      thread({ thread_id: 'running-primary', title: 'Refine the Flower companion', status: 'running' }),
      thread({ thread_id: 'running-secondary', title: 'Review responsive behavior', status: 'running' }),
    ], true)).toMatchObject({
      priority_status: 'running',
      priority_count: 2,
      priority_thread_title: 'Refine the Flower companion',
    });
  });

  it('follows attention, failed, running, queued, canceled, and completed priority order', () => {
    const candidates = [
      thread({ thread_id: 'attention', status: 'waiting_user' }),
      thread({ thread_id: 'failed', status: 'failed', read_status: readStatus(true) }),
      thread({ thread_id: 'running', status: 'running' }),
      thread({ thread_id: 'queued', queued_turn_count: 1 }),
      thread({ thread_id: 'canceled', status: 'canceled', read_status: readStatus(true) }),
      thread({ thread_id: 'completed', status: 'success', read_status: readStatus(true) }),
    ];
    const expected = ['attention', 'failed', 'running', 'queued', 'canceled', 'completed'] as const;

    for (let index = 0; index < candidates.length; index += 1) {
      expect(projectFlowerCompanionPresence(candidates.slice(index), true).priority_status).toBe(expected[index]);
    }
  });

  it('uses unavailable only when no higher-priority canonical summary remains', () => {
    expect(projectFlowerCompanionPresence([], false)).toMatchObject({
      priority_status: 'unavailable',
      priority_count: 1,
    });
    expect(projectFlowerCompanionPresence([
      thread({ status: 'success', read_status: readStatus(true) }),
    ], false)).toMatchObject({
      priority_status: 'completed',
      priority_count: 1,
    });
  });

  it('returns idle with a zero count for an available quiet surface', () => {
    expect(projectFlowerCompanionPresence([
      thread({ status: 'success', read_status: readStatus(false) }),
      thread({ status: 'canceled', read_status: readStatus(false) }),
    ], true)).toMatchObject({
      priority_status: 'idle',
      priority_count: 0,
    });
  });
});
