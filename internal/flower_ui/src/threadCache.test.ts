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
    read_status: { is_unread: false, snapshot: { activity_revision: version }, read_state: { last_seen_activity_revision: version } },
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
    expect(result.activityState).toBe('unchanged');
    expect(result.settingsState).toBe('accepted');
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('runtime-current');
    expect(cache.views.get('a')?.thread.permission_type).toBe('full_access');
  });

  it('accepts newer activity metadata without replacing runtime content or settings', () => {
    const current = view('a', 81, 'canonical assistant reply');
    let cache = receive(createThreadCache(), {
      ...current,
      thread: {
        ...current.thread,
        updated_at_ms: 3_589,
        settings_revision: 7,
        permission_type: 'full_access',
        read_status: {
          is_unread: true,
          snapshot: {
            activity_revision: 3_589,
          },
          read_state: current.thread.read_status.read_state,
        },
      },
    });
    const candidate = view('a', 81, 'duplicate runtime content');
    const result = cache.receiveView({
      ...candidate,
      thread: {
        ...candidate.thread,
        updated_at_ms: 5_555,
        settings_revision: 7,
        permission_type: 'approval_required',
        read_status: {
          is_unread: false,
          snapshot: {
            activity_revision: 5_555,
          },
          read_state: {
            last_seen_activity_revision: 5_555,
          },
        },
      },
    });

    cache = result.cache;
    expect(result.state).toBe('accepted');
    expect(result.runtimeState).toBe('unchanged');
    expect(result.activityState).toBe('accepted');
    expect(result.settingsState).toBe('unchanged');
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('canonical assistant reply');
    expect(cache.views.get('a')?.thread.updated_at_ms).toBe(5_555);
    expect(cache.views.get('a')?.thread.read_status.snapshot.activity_revision).toBe(5_555);
    expect(cache.views.get('a')?.thread.permission_type).toBe('full_access');
    expect(cache.summaries.get('a')?.updated_at_ms).toBe(5_555);
    expect(threadSummaryNeedsDetail(cache.summaries.get('a'), cache.views.get('a')?.thread)).toBe(false);
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
    expect(result.activityState).toBe('accepted');
    expect(result.settingsState).toBe('stale');
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('runtime-new');
    expect(cache.views.get('a')?.thread.permission_type).toBe('full_access');
    expect(cache.views.get('a')?.thread.settings_revision).toBe(5);
  });

  it('accepts newer runtime content without restoring stale activity metadata', () => {
    const initial = view('a', 4, 'runtime-current');
    let cache = receive(createThreadCache(), {
      ...initial,
      thread: {
        ...initial.thread,
        updated_at_ms: 10,
        read_status: {
          ...initial.thread.read_status,
          snapshot: {
            ...initial.thread.read_status.snapshot,
            activity_revision: 10,
          },
        },
      },
    });
    const candidate = view('a', 6, 'runtime-new');
    const result = cache.receiveView(candidate);

    cache = result.cache;
    expect(result.runtimeState).toBe('accepted');
    expect(result.activityState).toBe('stale');
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('runtime-new');
    expect(cache.views.get('a')?.thread.updated_at_ms).toBe(10);
    expect(cache.views.get('a')?.thread.read_status.snapshot.activity_revision).toBe(10);
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
        },
      },
    }, detail)).toBe(false);
  });

  it('tracks settings revision independently from activity revision', () => {
    const detail = thread('a', 4, 'detail');
    const settingsAhead = {
      ...detail,
      settings_revision: 2,
      permission_type: 'full_access' as const,
      messages: [],
    };
    expect(threadSnapshotRevision(settingsAhead)).toBe(4);
    expect(threadSummaryNeedsDetail(settingsAhead, detail)).toBe(true);
    expect(threadSummaryNeedsDetail({
      ...settingsAhead,
      updated_at_ms: 3,
      read_status: {
        ...settingsAhead.read_status,
        snapshot: { activity_revision: 3 },
      },
    }, detail)).toBe(true);
    expect(threadSummaryNeedsDetail(detail, {
      ...detail,
      settings_revision: 2,
      permission_type: 'full_access',
    })).toBe(false);
    expect(threadSummaryNeedsDetail({ ...detail, status: 'running', active_run_id: 'old-run' }, {
      ...detail,
      settings_revision: 2,
      status: 'success',
      active_run_id: undefined,
    })).toBe(false);
  });

  it.each(['replaceSummary', 'replaceSummaries', 'resetRootSummaries'] as const)(
    'keeps activity and settings independently monotonic through %s', (method) => {
      const current = { ...thread('a', 10, 'current'), settings_revision: 3, permission_type: 'full_access' as const };
      let cache = receive(createThreadCache(), { thread: current, version: 5 });
      const replace = (candidate: FlowerThreadSnapshot) => {
        cache = method === 'replaceSummary' ? cache.replaceSummary(candidate) : cache[method]([candidate]);
      };
      replace({ ...thread('a', 8, 'old activity'), settings_revision: 4, model_id: 'new-model', working_dir: '/new' });
      expect(cache.summaries.get('a')).toMatchObject({ updated_at_ms: 10, settings_revision: 4, model_id: 'new-model', working_dir: '/new' });
      expect(cache.views.get('a')?.thread).toEqual(current);
      replace({ ...thread('a', 11, 'new activity'), settings_revision: 2 });
      expect(cache.summaries.get('a')).toMatchObject({ updated_at_ms: 11, settings_revision: 4, model_id: 'new-model', working_dir: '/new' });
      replace(thread('a', 9, 'late duplicate'));
      expect(cache.summaries.get('a')).toMatchObject({ updated_at_ms: 11, settings_revision: 4, messages: [] });
      expect(threadSummaryNeedsDetail(cache.summaries.get('a'), current)).toBe(true);
    },
  );

  it('preserves all newer composer settings when an older settings response advances runtime', () => {
    const settings = {
      settings_revision: 5, model_id: 'new-model', working_dir: '/new',
      permission_type: 'full_access' as const, reasoning_selection: { level: 'high' as const },
    };
    const initial = { thread: { ...thread('a', 10, 'current'), ...settings }, version: 3 };
    const cache = receive(receive(createThreadCache(), initial), view('a', 11, 'new reply'));
    expect(cache.views.get('a')?.thread).toMatchObject(settings);
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('new reply');
  });

  it('does not infer staleness from the content shape of an equal-revision detail', () => {
    const summary = thread('a', 4, 'summary');
    const detail = {
      ...thread('a', 4, 'user only'),
      messages: [{ id: 'user-a', role: 'user' as const, content: 'hello', status: 'complete' as const, created_at_ms: 4 }],
    };
    expect(threadSummaryNeedsDetail(summary, detail)).toBe(false);
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

  it('does not let accepted detail metadata regress a newer preserved summary', () => {
    const cached = view('a', 4, 'cached runtime');
    let cache = receive(createThreadCache(), {
      ...cached,
      thread: {
        ...cached.thread,
        updated_at_ms: 4,
        settings_revision: 1,
      },
    });
    const advancedSummary = {
      ...thread('a', 9, 'advanced summary'),
      messages: [],
      settings_revision: 9,
      permission_type: 'full_access' as const,
    };
    cache = cache.replaceSummary(advancedSummary);
    const candidate = view('a', 5, 'new runtime');
    const result = cache.receiveView({
      ...candidate,
      thread: {
        ...candidate.thread,
        settings_revision: 5,
        permission_type: 'approval_required',
      },
    }, { preserveSummary: true });

    expect(result.runtimeState).toBe('accepted');
    expect(result.activityState).toBe('accepted');
    expect(result.settingsState).toBe('accepted');
    expect(result.cache.views.get('a')?.thread.updated_at_ms).toBe(5);
    expect(result.cache.summaries.get('a')?.updated_at_ms).toBe(9);
    expect(result.cache.summaries.get('a')?.settings_revision).toBe(9);
    expect(result.cache.summaries.get('a')?.permission_type).toBe('full_access');
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

  it('resets stale child entries from an authoritative root baseline', () => {
    let cache = receive(receive(createThreadCache(), view('root', 2, 'root')), view('child', 1, 'child')).select('child');
    cache = cache.resetRootSummaries([{ ...thread('root', 3, 'root summary'), messages: [] }]);

    expect([...cache.summaries.keys()]).toEqual(['root']);
    expect([...cache.views.keys()]).toEqual(['root']);
    expect(cache.selectedId).toBeNull();
  });

  it('applies a Subagent inventory only to an existing parent detail', () => {
    const inventory = [{
      parent_thread_id: 'root', thread_id: 'child', task_name: 'Research models', status: 'running',
      can_send_input: true, can_interrupt: true, can_close: true,
    }];
    let cache = receive(createThreadCache(), view('root', 2, 'root'));
    cache = cache.updateDetailAdjuncts('root', (current) => ({ ...current, subagents: inventory }));
    cache = cache.updateDetailAdjuncts('missing-parent', (current) => ({ ...current, subagents: inventory }));

    expect(cache.views.get('root')?.thread.subagents).toEqual(inventory);
    expect(cache.summaries.has('child')).toBe(false);
    expect(cache.views.has('child')).toBe(false);
    expect(cache.summaries.has('missing-parent')).toBe(false);
  });
});
