import type { FlowerHistoryWindow, FlowerRuntimeCurrentItem } from './contracts/flowerSurfaceContracts';

// A matching immutable entry proves the preceding active-path prefix. Retain
// only that confirmed prefix when an incoming window changes its source leaf.
export function historyItemConfirmsPrefix(incoming: FlowerRuntimeCurrentItem, cached: FlowerRuntimeCurrentItem): boolean {
  return !incoming.live && !cached.live && incoming.id === cached.id && incoming.kind === cached.kind
    && incoming.turn_id === cached.turn_id && incoming.run_id === cached.run_id && incoming.ordinal === cached.ordinal
    && incoming.canonical_ordinal !== undefined && incoming.canonical_ordinal === cached.canonical_ordinal;
}

export function historyWindowForItems(window: FlowerHistoryWindow | undefined, retained: readonly FlowerHistoryWindow[], items: readonly FlowerRuntimeCurrentItem[]): FlowerHistoryWindow | undefined {
  if (!window || !items.length) return window;
  const first = items[0].id, last = items.at(-1)!.id;
  const windows = [window, ...retained];
  return { ...window, first_item_id: first, last_item_id: last,
    has_before: windows.find(value => value.first_item_id === first)?.has_before ?? true,
    has_after: windows.find(value => value.last_item_id === last)?.has_after ?? true };
}
