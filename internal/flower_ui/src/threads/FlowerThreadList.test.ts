import { describe, expect, it, vi } from 'vitest';

import type { FlowerThreadListItem, FlowerThreadReadStatus } from '../contracts/flowerSurfaceContracts';
import { filterFlowerThreadItems, flowerThreadIndicator, groupFlowerThreadItems } from './threadListModel';

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

function thread(overrides: Partial<FlowerThreadListItem> = {}): FlowerThreadListItem {
  return {
    thread_id: 'thread-1',
    title: 'Thread',
    model_id: 'default/model',
    working_dir: '/workspace/redeven',
    pinned: false,
    created_at_ms: Date.now(),
    updated_at_ms: Date.now(),
    preview: '',
    status: 'idle',
    source_label: 'this host',
    target_labels: [],
    read_status: readStatus(false),
    ...overrides,
  };
}

describe('groupFlowerThreadItems', () => {
  it('keeps pinned conversations in a dedicated newest-pinned group', () => {
    vi.setSystemTime(new Date('2026-06-12T10:00:00Z'));
    const groups = groupFlowerThreadItems([
      thread({ thread_id: 'regular', created_at_ms: Date.now() }),
      thread({ thread_id: 'pinned-old', pinned: true, pinned_at_ms: 100, created_at_ms: 1000 }),
      thread({ thread_id: 'pinned-new', pinned: true, pinned_at_ms: 200, created_at_ms: 900 }),
    ]);

    expect(groups[0]).toMatchObject({
      kind: 'pinned',
      threads: [
        { thread_id: 'pinned-new' },
        { thread_id: 'pinned-old' },
      ],
    });
    expect(groups[1]).toMatchObject({
      kind: 'time',
      group: 'today',
      threads: [{ thread_id: 'regular' }],
    });
    vi.useRealTimers();
  });
});

describe('flowerThreadIndicator', () => {
  it('shows wave only for the selected running thread', () => {
    expect(flowerThreadIndicator(thread({ status: 'running' }), true).visual).toBe('wave');
    expect(flowerThreadIndicator(thread({ status: 'running' }), false).visual).toBe('working');
  });

  it('preserves terminal lifecycle dots with unread attention', () => {
    const indicator = flowerThreadIndicator(thread({ status: 'success', read_status: readStatus(true) }), false);
    expect(indicator.visual).toBe('success');
    expect(indicator.attention).toBe('unread');
  });
});

describe('filterFlowerThreadItems', () => {
  // filterFlowerThreadItems returns the same array reference when there is
  // no search query. This is important for the sidebar data pipeline:
  // Solid's <For> uses reference identity to skip DOM reconciliation,
  // so preserving the input array reference prevents unnecessary re-renders.

  it('returns the same array reference when query is empty', () => {
    const items = [
      thread({ thread_id: 'a', status: 'running' }),
      thread({ thread_id: 'b', status: 'success' }),
    ];
    const result = filterFlowerThreadItems(items, '');
    expect(result).toBe(items);
  });

  it('returns a new array when a search query is active', () => {
    const items = [
      thread({ thread_id: 'a', title: 'Alpha' }),
      thread({ thread_id: 'b', title: 'Beta' }),
    ];
    const result = filterFlowerThreadItems(items, 'alpha');
    expect(result).not.toBe(items);
    expect(result).toHaveLength(1);
    expect(result[0].thread_id).toBe('a');
  });
});
