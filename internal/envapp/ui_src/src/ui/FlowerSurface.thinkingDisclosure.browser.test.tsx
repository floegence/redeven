import '../index.css';
import outputSources from '../../../../flower_ui/src/testdata/outputSourceCurrentViews.json';
import './flower-feature.css';
import { afterEach, expect, it, vi } from 'vitest';
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
afterEach(() => vi.useRealTimers());
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
      latest = value; envelope({ schema_version: 3, kind: 'thread.batch', thread_id: value.thread_id, current: value });
    },
    fail() { envelope(Object.assign(new Error('private diagnostic'), { code: 'envelope_encoding_failed' })); },
  };
}
const disclosure = (root: ParentNode, id = 'thinking') => root.querySelector<HTMLElement>(`[data-flower-thinking-id="${id}:block:0"]`)!;
const toggle = (root: ParentNode, id = 'thinking') => disclosure(root, id).querySelector<HTMLButtonElement>('button')!;
function expectThinkingTypography(root: ParentNode, id = 'thinking') {
  for (const selector of ['.flower-activity-inline-title', '.flower-activity-inline-duration']) {
    const text = toggle(root, id).querySelector(selector)!;
    expect(text).not.toBeNull();
    expect(getComputedStyle(text).fontSize).toBe('13px');
    expect(getComputedStyle(text).lineHeight).toBe('18px');
  }
}
function chevronDirection(root: ParentNode): number {
  const path = toggle(root).querySelector<SVGPathElement>('.flower-thinking-toggle-icon path')!;
  const length = path.getTotalLength();
  const transform = path.getScreenCTM()!;
  const start = path.getPointAtLength(0).matrixTransform(transform);
  const tip = path.getPointAtLength(length / 2).matrixTransform(transform);
  const end = path.getPointAtLength(length).matrixTransform(transform);
  return Math.round(Math.atan2(tip.y - (start.y + end.y) / 2, tip.x - (start.x + end.x) / 2) * 180 / Math.PI);
}
async function mount(presentation: 'full' | 'companion' = 'full', localized = false, initial = current()) {
  await page.viewport(1280, 900);
  const seed = thread({ thread_id: initial.thread_id, title: 'Thinking disclosure', messages: [] });
  const summary = () => applyFlowerRuntimeCurrentView(seed, live.current());
  const live = stream(initial, () => ({ schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [summary()] }));
  const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [summary()]),
    loadThread: vi.fn(async () => ({ thread: summary(), current: live.current() })), connectLiveStream: live.connect,
  }, { presentation, companionOpen: true, engaged: true, transcriptVisible: true,
    copy: localized ? createLocalizedFlowerSurfaceCopy(createTestI18nHelpers('zh-CN') as unknown as FlowerSurfaceTranslator) : undefined });
  root.style.height = '780px';
  await waitFor(() => Boolean(root.querySelector(`[data-thread-id="${seed.thread_id}"] button`)));
  root.querySelector<HTMLButtonElement>(`[data-thread-id="${seed.thread_id}"] button`)!.click();
  if (!initial.items?.find(item => item.id === 'thinking')?.live) {
    await waitFor(() => Boolean(root.querySelector('.flower-turn-summary-button')) || Boolean(disclosure(root)));
    const summary = root.querySelector<HTMLButtonElement>('.flower-turn-summary-button');
    if (summary?.getAttribute('aria-expanded') === 'false') summary.click();
  }
  await waitFor(() => Boolean(disclosure(root)) && disclosure(root).getAttribute('data-flower-thinking-active') === (initial.items?.find(item => item.id === 'thinking')?.live ? 'true' : 'false'));
  await waitFor(() => root.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { root, live, initial };
}

