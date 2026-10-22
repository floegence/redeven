import '../index.css';
import './flower-feature.css';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowerLiveStreamEnvelope, FlowerParentEvent, FlowerRuntimeCurrentView, FlowerRuntimeCurrentItem, FlowerToolCallPreview } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, liveBootstrap, renderSurfaceWithAdapter, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const media = commands as unknown as { emulateMediaPreferences: (input: { reducedMotion?: 'reduce' | 'no-preference'; forcedColors?: 'active' | 'none' }) => Promise<void> };
const item = (id: string, kind: FlowerRuntimeCurrentItem['kind'], text = id): FlowerRuntimeCurrentItem => ({ id, kind, text, turn_id: 'turn', run_id: 'run', ordinal: 0 });
const emptyLiveText = (id: string): FlowerRuntimeCurrentItem => ({ ...item(id, 'assistant', ''), live: true });
const tool = (id: string, status: 'success' | 'running' | 'error' = 'success', toolName = 'terminal.exec', renderer = 'terminal'): FlowerRuntimeCurrentItem => ({ ...item(id, 'tool'), activity: {
  item_id: id, tool_id: id, kind: 'tool', tool_name: toolName, status, severity: status === 'error' ? 'error' : status === 'running' ? 'normal' : 'quiet',
  needs_attention: status !== 'success', requires_approval: false,
  ...(status === 'error' ? { attention_reasons: ['error'] } : status === 'running' ? { attention_reasons: ['running'] } : {}),
  presentation: { label: `Execute ${id}`, renderer, payload: renderer === 'subagent_operation'
    ? { action: 'spawn', requested_count: 1 }
    : { operation: renderer === 'web_search' ? 'search' : 'exec', query: `query ${id}`, command: `echo ${id}`, output: `${id} output`, ...(status === 'error' ? { error: { message: `${id} failed` } } : {}) } },
} });
function current(items: FlowerRuntimeCurrentItem[], version = 1, parentEvents: readonly FlowerParentEvent[] = []): FlowerRuntimeCurrentView {
  return { thread_id: 'sequences', turn_id: 'turn', run_id: 'run', view_version: version, activity: 'active', run_progress: { phase: 'streaming' },
    turns: [{ turn_id: 'turn', run_id: 'run', started_at: '2026-10-21T10:00:00Z', elapsed_ms: 0, waiting_ms: 0,
      work_duration_ms: 0, intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false }],
    items: items.map((value, i) => ({ ...value, ordinal: i + 1 })),
    ...(parentEvents.length ? { parent_events: { thread_id: 'sequences', events: parentEvents,
      first_event_id: parentEvents[0]!.id, last_event_id: parentEvents.at(-1)!.id } } : {}),
  };
}
const preview = (id: string): FlowerToolCallPreview => ({
  thread_id: 'sequences', turn_id: 'turn', run_id: 'run', logical_request_id: 'request',
  attempt_id: 'attempt', attempt_epoch: 0, call_id: id, name: 'apply_patch', arguments_complete: false,
  preview: { display_name: `${id}.ts`, additions: 2 },
});
async function mount(items: FlowerRuntimeCurrentItem[], previews: readonly FlowerToolCallPreview[] = [], parentEvents: readonly FlowerParentEvent[] = []) {
  await page.viewport(1280, 900);
  let latest = { ...current(items, 1, parentEvents), ...(previews.length ? { tool_call_previews: previews } : {}) };
  const seed = applyFlowerRuntimeCurrentView(thread({ thread_id: 'sequences', title: 'Tool sequences', messages: [] }), latest);
  const peer = thread({ thread_id: 'peer', title: 'Another conversation' });
  const values: FlowerLiveStreamEnvelope[] = [{ schema_version: 2, kind: 'ready', summaries: [seed, peer] }];
  let wake: (() => void) | undefined;
  const root = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [applyFlowerRuntimeCurrentView(seed, latest), peer]),
    loadThread: vi.fn(async id => id === peer.thread_id ? liveBootstrap(peer) : { thread: applyFlowerRuntimeCurrentView(seed, latest), current: latest }),
    async *connectLiveStream({ signal }) {
      const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
      try { while (!signal.aborted) { const value = values.shift(); if (value) yield value; else await new Promise<void>(resolve => { wake = resolve; }); } }
      finally { signal.removeEventListener('abort', abort); }
    },
  });
  root.style.height = '780px';
  await waitFor(() => Boolean(root.querySelector('[data-thread-id="sequences"] button')));
  root.querySelector<HTMLButtonElement>('[data-thread-id="sequences"] button')!.click();
  await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id]')));
  await waitFor(() => root.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
  return { root, push(next: FlowerRuntimeCurrentItem[], nextPreviews: readonly FlowerToolCallPreview[] = []) {
    latest = { ...current(next, latest.view_version + 1), ...(nextPreviews.length ? { tool_call_previews: nextPreviews } : {}) };
    values.push({ schema_version: 2, kind: 'thread.batch', thread_id: 'sequences', current: latest }); wake?.();
  } };
}
const row = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-flower-activity-item-id="${id}"]`)!;
const group = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-flower-tool-row-identity="${id}"]`)
  ?? row(root, id).closest<HTMLElement>('.flower-tool-sequence-node')!;
