import '../index.css';
import './flower-feature.css';
import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import type { FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView, FlowerThreadView } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { adapter, deferred, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const select = (root: HTMLElement, id: string) => root.querySelector<HTMLButtonElement>(`[data-thread-id="${id}"] .flower-thread-card-select-button`)!.click();
const viewport = (root: HTMLElement) => root.querySelector<HTMLElement>('.flower-chat-transcript')!;
const preparing = (root: HTMLElement) => viewport(root).dataset.flowerTailPreparing === 'true';
const bottomDistance = (root: HTMLElement) => { const node = viewport(root); return node.scrollHeight - node.clientHeight - node.scrollTop; };
const afterPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
const pendingItems = Array.from({ length: 24 }, (_, index): FlowerRuntimeCurrentItem => ({
  id: `body-${index}`, kind: 'assistant', text: 'Preview', ordinal: index + 1, turn_id: `turn-${index}`, run_id: `run-${index}`,
  body: { field: 'content', source_id: `body-${index}`, bytes: 2000, preview_bytes: 7 },
}));
const fullBody = (id: string): FlowerRuntimeCurrentItem => {
  const { body: _body, ...item } = pendingItems.find(item => item.id === id)!;
  return { ...item, text: 'Preview\n\n' + 'Complete historical paragraph.\n\n'.repeat(40) };
};

async function fixture(options: { delayedDetail?: boolean; delayedBodies?: boolean; failBody?: boolean; empty?: boolean; failDetail?: boolean; settled?: boolean; fullText?: boolean; count?: number; activeTail?: boolean; startFromPeer?: boolean } = {}) {
  await page.viewport(1280, 900);
  const target = thread({ thread_id: 'target', title: 'Target', messages: [] });
  const peer = thread({ thread_id: 'peer', title: 'Peer', messages: [{ id: 'peer-message', turn_id: 'peer-turn', role: 'assistant', content: 'Peer content', status: 'complete', created_at_ms: 1 }] });
  const items = options.empty ? [] : options.fullText ? pendingItems.slice(-(options.count ?? 2)).map(item => fullBody(item.id)) : pendingItems;
  const current: FlowerRuntimeCurrentView = { thread_id: 'target', view_version: 1, activity: 'idle', last_outcome: 'completed',
    ...(options.activeTail ? { activity: 'active' as const, turn_id: items.at(-1)!.turn_id, run_id: items.at(-1)!.run_id, run_progress: { phase: 'streaming' as const } } : {}),
    items, turns: options.settled ? items.map(item => ({
      turn_id: item.turn_id!, run_id: item.run_id!, outcome: 'completed' as const,
      started_at: '2026-10-23T12:00:00Z', ended_at: '2026-10-23T12:00:01Z', work_duration_ms: 1000, elapsed_ms: 1000, waiting_ms: 0,
      intermediate_item_ids: [], final_item_ids: [item.id], final_boundary_complete: true,
      ...(options.activeTail && item === items.at(-1) ? { outcome: undefined, ended_at: undefined, work_duration_ms: 0, elapsed_ms: 0, final_item_ids: [], final_boundary_complete: false } : {}),
    })) : [], interactions: [], queue: [],
    window: { first_item_id: items[0]?.id, last_item_id: items.at(-1)?.id, has_before: true, has_after: false } };
  const detail = deferred<FlowerThreadView>();
  const bodies = new Map<string, ReturnType<typeof deferred<FlowerRuntimeCurrentItem>>>();
  const events: string[] = [];
  const loadHistory = vi.fn(async (id: string) => {
    if (id === 'peer') return liveBootstrap(peer, 1);
    if (options.failDetail) throw new Error('Detail unavailable');
    return options.delayedDetail ? detail.promise : { thread: applyFlowerRuntimeCurrentView(target, current), current };
  });
  const loadHistoryItem = vi.fn(async (_thread: string, id: string, signal: AbortSignal) => {
    if (options.failBody) throw new Error('offline');
    if (!options.delayedBodies) return fullBody(id);
    const pending = deferred<FlowerRuntimeCurrentItem>();
    bodies.set(id, pending);
    const value = await pending.promise;
    signal.throwIfAborted();
    return value;
  });
  const root = renderSurfaceWithAdapterProps({ ...adapter(true), listThreadLiveEvents: undefined,
    listThreads: async () => [target, peer], loadHistory, loadHistoryItem,
  }, { onThreadSelectionEvent: event => events.push(`${event.value}:${event.phase}`) });
  root.style.height = '780px';
  await waitFor(() => Boolean(root.querySelector('[data-thread-id="target"] button')), 5000);
  if (options.startFromPeer) {
    select(root, 'peer');
    await waitFor(() => !preparing(root) && Boolean(root.querySelector('[data-flower-message-id="peer-message"]')));
  }
  select(root, 'target');
  await waitFor(() => loadHistory.mock.calls.some(call => call[0] === 'target'));
  return { root, loadHistory, loadHistoryItem, bodies, events,
    resolveDetail: () => detail.resolve({ thread: applyFlowerRuntimeCurrentView(target, current), current }) };
}

describe('Flower destination presentation', () => {
  it('reveals hydrated navigation with final geometry and no remaining height animation', async () => {
    const { root, bodies, loadHistoryItem } = await fixture({ delayedBodies: true, startFromPeer: true });
    await waitFor(() => loadHistoryItem.mock.calls.length === 2);
    const samples: { bottom: number; tailBottom: number; animated: number }[] = [];
    for (const [id, body] of bodies) body.resolve(fullBody(id));
    for (let frame = 0; frame < 30; frame++) {
      await afterPaint();
      if (preparing(root)) continue;
      const tail = root.querySelector<HTMLElement>('[data-flower-message-id="body-23"]')!;
      const animated = tail.getAnimations({ subtree: true }).filter(animation =>
        animation.playState === 'running' && (animation.effect as KeyframeEffect).getKeyframes().some(keyframe => 'height' in keyframe)).length;
      samples.push({ bottom: bottomDistance(root), tailBottom: tail.getBoundingClientRect().bottom, animated });
    }
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every(sample => sample.bottom <= 1 && sample.animated === 0), JSON.stringify(samples)).toBe(true);
    expect(samples.every(sample => Math.abs(sample.tailBottom - samples.at(-1)!.tailBottom) <= 1), JSON.stringify(samples)).toBe(true);
  });
  it('keeps a quick switch free of loading feedback while preserving first-paint positioning', async () => {
    const { root, resolveDetail } = await fixture({ delayedDetail: true, fullText: true, startFromPeer: true });
    const composer = root.querySelector('.flower-composer');
    await pause(70);
    expect(preparing(root)).toBe(true);
    expect(viewport(root).getAttribute('aria-busy')).toBe('true');
    expect(root.querySelector('.flower-thread-loading')).toBeNull();
    resolveDetail();
    await waitFor(() => !preparing(root));
    expect(root.querySelector('.flower-composer')).toBe(composer);
    expect(bottomDistance(root)).toBeLessThanOrEqual(1);
    await pause(220);
    expect(root.querySelector('.flower-thread-loading')).toBeNull();
  });

  it('cancels delayed feedback when another thread or New chat supersedes navigation', async () => {
    const { root, resolveDetail } = await fixture({ delayedDetail: true, startFromPeer: true });
    await pause(60);
    expect(root.querySelector('.flower-thread-loading')).toBeNull();
    select(root, 'peer');
    await waitFor(() => !preparing(root) && Boolean(root.querySelector('[data-flower-message-id="peer-message"]')));
    await pause(220);
    expect(root.querySelector('.flower-thread-loading')).toBeNull();
    select(root, 'target');
    await waitFor(() => preparing(root));
    const newChat = [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'New chat');
    expect(newChat).toBeDefined();
    newChat!.click();
    await waitFor(() => !preparing(root));
    resolveDetail();
    await pause(220);
    expect(root.querySelector('.flower-thread-loading')).toBeNull();
    expect(root.querySelector('[data-flower-message-id="body-23"]')).toBeNull();
  });

  it.each([2, 24])('positions an active tail below %i rows before paint when skipped history acquires real size', async (count) => {
    const { root, resolveDetail } = await fixture({ settled: true, fullText: true, count, activeTail: true, delayedDetail: true });
    const exposed: { top: number; height: number; bottom: number; tailTop: number; tailBottom: number }[] = [];
    const inspectPresentation = async () => {
      for (let frame = 0; frame < 24; frame++) {
        await afterPaint();
        if (preparing(root) || !root.querySelector('[data-flower-message-id="body-23"]')) continue;
        const tail = root.querySelector('.flower-turn-row:last-child')!.getBoundingClientRect();
        exposed.push({ top: viewport(root).scrollTop, height: viewport(root).scrollHeight, bottom: bottomDistance(root), tailTop: tail.top, tailBottom: tail.bottom });
      }
    };
    resolveDetail();
    await inspectPresentation();
    select(root, 'peer');
    await waitFor(() => !preparing(root) && Boolean(root.querySelector('[data-flower-message-id="peer-message"]')));
    select(root, 'target');
    await inspectPresentation();
    expect(exposed.length).toBeGreaterThan(0);
    expect(exposed.every(sample => sample.bottom <= 1), JSON.stringify(exposed)).toBe(true);
    expect(exposed.every(sample => Math.abs(sample.tailTop - exposed.at(-1)!.tailTop) <= 1
      && Math.abs(sample.tailBottom - exposed.at(-1)!.tailBottom) <= 1), JSON.stringify(exposed)).toBe(true);
  });

  it.each([2, 24])('positions %i settled full-body rows before every exposed frame on cold and cached navigation', async (count) => {
    const { root, resolveDetail, loadHistoryItem } = await fixture({ settled: true, fullText: true, count, delayedDetail: true });
    const inspectPresentation = async () => {
      const exposed: { top: number; height: number; bottom: number }[] = [];
      for (let frame = 0; frame < 24; frame++) {
        await afterPaint();
        if (preparing(root) || !root.querySelector('[data-flower-message-id="body-23"]')) continue;
        exposed.push({ top: viewport(root).scrollTop, height: viewport(root).scrollHeight, bottom: bottomDistance(root) });
      }
      expect(exposed.length).toBeGreaterThan(0);
      expect(exposed.every(sample => sample.bottom <= 1), JSON.stringify(exposed)).toBe(true);
      expect(exposed[0].top).toBeGreaterThan(0);
    };
    resolveDetail();
    await inspectPresentation();
    expect(root.querySelector('[data-flower-turn-settled="true"]')).not.toBeNull();
    select(root, 'peer');
    await waitFor(() => !preparing(root) && Boolean(root.querySelector('[data-flower-message-id="peer-message"]')));
    select(root, 'target');
    await inspectPresentation();
    expect(loadHistoryItem).not.toHaveBeenCalled();
    // Measured sections own layout skipping; preparation must not leave all
    // history laid out or restore independently estimated per-row geometry.
    const sections = [...root.querySelectorAll<HTMLElement>('[data-flower-history-section]')];
    expect(sections.length).toBeGreaterThan(0);
    expect(getComputedStyle(sections.at(-1)!).contentVisibility).toBe('visible');
    if (count === 24) {
      await expect.poll(() => getComputedStyle(sections[0]).contentVisibility).toBe('hidden');
      expect(sections[0].style.containIntrinsicBlockSize).not.toBe('');
    }
  });

  it('keeps delayed detail behind a stable loading surface until actual content can be positioned', async () => {
    const { root, resolveDetail, events } = await fixture({ delayedDetail: true });
    await waitFor(() => Boolean(root.querySelector('.flower-chat-notices .flower-thread-loading')));
    expect(preparing(root)).toBe(true);
    expect(events).not.toContain('target:content_presented');
    const loading = root.querySelector<HTMLElement>('.flower-chat-notices .flower-thread-loading');
    expect(loading).not.toBeNull();
    expect(root.querySelectorAll('.flower-thread-loading')).toHaveLength(1);
    expect(getComputedStyle(loading!).visibility).toBe('visible');
    const panel = root.querySelector('.flower-chat-notices')!.getBoundingClientRect();
    const bounds = viewport(root).getBoundingClientRect();
    expect(panel.top).toBeGreaterThanOrEqual(bounds.top);
    expect(panel.bottom).toBeLessThan(bounds.bottom);
    expect(getComputedStyle(root.querySelector('.flower-chat-notices')!).position).toBe('absolute');
    resolveDetail();
    await waitFor(() => !preparing(root) && Boolean(root.querySelector('[data-flower-message-id="body-23"]')), 5000);
    expect(bottomDistance(root)).toBeLessThanOrEqual(1);
    expect(root.querySelector('.flower-thread-loading')).toBeNull();
  });

  it('shares one feedback deadline across detail and tail-body preparation', async () => {
    const timeout = vi.spyOn(window, 'setTimeout');
    try {
      const { root, resolveDetail, bodies, loadHistoryItem } = await fixture({ delayedDetail: true, delayedBodies: true });
      const feedbackTimers = () => timeout.mock.calls.filter(call => call[1] === 200);
      expect(feedbackTimers()).toHaveLength(1);
      expect(root.querySelector('.flower-thread-loading')).toBeNull();
      resolveDetail();
      await waitFor(() => loadHistoryItem.mock.calls.length === 2);
      expect(feedbackTimers()).toHaveLength(1);
      await waitFor(() => Boolean(root.querySelector('.flower-chat-notices .flower-thread-loading')));
      expect(preparing(root)).toBe(true);
      expect(root.querySelectorAll('.flower-thread-loading')).toHaveLength(1);
      for (const [id, body] of bodies) body.resolve(fullBody(id));
      await waitFor(() => !preparing(root));
      expect(root.querySelector('.flower-thread-loading')).toBeNull();
      expect(bottomDistance(root)).toBeLessThanOrEqual(1);
    } finally {
      timeout.mockRestore();
    }
  });

  it('prioritizes destination tail bodies and exposes complete text only after positioning', async () => {
    const { root, bodies, loadHistoryItem, events } = await fixture({ delayedBodies: true });
    await waitFor(() => loadHistoryItem.mock.calls.length >= 2);
    expect(loadHistoryItem.mock.calls.slice(0, 2).map(call => call[1])).toEqual(['body-23', 'body-22']);
    expect(preparing(root)).toBe(true);
    expect(events).not.toContain('target:content_presented');
    expect(getComputedStyle(root.querySelector('.flower-transcript-stack')!).visibility).toBe('hidden');
    for (const [id, body] of bodies) body.resolve(fullBody(id));
    await waitFor(() => !preparing(root), 5000);
    expect(bottomDistance(root)).toBeLessThanOrEqual(1);
    expect(root.querySelector('[data-flower-message-id="body-23"] .flower-history-text-loading')).toBeNull();
    expect(loadHistoryItem).toHaveBeenCalledTimes(2);
    await waitFor(() => events.includes('target:content_presented'));
    // Observe subsequent rendering opportunities, including the observer's
    // delayed notifications; no hidden overscan work may start after reveal.
    for (let frame = 0; frame < 6; frame++) {
      await afterPaint();
      expect(bottomDistance(root)).toBeLessThanOrEqual(1);
      expect(loadHistoryItem).toHaveBeenCalledTimes(2);
    }
  });

  it('does not expose an intermediate destination or reread cached bodies on warm navigation', async () => {
    const { root, loadHistoryItem } = await fixture();
    await waitFor(() => !preparing(root) && Boolean(root.querySelector('[data-flower-message-id="body-23"]')));
    const count = loadHistoryItem.mock.calls.length;
    select(root, 'peer');
    await waitFor(() => !preparing(root) && Boolean(root.querySelector('[data-flower-message-id="peer-message"]')));
    select(root, 'target');
    let sawTarget = false;
    for (let frame = 0; frame < 10; frame++) {
      await afterPaint();
      if (!root.querySelector('[data-flower-message-id="body-23"]')) continue;
      sawTarget = true;
      expect(preparing(root)).toBe(false);
      expect(root.querySelector('.flower-thread-preparing')).toBeNull();
      expect(bottomDistance(root)).toBeLessThanOrEqual(1);
    }
    expect(sawTarget).toBe(true);
    expect(loadHistoryItem).toHaveBeenCalledTimes(count);
  });

  it('cancels stale body preparation without moving or replacing the newly selected conversation', async () => {
    const { root, bodies, loadHistoryItem, events } = await fixture({ delayedBodies: true });
    await waitFor(() => loadHistoryItem.mock.calls.length === 2);
    select(root, 'peer');
    await waitFor(() => !preparing(root) && Boolean(root.querySelector('[data-flower-message-id="peer-message"]')));
    expect(loadHistoryItem.mock.calls.every(call => call[2].aborted)).toBe(true);
    for (const [id, body] of bodies) body.resolve(fullBody(id));
    await afterPaint();
    expect(root.querySelector('[data-flower-message-id="body-23"]')).toBeNull();
    expect(events).not.toContain('target:content_presented');
    expect(viewport(root).scrollTop).toBe(0);
  });

  it('ignores a stale detail response after navigation supersedes its preparation', async () => {
    const { root, resolveDetail, events } = await fixture({ delayedDetail: true });
    select(root, 'peer');
    await waitFor(() => !preparing(root) && Boolean(root.querySelector('[data-flower-message-id="peer-message"]')));
    resolveDetail();
    await afterPaint();
    expect(preparing(root)).toBe(false);
    expect(root.querySelector('[data-flower-message-id="body-23"]')).toBeNull();
    expect(events).not.toContain('target:content_presented');
  });

  it('restarts canceled preparation when the same conversation is selected again', async () => {
    const { root, bodies, loadHistoryItem } = await fixture({ delayedBodies: true });
    await waitFor(() => loadHistoryItem.mock.calls.length === 2);
    const previous = [...bodies.values()];
    select(root, 'target');
    await waitFor(() => loadHistoryItem.mock.calls.slice(0, 2).every(call => call[2].aborted));
    // A transport which ignores abort keeps its physical slots until settled.
    expect(loadHistoryItem).toHaveBeenCalledTimes(2);
    previous.forEach((body, index) => body.resolve(fullBody(loadHistoryItem.mock.calls[index][1])));
    await waitFor(() => loadHistoryItem.mock.calls.length === 4);
    expect(loadHistoryItem.mock.calls.slice(0, 2).every(call => call[2].aborted)).toBe(true);
    for (const [id, body] of bodies) body.resolve(fullBody(id));
    await waitFor(() => !preparing(root));
    await afterPaint();
    expect(bottomDistance(root)).toBeLessThanOrEqual(1);
    expect(loadHistoryItem).toHaveBeenCalledTimes(4);
  });

  it('lets explicit reading input leave preparation and never forces the reader back to latest', async () => {
    const { root, loadHistoryItem } = await fixture({ delayedBodies: true });
    await waitFor(() => loadHistoryItem.mock.calls.length === 2);
    const node = viewport(root);
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
    expect(preparing(root)).toBe(false);
    for (let frame = 0; frame < 4; frame++) await afterPaint();
    expect(node.scrollTop).toBe(0);
    expect(loadHistoryItem.mock.calls.filter(call => !call[2].aborted).length).toBeLessThanOrEqual(2);
  });

  it('settles empty and failed detail into usable presentation instead of indefinite preparation', async () => {
    const empty = await fixture({ empty: true });
    await waitFor(() => !preparing(empty.root));
    expect(empty.loadHistoryItem).not.toHaveBeenCalled();
    expect(empty.root.querySelector('.flower-thread-empty')).not.toBeNull();
    const failed = await fixture({ failDetail: true });
    await waitFor(() => !preparing(failed.root));
    expect(failed.root.textContent).toContain('Conversation could not load');
    expect(failed.root.querySelector('.flower-error-actions button')).not.toBeNull();
  });

  it('does not confuse native programmatic scrolling with user input during preparation', async () => {
    const { root, bodies, loadHistoryItem } = await fixture({ delayedBodies: true });
    await waitFor(() => loadHistoryItem.mock.calls.length >= 2);
    const node = viewport(root);
    const scrolled = new Promise<boolean>(resolve => node.addEventListener('scroll', event => resolve(event.isTrusted), { once: true }));
    node.scrollTop = 0;
    expect(await scrolled).toBe(true);
    expect(preparing(root)).toBe(true);
    for (const [id, body] of bodies) body.resolve(fullBody(id));
    await waitFor(() => !preparing(root), 5000);
    expect(bottomDistance(root)).toBeLessThanOrEqual(1);
  });

  it('reveals local body failures with explicit retry and lets another selection supersede preparation', async () => {
    const failed = await fixture({ failBody: true });
    await waitFor(() => !preparing(failed.root) && Boolean(failed.root.querySelector('.flower-history-body-control[aria-busy="false"]')), 5000);
    const retry = failed.root.querySelector<HTMLButtonElement>('.flower-history-body-control button')!;
    expect(retry.textContent).toContain('Retry');
    const reads = failed.loadHistoryItem.mock.calls.length;
    retry.click();
    await waitFor(() => failed.loadHistoryItem.mock.calls.length > reads);
    expect(bottomDistance(failed.root)).toBeLessThanOrEqual(1);
    select(failed.root, 'peer');
    await waitFor(() => !preparing(failed.root) && Boolean(failed.root.querySelector('[data-flower-message-id="peer-message"]')));
    expect(preparing(failed.root)).toBe(false);
  });
});