it.each(['full', 'companion'] as const)('retains completed thinking duration while later work continues in %s', async presentation => {
  const started = Date.parse('2026-10-23T12:00:00Z');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(started + 4000);
  const seed = current();
  const initial = { ...seed, items: seed.items?.map(item => ({ ...item, created_at: new Date(started).toISOString() })) };
  const { root, live } = await mount(presentation, true, initial);
  expectThinkingTypography(root);
  const duration = (id = 'thinking') => disclosure(root, id).querySelector('.flower-activity-inline-duration')?.textContent;
  expect(duration()).toBe('4s');
  vi.setSystemTime(started + 9000);
  const completed = sealed(initial, { items: [
    ...initial.items!.map(item => ({ ...item, live: false, created_at: new Date(started + 9000).toISOString() })),
    { id: 'answer', kind: 'assistant', turn_id: 'turn', run_id: 'run', ordinal: 3, text: 'Checking the result.', created_at: new Date(started + 9000).toISOString() },
    { id: 'thinking-next', kind: 'thinking', turn_id: 'turn', run_id: 'run', ordinal: 4, text: 'Next step.', live: true, created_at: new Date(started + 9000).toISOString() },
  ] });
  live.push(completed);
  await waitFor(() => disclosure(root).dataset.flowerThinkingActive === 'false');
  expect(duration()).toBe('9s');
  expect(toggle(root).querySelector('.flower-activity-inline-title')?.textContent).toBe('思考过程');
  expectThinkingTypography(root);
  toggle(root).click();
  expect(duration()).toBe('9s');
  expect(disclosure(root).dataset.flowerThinkingView).toBe('expanded');
  toggle(root).click();
  vi.setSystemTime(started + 69_000);
  await waitFor(() => duration('thinking-next') === '1m');
  expect(duration()).toBe('9s');
  live.push({ ...completed, view_version: 3 });
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(duration()).toBe('9s');
  if (presentation === 'full') {
    root.querySelector<HTMLButtonElement>('.flower-new-chat-button')!.click();
    await waitFor(() => !disclosure(root));
    root.querySelector<HTMLButtonElement>(`[data-thread-id="${initial.thread_id}"] button`)!.click();
    await waitFor(() => Boolean(disclosure(root)));
    expect(duration()).toBe('9s');
  }
  if (import.meta.env.VITE_FLOWER_THINKING_SCREENSHOTS === '1') {
    await page.screenshot({ element: root, path: `__screenshots__/thinking-duration-${presentation}.png` });
  }
  await page.viewport(360, 760);
  const button = toggle(root);
  expectThinkingTypography(root);
  expectThinkingTypography(root, 'thinking-next');
  expect(getComputedStyle(button.querySelector('.flower-activity-inline-duration')!).display).not.toBe('none');
  expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
});

it('uses the tool activity row and flower animation for standalone live thinking', async () => {
  const { root } = await mount();
  const row = disclosure(root);
  const button = toggle(root);
  expect(row.dataset.flowerThinkingView).toBe('collapsed');
  expect(row.classList.contains('flower-activity-inline')).toBe(true);
  expect(row.classList.contains('flower-thinking-disclosure-inline')).toBe(false);
  expect(row.querySelector('.flower-activity-inline-row')).not.toBeNull();
  expect(button.classList.contains('flower-activity-inline-button')).toBe(true);
  expect(button.querySelector('.flower-thinking-flower')?.getAttribute('aria-hidden')).toBe('true');
  expect(button.querySelectorAll('.flower-thinking-petal')).toHaveLength(5);
  expect(button.querySelector('.flower-thinking-flower')!.getAnimations({ subtree: true })).toHaveLength(6);
  expect(button.querySelector('.flower-activity-inline-title')?.textContent).toBe('Thinking...');
  expect(button.querySelector('[data-floe-progress-shimmer="text"]')?.textContent).toBe('Thinking...');
  expect(button.querySelector('.flower-activity-inline-duration')?.textContent).not.toBe('');
  expectThinkingTypography(root);
  expect(button.querySelector('.flower-thinking-toggle-icon')).not.toBeNull();
  await page.viewport(360, 760);
  expectThinkingTypography(root);
  expect(getComputedStyle(button.querySelector('.flower-activity-inline-duration')!).display).not.toBe('none');
  expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
});

