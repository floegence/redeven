import { describe, expect, it, vi } from 'vitest';

import type { FlowerThreadListItem, FlowerThreadReadStatus } from '../contracts/flowerSurfaceContracts';
import { filterFlowerThreadItems, flowerThreadIndicator, groupFlowerThreadItems } from './threadListModel';
import { canForkThreadItem, canPinThreadItem, canRenameThreadItem } from './threadListActions';

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

describe('FlowerThreadList item actions', () => {
  it('keeps fork unavailable for active or read-only threads', () => {
    expect(canForkThreadItem(thread({ thread_id: 'running-1', status: 'running' }))).toBe(false);
    expect(canForkThreadItem(thread({ thread_id: 'approval-1', status: 'waiting_approval' }))).toBe(false);
    expect(canForkThreadItem(thread({ thread_id: 'input-1', status: 'waiting_user' }))).toBe(false);
    expect(canForkThreadItem(thread({ thread_id: 'readonly-1', status: 'read_only' }))).toBe(false);
  });

  it('keeps normal idle threads eligible for direct sidebar actions', () => {
    const regular = thread({ thread_id: 'regular-1', status: 'idle' });

    expect(canForkThreadItem(regular)).toBe(true);
    expect(canRenameThreadItem(regular)).toBe(true);
    expect(canPinThreadItem(regular)).toBe(true);
  });
});

describe('flowerThreadIndicator', () => {
  it('shows wave for every running thread regardless of selection or unread state', () => {
    expect(flowerThreadIndicator(thread({ status: 'running' }), true).visual).toBe('wave');
    expect(flowerThreadIndicator(thread({ status: 'running' }), false).visual).toBe('wave');
    expect(flowerThreadIndicator(thread({ status: 'running', read_status: readStatus(true) }), false)).toMatchObject({
      visual: 'wave',
      attention: 'none',
      actionRequired: false,
    });
  });

  it('shows an unread dot only for unselected finished or stopped unread threads', () => {
    for (const status of ['success', 'failed', 'canceled'] as const) {
      expect(flowerThreadIndicator(thread({ status, read_status: readStatus(true) }), false)).toMatchObject({
        visual: 'dot',
        attention: 'unread',
        actionRequired: false,
      });
      expect(flowerThreadIndicator(thread({ status, read_status: readStatus(true) }), true)).toMatchObject({
        visual: 'none',
        attention: 'none',
        actionRequired: false,
      });
      expect(flowerThreadIndicator(thread({ status, read_status: readStatus(false) }), false)).toMatchObject({
        visual: 'none',
        attention: 'none',
        actionRequired: false,
      });
    }
  });

  it('keeps unread title text tied to the unread dot predicate', () => {
    expect(flowerThreadIndicator(thread({ status: 'success', read_status: readStatus(true) }), false).title).toContain('Unread');
    expect(flowerThreadIndicator(thread({ status: 'success', read_status: readStatus(true) }), true).title).not.toContain('Unread');
    expect(flowerThreadIndicator(thread({ status: 'waiting_user', read_status: readStatus(true) }), false).title).not.toContain('Unread');
    expect(flowerThreadIndicator(thread({ status: 'idle', read_status: readStatus(true) }), false).title).not.toContain('Unread');
  });

  it('does not reuse unread dots for idle or read-only thread states', () => {
    for (const status of ['idle', 'read_only'] as const) {
      expect(flowerThreadIndicator(thread({ status, read_status: readStatus(true) }), false)).toMatchObject({
        visual: 'none',
        attention: 'none',
        actionRequired: false,
      });
      expect(flowerThreadIndicator(thread({ status, read_status: readStatus(true) }), true)).toMatchObject({
        visual: 'none',
        attention: 'none',
        actionRequired: false,
      });
    }
  });

  it('keeps waiting prompts actionable without using unread attention', () => {
    for (const status of ['waiting_user', 'waiting_approval'] as const) {
      expect(flowerThreadIndicator(thread({ status, read_status: readStatus(false) }), false)).toMatchObject({
        visual: 'none',
        attention: 'none',
        actionRequired: true,
      });
      expect(flowerThreadIndicator(thread({ status, read_status: readStatus(true) }), false)).toMatchObject({
        visual: 'none',
        attention: 'none',
        actionRequired: true,
      });
      expect(flowerThreadIndicator(thread({ status, read_status: readStatus(true) }), true)).toMatchObject({
        visual: 'none',
        attention: 'none',
        actionRequired: true,
      });
    }
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