const toggle = (root: HTMLElement, id: string) => group(root, id).querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
const collapsed = (root: HTMLElement, id: string) => group(root, id).querySelector('.flower-tool-sequence-viewport')!.getAttribute('aria-hidden') === 'true';
function expectConnectorBetweenNodes(previousNode: HTMLElement, nextNode: HTMLElement) {
  const previousIcon = previousNode.querySelector('.flower-activity-inline-icon, .flower-parent-event-avatar')!.getBoundingClientRect();
  const nextIcon = nextNode.querySelector('.flower-activity-inline-icon, .flower-parent-event-avatar')!.getBoundingClientRect();
  const content = previousNode.querySelector('.flower-tool-sequence-content')!;
  const rect = content.getBoundingClientRect();
  const connector = getComputedStyle(content, '::after');
  const connectorX = rect.left + Number.parseFloat(connector.left);
  const start = rect.top + Number.parseFloat(connector.top);
  const end = rect.bottom - Number.parseFloat(connector.bottom);
  expect(connector.width).toBe('1px');
  expect(Number.parseFloat(connector.height)).toBeGreaterThan(0);
  expect(connector.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(Number.parseFloat(connector.opacity)).toBeGreaterThan(0.5);
  expect(connector.content).not.toBe('none');
  expect(Math.abs(connectorX - (previousIcon.left + previousIcon.width / 2))).toBeLessThan(1);
  expect(Math.abs(start - (previousIcon.bottom + 4))).toBeLessThan(1);
  expect(Math.abs(end - (nextIcon.top - 4))).toBeLessThan(1);
}
function expectConnectorBetween(root: HTMLElement, previousID: string, nextID: string) {
  expectConnectorBetweenNodes(group(root, previousID), group(root, nextID));
}
afterEach(async () => { document.getSelection()?.removeAllRanges(); await media.emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' }); });

describe('consecutive tools in the shared Flower surface', () => {
  it.each([
    ['success', 'reduce'], ['success', 'no-preference'],
    ['running', 'reduce'], ['running', 'no-preference'],
  ] as const)('opens a collapsed %s sequence at its latest tool with %s motion', async (status, reducedMotion) => {
    await media.emulateMediaPreferences({ reducedMotion });
    const initial = Array.from({ length: 40 }, (_, index) => tool(`latest-${index}`, index === 39 ? status : 'success'));
    const later = status === 'success' ? [item('later-prose', 'assistant'), tool('later-first'), tool('later-last')] : [];
    const { root, push } = await mount([...initial, ...later]);
    const header = toggle(root, 'latest-0');
    const viewport = group(root, 'latest-0').querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    if (status === 'running') header.click();
    await waitFor(() => group(root, 'latest-0').dataset.state === 'closed');
    header.click();
    await waitFor(() => group(root, 'latest-0').dataset.state === 'open');
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight * 2);
    await expect.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);

    viewport.scrollTop = 40;
    viewport.dispatchEvent(new Event('scroll'));
    expect(viewport.hasAttribute('data-flower-reading-paused')).toBe(true);
    header.click();
    await waitFor(() => group(root, 'latest-0').dataset.state === 'closed');
    const updated = [...initial.slice(0, -1), tool('latest-39'), tool('latest-40', status)];
    push([...updated, ...later]);
    await waitFor(() => Boolean(row(root, 'latest-40')));
    header.click();
    await waitFor(() => group(root, 'latest-0').dataset.state === 'open');
    await expect.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);
    expect(viewport.hasAttribute('data-flower-reading-paused')).toBe(false);
    const latestRow = row(root, 'latest-40').getBoundingClientRect();
    expect(latestRow.top).toBeGreaterThanOrEqual(viewport.getBoundingClientRect().top - 1);
    expect(latestRow.bottom).toBeLessThanOrEqual(viewport.getBoundingClientRect().bottom + 1);
    if (status === 'running') {
      push([...updated.slice(0, -1), tool('latest-40'), tool('latest-41', 'running')]);
      await waitFor(() => Boolean(row(root, 'latest-41')));
      await expect.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);
    }
  });

  it('bounds a long expanded sequence and scrolls its complete contents below the reachable header', async () => {
    const { root } = await mount(Array.from({ length: 98 }, (_, index) => tool(`bounded-${index}`)));
    const header = toggle(root, 'bounded-0');
    const viewport = group(root, 'bounded-0').querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    expect(viewport).not.toBeNull();
    expect(viewport.clientHeight).toBeGreaterThan(100);
    expect(viewport.clientHeight).toBeLessThanOrEqual(384);
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight * 2);
    expect(viewport.contains(row(root, 'bounded-97'))).toBe(true);
    expect(viewport.contains(header)).toBe(false);
    const top = header.getBoundingClientRect().top;
    const transcript = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    const transcriptTop = transcript.scrollTop;
    const wheel = commands as unknown as { wheelScrollRegion: (request: { regionSelector: string; deltaY: number }) => Promise<{ before: number; after: number }> };
    await expect.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);
    const result = await wheel.wheelScrollRegion({ regionSelector: '.flower-tool-sequence-scroll', deltaY: -300 });
    expect(result.after).toBeLessThan(result.before);
    expect(transcript.scrollTop).toBe(transcriptTop);
    expect(header.getBoundingClientRect().top).toBe(top);
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event('scroll'));
    const savedTop = viewport.scrollTop;
    expect(row(root, 'bounded-97').getBoundingClientRect().bottom).toBeLessThanOrEqual(viewport.getBoundingClientRect().bottom + 1);
    header.click();
    await waitFor(() => collapsed(root, 'bounded-97'));
    header.click();
    await waitFor(() => group(root, 'bounded-97').dataset.state === 'open');
    await expect.poll(() => viewport.scrollTop).toBe(savedTop);
    expect(viewport.clientHeight).toBeLessThanOrEqual(384);
    await page.screenshot({ element: root, path: '__screenshots__/flower-bounded-tools.png' });
    await page.viewport(390, 600);
    root.style.height = '520px';
    await expect.poll(() => viewport.clientHeight).toBeLessThanOrEqual(transcript.clientHeight * 0.65 + 1);
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
    await page.screenshot({ element: root, path: '__screenshots__/flower-bounded-tools-narrow.png' });
  });

  it('bounds long thinking independently and preserves the reading position while content streams', async () => {
    const longThought = Array.from({ length: 100 }, (_, index) => `Reasoning line ${index}.`).join('\n');
    const initial = [tool('before-thinking'), { ...item('bounded-thinking', 'thinking', longThought), live: true }];
    const { root, push } = await mount(initial);
    const thinking = root.querySelector<HTMLElement>('.flower-thinking-disclosure')!;
    thinking.querySelector<HTMLButtonElement>('.flower-thinking-toggle')!.click();
    const content = thinking.querySelector<HTMLElement>('.flower-thinking-content')!;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(content.clientHeight).toBeGreaterThan(100);
    expect(content.clientHeight).toBeLessThanOrEqual(320);
    expect(content.scrollHeight).toBeGreaterThan(content.clientHeight * 2);
    content.scrollTop = 40;
    content.dispatchEvent(new Event('scroll'));
    push([initial[0], { ...initial[1], text: `${longThought}\nNew reasoning.` }]);
    await waitFor(() => content.textContent?.includes('New reasoning.') === true);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(content.scrollTop).toBe(40);
    content.focus();
    expect(document.activeElement).toBe(content);
    await page.screenshot({ element: root, path: '__screenshots__/flower-bounded-thinking.png' });
    content.scrollTop = content.scrollHeight;
    content.dispatchEvent(new Event('scroll'));
    push([initial[0], { ...initial[1], text: `${longThought}\nLatest reasoning.\nMore reasoning.` }]);
    await waitFor(() => content.textContent?.includes('Latest reasoning.') === true);
    await expect.poll(() => content.scrollHeight - content.clientHeight - content.scrollTop).toBeLessThanOrEqual(1);
  });

  it('follows new active tool rows only while the list stays at its tail', async () => {
    const initial = Array.from({ length: 30 }, (_, index) => tool(`live-${index}`));
    const { root, push } = await mount([...initial, tool('live-30', 'running')]);
    const viewport = root.querySelector<HTMLElement>('.flower-tool-sequence-scroll')!;
    await expect.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);
    viewport.scrollTop = 40;
    viewport.dispatchEvent(new Event('scroll'));
    const header = toggle(root, 'live-0');
    push([...initial, tool('live-30'), tool('live-31', 'running')]);
    await waitFor(() => Boolean(row(root, 'live-31')));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(viewport.scrollTop).toBe(40);
    expect(toggle(root, 'live-0')).toBe(header);
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event('scroll'));
    push([...initial, tool('live-30'), tool('live-31'), tool('live-32', 'running')]);
    await waitFor(() => Boolean(row(root, 'live-32')));
    await expect.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);
  });

  it.each([false, true])('preserves selected thinking and focused controls when grouping grows (standard DOM moves: %s)', async standardMoves => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'moveBefore');
    if (standardMoves) Object.defineProperty(Element.prototype, 'moveBefore', { configurable: true, value: undefined });
    try {
      const initial = [tool('stable-first')];
      const { root, push } = await mount(initial);
      const firstRow = row(root, 'stable-first');
      firstRow.querySelector<HTMLButtonElement>('.flower-activity-inline-button')!.focus();
      const focused = document.activeElement;
      push([...initial, item('selected-thought', 'thinking', 'Keep this selected thought.')]);
      await waitFor(() => Boolean(root.querySelector('[data-flower-thinking-id="selected-thought:block:0"]')));
      expect(row(root, 'stable-first')).toBe(firstRow);
      expect(document.activeElement).toBe(focused);
      const thinking = root.querySelector<HTMLElement>('[data-flower-thinking-id="selected-thought:block:0"]')!;
      thinking.querySelector<HTMLButtonElement>('.flower-thinking-toggle')!.click();
      const text = thinking.querySelector('.flower-thinking-content-body')!.firstChild!;
      const selection = document.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(text);
      selection.removeAllRanges();
      selection.addRange(range);
      push([...initial, item('selected-thought', 'thinking', 'Keep this selected thought.'), tool('stable-third')]);
      await waitFor(() => Boolean(row(root, 'stable-third')));
      expect(selection.toString()).toBe('Keep this selected thought.');
      expect(root.querySelector('[data-flower-thinking-id="selected-thought:block:0"]')).toBe(thinking);
    } finally {
      if (descriptor) Object.defineProperty(Element.prototype, 'moveBefore', descriptor);
      else Reflect.deleteProperty(Element.prototype, 'moveBefore');
    }
  });

  it('folds web search, goal activity and thinking after the final tool into one styled sequence', async () => {
    const { root } = await mount([
      tool('search', 'success', 'web_search', 'web_search'),
      tool('goal', 'success', 'goal', 'structured'),
      item('after-goal', 'thinking'),
    ]);
    const sequenceToggle = toggle(root, 'search');
    const thinking = root.querySelector<HTMLElement>('.flower-thinking-disclosure')!;
    const sequenceKey = group(root, 'search').dataset.flowerSequence;
    expect(sequenceToggle.textContent).toContain('2 tool calls');
    expect(sequenceToggle.textContent).toContain('1 thinking segment');
    expect(group(root, 'goal').dataset.flowerSequence).toBe(sequenceKey);
    expect(thinking.closest<HTMLElement>('.flower-tool-sequence-node')?.dataset.flowerSequence).toBe(sequenceKey);
    expect(thinking.querySelector('.flower-activity-inline-icon svg.lucide-brain')).not.toBeNull();
    expect(getComputedStyle(thinking.querySelector('.flower-activity-inline-title')!).fontSize).toBe('12px');
    expect(getComputedStyle(thinking.querySelector('.flower-activity-inline-title')!).lineHeight).toBe('18px');

    sequenceToggle.click();
    await waitFor(() => collapsed(root, 'search'));
    expect(row(root, 'search').closest('[inert]')).not.toBeNull();
    expect(row(root, 'goal').closest('[inert]')).not.toBeNull();
    expect(thinking.closest('[inert]')).not.toBeNull();
  });

  it('folds SubAgent activity and surrounding thinking in the shared sequence', async () => {
    const { root } = await mount([
      item('leading-thought', 'thinking'),
      tool('subagent-a', 'success', 'subagents', 'subagent_operation'),
      item('middle-thought', 'thinking'),
      tool('subagent-b', 'success', 'subagents', 'subagent_operation'),
      item('trailing-thought', 'thinking'),
    ]);
    const ids = ['leading-thought', 'subagent-a', 'middle-thought', 'subagent-b', 'trailing-thought'];
    const nodes = [...root.querySelectorAll<HTMLElement>('.flower-tool-sequence-node[data-flower-sequence]')];
    expect(nodes).toHaveLength(ids.length);
    expect(root.querySelectorAll('.flower-tool-sequence-toggle')).toHaveLength(1);
    expect(root.querySelectorAll('.flower-tool-sequence-node[data-flower-sequence] .flower-thinking-disclosure')).toHaveLength(3);
    expect(nodes.map(node => node.dataset.flowerSequence)).toEqual(Array(5).fill(nodes[0].dataset.flowerSequence));
    expect(nodes.map(node => node.dataset.flowerSequenceStart)).toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(nodes.map(node => node.dataset.flowerSequenceEnd)).toEqual(['false', 'false', 'false', 'false', 'true']);
    for (let index = 0; index < nodes.length - 1; index += 1) expectConnectorBetweenNodes(nodes[index]!, nodes[index + 1]!);
    for (let index = 1; index < nodes.length; index += 1) {
      const previous = nodes[index - 1]!.querySelector('.flower-tool-sequence-content')!;
      expect(Math.abs(nodes[index]!.getBoundingClientRect().top - previous.getBoundingClientRect().bottom)).toBeLessThan(1);
    }
    const sequenceToggle = nodes[0]!.querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
    expect(sequenceToggle.textContent).toContain('2 tool calls');
    sequenceToggle.click();
    await waitFor(() => collapsed(root, 'subagent-a'));
    expect(nodes.every(node => node.querySelector('.flower-tool-sequence-viewport')?.hasAttribute('inert'))).toBe(true);
  });

  it('folds canonical SubAgent report and completion events with their surrounding tools', async () => {
    const items = [item('before', 'thinking'), tool('spawn', 'success', 'subagents', 'subagent_operation'),
      item('after', 'thinking'), tool('read', 'success', 'subagent_events', 'subagent')];
    const event = (id: string, kind: FlowerParentEvent['kind'], canonical_ordinal: number): FlowerParentEvent => ({
      id, canonical_ordinal, parent_thread_id: 'sequences', parent_turn_id: 'turn',
      source_thread_id: `child-${id}`, source_turn_id: `child-turn-${id}`, source_run_id: `child-run-${id}`,
      source_entry_id: `child-entry-${id}`, kind, received_at: '2026-10-21T10:00:00Z', admitted: true,
      ...(kind === 'report' ? { message: 'A completed research update.' } : {}),
    });
    const events = [event('report', 'report', 5), event('completed', 'completed', 6), event('failed', 'failed', 7)];
    const { root } = await mount(items, [], events);
    const sequenceNodes = [...root.querySelectorAll<HTMLElement>('.flower-tool-sequence-node[data-flower-sequence]')];
    const reportNode = root.querySelector<HTMLElement>('[data-parent-event="report"]')!.closest<HTMLElement>('.flower-tool-sequence-node')!;
    const completeNode = root.querySelector<HTMLElement>('[data-parent-event="completed"]')!.closest<HTMLElement>('.flower-tool-sequence-node')!;
    expect(sequenceNodes).toHaveLength(7);
    expect(reportNode.dataset.flowerSequence).toBe(group(root, 'spawn').dataset.flowerSequence);
    expect(completeNode.dataset.flowerSequence).toBe(group(root, 'spawn').dataset.flowerSequence);
    for (let index = 0; index < sequenceNodes.length - 1; index += 1) expectConnectorBetweenNodes(sequenceNodes[index]!, sequenceNodes[index + 1]!);
    const sequenceToggle = sequenceNodes[0]!.querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
    expect(sequenceToggle.textContent).toContain('3 subtask updates');
    expect(sequenceToggle.textContent).toContain('1 failed subtask update');
    sequenceToggle.click();
    await waitFor(() => collapsed(root, 'spawn'));
    expect(root.querySelector('[data-parent-event="report"]')!.closest('[inert]')).not.toBeNull();
    expect(root.querySelector('[data-parent-event="completed"]')!.closest('[inert]')).not.toBeNull();
  });

  it('keeps active inline thinking closed and shimmers both thinking and SubAgent waits', async () => {
    const baseWait = tool('wait', 'running', 'subagents', 'subagent_operation');
    const waiting: FlowerRuntimeCurrentItem = { ...baseWait, activity: { ...baseWait.activity!, presentation: {
      ...baseWait.activity!.presentation!, payload: { action: 'wait', requested_count: 2 },
    } } };
    const activeThinking = { ...item('active-thinking', 'thinking'), live: true };
    const { root } = await mount([tool('before'), activeThinking, waiting, tool('after')]);
    const thinking = root.querySelector<HTMLElement>('[data-flower-thinking-id="active-thinking:block:0"]')!;
    expect(thinking.dataset.flowerThinkingView).toBe('collapsed');
    expect(thinking.querySelector('.flower-thinking-toggle')?.textContent).toContain('Thinking...');
    expect(thinking.querySelector('[data-floe-progress-shimmer="text"]')?.textContent).toContain('Thinking...');
    expect(row(root, 'wait').querySelector('[data-floe-progress-shimmer="text"]')?.textContent).not.toBe('');
  });

  it('folds older tools and bounded thinking, keeping prose and outside thinking visible', async () => {
    const { root } = await mount([item('leading', 'thinking'), tool('a'), item('inside', 'thinking'), tool('b'), item('outside', 'thinking'),
      item('progress', 'assistant', 'A useful progress report.'), tool('failure', 'error'), tool('c'), tool('d', 'running')]);
    const firstToggle = root.querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
    expect(firstToggle.textContent).toContain('2 tool calls');
    expect(firstToggle.textContent).toContain('3 thinking segments');
    expect(collapsed(root, 'a')).toBe(true);
    expect(collapsed(root, 'b')).toBe(true);
    expect(collapsed(root, 'failure')).toBe(false);
    expect(toggle(root, 'failure').textContent).toContain('3 tool calls');
    expect(toggle(root, 'failure').textContent).toContain('1 failed tool call');
    expect(toggle(root, 'failure').textContent).toContain('1 running');
    expect(row(root, 'failure').closest('[inert]')).toBeNull();
    expect(root.querySelector('[data-flower-message-id="progress"]')?.closest('[inert]')).toBeNull();
    const thoughts = [...root.querySelectorAll<HTMLElement>('.flower-thinking-disclosure')];
    expect(thoughts.map(node => Boolean(node.closest<HTMLElement>('.flower-tool-sequence-node')?.dataset.flowerSequence))).toEqual([true, true, true]);
    expect(thoughts[1].closest('[inert]')).not.toBeNull();
    expect(thoughts[2].closest('[inert]')).not.toBeNull();
    expect(thoughts[1].querySelector('.flower-activity-inline-icon svg.lucide-brain')?.getAttribute('stroke-width')).toBe('1.7');
    firstToggle.click();
    await waitFor(() => firstToggle.closest('.flower-tool-sequence-node')?.getAttribute('data-state') === 'open');
    expect(collapsed(root, 'b')).toBe(false);
    expect(row(root, 'a').getBoundingClientRect().height).toBe(32);
    expect(Math.abs(row(root, 'b').getBoundingClientRect().top - thoughts[1].getBoundingClientRect().bottom)).toBeLessThan(1);
    expect(getComputedStyle(group(root, 'a').querySelector('.flower-tool-sequence-content')!, '::after').width).toBe('1px');
    expect(getComputedStyle(row(root, 'a').querySelector('.flower-activity-inline-title')!).fontSize).toBe('12px');
    expect(getComputedStyle(row(root, 'a').querySelector('.flower-activity-inline-title')!).lineHeight).toBe('18px');
    await page.screenshot({ element: root, path: '__screenshots__/flower-tools-mixed.png' });
  });

  it('folds failed and successful calls together, and colors failure text and glyph with the warning palette', async () => {
    const { root } = await mount([tool('failed', 'error'), tool('succeeded'), item('progress', 'assistant'), tool('c'), tool('d')]);
    const failedGroup = group(root, 'failed');
    expect(toggle(root, 'failed').textContent).toContain('2 tool calls');
    expect(toggle(root, 'failed').textContent).toContain('1 failed tool call');
    expect(collapsed(root, 'failed')).toBe(true);
    expect(row(root, 'failed').closest('[inert]')).not.toBeNull();
    toggle(root, 'failed').click();
    await waitFor(() => failedGroup.getAttribute('data-state') === 'open');
    const failedRow = row(root, 'failed');
    const failedGlyph = failedRow.querySelector<HTMLElement>('.flower-tool-icon')!;
    const failedTitle = failedRow.querySelector<HTMLElement>('.flower-activity-inline-title')!;
    const failedButton = failedRow.querySelector<HTMLElement>('.flower-activity-inline-button')!;
    const warning = document.createElement('span'); warning.style.color = 'var(--redeven-status-warning)'; root.append(warning);
    const warningForeground = document.createElement('span'); warningForeground.style.color = 'var(--redeven-status-warning-foreground)'; root.append(warningForeground);
    expect(failedRow.querySelectorAll('.flower-activity-inline-icon svg')).toHaveLength(1);
    expect(getComputedStyle(failedGlyph).color).toBe(getComputedStyle(warning).color);
    expect(getComputedStyle(failedTitle).color).toBe(getComputedStyle(warningForeground).color);
    expect(getComputedStyle(failedButton).color).toBe(getComputedStyle(warningForeground).color);
    expect(getComputedStyle(failedTitle).fontSize).toBe('12px');
    warningForeground.remove();
    warning.remove();
    failedRow.querySelector<HTMLButtonElement>('.flower-activity-inline-button')!.click();
    await waitFor(() => Boolean(failedRow.querySelector('[data-state="open"]')));
    expect(failedRow.textContent).toContain('failed failed');
  });

  it('keeps running and completed commands on the same connected row geometry across empty live messages', async () => {
    const initial = [tool('a'), tool('b'), emptyLiveText('live-empty-1'), tool('c', 'running'), emptyLiveText('live-empty-2'), tool('d', 'running')];
    const { root, push } = await mount(initial);
    const button = toggle(root, 'a');
    const groupKey = group(root, 'a').dataset.flowerSequence;
    const runningRows = [row(root, 'c'), row(root, 'd')];
    const runningTops = runningRows.map(entry => entry.getBoundingClientRect().top);
    expect(button.textContent).toContain('4 tool calls');
    expect(button.textContent).toContain('2 running');
    expect(group(root, 'c').dataset.flowerSequence).toBe(groupKey);
    expect(group(root, 'd').dataset.flowerSequence).toBe(groupKey);
    expect(Math.abs(row(root, 'c').getBoundingClientRect().top - row(root, 'b').getBoundingClientRect().bottom)).toBeLessThan(1);
    const completedLine = row(root, 'b').querySelector<HTMLElement>('.flower-activity-inline-button')!.getBoundingClientRect();
    const runningLine = row(root, 'c').querySelector<HTMLElement>('.flower-activity-inline-button')!.getBoundingClientRect();
    expect(Math.abs(completedLine.height - runningLine.height)).toBeLessThan(1);
    expect(getComputedStyle(row(root, 'b').querySelector('.flower-activity-inline-icon')!).width).toBe('16px');
    expect(getComputedStyle(row(root, 'c').querySelector('.flower-activity-inline-icon')!).width).toBe('16px');
    expectConnectorBetween(root, 'b', 'c');
    expectConnectorBetween(root, 'c', 'd');
    await page.screenshot({ element: root, path: '__screenshots__/flower-tools-running-connector.png' });
    for (const id of ['b', 'live-empty-1', 'c', 'live-empty-2']) {
      expect(root.querySelector(`[data-flower-row-message-id="${id}"]`)?.closest('.flower-turn-row')
        ?.getAttribute('data-flower-sequence-continues')).toBe('true');
    }

    push([tool('a'), tool('b'), emptyLiveText('live-empty-1'), tool('c'), emptyLiveText('live-empty-2'), tool('d', 'success')]);
    await waitFor(() => row(root, 'd').classList.contains('flower-activity-inline-row-success'));
    expect(group(root, 'd').dataset.flowerSequence).toBe(groupKey);
    expect(row(root, 'c')).toBe(runningRows[0]);
    expect(row(root, 'd')).toBe(runningRows[1]);
    expect(Math.abs(row(root, 'c').getBoundingClientRect().top - runningTops[0])).toBeLessThan(1);
    expect(Math.abs(row(root, 'd').getBoundingClientRect().top - runningTops[1])).toBeLessThan(1);
    expect(Math.abs(row(root, 'c').getBoundingClientRect().top - row(root, 'b').getBoundingClientRect().bottom)).toBeLessThan(1);
    expectConnectorBetween(root, 'b', 'c');
    expectConnectorBetween(root, 'c', 'd');
  });

  it('keeps the argument-generation preview row compact and connected as it becomes a running tool', async () => {
    const { root, push } = await mount([tool('a'), tool('b')], [preview('c')]);
    const pendingRow = root.querySelector<HTMLElement>('[data-flower-tool-call-id="c"]')!;
    const pendingNode = pendingRow.closest<HTMLElement>('.flower-tool-sequence-node')!;
    const groupKey = pendingNode.dataset.flowerSequence;
    expect(pendingRow.classList.contains('flower-activity-inline-row-generating')).toBe(true);
    expect(root.querySelector('.flower-tool-sequence-toggle')?.textContent).toContain('3 tool calls');
    expect(Math.abs(pendingRow.getBoundingClientRect().top - row(root, 'b').getBoundingClientRect().bottom)).toBeLessThan(1);
    const previewIcon = pendingRow.querySelector('.flower-activity-inline-icon')!.getBoundingClientRect();
    const previousIcon = row(root, 'b').querySelector('.flower-activity-inline-icon')!.getBoundingClientRect();
    const previousConnector = group(root, 'b').querySelector('.flower-tool-sequence-content')!;
    const previousConnectorStyle = getComputedStyle(previousConnector, '::after');
    const previousConnectorRect = previousConnector.getBoundingClientRect();
    expect(previousConnectorStyle.width).toBe('1px');
    expect(Math.abs(previousConnectorRect.top + Number.parseFloat(previousConnectorStyle.top) - (previousIcon.bottom + 4))).toBeLessThan(1);
    expect(Math.abs(previousConnectorRect.bottom - Number.parseFloat(previousConnectorStyle.bottom) - (previewIcon.top - 4))).toBeLessThan(1);

    push([tool('a'), tool('b'), tool('c', 'running')]);
    await waitFor(() => Boolean(row(root, 'c')));
    expect(group(root, 'c').dataset.flowerSequence).toBe(groupKey);
    expect(Math.abs(row(root, 'c').getBoundingClientRect().top - row(root, 'b').getBoundingClientRect().bottom)).toBeLessThan(1);
    expectConnectorBetween(root, 'b', 'c');
  });

  it.each(['reduce', 'no-preference'] as const)('retains manual group and tool detail state through updates and navigation with %s motion', async reducedMotion => {
    await media.emulateMediaPreferences({ reducedMotion });
    const initial = [tool('a'), tool('b')];
    const { root, push } = await mount(initial);
    const original = row(root, 'a');
    const button = original.querySelector<HTMLButtonElement>('.flower-activity-inline-button')!;
    button.click();
    await waitFor(() => button.getAttribute('aria-expanded') === 'true');
    button.focus();
    toggle(root, 'a').click();
    await waitFor(() => group(root, 'a').getAttribute('data-state') === 'closed');
    expect(document.activeElement).toBe(toggle(root, 'a'));
    push([...initial, item('progress', 'assistant'), tool('c'), tool('d')]);
    await waitFor(() => Boolean(toggle(root, 'c')));
    expect(collapsed(root, 'a')).toBe(true);
    toggle(root, 'a').click();
    await waitFor(() => group(root, 'a').getAttribute('data-state') === 'open');
    expect(row(root, 'a')).toBe(original);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    root.querySelector<HTMLButtonElement>('[data-thread-id="peer"] button')!.click();
    await waitFor(() => !root.querySelector('[data-flower-activity-item-id="a"]'));
    root.querySelector<HTMLButtonElement>('[data-thread-id="sequences"] button')!.click();
    await waitFor(() => Boolean(root.querySelector('[data-flower-activity-item-id="a"]')));
    expect(collapsed(root, 'a')).toBe(false);
    expect(row(root, 'a').querySelector('.flower-activity-inline-button')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('supports native keyboard folding and forced colors without losing focus', async () => {
    await media.emulateMediaPreferences({ reducedMotion: 'reduce', forcedColors: 'active' });
    const { root } = await mount([tool('a'), tool('b')]);
    const button = toggle(root, 'a');
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(collapsed(root, 'a')).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(getComputedStyle(button).outlineStyle).toBe('solid');
    const controlled = button.getAttribute('aria-controls')!.split(' ');
    expect(controlled).toHaveLength(2);
    expect(controlled.every(id => document.getElementById(id)?.hasAttribute('inert'))).toBe(true);
    await userEvent.keyboard(' ');
    expect(collapsed(root, 'a')).toBe(false);
  });

  it('reveals a waiting call and restores focus when a two-call group dissolves', async () => {
    const { root, push } = await mount([tool('a'), tool('b', 'running')]);
    const button = toggle(root, 'a'); button.focus(); button.click();
    push([tool('a'), { ...tool('b'), activity: { ...tool('b').activity!, status: 'waiting' } }]);
    await waitFor(() => !root.querySelector('.flower-tool-sequence-toggle'));
    await waitFor(() => row(root, 'b').closest('[inert]') === null);
    expect(document.activeElement).toBe(row(root, 'a').querySelector('.flower-activity-inline-button'));
  });

  it('respects a manually closed group when more consecutive tools arrive', async () => {
    const initial = [tool('a'), tool('b')];
    const { root, push } = await mount(initial);
    toggle(root, 'a').focus();
    toggle(root, 'a').click();
    push([...initial, tool('c')]);
    await waitFor(() => toggle(root, 'a').textContent?.includes('3 tool calls') === true);
    expect(collapsed(root, 'a')).toBe(true);
    expect(collapsed(root, 'c')).toBe(true);
    expect(document.activeElement).toBe(toggle(root, 'a'));
  });

  it.each(['selection', 'focus', 'gesture', 'manual detail'] as const)('protects %s while an existing sequence becomes older', async protection => {
    const initial = [tool('a'), item('thinking', 'thinking'), tool('b')];
    const { root, push } = await mount(initial);
    const node = row(root, 'a');
    if (protection === 'selection') {
      const range = document.createRange(); range.selectNodeContents(node.querySelector('.flower-activity-inline-title')!);
      document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
    } else if (protection === 'focus') node.querySelector<HTMLButtonElement>('button')!.focus();
    else if (protection === 'gesture') node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9 }));
    else {
      node.querySelector<HTMLButtonElement>('.flower-activity-inline-button')!.click();
      (document.activeElement as HTMLElement | null)?.blur();
    }
    push([...initial, item('progress', 'assistant'), tool('c'), tool('d')]);
    await waitFor(() => Boolean(toggle(root, 'c')));
    expect(collapsed(root, 'a')).toBe(false);
    expect(row(root, 'a')).toBe(node);
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9 }));
  });

  it('keeps a selected trailing thought expanded when its sequence becomes older', async () => {
    const initial = [tool('a'), item('trailing', 'thinking', 'Keep this selected thought.')];
    const { root, push } = await mount(initial);
    const thinking = root.querySelector<HTMLElement>('.flower-thinking-disclosure')!;
    thinking.querySelector<HTMLButtonElement>('button')!.click();
    await waitFor(() => Boolean(thinking.querySelector('.flower-thinking-content')));
    const content = thinking.querySelector('.flower-thinking-content')!;
    const range = document.createRange(); range.selectNodeContents(content);
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
    push([...initial, item('progress', 'assistant', 'A new visible progress message.'), tool('c'), tool('d')]);
    await waitFor(() => Boolean(toggle(root, 'c')));
    expect(root.querySelector('.flower-thinking-disclosure')).toBe(thinking);
    expect(thinking.closest('[inert]')).toBeNull();
    expect(document.getSelection()?.toString()).toContain('Keep this selected thought.');
    expect(toggle(root, 'a').getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the last visible prose anchored when an offscreen older sequence folds', async () => {
    const initial = [tool('a'), tool('b'), item('progress', 'assistant', 'Current progress. '.repeat(90))];
    const { root, push } = await mount(initial);
    const viewport = root.querySelector<HTMLElement>('.flower-chat-transcript')!;
    viewport.style.height = '110px'; viewport.style.maxHeight = '110px'; viewport.style.flex = 'none';
    await waitFor(() => viewport.scrollHeight > viewport.clientHeight + 50);
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -30, bubbles: true }));
    const prose = root.querySelector<HTMLElement>('[data-flower-message-id="progress"]')!;
    viewport.scrollTop = prose.offsetTop + 15;
    viewport.dispatchEvent(new Event('scroll'));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const top = prose.getBoundingClientRect().top;
    push([...initial, tool('c')]);
    await waitFor(() => collapsed(root, 'a'));
    await waitFor(() => group(root, 'a').getAttribute('data-state') === 'closed');
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(Math.abs(prose.getBoundingClientRect().top - top)).toBeLessThan(2);
  });

  it.each(['paper', 'porcelain-dark', 'hc-light'] as const)('uses existing %s theme contrast and keeps active tools bright at narrow widths', async theme => {
    const html = document.documentElement;
    const previous = ['style', 'class', 'data-floe-shell-theme'].map(key => [key, html.getAttribute(key)] as const);
    const preset = builtInShellThemePresets.find(value => value.name === theme)!;
    try {
      html.classList.toggle('dark', preset.mode === 'dark');
      html.classList.toggle('light', preset.mode === 'light');
      html.dataset.floeShellTheme = theme;
      for (const [key, value] of Object.entries(preset.semanticTokens ?? {})) if (value) html.style.setProperty(key, value);
      const { root } = await mount([tool('a'), tool('b', 'running')]);
      await page.viewport(390, 844);
      const quiet = row(root, 'a').querySelector<HTMLElement>('.flower-activity-inline-button')!;
      const running = row(root, 'b').querySelector<HTMLElement>('.flower-activity-inline-button')!;
      const reference = document.createElement('span'); reference.style.color = 'var(--foreground)'; root.append(reference);
      expect(getComputedStyle(quiet).color).not.toBe(getComputedStyle(running).color);
      expect(getComputedStyle(running).color).toBe(getComputedStyle(reference).color);
      expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
      await page.screenshot({ element: root, path: `__screenshots__/flower-tools-${theme}.png` });
    } finally {
      for (const [key, value] of previous) { if (value === null) html.removeAttribute(key); else html.setAttribute(key, value); }
    }
  });
});
