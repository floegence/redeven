import type { FlowerHistoryRequest, FlowerHistoryWindow, FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';

export type PreparedHistoryPage = Readonly<{ current: FlowerRuntimeCurrentView; thread: FlowerThreadSnapshot }>;
type WindowPage = Readonly<{ current: FlowerRuntimeCurrentView; window?: FlowerHistoryWindow }>;

export class HistorySourceChangedError extends Error {
  readonly code = 'history_source_changed';
  constructor() { super('Historical source changed during turn preparation.'); }
}

// Exact reading interests may contain islands. Resolve both boundaries and all
// internal gaps of every affected sealed turn before exposing group counts.
export async function prepareHistoryTurn<T extends WindowPage>(
  first: T, read: (input: FlowerHistoryRequest) => Promise<T>, signal: AbortSignal,
  cached: readonly FlowerRuntimeCurrentItem[] = [], cachedWindow?: FlowerHistoryWindow,
): Promise<readonly T[]> {
  const window = first.current.window ?? first.window;
  if (!window?.leaf_id) return [];
  const initial = first.current.items ?? [];
  const targetTurns = new Set(initial.filter(item => !item.live && item.turn_id).map(item => item.turn_id));
  const known = new Map<number, FlowerRuntimeCurrentItem>();
  if (cachedWindow?.leaf_id === window.leaf_id) for (const item of cached) known.set(item.ordinal, item);
  for (const item of initial) known.set(item.ordinal, item);
  let end = !window.has_after ? initial.at(-1)?.ordinal : undefined;
  if (cachedWindow?.leaf_id === window.leaf_id && !cachedWindow.has_after && cached.length) end = Math.max(end ?? 0, ...cached.map(item => item.ordinal));
  const pages: T[] = [];
  for (const turnID of targetTurns) {
    // Most boundary fragments are short. Avoid hydrating 150 unrelated items
    // to discover a nearby user boundary; long turns grow to the normal cap.
    const limits = { before: 16, after: 16 };
    while (true) {
      signal.throwIfAborted();
      const members = [...known.values()].filter(item => item.turn_id === turnID).sort((a, b) => a.ordinal - b.ordinal);
      if (!members.length || members.some(item => item.live)) break;
      const leading = members[0], trailing = members.at(-1)!;
      let edge: FlowerRuntimeCurrentItem | undefined;
      let direction: 'before' | 'after' = 'before';
      if (leading.ordinal > 1 && leading.kind !== 'user' && !known.has(leading.ordinal - 1)) edge = leading;
      if (!edge) for (let i = 1; i < members.length; i++) {
        if (members[i].ordinal > members[i - 1].ordinal + 1) {
          for (let ordinal = members[i - 1].ordinal + 1; ordinal < members[i].ordinal; ordinal++) {
            if (!known.has(ordinal)) { edge = members[i]; break; }
          }
          if (edge) break;
        }
      }
      if (!edge && trailing.ordinal !== end && !known.has(trailing.ordinal + 1)) { edge = trailing; direction = 'after'; }
      if (!edge) break;
      const page = await read({ anchor_id: edge.id, direction, limit: limits[direction] });
      limits[direction] = Math.min(150, limits[direction] * 2);
      signal.throwIfAborted();
      const nextWindow = page.current.window ?? page.window;
      if (page.current.thread_id !== first.current.thread_id || nextWindow?.leaf_id !== window.leaf_id) throw new HistorySourceChangedError();
      const values = page.current.items ?? [];
      if (values.some((item, index) => !Number.isSafeInteger(item.ordinal) || item.ordinal < 1
        || index > 0 && item.ordinal !== values[index - 1].ordinal + 1
        || known.has(item.ordinal) && known.get(item.ordinal)!.id !== item.id)) {
        throw new Error('Flower contract error: historical turn page has inconsistent source order.');
      }
      if (!values.length || values.some(item => direction === 'before' ? item.ordinal >= edge!.ordinal : item.ordinal <= edge!.ordinal)
        || !values.some(item => !known.has(item.ordinal))) throw new Error('Flower contract error: historical turn preparation made no progress.');
      for (const item of values) known.set(item.ordinal, item);
      if (!nextWindow.has_after) end = Math.max(end ?? 0, values.at(-1)!.ordinal);
      const relevant = values.filter(item => targetTurns.has(item.turn_id));
      if (relevant.length) {
        const ids = new Set(relevant.map(item => item.id));
        const current = { ...page.current, items: relevant, turns: page.current.turns?.filter(turn => targetTurns.has(turn.turn_id)).map(turn => ({
          ...turn, intermediate_item_ids: turn.intermediate_item_ids?.filter(id => ids.has(id)), final_item_ids: turn.final_item_ids.filter(id => ids.has(id)),
        })), window: { ...nextWindow, first_item_id: relevant[0].id, last_item_id: relevant.at(-1)!.id,
          has_before: nextWindow.has_before || relevant[0].id !== values[0].id,
          has_after: nextWindow.has_after || relevant.at(-1)!.id !== values.at(-1)!.id } };
        pages.push({ ...page, current, window: current.window });
      }
    }
  }
  return pages;
}

export function historyWindowForItems(window: FlowerHistoryWindow | undefined, retained: readonly FlowerHistoryWindow[], items: readonly FlowerRuntimeCurrentItem[]): FlowerHistoryWindow | undefined {
  if (!window || !items.length) return window;
  const first = items[0].id, last = items.at(-1)!.id;
  const windows = [window, ...retained];
  return { ...window, first_item_id: first, last_item_id: last,
    has_before: windows.find(value => value.first_item_id === first)?.has_before ?? true,
    has_after: windows.find(value => value.last_item_id === last)?.has_after ?? true };
}
