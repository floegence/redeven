import '../index.css';
import './flower-feature.css';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { FlowerLiveStreamConnectInput, FlowerLiveStreamEnvelope, FlowerRuntimeCurrentView, FlowerRuntimeTurn } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { createLocalizedFlowerSurfaceCopy, type FlowerSurfaceTranslator } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const turn = (outcome?: FlowerRuntimeTurn['outcome']): FlowerRuntimeTurn => ({
  turn_id: 'turn', run_id: 'run', started_at: '2026-10-12T12:00:00Z',
  ...(outcome ? { outcome, ended_at: '2026-10-12T12:01:00Z' } : {}),
  elapsed_ms: outcome ? 60000 : 0, waiting_ms: 0, work_duration_ms: outcome ? 60000 : 0, final_item_ids: [], final_boundary_complete: false,
});
function current(changes: Partial<FlowerRuntimeCurrentView> = {}): FlowerRuntimeCurrentView {
  return {
    thread_id: 'thinking-thread', view_version: 1, turn_id: 'turn', run_id: 'run', activity: 'active',
    run_progress: { phase: 'streaming' }, turns: [turn()],
    items: [
      { id: 'user', turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'user', text: 'Inspect this request.' },
      { id: 'thinking', turn_id: 'turn', run_id: 'run', ordinal: 2, kind: 'thinking', live: true,
        text: Array.from({ length: 8 }, (_, i) => `Thinking line ${i + 1}`).join('\n\n') },
    ], ...changes,
  };
}
function sealed(initial: FlowerRuntimeCurrentView, changes: Partial<FlowerRuntimeCurrentView> = {}): FlowerRuntimeCurrentView {
  return { ...initial, view_version: initial.view_version + 1, items: initial.items?.map(item => ({ ...item, live: false })), ...changes };
}
function stream(initial: FlowerRuntimeCurrentView, summaries: () => FlowerLiveStreamEnvelope & { kind: 'ready' }) {
  let latest = initial;
  const connections: { input: FlowerLiveStreamConnectInput; values: (FlowerLiveStreamEnvelope | Error)[]; wake?: () => void }[] = [];
  const connect = vi.fn(async function* (input: FlowerLiveStreamConnectInput) {
    const connection = { input, values: [] } as typeof connections[number];
    connections.push(connection);
    yield summaries();
    const abort = () => connection.wake?.();
    input.signal.addEventListener('abort', abort, { once: true });
    try {
      while (!input.signal.aborted) {
        const value = connection.values.shift();
        if (value instanceof Error) throw value;
        if (value) yield value;
        else await new Promise<void>(resolve => { connection.wake = resolve; });
      }
    } finally { input.signal.removeEventListener('abort', abort); }
  });
  const envelope = (value: FlowerLiveStreamEnvelope | Error, index = connections.length - 1) => {
    connections[index].values.push(value); connections[index].wake?.();
  };
  return {
    current: () => latest, connect, connections, envelope,
    setCurrent(value: FlowerRuntimeCurrentView) { latest = value; },
    push(value: FlowerRuntimeCurrentView) {
      latest = value; envelope({ schema_version: 1, kind: 'thread.batch', thread_id: value.thread_id, current: value });
    },
    fail() { envelope(Object.assign(new Error('private diagnostic'), { code: 'envelope_encoding_failed' })); },
  };
}
const disclosure = (root: ParentNode, id = 'thinking') => root.querySelector<HTMLElement>(`[data-flower-message-id="${id}"] .flower-thinking-disclosure`)!;
const toggle = (root: ParentNode, id = 'thinking') => disclosure(root, id).querySelector<HTMLButtonElement>('button')!;
function chevronDirection(root: ParentNode): number {
  const path = toggle(root).querySelector<SVGPathElement>('.flower-thinking-toggle-icon path')!;
  const length = path.getTotalLength();
  const transform = path.getScreenCTM()!;
  const start = path.getPointAtLength(0).matrixTransform(transform);
  const tip = path.getPointAtLength(length / 2).matrixTransform(transform);
  const end = path.getPointAtLength(length).matrixTransform(transform);
  return Math.round(Math.atan2(tip.y - (start.y + end.y) / 2, tip.x - (start.x + end.x) / 2) * 180 / Math.PI);
}
async function mount(presentation: 'full' | 'companion' = 'full', localized = false) {
  await page.viewport(1280, 900);
  const initial = current();
  const seed = thread({ thread_id: initial.thread_id, title: 'Thinking disclosure', messages: [] });
  const summary = () => applyFlowerRuntimeCurrentView(seed, live.current());
  const live = stream(initial, () => ({ schema_version: 1, kind: 'ready', summaries: [summary()] }));
  const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [summary()]),
    loadThread: vi.fn(async () => ({ thread: summary(), current: live.current() })), connectLiveStream: live.connect,
  }, { presentation, companionOpen: true, engaged: true, transcriptVisible: true,
    copy: localized ? createLocalizedFlowerSurfaceCopy(createTestI18nHelpers('zh-CN') as unknown as FlowerSurfaceTranslator) : undefined });
  root.style.height = '780px';
  await waitFor(() => Boolean(root.querySelector(`[data-thread-id="${seed.thread_id}"] button`)));
  root.querySelector<HTMLButtonElement>(`[data-thread-id="${seed.thread_id}"] button`)!.click();
  await waitFor(() => Boolean(disclosure(root)) && disclosure(root).getAttribute('data-flower-thinking-active') === 'true');
  await waitFor(() => root.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { root, live, initial };
}

