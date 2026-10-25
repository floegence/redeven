import { describe, expect, it } from 'vitest';
import { createFlowerThreadBaseline } from './threadBaseline';
import type { FlowerThreadSnapshot, FlowerRuntimeCurrentView, FlowerRuntimeUpdate } from './contracts/flowerSurfaceContracts';
import {
  classifyThreadView,
  createThreadCache,
  threadSnapshotRevision,
  threadSummaryNeedsDetail,
  type ThreadView,
} from './threadCache';

function thread(id: string, version: number, text: string): FlowerThreadSnapshot {
  return {
    thread_id: id, title: id, title_status: 'ready', title_generation: 1, model_id: 'model', working_dir: '/',
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
  it('hydrates editable product settings independently of a newer subagent runtime baseline', () => {
    const child = { ...thread('child', 2, 'child answer'), settings_revision: 0, model_id: '',
      parent_thread_id: 'parent', read_only_reason: 'Managed subagent projection' };
    let cache = receive(createThreadCache(), { thread: child, version: 7 });
    const product = { ...child, model_id: 'provider/model', settings_revision: 1, read_only_reason: undefined };
    cache = receive(cache, { thread: product, version: 6 });
    expect(cache.views.get('child')?.version).toBe(7);
    expect(cache.views.get('child')?.thread.model_id).toBe('provider/model');
    expect(cache.views.get('child')?.thread.read_only_reason).toBeUndefined();
    expect(cache.views.get('child')?.thread.parent_thread_id).toBe('parent');
  });
  it('accepts current read restrictions without requiring a settings revision change', () => {
    let cache = receive(createThreadCache(), view('root', 2, 'body'));
    cache = receive(cache, { version: 9, thread: { ...thread('root', 2, 'body'), read_only_reason: 'Read-only access' } });
    expect(cache.views.get('root')?.thread.read_only_reason).toBe('Read-only access');
  });
  it('merges read confirmations independently of activity and body revisions', () => {
    const unread = { ...thread('a', 7, 'body seven'), read_status: { is_unread: true, snapshot: { activity_revision: 7 }, read_state: { last_seen_activity_revision: 6 } } };
    let cache = receive(createThreadCache(), { thread: unread, version: 7 });
    const confirmed = { ...unread, read_status: { ...unread.read_status, is_unread: false, read_state: { last_seen_activity_revision: 7 } } };
    cache = receive(cache, { thread: confirmed, version: 7 });
    expect(cache.views.get('a')?.thread.read_status.read_state.last_seen_activity_revision).toBe(7);
    cache = cache.replaceSummary(unread);
    cache = receive(cache, { thread: unread, version: 6 });
    expect(cache.summaries.get('a')?.read_status.is_unread).toBe(false);
    expect(cache.views.get('a')?.thread.read_status.is_unread).toBe(false);
    const newer = { ...unread, updated_at_ms: 9, read_status: { ...unread.read_status, snapshot: { activity_revision: 9 } } };
    cache = cache.replaceSummary(newer);
    cache = cache.applyReadStatus('a', confirmed.read_status);
    expect(cache.summaries.get('a')?.read_status.snapshot.activity_revision).toBe(9);
    expect(cache.summaries.get('a')?.read_status.is_unread).toBe(true);
    expect(cache.views.get('a')?.contentRevision).toBe(7);
    expect(threadSummaryNeedsDetail(cache.summaries.get('a'), cache.views.get('a')?.thread, cache.views.get('a')?.contentRevision)).toBe(true);
  });

  it('never treats a viewer event as newly loaded content', () => {
    let cache = receive(createThreadCache(), view('a', 7, 'body seven'));
    cache = cache.applyReadStatus('a', { is_unread: false, snapshot: { activity_revision: 9 }, read_state: { last_seen_activity_revision: 9 } });
    expect(cache.summaries.get('a')?.read_status.snapshot.activity_revision).toBe(9);
    expect(cache.views.get('a')?.contentRevision).toBe(7);
    expect(threadSummaryNeedsDetail(cache.summaries.get('a'), cache.views.get('a')?.thread, cache.views.get('a')?.contentRevision)).toBe(true);
  });

  it('keeps shared activity independent of interleaved window confirmations', () => {
    let cache = receive(createThreadCache(), view('a', 7, 'body seven'));
    const { read_status: _readStatus, ...shared } = thread('a', 12, 'shared');
    cache = cache.replaceSummary(shared);
    for (const seen of [9, 7, 11, 8]) {
      cache = cache.applyReadStatus('a', { is_unread: false, snapshot: { activity_revision: seen }, read_state: { last_seen_activity_revision: seen } });
    }
    expect(cache.summaries.get('a')?.read_status).toEqual({ is_unread: true, snapshot: { activity_revision: 12 }, read_state: { last_seen_activity_revision: 11 } });
    expect(cache.views.get('a')?.contentRevision).toBe(7);
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('body seven');
  });

  it('binds content revision to the retained body across runtime replacement', () => {
    let cache = receive(createThreadCache(), view('a', 7, 'body seven'));
    cache = cache.invalidateRuntimeVersions();
    cache = receive(cache, view('a', 1, 'replacement body'));
    expect(cache.views.get('a')?.contentRevision).toBe(1);
    expect(threadSummaryNeedsDetail(cache.summaries.get('a'), cache.views.get('a')?.thread, cache.views.get('a')?.contentRevision)).toBe(true);
    cache = cache.receiveCurrent({ version: 2, thread: thread('a', 12, 'live body') }).cache;
    expect(cache.views.get('a')?.contentRevision).toBe(1);
  });

  it.each([15, 24])('retains the selected detail through %i reconnect baselines within the cache bound', (count) => {
    let cache = receive(createThreadCache(), view('selected', 27, 'Retained transcript')).select('selected');
    const summaries = [thread('selected', 1, ''), ...Array.from({ length: count - 1 }, (_, index) => thread(`background-${index}`, 1, ''))];
    for (let cycle = 0; cycle < 3; cycle++) {
      cache = cache.invalidateRuntimeVersions().resetRootSummaries(summaries);
      expect(cache.views.get('selected')?.thread.messages[0]?.content).toBe(cycle ? 'Current transcript' : 'Retained transcript');
      for (const summary of summaries) {
        cache = receive(cache, view(summary.thread_id, cycle + 1, 'Current transcript'));
        expect(cache.selectedId).toBe('selected');
        expect(cache.views.has('selected')).toBe(true);
        expect(cache.views.size).toBeLessThanOrEqual(12);
      }
    }
    cache = cache.select('background-0').select('selected').evict('selected');
    expect(cache.selectedId).toBeNull();
    expect(cache.views.has('selected')).toBe(false);
  });

  it('retains an opened child at capacity without selecting it in the sidebar', () => {
    let cache = createThreadCache();
    for (let index = 0; index < 12; index++) {
      cache = receive(cache.select('root-' + index), view('root-' + index, 1, 'Root body'));
    }
    cache = cache.retainDetails(['child']);
    const result = cache.receiveView(view('child', 3, 'Child work'));
    expect(result.state).toBe('accepted');
    cache = result.cache;
    expect(cache.selectedId).toBe('root-11');
    expect(cache.views.get('child')?.thread.messages[0]?.content).toBe('Child work');
    expect(cache.views.has('root-0')).toBe(false);
    expect(cache.views.size).toBe(12);
    for (let index = 0; index < 20; index++) {
      cache = receive(cache, view('background-' + index, 1, 'Background'));
      expect(cache.views.has('child')).toBe(true);
      expect(cache.views.has('root-11')).toBe(true);
      expect(cache.views.size).toBeLessThanOrEqual(12);
    }
  });

  it('retains only explicitly displayed children through root refresh and reconnect', () => {
    let cache = receive(createThreadCache().select('root'), view('root', 1, 'Root body'));
    cache = receive(cache.retainDetails(['child']), view('child', 7, 'Child work'));
    cache = receive(cache, view('old-child', 1, 'Old work'));
    for (let cycle = 0; cycle < 3; cycle++) {
      cache = cache.replaceSummaries([thread('root', 1, '')]);
      expect(cache.views.get('child')?.thread.messages[0]?.content).toBe('Child work');
      expect(cache.views.has('old-child')).toBe(false);
      cache = cache.invalidateRuntimeVersions().resetRootSummaries([thread('root', 1, '')]);
      expect(cache.selectedId).toBe('root');
      expect(cache.views.get('child')?.thread.messages[0]?.content).toBe('Child work');
      cache = receive(cache, view('child', 1, 'Child work'));
    }
    cache = cache.retainDetails([]).resetRootSummaries([thread('root', 1, '')]);
    expect(cache.views.has('child')).toBe(false);
    expect(cache.summaries.has('child')).toBe(false);
    expect(cache.selectedId).toBe('root');
    const reloaded = cache.receiveView(view('child', 1, 'Fresh child work'));
    expect(reloaded.runtimeState).toBe('accepted');
    expect(reloaded.cache.views.get('child')?.thread.messages[0]?.content).toBe('Fresh child work');
  });

  it('retains attention selection before its first detail arrives and releases visit priority normally', () => {
    let cache = receive(createThreadCache(), view('root', 1, 'Root body'));
    cache = cache.select('child').retainDetails(['child']).resetRootSummaries([thread('root', 1, '')]);
    expect(cache.selectedId).toBe('child');
    cache = receive(cache, view('child', 1, 'Attention body'));
    expect(cache.retainDetails(['child', 'child'])).toBe(cache);
    cache = cache.select('root').retainDetails([]);
    for (let index = 0; index < 12; index++) {
      const id = 'visited-' + index;
      cache = receive(cache.select(id), view(id, 1, 'Visited'));
    }
    expect(cache.views.size).toBe(12);
    expect(cache.views.has('child')).toBe(false);
  });

  it('uses user visits for eviction priority rather than background refresh frequency', () => {
    let cache = receive(createThreadCache(), view('visited', 1, 'Visited')).select('visited');
    cache = receive(cache, view('selected', 1, 'Selected')).select('selected');
    for (let index = 0; index < 10; index++) cache = receive(cache, view(`background-${index}`, 1, 'Background'));
    cache = receive(cache, view('background-0', 2, 'Frequent background update'));
    cache = receive(cache, view('new-background', 1, 'New background'));
    expect(cache.views.has('visited')).toBe(true);
    expect(cache.views.has('selected')).toBe(true);
    expect(cache.views.has('background-0')).toBe(false);
    expect(cache.views.size).toBe(12);
  });

  it('retains presentation but resets process-local ordering at a transport boundary', () => {
    const before = receive(createThreadCache(), view('a', 27, 'previous pixels'));
    const reset = before.invalidateRuntimeVersions();
    expect(reset.views.get('a')?.version).toBe(0);
    expect(reset.views.get('a')?.thread).toEqual(before.views.get('a')?.thread);
    expect(reset.views.get('a')?.thread.messages).toBe(before.views.get('a')?.thread.messages);
    const fresh = receive(reset, view('a', 1, 'restarted runtime'));
    expect(fresh.views.get('a')?.thread.messages[0].content).toBe('restarted runtime');
    expect(receive(fresh, view('a', 1, 'duplicate')).views.get('a')?.thread.messages[0].content).toBe('restarted runtime');
  });
  it('keeps execution results in accepted canonical detail, never summary refreshes', () => {
    const stopped = { ...view('a', 4, 'stopped'), thread: { ...thread('a', 4, 'stopped'), current_execution: { turn_id: 'turn-a', run_id: 'run-a', status: 'canceled' as const } } };
    let cache = receive(createThreadCache(), stopped);
    cache = cache.replaceSummary({ ...thread('a', 9, 'summary'), current_execution: { turn_id: 'wrong', run_id: 'wrong', status: 'success' } });
    cache = receive(cache, { ...stopped, version: 3, thread: { ...stopped.thread, current_execution: undefined } });
    expect(cache.views.get('a')?.thread.current_execution).toEqual(stopped.thread.current_execution);
    expect(cache.summaries.get('a')?.current_execution).toBeUndefined();
    cache = receive(cache, { ...stopped, version: 5, thread: { ...stopped.thread, current_execution: { turn_id: 'text-turn', run_id: 'text-run', status: 'running' } } });
    expect(cache.views.get('a')?.thread.current_execution?.run_id).toBe('text-run');
  });
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

  it('derives unread from watermarks instead of accepting boolean-only adjunct overrides', () => {
    let cache = receive(createThreadCache(), view('a', 4, 'detail-a'));
    cache = cache.updateSummaryAdjuncts('a', (current) => ({
      ...current,
      read_status: { ...current.read_status, is_unread: true },
    }));

    expect(cache.summaries.get('a')?.read_status.is_unread).toBe(false);
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
    expect(threadSummaryNeedsDetail(cache.summaries.get('a'), cache.views.get('a')?.thread, cache.views.get('a')?.contentRevision)).toBe(true);
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

  it('retains only an explicitly selected child through a root baseline until detail revalidation', () => {
    let cache = receive(receive(createThreadCache(), view('root', 2, 'root')), view('child', 1, 'child')).select('child');
    cache = cache.retainDetails(['child']).resetRootSummaries([thread('root', 3, '')]);
    expect(cache.selectedId).toBe('child');
    expect(cache.views.get('child')?.thread.messages[0]?.content).toBe('child');
    cache = cache.replaceSummaries([thread('root', 4, '')]);
    expect(cache.selectedId).toBe('child');
    expect(cache.views.has('child')).toBe(true);
    cache = cache.select('root').retainDetails([]).resetRootSummaries([thread('root', 4, '')]);
    expect([...cache.summaries.keys()]).toEqual(['root']);
    expect(cache.views.has('child')).toBe(false);
  });

  it('applies a Subagent inventory only to an existing parent detail', () => {
    const inventory = [{
      parent_thread_id: 'root', thread_id: 'child', task_name: 'Research models', title: 'Research models', title_status: 'ready' as const, title_generation: 1, status: 'running',
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

describe('canonical title ownership', () => {
  it('preserves a generated title across a later runtime view built from untitled detail', () => {
    const empty = { ...view('a', 1, 'thinking'), thread: { ...thread('a', 1, 'thinking'), title: '', title_status: 'unset' as const, title_generation: 0, } };
    let cache = receive(createThreadCache(), empty);
    const named = { ...thread('a', 2, ''), title: 'Hi', title_status: 'ready' as const, title_generation: 1, };
    cache = cache.replaceSummary(named);
    cache = cache.receiveCurrent({ version: 2, thread: { ...empty.thread, updated_at_ms: 2, read_status: named.read_status } }).cache;
    expect(cache.summaries.get('a')?.title).toBe('Hi');
    expect(cache.views.get('a')?.thread.title).toBe('Hi');
    cache = receive(cache, { version: 2, thread: named });
    expect(cache.summaries.get('a')?.title).toBe('Hi');
    expect(cache.views.get('a')?.thread.title).toBe('Hi');
  });
});

describe('title updates independent of runtime revisions', () => {
  it('accepts a title from equal or older detail without replacing newer messages', () => {
    let cache = receive(createThreadCache(), view('a', 8, 'Latest reply'));
    for (const version of [8, 7]) {
      const candidate = { ...thread('a', 4, 'Stale reply'), title: `Rename ${version}`, title_generation: 10 - version };
      const result = cache.receiveView({ thread: candidate, version });
      cache = result.cache;
      expect(result.state).toBe('accepted');
      expect(result.runtimeState).toBe(version === 8 ? 'unchanged' : 'stale');
      expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('Latest reply');
      expect(cache.views.get('a')?.thread.title).toBe(candidate.title);
      expect(cache.summaries.get('a')?.title).toBe(candidate.title);
    }
  });

  it('rejects stale list, detail, and reconnect titles after manual rename', () => {
    const stale = thread('a', 20, 'Body');
    const manual = { ...stale, title: 'Manual', title_generation: 4 };
    let cache = receive(createThreadCache(), { version: 2, thread: manual }).select('a');
    cache = cache.replaceSummary(stale).replaceSummaries([stale]).resetRootSummaries([stale]);
    cache = receive(cache, { version: 3, thread: stale });
    expect(cache.summaries.get('a')?.title).toBe('Manual');
    expect(cache.views.get('a')?.thread.title).toBe('Manual');
    expect(cache.selectedId).toBe('a');
  });

  it('updates titles without fetching details or changing activity, selection, and list order', () => {
    let cache = receive(createThreadCache(), view('a', 2, 'A'));
    cache = receive(cache, view('b', 3, 'B')).select('b');
    const named = { ...thread('a', 2, ''), title: 'Named A', title_generation: 2 };
    cache = cache.replaceSummary(named);
    expect([...cache.summaries.keys()]).toEqual(['a', 'b']);
    expect(cache.selectedId).toBe('b');
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('A');
    expect(cache.views.get('a')?.thread.title).toBe('Named A');
    expect(threadSummaryNeedsDetail(cache.summaries.get('a'), cache.views.get('a')?.thread)).toBe(false);
    expect(cache.summaries.get('a')?.read_status).toEqual(named.read_status);
  });

  it('retains summary title after detail eviction and stale hydration', () => {
    let cache = receive(createThreadCache(), { version: 1, thread: { ...thread('a', 1, 'A'), title: 'Named', title_generation: 2 } });
    for (let i = 0; i < 12; i++) cache = receive(cache, view(`other-${i}`, 1, 'Other'));
    expect(cache.views.has('a')).toBe(false);
    cache = receive(cache.select('a'), view('a', 2, 'Loaded'));
    expect(cache.views.get('a')?.thread.title).toBe('Named');
  });

  it('preserves the last accepted state on a conflicting terminal snapshot', () => {
    const cache = receive(createThreadCache(), view('a', 1, 'A'));
    expect(() => cache.replaceSummary({ ...thread('a', 3, ''), title: 'Conflict' })).toThrow('Flower contract error');
    expect(cache.summaries.get('a')?.title).toBe('a');
    expect(cache.views.get('a')?.thread.messages[0]?.content).toBe('A');
  });

  it('prevents adjunct callbacks and runtime currents from authoring titles', () => {
    const cache = receive(createThreadCache(), view('a', 1, 'A'));
    expect(() => cache.updateSummaryAdjuncts('a', (detail) => ({ ...detail, title: 'Bypass' }))).toThrow('cannot author titles');
    expect(() => cache.updateDetailAdjuncts('a', (detail) => ({ ...detail, title: 'Bypass' }))).toThrow('cannot author titles');
    const projected = { ...thread('a', 2, 'Next'), title: 'Bypass', title_generation: 999 };
    const current = cache.receiveCurrent({ version: 2, thread: projected });
    expect(current.cache.views.get('a')?.thread.title).toBe('a');
    expect(current.cache.views.get('a')?.thread.messages[0]?.content).toBe('Next');
  });
  it('strips turn presentation from summaries and retains accepted historical outcomes', () => {
    const turns = [{ turn_id: 'turn', run_id: 'run', started_at: '2026-10-11T12:00:00Z', ended_at: '2026-10-11T12:00:01Z', outcome: 'interrupted' as const, elapsed_ms: 1000, waiting_ms: 0, work_duration_ms: 1000, final_item_ids: [], final_boundary_complete: false }];
    const detail = { ...thread('a', 1, 'Partial'), turns };
    let cache = receive(createThreadCache(), { version: 1, thread: detail });
    expect(cache.summaries.get('a')?.turns).toBeUndefined();
    cache = cache.replaceSummary({ ...thread('a', 2, ''), turns: [{ ...turns[0], outcome: 'completed' }] });
    expect(cache.summaries.get('a')?.turns).toBeUndefined();
    expect(cache.views.get('a')?.thread.turns?.[0].outcome).toBe('interrupted');
  });
});

describe('ThreadCache native baseline reads', () => {
  const current: FlowerRuntimeCurrentView = { thread_id: 'a', view_version: 2, activity: 'active', turn_id: 'turn', run_id: 'run', run_progress: { phase: 'streaming' },
    items: [{ id: 'answer', ordinal: 1, kind: 'assistant', text: 'text', live: true, turn_id: 'turn', run_id: 'run' }] };
  const update: FlowerRuntimeUpdate = { thread_id: 'a', base_version: 2, view_version: 3, turn_id: 'turn', run_id: 'run',
    facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } }, items: [{ kind: 'append', item_id: 'answer', append: { offset_bytes: 4, text: '!' } }] };
  it('confirms covered HTTP content behind a newer native cancellation without restoring its lifecycle', () => {
    const running = { ...thread('a', 7, ''), status: 'running' as const, active_run_id: 'run' };
    let cache = createThreadCache().receiveView({ thread: running, version: 2 }, { current }).cache;
    cache.receiveUpdate({ ...update, facts: { activity: 'idle', queue_count: 0, last_outcome: 'cancelled' } });
    cache = cache.replaceSummary({ ...running, updated_at_ms: 9, read_status: thread('a', 9, '').read_status });
    const response = { ...running, updated_at_ms: 9, read_status: thread('a', 9, '').read_status };
    cache = cache.receiveView({ thread: response, version: 2 }, { current, preserveSummary: false }).cache;
    expect(cache.views.get('a')?.version).toBe(3);
    expect(cache.views.get('a')?.thread.status).toBe('canceled');
    expect(cache.views.get('a')?.thread.messages[0].content).toBe('text!');
    expect(cache.views.get('a')?.contentRevision).toBe(9);
    expect(cache.summaries.get('a')?.status).toBe('canceled');
    expect(threadSummaryNeedsDetail(cache.summaries.get('a'), cache.views.get('a')?.thread, cache.views.get('a')?.contentRevision)).toBe(false);
  });
  it('requires a matching explicit native baseline before an older read can confirm content coverage', () => {
    const initial = { ...thread('a', 7, ''), status: 'running' as const, active_run_id: 'run' };
    let cache = createThreadCache().receiveView({ thread: initial, version: 2 }, { current }).cache;
    cache.receiveUpdate(update);
    const newerActivity = { ...initial, updated_at_ms: 9, read_status: thread('a', 9, '').read_status };
    cache = cache.receiveView({ thread: newerActivity, version: 2 }).cache;
    expect(cache.views.get('a')?.contentRevision).toBe(7);
    cache = cache.receiveView({ thread: newerActivity, version: 2 }, { current: { ...current, view_version: 1 } }).cache;
    expect(cache.views.get('a')?.contentRevision).toBe(7);
    cache = cache.receiveCurrent({ thread: newerActivity, version: 2 }, { current }).cache;
    expect(cache.views.get('a')?.contentRevision).toBe(7);
  });
  it('converges equal-revision summary lifecycle through an authoritative unchanged detail read', () => {
    const stopped = { ...thread('a', 9, 'retained'), status: 'canceled' as const };
    const current = { thread_id: 'a', view_version: 2, activity: 'idle' as const, last_outcome: 'cancelled' as const, items: [] };
    let cache = createThreadCache().receiveView({ thread: stopped, version: 2 }, { current }).cache;
    cache = cache.replaceSummary({ ...stopped, status: 'running', active_run_id: 'run' });
    expect(threadSummaryNeedsDetail(cache.summaries.get('a'), cache.views.get('a')?.thread, 9)).toBe(true);
    cache = cache.receiveView({ thread: stopped, version: 2 }, { current, preserveSummary: false }).cache;
    expect(cache.summaries.get('a')?.status).toBe('canceled');
    expect(threadSummaryNeedsDetail(cache.summaries.get('a'), cache.views.get('a')?.thread, 9)).toBe(false);
  });
  it('updates indexed records and their version without replacing the workspace cache', () => {
    const baseline = createThreadCache().receiveView({ thread: thread('a', 1, ''), version: 2 }, { current }).cache;
    const detail = baseline.views.get('a');
    const received = baseline.receiveUpdate(update);
    expect(received.accepted).toBe(true);
    expect(received.cache).toBe(baseline);
    expect(received.cache.views.get('a')).toBe(detail);
    expect(detail?.version).toBe(3);
    expect(detail?.thread.messages[0].content).toBe('text!');
  });
  it('buffers only demanded baselines, discards covered updates, and drains continuous successors', () => {
    let cache = createThreadCache().replaceSummary(thread('a', 1, ''));
    expect(cache.receiveUpdate(update).accepted).toBe(false);
    const release = cache.beginRuntimeRead('a');
    cache = cache.receiveUpdate({ ...update, base_version: 1, view_version: 2 }).cache;
    cache = cache.receiveUpdate(update).cache;
    const initial = { ...thread('a', 1, ''), status: 'running' as const, messages: [{ id: 'answer', role: 'assistant' as const, content: 'text', status: 'streaming' as const, live: true, active_cursor: true, created_at_ms: 1, turn_id: 'turn', run_id: 'run' }] };
    const received = cache.receiveView({ thread: initial, version: 2 }, { current }); cache = received.cache;
    expect(cache.views.get('a')?.version).toBe(3); expect(cache.views.get('a')?.thread.messages[0].content).toBe('text!');
    expect(received.observations).toHaveLength(1); release();
    cache = cache.invalidateRuntimeVersions(); const releaseOld = cache.beginRuntimeRead('a'); cache.receiveUpdate(update);
    cache = cache.invalidateRuntimeVersions(); releaseOld();
    expect(cache.receiveView({ thread: initial, version: 2 }, { current }).cache.views.get('a')?.version).toBe(2);
  });
  it('fences old read cleanup after a reconnect and releases each lease only once', () => {
    let cache = createThreadCache().replaceSummary(thread('a', 1, ''));
    const old = cache.beginRuntimeRead('a');
    cache = cache.invalidateRuntimeVersions();
    const currentRead = cache.beginRuntimeRead('a');
    const concurrent = cache.beginRuntimeRead('a');
    old(); currentRead(); currentRead();
    cache.receiveUpdate(update);
    const received = cache.receiveView({ thread: thread('a', 1, ''), version: 2 }, { current });
    expect(received.cache.views.get('a')?.version).toBe(3);
    concurrent();
    expect(() => { for (let i = 0; i < 100; i++) cache.receiveUpdate(update); }).not.toThrow();
  });
  it('invalidates a bounded pending read instead of silently overwriting deltas', () => {
    const cache = createThreadCache(); const release = cache.beginRuntimeRead('a');
    for (let i = 0; i < 64; i++) cache.receiveUpdate(update);
    expect(() => cache.receiveUpdate(update)).toThrow('overflow'); release();
    expect(() => cache.receiveUpdate(update)).not.toThrow();
  });
});

describe('bounded history windows', () => {
  it('keeps the installed interest live while its replacement baseline is pending', () => {
    const current: FlowerRuntimeCurrentView = { thread_id: 'a', turn_id: 'turn', run_id: 'run', view_version: 7, activity: 'active',
      run_progress: { phase: 'streaming' }, items: [{ id: 'answer', kind: 'assistant', text: 'text', ordinal: 1, turn_id: 'turn', run_id: 'run', live: true }],
      window: { first_item_id: 'answer', last_item_id: 'answer', has_before: true, has_after: false } };
    const base = { ...thread('a', 7, 'text'), history_window: current.window,
      messages: [{ ...thread('a', 7, '').messages[0], id: 'answer', content: 'text' }] };
    let cache = createThreadCache().receiveView({ thread: base, version: 7 }, { current }).cache;
    const release = cache.beginRuntimeRead('a');
    const result = cache.receiveUpdate({ thread_id: 'a', turn_id: 'turn', run_id: 'run', base_version: 7, view_version: 8,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
      items: [{ kind: 'append', item_id: 'answer', append: { offset_bytes: 4, text: '!' } }] }, { installedInterest: true });
    expect(result.accepted).toBe(true);
    expect(cache.views.get('a')!.thread.messages[0].content).toBe('text!');
    const next = { ...current, view_version: 8, items: [{ ...current.items![0], text: 'text!' }] };
    cache = cache.receiveView({ thread: { ...base, messages: [{ ...base.messages[0], content: 'text!' }] }, version: 8 }, { current: next }).cache;
    release();
    expect(cache.views.get('a')!.thread.messages[0].content).toBe('text!');
  });

  it('requires an installed receipt to accept a late window response after live growth', () => {
    const current: FlowerRuntimeCurrentView = { thread_id: 'a', turn_id: 'turn', run_id: 'run', view_version: 7, activity: 'active',
      run_progress: { phase: 'streaming' }, items: [{ id: 'answer', kind: 'assistant', text: 'text', ordinal: 1, turn_id: 'turn', run_id: 'run', live: true }],
      window: { first_item_id: 'answer', last_item_id: 'answer', has_before: true, has_after: false } };
    const base = { ...thread('a', 7, 'text'), history_window: current.window,
      messages: [{ ...thread('a', 7, '').messages[0], id: 'answer', content: 'text' }] };
    let cache = createThreadCache().receiveView({ thread: base, version: 7 }, { current }).cache;
    const release = cache.beginRuntimeRead('a');
    cache.receiveUpdate({ thread_id: 'a', turn_id: 'turn', run_id: 'run', base_version: 7, view_version: 8,
      facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
      items: [{ kind: 'append', item_id: 'answer', append: { offset_bytes: 4, text: '!' } }] }, { installedInterest: true });
    expect(() => cache.receiveView({ thread: base, version: 7 }, { current })).toThrow('overtaken');
    cache = cache.receiveView({ thread: base, version: 7 }, { current, installedBaseline: true }).cache;
    expect(cache.views.get('a')!.version).toBe(8);
    expect(cache.views.get('a')!.thread.messages[0].content).toBe('text!');
    release();
  });
  it('accepts same-version page movement and applies deltas delivered before its baseline', () => {
    const make = (id: string, version = 7): FlowerRuntimeCurrentView => ({ thread_id: 'a', turn_id: 'turn', run_id: 'run', view_version: version,
      activity: 'active', run_progress: { phase: 'streaming' }, items: [{ id, kind: 'assistant', text: id, ordinal: 1, turn_id: 'turn', run_id: 'run', live: true }],
      window: { first_item_id: id, last_item_id: id, has_before: id === 'new', has_after: id === 'old' } });
    const first = make('new');
    const project = (current: FlowerRuntimeCurrentView) => ({ ...thread('a', current.view_version, current.items![0].text!), history_window: current.window,
      messages: [{ ...thread('a', 7, '').messages[0], id: current.items![0].id, content: current.items![0].text! }] });
    let cache = createThreadCache().receiveView({ thread: project(first), version: 7 }, { current: first }).cache;
    const release = cache.beginRuntimeRead('a');
    const next = make('old');
    cache.receiveUpdate({ thread_id: 'a', turn_id: 'turn', run_id: 'run', base_version: 7, view_version: 8,
      facts: { activity: 'active', attention: {}, queue_count: 0, run_progress: { phase: 'streaming' } },
      items: [{ kind: 'append', item_id: 'old', append: { offset_bytes: 3, text: '!' } }] });
    cache = cache.receiveView({ thread: project(next), version: 7 }, { current: next }).cache;
    release();
    expect(cache.views.get('a')!.version).toBe(8);
    expect(cache.views.get('a')!.thread.messages[0].content).toBe('old!');
    expect(cache.views.get('a')!.thread.history_window?.has_after).toBe(true);
    expect(cache.summaries.get('a')!.history_window).toBeUndefined();
  });
});


describe('progressive root baseline', () => {
  it('retains selection and old roots until complete, preserves new local roots and viewer state', () => {
    const baseline = createFlowerThreadBaseline();
    let cache = receive(createThreadCache(), view('selected', 9, 'retained body')).select('selected');
    cache = cache.replaceSummary(thread('deleted', 1, ''));
    cache = baseline.apply(cache, { schema_version: 3, kind: 'ready', baseline_complete: false }, [thread('first', 1, '')]);
    expect(cache.selectedId).toBe('selected');
    expect(cache.views.get('selected')?.thread.messages[0]?.content).toBe('retained body');
    expect(cache.summaries.has('deleted')).toBe(true);
    cache = cache.replaceSummary(thread('created-during-load', 1, ''));
    cache = cache.applyReadStatus('selected', { is_unread: false, snapshot: { activity_revision: 9 }, read_state: { last_seen_activity_revision: 9 } });
    cache = baseline.apply(cache, { schema_version: 3, kind: 'summary.batch', baseline_complete: true }, [thread('selected', 9, '')]);
    expect(cache.selectedId).toBe('selected');
    expect([...cache.summaries.keys()].sort()).toEqual(['created-during-load', 'first', 'selected']);
    expect(cache.summaries.get('selected')?.read_status.read_state.last_seen_activity_revision).toBe(9);
  });
  it('discards interrupted membership before reconnect and clears removed selection only on completion', () => {
    const baseline = createFlowerThreadBaseline();
    let cache = receive(createThreadCache(), view('removed', 1, 'body')).select('removed');
    cache = baseline.apply(cache, { schema_version: 3, kind: 'ready', baseline_complete: false }, [thread('stale-page', 1, '')]);
    baseline.reset();
    expect(() => baseline.apply(cache, { schema_version: 3, kind: 'summary.batch', baseline_complete: true }, [])).toThrow();
    cache = baseline.apply(cache, { schema_version: 3, kind: 'ready', baseline_complete: true }, [thread('current', 1, '')]);
    expect([...cache.summaries.keys()]).toEqual(['current']);
    expect(cache.selectedId).toBeNull();
  });
});

it('evicts by retained bytes before entry count and protects displayed details', () => {
  const text = 'x'.repeat(5 << 20);
  let cache = createThreadCache().select('selected').retainDetails(['child']);
  cache = receive(cache, view('selected', 1, text));
  cache = receive(cache, view('child', 1, text));
  for (let i = 0; i < 6; i++) cache = receive(cache, view('background-' + i, 1, text));
  expect(cache.views.has('selected')).toBe(true);
  expect(cache.views.has('child')).toBe(true);
  expect(cache.views.size).toBeLessThan(8);
  expect(cache.summaries.size).toBe(8);
});

it('reaccounts a grown retained child before releasing its protection', () => {
  let cache = createThreadCache().select('selected').retainDetails(['child']);
  cache = receive(cache, view('selected', 1, 'selected'));
  cache = receive(cache, view('child', 1, 'small'));
  const child = cache.views.get('child')!;
  // Runtime message stores grow in place without touching cache visit order.
  Object.assign(child.thread.messages[0], { content: 'x'.repeat(20 << 20) });
  cache = cache.retainDetails([]);
  expect(cache.views.has('child')).toBe(false);
  expect(cache.views.has('selected')).toBe(true);
  expect(cache.summaries.has('child')).toBe(true);
});
