import { createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { observeFlowerSequenceDisclosure } from './flowerSequenceDisclosure';
import type { FlowerToolSequence } from './flowerToolSequences';

const group = (key: string): FlowerToolSequence => ({ key, countsComplete: true, nodeKeys: [key], entryKeys: [key],
  toolCount: 1, failedCount: 0, uncertainCount: 0, failedSubagentEventCount: 0, thinkingCount: 0,
  subagentEventCount: 0, runningCount: 0, followingContentKeys: [key + ':prose'], disclosure: 'automatic' });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

it('observes only changed mounted groups during long-turn growth and title motion', async () => {
  let dispose!: () => void;
  const history = Array.from({ length: 600 }, (_, i) => group('history-' + i));
  const [groups, setGroups] = createSignal(new Map(history.map(value => [value.key, value])));
  const [revealing, setRevealing] = createSignal<ReadonlySet<string>>(new Set());
  const [pending, setPending] = createSignal<ReadonlyMap<string, { nodeKey: string; motionKey: string }>>(new Map());
  const [animate, setAnimate] = createSignal(true);
  const calls = new Map<string, boolean[]>();
  createRoot(stop => { dispose = stop; observeFlowerSequenceDisclosure({ groups, revealing, pending, animate,
    observe: (value, motion) => { const values = calls.get(value.key) ?? []; values.push(motion); calls.set(value.key, values); },
  }); });
  try {
    await settle(); expect(calls.get('history-300')).toEqual([true]);
    for (let i = 0; i < 100; i++) {
      const tail = group('tail');
      setGroups(new Map([...history, tail].map(value => [value.key, value])));
      setRevealing(new Set(['tail'])); await settle();
      setRevealing(new Set<string>()); await settle();
    }
    expect(calls.get('history-300')).toEqual([true]);
    const before = calls.get('tail')!.length;
    setPending(new Map([['tail:prose', { nodeKey: 'tail', motionKey: 'parent' }]]));
    await settle(); expect(calls.get('tail')).toHaveLength(before);
    setPending(new Map()); await settle(); expect(calls.get('tail')).toHaveLength(before + 1);
    expect(calls.get('history-300')).toEqual([true]);
    setAnimate(false); await settle(); expect(calls.get('history-300')).toEqual([true, false]);
    const removed = calls.get('tail')!.length;
    setGroups(new Map(history.map(value => [value.key, value])));
    setRevealing(new Set(['tail'])); await settle(); setRevealing(new Set<string>()); await settle();
    expect(calls.get('tail')).toHaveLength(removed);
  } finally { dispose(); }
});
