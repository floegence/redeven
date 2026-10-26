import { describe, expect, it, vi } from 'vitest';
import { HistorySourceChangedError, prepareHistoryTurn } from './historyTurnPreparation';
import { recoverableHistoryRead } from './historyReadRecovery';
import type { FlowerHistoryRequest, FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView } from './contracts/flowerSurfaceContracts';

const item = (ordinal: number, turn = 'turn'): FlowerRuntimeCurrentItem => ({ id: String(ordinal), ordinal, turn_id: turn, run_id: turn, kind: 'tool' });
const page = (items: FlowerRuntimeCurrentItem[], before = true, leaf = 'leaf', after = false) => ({ current: {
  thread_id: 'thread', view_version: 1, activity: 'idle', items,
  window: { leaf_id: leaf, first_item_id: items[0]?.id, last_item_id: items.at(-1)?.id, has_before: before, has_after: after },
} as FlowerRuntimeCurrentView });

describe('historical turn preparation', () => {
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
