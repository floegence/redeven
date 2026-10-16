import '../index.css';
import './flower-feature.css';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowerLiveStreamEnvelope, FlowerRuntimeCurrentView, FlowerRuntimeTurn } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
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
  final_item_ids: ['final-a', 'final-b'], final_boundary_complete: true, ...changes,
});
function current(terminal = false, changes: Partial<FlowerRuntimeCurrentView> = {}): FlowerRuntimeCurrentView {
  return {
    thread_id: 'process', view_version: terminal ? 2 : 1, turn_id: 'turn', run_id: 'run', activity: terminal ? 'idle' : 'active',
    ...(terminal ? { last_outcome: 'completed' as const } : { run_progress: { phase: 'streaming' as const } }),
    turns: [terminal ? turn() : turn({ ended_at: undefined, outcome: undefined, elapsed_ms: 0, waiting_ms: 0, work_duration_ms: 0, final_item_ids: [], final_boundary_complete: false })],
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
function liveStream(initial: FlowerRuntimeCurrentView) {
  let latest = initial;
  const values: FlowerLiveStreamEnvelope[] = [];
  let wake: (() => void) | undefined;
  return {
    current: () => latest,
    envelope(value: FlowerLiveStreamEnvelope) { values.push(value); wake?.(); },
    push(value: FlowerRuntimeCurrentView) { latest = value; values.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'process', current: value }); wake?.(); },
    async *connect({ signal }: { signal: AbortSignal }) {
      const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
      try { while (!signal.aborted) { const value = values.shift(); if (value) yield value; else await new Promise<void>((resolve) => { wake = resolve; }); } }
      finally { signal.removeEventListener('abort', abort); }
    },
  };
}
async function mount(initial = current(), copy?: FlowerSurfaceCopy) {
  await page.viewport(1280, 900);
  const seed = applyFlowerRuntimeCurrentView(thread({ thread_id: 'process', title: 'Process disclosure', messages: [] }), initial);
  const peer = thread({ thread_id: 'peer', title: 'Another conversation' });
  const live = liveStream(initial);
  live.envelope({ schema_version: 1, kind: 'ready', summaries: [seed, peer] });
  const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [applyFlowerRuntimeCurrentView(seed, live.current()), peer]),
    loadThread: vi.fn(async (id) => id === peer.thread_id ? liveBootstrap(peer) : { thread: applyFlowerRuntimeCurrentView(seed, live.current()), current: live.current() }), connectLiveStream: live.connect }, { copy });
  root.style.height = '780px';
  await waitFor(() => Boolean(root.querySelector('[data-thread-id="process"] button')));
  root.querySelector<HTMLButtonElement>('[data-thread-id="process"] button')!.click();
  await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="final-a"]')));
  await waitFor(() => root.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
  return { root, live };
}
const message = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-flower-message-id="${id}"]`)!;
const summary = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.flower-turn-summary-button');
const hidden = (root: HTMLElement, id: string) => message(root, id).closest('.flower-turn-row-viewport')?.getAttribute('aria-hidden') === 'true';
afterEach(async () => { document.getSelection()?.removeAllRanges(); await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' }); });

describe('completed turn process disclosure', () => {
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
        final_item_ids: [], final_boundary_complete: false,
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
        elapsed_ms: 0, waiting_ms: 0, work_duration_ms: 0, final_item_ids: [], final_boundary_complete: false,
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
      turns: [policy === 'canonical' ? turn() : turn({ final_item_ids: [], final_boundary_complete: false })] });
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
      turns: [turn({ turn_id: 'old-turn', run_id: 'old-run', outcome: 'failed', final_item_ids: [], final_boundary_complete: false }), turn({ outcome: 'failed', final_item_ids: [], final_boundary_complete: false })],
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
      turns: [turn({ outcome: 'interrupted', final_item_ids: [], final_boundary_complete: false })],
    }));
    expect(root.querySelector('.flower-error-card')).toBeNull();
    expect(root.querySelector('[data-flower-turn-id="turn"] .flower-turn-ended')).not.toBeNull();
  });
  it.each(['failed', 'cancelled', 'interrupted'] as const)('keeps %s work and an active thinking preview visible', async (outcome) => {
    const { root, live } = await mount();
    expect(root.querySelector('[data-flower-thinking-view="preview"]')).not.toBeNull();
    live.push(current(true, { last_outcome: outcome, turns: [turn({ outcome, final_item_ids: [], final_boundary_complete: false })] }));
    const outcomeNotice = () => root.querySelector(outcome === 'cancelled' ? '.flower-turn-ended' : '.flower-run-error');
    await waitFor(() => Boolean(outcomeNotice()));
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('true');
    expect(hidden(root, 'progress')).toBe(false);
    expect(root.querySelector('[data-flower-thinking-view="preview"]')).not.toBeNull();
    summary(root)!.click();
    expect(hidden(root, 'thinking')).toBe(true);
    expect(hidden(root, 'tool')).toBe(true);
    expect(hidden(root, 'progress')).toBe(false);
    expect(hidden(root, 'final-a')).toBe(false);
    expect(outcomeNotice()?.textContent).toBeTruthy();
    expect(root.querySelectorAll('.flower-run-error')).toHaveLength(outcome === 'cancelled' ? 0 : 1);
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
      root.querySelector<HTMLElement>('.flower-chat-transcript')!.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true }));
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
  it('retains an older stopped turn while a new successful turn collapses independently', async () => {
    const done = current(true);
    const oldItems = done.items!.filter((item) => !item.id.startsWith('final-')).map((item) => ({ ...item, id: `old-${item.id}`, turn_id: 'old-turn', run_id: 'old-run' }));
    const { root } = await mount({ ...done, items: [...oldItems, ...done.items!], turns: [turn({ turn_id: 'old-turn', run_id: 'old-run', outcome: 'cancelled', final_item_ids: [], final_boundary_complete: false }), turn()] });
    expect(root.querySelectorAll('.flower-turn-summary-button')).toHaveLength(2);
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('true');
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
  it.each(['canonical', 'legacy'] as const)('defaults %s child work to collapsed while preserving the parent background entry', async (history) => {
    await page.viewport(1280, 900);
    const child = subagentSummary({ parent_thread_id: 'parent', thread_id: 'process', status: 'completed' });
    const parent = thread({ thread_id: 'parent', subagents: [child] });
    const live = liveStream(liveBootstrap(parent).current);
    live.envelope({ schema_version: 1, kind: 'ready', summaries: [parent] });
    const root = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [parent]),
      loadThread: vi.fn(async () => liveBootstrap(parent, 1)), connectLiveStream: live.connect,
      loadSubagentDetail: vi.fn(async () => ({ summary: child, current: current(true, history === 'legacy'
        ? { turns: [turn({ final_item_ids: [], final_boundary_complete: false })] } : {}) })) });
    root.style.height = '780px';
    await waitFor(() => Boolean(root.querySelector('[data-thread-id="parent"] button')));
    root.querySelector<HTMLButtonElement>('[data-thread-id="parent"] button')!.click();
    await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="m1"]')));
    live.envelope({ schema_version: 1, kind: 'thread.batch', thread_id: 'parent', subagents: [child] });
    await waitFor(() => Boolean(root.querySelector('[data-flower-subagent-count="1"], .flower-header-icon-badge')));
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
    expect(message(root, 'progress').closest('.flower-turn-row-viewport')?.getAttribute('data-state')).toBe('closed');
    expect(message(root, 'final-a').closest('.flower-turn-row-viewport')?.getAttribute('data-state')).toBe('open');
  });
  it('collapses typed legacy process while retaining every assistant reply and manual choice', async () => {
    const legacy = current(true, { turns: [turn({ final_item_ids: [], final_boundary_complete: false })] });
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
  it('keeps legacy stopped work open while completed work defaults to collapsed in Desktop', async () => {
    const done = current(true);
    const oldItems = done.items!.map((item) => ({ ...item, id: `old-${item.id}`, turn_id: 'old-turn', run_id: 'old-run' }));
    const { root } = await mount({ ...done, items: [...oldItems, ...done.items!], turns: [
      turn({ turn_id: 'old-turn', run_id: 'old-run', outcome: 'cancelled', elapsed_ms: 91730, waiting_ms: 0, work_duration_ms: 91730,
        ended_at: '2026-10-11T12:01:31.730Z', final_item_ids: [], final_boundary_complete: false }),
      turn({ elapsed_ms: 8541, waiting_ms: 0, work_duration_ms: 8541, ended_at: '2026-10-11T12:00:08.541Z', final_item_ids: [], final_boundary_complete: false }),
    ] });
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.flower-turn-summary-button')];
    expect(buttons.map((button) => button.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
    expect(buttons[0].textContent).toContain('1 minute 31 seconds');
    expect(buttons[1].textContent).toContain('8 seconds');
    buttons[0].click();
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
    const { root } = await mount(current(true));
    await page.viewport(420, 900);
    const button = summary(root)!; button.click();
    await waitFor(() => message(root, 'progress').closest('.flower-turn-row-viewport')?.getAttribute('data-state') === 'open');
    expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
    expect(button.getAttribute('aria-controls')).toBeTruthy();
    button.click();
    await waitFor(() => message(root, 'progress').closest('.flower-turn-row-viewport')?.getAttribute('data-state') === 'closed');
    expect(message(root, 'progress').closest('[inert]')).not.toBeNull();
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
    const { root } = await mount(current(true), copy);
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
          await waitFor(() => message(root, 'progress').closest('.flower-turn-row-viewport')?.getAttribute('data-state') === (expanded ? 'open' : 'closed'));
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
    const { root } = await mount(current(true), copy);
    await page.viewport(420, 900);
    const button = summary(root)!;
    const worked = copy.chat.turnProcess.worked(`${copy.chat.turnProcess.minute(2)} ${copy.chat.turnProcess.second(18)}`);
    expect(button.textContent).toBe(worked);
    expect(button.getAttribute('aria-label')).toContain(copy.chat.turnProcess.expand);
    button.click();
    await waitFor(() => button.getAttribute('aria-expanded') === 'true');
    expect(button.getAttribute('aria-label')).toContain(copy.chat.turnProcess.collapse);
    expect(button.parentElement?.children).toHaveLength(1);
    expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
    expect(root.textContent).not.toContain('flowerSurface.chat.turnProcess');
  });
});
