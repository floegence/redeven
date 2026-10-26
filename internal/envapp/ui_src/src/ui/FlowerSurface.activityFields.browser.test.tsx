import '../index.css';
import './flower-feature.css';
import { page } from 'vitest/browser';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowerLiveStreamEnvelope, FlowerRuntimeCurrentView, FlowerSurfaceAdapter } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, disposeRenderedSurface, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';
let warningSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warningSpy = vi.spyOn(console, 'warn');
});
afterEach(() => {
  const warnings = warningSpy.mock.calls.filter((args: unknown[]) => String(args[0]).includes('computations created outside'));
  warningSpy.mockRestore();
  expect(warnings).toEqual([]);
});

describe('field-backed activity in the product surface', () => {
  it.each([['update', 1, 'Edit panda-bicycle.html'], ['delete', 1, 'Delete panda-bicycle.html'], ['noop', 1, 'Edit panda-bicycle.html'], ['update', 2, 'Edit 2 files']] as const)('shows %s patch titles for %d files without collapsed detail requests', async (changeType, count, label) => {
    await page.viewport(1280, 900);
    const seed = thread({ thread_id: 'patch-fields', title: 'Patch summary', messages: [] });
    const patchItem = (version: string) => ({ id: 'tool:turn:patch', turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'tool' as const,
      activity: { item_id: 'patch', tool_id: 'patch', tool_name: 'apply_patch', kind: 'tool', status: 'success', severity: 'normal' },
      activity_summary: { version, label: 'apply_patch', renderer: 'patch' as const,
        values: count === 1 ? { '/payload/mutations/0/display_name': 'panda-bicycle.html', '/payload/mutations/0/change_type': changeType } : {},
        fields: [{ path: '/payload/mutations', kind: 'array' as const, count },
          { path: '/payload/files_changed', kind: 'scalar' as const, value: count },
          { path: '/payload/additions', kind: 'scalar' as const, value: 13 }, { path: '/payload/deletions', kind: 'scalar' as const, value: 11 }] },
    });
    const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, activity: 'idle', view_version: 1, items: [patchItem('v1')] };
    const events: FlowerLiveStreamEnvelope[] = [];
    let wake: (() => void) | undefined;
    const forbidden = vi.fn(async () => { throw new Error('Collapsed patch must not load details.'); });
    const loadActivityValue = vi.fn<NonNullable<FlowerSurfaceAdapter['loadActivityValue']>>(async (_thread, request) => ({
      thread_id: seed.thread_id, item_id: request.item_id, turn_id: 'turn', run_id: 'run', path: request.path,
      value: request.path === '/payload' ? { files_changed: count, additions: 13, deletions: 11 }
        : { display_name: 'panda-bicycle.html', change_type: changeType, additions: 111, deletions: 109, unified_diff: '--- a/panda-bicycle.html\n+++ b/panda-bicycle.html\n@@ -1 +1 @@\n-before\n+after' },
    }));
    const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadActivityValue,
      loadActivityField: forbidden, loadActivityStructure: forbidden, loadHistoryItem: forbidden, loadHistoryBody: forbidden,
      loadHistory: async () => ({ current, thread: applyFlowerRuntimeCurrentView(seed, current) }),
      async *connectLiveStream({ signal }) {
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'patch-observer', summaries: [seed] };
        const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
        try { while (!signal.aborted) { const value = events.shift(); if (value) yield value; else await new Promise<void>(resolve => { wake = resolve; }); } }
        finally { signal.removeEventListener('abort', abort); }
      },
    }, { focusThreadRequest: { request_id: 'open-patch', thread_id: seed.thread_id } });
    root.style.height = '780px';
    const row = () => root.querySelector('[data-flower-activity-item-id="patch"]');
    await waitFor(() => row()?.textContent?.replaceAll(/\s/gu, '').includes(label.replaceAll(/\s/gu, '')) === true);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(loadActivityValue).not.toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
    events.push({ schema_version: 3, kind: 'thread.batch', thread_id: seed.thread_id,
      update: { thread_id: seed.thread_id, base_version: 1, view_version: 2, facts: { activity: 'idle', queue_count: 0 },
        items: [{ kind: 'replace', item_id: 'tool:turn:patch', item: patchItem('v2') }] } }); wake?.();
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(loadActivityValue).not.toHaveBeenCalled();
    const toggle = row()!.querySelector<HTMLButtonElement>('[data-flower-disclosure-trigger]')!;
    toggle.click();
    await waitFor(() => loadActivityValue.mock.calls.some(([, request]) => request.path.startsWith('/payload/mutations/')));
    await waitFor(() => row()?.textContent?.includes('after') === true);
    expect(row()?.querySelector('.flower-activity-inline-line')?.textContent?.replaceAll(/\s/gu, '')).toContain(label.replaceAll(/\s/gu, ''));
    expect(row()?.querySelector('.flower-activity-inline-change-stats')?.textContent?.replaceAll(/\s/gu, '')).toContain('+13/−11');
    toggle.click();
    await new Promise(resolve => setTimeout(resolve, 150));
    const calls = loadActivityValue.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(loadActivityValue).toHaveBeenCalledTimes(calls);
    toggle.click();
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(row()?.querySelector('.flower-activity-inline-line')?.textContent?.replaceAll(/\s/gu, '')).toContain(label.replaceAll(/\s/gu, ''));
    expect(forbidden).not.toHaveBeenCalled();
    disposeRenderedSurface(root);
  });

  it('observes activity visibility only after DOM adoption and releases it on disposal', async () => {
    const NativeObserver = globalThis.IntersectionObserver;
    const early: string[] = [];
    const observed = new Set<Element>();
    class TrackedObserver extends NativeObserver {
      private nodes = new Set<Element>();
      observe(node: Element) { if (!node.isConnected) early.push(node.className); this.nodes.add(node); observed.add(node); super.observe(node); }
      unobserve(node: Element) { this.nodes.delete(node); observed.delete(node); super.unobserve(node); }
      disconnect() { for (const node of this.nodes) observed.delete(node); this.nodes.clear(); super.disconnect(); }
    }
    vi.stubGlobal('IntersectionObserver', TrackedObserver);
    try {
      const seed = thread({ thread_id: 'observer-thread', messages: [] });
      const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, activity: 'idle', view_version: 1, items: [{
        id: 'tool:turn:inspect', kind: 'tool', turn_id: 'turn', run_id: 'run', ordinal: 1,
        activity: { item_id: 'inspect', tool_id: 'inspect', tool_name: 'inspect', kind: 'tool', status: 'success' },
        activity_summary: { version: 'v1', label: 'Inspect', renderer: 'structured', fields: [] },
      }] };
      const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed],
        loadHistory: async () => ({ current, thread: applyFlowerRuntimeCurrentView(seed, current) }),
      }, { focusThreadRequest: { request_id: 'open-observer', thread_id: seed.thread_id } });
      await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id="inspect"]')));
      disposeRenderedSurface(root);
      expect(root.querySelector('.flower-composer')).toBeNull();
      expect([...observed]).toEqual([]);
      expect(early).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });

  it('shows the correct collapsed Goal disposition and reads text only when expanded', async () => {
    await page.viewport(1280, 900);
    const seed = thread({ thread_id: 'goal-fields', title: 'Goal review', messages: [] });
    const goal = { operation: 'review', applied: false, version: 3, outcome: 'continue' };
    const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, activity: 'idle', view_version: 1, items: [{
      id: 'tool:turn:goal', turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'tool',
      activity: { item_id: 'goal', tool_id: 'goal', tool_name: 'goal', kind: 'tool', status: 'success', severity: 'normal' },
      activity_summary: { version: 'v1', label: 'Goal', renderer: 'structured', values: { '/payload/goal': goal },
        fields: [{ path: '/payload/goal', kind: 'object', count: 6 }] },
    }] };
    const values = { text: 'Complete the bounded reading implementation.', evidence: 'The final qualification remains open.' };
    const loadActivityValue = vi.fn<NonNullable<FlowerSurfaceAdapter['loadActivityValue']>>(async (_thread, input) => ({
      thread_id: seed.thread_id, item_id: input.item_id, turn_id: 'turn', run_id: 'run', path: input.path, value: goal,
      text_fields: Object.entries(values).map(([key, value]) => ({ path: '/payload/goal/' + key, kind: 'string',
        source_id: key, run_id: 'run', bytes: new TextEncoder().encode(value).length })),
    }));
    const loadActivityField = vi.fn<NonNullable<FlowerSurfaceAdapter['loadActivityField']>>(async (_thread, input) => {
      const raw = new TextEncoder().encode(values[input.source_id as keyof typeof values]);
      return { thread_id: seed.thread_id, path: input.path, source_id: input.source_id, run_id: 'run', bytes: raw.length,
        offset_bytes: input.offset_bytes, text: new TextDecoder().decode(raw.slice(input.offset_bytes, input.offset_bytes + input.limit_bytes!)) };
    });
    const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadActivityValue, loadActivityField,
      loadHistory: async () => ({ current, thread: applyFlowerRuntimeCurrentView(seed, current) }),
    }, { focusThreadRequest: { request_id: 'open-goal', thread_id: seed.thread_id } });
    root.style.height = '780px';
    await waitFor(() => root.querySelector('[data-flower-activity-item-id="goal"]')?.textContent?.includes('Goal not yet complete') === true);
    expect(loadActivityValue).not.toHaveBeenCalled();
    expect(loadActivityField).not.toHaveBeenCalled();
    const toggle = root.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="goal"] [data-flower-disclosure-trigger]')!;
    expect(toggle).not.toBeNull();
    toggle.click();
    await waitFor(() => root.querySelector('.flower-goal-review-body')?.textContent?.includes(values.evidence) === true);
    expect(root.querySelector('.flower-goal-review-body')?.textContent).toContain(values.text);
    expect(loadActivityValue).toHaveBeenCalledTimes(1);
    expect(loadActivityField.mock.calls.every(([, request]) => request.path.startsWith('/payload/goal/'))).toBe(true);
    toggle.click();
    const count = loadActivityField.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(loadActivityField).toHaveBeenCalledTimes(count);
  });

  it('reads only disclosed rows and updates equal-shape content without resetting disclosure', async () => {
    await page.viewport(1280, 900);
    const seed = thread({ thread_id: 'field-thread', title: 'Field-backed reading', messages: [] });
    const activity = { item_id: 'call', tool_id: 'call', tool_name: 'inspect', kind: 'tool', status: 'success', severity: 'normal' };
    const item = (version: string) => ({ id: 'tool:turn:call', turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'tool' as const, activity,
      activity_summary: { version, label: 'Inspect results', renderer: 'structured' as const, fields: [{ path: '/payload/rows', kind: 'array' as const, count: 180 }] } });
    const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, activity: 'idle', view_version: 1, items: [item('v1')] };
    const events: FlowerLiveStreamEnvelope[] = [];
    let wake: (() => void) | undefined;
    let content = 'Before';
    const sources = new Map<string, string>();
    const loadActivityValue = vi.fn<NonNullable<FlowerSurfaceAdapter['loadActivityValue']>>(async (_thread, request) => {
      const row = { title: 'Visible row', content: content + '\n' + 'const visible = true;\n'.repeat(200) };
      return { thread_id: seed.thread_id, item_id: request.item_id, turn_id: 'turn', run_id: 'run', path: request.path,
        value: { format: 'code', language: 'ts' }, text_fields: Object.entries(row).map(([key, text]) => {
          const id = content + ':' + request.path + '/' + key; sources.set(id, text);
          return { path: request.path + '/' + key, kind: 'string' as const, bytes: new TextEncoder().encode(text).length, source_id: id, run_id: 'run' };
        }) };
    });
    const loadActivityField = vi.fn<NonNullable<FlowerSurfaceAdapter['loadActivityField']>>(async (_thread, request) => {
      const bytes = new TextEncoder().encode(sources.get(request.source_id!)!);
      return { thread_id: seed.thread_id, path: request.path, source_id: request.source_id, run_id: 'run', bytes: bytes.length,
        offset_bytes: request.offset_bytes, text: new TextDecoder().decode(bytes.slice(request.offset_bytes, request.offset_bytes + request.limit_bytes!)) };
    });
    const full = vi.fn(async () => { throw new Error('Complete activity reads are forbidden.'); });
    const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadHistoryItem: full, loadActivityValue, loadActivityField,
      loadHistory: async () => ({ current, thread: applyFlowerRuntimeCurrentView(seed, current) }),
      async *connectLiveStream({ signal }) {
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'fields-observer', summaries: [seed] };
        const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
        try { while (!signal.aborted) { const value = events.shift(); if (value) yield value; else await new Promise<void>(resolve => { wake = resolve; }); } }
        finally { signal.removeEventListener('abort', abort); }
      },
    }, { focusThreadRequest: { request_id: 'open-fields', thread_id: seed.thread_id } });
    root.style.height = '780px';
    await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id="call"] button')));
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(loadActivityValue).not.toHaveBeenCalled();
    const toggle = root.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="call"] [data-flower-disclosure-trigger]')!;
    toggle.click();
    await waitFor(() => Boolean(root.querySelector('.flower-activity-field-rows pre code')));
    expect(root.querySelector('.flower-activity-field-rows pre code')?.textContent).toContain('Before');
    expect(loadActivityValue.mock.calls.every(call => call[1].path.startsWith('/payload/rows/'))).toBe(true);
    expect(loadActivityValue.mock.calls.length).toBeLessThan(5);
    content = 'Change';
    events.push({ schema_version: 3, kind: 'thread.batch', thread_id: seed.thread_id,
      update: { thread_id: seed.thread_id, base_version: 1, view_version: 2, facts: { activity: 'idle', queue_count: 0 },
        items: [{ kind: 'replace', item_id: 'tool:turn:call', item: item('v2') }] } }); wake?.();
    await waitFor(() => root.querySelector('.flower-activity-field-rows pre code')?.textContent?.includes('Change') === true);
    expect(toggle.isConnected).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await new Promise(resolve => setTimeout(resolve, 100));
    const beforeCollapse = loadActivityValue.mock.calls.length;
    toggle.click();
    content = 'Hidden';
    events.push({ schema_version: 3, kind: 'thread.batch', thread_id: seed.thread_id,
      update: { thread_id: seed.thread_id, base_version: 2, view_version: 3, facts: { activity: 'idle', queue_count: 0 },
        items: [{ kind: 'replace', item_id: 'tool:turn:call', item: item('v3') }] } }); wake?.();
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(loadActivityValue.mock.calls.length).toBe(beforeCollapse);
    const calls = loadActivityValue.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(loadActivityValue.mock.calls.length).toBe(calls);
    expect(full).not.toHaveBeenCalled();
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  });
  it('keeps terminal details responsive while same-size output changes faster than requests', async () => {
    await page.viewport(1280, 900);
    const seed = thread({ thread_id: 'terminal-fields', title: 'Streaming fields', messages: [] });
    const fields = [{ path: '/payload/command', kind: 'string' as const, bytes: 11 },
      { path: '/payload/output', kind: 'string' as const, bytes: 6 }];
    const item = (version: string) => ({ id: 'tool:turn:call', turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'tool' as const,
      activity: { item_id: 'call', tool_id: 'call', tool_name: 'terminal.exec', kind: 'tool', status: 'running', severity: 'normal' },
      activity_summary: { version, label: 'Inspect output', renderer: 'terminal' as const, fields } });
    const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, turn_id: 'turn', run_id: 'run', activity: 'active', run_progress: { phase: 'tool_execution' }, view_version: 1, items: [item('v1')] };
    const events: FlowerLiveStreamEnvelope[] = [];
    let wake: (() => void) | undefined;
    let version = 1;
    const loadActivityValue = vi.fn<NonNullable<FlowerSurfaceAdapter['loadActivityValue']>>(async (_thread, request, signal) => {
      const value = { command: 'printf done', output: 'tick-' + version };
      await new Promise(resolve => setTimeout(resolve, 60));
      signal?.throwIfAborted();
      return { thread_id: seed.thread_id, item_id: request.item_id, turn_id: 'turn', run_id: 'run', path: request.path, value };
    });
    const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadActivityValue,
      loadHistory: async () => ({ current, thread: applyFlowerRuntimeCurrentView(seed, current) }),
      async *connectLiveStream({ signal }) {
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'terminal-observer', summaries: [seed] };
        const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
        try { while (!signal.aborted) { const value = events.shift(); if (value) yield value; else await new Promise<void>(resolve => { wake = resolve; }); } }
        finally { signal.removeEventListener('abort', abort); }
      },
    }, { focusThreadRequest: { request_id: 'terminal-fields', thread_id: seed.thread_id } });
    root.style.height = '780px';
    await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id="call"] [data-flower-disclosure-trigger]')));
    expect(loadActivityValue).not.toHaveBeenCalled();
    const toggle = root.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="call"] [data-flower-disclosure-trigger]')!;
    toggle.click();
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
      const before = version++;
      events.push({ schema_version: 3, kind: 'thread.batch', thread_id: seed.thread_id,
        update: { thread_id: seed.thread_id, turn_id: 'turn', run_id: 'run', base_version: before, view_version: version,
          facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'tool_execution' } },
          items: [{ kind: 'replace', item_id: 'tool:turn:call', item: item('v' + version) }] } }); wake?.();
    }, 8);
    try {
      await waitFor(() => Boolean(root.querySelector('.flower-activity-terminal-output')?.textContent?.includes('tick-')));
      await new Promise(resolve => setTimeout(resolve, 850));
    } finally { clearInterval(timer); }
    await waitFor(() => root.querySelector('.flower-activity-terminal-output')?.textContent?.includes('tick-' + version) === true);
    expect(ticks).toBeGreaterThan(100);
    expect(loadActivityValue.mock.calls.length).toBeLessThan(ticks / 2);
    expect(toggle.isConnected).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const activityRow = toggle.closest<HTMLElement>('.flower-activity-inline-row')!;
    activityRow.style.marginTop = '10000px';
    await new Promise(resolve => setTimeout(resolve, 180));
    const transcript = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    transcript.scrollTop = 0;
    transcript.dispatchEvent(new Event('scroll'));
    await waitFor(() => activityRow.getBoundingClientRect().top > transcript.getBoundingClientRect().bottom);
    await new Promise(resolve => setTimeout(resolve, 180));
    const callsWhileHidden = loadActivityValue.mock.calls.length;
    const beforeHidden = version++;
    events.push({ schema_version: 3, kind: 'thread.batch', thread_id: seed.thread_id,
      update: { thread_id: seed.thread_id, turn_id: 'turn', run_id: 'run', base_version: beforeHidden, view_version: version,
        facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'tool_execution' } },
        items: [{ kind: 'replace', item_id: 'tool:turn:call', item: item('v' + version) }] } }); wake?.();
    await new Promise(resolve => setTimeout(resolve, 180));
    expect(loadActivityValue.mock.calls.length).toBe(callsWhileHidden);
    activityRow.style.marginTop = '';
    await waitFor(() => root.querySelector('.flower-activity-terminal-output')?.textContent?.includes('tick-' + version) === true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  });

  it('waits for a small terminal body before applying its sequence or polling', async () => {
    await page.viewport(1280, 900);
    const seed = thread({ thread_id: 'pending-terminal', title: 'Pending terminal body', messages: [] });
    const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, activity: 'idle', view_version: 1, items: [{
      id: 'tool:turn:small', turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'tool',
      activity: { item_id: 'small', tool_id: 'small', tool_name: 'terminal.exec', kind: 'tool', status: 'success', severity: 'normal' },
      activity_summary: { version: 'v1', label: 'Read small output', renderer: 'terminal', fields: [
        { path: '/payload/output', kind: 'string', bytes: 6 },
        { path: '/payload/command', kind: 'string', bytes: 7 },
        { path: '/payload/process_id', kind: 'string', bytes: 7 },
        { path: '/payload/operation', kind: 'string', bytes: 4 },
        { path: '/payload/first_seq', kind: 'scalar', value: 1 },
        { path: '/payload/last_seq', kind: 'scalar', value: 1 },
        { path: '/payload/latest_seq', kind: 'scalar', value: 2 },
      ] },
    }] };
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const loadActivityValue = vi.fn<NonNullable<FlowerSurfaceAdapter['loadActivityValue']>>(async (_thread, request) => {
      await pending;
      return { thread_id: seed.thread_id, item_id: request.item_id, turn_id: 'turn', run_id: 'run', path: request.path,
        value: { output: 'first\n', command: 'inspect', process_id: 'process', operation: 'exec', first_seq: 1, last_seq: 1, latest_seq: 2 } };
    });
    const readTerminalProcess = vi.fn<NonNullable<FlowerSurfaceAdapter['readTerminalProcess']>>(async () => ({
      process_id: 'process', status: 'success', output: 'second\n', first_seq: 2, last_seq: 2, latest_seq: 2, has_more: false,
    }));
    const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadActivityValue, readTerminalProcess,
      loadHistory: async () => ({ current, thread: applyFlowerRuntimeCurrentView(seed, current) }),
    }, { focusThreadRequest: { request_id: 'open-pending-terminal', thread_id: seed.thread_id } });
    root.style.height = '780px';
    await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id="small"] [data-flower-disclosure-trigger]')));
    root.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="small"] [data-flower-disclosure-trigger]')!.click();
    await waitFor(() => loadActivityValue.mock.calls.length === 1);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(readTerminalProcess).not.toHaveBeenCalled();
    release();
    await waitFor(() => root.querySelector('.flower-activity-terminal-output')?.textContent === 'first\nsecond\n');
    expect(readTerminalProcess.mock.calls.map(([request]) => request.after_seq)).toEqual([1]);
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  });

  it('opens a long terminal output through bounded visible ranges and stops at collapse', async () => {
    await page.viewport(1280, 900);
    const seed = thread({ thread_id: 'long-terminal-fields', title: 'Long output', messages: [] });
    const bytes = new TextEncoder().encode('retained output line\n'.repeat(300) + ' '.repeat(10 << 20));
    const field = { path: '/payload/output', kind: 'string' as const, bytes: bytes.length, source_id: 'output-v1', run_id: 'run' };
    const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, activity: 'idle', view_version: 1, items: [{
      id: 'tool:turn:long', turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'tool',
      activity: { item_id: 'long', tool_id: 'long', tool_name: 'terminal.exec', kind: 'tool', status: 'success', severity: 'normal' },
      activity_summary: { version: 'v1', label: 'Read long output', renderer: 'terminal', fields: [{ path: field.path, kind: field.kind, bytes: field.bytes },
        { path: '/payload/command', kind: 'string', bytes: 7 }, { path: '/payload/exit_code', kind: 'scalar', value: 0 },
        { path: '/payload/first_seq', kind: 'scalar', value: 1 }, { path: '/payload/last_seq', kind: 'scalar', value: 300 }] },
    }] };
    const loadActivityValue = vi.fn<NonNullable<FlowerSurfaceAdapter['loadActivityValue']>>(async (_thread, request) => ({
      thread_id: seed.thread_id, item_id: request.item_id, turn_id: 'turn', run_id: 'run', path: request.path,
      value: { command: 'inspect', exit_code: 0, first_seq: 1, last_seq: 300 }, text_fields: request.text_fields?.includes('output') ? [field] : [],
    }));
    let delivered = 0;
    const loadActivityField = vi.fn<NonNullable<FlowerSurfaceAdapter['loadActivityField']>>(async (_thread, request, signal) => {
      signal?.throwIfAborted();
      const part = bytes.slice(request.offset_bytes, request.offset_bytes + request.limit_bytes!);
      delivered += part.length;
      return { thread_id: seed.thread_id, path: request.path, source_id: 'output-v1', run_id: 'run', bytes: bytes.length,
        offset_bytes: request.offset_bytes, text: new TextDecoder().decode(part) };
    });
    const full = vi.fn(async () => { throw new Error('Complete activity reads are forbidden.'); });
    const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadHistoryItem: full, loadActivityValue, loadActivityField,
      loadHistory: async () => ({ current, thread: applyFlowerRuntimeCurrentView(seed, current) }),
      async *connectLiveStream({ signal }) {
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'long-output-observer', summaries: [seed] };
        await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
      },
    }, { focusThreadRequest: { request_id: 'open-long-output', thread_id: seed.thread_id } });
    root.style.height = '780px';
    await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id="long"] [data-flower-disclosure-trigger]')));
    expect(loadActivityValue).not.toHaveBeenCalled();
    expect(loadActivityField).not.toHaveBeenCalled();
    const toggle = root.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="long"] [data-flower-disclosure-trigger]')!;
    toggle.click();
    await waitFor(() => Boolean(root.querySelector('.flower-activity-field-viewport')?.textContent?.includes('retained output')));
    expect(delivered).toBeLessThanOrEqual(32768);
    expect(root.querySelector('.flower-activity-terminal-command')?.textContent).toContain('inspect');
    expect(root.querySelectorAll('.flower-activity-terminal-action-button')).toHaveLength(2);
    expect(loadActivityValue.mock.calls[0][1].fields).not.toContain('output');
    expect(loadActivityValue.mock.calls[0][1].text_fields).toEqual(['output']);
    const output = root.querySelector<HTMLElement>('.flower-activity-field-viewport')!;
    output.scrollTop = output.scrollHeight; output.dispatchEvent(new Event('scroll'));
    await waitFor(() => loadActivityField.mock.calls.length >= 2);
    toggle.click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const stopped = loadActivityField.mock.calls.length;
    output.scrollTop = output.scrollHeight; output.dispatchEvent(new Event('scroll'));
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(loadActivityField.mock.calls.length).toBe(stopped);
    expect(full).not.toHaveBeenCalled();
  });

  it('reads live process output only at a disclosed field tail and cancels on collapse', async () => {
    await page.viewport(1280, 900);
    const seed = thread({ thread_id: 'live-deferred', title: 'Live deferred output', messages: [] });
    const bytes = new TextEncoder().encode('initial output\n' + ' '.repeat(70000));
    const field = { path: '/payload/output', kind: 'string' as const, bytes: bytes.length, source_id: 'process-output', run_id: 'run' };
    const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, activity: 'active', turn_id: 'turn', run_id: 'run',
      run_progress: { phase: 'tool_execution' }, view_version: 1, items: [{ id: 'tool:turn:live', turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'tool',
        activity: { item_id: 'live', tool_id: 'live', tool_name: 'terminal.exec', kind: 'tool', status: 'running', severity: 'normal' },
        activity_summary: { version: 'v1', label: 'Read live output', renderer: 'terminal', fields: [
          { path: field.path, kind: field.kind, bytes: field.bytes }, { path: '/payload/command', kind: 'string', bytes: 7 },
          { path: '/payload/process_id', kind: 'string', bytes: 7 }, { path: '/payload/operation', kind: 'string', bytes: 4 }, { path: '/payload/first_seq', kind: 'scalar', value: 1 },
          { path: '/payload/last_seq', kind: 'scalar', value: 3 }] } }] };
    const loadActivityValue: NonNullable<FlowerSurfaceAdapter['loadActivityValue']> = async (_thread, request) => ({
      thread_id: seed.thread_id, item_id: request.item_id, turn_id: 'turn', run_id: 'run', path: request.path,
      value: { command: 'inspect', process_id: 'process', operation: 'exec', first_seq: 1, last_seq: 3 }, text_fields: [field] });
    const loadActivityField = vi.fn<NonNullable<FlowerSurfaceAdapter['loadActivityField']>>(async (_thread, request) => ({
      thread_id: seed.thread_id, path: request.path, source_id: field.source_id, run_id: 'run', bytes: bytes.length,
      offset_bytes: request.offset_bytes, text: new TextDecoder().decode(bytes.slice(request.offset_bytes, request.offset_bytes + request.limit_bytes!)) }));
    let pendingSignal: AbortSignal | undefined;
    const readTerminalProcess = vi.fn<NonNullable<FlowerSurfaceAdapter['readTerminalProcess']>>(async (request, signal) => {
      if (request.after_seq === 3) return { process_id: 'process', status: 'running', output: 'fresh output\n', first_seq: 4, last_seq: 4, latest_seq: 4, has_more: false };
      pendingSignal = signal;
      await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
      throw new Error('A cancelled process read cannot complete.');
    });
    const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadActivityValue, loadActivityField, readTerminalProcess,
      loadHistory: async () => ({ current, thread: applyFlowerRuntimeCurrentView(seed, current) }),
      async *connectLiveStream({ signal }) {
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'live-field-observer', summaries: [seed] };
        await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
      },
    }, { focusThreadRequest: { request_id: 'live-fields', thread_id: seed.thread_id } });
    root.style.height = '780px';
    await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id="live"] [data-flower-disclosure-trigger]')));
    const toggle = root.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="live"] [data-flower-disclosure-trigger]')!;
    expect(readTerminalProcess).not.toHaveBeenCalled();
    toggle.click();
    await waitFor(() => Boolean(root.querySelector('.flower-activity-field-viewport')?.textContent?.includes('initial output')));
    expect(readTerminalProcess).not.toHaveBeenCalled();
    const viewport = root.querySelector<HTMLElement>('.flower-activity-field-viewport')!;
    for (let step = 0; step < 20 && !viewport.textContent?.includes('fresh output'); step++) {
      viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll'));
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    await waitFor(() => viewport.textContent?.includes('fresh output') === true);
    expect(readTerminalProcess.mock.calls[0][0].after_seq).toBe(3);
    await waitFor(() => pendingSignal !== undefined);
    toggle.click();
    await waitFor(() => pendingSignal?.aborted === true);
    const stopped = readTerminalProcess.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(readTerminalProcess.mock.calls.length).toBe(stopped);
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  });

  it.each(['completion', 'overlapping handoff'])('retires process deltas exactly once during %s', async (mode) => {
    await page.viewport(1280, 900);
    const seed = thread({ thread_id: 'live-deferred', title: 'Live deferred output', messages: [] });
    const initialBytes = new TextEncoder().encode('initial output\n' + ' '.repeat(70000));
    const finalBytes = new TextEncoder().encode(new TextDecoder().decode(initialBytes) + 'fresh output\n');
    let bytes = initialBytes;
    let completed = false;
    const events: FlowerLiveStreamEnvelope[] = [];
    let wake: (() => void) | undefined;
    const field = { path: '/payload/output', kind: 'string' as const, bytes: bytes.length, source_id: 'process-output', run_id: 'run' };
    const current: FlowerRuntimeCurrentView = { thread_id: seed.thread_id, activity: 'active', turn_id: 'turn', run_id: 'run',
      run_progress: { phase: 'tool_execution' }, view_version: 1, items: [{ id: 'tool:turn:live', turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'tool',
        activity: { item_id: 'live', tool_id: 'live', tool_name: 'terminal.exec', kind: 'tool', status: 'running', severity: 'normal' },
        activity_summary: { version: 'v1', label: 'Read live output', renderer: 'terminal', fields: [
          { path: field.path, kind: field.kind, bytes: field.bytes }, { path: '/payload/command', kind: 'string', bytes: 7 },
          { path: '/payload/process_id', kind: 'string', bytes: 7 }, { path: '/payload/operation', kind: 'string', bytes: 4 }, { path: '/payload/first_seq', kind: 'scalar', value: 1 },
          { path: '/payload/last_seq', kind: 'scalar', value: 3 }] } }] };
    const loadActivityValue: NonNullable<FlowerSurfaceAdapter['loadActivityValue']> = async (_thread, request) => ({
      thread_id: seed.thread_id, item_id: request.item_id, turn_id: 'turn', run_id: 'run', path: request.path,
      value: { command: 'inspect', process_id: 'process', operation: 'exec', first_seq: 1, last_seq: completed ? 4 : 3 }, text_fields: [{ ...field, source_id: completed ? 'final-output' : field.source_id, bytes: bytes.length }] });
    const loadActivityField = vi.fn<NonNullable<FlowerSurfaceAdapter['loadActivityField']>>(async (_thread, request) => ({
      thread_id: seed.thread_id, path: request.path, source_id: request.source_id, run_id: 'run', bytes: bytes.length,
      offset_bytes: request.offset_bytes, text: new TextDecoder().decode(bytes.slice(request.offset_bytes, request.offset_bytes + request.limit_bytes!)) }));
    let pendingSignal: AbortSignal | undefined;
    const pendingHandoffs: Array<() => void> = [];
    const readTerminalProcess = vi.fn<NonNullable<FlowerSurfaceAdapter['readTerminalProcess']>>(async (request, signal) => {
      if (request.after_seq === 3) return { process_id: 'process', status: 'running', output: mode === 'completion' ? 'fresh output\n' : 'fresh output\nlater output\n', first_seq: 4, last_seq: mode === 'completion' ? 4 : 5, latest_seq: mode === 'completion' ? 4 : 5, has_more: false };
      if (mode === 'overlapping handoff' && request.after_seq === 4) {
        // The transport may settle after cancellation. The owner must reject it.
        await new Promise<void>(resolve => pendingHandoffs.push(resolve));
        return { process_id: 'process', status: 'running', output: 'later output\n', first_seq: 5, last_seq: 5, latest_seq: 5, has_more: false };
      }
      pendingSignal = signal;
      await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
      throw new Error('A cancelled process read cannot complete.');
    });
    const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [seed], loadActivityValue, loadActivityField, readTerminalProcess,
      loadHistory: async () => ({ current, thread: applyFlowerRuntimeCurrentView(seed, current) }),
      async *connectLiveStream({ signal }) {
        yield { schema_version: 3, kind: 'ready', baseline_complete: true, observer_id: 'live-field-observer', summaries: [seed] };
        const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
        try { while (!signal.aborted) { const value = events.shift(); if (value) yield value; else await new Promise<void>(resolve => { wake = resolve; }); } }
        finally { signal.removeEventListener('abort', abort); }
      },
    }, { focusThreadRequest: { request_id: 'live-fields', thread_id: seed.thread_id } });
    root.style.height = '780px';
    await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id="live"] [data-flower-disclosure-trigger]')));
    const toggle = root.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="live"] [data-flower-disclosure-trigger]')!;
    expect(readTerminalProcess).not.toHaveBeenCalled();
    toggle.click();
    await waitFor(() => Boolean(root.querySelector('.flower-activity-field-viewport')?.textContent?.includes('initial output')));
    expect(readTerminalProcess).not.toHaveBeenCalled();
    const viewport = root.querySelector<HTMLElement>('.flower-activity-field-viewport')!;
    for (let step = 0; step < 20 && !viewport.textContent?.includes('fresh output'); step++) {
      viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll'));
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    await waitFor(() => viewport.textContent?.includes('fresh output') === true);
    expect(readTerminalProcess.mock.calls[0][0].after_seq).toBe(3);
    await waitFor(() => pendingSignal !== undefined);
    completed = true; bytes = finalBytes;
    const finished = { ...current.items![0], activity: { ...current.items![0].activity!, status: mode === 'completion' ? 'success' : 'running' },
      activity_summary: { ...current.items![0].activity_summary!, version: 'v2', fields: [
        ...current.items![0].activity_summary!.fields.filter(field => field.path !== '/payload/output' && field.path !== '/payload/last_seq'),
        { path: '/payload/output', kind: 'string' as const, bytes: finalBytes.length },
        { path: '/payload/last_seq', kind: 'scalar' as const, value: 4 },
      ] } };
    events.push({ schema_version: 3, kind: 'thread.batch', thread_id: seed.thread_id,
      update: { thread_id: seed.thread_id, base_version: 1, view_version: 2, facts: { activity: 'idle', queue_count: 0 },
        items: [{ kind: 'replace', item_id: finished.id, item: finished }] } }); wake?.();
    if (mode === 'overlapping handoff') {
      await waitFor(() => pendingHandoffs.length === 1);
      const fieldRoot = viewport.parentElement!;
      fieldRoot.style.transform = 'translateY(10000px)';
      await new Promise(resolve => setTimeout(resolve, 100));
      fieldRoot.style.transform = '';
      await waitFor(() => pendingHandoffs.length === 2);
      const reads = readTerminalProcess.mock.calls.length;
      pendingHandoffs[0]();
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(readTerminalProcess.mock.calls.length).toBe(reads);
      pendingHandoffs[1]();
    }
    await waitFor(() => loadActivityField.mock.calls.some(([, request]) => request.source_id === 'final-output'));
    await new Promise(resolve => setTimeout(resolve, 400));
    for (let step = 0; step < 10; step++) {
      viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll'));
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    expect(viewport.textContent?.split('fresh output').length).toBe(2);
    if (mode === 'completion') expect(viewport.querySelector('[data-field-live-output]')).toBeNull();
    else expect(viewport.querySelector('[data-field-live-output]')?.textContent).toBe('later output\n');
    expect(toggle.isConnected).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('.flower-thread-sync-error')).toBeNull();
  });

});
