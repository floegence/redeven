import '../index.css';
import './flower-feature.css';
import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import type { FlowerHistoryRequest, FlowerLiveStreamEnvelope, FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, deferred, disposeRenderedSurface, readStatus, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

async function mount(initialFailures = 0) {
  await page.viewport(1280, 900);
  const seed = thread({ thread_id: 'sync-history', title: 'History recovery', status: 'success', messages: [] });
  let refresh = initialFailures > 0;
  let failures = initialFailures;
  let attempt = 0;
  const items: FlowerRuntimeCurrentItem[] = [
    { id: 'user', ordinal: 1, kind: 'user', text: 'Inspect the result', turn_id: 'turn', run_id: 'run' },
    { id: 'earlier', ordinal: 2, kind: 'assistant', text: 'Earlier response', turn_id: 'turn', run_id: 'run' },
    { id: 'latest', ordinal: 3, kind: 'assistant', text: 'Accepted response', turn_id: 'turn', run_id: 'run' },
  ];
  const values: FlowerLiveStreamEnvelope[] = [];
  let wake: (() => void) | undefined;
  const push = (event: FlowerLiveStreamEnvelope) => { values.push(event); wake?.(); };
  const history = vi.fn(async (_id: string, request: FlowerHistoryRequest, signal: AbortSignal) => {
    signal.throwIfAborted();
    const boundary = Boolean(request.anchor_id);
    if (!boundary) attempt++;
    const selected = !refresh ? items : boundary ? items.slice(0, 2) : items.slice(2);
    if (refresh && !boundary && failures-- > 0) throw { code: 'transport' };
    const leaf = !refresh ? 'initial' : 'stable-' + attempt;
    const current: FlowerRuntimeCurrentView = {
      thread_id: seed.thread_id, view_version: refresh ? 8 : 7, activity: 'idle', last_outcome: 'completed',
      turn_id: 'turn', run_id: 'run', items: selected, interactions: [], queue: [],
      turns: [{ turn_id: 'turn', run_id: 'run', started_at: '2026-10-26T00:00:00Z', ended_at: '2026-10-26T00:01:00Z',
        outcome: 'completed', elapsed_ms: 60000, waiting_ms: 0, work_duration_ms: 60000, final_item_ids: selected.filter(item => item.id === 'latest').map(item => item.id), final_boundary_complete: true }],
      window: { leaf_id: leaf, first_item_id: selected[0].id, last_item_id: selected.at(-1)!.id, has_before: refresh && !boundary, has_after: boundary },
    };
    return { current, thread: applyFlowerRuntimeCurrentView({ ...seed, read_status: readStatus(false, refresh ? 3 : 2) }, current) };
  });
  const full = vi.fn(async () => { throw new Error('Unbounded history is forbidden'); });
  const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadHistory: history, loadThread: full,
    async *connectLiveStream({ signal }) {
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'sync-observer', summaries: [seed] };
      const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
      try { while (!signal.aborted) { const next = values.shift(); if (next) yield next; else await new Promise<void>(resolve => { wake = resolve; }); } }
      finally { signal.removeEventListener('abort', abort); }
    },
  }, { focusThreadRequest: { request_id: 'open-sync', thread_id: seed.thread_id } });
  root.style.height = '780px';
  return { root, history, full, push, refresh(count = 1) {
    refresh = true; failures = count;
    push({ schema_version: 3, kind: 'summary.batch', summaries: [{ ...seed, read_status: readStatus(false, 3) }] });
  }, recover() { failures = 0; } };
}