it.each(['full', 'companion'] as const)('points thinking down while visible and right while collapsed in the %s surface', async presentation => {
  const { root, live, initial } = await mount(presentation);
  await expect.poll(() => chevronDirection(root)).toBe(90);
  toggle(root).click();
  expect(disclosure(root).dataset.flowerThinkingView).toBe('expanded');
  await expect.poll(() => chevronDirection(root)).toBe(90);
  toggle(root).click();
  expect(disclosure(root).dataset.flowerThinkingView).toBe('preview');
  await expect.poll(() => chevronDirection(root)).toBe(90);
  live.push(sealed(initial));
  await waitFor(() => disclosure(root).dataset.flowerThinkingView === 'collapsed');
  await expect.poll(() => chevronDirection(root)).toBe(0);
  toggle(root).focus();
  await userEvent.keyboard('{Enter}');
  expect(toggle(root).getAttribute('aria-expanded')).toBe('true');
  await expect.poll(() => chevronDirection(root)).toBe(90);
  await userEvent.keyboard(' ');
  expect(toggle(root).getAttribute('aria-expanded')).toBe('false');
  await expect.poll(() => chevronDirection(root)).toBe(0);
});

it.each([
  ['assistant', 'preview'], ['assistant', 'expanded'], ['tool', 'preview'], ['tool', 'expanded'],
] as const)('collapses %s-bound %s thinking while the turn remains active', async (kind, view) => {
  const { root, live, initial } = await mount();
  expect(disclosure(root).dataset.flowerThinkingView).toBe('preview');
  if (view === 'expanded') toggle(root).click();
  expect(disclosure(root).dataset.flowerThinkingView).toBe(view);
  const next = sealed(initial, { items: [...sealed(initial).items!, kind === 'assistant'
    ? { id: 'next', turn_id: 'turn', run_id: 'run', ordinal: 3, kind, live: true, text: 'Answer begins here.' }
    : { id: 'next', turn_id: 'turn', run_id: 'run', ordinal: 3, kind, activity: {
      item_id: 'next', tool_id: 'next', tool_name: 'terminal.exec', kind: 'tool', status: 'running', severity: 'info', needs_attention: false,
      requires_approval: false, presentation: { label: 'Inspect files', renderer: 'terminal', payload: { command: 'ls' } },
    } }] });
  live.push(next);
  await waitFor(() => disclosure(root).dataset.flowerThinkingView === 'collapsed');
  expect(root.querySelector('.flower-turn-summary-button')).toBeNull();
  expect(toggle(root).textContent).toContain('Thought process');
  expect(disclosure(root).querySelector('.flower-thinking-content')).toBeNull();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  toggle(root).focus();
  await userEvent.keyboard('{Enter}');
  expect(disclosure(root).dataset.flowerThinkingView).toBe('expanded');
  live.push({ ...next, view_version: 3 });
  await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="next"]')));
  expect(disclosure(root).dataset.flowerThinkingView).toBe('expanded');
});