it.each(['full', 'companion'] as const)('uses one tool-style disclosure for live thinking in the %s surface', async presentation => {
  const { root, live, initial } = await mount(presentation);
  expect(disclosure(root).dataset.flowerThinkingView).toBe('collapsed');
  await expect.poll(() => chevronDirection(root)).toBe(0);
  toggle(root).click();
  expect(disclosure(root).dataset.flowerThinkingView).toBe('expanded');
  await expect.poll(() => chevronDirection(root)).toBe(90);
  toggle(root).click();
  expect(disclosure(root).dataset.flowerThinkingView).toBe('collapsed');
  await expect.poll(() => chevronDirection(root)).toBe(0);
  toggle(root).click();
  live.push(sealed(initial));
  await waitFor(() => disclosure(root).dataset.flowerThinkingActive === 'false');
  expect(disclosure(root).dataset.flowerThinkingView).toBe('expanded');
  toggle(root).click();
  expect(disclosure(root).querySelector('.flower-thinking-flower')!.getAnimations({ subtree: true })).toHaveLength(0);
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
  ['assistant', 'collapsed'], ['assistant', 'expanded'], ['tool', 'collapsed'], ['tool', 'expanded'],
] as const)('preserves %s-bound %s thinking while the turn remains active', async (kind, view) => {
  const { root, live, initial } = await mount();
  expect(disclosure(root).dataset.flowerThinkingView).toBe('collapsed');
  if (view === 'expanded') toggle(root).click();
  expect(disclosure(root).dataset.flowerThinkingView).toBe(view);
  const next = sealed(initial, { items: [...sealed(initial).items!, kind === 'assistant'
    ? { id: 'next', turn_id: 'turn', run_id: 'run', ordinal: 3, kind, live: true, text: 'Answer begins here.' }
    : { id: 'next', turn_id: 'turn', run_id: 'run', ordinal: 3, kind, activity: {
      item_id: 'next', tool_id: 'next', tool_name: 'terminal.exec', kind: 'tool', status: 'running', severity: 'info', needs_attention: false,
      requires_approval: false, presentation: { label: 'Inspect files', renderer: 'terminal', payload: { command: 'ls' } },
    } }] });
  live.push(next);
  await waitFor(() => disclosure(root).dataset.flowerThinkingActive === 'false');
  expect(disclosure(root).dataset.flowerThinkingView).toBe(view);
  expect(disclosure(root).querySelector('.flower-thinking-flower')!.getAnimations({ subtree: true })).toHaveLength(0);
  expect(root.querySelector('.flower-turn-summary-button')).toBeNull();
  expect(toggle(root).textContent).toContain('Thought process');
  expect(toggle(root).querySelector('.flower-activity-inline-duration')?.textContent).toBeTruthy();
  expect(Boolean(disclosure(root).querySelector('.flower-thinking-content'))).toBe(view === 'expanded');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  toggle(root).focus();
  if (view === 'collapsed') await userEvent.keyboard('{Enter}');
  expect(disclosure(root).dataset.flowerThinkingView).toBe('expanded');
  live.push({ ...next, view_version: 3 });
  await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="next"]')));
  expect(disclosure(root).dataset.flowerThinkingView).toBe('expanded');
});

it('keeps thinking segments independent while a later segment starts collapsed', async () => {
  const { root, live, initial } = await mount();
  live.push(sealed(initial, { items: [...sealed(initial).items!,
    { ...initial.items![1], id: 'thinking-next', ordinal: 3, text: 'A new independent thought.', live: true }] }));
  await waitFor(() => Boolean(disclosure(root, 'thinking-next')));
  expect(disclosure(root).dataset.flowerThinkingView).toBe('collapsed');
  expect(disclosure(root, 'thinking-next').dataset.flowerThinkingView).toBe('collapsed');
  toggle(root).click();
  live.push(sealed(live.current(), { view_version: 3 }));
  await waitFor(() => disclosure(root, 'thinking-next').dataset.flowerThinkingView === 'collapsed');
  expect(disclosure(root).dataset.flowerThinkingView).toBe('expanded');
});

