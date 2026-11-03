import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createFlowerActivityTitleReveal } from './flowerActivityTitleReveal';
import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';

afterEach(() => vi.unstubAllGlobals());

it('settles existing reveals when motion is reduced and never replays arrivals after release', async () => {
  const animations: { cancel: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('window', { matchMedia: () => undefined });
  const node = { closest: () => null, isConnected: true, remove() {} } as unknown as HTMLElement;
  node.getClientRects = () => [{ width: 100, height: 20 }] as unknown as DOMRectList;
  node.getBoundingClientRect = () => ({ width: 100, height: 20 }) as DOMRect;
  node.animate = (() => {
    const value = { cancel: vi.fn(), play: vi.fn(), pause: vi.fn(), effect: { updateTiming: vi.fn() }, finished: new Promise(() => {}) };
    animations.push(value);
    return value;
  }) as unknown as typeof node.animate;
  let dispose!: () => void;
  let setReduced!: (value: boolean) => void;
  let append!: (key: string) => void;
  let reveal!: ReturnType<typeof createFlowerActivityTitleReveal>;
  createRoot(cleanup => {
    dispose = cleanup;
    const [entries, setEntries] = createSignal<readonly FlowerTimelineEntry[]>([]);
    const [reduced, updateReduced] = createSignal(false);
    setReduced = updateReduced;
    append = key => setEntries(previous => [...previous, { type: 'message', key,
      message: { id: key, thread_id: 'thread', turn_id: 'turn', run_id: 'run', role: 'assistant', content: '', status: 'streaming', created_at_ms: 1 },
      blocks: [{ type: 'content', key, block_index: 0, block_type: 'thinking', content: 'Working' }],
    }]);
    reveal = createFlowerActivityTitleReveal({ entries,
      thread: () => ({ thread_id: 'thread', status: 'running', current_execution: { turn_id: 'turn', run_id: 'run', status: 'running' } }) as FlowerThreadSnapshot,
      liveConfirmed: () => true, reducedMotion: reduced, restoration: () => 0, isVisible: () => true, prepareArrival: () => 0,
    });
  });
  try {
    const report = vi.fn();
    append('first'); reveal.reveal('first', node, report);
    await Promise.resolve();
    expect(animations).toHaveLength(2);
    expect(reveal.revealingEntries().size).toBe(1);
    setReduced(true);
    expect(animations.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true);
    expect(report).toHaveBeenLastCalledWith(false);
    expect(reveal.revealingEntries().size).toBe(0);
    append('during'); reveal.reveal('during', node, report);
    expect(animations).toHaveLength(2);
    setReduced(false); reveal.reveal('during', node, report);
    expect(animations).toHaveLength(2);
    append('after'); reveal.reveal('after', node, report);
    expect(animations).toHaveLength(4);
  } finally { dispose(); node.remove(); }
});

it('classifies mounted titles once without subscribing arrivals to whole-sequence disclosure changes', () => {
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('window', { matchMedia: () => undefined });
  createRoot(dispose => {
    try {
      let historicalReads = 0;
      const row = (key: string): FlowerTimelineEntry => ({ type: 'message', key,
        message: { id: key, thread_id: 'thread', turn_id: 'turn', run_id: 'run', role: 'assistant', content: '', status: 'complete', created_at_ms: 1 },
        blocks: [{ type: 'activity', key, block_index: 0, block: { type: 'activity-timeline', schema_version: 1, thread_id: 'thread', turn_id: 'turn', run_id: 'run',
          summary: { status: 'success', severity: 'quiet', needs_attention: false, total_items: 1, counts: { success: 1 } }, get items() { historicalReads++; return [{
            item_id: key, tool_id: key, kind: 'tool' as const, tool_name: 'read', status: 'success' as const, severity: 'quiet' as const,
            needs_attention: false, requires_approval: false,
          }]; } } }],
      });
      const history = Array.from({ length: 600 }, (_, index) => row('history-' + index));
      const [entries, setEntries] = createSignal<readonly FlowerTimelineEntry[]>(history);
      const [sequenceRevision, setSequenceRevision] = createSignal(0);
      const [restoration, setRestoration] = createSignal(0);
      const [live, setLive] = createSignal(true);
      let visibilityReads = 0;
      createFlowerActivityTitleReveal({ entries,
        thread: () => ({ thread_id: 'thread', status: 'running', current_execution: { turn_id: 'turn', run_id: 'run', status: 'running' } }) as FlowerThreadSnapshot,
        liveConfirmed: live, reducedMotion: () => false, restoration,
        isVisible: () => { sequenceRevision(); visibilityReads++; return true; }, prepareArrival: () => 0,
      });
      expect(historicalReads).toBe(600);
      expect(visibilityReads).toBe(0);
      const tail = row('tail');
      setEntries([...history, tail]);
      expect(visibilityReads).toBe(1);
      historicalReads = 0;
      // A fresh title remains unclaimed while sequence membership advances.
      for (let index = 1; index <= 100; index++) setSequenceRevision(index);
      expect(historicalReads).toBe(0);
      expect(visibilityReads).toBe(1);
      for (let index = 0; index < 100; index++) setEntries([...history, tail]);
      expect(historicalReads).toBe(0);
      expect(visibilityReads).toBe(1);
      // Restored/reconnected documents remain static; a later live arrival can reveal.
      setRestoration(1); setLive(false); setLive(true);
      expect(visibilityReads).toBe(1);
      setEntries([...history, tail, row('next')]);
      expect(visibilityReads).toBe(2);
      setEntries([]); historicalReads = 0;
      setSequenceRevision(101);
      expect(historicalReads).toBe(0);
      expect(visibilityReads).toBe(2);
    } finally { dispose(); }
  });
});
