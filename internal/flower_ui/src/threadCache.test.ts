import { describe, expect, it } from 'vitest';
import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import {
  classifyThreadView,
  createThreadCache,
  threadSnapshotRevision,
  threadSummaryNeedsDetail,
  type ThreadView,
} from './threadCache';

function thread(id: string, version: number, text: string): FlowerThreadSnapshot {
  return {
    thread_id: id, title: id, title_status: 'ready', model_id: 'model', working_dir: '/',
    settings_revision: 1, permission_type: 'approval_required',
    created_at_ms: 1, updated_at_ms: version, status: 'success', source_label: 'test', target_labels: [],
    messages: [{ id: `${id}-message`, role: 'assistant', content: text, status: 'complete', created_at_ms: version }],
    read_status: { is_unread: false, snapshot: { activity_revision: version, last_message_at_unix_ms: version, activity_signature: text }, read_state: { last_seen_activity_revision: version, last_read_message_at_unix_ms: version, last_seen_activity_signature: text } },
  };
}

function view(id: string, version: number, text: string): ThreadView {
  const snapshot = thread(id, version, text);
  return { thread: snapshot, version };
}

function receive(
  cache: ReturnType<typeof createThreadCache>,
  candidate: ThreadView,
  options?: Readonly<{ preserveSummary?: boolean }>,
) {
  return cache.receiveView(candidate, options).cache;
}

describe('ThreadCache', () => {
  it('uses only the runtime view version to classify detail snapshots', () => {
    const current = view('a', 4, 'current');
    expect(classifyThreadView(undefined, current)).toBe('accepted');
    expect(classifyThreadView(current, view('a', 5, 'newer'))).toBe('accepted');
    expect(classifyThreadView(current, view('a', 4, 'same version'))).toBe('unchanged');
    expect(classifyThreadView(current, view('a', 3, 'older'))).toBe('stale');
  });

  it('accepts a newer settings revision without replacing runtime content', () => {
    let cache = receive(createThreadCache(), view('a', 4, 'runtime-current'));
    const candidate = view('a', 4, 'runtime-duplicate');
    const result = cache.receiveView({
      ...candidate,
      thread: {
        ...candidate.thread,
        settings_revision: 2,
        permission_type: 'full_access',
      },
    });

    cache = result.cache;
    expect(result.state).toBe('accepted');
    expect(result.runtimeState).toBe('unchanged');
    expect(result.settingsState).toBe('accepted');
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('runtime-current');
    expect(cache.views.get('a')?.thread.permission_type).toBe('full_access');
  });

  it('accepts newer runtime content without restoring stale settings', () => {
    const initial = view('a', 4, 'runtime-current');
    let cache = receive(createThreadCache(), {
      ...initial,
      thread: { ...initial.thread, settings_revision: 5, permission_type: 'full_access' },
    });
    const candidate = view('a', 6, 'runtime-new');
    const result = cache.receiveView({
      ...candidate,
      thread: { ...candidate.thread, settings_revision: 3, permission_type: 'approval_required' },
    });

    cache = result.cache;
    expect(result.runtimeState).toBe('accepted');
    expect(result.settingsState).toBe('stale');
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('runtime-new');
    expect(cache.views.get('a')?.thread.permission_type).toBe('full_access');
    expect(cache.views.get('a')?.thread.settings_revision).toBe(5);
  });

  it('detects when a summary revision or lifecycle state is ahead of detail', () => {
    const detail = thread('a', 4, 'detail');
    expect(threadSnapshotRevision(detail)).toBe(4);
    expect(threadSummaryNeedsDetail({ ...detail, messages: [] }, detail)).toBe(false);
    expect(threadSummaryNeedsDetail({ ...detail, updated_at_ms: 5, messages: [] }, detail)).toBe(true);
    expect(threadSummaryNeedsDetail({
      ...detail,
      status: 'success',
      active_run_id: undefined,
      messages: [],
    }, {
      ...detail,
      status: 'running',
      active_run_id: 'run-a',
    })).toBe(true);
    expect(threadSummaryNeedsDetail({
      ...detail,
      updated_at_ms: 3,
      status: 'running',
      active_run_id: 'stale-run',
      messages: [],
      read_status: {
        ...detail.read_status,
        snapshot: {
          ...detail.read_status.snapshot,
          activity_revision: 3,
          last_message_at_unix_ms: 3,
        },
      },
    }, detail)).toBe(false);
  });

  it('revalidates a successful detail that contains only the user message', () => {
    const summary = thread('a', 4, 'summary');
    const detail = {
      ...thread('a', 4, 'user only'),
      messages: [{ id: 'user-a', role: 'user' as const, content: 'hello', status: 'complete' as const, created_at_ms: 4 }],
    };
    expect(threadSummaryNeedsDetail(summary, detail)).toBe(true);
  });

  it('replaces the ordered summary collection without touching cached detail', () => {
    let cache = receive(createThreadCache(), view('a', 4, 'detail-a'));
    cache = cache.replaceSummaries([
      { ...thread('b', 5, 'summary-b'), messages: [] },
      { ...thread('a', 5, 'summary-a'), messages: [] },
    ]);

    expect([...cache.summaries.keys()]).toEqual(['b', 'a']);
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('detail-a');
  });

  it('updates summary metadata without mutating the cached detail view', () => {
    let cache = receive(createThreadCache(), view('a', 4, 'detail-a'));
    cache = cache.updateSummaryAdjuncts('a', (current) => ({
      ...current,
      read_status: { ...current.read_status, is_unread: true },
    }));

    expect(cache.summaries.get('a')?.read_status.is_unread).toBe(true);
    expect(cache.summaries.get('a')?.messages).toEqual([]);
    expect(cache.views.get('a')?.thread.read_status.is_unread).toBe(false);
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('detail-a');
  });

  it('keeps detail messages when a summary-only refresh arrives', () => {
    let cache = receive(createThreadCache(), view('a', 4, 'detail'));
    cache = cache.replaceSummary({ ...thread('a', 5, 'summary'), messages: [] });
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('detail');
    expect(cache.summaries.get('a')?.messages).toEqual([]);
  });

  it('does not let an older accepted detail erase an advanced terminal summary', () => {
    const running = {
      ...thread('a', 4, 'running'),
      status: 'running' as const,
      active_run_id: 'run-a',
    };
    const completed = {
      ...thread('a', 5, 'completed'),
      messages: [],
    };
    let cache = createThreadCache().replaceSummary(completed);
    cache = receive(cache, { thread: running, version: 4 }, { preserveSummary: true });

    expect(cache.views.get('a')?.thread.status).toBe('running');
    expect(cache.summaries.get('a')?.status).toBe('success');
    expect(threadSummaryNeedsDetail(cache.summaries.get('a'), cache.views.get('a')?.thread)).toBe(true);
  });

  it('drops stale views and keeps the selected id independent of fetch completion', () => {
    let cache = receive(receive(createThreadCache(), view('a', 2, 'a')), view('b', 1, 'b')).select('b');
    cache = receive(cache, view('a', 1, 'late-a'));
    expect(cache.selectedId).toBe('b');
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('a');
  });

  it('retains bounded recent views for A to B to A without blanking', () => {
    let cache = receive(receive(createThreadCache(), view('a', 1, 'A')), view('b', 1, 'B')).select('b');
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
