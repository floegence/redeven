import '../index.css';
import './flower-feature.css';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import type { FlowerLiveStreamEnvelope, FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView, FlowerToolCallPreview } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, liveBootstrap, renderSurfaceWithAdapter, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const media = commands as unknown as { emulateMediaPreferences: (input: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
const titleText = '搜索 BrowserBench bilingual long-horizon browser agent 👩🏽‍💻 é 浏览器任务';
const tool = (id: string, status: 'success' | 'running' | 'error' = 'running'): FlowerRuntimeCurrentItem => ({
  id, kind: 'tool', turn_id: 'turn', run_id: 'run', ordinal: 0, activity: {
    item_id: id, tool_id: id, kind: 'tool', tool_name: 'web_search', status,
    severity: status === 'error' ? 'error' : status === 'running' ? 'normal' : 'quiet',
    needs_attention: status !== 'success', requires_approval: false,
    attention_reasons: status === 'error' ? ['error'] : status === 'running' ? ['running'] : [],
    presentation: { label: titleText, renderer: 'web_search', payload: { operation: 'search', query: titleText,
      results: status === 'success' ? [{ title: 'Result', url: 'https://example.com' }] : [] } },
  },
});
function current(items: FlowerRuntimeCurrentItem[], version = 1): FlowerRuntimeCurrentView {
  return { thread_id: 'typing', turn_id: 'turn', run_id: 'run', view_version: version, activity: 'active', run_progress: { phase: 'streaming' },
    turns: [{ turn_id: 'turn', run_id: 'run', started_at: '2026-10-22T12:00:00Z', elapsed_ms: 0, waiting_ms: 0,
      work_duration_ms: 0, final_item_ids: [], final_boundary_complete: false }],
    items: items.map((item, ordinal) => ({ ...item, ordinal: ordinal + 1 })),
  };
}
async function mount() {
  await page.viewport(1280, 900);
  let latest = current([tool('history', 'success')]);
  const seed = applyFlowerRuntimeCurrentView(thread({ thread_id: 'typing', title: 'Activity typing', messages: [] }), latest);
  const peer = thread({ thread_id: 'peer', title: 'Another conversation' });
  const values: FlowerLiveStreamEnvelope[] = [{ schema_version: 3, kind: 'ready', baseline_complete: true, summaries: [seed, peer] }];
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
  await waitFor(() => Boolean(root.querySelector('[data-thread-id="typing"] button')));
  root.querySelector<HTMLButtonElement>('[data-thread-id="typing"] button')!.click();
  await waitFor(() => Boolean(title(root, 'history')));
  await waitFor(() => root.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
  return { root, push(items: FlowerRuntimeCurrentItem[], previews: readonly FlowerToolCallPreview[] = []) {
    latest = { ...current(items, latest.view_version + 1), tool_call_previews: previews };
    values.push({ schema_version: 3, kind: 'thread.batch', thread_id: 'typing', current: latest }); wake?.();
  } };
}
const row = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-flower-activity-item-id="${id}"]`)!;
const title = (root: HTMLElement, id: string) => row(root, id)?.querySelector<HTMLElement>('.flower-activity-inline-title');
const reveals = (node: HTMLElement) => node.getAnimations().filter(animation =>
  (animation.effect as KeyframeEffect).getKeyframes().some(frame => 'clipPath' in frame));
afterEach(async () => { await media.emulateMediaPreferences({ reducedMotion: 'no-preference' }); });

it('reveals fresh titles concurrently within 360ms while keeping full text, geometry and controls', async () => {
  const { root, push } = await mount();
  expect(reveals(title(root, 'history')!)).toHaveLength(0);
  const items = [tool('history', 'success'), ...Array.from({ length: 8 }, (_, i) => tool(`new-${i}`))];
  push(items);
  await waitFor(() => Boolean(title(root, 'new-7')));
  const labels = items.slice(1).map(item => title(root, item.id)!);
  const animations = labels.map(label => reveals(label)[0]);
  expect(animations.every(Boolean)).toBe(true);
  const starts = animations.map(animation => Number(animation.startTime));
  expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(50);
  const geometry = labels.map(label => label.getBoundingClientRect().toJSON());
  animations.forEach((animation, index) => {
    animation.pause();
    const timing = animation.effect!.getTiming();
    expect(Number(timing.duration)).toBeLessThanOrEqual(360);
    expect(timing.easing?.startsWith('steps(')).toBe(true);
    animation.currentTime = Number(timing.duration) / 2;
    expect(labels[index].textContent).toContain(titleText);
    expect(getComputedStyle(labels[index]).clipPath).not.toBe('none');
    expect(getComputedStyle(labels[index]).clipPath).not.toBe('inset(0px 0% 0px 0px)');
  });
  await page.screenshot({ element: root, path: '__screenshots__/flower-activity-typing-midpoint.png' });
  animations.forEach(animation => animation.finish());
  await Promise.all(animations.map(animation => animation.finished));
  labels.forEach((label, index) => {
    const bounds = label.getBoundingClientRect();
    expect(bounds.width).toBe(geometry[index].width);
    expect(bounds.height).toBe(geometry[index].height);
    expect(label.textContent).toContain(titleText);
    expect(reveals(label)).toHaveLength(0);
  });
  push(items.map(item => tool(item.id, 'success')));
  await waitFor(() => row(root, 'new-7').dataset.flowerActivityStatus === 'success');
  const button = row(root, 'new-7').querySelector<HTMLButtonElement>('button')!;
  button.click();
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(reveals(title(root, 'new-7')!)).toHaveLength(0);
  await page.viewport(390, 850);
  const triggerBounds = button.getBoundingClientRect();
  expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
  expect(triggerBounds.right).toBeLessThanOrEqual(window.innerWidth);
});

it('does not replay history, disclosure remounts or a conversation switch', async () => {
  const { root, push } = await mount();
  push([tool('history', 'success'), tool('fresh')]);
  await waitFor(() => Boolean(title(root, 'fresh')));
  const animation = reveals(title(root, 'fresh')!)[0];
  expect(animation).toBeDefined();
  animation.finish();
  const group = root.querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
  group.click();
  group.click();
  expect(reveals(title(root, 'fresh')!)).toHaveLength(0);
  root.querySelector<HTMLButtonElement>('[data-thread-id="peer"] button')!.click();
  await waitFor(() => !title(root, 'fresh'));
  root.querySelector<HTMLButtonElement>('[data-thread-id="typing"] button')!.click();
  await waitFor(() => Boolean(title(root, 'fresh')));
  expect(reveals(title(root, 'fresh')!)).toHaveLength(0);
});

it('finishes motion immediately when reduced motion is enabled and keeps later rows static', async () => {
  const { root, push } = await mount();
  push([tool('history', 'success'), tool('fresh')]);
  await waitFor(() => Boolean(title(root, 'fresh')));
  expect(reveals(title(root, 'fresh')!)).toHaveLength(1);
  await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  await waitFor(() => reveals(title(root, 'fresh')!).length === 0);
  push([tool('history', 'success'), tool('fresh'), tool('static')]);
  await waitFor(() => Boolean(title(root, 'static')));
  expect(reveals(title(root, 'static')!)).toHaveLength(0);
});

it('reveals a new thinking label and presents failures immediately', async () => {
  const { root, push } = await mount();
  push([tool('history', 'success'), { id: 'thinking', kind: 'thinking', text: 'Consider the results.',
    live: true, turn_id: 'turn', run_id: 'run', ordinal: 2 }, tool('failed', 'error')]);
  await waitFor(() => Boolean(title(root, 'failed')));
  const thinking = root.querySelector<HTMLElement>('.flower-thinking-toggle .flower-activity-inline-title')!;
  expect(reveals(thinking)).toHaveLength(1);
  expect(reveals(title(root, 'failed')!)).toHaveLength(0);
});

it('bounds burst animations and completes naturally without queued delays', async () => {
  const { root, push } = await mount();
  push([tool('history', 'success'), ...Array.from({ length: 40 }, (_, i) => tool(`burst-${i}`, 'success'))]);
  await waitFor(() => Boolean(title(root, 'burst-39')));
  const labels = Array.from({ length: 40 }, (_, i) => title(root, `burst-${i}`)!);
  expect(labels.every(label => label.textContent!.includes(titleText))).toBe(true);
  expect(labels.flatMap(reveals).length).toBeGreaterThan(0);
  expect(labels.flatMap(reveals).length).toBeLessThanOrEqual(12);
  const animations = labels.flatMap(reveals);
  const start = performance.now();
  await Promise.all(animations.map(animation => animation.finished));
  expect(performance.now() - start).toBeLessThan(500);
  expect(labels.flatMap(reveals)).toHaveLength(0);
});

it('cancels stale text motion on updates and cleans active animations on navigation', async () => {
  const { root, push } = await mount();
  push([tool('history', 'success'), tool('fresh')]);
  await waitFor(() => Boolean(title(root, 'fresh')));
  const first = reveals(title(root, 'fresh')!)[0];
  expect(first).toBeDefined();
  first.pause();
  push([tool('history', 'success'), tool('fresh', 'error'), tool('next')]);
  await waitFor(() => Boolean(title(root, 'next')));
  expect(first.playState).toBe('idle');
  const second = reveals(title(root, 'next')!)[0];
  expect(second).toBeDefined();
  second.pause();
  root.querySelector<HTMLButtonElement>('[data-thread-id="peer"] button')!.click();
  await waitFor(() => !title(root, 'next'));
  expect(second.playState).toBe('idle');
});

it('claims argument previews once when the same call becomes canonical', async () => {
  const { root, push } = await mount();
  const preview: FlowerToolCallPreview = { thread_id: 'typing', turn_id: 'turn', run_id: 'run', logical_request_id: 'request',
    attempt_id: 'attempt', attempt_epoch: 0, call_id: 'preview', name: 'apply_patch', arguments_complete: false,
    preview: { display_name: 'src/browser.ts', additions: 2 } };
  push([tool('history', 'success')], [preview]);
  await waitFor(() => Boolean(root.querySelector('[data-flower-tool-call-id="preview"]')));
  const label = root.querySelector<HTMLElement>('[data-flower-tool-call-id="preview"] .flower-activity-inline-title')!;
  expect(reveals(label)).toHaveLength(1);
  const animation = reveals(label)[0];
  animation.pause();
  push([tool('history', 'success'), { ...tool('preview'), activity: { ...tool('preview').activity!, tool_name: 'apply_patch',
    presentation: { label: 'Edit src/browser.ts', renderer: 'patch', payload: {} } } }]);
  await waitFor(() => Boolean(title(root, 'preview')));
  expect(reveals(title(root, 'preview')!)).toHaveLength(0);
  expect(animation.playState).toBe('idle');
});

it('keeps newly received hidden rows static when their sequence is reopened', async () => {
  const { root, push } = await mount();
  push([tool('history', 'success'), tool('fresh')]);
  await waitFor(() => Boolean(title(root, 'fresh')));
  const group = root.querySelector<HTMLButtonElement>('.flower-tool-sequence-toggle')!;
  group.click();
  await waitFor(() => root.querySelector('.flower-tool-sequence-viewport')?.getAttribute('data-state') === 'closed');
  push([tool('history', 'success'), tool('fresh'), tool('hidden')]);
  await waitFor(() => group.getAttribute('aria-controls')?.split(' ').length === 3);
  expect(title(root, 'hidden')).toBeUndefined();
  group.click();
  await waitFor(() => Boolean(title(root, 'hidden')));
  expect(reveals(title(root, 'hidden')!)).toHaveLength(0);
});
