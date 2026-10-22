import '../index.css';
import './flower-feature.css';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowerLiveStreamEnvelope, FlowerParentEvent, FlowerRuntimeCurrentView, FlowerRuntimeTurn, FlowerSurfaceAdapter } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { canonicalProcessFixture } from '../../../../flower_ui/src/flowerCanonicalProcess.testFixture';
import { parentProcessEvents, parentProcessPage } from '../../../../flower_ui/src/flowerParentEventProcess.testFixture';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { createLocalizedFlowerSurfaceCopy, type FlowerSurfaceTranslator } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import type { FlowerSurfaceCopy } from '../../../../flower_ui/src/copy';
import { SUPPORTED_LOCALES } from './i18n/localeMeta';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import { adapter, liveBootstrap, renderSurfaceWithAdapter, renderSurfaceWithAdapterProps, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const media = commands as unknown as { emulateMediaPreferences: (input: { reducedMotion?: 'reduce' | 'no-preference'; forcedColors?: 'active' | 'none' }) => Promise<void> };
const turn = (changes: Partial<FlowerRuntimeTurn> = {}): FlowerRuntimeTurn => ({
  turn_id: 'turn', run_id: 'run', started_at: '2026-10-11T12:00:00Z', ended_at: '2026-10-11T12:02:38Z',
  outcome: 'completed', elapsed_ms: 158000, waiting_ms: 20000, work_duration_ms: 138000,
  intermediate_item_ids: ['progress'], final_item_ids: ['final-a', 'final-b'], final_boundary_complete: true, ...changes,
});
function current(terminal = false, changes: Partial<FlowerRuntimeCurrentView> = {}): FlowerRuntimeCurrentView {
  return {
    thread_id: 'process', view_version: terminal ? 2 : 1, turn_id: 'turn', run_id: 'run', activity: terminal ? 'idle' : 'active',
    ...(terminal ? { last_outcome: 'completed' as const } : { run_progress: { phase: 'streaming' as const } }),
    turns: [terminal ? turn() : turn({ ended_at: undefined, outcome: undefined, elapsed_ms: 0, waiting_ms: 0, work_duration_ms: 0, intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })],
    items: [
      { id: 'user', turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'user', text: 'User request' },
      { id: 'thinking', turn_id: 'turn', run_id: 'run', ordinal: 2, kind: 'thinking', text: 'Inspecting the evidence.', live: !terminal },
      { id: 'progress', turn_id: 'turn', run_id: 'run', ordinal: 3, kind: 'assistant', text: 'Intermediate progress report.' },
      { id: 'tool', turn_id: 'turn', run_id: 'run', ordinal: 4, kind: 'tool', activity: {
        item_id: 'tool', tool_id: 'tool', tool_name: 'terminal.exec', kind: 'tool', status: 'error', severity: 'error', needs_attention: false,
        requires_approval: false, presentation: { label: 'Inspect files', renderer: 'terminal', payload: { operation: 'exec', command: 'ls', output: 'Command failed' } },
      } },
      { id: 'final-a', turn_id: 'turn', run_id: 'run', ordinal: 5, kind: 'assistant', text: 'Final conclusion with a stable node.', live: !terminal },
      ...(terminal ? [{ id: 'final-b', turn_id: 'turn', run_id: 'run', ordinal: 6, kind: 'assistant' as const, text: 'Second final segment.' }] : []),
    ], ...changes,
  };
}
function continued(stopped: FlowerRuntimeCurrentView): FlowerRuntimeCurrentView {
  return { ...stopped, view_version: 3, activity: 'active', turn_id: 'next', run_id: 'next-run', last_outcome: undefined,
    run_progress: { phase: 'streaming' },
    turns: [...stopped.turns!, turn({ turn_id: 'next', run_id: 'next-run', ended_at: undefined, outcome: undefined, elapsed_ms: 0, waiting_ms: 0, work_duration_ms: 0, intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })],
    items: [...stopped.items!, { id: 'next-user', turn_id: 'next', run_id: 'next-run', ordinal: 7, kind: 'user', text: 'Continue or retry the task' }],
  };
}
function liveStream(initial: FlowerRuntimeCurrentView) {
  let latest = initial;
  const values: FlowerLiveStreamEnvelope[] = [];
  let wake: (() => void) | undefined;
  return {
    current: () => latest,
    envelope(value: FlowerLiveStreamEnvelope) { values.push(value); wake?.(); },
    push(value: FlowerRuntimeCurrentView) { latest = value; values.push({ schema_version: 2, kind: 'thread.batch', thread_id: 'process', current: value }); wake?.(); },
    async *connect({ signal }: { signal: AbortSignal }) {
      const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
      try { while (!signal.aborted) { const value = values.shift(); if (value) yield value; else await new Promise<void>((resolve) => { wake = resolve; }); } }
      finally { signal.removeEventListener('abort', abort); }
    },
  };
}
async function mount(initial = current(), copy?: FlowerSurfaceCopy, overrides: Partial<FlowerSurfaceAdapter> = {}) {
  await page.viewport(1280, 900);
  const seed = applyFlowerRuntimeCurrentView(thread({ thread_id: 'process', title: 'Process disclosure', messages: [] }), initial);
  const peer = thread({ thread_id: 'peer', title: 'Another conversation' });
  const live = liveStream(initial);
  live.envelope({ schema_version: 2, kind: 'ready', summaries: [seed, peer] });
  const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [applyFlowerRuntimeCurrentView(seed, live.current()), peer]),
    loadThread: vi.fn(async (id) => id === peer.thread_id ? liveBootstrap(peer) : { thread: applyFlowerRuntimeCurrentView(seed, live.current()), current: live.current() }), connectLiveStream: live.connect, ...overrides }, { copy });
  root.style.height = '780px';
  await waitFor(() => Boolean(root.querySelector('[data-thread-id="process"] button')));
  root.querySelector<HTMLButtonElement>('[data-thread-id="process"] button')!.click();
  await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="final-a"]')));
  await waitFor(() => root.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
  return { root, live };
}
// Reading protection requires a viewport that can actually leave the tail.
async function inspectTranscript(root: HTMLElement, target = root.querySelector<HTMLElement>('[data-flower-message-id="progress"]')!) {
  const viewport = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
  viewport.style.height = '80px';
  viewport.style.maxHeight = '80px';
  viewport.style.flex = 'none';
  await waitFor(() => viewport.scrollHeight > viewport.clientHeight + 20);
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  viewport.scrollTop = viewport.scrollHeight;
  viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true }));
  viewport.scrollTop += target.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  viewport.dispatchEvent(new Event('scroll'));
}
const message = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-flower-message-id="${id}"]`)!;
const summary = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.flower-turn-summary-button');
const messageRow = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-flower-row-message-id="${id}"]`)!;
const hidden = (root: HTMLElement, id: string) => messageRow(root, id)?.querySelector('.flower-turn-row-viewport')?.getAttribute('aria-hidden') === 'true';
afterEach(async () => { document.getSelection()?.removeAllRanges(); await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' }); });

describe('completed turn process disclosure', () => {
  it('mounts collapsed process content on demand and releases it after closing', async () => {
    const { root } = await mount(current(true));
    await waitFor(() => summary(root)?.getAttribute('aria-expanded') === 'false');
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(root.querySelector('[data-flower-message-id="progress"]')).toBeNull();
    expect(root.querySelector('[data-flower-activity-item-id="tool"]')).toBeNull();
    expect(message(root, 'final-a')).not.toBeNull();
    summary(root)!.click();
    await waitFor(() => Boolean(message(root, 'progress')));
    summary(root)!.click();
    await waitFor(() => !message(root, 'progress'));
    summary(root)!.click();
    await waitFor(() => Boolean(message(root, 'progress')));
    expect(message(root, 'final-a')).not.toBeNull();
  });

  it('keeps a compaction-only process recoverable and accepts context with its current version', async () => {
    const initial = current(false, { items: current(false).items!.filter(item => ['user', 'final-a'].includes(item.id)) });
    const { root, live } = await mount(initial);
    const terminal = current(true, {
      turns: [turn({ intermediate_item_ids: [] })],
      items: current(true).items!.filter(item => ['user', 'final-a', 'final-b'].includes(item.id)),
    });
    const decoration = {
      decoration_id: 'only-compaction', kind: 'context_compaction' as const, ordinal: 0,
      anchor: { target_kind: 'message' as const, message_id: 'user', edge: 'after' as const },
      compaction: { operation_id: 'only', turn_id: 'turn', canonical_ordinal: 2,
        phase: 'complete' as const, status: 'compacted' as const, updated_at_ms: 1 },
    };
    const send = (version: number, decorations = [decoration]) => live.envelope({
      schema_version: 2, kind: 'thread.batch', thread_id: 'process',
      current: { ...terminal, view_version: version }, timeline_decorations: decorations,
    });
    send(2);
    const row = () => root.querySelector<HTMLElement>('[data-flower-decoration-id="only-compaction"]');
    await waitFor(() => Boolean(summary(root)) && Boolean(root.querySelector('[data-flower-row-decoration-id="only-compaction"]')));
    expect(summary(root)!.getAttribute('aria-expanded')).toBe('false');
    summary(root)!.click();
    await waitFor(() => row()?.closest('.flower-turn-row-viewport')?.getAttribute('aria-hidden') !== 'true');
    expect(row()!.closest('.flower-turn-row-viewport')?.hasAttribute('inert')).toBe(false);
    send(1, []); send(1, []);
    // A later accepted frame with omitted context preserves the prior snapshot.
    live.envelope({ schema_version: 2, kind: 'thread.batch', thread_id: 'process', current: { ...terminal, view_version: 3,
      items: terminal.items!.map(item => item.id === 'final-a' ? { ...item, text: 'Version three accepted.' } : item),
    } });
    await waitFor(() => message(root, 'final-a')?.textContent?.includes('Version three accepted.') === true);
    expect(row()).not.toBeNull();
    // Same-version context is independently authoritative, including clearing.
    send(3, []);
    await waitFor(() => !row());
    expect(summary(root)).toBeNull();
    expect(message(root, 'final-a')).not.toBeNull();
  });

  it.each(['reduce', 'no-preference'] as const)('keeps three automatic compactions inside disclosure, resets tooltips and retains manual ownership with %s motion', async reducedMotion => {
    await media.emulateMediaPreferences({ reducedMotion });
    const { root, live } = await mount();
    const decoration = (id: string, turnID = 'turn', ordinal = 7) => ({
      decoration_id: id, kind: 'context_compaction' as const, ordinal: 0,
      anchor: { target_kind: 'message' as const, message_id: 'progress', edge: 'after' as const },
      compaction: { operation_id: id, turn_id: turnID, canonical_ordinal: ordinal, phase: 'complete' as const,
        status: 'compacted' as const, tokens_before: 150000, tokens_after_estimate: 20000, updated_at_ms: 1,
        decision: { pressure: {}, after: { payload_fingerprint: 'validated', provider: 'test', model: 'model', estimated_input_tokens: 37594, source: 'fixture', estimate_method: 'provider_rendered_payload_estimate', estimate_confidence: 'conservative', pressure: {} } } },
    });
    const decorations = [decoration('first', 'turn', 7), decoration('second', 'turn', 8), decoration('third', 'turn', 9), decoration('manual', 'manual', 10)];
    const terminal = current(true, { turns: [turn(), turn({ turn_id: 'manual', run_id: 'manual-run', kind: 'context_compaction', intermediate_item_ids: [], final_item_ids: [] })] });
    live.envelope({ schema_version: 2, kind: 'thread.batch', thread_id: 'process', current: terminal, timeline_decorations: decorations });
    const divider = (id: string) => root.querySelector<HTMLElement>('[data-flower-decoration-id="' + id + '"]')!;
    const collapsed = (id: string) => root.querySelector(`[data-flower-row-decoration-id="${id}"] .flower-turn-row-viewport`)?.getAttribute('aria-hidden') === 'true';
    await waitFor(() => Boolean(summary(root)) && collapsed('third'));
    expect(['first', 'second', 'third'].every(collapsed)).toBe(true);
    expect(collapsed('manual')).toBe(false);
    summary(root)!.click();
    await waitFor(() => !collapsed('third'));
    const trigger = divider('third').querySelector<HTMLElement>('[role="button"]')!;
    trigger.focus();
    const tooltip = () => document.getElementById(trigger.getAttribute('aria-describedby') ?? '');
    await waitFor(() => tooltip()?.getAttribute('role') === 'tooltip');
    expect(tooltip()?.textContent).toBe('Message estimate: 150k → 20k tokens');
    summary(root)!.click();
    await waitFor(() => collapsed('third'));
    expect(tooltip()).toBeNull();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(document.activeElement).toBe(summary(root));
    expect(root.querySelector('[data-flower-row-decoration-id="third"] .flower-turn-row-viewport')?.hasAttribute('inert')).toBe(true);
    summary(root)!.click(); summary(root)!.click(); summary(root)!.click();
    await waitFor(() => !collapsed('third'));
    live.envelope({ schema_version: 2, kind: 'thread.batch', thread_id: 'process', current: { ...terminal, view_version: 3 }, timeline_decorations: decorations.map(d => ({ ...d, compaction: { ...d.compaction, updated_at_ms: 2 } })) });
    await waitFor(() => divider('third')?.getAttribute('data-flower-compaction-status') === 'compacted');
    expect(collapsed('third')).toBe(false);
    expect(root.querySelectorAll('[data-flower-decoration-id]')).toHaveLength(4);
  });

  const eventRow = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>('[data-parent-event="' + id + '"]')!;
  const eventHidden = (root: HTMLElement, id: string) => root.querySelector(`[data-flower-row-event-id="${id}"] .flower-turn-row-viewport`)?.getAttribute('aria-hidden') === 'true';
  it.each([0, 1, 2])('folds reported failed structure after its user at Fork depth %s', async depth => {
    const fixture = canonicalProcessFixture(depth);
    const items = fixture.items!.map((item, index) => ({ ...item, id: ['user', 'progress', 'tool', 'second-progress', 'final-a'][index], turn_id: 'turn', run_id: 'run' }));
    const events = fixture.parent_events!.events.map(event => ({ ...event, parent_turn_id: 'turn' }));
    const { root } = await mount(current(true, { last_outcome: 'failed', items, turns: [turn({ outcome: 'failed', intermediate_item_ids: ['progress', 'second-progress'], final_item_ids: [], final_boundary_complete: false })], parent_events: parentProcessPage(events) }));
    const user = message(root, 'user');
    expect(user.compareDocumentPosition(summary(root)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('true');
    summary(root)!.click();
    expect(hidden(root, 'progress')).toBe(true);
    expect(hidden(root, 'second-progress')).toBe(true);
    expect(events.every(event => eventHidden(root, event.id))).toBe(true);
    expect(hidden(root, 'user')).toBe(false);
    expect(root.querySelector('.flower-run-error')?.closest('[inert]')).toBeNull();
    summary(root)!.click();
    expect(hidden(root, 'progress')).toBe(false);
    expect(events.every(event => !eventHidden(root, event.id))).toBe(true);
  });
  it.each(['selection', 'focus', 'reading'] as const)('protects %s when canonical prose classification arrives after terminal settlement', async protection => {
    const initial = current(true, { turns: [turn({ intermediate_item_ids: [] })] });
    const { root, live } = await mount(initial);
    const prose = message(root, 'progress');
    expect(hidden(root, 'progress')).toBe(false);
    if (protection === 'selection') {
      (document.activeElement as HTMLElement | null)?.blur();
      const range = document.createRange(); range.selectNodeContents(prose);
      document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
      expect(document.getSelection()?.toString()).toContain('Intermediate progress report.');
    } else if (protection === 'focus') { prose.tabIndex = 0; prose.focus(); }
    else await inspectTranscript(root);
    live.push(current(true, { view_version: 3 }));
    await waitFor(() => prose.closest('.flower-turn-row')?.getAttribute('data-flower-turn-process') === 'true');
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('true');
    expect(hidden(root, 'progress')).toBe(false);
    expect(message(root, 'progress')).toBe(prose);
    document.getSelection()?.removeAllRanges();
    summary(root)!.click();
    expect(hidden(root, 'progress')).toBe(true);
    expect(hidden(root, 'final-a')).toBe(false);
  });
  it('keeps failed report reads and continuation retries reachable outside collapsed work', async () => {
    const complete = parentProcessPage();
    const partial = { ...complete, events: [parentProcessEvents[0]], next_after_event_id: parentProcessEvents[0].id };
    const read = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(partial).mockRejectedValueOnce(new Error('page offline'))
      .mockResolvedValueOnce({ ...complete, events: parentProcessEvents.slice(1) });
    const initial = { ...partial, events: [{ ...parentProcessEvents[0], message: undefined }] };
    const { root } = await mount(current(true, { parent_events: initial }), undefined, { readParentEvents: read });
    const recovery = () => root.querySelector<HTMLElement>('.flower-parent-event-reading');
    await waitFor(() => Boolean(recovery()?.querySelector('button:not(:disabled)')));
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('false');
    expect(recovery()?.closest('[inert], [aria-hidden="true"]')).toBeNull();
    recovery()!.querySelector<HTMLButtonElement>('button')!.click();
    await waitFor(() => !recovery());
    const more = root.querySelector<HTMLButtonElement>('.flower-transcript-stack > button.flower-parent-event-action')!;
    expect(more.disabled).toBe(false);
    expect(more.closest('[inert], [aria-hidden="true"]')).toBeNull();
    more.click();
    await waitFor(() => Boolean(recovery()?.querySelector('button:not(:disabled)')));
    recovery()!.querySelector<HTMLButtonElement>('button')!.click();
    await waitFor(() => root.querySelectorAll('[data-flower-row-event-id]').length === 11);
    expect(read.mock.calls[2]).toEqual(read.mock.calls[3]);
    expect(summary(root)?.textContent).toContain('11 subtask updates');
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('false');
    expect(parentProcessEvents.every((event) => eventHidden(root, event.id))).toBe(true);
    expect(recovery()).toBeNull();
    expect(more.isConnected).toBe(false);
    summary(root)!.click();
    expect(eventHidden(root, 'event-10')).toBe(false);
  });
  it('folds all eleven child dynamics with failed work and preserves reports, order and late updates', async () => {
    const failed = current(true, { last_outcome: 'failed', turns: [turn({ outcome: 'failed', intermediate_item_ids: ['progress'], final_item_ids: [], final_boundary_complete: false })], parent_events: parentProcessPage(parentProcessEvents.slice(0, 9)) });
    const { root, live } = await mount(failed);
    await waitFor(() => root.querySelectorAll('[data-parent-event]').length === 9);
    const report = eventRow(root, 'event-0');
    let full = report.querySelector<HTMLButtonElement>('.flower-parent-event-disclosure')!;
    full.click();
    expect(full.getAttribute('aria-expanded')).toBe('true');
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('true');
    expect(summary(root)?.textContent).toContain('9 subtask updates');
    const order = [...root.querySelectorAll('[data-parent-event]')].map((node) => node.getAttribute('data-parent-event'));
    const final = message(root, 'final-a');
    summary(root)!.click();
    await waitFor(() => eventHidden(root, 'event-0'));
    live.push({ ...failed, view_version: 3, parent_events: parentProcessPage() });
    await waitFor(() => root.querySelectorAll('[data-flower-row-event-id]').length === 11);
    expect(summary(root)?.textContent).toContain('11 subtask updates');
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('false');
    expect(parentProcessEvents.every((event) => eventHidden(root, event.id))).toBe(true);
    await waitFor(() => !eventRow(root, 'event-0'));
    expect(message(root, 'final-a')).toBe(final);
    expect(hidden(root, 'final-a')).toBe(false);
    expect(hidden(root, 'user')).toBe(false);
    expect(summary(root)?.getAttribute('aria-controls')).toContain(root.querySelector('[data-flower-row-event-id="event-10"] .flower-turn-row-viewport')!.id);
    summary(root)!.click();
    await waitFor(() => !eventHidden(root, 'event-10'));
    full = eventRow(root, 'event-0').querySelector<HTMLButtonElement>('.flower-parent-event-disclosure')!;
    expect([...root.querySelectorAll('[data-parent-event]')].slice(0, 9).map((node) => node.getAttribute('data-parent-event'))).toEqual(order);
    expect(full.getAttribute('aria-expanded')).toBe('true');
    full.focus(); summary(root)!.click();
    expect(document.activeElement).toBe(summary(root));
  });
  it('keeps unresolved admitted actions, unknown effects and unowned events visible under collapsed successful work', async () => {
    const base = parentProcessEvents[0];
    const events: FlowerParentEvent[] = [base,
      { ...base, id: 'input', kind: 'input_required', interaction_id: 'ask', message: undefined },
      { ...base, id: 'approval', kind: 'approval_required', interaction_id: 'approve', message: undefined },
      { ...base, id: 'unsafe', kind: 'failed', reason_code: 'effect_outcome_unknown', message: undefined },
      { ...base, id: 'unowned', parent_turn_id: undefined },
    ];
    const { root, live } = await mount(current(true, { parent_events: parentProcessPage(events) }));
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('false');
    expect(eventHidden(root, base.id)).toBe(true);
    for (const id of ['input', 'approval', 'unsafe', 'unowned']) expect(eventHidden(root, id)).toBe(false);
    live.push(current(true, { view_version: 3, parent_events: parentProcessPage(events.map((event) => event.id === 'input' ? { ...event, resolved: true } : event)) }));
    await waitFor(() => eventHidden(root, 'input'));
    expect(eventHidden(root, 'approval')).toBe(false);
    expect(eventHidden(root, 'unsafe')).toBe(false);
    expect(summary(root)?.textContent).toContain('2 subtask updates');
  });
  it.each(['selection', 'focus', 'pointer', 'keyboard', 'menu', 'reading'] as const)('protects %s before a resolved event becomes foldable', async (protection) => {
    const pending: FlowerParentEvent = { ...parentProcessEvents[0], id: 'pending', kind: 'input_required', interaction_id: 'ask', message: undefined };
    const initial = current(true, { parent_events: parentProcessPage([pending]) });
    const { root, live } = await mount(initial);
    const row = eventRow(root, pending.id);
    expect(eventHidden(root, pending.id)).toBe(false);
    if (protection === 'selection') {
      (document.activeElement as HTMLElement | null)?.blur();
      document.getSelection()!.removeAllRanges();
      const range = document.createRange(); range.selectNodeContents(row); document.getSelection()!.addRange(range);
      expect(document.getSelection()?.isCollapsed).toBe(false);
    } else if (protection === 'focus') { row.tabIndex = 0; row.focus(); }
    else if (protection === 'pointer') row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    else if (protection === 'keyboard') row.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    else if (protection === 'menu') {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); root.append(menu);
    } else await inspectTranscript(root, row);
    live.push(current(true, { view_version: 3, parent_events: parentProcessPage([{ ...pending, resolved: true }]) }));
    await waitFor(() => summary(root)?.textContent?.includes('1 subtask update') === true);
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('true');
    expect(eventHidden(root, pending.id)).toBe(false);
    expect(row.closest('[inert]')).toBeNull();
    if (protection === 'focus') expect(document.activeElement).toBe(row);
    document.getSelection()?.removeAllRanges();
    root.querySelector('[role="menu"]')?.remove();
    document.dispatchEvent(new PointerEvent('pointerup'));
    document.dispatchEvent(new KeyboardEvent('keyup'));
    summary(root)!.click();
    expect(eventHidden(root, pending.id)).toBe(true);
    live.push(current(true, { view_version: 4, parent_events: parentProcessPage([{ ...pending, resolved: true }]) }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('false');
  });
  it('shows answer actions and time only after canonical final completion', async () => {
    const { root, live } = await mount();
    expect(message(root, 'progress').querySelector('.flower-answer-actions')).toBeNull();
    expect(message(root, 'progress').querySelector('time')).toBeNull();
    expect(message(root, 'final-a').querySelector('.flower-answer-actions')).toBeNull();
    const final = message(root, 'final-a');
    live.push(current(true));
    await waitFor(() => Boolean(final.querySelector('.flower-answer-actions')));
    expect(message(root, 'final-a')).toBe(final);
    expect(final.querySelector('time')?.dateTime).toBe('2026-10-11T12:02:38.000Z');
    expect(message(root, 'final-b').querySelector('.flower-answer-actions')).not.toBeNull();
    summary(root)!.click();
    await waitFor(() => !hidden(root, 'progress'));
    expect(message(root, 'progress').querySelector('.flower-answer-actions')).toBeNull();
    expect(message(root, 'progress').querySelector('time')).toBeNull();
  });
  it.each(['missing', 'incomplete', 'failed', 'cancelled', 'interrupted'] as const)('omits final answer actions for %s final authority', async (authority) => {
    const { root } = await mount(current(true, {
      turns: authority === 'missing' ? undefined : [turn({
        outcome: authority === 'failed' || authority === 'cancelled' || authority === 'interrupted' ? authority : 'completed',
        intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false,
      })],
      ...(authority === 'failed' || authority === 'cancelled' || authority === 'interrupted' ? { last_outcome: authority } : {}),
    }));
    expect(root.querySelector('.flower-answer-actions')).toBeNull();
    expect(message(root, 'progress').querySelector('time')).toBeNull();
    expect(message(root, 'final-a').querySelector('time')).toBeNull();
  });
  it('retains earlier final actions while a later turn is active', async () => {
    const done = current(true);
    const { root, live } = await mount(done);
    const toolbar = message(root, 'final-a').querySelector('.flower-answer-actions');
    live.push({ ...done, view_version: 3, turn_id: 'next-turn', run_id: 'next-run', activity: 'active',
      last_outcome: undefined, run_progress: { phase: 'streaming' }, turns: [turn(), turn({
        turn_id: 'next-turn', run_id: 'next-run', started_at: '2026-10-11T12:03:00Z', ended_at: undefined, outcome: undefined,
        elapsed_ms: 0, waiting_ms: 0, work_duration_ms: 0, intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false,
      })], items: [...done.items!,
        { id: 'next-user', turn_id: 'next-turn', run_id: 'next-run', ordinal: 7, kind: 'user', text: 'Continue the review.' },
        { id: 'next-progress', turn_id: 'next-turn', run_id: 'next-run', ordinal: 8, kind: 'assistant', text: 'Inspecting the next result.', live: true },
      ],
    });
    await waitFor(() => Boolean(message(root, 'next-progress')));
    expect(toolbar).not.toBeNull();
    expect(message(root, 'final-a').querySelector('.flower-answer-actions')).toBe(toolbar);
    expect(message(root, 'final-b').querySelector('.flower-answer-actions')).not.toBeNull();
    expect(message(root, 'next-progress').querySelector('.flower-answer-actions')).toBeNull();
    expect(message(root, 'next-progress').querySelector('time')).toBeNull();
  });
  it.each(['canonical', 'legacy'] as const)('removes all inter-row spacing from long %s collapsed work', async (policy) => {
    const done = current(true);
    const thinking = done.items!.find((item) => item.id === 'thinking')!;
    const items = [done.items![0], ...Array.from({ length: 28 }, (_, index) => ({ ...thinking, id: `thinking-${index}` })),
      done.items!.find((item) => item.id === 'tool')!, ...done.items!.filter((item) => item.id.startsWith('final-'))];
    const { root } = await mount({ ...done, items: items.map((item, index) => ({ ...item, ordinal: index + 1 })),
      turns: [policy === 'canonical' ? turn({ intermediate_item_ids: [] }) : turn({ intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })] });
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => [...root.querySelectorAll('.flower-turn-row-viewport[aria-hidden="true"]')].every((row) => getComputedStyle(row).display === 'none'));
    expect(message(root, 'final-a').getBoundingClientRect().top - summary(root)!.getBoundingClientRect().bottom).toBeLessThanOrEqual(32);
  });
  it('collapses successful work despite a tool failure, retaining final DOM and both final segments', async () => {
    const { root, live } = await mount();
    expect(summary(root)).toBeNull();
    const final = message(root, 'final-a');
    live.push(current(true));
    await waitFor(() => summary(root)?.getAttribute('aria-expanded') === 'false');
    expect(summary(root)?.textContent).toContain('2 minutes 18 seconds');
    expect(hidden(root, 'progress')).toBe(true);
    expect(hidden(root, 'tool')).toBe(true);
    expect(hidden(root, 'user')).toBe(false);
    expect(hidden(root, 'final-a')).toBe(false);
    expect(hidden(root, 'final-b')).toBe(false);
    expect(message(root, 'final-a')).toBe(final);
    const button = summary(root)!;
    const top = button.getBoundingClientRect().top;
    await userEvent.click(button);
    await waitFor(() => !hidden(root, 'progress'));
    expect(button.parentElement?.children).toHaveLength(1);
    expect(root.querySelector('.flower-turn-timing')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 240));
    expect(Math.abs(button.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
    const internal = message(root, 'tool').querySelector<HTMLButtonElement>('button')!;
    internal.focus(); button.click();
    expect(document.activeElement).toBe(button);
    expect(message(root, 'final-a')).toBe(final);
  });
  it('shows one failure explanation while preserving older failed-turn status', async () => {
    const done = current(true);
    const oldItems = done.items!.filter((item) => item.id === 'user').map((item) => ({ ...item, id: 'old-user', turn_id: 'old-turn', run_id: 'old-run' }));
    const { root } = await mount(current(true, {
      last_outcome: 'failed', run_error_code: 'provider_server_error', error: 'The model provider returned a server error.',
      run_error_detail: JSON.stringify({ provider: 'openai', http_status: 500, message: 'The model is overloaded.' }),
      items: [...oldItems, ...done.items!],
      turns: [turn({ turn_id: 'old-turn', run_id: 'old-run', outcome: 'failed', intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false }), turn({ outcome: 'failed', intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })],
    }));
    await waitFor(() => Boolean(root.querySelector('.flower-error-card')));
    expect(root.querySelectorAll('.flower-error-card')).toHaveLength(1);
    expect(root.querySelector('[data-flower-turn-id="turn"] .flower-turn-ended')).toBeNull();
    expect(root.querySelector('[data-flower-turn-id="old-turn"] .flower-turn-ended')).not.toBeNull();
    expect(root.querySelector('.flower-error-message')?.textContent).toBe('The model is overloaded.');
  });
  it('retains the interruption label when the generic failure notice is hidden', async () => {
    const { root } = await mount(current(true, {
      last_outcome: 'interrupted', run_error_code: 'floret_turn_interrupted', error: 'Runtime interrupted.',
      turns: [turn({ outcome: 'interrupted', intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })],
    }));
    expect(root.querySelector('.flower-error-card')).toBeNull();
    expect(root.querySelector('[data-flower-turn-id="turn"] .flower-turn-ended')).not.toBeNull();
  });
  it.each(['failed', 'cancelled', 'interrupted'] as const)('keeps %s work while active thinking stays folded', async (outcome) => {
    const { root, live } = await mount();
    expect(root.querySelector('[data-flower-thinking-view="collapsed"]')).not.toBeNull();
    live.push(current(true, { last_outcome: outcome, turns: [turn({ outcome, intermediate_item_ids: ['progress'], final_item_ids: [], final_boundary_complete: false })] }));
    const outcomeNotice = () => root.querySelector(outcome === 'cancelled' ? '.flower-turn-ended' : '.flower-run-error');
    await waitFor(() => Boolean(outcomeNotice()));
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('true');
    expect(hidden(root, 'progress')).toBe(false);
    expect(root.querySelector('[data-flower-thinking-view="collapsed"]')).not.toBeNull();
    summary(root)!.click();
    expect(hidden(root, 'thinking')).toBe(true);
    expect(hidden(root, 'tool')).toBe(true);
    expect(hidden(root, 'progress')).toBe(true);
    expect(hidden(root, 'final-a')).toBe(false);
    expect(outcomeNotice()?.textContent).toBeTruthy();
    expect(root.querySelectorAll('.flower-run-error')).toHaveLength(outcome === 'cancelled' ? 0 : 1);
  });
  it.each(['failed', 'cancelled', 'interrupted'] as const)('collapses default %s work when a newer ordinary turn starts', async outcome => {
    const stopped = current(true, { last_outcome: outcome, turns: [turn({ outcome, final_item_ids: [], final_boundary_complete: false })] });
    const { root, live } = await mount(stopped);
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('true');
    const partial = message(root, 'final-a');
    live.push(continued(stopped));
    await waitFor(() => summary(root)?.getAttribute('aria-expanded') === 'false');
    expect(hidden(root, 'thinking')).toBe(true);
    expect(hidden(root, 'tool')).toBe(true);
    expect(hidden(root, 'progress')).toBe(true);
    expect(hidden(root, 'final-a')).toBe(false);
    expect(hidden(root, 'next-user')).toBe(false);
    expect(message(root, 'final-a')).toBe(partial);
    expect(root.querySelector('.flower-turn-ended')).not.toBeNull();
    summary(root)!.click();
    expect(hidden(root, 'tool')).toBe(false);
  });
  it.each(['selection', 'focus', 'tool', 'pointer', 'keyboard', 'menu', 'reading', 'manual-open', 'manual-collapse'] as const)('preserves %s inspection or choice when abnormal work becomes historical', async protection => {
    const stopped = current(true, { last_outcome: 'failed', turns: [turn({ outcome: 'failed', final_item_ids: [], final_boundary_complete: false })] });
    const { root, live } = await mount(stopped);
    const process = message(root, 'progress');
    if (protection === 'selection') {
      (document.activeElement as HTMLElement | null)?.blur();
      const range = document.createRange(); range.selectNodeContents(process);
      document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
    } else if (protection === 'focus') { process.tabIndex = 0; process.focus(); }
    else if (protection === 'tool') message(root, 'tool').querySelector<HTMLButtonElement>('button')!.click();
    else if (protection === 'pointer') process.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    else if (protection === 'keyboard') process.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    else if (protection === 'menu') {
      process.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); root.append(menu);
    } else if (protection === 'reading') await inspectTranscript(root);
    else { summary(root)!.click(); if (protection === 'manual-open') summary(root)!.click(); }
    live.push(continued(stopped));
    await waitFor(() => Boolean(message(root, 'next-user')));
    const expanded = protection !== 'manual-collapse';
    expect(summary(root)?.getAttribute('aria-expanded')).toBe(String(expanded));
    expect(hidden(root, 'progress')).toBe(!expanded);
    expect(message(root, 'progress')).toBe(process);
    document.getSelection()?.removeAllRanges();
    (document.activeElement as HTMLElement | null)?.blur();
    root.querySelector('[role="menu"]')?.remove();
    process.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    process.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
    live.push({ ...live.current(), view_version: 4 });
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(summary(root)?.getAttribute('aria-expanded')).toBe(String(expanded));
    root.querySelector<HTMLButtonElement>('[data-thread-id="peer"] button')!.click();
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="m1"]')));
    root.querySelector<HTMLButtonElement>('[data-thread-id="process"] button')!.click();
    await waitFor(() => Boolean(summary(root)));
    expect(summary(root)?.getAttribute('aria-expanded')).toBe(String(expanded));
    if (expanded) summary(root)!.click();
    expect(hidden(root, 'progress')).toBe(true);
  });
  it('folds Goal tools and owned changes while keeping independent edits and the Goal editor reachable', async () => {
    const done = current(true);
    const goal = { version: 2, text: 'Verify the deployment', status: 'completed' as const, actor: 'model' as const };
    const items = [
      { id: 'independent-goal', kind: 'goal' as const, goal: { goal: { ...goal, version: 1, actor: 'user' as const, status: 'active' as const }, operation: 'set' as const, actor: 'user' as const, at: '2026-10-11T11:59:00Z' } },
      done.items![0],
      { id: 'goal-set', turn_id: 'turn', run_id: 'run', kind: 'goal' as const, goal: { goal: { ...goal, status: 'active' as const }, operation: 'set' as const, actor: 'model' as const, at: '2026-10-11T12:00:00Z' } },
      ...done.items!.slice(1, 4).map(item => item.kind === 'tool' ? { ...item, activity: { item_id: 'tool', tool_id: 'tool', tool_name: 'goal', kind: 'tool', status: 'success', presentation: { label: 'Review Goal', renderer: 'structured', payload: { goal: { operation: 'review', outcome: 'completed', text: 'Verify the deployment', evidence: 'Deployment verified' } } } } } : item),
      { id: 'goal-completed', turn_id: 'turn', run_id: 'run', kind: 'goal' as const, goal: { goal, operation: 'completed' as const, actor: 'model' as const, at: '2026-10-11T12:02:38Z' } },
      ...done.items!.slice(4),
    ].map((item, index) => ({ ...item, ordinal: index + 1 }));
    const { root, live } = await mount({ ...done, items, goal });
    const final = message(root, 'final-a');
    expect(root.querySelectorAll('[data-flower-goal-change]')).toHaveLength(1);
    expect(['goal-set', 'goal-completed'].every(id => hidden(root, id))).toBe(true);
    expect(hidden(root, 'tool')).toBe(true);
    expect(message(root, 'user').compareDocumentPosition(summary(root)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(root.querySelector('.flower-goal-tag')).toBeNull();
    const nextGoal = { version: 3, text: 'Verify the next deployment', status: 'active' as const, actor: 'user' as const };
    live.push({ ...done, items, goal: nextGoal, view_version: 3 });
    await waitFor(() => Boolean(root.querySelector('.flower-goal-tag')));
    const editor = root.querySelector<HTMLButtonElement>('.flower-goal-tag')!;
    expect(editor.closest('[inert], [aria-hidden="true"]')).toBeNull();
    editor.click();
    await waitFor(() => Boolean(document.querySelector('.flower-goal-input')));
    expect(document.querySelector('.flower-goal-input')?.closest('[inert], [aria-hidden="true"]')).toBeNull();
    await userEvent.keyboard('{Escape}');
    summary(root)!.click();
    await waitFor(() => root.querySelectorAll('[data-flower-goal-change]').length === 3);
    const tool = message(root, 'tool');
    tool.querySelector<HTMLButtonElement>('button')!.click();
    const details = tool.querySelector('[aria-expanded="true"]');
    expect(details).not.toBeNull();
    summary(root)!.click();
    live.push({ ...done, items, goal: nextGoal, view_version: 4 });
    await waitFor(() => !message(root, 'tool'));
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('false');
    summary(root)!.click();
    await waitFor(() => Boolean(message(root, 'tool')));
    expect(message(root, 'tool').querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect(message(root, 'final-a')).toBe(final);
  });
  it('does not supersede the latest failed turn for context compaction', async () => {
    const stopped = current(true, { last_outcome: 'failed', turns: [turn({ outcome: 'failed', final_item_ids: [], final_boundary_complete: false })] });
    const { root, live } = await mount(stopped);
    live.push({ ...stopped, view_version: 3, turns: [...stopped.turns!, turn({ turn_id: 'compact', run_id: 'compact-run', kind: 'context_compaction', intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })] });
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('true');
    expect(hidden(root, 'progress')).toBe(false);
  });
  it.each(['selection', 'focus', 'tool', 'pointer', 'keyboard', 'menu', 'reading'] as const)('protects %s inspection once at completion', async (protection) => {
    const { root, live } = await mount();
    const process = message(root, 'progress');
    let pointer: PointerEvent | undefined;
    if (protection === 'selection') {
      (document.activeElement as HTMLElement | null)?.blur();
      const range = document.createRange(); range.selectNodeContents(process);
      document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
      expect(document.getSelection()?.toString()).toContain('Intermediate progress report.');
    } else if (protection === 'focus') {
      const button = message(root, 'tool').querySelector<HTMLButtonElement>('button')!; button.focus();

    } else if (protection === 'tool') {
      message(root, 'tool').querySelector<HTMLButtonElement>('button')!.click();
    } else if (protection === 'pointer') {
      pointer = new PointerEvent('pointerdown', { bubbles: true, pointerId: 42 }); process.dispatchEvent(pointer);
    } else if (protection === 'keyboard') {
      process.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    } else if (protection === 'menu') {
      process.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); root.append(menu);
    } else {
      await inspectTranscript(root);
    }
    live.push(current(true));
    await waitFor(() => summary(root)?.getAttribute('aria-expanded') === 'true');
    expect(hidden(root, 'progress')).toBe(false);
    expect(root.querySelector('.flower-thinking-disclosure')?.getAttribute('data-flower-thinking-view')).toBe('collapsed');
    if (protection === 'tool') expect(message(root, 'tool').querySelector('[aria-expanded="true"]')).not.toBeNull();
    if (protection === 'selection') expect(document.getSelection()?.toString()).toContain('Intermediate progress report.');
    if (pointer) document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 42 }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' })); root.querySelector('[role="menu"]')?.remove();
    document.getSelection()?.removeAllRanges(); (document.activeElement as HTMLElement | null)?.blur();
    live.push(current(true, { view_version: 3 }));
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('true');
  });
  it('settles outer work independently from a manually expanded thinking segment', async () => {
    const { root, live } = await mount();
    root.querySelector<HTMLButtonElement>('.flower-thinking-toggle')!.click();
    expect(root.querySelector('[data-flower-thinking-view="expanded"]')).not.toBeNull();
    (document.activeElement as HTMLElement | null)?.blur();
    live.push(current(true));
    await waitFor(() => summary(root)?.getAttribute('aria-expanded') === 'false');
    expect(root.querySelector('.flower-thinking-disclosure')?.getAttribute('data-flower-thinking-view')).toBe('collapsed');
    summary(root)!.click();
    await waitFor(() => !hidden(root, 'thinking'));
    expect(root.querySelector('.flower-thinking-disclosure')?.getAttribute('data-flower-thinking-view')).toBe('collapsed');
    root.querySelector<HTMLButtonElement>('.flower-thinking-toggle')!.click();
    expect(root.querySelector('[data-flower-thinking-view="expanded"]')).not.toBeNull();
    summary(root)!.click();
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('false');
    summary(root)!.click();
    expect(root.querySelector('[data-flower-thinking-view="expanded"]')).not.toBeNull();
    live.push(current(true, { view_version: 3 }));
    expect(root.querySelector('[data-flower-thinking-view="expanded"]')).not.toBeNull();
  });
  it('preserves manual disclosure across chat selection and complete detail replacement', async () => {
    const { root, live } = await mount(current(true));
    summary(root)!.click();
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('true');
    root.querySelector<HTMLButtonElement>('[data-thread-id="peer"] button')!.click();
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="m1"]')));
    root.querySelector<HTMLButtonElement>('[data-thread-id="process"] button')!.click();
    await waitFor(() => summary(root)?.getAttribute('aria-expanded') === 'true');
    live.push(current(true, { view_version: 3 }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('true');
  });
  it('anchors the conclusion when completed process above the reading viewport collapses', async () => {
    const initial = current();
    const content = initial.items!.map((item) => item.id === 'progress'
      ? { ...item, text: Array.from({ length: 90 }, (_, i) => `Process line ${i}.`).join('\n\n') }
      : item.id === 'final-a' ? { ...item, text: Array.from({ length: 80 }, (_, i) => `Conclusion paragraph ${i}.`).join('\n\n') } : item);
    const { root, live } = await mount({ ...initial, items: content });
    const viewport = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    const final = message(root, 'final-a');
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    viewport.scrollTop += final.getBoundingClientRect().top - viewport.getBoundingClientRect().top + 24;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(message(root, 'progress').getBoundingClientRect().bottom).toBeLessThan(viewport.getBoundingClientRect().top);
    const top = final.getBoundingClientRect().top;
    live.push({ ...current(true), items: [...content.map((item) => ({ ...item, live: false })), current(true).items!.at(-1)!] });
    await waitFor(() => summary(root)?.getAttribute('aria-expanded') === 'false');
    await new Promise((resolve) => setTimeout(resolve, 240));
    expect(Math.abs(final.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
    expect(message(root, 'final-a')).toBe(final);
  });
  it('collapses historical stopped work independently of the latest successful turn', async () => {
    const done = current(true);
    const oldItems = done.items!.filter((item) => !item.id.startsWith('final-')).map((item) => ({ ...item, id: `old-${item.id}`, turn_id: 'old-turn', run_id: 'old-run' }));
    const { root } = await mount({ ...done, items: [...oldItems, ...done.items!], turns: [turn({ turn_id: 'old-turn', run_id: 'old-run', outcome: 'cancelled', intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false }), turn()] });
    expect(root.querySelectorAll('.flower-turn-summary-button')).toHaveLength(2);
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('false');
    expect(hidden(root, 'old-thinking')).toBe(true);
    expect(hidden(root, 'old-tool')).toBe(true);
    expect(hidden(root, 'old-progress')).toBe(false);
    expect(root.querySelector('.flower-turn-ended')?.textContent).toBe('Stopped');
    expect(hidden(root, 'progress')).toBe(true);
  });
  it('keeps resolved clarification receipts and attachments visible in a completed turn', async () => {
    const done = current(true);
    const receipt = { id: 'answer', turn_id: 'turn', run_id: 'run', ordinal: 4, kind: 'interaction' as const, interaction: {
      id: 'answer', turn_id: 'turn', run_id: 'run', kind: 'input' as const, resolved: true,
      input: { summary: 'Choose a route', questions: [{ id: 'route', kind: 'write' as const, prompt: 'Which route?' }] },
      resolution: { accepted: true, input: { route: 'Scenic' } },
    } };
    const { root } = await mount({ ...done, items: [...done.items!.slice(0, 4), receipt, ...done.items!.slice(4)].map((item, index) => ({ ...item, ordinal: index + 1, ...(item.id === 'user' ? { attachments: [{ name: 'notes.txt', mime_type: 'text/plain', size_bytes: 7 }] } : {}) })) });
    expect(hidden(root, 'answer')).toBe(false); expect(hidden(root, 'user')).toBe(false);
    expect(message(root, 'answer').textContent).toContain('Which route?');
    expect(message(root, 'answer').textContent).toContain('Scenic');
    expect(message(root, 'user').textContent).toContain('notes.txt');
  });
  it('keeps an answered interaction between independently folded tool groups', async () => {
    const done = current(true);
    const sourceTool = done.items!.find((item) => item.id === 'tool')!;
    const toolItem = (id: string, ordinal: number, status: 'success' | 'error' = 'success') => ({
      ...sourceTool,
      id,
      ordinal,
      activity: {
        ...sourceTool.activity!,
        item_id: id,
        tool_id: id,
        status,
        severity: status === 'error' ? 'error' : 'quiet',
      },
    });
    const receipt = { id: 'answer', turn_id: 'turn', run_id: 'run', ordinal: 4, kind: 'interaction' as const, interaction: {
      id: 'input-1', turn_id: 'turn', run_id: 'run', kind: 'input' as const, resolved: true,
      input: { summary: 'Choose a route', questions: [{ id: 'route', kind: 'write' as const, prompt: 'Which route?' }] },
      resolution: { accepted: true, input: { route: 'Scenic' } },
    } };
    const initial = current(true, {
      last_outcome: 'interrupted',
      turns: [turn({ outcome: 'interrupted', intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })],
      items: [
        { ...done.items!.find((item) => item.id === 'user')!, ordinal: 1 },
        toolItem('before-one', 2), toolItem('before-two', 3), receipt,
        toolItem('after-one', 5), toolItem('after-two', 6, 'error'),
        { ...done.items!.find((item) => item.id === 'final-a')!, ordinal: 7, text: 'The run stopped after the response.' },
      ],
    });
    const { root } = await mount(initial);
    const overview = () => root.querySelector<HTMLElement>('.flower-turn-summary-static');
    const toolGroups = () => [...root.querySelectorAll<HTMLButtonElement>('.flower-tool-sequence-toggle')];
    await waitFor(() => overview()?.textContent?.includes('4 tool calls') === true && toolGroups().length === 2
      && toolGroups().every((button) => button.getAttribute('aria-expanded') === 'false'));

    expect(summary(root)).toBeNull();
    expect(overview()?.textContent).toContain('1 user response');
    expect(overview()?.textContent).toContain('1 failed tool call');
    expect(hidden(root, 'before-one')).toBe(false);
    expect(hidden(root, 'after-one')).toBe(false);
    expect(hidden(root, 'answer')).toBe(false);
    expect(message(root, 'answer').textContent).toContain('Scenic');
    expect(messageRow(root, 'answer').dataset.flowerInputCheckpoint).toBe('true');
    expect(messageRow(root, 'before-two').compareDocumentPosition(messageRow(root, 'answer')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(messageRow(root, 'answer').compareDocumentPosition(messageRow(root, 'after-one')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    toolGroups()[0]!.click();
    await waitFor(() => toolGroups()[0]?.getAttribute('aria-expanded') === 'true');
    expect(toolGroups()[1]?.getAttribute('aria-expanded')).toBe('false');
    expect(message(root, 'before-one')).not.toBeNull();
    const afterSequence = message(root, 'after-one')?.querySelector('.flower-tool-sequence-viewport');
    expect(afterSequence?.getAttribute('aria-hidden')).toBe('true');
    expect(afterSequence?.hasAttribute('inert')).toBe(true);

    await page.viewport(390, 844);
    const label = overview()!.querySelector<HTMLElement>('.flower-turn-overview-copy')!;
    expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(root.getBoundingClientRect().right + 1);
  });
  it('keeps continuation-run tools folded while preserving the answered checkpoint', async () => {
    const done = current(true);
    const sourceUser = done.items!.find((item) => item.id === 'user')!;
    const sourceTool = done.items!.find((item) => item.id === 'tool')!;
    const toolItem = (id: string, ordinal: number, runID: string, status: 'success' | 'error' = 'success') => ({
      ...sourceTool, id, turn_id: 'turn', run_id: runID, ordinal,
      activity: {
        ...sourceTool.activity!, item_id: id, tool_id: id, status,
        severity: status === 'error' ? 'error' : 'quiet',
      },
    });
    const receipt = { id: 'answer', turn_id: 'turn', run_id: 'run-a', ordinal: 4, kind: 'interaction' as const, interaction: {
      id: 'input-1', turn_id: 'turn', run_id: 'run-a', kind: 'input' as const, resolved: true,
      input: { summary: 'Choose a route', questions: [{ id: 'route', kind: 'write' as const, prompt: 'Which route?' }] },
      resolution: { accepted: true, input: { route: 'Scenic' } },
    } };
    const initial = current(true, {
      run_id: 'run-b', last_outcome: 'interrupted',
      turns: [turn({ run_id: 'run-b', outcome: 'interrupted', intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })],
      items: [
        { ...sourceUser, run_id: 'run-a', ordinal: 1 },
        toolItem('before-one', 2, 'run-a'), toolItem('before-two', 3, 'run-a'), receipt,
        toolItem('after-one', 5, 'run-b'), toolItem('after-two', 6, 'run-b', 'error'),
        { ...done.items!.find((item) => item.id === 'final-a')!, turn_id: 'turn', run_id: 'run-b', ordinal: 7,
          text: 'The run stopped after the response.' },
      ],
    });
    const { root } = await mount(initial);
    const overview = () => root.querySelector<HTMLElement>('.flower-turn-summary-static');
    const toolGroups = () => [...root.querySelectorAll<HTMLButtonElement>('.flower-tool-sequence-toggle')];
    await waitFor(() => overview()?.textContent?.includes('4 tool calls') === true && toolGroups().length === 2
      && toolGroups().every((button) => button.getAttribute('aria-expanded') === 'false'));
    expect(overview()?.textContent).toContain('1 user response');
    expect(overview()?.textContent).toContain('1 failed tool call');
    expect(message(root, 'answer').textContent).toContain('Scenic');
    expect(messageRow(root, 'answer').dataset.flowerInputCheckpoint).toBe('true');
    expect(message(root, 'before-one')).not.toBeNull();
    expect(message(root, 'after-one')).not.toBeNull();
  });
  it.each(['canonical', 'legacy'] as const)('defaults %s child work to collapsed while preserving the parent background entry', async (history) => {
    await page.viewport(1280, 900);
    const child = subagentSummary({ parent_thread_id: 'parent', thread_id: 'process', status: 'completed' });
    const parent = thread({ thread_id: 'parent', subagents: [child] });
    const live = liveStream(liveBootstrap(parent).current);
    live.envelope({ schema_version: 2, kind: 'ready', summaries: [parent] });
    const root = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [parent]),
      loadThread: vi.fn(async () => liveBootstrap(parent, 1)), connectLiveStream: live.connect,
      loadSubagentDetail: vi.fn(async () => ({ summary: child, current: current(true, history === 'legacy'
        ? { turns: [turn({ intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })] } : {}) })) });
    root.style.height = '780px';
    await waitFor(() => Boolean(root.querySelector('[data-thread-id="parent"] button')));
    root.querySelector<HTMLButtonElement>('[data-thread-id="parent"] button')!.click();
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="m1"]')));
    live.envelope({ schema_version: 2, kind: 'thread.batch', thread_id: 'parent', subagents: [child] });
    await waitFor(() => Boolean(root.querySelector('[data-flower-subagent-count="1"]')));
    root.querySelector<HTMLButtonElement>('button[aria-controls="flower-subagents-dropdown"]')!.click();
    await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-disclosure]')));
    document.querySelector<HTMLButtonElement>('[data-flower-subagent-disclosure]')!.click();
    await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-row="0"]')));
    document.querySelector<HTMLButtonElement>('[data-flower-subagent-row="0"]')!.click();
    await waitFor(() => Boolean(document.querySelector('.flower-subagent-detail-transcript .flower-turn-summary-button')));
    const detail = document.querySelector<HTMLElement>('.flower-subagent-detail-transcript')!;
    expect(summary(detail)?.getAttribute('aria-expanded')).toBe('false');
    expect(hidden(detail, 'thinking')).toBe(true);
    expect(hidden(detail, 'progress')).toBe(history === 'canonical'); expect(hidden(detail, 'final-a')).toBe(false);
    const final = message(detail, 'final-a'); summary(detail)!.click();
    expect(message(detail, 'final-a')).toBe(final);
    expect(root.querySelector('button[aria-controls="flower-subagents-dropdown"]')).not.toBeNull();
  });
  it('loads successful history collapsed without an initial animation', async () => {
    const { root } = await mount(current(true));
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('false');
    expect(messageRow(root, 'progress').querySelector('.flower-turn-row-viewport')?.getAttribute('data-state')).toBe('closed');
    expect(message(root, 'final-a').closest('.flower-turn-row-viewport')?.getAttribute('data-state')).toBe('open');
  });
  it('collapses typed legacy process while retaining every assistant reply and manual choice', async () => {
    const legacy = current(true, { turns: [turn({ intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false })] });
    const { root, live } = await mount(legacy);
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('false');
    expect(hidden(root, 'progress')).toBe(false);
    expect(hidden(root, 'thinking')).toBe(true);
    expect(hidden(root, 'tool')).toBe(true);
    expect(hidden(root, 'final-a')).toBe(false);
    expect(hidden(root, 'final-b')).toBe(false);
    summary(root)!.click();
    await waitFor(() => message(root, 'tool').closest('.flower-turn-row-viewport')?.getAttribute('data-state') === 'open');
    const toolButton = message(root, 'tool').querySelector<HTMLButtonElement>('button')!;
    toolButton.focus(); summary(root)!.click();
    expect(document.activeElement).toBe(summary(root));
    expect(hidden(root, 'thinking')).toBe(true);
    expect(hidden(root, 'tool')).toBe(true);
    expect(hidden(root, 'progress')).toBe(false);
    expect(hidden(root, 'final-a')).toBe(false);
    expect(hidden(root, 'final-b')).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-thread-id="peer"] button')!.click();
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="m1"]')));
    root.querySelector<HTMLButtonElement>('[data-thread-id="process"] button')!.click();
    await waitFor(() => summary(root)?.getAttribute('aria-expanded') === 'false');
    live.push({ ...legacy, view_version: 3 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('false');
    const reloadedFinal = message(root, 'final-a');
    live.push({ ...legacy, view_version: 4 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(message(root, 'final-a')).toBe(reloadedFinal);
  });
  it('collapses historical stopped and successful work while preserving unknown Desktop replies', async () => {
    const done = current(true);
    const oldItems = done.items!.map((item) => ({ ...item, id: `old-${item.id}`, turn_id: 'old-turn', run_id: 'old-run' }));
    const { root } = await mount({ ...done, items: [...oldItems, ...done.items!], turns: [
      turn({ turn_id: 'old-turn', run_id: 'old-run', outcome: 'cancelled', elapsed_ms: 91730, waiting_ms: 0, work_duration_ms: 91730,
        ended_at: '2026-10-11T12:01:31.730Z', intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false }),
      turn({ elapsed_ms: 8541, waiting_ms: 0, work_duration_ms: 8541, ended_at: '2026-10-11T12:00:08.541Z', intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false }),
    ] });
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.flower-turn-summary-button')];
    expect(buttons.map((button) => button.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
    expect(buttons[0].textContent).toContain('1 minute 31 seconds');
    expect(buttons[1].textContent).toContain('8 seconds');
    expect(hidden(root, 'old-thinking')).toBe(true);
    expect(hidden(root, 'old-tool')).toBe(true);
    expect(hidden(root, 'old-final-a')).toBe(false);
    expect(hidden(root, 'old-final-b')).toBe(false);
    expect(root.querySelector('.flower-turn-ended')?.textContent).toBe('Stopped');
    expect(buttons[1].getAttribute('aria-expanded')).toBe('false');
    expect(hidden(root, 'thinking')).toBe(true);
    expect(hidden(root, 'final-a')).toBe(false);
    buttons[0].click();
    expect(hidden(root, 'old-tool')).toBe(false);
  });
  it('supports reduced motion, forced colors, and a narrow window', async () => {
    await media.emulateMediaPreferences({ reducedMotion: 'reduce', forcedColors: 'active' });
    const { root } = await mount(current(true, { parent_events: parentProcessPage() }));
    await page.viewport(420, 900);
    const button = summary(root)!; button.click();
    await waitFor(() => messageRow(root, 'progress').querySelector('.flower-turn-row-viewport')?.getAttribute('data-state') === 'open');
    expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
    expect(button.getAttribute('aria-controls')).toBeTruthy();
    button.click();
    await waitFor(() => messageRow(root, 'progress').querySelector('.flower-turn-row-viewport')?.getAttribute('data-state') === 'closed');
    expect(messageRow(root, 'progress').querySelector('[inert]')).not.toBeNull();
  });
  it('uses a quiet inline label and trailing chevron with native keyboard disclosure', async () => {
    const { root } = await mount(current(true));
    const button = summary(root)!;
    const label = button.querySelector('span')!;
    const chevron = button.querySelector('.flower-turn-summary-chevron')!;
    expect(chevron.querySelector('path')).not.toBeNull();
    expect(chevron.getBoundingClientRect().left).toBeGreaterThanOrEqual(label.getBoundingClientRect().right);
    expect(getComputedStyle(button).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(parseFloat(getComputedStyle(button).borderTopWidth)).toBe(0);
    expect(getComputedStyle(button).boxShadow).toBe('none');
    expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
    const final = message(root, 'final-a');
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(getComputedStyle(button).outlineStyle).toBe('solid');
    expect(parseFloat(getComputedStyle(button).outlineWidth)).toBeGreaterThanOrEqual(2);
    await userEvent.keyboard(' ');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(message(root, 'final-a')).toBe(final);
  });
  it('keeps the disclosure aligned and compact in representative themed layouts', async () => {
    const copy = createLocalizedFlowerSurfaceCopy(createTestI18nHelpers('zh-CN') as unknown as FlowerSurfaceTranslator);
    const { root } = await mount(current(true, { parent_events: parentProcessPage() }), copy);
    const themeRoot = document.documentElement;
    const previousStyle = themeRoot.getAttribute('style');
    const previousClass = themeRoot.getAttribute('class');
    const previousTheme = themeRoot.getAttribute('data-floe-shell-theme');
    const previousMaterial = themeRoot.getAttribute('data-floe-surface-style');
    try {
      for (const [name, material, width] of [
        ['paper', 'standard', 1280],
        ['porcelain-dark', 'standard', 1280],
        ['porcelain-light', 'soft-neumorphic', 1280],
        ['graphite', 'soft-neumorphic', 1280],
        ['hc-light', 'standard', 420],
      ] as const) {
        const preset = builtInShellThemePresets.find((preset) => preset.name === name)!;
        themeRoot.removeAttribute('style');
        themeRoot.classList.toggle('dark', preset.mode === 'dark');
        themeRoot.classList.toggle('light', preset.mode === 'light');
        themeRoot.dataset.floeShellTheme = name;
        themeRoot.dataset.floeSurfaceStyle = material;
        for (const [token, value] of Object.entries(preset.semanticTokens ?? {})) {
          if (value) themeRoot.style.setProperty(token, value);
        }
        await page.viewport(width, 900);
        const button = summary(root)!;
        const final = message(root, 'final-a');
        for (const expanded of [false, true]) {
          if (button.getAttribute('aria-expanded') !== String(expanded)) button.click();
          await waitFor(() => messageRow(root, 'progress').querySelector('.flower-turn-row-viewport')?.getAttribute('data-state') === (expanded ? 'open' : 'closed'));
          expect(Math.abs(button.getBoundingClientRect().left - final.getBoundingClientRect().left)).toBeLessThanOrEqual(1);
          expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
          expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
          await page.screenshot({ element: root, path: `__screenshots__/flower-process-${name}-${material}-${expanded ? 'expanded' : 'collapsed'}.png` });
        }
      }
    } finally {
      for (const [name, value] of [['style', previousStyle], ['class', previousClass], ['data-floe-shell-theme', previousTheme], ['data-floe-surface-style', previousMaterial]]) {
        if (value === null) themeRoot.removeAttribute(name!); else themeRoot.setAttribute(name!, value!);
      }
    }
  });
  it.each(SUPPORTED_LOCALES)('renders localized durations and accessible controls at narrow width in %s', async (locale) => {
    const copy = createLocalizedFlowerSurfaceCopy(createTestI18nHelpers(locale) as unknown as FlowerSurfaceTranslator);
    const { root } = await mount(current(true, { parent_events: parentProcessPage() }), copy);
    await page.viewport(420, 900);
    const button = summary(root)!;
    const worked = copy.chat.turnProcess.worked(`${copy.chat.turnProcess.minute(2)} ${copy.chat.turnProcess.second(18)}`);
    expect(button.textContent).toBe(worked + ' · ' + copy.chat.turnProcess.subtaskUpdates(11));
    expect(button.getAttribute('aria-label')).toContain(copy.chat.turnProcess.expand);
    button.click();
    await waitFor(() => button.getAttribute('aria-expanded') === 'true');
    expect(button.getAttribute('aria-label')).toContain(copy.chat.turnProcess.collapse);
    expect(button.parentElement?.children).toHaveLength(1);
    expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
    expect(root.textContent).not.toContain('flowerSurface.chat.turnProcess');
  });
});