it('closes the previous preview without closing a new thinking segment', async () => {
  const { root, live, initial } = await mount();
  live.push(sealed(initial, { items: [...sealed(initial).items!,
    { ...initial.items![1], id: 'thinking-next', ordinal: 3, text: 'A new independent thought.', live: true }] }));
  await waitFor(() => Boolean(disclosure(root, 'thinking-next')));
  expect(disclosure(root).dataset.flowerThinkingView).toBe('collapsed');
  expect(disclosure(root, 'thinking-next').dataset.flowerThinkingView).toBe('preview');
  toggle(root).click();
  live.push(sealed(live.current(), { view_version: 3 }));
  await waitFor(() => disclosure(root, 'thinking-next').dataset.flowerThinkingView === 'collapsed');
  expect(disclosure(root).dataset.flowerThinkingView).toBe('expanded');
});

it.each(['preview', 'expanded'] as const)('retains %s on disconnect and collapses only after a confirmed finished snapshot', async view => {
  const { root, live, initial } = await mount();
  if (view === 'expanded') toggle(root).click();
  live.fail();
  await waitFor(() => Boolean(root.querySelector('[data-flower-sync-state="failed"]')));
  expect(disclosure(root).dataset.flowerThinkingView).toBe(view);
  expect(disclosure(root).dataset.flowerThinkingActive).toBe('false');
  expect(toggle(root).textContent).toContain('Thought process');
  live.setCurrent(sealed(initial));
  const resync = root.querySelector<HTMLButtonElement>('.flower-workspace-sync button')!;
  resync.focus(); await userEvent.keyboard('{Enter}');
  await waitFor(() => disclosure(root).dataset.flowerThinkingView === 'collapsed');
  expect(live.connections).toHaveLength(2);
  expect(live.connections[0].input.signal.aborted).toBe(true);
  live.push({ ...sealed(initial), view_version: 3 });
  await waitFor(() => root.querySelector('.flower-workspace-sync') === null);
  expect(disclosure(root).dataset.flowerThinkingView).toBe('collapsed');
});

it('keeps already sealed thinking closed when a later segment fails', async () => {
  const { root, live, initial } = await mount();
  live.push(sealed(initial));
  await waitFor(() => disclosure(root).dataset.flowerThinkingView === 'collapsed');
  const next = { ...initial.items![1], id: 'thinking-next', ordinal: 3, live: true };
  live.push({ ...sealed(initial), view_version: 3, items: [...sealed(initial).items!, next] });
  await waitFor(() => Boolean(disclosure(root, 'thinking-next')));
  toggle(root, 'thinking-next').click();
  live.push(sealed(live.current(), { view_version: 4, activity: 'idle', last_outcome: 'failed', turns: [turn('failed')] }));
  await waitFor(() => Boolean(root.querySelector('.flower-run-error')));
  expect(disclosure(root).dataset.flowerThinkingView).toBe('collapsed');
  expect(disclosure(root, 'thinking-next').dataset.flowerThinkingView).toBe('expanded');
});

it('does not attribute a later failed run to older thinking in the same turn', async () => {
  const { root, live, initial } = await mount();
  live.fail();
  await waitFor(() => Boolean(root.querySelector('[data-flower-sync-state="failed"]')));
  const resumed = sealed(initial, { run_id: 'resumed-run', activity: 'idle', last_outcome: 'failed',
    turns: [{ ...turn('failed'), run_id: 'resumed-run' }] });
  live.setCurrent(resumed);
  root.querySelector<HTMLButtonElement>('.flower-workspace-sync button')!.click();
  await waitFor(() => disclosure(root).dataset.flowerThinkingView === 'collapsed');
  expect(root.querySelectorAll('.flower-run-error')).toHaveLength(1);
  expect(root.querySelector('.flower-run-error')?.textContent).toContain('Flower could not finish this reply.');
  expect(root.querySelector('.flower-turn-ended')).toBeNull();
});

