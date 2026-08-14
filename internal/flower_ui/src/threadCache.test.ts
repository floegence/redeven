import { describe, expect, it } from 'vitest';
import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { createThreadCache, type ThreadView } from './threadCache';

function thread(id: string, version: number, text: string): FlowerThreadSnapshot {
  return {
    thread_id: id, title: id, title_status: 'ready', model_id: 'model', working_dir: '/',
    created_at_ms: 1, updated_at_ms: version, status: 'success', source_label: 'test', target_labels: [],
    messages: [{ id: `${id}-message`, role: 'assistant', content: text, status: 'complete', created_at_ms: version }],
    read_status: { is_unread: false, snapshot: { activity_revision: version, last_message_at_unix_ms: version, activity_signature: text }, read_state: { last_seen_activity_revision: version, last_read_message_at_unix_ms: version, last_seen_activity_signature: text } },
  };
}

function view(id: string, version: number, text: string): ThreadView {
  const snapshot = thread(id, version, text);
  return { thread: snapshot, version };
}

describe('ThreadCache', () => {
  it('replaces the ordered summary collection without touching cached detail', () => {
    let cache = createThreadCache().replaceView(view('a', 4, 'detail-a'));
    cache = cache.replaceSummaries([
      { ...thread('b', 5, 'summary-b'), messages: [] },
      { ...thread('a', 5, 'summary-a'), messages: [] },
    ]);

    expect([...cache.summaries.keys()]).toEqual(['b', 'a']);
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('detail-a');
  });

  it('updates summary metadata without mutating the cached detail view', () => {
    let cache = createThreadCache().replaceView(view('a', 4, 'detail-a'));
    cache = cache.updateThread('a', (current) => ({ ...current, model_id: 'new-model' }));

    expect(cache.summaries.get('a')?.model_id).toBe('new-model');
    expect(cache.summaries.get('a')?.messages).toEqual([]);
    expect(cache.views.get('a')?.thread.model_id).toBe('model');
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('detail-a');
  });

  it('keeps detail messages when a summary-only refresh arrives', () => {
    let cache = createThreadCache().replaceView(view('a', 4, 'detail'));
    cache = cache.replaceSummary({ ...thread('a', 5, 'summary'), messages: [] });
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('detail');
    expect(cache.summaries.get('a')?.messages).toEqual([]);
  });

  it('drops stale views and keeps the selected id independent of fetch completion', () => {
    let cache = createThreadCache().replaceView(view('a', 2, 'a')).replaceView(view('b', 1, 'b')).select('b');
    cache = cache.replaceView(view('a', 1, 'late-a'));
    expect(cache.selectedId).toBe('b');
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('a');
  });

  it('retains bounded recent views for A to B to A without blanking', () => {
    let cache = createThreadCache().replaceView(view('a', 1, 'A')).replaceView(view('b', 1, 'B')).select('b');
    cache = cache.select('a');
    expect(cache.selectedId).toBe('a');
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('A');
  });

  it('does not let a summary-only update create or replace a detail view', () => {
    let cache = createThreadCache().replaceSummary({ ...thread('summary-only', 3, 'ignored'), messages: [] });
    expect(cache.summaries.get('summary-only')?.messages).toEqual([]);
    expect(cache.views.has('summary-only')).toBe(false);
  });
});
