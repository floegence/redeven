import { batch, createComputed, createMemo, createSignal, onCleanup, untrack, type Accessor } from 'solid-js';
import { readPresentationValue } from './presentationIdentity';
import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import type { HistoryReadingGap } from './historyReadingWindow';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import type { FlowerTurnProcess, FlowerTurnProcessProjection } from './flowerTurnPresentation';
import type { FlowerToolSequenceMember, FlowerToolSequenceProjection } from './flowerToolSequences';

// These are mounted presentation subscriptions, not another transcript. Publish
// only changed keyed values: a memo over a whole map still marks every descendant
// pending before equality is known, including all retained offscreen Markdown.
export function createFlowerKeyedSubscriptions<T>(source: Accessor<ReadonlyMap<string, T>>, equals: (a: T | undefined, b: T | undefined) => boolean = Object.is, retainRemoved = false) {
  const listeners = new Map<string, { read: Accessor<T | undefined>; write: (value: T | undefined) => void; users: number }>();
  const current = createMemo(source);
  createComputed(() => {
    const values = current();
    untrack(() => batch(() => {
      for (const [key, listener] of listeners) if (!retainRemoved || values.has(key)) listener.write(values.get(key));
    }));
  });
  return (key: string): Accessor<T | undefined> => {
    let listener = listeners.get(key);
    if (!listener) {
      const [read, set] = createSignal<T | undefined>(undefined, { equals });
      listener = { read, write: value => set(() => value), users: 0 };
      listener.write(untrack(current).get(key));
      listeners.set(key, listener);
    }
    const subscribed = listener;
    subscribed.users++;
    onCleanup(() => { if (--subscribed.users === 0) listeners.delete(key); });
    return subscribed.read;
  };
}

export function createFlowerEntrySubscriptions(entries: Accessor<readonly FlowerTimelineEntry[]>) {
  // The keyed DOM list disposes departed rows. Keep their last renderable
  // value until disposal, since synchronous publication precedes list removal.
  return createFlowerKeyedSubscriptions(() => new Map(entries().map(entry => [entry.key, entry])), Object.is, true);
}

export function createFlowerSequenceSubscriptions(projection: Accessor<FlowerToolSequenceProjection>) {
  return createFlowerKeyedSubscriptions<FlowerToolSequenceMember>(() => projection().members);
}

export function createFlowerFinalItemSubscriptions(thread: Accessor<Pick<FlowerThreadSnapshot, 'thread_id' | 'turns'> | null | undefined>) {
  const subscribe = createFlowerKeyedSubscriptions(() => {
    const current = thread();
    const items = new Map<string, true>();
    for (const turn of readPresentationValue(current?.turns ?? [])) if (turn.final_boundary_complete) {
      for (const id of turn.final_item_ids) items.set(JSON.stringify([current!.thread_id, turn.turn_id, turn.run_id, id]), true);
    }
    return items;
  });
  return (threadID: string | undefined, turnID: string | undefined, runID: string | undefined, itemID: string) =>
    subscribe(JSON.stringify([threadID, turnID, runID, itemID]));
}

type ProcessRow = Readonly<{
  turnID: string;
  process: boolean;
  disclosure: FlowerTurnProcess['disclosure'];
  interleavedInputs: boolean;
  historical: boolean;
  outcome?: NonNullable<FlowerTurnProcess['turn']>['outcome'];
  summary?: FlowerTurnProcess;
}>;
export function createFlowerProcessSubscriptions(projection: Accessor<FlowerTurnProcessProjection>) {
  return createFlowerKeyedSubscriptions<ProcessRow>(() => new Map([...projection().rows].map(([key, group]) => [key, {
    turnID: group.turnID, process: group.processMembers.has(key), disclosure: group.disclosure,
    interleavedInputs: group.interleavedInputs, historical: Boolean(group.turn?.ended_at),
    outcome: group.terminalKey === key ? group.turn?.outcome : undefined,
    summary: group.summaryKey === key && group.turn?.kind !== 'context_compaction' ? group : undefined,
  }])), (a, b) => a === b || Boolean(a && b && a.turnID === b.turnID && a.process === b.process
    && a.disclosure === b.disclosure && a.interleavedInputs === b.interleavedInputs
    && a.historical === b.historical && a.outcome === b.outcome && a.summary === b.summary));
}

export function createFlowerMembershipSubscriptions(keys: Accessor<ReadonlySet<string>>) {
  return createFlowerKeyedSubscriptions(() => new Map([...keys()].map(key => [key, true] as const)));
}

export function createFlowerTurnEndSubscriptions(thread: Accessor<Pick<FlowerThreadSnapshot, 'thread_id' | 'turns'> | null | undefined>) {
  const subscribe = createFlowerKeyedSubscriptions(() => {
    const current = thread();
    return new Map(readPresentationValue(current?.turns ?? []).map(turn => [JSON.stringify([current!.thread_id, turn.turn_id]), turn.ended_at]));
  });
  return (threadID: string | undefined, turnID: string | undefined) => subscribe(JSON.stringify([threadID, turnID]));
}

// One bounded index per reading window; mounted rows subscribe only to their
// own gap. Streaming text never invalidates every row's gap lookup.
export function createFlowerHistoryGapSubscriptions(entries: Accessor<readonly FlowerTimelineEntry[]>, gaps: Accessor<readonly HistoryReadingGap[]>) {
  type Gap = Readonly<{ gap: HistoryReadingGap; entryKey: string; nested: boolean }>;
  const current = createMemo(() => {
    const missing = new Map(gaps().map(gap => [gap.afterID, gap]));
    const result = new Map<string, Gap>();
    if (missing.size) for (const entry of entries()) {
      if (entry.type !== 'message' || result.has(entry.message.id)) continue;
      const gap = missing.get(entry.message.id);
      if (gap) result.set(entry.message.id, { gap, entryKey: entry.key,
        nested: entry.blocks.some(block => block.type === 'activity' || block.type === 'content' && block.block_type === 'thinking') });
    }
    return result;
  });
  return { subscribe: createFlowerKeyedSubscriptions(current, (a, b) => a === b || Boolean(a && b
    && a.entryKey === b.entryKey && a.nested === b.nested && a.gap.beforeID === b.gap.beforeID
    && a.gap.afterID === b.gap.afterID && a.gap.first === b.gap.first && a.gap.last === b.gap.last
    && a.gap.height === b.gap.height && a.gap.folded === b.gap.folded
    && a.gap.sequence?.turnID === b.gap.sequence?.turnID && a.gap.sequence?.runID === b.gap.sequence?.runID)),
    sequences: createMemo(() => new Map([...current().values()].filter(value => value.gap.sequence).map(value => [value.entryKey, value.gap]))),
    breaks: createMemo(() => new Set([...current().values()].map(value => value.entryKey))) };
}