it('preserves live thinking when exact cancellation is canonical before the terminal outcome', async () => {
  const { root, live, initial } = await mount();
  live.push(sealed(initial, { cancellation: { thread_id: initial.thread_id, turn_id: 'turn', run_id: 'run', source: 'user', mode: 'immediate', requested_at: '2026-10-12T12:00:30Z' } }));
  await waitFor(() => disclosure(root).dataset.flowerThinkingActive === 'false');
  expect(disclosure(root).dataset.flowerThinkingView).toBe('preview');
});

it.each(['full', 'companion'] as const)('supports a localized keyboard disclosure in a narrow %s surface', async presentation => {
  const { root, live, initial } = await mount(presentation, true);
  await page.viewport(360, 760);
  Object.assign(root.style, { width: '360px', height: '760px' });
  live.push(sealed(initial));
  await waitFor(() => disclosure(root).dataset.flowerThinkingView === 'collapsed');
  const button = toggle(root);
  expect(button.textContent).toContain('思考过程');
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
  button.focus(); await userEvent.keyboard('{Enter}');
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(button.getAttribute('aria-controls')!)).not.toBeNull();
  await userEvent.keyboard(' ');
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(button);
});

it.each(['normal-child', 'failed-child'] as const)('uses the child thread facts for %s thinking regardless of the parent outcome', async scenario => {
  await page.viewport(1280, 900);
  const initial = current();
  const child = subagentSummary({ parent_thread_id: 'parent', thread_id: initial.thread_id, status: 'running' });
  const parentCurrent = sealed(current({ thread_id: 'parent' }), { activity: 'idle',
    last_outcome: scenario === 'normal-child' ? 'failed' : 'completed', turns: [turn(scenario === 'normal-child' ? 'failed' : 'completed')] });
  const parent = applyFlowerRuntimeCurrentView(thread({ thread_id: 'parent', subagents: [child] }), parentCurrent);
  const live = stream(initial, () => ({ schema_version: 1, kind: 'ready', summaries: [parent] }));
  const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [parent]),
    loadThread: vi.fn(async () => ({ ...liveBootstrap(parent), current: parentCurrent })), connectLiveStream: live.connect,
    loadSubagentDetail: vi.fn(async () => ({ summary: child, current: live.current() })),
  }, {});
  root.style.height = '780px';
  await waitFor(() => Boolean(root.querySelector('[data-thread-id="parent"] button')));
  root.querySelector<HTMLButtonElement>('[data-thread-id="parent"] button')!.click();
  await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="user"]')));
  live.envelope({ schema_version: 1, kind: 'thread.batch', thread_id: 'parent', subagents: [child] });
  await waitFor(() => Boolean(root.querySelector('[data-flower-subagent-count="1"]')));
  root.querySelector<HTMLButtonElement>('button[aria-controls="flower-subagents-dropdown"]')!.click();
  await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-row="0"]')));
  document.querySelector<HTMLButtonElement>('[data-flower-subagent-row="0"]')!.click();
  await waitFor(() => Boolean(document.querySelector('.flower-subagent-detail-transcript .flower-thinking-disclosure')));
  const transcript = document.querySelector<HTMLElement>('.flower-subagent-detail-transcript')!;
  expect(disclosure(transcript).dataset.flowerThinkingView).toBe('preview');
  toggle(transcript).click();
  live.envelope({ schema_version: 1, kind: 'thread.batch', thread_id: 'parent',
    subagent_current: sealed(initial, scenario === 'failed-child' ? { activity: 'idle', last_outcome: 'failed', turns: [turn('failed')] } : {}) });
  await waitFor(() => disclosure(transcript).dataset.flowerThinkingActive === 'false');
  expect(disclosure(transcript).dataset.flowerThinkingView).toBe(scenario === 'failed-child' ? 'expanded' : 'collapsed');
});
