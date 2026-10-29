import { createComputed, createMemo, createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { createFlowerHistoryGapSubscriptions, createFlowerTurnEndSubscriptions, createFlowerKeyedSubscriptions, createFlowerMembershipSubscriptions, createFlowerEntrySubscriptions, createFlowerProcessSubscriptions, createFlowerFinalItemSubscriptions } from './flowerPresentationSubscriptions';
import { projectFlowerTurnProcess } from './flowerTurnPresentation';
import type { FlowerRuntimeTurn, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';

it('publishes changed rows without invalidating retained row dependency graphs', () => createRoot(dispose => {
  try {
    const row = (key: string): FlowerTimelineEntry => ({ type: 'message', key, blocks: [],
      message: { id: key, role: 'assistant', content: key, status: 'complete', created_at_ms: 1 } });
    const historical = row('history'), active = row('active');
    const [entries, setEntries] = createSignal<readonly FlowerTimelineEntry[]>([historical, active]);
    const subscribe = createFlowerEntrySubscriptions(entries);
    const history = subscribe('history'), tail = subscribe('active');
    let historyRuns = 0, tailRuns = 0;
    const historyContent = createMemo(() => { historyRuns++; return history()?.key; });
    const tailContent = createMemo(() => { tailRuns++; return tail()?.key; });
    createComputed(historyContent); createComputed(tailContent);
    for (let index = 0; index < 100; index++) setEntries([historical, row('active')]);
    expect(history()).toBe(historical);
    expect({ historyRuns, tailRuns }).toEqual({ historyRuns: 1, tailRuns: 101 });
    setEntries([row('prepended'), historical, entries()[1]]);
    expect(historyRuns).toBe(1);
    setEntries([]);
    expect(history()).toBe(historical);
    expect(tail()?.key).toBe('active');
  } finally { dispose(); }
}));

it('notifies only changed process roles while a long active turn grows', () => createRoot(dispose => {
  try {
    const row = (key: string): FlowerTimelineEntry => ({ type: 'message', key, blocks: [],
      message: { id: key, turn_id: 'turn', run_id: 'run', role: 'assistant', content: key, status: 'complete', created_at_ms: 1 } });
    const rows = Array.from({ length: 600 }, (_, i) => row('row-' + i));
    const turn: FlowerRuntimeTurn = { turn_id: 'turn', run_id: 'run', started_at: '2026-10-28T00:00:00Z', elapsed_ms: 0, waiting_ms: 0, work_duration_ms: 0,
      intermediate_item_ids: rows.map(row => row.key), final_item_ids: [], final_boundary_complete: false };
    const [projection, setProjection] = createSignal(projectFlowerTurnProcess(rows, [turn], ['turn']));
    const subscribe = createFlowerProcessSubscriptions(projection);
    const retained = subscribe('row-300');
    let runs = 0;
    createComputed(() => { retained(); runs++; });
    const next = row('next');
    setProjection(projectFlowerTurnProcess([...rows, next], [{ ...turn, intermediate_item_ids: [...turn.intermediate_item_ids!, next.key] }], ['turn'], projection()));
    expect(runs).toBe(1);
    expect(retained()?.process).toBe(true);
    setProjection(projectFlowerTurnProcess([...rows, next], [{ ...turn, intermediate_item_ids: [], final_item_ids: [next.key], final_boundary_complete: true,
      outcome: 'completed', ended_at: '2026-10-28T00:00:01Z', elapsed_ms: 1000, work_duration_ms: 1000 }], [], projection()));
    expect(runs).toBe(2);
    expect(retained()).toMatchObject({ process: false, historical: true });
  } finally { dispose(); }
}));

it('tracks final answer ownership across run changes and explicit clearing', () => createRoot(dispose => {
  try {
    const turn: FlowerRuntimeTurn = { turn_id: 'turn', run_id: 'run', started_at: '2026-10-28T00:00:00Z', elapsed_ms: 0, waiting_ms: 0, work_duration_ms: 0,
      intermediate_item_ids: [], final_item_ids: [], final_boundary_complete: false };
    const [thread, setThread] = createSignal({ thread_id: 'thread', turns: [turn] } as Pick<FlowerThreadSnapshot, 'thread_id' | 'turns'>);
    const subscribe = createFlowerFinalItemSubscriptions(thread);
    const first = subscribe('thread', 'turn', 'run', 'answer');
    const next = subscribe('thread', 'turn', 'next', 'answer');
    expect(first()).toBeUndefined();
    setThread({ ...thread(), turns: [{ ...turn, final_boundary_complete: true, final_item_ids: ['answer'] }] });
    expect(first()).toBe(true); expect(next()).toBeUndefined();
    setThread({ ...thread(), turns: [{ ...turn, run_id: 'next', final_boundary_complete: true, final_item_ids: ['answer'] }] });
    expect(first()).toBeUndefined(); expect(next()).toBe(true);
    setThread({ ...thread(), turns: [] });
    expect(next()).toBeUndefined();
  } finally { dispose(); }
}));

it('keeps mounted section and membership subscribers local and releases departed owners', () => createRoot(dispose => {
  try {
    const [source, setSource] = createSignal<ReadonlyMap<string, string>>(new Map([['history', 'same'], ['tail', 'first']]));
    const subscribe = createFlowerKeyedSubscriptions(source);
    let runs = 0; let disposedRuns = 0;
    const retained = subscribe('history');
    createComputed(() => { retained(); runs++; });
    const unmount = createRoot(unmount => { const read = subscribe('tail'); createComputed(() => { read(); disposedRuns++; }); return unmount; });
    unmount();
    for (let i = 0; i < 100; i++) setSource(new Map([['history', 'same'], ['tail', String(i)]]));
    expect(runs).toBe(1); expect(disposedRuns).toBe(1);
    expect(subscribe('tail')()).toBe('99');
    const [keys, setKeys] = createSignal<ReadonlySet<string>>(new Set(['history']));
    const member = createFlowerMembershipSubscriptions(keys)('history');
    let membershipRuns = 0; createComputed(() => { member(); membershipRuns++; });
    for (let i = 0; i < 100; i++) setKeys(new Set(['history', String(i)]));
    expect(membershipRuns).toBe(1);
    setKeys(new Set<string>()); expect(member()).toBeUndefined(); expect(membershipRuns).toBe(2);
  } finally { dispose(); }
}));

it('keeps historical answer time subscribers stable while active turn facts change', () => createRoot(dispose => {
  try {
    const history: FlowerRuntimeTurn = { turn_id: 'history', run_id: 'run', started_at: '2026-10-28T00:00:00Z', ended_at: '2026-10-28T00:00:01Z',
      elapsed_ms: 1000, waiting_ms: 0, work_duration_ms: 1000, final_item_ids: ['answer'], final_boundary_complete: true };
    const [thread, setThread] = createSignal({ thread_id: 'thread', turns: [history] });
    const end = createFlowerTurnEndSubscriptions(thread)('thread', 'history');
    let runs = 0; createComputed(() => { end(); runs++; });
    for (let i = 0; i < 100; i++) setThread({ thread_id: 'thread', turns: [history, { ...history, turn_id: 'active', elapsed_ms: i }] });
    expect(runs).toBe(1); expect(end()).toBe(history.ended_at);
    setThread({ thread_id: 'thread', turns: [{ ...history, ended_at: '2026-10-28T00:00:02Z' }] });
    expect(runs).toBe(2); expect(end()).toBe('2026-10-28T00:00:02Z');
  } finally { dispose(); }
}));

it('keeps gap subscriptions local across 600 retained rows and streaming updates', () => createRoot(dispose => {
  try {
    const row = (id: string): FlowerTimelineEntry => ({ type: 'message', key: id, blocks: [],
      message: { id, role: 'assistant', content: id, status: 'complete', created_at_ms: 1 } });
    const rows = Array.from({ length: 600 }, (_, i) => row(String(i)));
    const [entries, setEntries] = createSignal<readonly FlowerTimelineEntry[]>(rows);
    const gap = { beforeID: '10', afterID: '11', first: 11, last: 40, height: 44, folded: true };
    const [gaps, setGaps] = createSignal([gap]);
    const index = createFlowerHistoryGapSubscriptions(entries, gaps);
    const counts = Array.from({ length: 600 }, () => 0);
    rows.forEach((entry, i) => { const read = index.subscribe(entry.key); createComputed(() => { read(); counts[i]++; }); });
    for (let i = 0; i < 100; i++) setEntries([...rows, row('tail-' + i)]);
    expect(counts.every(count => count === 1)).toBe(true);
    expect([...index.breaks()]).toEqual(['11']);
    setGaps([{ ...gap, height: 60 }]);
    expect(counts[11]).toBe(2);
    expect(counts.filter(count => count > 1)).toHaveLength(1);
    setEntries([]);
    expect(index.subscribe('11')()).toBeUndefined();
  } finally { dispose(); }
}));
