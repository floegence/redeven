import { describe, expect, it, vi } from 'vitest';
import { createHistorySequenceCompletion } from './historySequenceCompletion';
import type { FlowerHistoryPage, FlowerRuntimeCurrentItem } from './contracts/flowerSurfaceContracts';
const item = (ordinal: number): FlowerRuntimeCurrentItem => ({ id: String(ordinal), ordinal, canonical_ordinal: ordinal, kind: 'tool', turn_id: 'turn', run_id: 'run' });
const page = (...values: number[]): FlowerHistoryPage => ({ thread_id: 't', leaf_id: 'leaf', items: values.map(item), first_item_id: values.length ? String(values[0]) : undefined, last_item_id: values.length ? String(values.at(-1)) : undefined, has_before: true, has_after: true });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
describe('sequence completion ownership', () => {
  it('cancels collapse and holds the physical slot until an ignored abort settles', async () => {
    let resolve!: (value: FlowerHistoryPage) => void;
    const read = vi.fn((_input: import('./contracts/flowerSurfaceContracts').FlowerHistoryPageRequest, _signal: AbortSignal) => new Promise<FlowerHistoryPage>(done => { resolve = done; }));
    const accept = vi.fn(() => true), state = vi.fn();
    const owner = createHistorySequenceCompletion({ scope: () => 't:1', leaf: () => 'leaf', item: id => item(Number(id)), read, accept, state, yield: async () => {} });
    const demand = { key: 'g', first: '10', last: '12', before: true, after: false };
    owner.demand(demand, true); await flush();
    owner.demand(demand, false); await flush();
    expect(read.mock.calls[0][1].aborted).toBe(true);
    owner.demand(demand, true); await flush();
    expect(read).toHaveBeenCalledTimes(1);
    resolve(page(8, 9)); await flush();
    expect(accept).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(2);
    owner.dispose(); resolve(page(8, 9)); await flush();
    expect(accept).not.toHaveBeenCalled();
  });
  it('does not retry failed or nonadvancing pages until explicitly requested', async () => {
    const read = vi.fn(async () => page(10));
    const state = vi.fn();
    const owner = createHistorySequenceCompletion({ scope: () => 't:1', leaf: () => 'leaf', item: id => item(Number(id)), read, accept: () => true, state, yield: async () => {} });
    owner.demand({ key: 'g', first: '10', last: '12', before: true, after: false }, true);
    await flush(); expect(read).toHaveBeenCalledTimes(1); expect(state).toHaveBeenLastCalledWith(false, true);
    await flush(); expect(read).toHaveBeenCalledTimes(1);
    owner.retry(); await flush(); expect(read).toHaveBeenCalledTimes(2); owner.dispose();
  });
  it('discards pages after connection or document replacement', async () => {
    let resolve!: (value: FlowerHistoryPage) => void;
    const accept = vi.fn(() => true);
    let scope = 't:1';
    const owner = createHistorySequenceCompletion({ scope: () => scope, leaf: () => 'leaf', item: id => item(Number(id)),
      read: () => new Promise(done => { resolve = done; }), accept, state: () => {}, yield: async () => {} });
    owner.demand({ key: 'g', first: '10', last: '12', before: true, after: false }, true);
    await flush(); scope = 'other:2'; owner.reset(); resolve(page(8, 9)); await flush();
    expect(accept).not.toHaveBeenCalled(); owner.dispose();
  });
  it('ends an exhausted empty boundary without retries or an error notice', async () => {
    const read = vi.fn(async () => ({ ...page(), has_before: false }));
    const state = vi.fn();
    const owner = createHistorySequenceCompletion({ scope: () => 't', leaf: () => 'leaf', item: id => item(Number(id)), read, accept: () => true, state, yield: async () => {} });
    owner.demand({ key: 'g', first: '1', last: '2', before: true, after: false }, true);
    await flush(); expect(read).toHaveBeenCalledOnce(); expect(state).toHaveBeenLastCalledWith(false, false); owner.dispose();
  });
  it('times out visibly while retaining the physical slot of an abort-ignoring transport', async () => {
    vi.useFakeTimers();
    let resolve!: (value: FlowerHistoryPage) => void;
    const read = vi.fn(() => new Promise<FlowerHistoryPage>(done => { resolve = done; }));
    const state = vi.fn(), accept = vi.fn(() => true);
    const owner = createHistorySequenceCompletion({ scope: () => 't', leaf: () => 'leaf', item: id => item(Number(id)), read, accept, state, yield: async () => {} });
    try {
      owner.demand({ key: 'g', first: '10', last: '12', before: true, after: false }, true);
      await vi.advanceTimersByTimeAsync(15000);
      expect(state).toHaveBeenLastCalledWith(false, true);
      owner.retry(); await flush(); expect(read).toHaveBeenCalledOnce();
      resolve(page(8, 9)); await flush(); expect(accept).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(2);
      owner.dispose(); resolve(page(8, 9)); await flush();
    } finally { owner.dispose(); vi.useRealTimers(); }
  });
  it('resumes the current demand after a replacement document supersedes its page', async () => {
    let resolve!: (value: FlowerHistoryPage) => void;
    let document = {};
    const read = vi.fn(() => new Promise<FlowerHistoryPage>(done => { resolve = done; }));
    const accept = vi.fn(() => true);
    const owner = createHistorySequenceCompletion({ scope: () => 't', document: () => document, leaf: () => 'leaf', item: id => item(Number(id)), read, accept, state: () => {}, yield: async () => {} });
    owner.demand({ key: 'g', first: '10', last: '12', before: true, after: false }, true);
    await flush(); document = {}; resolve(page(8, 9)); await flush();
    expect(accept).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(2);
    resolve(page(8, 9)); await flush(); expect(accept).toHaveBeenCalledOnce(); owner.dispose();
  });
  it('freezes forward completion while new canonical tools keep arriving', async () => {
    const items = new Map(Array.from({ length: 10001 }, (_, i) => [String(i), item(i)]));
    let last = 0;
    const read = vi.fn(async (input: import('./contracts/flowerSurfaceContracts').FlowerHistoryPageRequest) => {
      if (!input.anchor_id) return page(10000);
      const start = Number(input.anchor_id) + 1;
      return page(...Array.from({ length: Math.min(40, 10001 - start) }, (_, i) => start + i));
    });
    const owner = createHistorySequenceCompletion({ scope: () => 't:1', leaf: () => 'leaf', item: id => items.get(id), read,
      accept(value) { last = value.items.at(-1)!.ordinal; owner.demand({ key: 'g', first: '0', last: String(last), before: false, after: true }, true); return true; },
      state: () => {}, yield: async () => {} });
    owner.demand({ key: 'g', first: '0', last: '0', before: false, after: true }, true);
    for (let i = 0; i < 260; i++) await flush();
    expect(last).toBe(10000); expect(read).toHaveBeenCalledTimes(251);
    await flush(); expect(read).toHaveBeenCalledTimes(251); owner.dispose();
  });

});
