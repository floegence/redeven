import { describe, expect, it, vi } from 'vitest';
import { HistorySourceChangedError, prepareHistoryTurn } from './historyTurnPreparation';
import { recoverableHistoryRead } from './historyReadRecovery';
import type { FlowerHistoryRequest, FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView } from './contracts/flowerSurfaceContracts';

const item = (ordinal: number, turn = 'turn'): FlowerRuntimeCurrentItem => ({ id: String(ordinal), ordinal, turn_id: turn, run_id: turn, kind: 'tool' });
const page = (items: FlowerRuntimeCurrentItem[], before = true, leaf = 'leaf', after = false) => ({ current: {
  thread_id: 'thread', view_version: 1, activity: 'idle', items,
  turns: [...new Set(items.map(item => item.turn_id!))].map(turn_id => ({
    turn_id, run_id: turn_id, started_at: '2026-10-26T00:00:00Z', ended_at: '2026-10-26T00:01:00Z',
    outcome: 'completed', elapsed_ms: 60000, waiting_ms: 0, work_duration_ms: 60000,
    final_item_ids: [], final_boundary_complete: true,
  })),
  window: { leaf_id: leaf, first_item_id: items[0]?.id, last_item_id: items.at(-1)?.id, has_before: before, has_after: after },
} as FlowerRuntimeCurrentView });

