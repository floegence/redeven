import { describe, expect, it } from 'vitest';

import { canonicalFlowerThreadTitle, flowerForkTitle, flowerThreadDisplayTitle } from './flowerThreadTitle';
import { createThreadCache } from './threadCache';
import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';

describe('Flower thread titles', () => {
  it('consumes canonical titles in pending and failed states', () => {
    expect(canonicalFlowerThreadTitle({ title: ' Pending fallback ', title_status: 'pending' })).toBe('Pending fallback');
    expect(canonicalFlowerThreadTitle({ title: 'Failed fallback', title_status: 'failed' })).toBe('Failed fallback');
  });

  it('keeps untitled persisted forks visible after detail, summary refresh, and reconnect', () => {
    const thread = {
      thread_id: 'thread-12345678', title: '', title_status: 'unset', messages: [],
      updated_at_ms: 1, settings_revision: 1,
      read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } },
    } as unknown as FlowerThreadSnapshot;
    let cache = createThreadCache().replaceSummaries([thread]);
    const assertVisible = () => {
      const summary = cache.summaries.get(thread.thread_id)!;
      expect(summary.title).toBe('');
      expect(flowerThreadDisplayTitle(summary, 'Untitled conversation')).toBe('Untitled conversation · 12345678');
    };
    assertVisible();
    cache = cache.receiveView({ thread: { ...thread, messages: [{ id: 'user-1', role: 'user', content: 'Copied user input', status: 'complete', created_at_ms: 1 }] }, version: 1 }).cache;
    assertVisible();
    cache = cache.replaceSummaries([thread]);
    assertVisible();
    cache = cache.resetRootSummaries([thread]);
    assertVisible();
  });

  it('reserves the suffix within the canonical Unicode title limit', () => {
    const title = flowerForkTitle('界'.repeat(220), '分支');
    expect(Array.from(title)).toHaveLength(200);
    expect(title.endsWith(' · 分支')).toBe(true);
    expect(flowerForkTitle('  inspect\n the runtime  ', 'Fork')).toBe('inspect the runtime · Fork');
  });
});