it('preserves the inspected thinking node and reading offset through folding and live completion', async () => {
  const seed = current();
  const initial = { ...seed, items: seed.items!.map(item => item.kind === 'thinking'
    ? { ...item, text: 'Long reasoning line.\n'.repeat(120) } : item) };
  const { root, live } = await mount('full', false, initial);
  toggle(root).click();
  await waitFor(() => disclosure(root).querySelector('.flower-thinking-viewport')?.getAttribute('data-state') === 'open');
  const content = disclosure(root).querySelector<HTMLElement>('.flower-thinking-content')!;
  await new Promise(resolve => setTimeout(resolve, 250));
  content.scrollTop = 80; content.dispatchEvent(new Event('scroll'));
  toggle(root).click();
  await waitFor(() => disclosure(root).querySelector('.flower-thinking-viewport')?.getAttribute('data-state') === 'closed');
  live.push(sealed(initial));
  await waitFor(() => disclosure(root).dataset.flowerThinkingActive === 'false');
  expect(disclosure(root).dataset.flowerThinkingView).toBe('collapsed');
  expect(disclosure(root).querySelector('.flower-thinking-content')).toBe(content);
  toggle(root).click();
  await waitFor(() => disclosure(root).querySelector('.flower-thinking-viewport')?.getAttribute('data-state') === 'open');
  expect(content.scrollTop).toBe(80);
  live.push({ ...sealed(initial), view_version: 3 });
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(disclosure(root).dataset.flowerThinkingView).toBe('expanded');
  expect(content.scrollTop).toBe(80);
});

it.each(['collapsed', 'expanded'] as const)('retains %s through disconnect and the confirmed finished snapshot', async view => {
  const { root, live, initial } = await mount();
  if (view === 'expanded') toggle(root).click();
  live.fail();
  await waitFor(() => Boolean(root.querySelector('[data-flower-sync-state="failed"]')));
  expect(disclosure(root).dataset.flowerThinkingView).toBe(view);
  expect(disclosure(root).dataset.flowerThinkingActive).toBe('false');
  expect(disclosure(root).querySelector('.flower-thinking-flower')!.getAnimations({ subtree: true })).toHaveLength(0);
  expect(toggle(root).textContent).toContain('Thought process');
  live.setCurrent(sealed(initial));
  const resync = root.querySelector<HTMLButtonElement>('.flower-workspace-sync button')!;
  resync.focus(); await userEvent.keyboard('{Enter}');
  await waitFor(() => live.connections.length === 2);
  expect(disclosure(root).dataset.flowerThinkingView).toBe(view);
  expect(disclosure(root).querySelector('.flower-thinking-flower')!.getAnimations({ subtree: true })).toHaveLength(0);
  expect(live.connections).toHaveLength(2);
  expect(live.connections[0].input.signal.aborted).toBe(true);
  live.push({ ...sealed(initial), view_version: 3 });
  await waitFor(() => root.querySelector('.flower-workspace-sync') === null);
  expect(disclosure(root).dataset.flowerThinkingView).toBe(view);
});

it('keeps already sealed thinking closed when a later segment fails', async () => {
  const { root, live, initial } = await mount();
  live.push(sealed(initial));
  await waitFor(() => disclosure(root).dataset.flowerThinkingView === 'collapsed');
  expect(disclosure(root).querySelector('.flower-thinking-flower')!.getAnimations({ subtree: true })).toHaveLength(0);
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
  expect(disclosure(root).querySelector('.flower-thinking-flower')!.getAnimations({ subtree: true })).toHaveLength(0);
  expect(root.querySelectorAll('.flower-run-error')).toHaveLength(1);
  expect(root.querySelector('.flower-run-error')?.textContent).toContain('Flower could not finish this reply.');
  expect(root.querySelector('.flower-turn-ended')).toBeNull();
});

it('preserves live thinking when exact cancellation is canonical before the terminal outcome', async () => {
  const { root, live, initial } = await mount();
  live.push(sealed(initial, { cancellation: { thread_id: initial.thread_id, turn_id: 'turn', run_id: 'run', source: 'user', mode: 'immediate', requested_at: '2026-10-12T12:00:30Z' } }));
  await waitFor(() => disclosure(root).dataset.flowerThinkingActive === 'false');
  expect(disclosure(root).querySelector('.flower-thinking-flower')!.getAnimations({ subtree: true })).toHaveLength(0);
  expect(disclosure(root).dataset.flowerThinkingView).toBe('collapsed');
});

