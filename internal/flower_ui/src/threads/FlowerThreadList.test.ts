import { describe, expect, it, vi } from 'vitest';

import type { FlowerThreadListItem } from '../contracts/flowerSurfaceContracts';
import { groupFlowerThreadItems } from './threadListModel';

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