describe('historical turn preparation', () => {
  it('prepares active sealed segments once and reuses their confirmed prefix after append', async () => {
    const items = Array.from({ length: 80 }, (_, index) => ({ ...item(index + 1), canonical_ordinal: index + 1 }));
    const first = page(items.slice(-24));
    first.current = { ...first.current, activity: 'active', turn_id: 'turn', turns: [] };
    const read = vi.fn(async (input: FlowerHistoryRequest) => {
      const end = Number(input.anchor_id) - 1;
      return page(items.slice(Math.max(0, end - input.limit!), end), end > input.limit!, 'leaf', true);
    });
    const prepared = await prepareHistoryTurn(first, read, new AbortController().signal);
    expect(read.mock.calls.map(call => call[0].limit)).toEqual([16, 32, 64]);
    expect(prepared.flatMap(value => value.current.items!)).toHaveLength(56);
    const grown = page([...items.slice(-23), { ...item(81), canonical_ordinal: 81 }], true, 'new-leaf');
    read.mockClear();
    expect(await prepareHistoryTurn(grown, read, new AbortController().signal, items, first.current.window)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
  it('still fully prepares a completed preceding turn beside active sealed segments', async () => {
    const first = page([item(3, 'previous'), item(4), item(5)]);
    first.current = { ...first.current, activity: 'active', turn_id: 'turn', turns: [{
      turn_id: 'previous', run_id: 'previous', started_at: '2026-10-26T00:00:00Z',
      ended_at: '2026-10-26T00:01:00Z', outcome: 'completed', elapsed_ms: 60000, waiting_ms: 0,
      work_duration_ms: 60000, final_item_ids: [], final_boundary_complete: true,
    }] };
    const read = vi.fn(async () => page([{ ...item(1, 'previous'), kind: 'user' }, item(2, 'previous')], false, 'leaf', true));
    const result = await prepareHistoryTurn(first, read, new AbortController().signal);
    expect(read).toHaveBeenCalledOnce();
    expect(result.flatMap(value => value.current.items?.map(item => item.id))).toEqual(['1', '2']);
  });
  it('does not classify foreign thread identity as a recoverable source advance', async () => {
    const foreign = page([item(1)], false);
    foreign.current = { ...foreign.current, thread_id: 'foreign' };
    const error = await prepareHistoryTurn(page([item(6)]), async () => foreign, new AbortController().signal).catch(value => value);
    expect(error.message).toContain('Flower contract error:');
    expect(recoverableHistoryRead(error)).toBe(false);
  });
  it('starts with a small boundary read and grows bounded pages only for genuinely long work', async () => {
    const items = Array.from({ length: 400 }, (_, index) => item(index + 1));
    items[0] = { ...items[0], kind: 'user' };
    const read = vi.fn(async (input: FlowerHistoryRequest) => {
      const end = Number(input.anchor_id) - 1;
      return page(items.slice(Math.max(0, end - input.limit!), end), end > input.limit!, 'leaf', true);
    });
    const pages = await prepareHistoryTurn(page(items.slice(-2)), read, new AbortController().signal);
    expect(read.mock.calls[0][0].limit).toBe(16);
    expect(read.mock.calls.map(call => call[0].limit)).toEqual([16, 32, 64, 128, 150, 150]);
    expect(new Set(pages.flatMap(value => value.current.items!.map(item => item.id))).size).toBe(398);
  });
  it('fills a sparse middle and missing trailing boundary before publication', async () => {
    const first = page([{ ...item(2), kind: 'user' }, item(5)], true, 'leaf', true);
    const read = vi.fn().mockResolvedValueOnce(page([item(3), item(4)]))
      .mockResolvedValueOnce(page([item(6), item(7, 'next')]));
    const result = await prepareHistoryTurn(first, read, new AbortController().signal);
    expect(read.mock.calls.map(call => call[0])).toEqual([
      { anchor_id: '5', direction: 'before', limit: 16 }, { anchor_id: '5', direction: 'after', limit: 16 },
    ]);
    expect(result.flatMap(value => value.current.items?.map(item => item.id))).toEqual(['3', '4', '6']);
    expect(recoverableHistoryRead(new HistorySourceChangedError())).toBe(true);
  });
  it('reuses a fully prepared same-leaf turn without a network read', async () => {
    const cached = [{ ...item(2), kind: 'user' as const }, item(3), item(4), item(5)];
    const first = page([item(3)], true, 'leaf', true);
    const read = vi.fn();
    expect(await prepareHistoryTurn(first, read, new AbortController().signal, cached, page(cached).current.window)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
  it.each([
    { live: true }, { canonical_ordinal: undefined }, { canonical_ordinal: 30 },
    { id: 'other' }, { ordinal: 30 }, { turn_id: 'other' }, { run_id: 'other' }, { kind: 'thinking' as const },
  ])('does not reuse a changed-leaf prefix without matching sealed identity: %j', async change => {
    const cached = [{ ...item(1), kind: 'user' as const, canonical_ordinal: 1 },
      { ...item(2), canonical_ordinal: 2 }, { ...item(3), canonical_ordinal: 3, ...change }];
    const first = page([{ ...item(3), canonical_ordinal: 3 }], true, 'new-leaf');
    const read = vi.fn(async () => page(cached.slice(0, 2), false, 'new-leaf', true));
    const result = await prepareHistoryTurn(first, read, new AbortController().signal, cached, page(cached).current.window);
    expect(read).toHaveBeenCalledOnce();
    expect(result.flatMap(value => value.current.items?.map(item => item.id))).toEqual(['1', '2']);
  });
  it('confirms only the shared prefix and reads an unconfirmed suffix after a branch change', async () => {
    const cached = [1, 2, 3, 4, 5].map(ordinal => ({ ...item(ordinal), canonical_ordinal: ordinal }));
    const first = page([cached[2]], true, 'fork', true);
    const read = vi.fn(async () => page([{ ...item(4), id: 'fork-final', canonical_ordinal: 8 }], true, 'fork'));
    const result = await prepareHistoryTurn(first, read, new AbortController().signal, cached, page(cached).current.window);
    expect(read).toHaveBeenCalledExactlyOnceWith({ anchor_id: '3', direction: 'after', limit: 16 });
    expect(result.flatMap(value => value.current.items?.map(item => item.id))).toEqual(['fork-final']);
  });
  it('fills missing islands inside a confirmed cached prefix', async () => {
    const cached = [1, 3, 4].map(ordinal => ({ ...item(ordinal), canonical_ordinal: ordinal }));
    const first = page([cached[2]], true, 'new-leaf');
    const read = vi.fn(async () => page([{ ...item(2), canonical_ordinal: 2 }], true, 'new-leaf', true));
    const result = await prepareHistoryTurn(first, read, new AbortController().signal, cached, page(cached).current.window);
    expect(read).toHaveBeenCalledExactlyOnceWith({ anchor_id: '3', direction: 'before', limit: 16 });
    expect(result.flatMap(value => value.current.items?.map(item => item.id))).toEqual(['2']);
  });
  it('prepares a sequence across multiple bounded pages without publishing a partial preceding turn', async () => {
    const read = vi.fn().mockResolvedValueOnce(page([item(4), item(5)])).mockResolvedValueOnce(page([item(1, 'previous'), item(2), item(3)]));
    const result = await prepareHistoryTurn(page([item(6), item(7)]), read, new AbortController().signal);
    expect(read.mock.calls.map(call => call[0])).toEqual([
      { anchor_id: '6', direction: 'before', limit: 16 }, { anchor_id: '4', direction: 'before', limit: 32 },
    ]);
    expect(result.flatMap(value => value.current.items?.map(item => item.id))).toEqual(['4', '5', '2', '3']);
  });
  it('does not scan beyond a user boundary or prepare live drafts', async () => {
    const read = vi.fn();
    for (const first of [{ ...item(1), kind: 'user' as const }, { ...item(6), live: true }]) {
      expect(await prepareHistoryTurn(page([first]), read, new AbortController().signal)).toEqual([]);
    }
    expect(read).not.toHaveBeenCalled();
  });
  it('rejects source changes, repeated pages and cancellation without publishing any staged items', async () => {
    for (const response of [page([item(1)], false, 'different'), page([item(6)])]) {
      await expect(prepareHistoryTurn(page([item(6)]), vi.fn(async () => response), new AbortController().signal)).rejects.toThrow();
    }
    const controller = new AbortController();
    const read = vi.fn(async () => { controller.abort(); return page([item(1)], false); });
    await expect(prepareHistoryTurn(page([item(6)]), read, controller.signal)).rejects.toThrow();
  });
  it('rejects foreign threads, missing ordinals and conflicting canonical items', async () => {
    const foreign = page([item(1)], false);
    foreign.current = { ...foreign.current, thread_id: 'foreign' };
    const conflicting = page([{ ...item(3), id: 'different' }, item(4)]);
    for (const response of [foreign, page([item(1), item(3)]), conflicting]) {
      const first = page([{ ...item(2), kind: 'user' }, item(3), item(5)]);
      await expect(prepareHistoryTurn(first, vi.fn(async () => response), new AbortController().signal)).rejects.toThrow();
    }
  });
});