it.each(['full', 'companion'] as const)('supports a localized keyboard disclosure in a narrow %s surface', async presentation => {
  const { root, live, initial } = await mount(presentation, true);
  await page.viewport(360, 760);
  Object.assign(root.style, { width: '360px', height: '760px' });
  live.push(sealed(initial));
  await waitFor(() => disclosure(root).dataset.flowerThinkingView === 'collapsed');
  expect(disclosure(root).querySelector('.flower-thinking-flower')!.getAnimations({ subtree: true })).toHaveLength(0);
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
  const live = stream(initial, () => ({ schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [parent] }));
  const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [parent]),
    loadThread: vi.fn(async () => ({ ...liveBootstrap(parent), current: parentCurrent })), connectLiveStream: live.connect,
    loadSubagentDetail: vi.fn(async () => ({ summary: child, current: live.current() })),
  }, {});
  root.style.height = '780px';
  await waitFor(() => Boolean(root.querySelector('[data-thread-id="parent"] button')));
  root.querySelector<HTMLButtonElement>('[data-thread-id="parent"] button')!.click();
  await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="user"]')));
  live.envelope({ schema_version: 3, kind: 'thread.batch', thread_id: 'parent', subagents: [child] });
  await waitFor(() => Boolean(root.querySelector('[data-flower-subagent-count="1"]')));
  root.querySelector<HTMLButtonElement>('button[aria-controls="flower-subagents-dropdown"]')!.click();
  await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-row="0"]')));
  document.querySelector<HTMLButtonElement>('[data-flower-subagent-row="0"]')!.click();
  await waitFor(() => Boolean(document.querySelector('.flower-subagent-detail-transcript .flower-thinking-disclosure')));
  const transcript = document.querySelector<HTMLElement>('.flower-subagent-detail-transcript')!;
  expect(disclosure(transcript).dataset.flowerThinkingView).toBe('collapsed');
  toggle(transcript).click();
  live.envelope({ schema_version: 3, kind: 'thread.batch', thread_id: 'parent',
    subagent_current: sealed(initial, scenario === 'failed-child' ? { activity: 'idle', last_outcome: 'failed', turns: [turn('failed')] } : {}) });
  await waitFor(() => disclosure(transcript).dataset.flowerThinkingActive === 'false');
  expect(disclosure(transcript).dataset.flowerThinkingView).toBe('expanded');
});

it('retains correction disclosure, selection and focus through real provider checkpoints and reconnect', async () => {
  await page.viewport(1280, 900);
  const checkpoints = outputSources as unknown as FlowerRuntimeCurrentView[];
  const initial = checkpoints[1];
  const seed = thread({ thread_id: initial.thread_id, title: 'Source order', messages: [] });
  const summary = () => applyFlowerRuntimeCurrentView(seed, live.current());
  const live = stream(initial, () => ({ schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [summary()] }));
  const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => [summary()]),
    loadThread: vi.fn(async () => ({ thread: summary(), current: live.current() })), connectLiveStream: live.connect,
  }, { engaged: true, transcriptVisible: true });
  root.style.height = '780px';
  await waitFor(() => Boolean(root.querySelector('[data-thread-id="source-thread"] button')));
  root.querySelector<HTMLButtonElement>('[data-thread-id="source-thread"] button')!.click();
  await waitFor(() => Boolean(disclosure(root, 'source-2')));
  const button = toggle(root, 'source-2');
  button.click();
  await waitFor(() => disclosure(root, 'source-2').dataset.flowerThinkingView === 'expanded');
  const row = root.querySelector('[data-flower-message-id="source-2"]')!;
  const content = disclosure(root, 'source-2').querySelector('.flower-thinking-content')!;
  await expect.poll(() => content.closest('.flower-thinking-viewport')!.getAttribute('data-state')).toBe('open');
  const range = document.createRange(); range.selectNodeContents(content);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  const selected = selection.toString();
  expect(selected).toContain('Correction one reasoning.');
  button.focus();
  const transcript = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
  transcript.scrollTop = 0;
  // Native scrolling/focus dispatches after the DOM write. Establish the
  // user's actual painted position before measuring subsequent checkpoints.
  const painted = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  await painted(); await painted();
  const readingTop = button.getBoundingClientRect().top;
  const contentTop = content.getBoundingClientRect().top;
  const displacements: number[] = [];
  let sampling = true;
  const sample = async () => {
    while (sampling) {
      await painted();
      if (sampling) displacements.push(Math.max(Math.abs(button.getBoundingClientRect().top - readingTop), Math.abs(content.getBoundingClientRect().top - contentTop)));
    }
  };
  const sampled = sample();
  try {
    for (const checkpoint of checkpoints.slice(2, 4)) {
      live.push(checkpoint);
      await waitFor(() => Boolean(root.querySelector('[data-flower-message-id="' + checkpoint.items!.at(-1)!.id + '"]')));
      await painted();
      expect(root.querySelector('[data-flower-message-id="source-2"]')).toBe(row);
      expect(disclosure(root, 'source-2').dataset.flowerThinkingView).toBe('expanded');
      expect(document.activeElement).toBe(button);
      expect(selection.toString()).toBe(selected);
      // A new process header changes document offset; inspected content must stay put.
      expect(Math.abs(button.getBoundingClientRect().top - readingTop)).toBeLessThanOrEqual(1);
      expect(Math.abs(content.getBoundingClientRect().top - contentTop)).toBeLessThanOrEqual(1);
    }
  } finally { sampling = false; await sampled; }
  expect(displacements.length).toBeGreaterThan(0);
  expect(Math.max(...displacements)).toBeLessThanOrEqual(1);
  live.fail();
  await waitFor(() => Boolean(root.querySelector('[data-flower-sync-state="failed"]')));
  expect(disclosure(root, 'source-2').dataset.flowerThinkingView).toBe('expanded');
  live.setCurrent(checkpoints[4]);
  root.querySelector<HTMLButtonElement>('.flower-workspace-sync button')!.click();
  await waitFor(() => Boolean(root.textContent?.includes('Inspection complete.')));
  expect(root.querySelector('[data-flower-message-id="source-2"]')).toBe(row);
  expect(disclosure(root, 'source-2').dataset.flowerThinkingView).toBe('expanded');
  expect([...root.querySelectorAll('[data-flower-message-id]')].map(element => element.getAttribute('data-flower-message-id')))
    .toEqual(checkpoints[4].items!.map(item => item.id));
  button.focus(); await userEvent.keyboard(' ');
  expect(disclosure(root, 'source-2').dataset.flowerThinkingView).toBe('collapsed');
  expect(document.activeElement).toBe(button);
  selection.removeAllRanges();
});