describe('Flower detail history recovery', () => {
  it('opens and settles a partial active turn without fetching its missing prefix', async () => {
    await page.viewport(1280, 900);
    const seed = thread({ thread_id: 'active-history', status: 'running', active_run_id: 'run', messages: [] });
    const items: FlowerRuntimeCurrentItem[] = [
      { id: 'user', ordinal: 1, kind: 'user', text: 'Inspect eighty tools', turn_id: 'turn', run_id: 'run' },
      ...Array.from({ length: 80 }, (_, index): FlowerRuntimeCurrentItem => ({
        id: 'tool-' + index, ordinal: index + 2, kind: 'tool', turn_id: 'turn', run_id: 'run',
        activity: { item_id: 'tool-' + index, tool_id: 'tool-' + index, kind: 'tool', tool_name: 'terminal.exec',
          status: 'success', severity: 'quiet', needs_attention: false, requires_approval: false,
          presentation: { label: 'Inspect file ' + index, renderer: 'terminal', payload: { command: 'inspect', output: 'Done' } } },
      })),
    ];
    for (const item of items) Object.assign(item, { canonical_ordinal: item.ordinal });
    let terminal = false;
    const terminalSummary = deferred<void>();
    let complete!: () => void;
    const finish = new Promise<void>(resolve => { complete = resolve; });
    const history = vi.fn(async (_id: string, input: FlowerHistoryRequest) => {
      const end = input.anchor_id ? items.findIndex(item => item.id === input.anchor_id) : items.length;
      const selected = items.slice(Math.max(0, end - (input.limit ?? 24)), end);
      const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, view_version: terminal ? 2 : 1,
        activity: terminal ? 'idle' : 'active', turn_id: 'turn', run_id: 'run', items: selected, interactions: [], queue: [],
        ...(terminal ? { last_outcome: 'completed' as const } : { run_progress: { phase: 'streaming' as const } }),
        window: { leaf_id: terminal ? 'terminal' : 'active', first_item_id: selected[0].id, last_item_id: selected.at(-1)!.id,
          has_before: selected[0].ordinal > 1, has_after: end < items.length },
        turns: [{ turn_id: 'turn', run_id: 'run', started_at: '2026-10-26T00:00:00Z', elapsed_ms: terminal ? 60000 : 0, waiting_ms: 0,
          work_duration_ms: terminal ? 60000 : 0, final_boundary_complete: terminal,
          final_item_ids: selected.filter(item => item.id === 'final').map(item => item.id),
          ...(terminal ? { outcome: 'completed' as const, ended_at: '2026-10-26T00:01:00Z' } : {}),
        }],
      };
      return { current, thread: applyFlowerRuntimeCurrentView({ ...seed, read_status: readStatus(false, terminal ? 3 : 2) }, current) };
    });
    const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadHistory: history,
      async *connectLiveStream({ signal }) {
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'active-reader', summaries: [seed] };
        await finish;
        if (signal.aborted) return;
        yield { schema_version: 3, kind: 'thread.batch', thread_id: seed.thread_id, reading_revision: history.mock.calls[0][1].reading_revision,
          update: { thread_id: seed.thread_id, base_version: 1, view_version: 2, turn_id: 'turn', run_id: 'run',
            facts: { activity: 'idle', queue_count: 0, last_outcome: 'completed' },
            items: [{ kind: 'add', item_id: 'final', item: items.at(-1)! }],
            turns: { value: [{ turn_id: 'turn', run_id: 'run', started_at: '2026-10-26T00:00:00Z', ended_at: '2026-10-26T00:01:00Z',
              outcome: 'completed', elapsed_ms: 60000, waiting_ms: 0, work_duration_ms: 60000, final_item_ids: ['final'], final_boundary_complete: true }] },
          },
        };
        await terminalSummary.promise;
        if (signal.aborted) return;
        yield { schema_version: 3, kind: 'summary.batch', summaries: [{ ...seed, status: 'success', active_run_id: undefined, run_progress: undefined, read_status: readStatus(false, 3) }] };
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      },
    }, { focusThreadRequest: { request_id: 'open-active', thread_id: seed.thread_id } });
    root.style.height = '780px';
    await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id=tool-79]')));
    expect(history).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.flower-tool-sequence-toggle')?.textContent).toBe('Consecutive tool calls');
    expect(root.querySelector('.flower-turn-summary-button')).toBeNull();
    terminal = true;
    items.push({ id: 'final', ordinal: 82, canonical_ordinal: 82, kind: 'assistant', text: 'All eighty tools are complete', turn_id: 'turn', run_id: 'run' });
    complete();
    await waitFor(() => root.textContent?.includes('All eighty tools are complete') === true);
    await waitFor(() => Boolean(root.querySelector('.flower-turn-summary-button')));
    root.querySelector<HTMLButtonElement>('.flower-turn-summary-button')!.click();
    await waitFor(() => root.querySelector('.flower-tool-sequence-toggle')?.textContent?.includes('Consecutive tool calls') === true);
    terminalSummary.resolve();
    await waitFor(() => history.mock.calls.filter(call => call[1].observer_id).length === 2);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(root.querySelector('.flower-tool-sequence-toggle')?.textContent).toBe('Consecutive tool calls');
    expect(root.textContent).toContain('All eighty tools are complete');
    expect(history.mock.calls.filter(call => call[1].observer_id)).toHaveLength(2);
    expect(history.mock.calls.filter(call => call[1].anchor_id).map(call => call[1].limit)).toEqual([]);
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  });

  it('recovers an initial transport failure by retrying the bounded read', async () => {
    const { root, history, full } = await mount(1);
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id=latest]')));
    expect(history.mock.calls.filter(call => call[1].observer_id)).toHaveLength(2);
    expect(history).toHaveBeenCalledTimes(2);
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
    expect(full).not.toHaveBeenCalled();
  });

  it('recovers summary refresh without flashing an error or replacing accepted content and draft', async () => {
    const { root, history, full, refresh } = await mount();
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id=latest]')));
    const row = root.querySelector('[data-flower-message-id=latest]')!;
    const editor = root.querySelector<HTMLTextAreaElement>('textarea')!;
    editor.value = 'Keep the unsent draft'; editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const viewport = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    const top = viewport.scrollTop;
    let flashes = 0;
    const observer = new MutationObserver(() => { if (root.querySelector('.flower-thread-sync-error, .flower-thread-loading')) flashes++; });
    observer.observe(root, { childList: true, subtree: true });
    try {
      refresh();
      await waitFor(() => history.mock.calls.filter(call => call[1].observer_id).length === 3);
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(flashes).toBe(0);
      expect(history).toHaveBeenCalledTimes(3);
      expect(root.querySelector('[data-flower-message-id=latest]')).toBe(row);
      expect(root.querySelector('textarea')).toBe(editor);
      expect(editor.value).toBe('Keep the unsent draft');
      expect(Math.abs(viewport.scrollTop - top)).toBeLessThanOrEqual(1);
      expect(full).not.toHaveBeenCalled();
      const revisions = history.mock.calls.filter(call => call[1].observer_id).map(call => call[1].reading_revision!);
      expect(new Set(revisions).size).toBe(3);
      expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    } finally { observer.disconnect(); }
  });

  it('bounds persistent source changes and allows an explicit retry after exhaustion', async () => {
    const { root, history, recover } = await mount(100);
    await waitFor(() => [...root.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Retry'), 5000);
    expect(history.mock.calls.filter(call => call[1].observer_id)).toHaveLength(4);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(history).toHaveBeenCalledTimes(4);
    recover();
    const retry = [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Retry');
    expect(retry).toBeDefined(); retry!.click();
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id=latest]')));
    expect(history.mock.calls.filter(call => call[1].observer_id)).toHaveLength(5);
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  });

  it('describes exhausted refresh as interrupted sync while retaining the loaded conversation', async () => {
    const { root, history, refresh } = await mount();
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id=latest]')));
    const row = root.querySelector('[data-flower-message-id=latest]');
    refresh(100);
    await waitFor(() => Boolean(root.querySelector('.flower-thread-sync-error')), 5000);
    expect(root.querySelector('.flower-thread-sync-error')?.textContent).toContain('Sync interrupted');
    expect(root.querySelector('.flower-thread-sync-error')?.textContent).not.toContain('Conversation could not load');
    expect(root.querySelector('[data-flower-message-id=latest]')).toBe(row);
    expect(history.mock.calls.filter(call => call[1].observer_id)).toHaveLength(5);
  });

  it('fences obsolete retry revisions while accepting fresh live updates', async () => {
    const { root, history, push } = await mount(1);
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id=latest]')));
    const revisions = history.mock.calls.filter(call => call[1].observer_id).map(call => call[1].reading_revision!);
    const update = (reading_revision: number, text: string): FlowerLiveStreamEnvelope => ({
      schema_version: 3, kind: 'thread.batch', thread_id: 'sync-history', reading_revision,
      update: { thread_id: 'sync-history', base_version: 8, view_version: 9, turn_id: 'turn', run_id: 'run',
        facts: { activity: 'idle', queue_count: 0, last_outcome: 'completed' },
        items: [{ kind: 'replace', item_id: 'latest', item: { id: 'latest', ordinal: 3, kind: 'assistant', text, turn_id: 'turn', run_id: 'run' } }],
      },
    });
    push(update(revisions[0], 'Obsolete retry output'));
    push(update(revisions[1], 'Fresh live output'));
    await waitFor(() => root.textContent?.includes('Fresh live output') === true);
    expect(root.textContent).not.toContain('Obsolete retry output');
    expect(history).toHaveBeenCalledTimes(2);
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  });

  it('cancels a pending backoff on disposal without another history request', async () => {
    const { root, history } = await mount(100);
    await waitFor(() => history.mock.calls.length === 2);
    disposeRenderedSurface(root);
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(history).toHaveBeenCalledTimes(2);
    expect(history.mock.calls[0][2].aborted).toBe(true);
  });
});
