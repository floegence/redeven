import type { FlowerHistoryWindow, FlowerRuntimeCurrentItem, FlowerRuntimeTurn } from './contracts/flowerSurfaceContracts';

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

// Canonical pages are samples, not live interests. Unsettled tools and active
// output must enter the existing bounded observer before becoming visible.
export function historyItemNeedsObservation(item: FlowerRuntimeCurrentItem, turns: readonly FlowerRuntimeTurn[] = []): boolean {
  if (item.live) return true;
  if (item.kind === 'tool') return !['success', 'error', 'canceled', 'declined'].includes(String(item.activity?.status));
  if (item.kind === 'interaction') return !item.interaction?.resolved;
  return (item.kind === 'assistant' || item.kind === 'thinking') && turns.some(turn =>
    turn.turn_id === item.turn_id && turn.run_id === item.run_id && !turn.ended_at);
}