it.each(['full', 'companion'] as const)('shows cold historical, single-chunk and unrecorded timing in %s', async presentation => {
  const start = '2026-10-23T12:00:00Z';
  const seed = current();
  const initial = sealed(seed, { activity: 'idle', last_outcome: 'completed', turns: [turn('completed')], items: [
    seed.items![0],
    { ...seed.items![1], live: false, output_started_at: start, output_ended_at: '2026-10-23T12:00:03Z' },
    { ...seed.items![1], id: 'single', ordinal: 3, live: false, text: 'A short thought.', output_started_at: start, output_ended_at: start },
    { ...seed.items![1], id: 'historical', ordinal: 4, live: false, text: 'An older thought.' },
  ] });
  const { root } = await mount(presentation, true, initial);
  const duration = (id: string) => disclosure(root, id).querySelector<HTMLElement>('.flower-activity-inline-duration')!;
  expect(duration('thinking').textContent).toBe('3s');
  expect(duration('single').textContent).toBe('<1ms');
  expect(duration('historical').textContent).toBe('未记录');
  expect(duration('historical').title).toContain('没有记录起止时间');
  toggle(root, 'single').click();
  expect(duration('single').textContent).toBe('<1ms');
  await page.screenshot({ element: root, path: '__screenshots__/thinking-source-timing-' + presentation + '.png' });
});

it('uses the source interval even when completion arrives much later', async () => {
  const started = Date.parse('2026-10-23T12:00:00Z');
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(started + 4000);
  const seed = current();
  const initial = { ...seed, items: seed.items!.map(item => item.kind === 'thinking' ? { ...item, output_started_at: new Date(started).toISOString() } : item) };
  const { root, live } = await mount('full', true, initial);
  vi.setSystemTime(started + 120000);
  live.push(sealed(initial, { items: initial.items!.map(item => item.kind === 'thinking'
    ? { ...item, live: false, output_ended_at: new Date(started + 250).toISOString() } : item) }));
  await waitFor(() => disclosure(root).dataset.flowerThinkingActive === 'false');
  expect(disclosure(root).querySelector('.flower-activity-inline-duration')?.textContent).toBe('250ms');
});
