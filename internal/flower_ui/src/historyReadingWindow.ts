import type { FlowerHistoryRequest, FlowerHistoryWindow, FlowerRuntimeCurrentItem } from './contracts/flowerSurfaceContracts';

export const HISTORY_READING_ITEMS = 150;
// Leave space for window metadata and source growth below the canonical 512 KiB cap.
export const HISTORY_READING_BYTES = 448 * 1024;
export const HISTORY_PAGE_ITEMS = 40;
export const HISTORY_EDGE_MARGIN_PX = 960;
const itemSizes = new WeakMap<FlowerRuntimeCurrentItem, number>();
const encoder = new TextEncoder();
export function historyReadingItemBytes(item: FlowerRuntimeCurrentItem): number {
  let bytes = itemSizes.get(item);
  if (bytes === undefined) {
    // Go's JSON encoder escapes HTML and JavaScript line separators. Count
    // those bytes too; this value never includes separately hydrated bodies.
    const json = JSON.stringify(item).replace(/[<>&\u2028\u2029]/g, value => '\\u' + value.charCodeAt(0).toString(16).padStart(4, '0'));
    if (item.window_bytes !== undefined && (!Number.isSafeInteger(item.window_bytes) || item.window_bytes < 1))
      throw new Error('Invalid canonical history item byte cost.');
    bytes = Math.max(encoder.encode(json).length, item.window_bytes ?? 0) + 1;
    itemSizes.set(item, bytes);
  }
  return bytes;
}

// Edge reads acquire an adjacent page without changing the installed interest.
// The accepted selection then contains the retained interval and that page.
export function historyReadingRequest(window: FlowerHistoryWindow | undefined, geometry: Readonly<{ top: number; height: number; viewport: number }>,
  following: boolean, direction: 'before' | 'after' | undefined, accepted?: FlowerHistoryRequest): FlowerHistoryRequest | undefined {
  if (!window || geometry.viewport <= 0) return;
  if (!window.has_after && (accepted?.anchor_id || accepted?.item_ids?.length) && direction === 'after'
    && geometry.height - geometry.top - geometry.viewport <= 2) return { direction: 'before', limit: HISTORY_READING_ITEMS };
  const before = window.has_before && geometry.top < HISTORY_EDGE_MARGIN_PX;
  const after = window.has_after && geometry.height - geometry.top - geometry.viewport < HISTORY_EDGE_MARGIN_PX;
  // The latest baseline is filled before initial reveal. Opening a short tail
  // must not trigger a history traversal merely because both edges intersect.
  if (following && !window.has_after) return;
  if (direction === 'before' ? !before : direction === 'after' ? !after : !before && !after) return;
  const edge = direction ?? (before ? 'before' : 'after');
  const anchorID = edge === 'before' ? window.first_item_id : window.last_item_id;
  if (!anchorID) return;
  return { anchor_id: anchorID, direction: edge, limit: HISTORY_PAGE_ITEMS };
}

// A settled read can yield the same bounded edges (start/end or no progress).
// Only new intent or accepted bounds should schedule another request.
export function historyReadingKey(threadID: string, window: FlowerHistoryWindow, request: FlowerHistoryRequest, protectedIDs: readonly string[] = []) {
  return JSON.stringify([threadID, window.first_item_id, window.last_item_id, window.has_before, window.has_after, request.anchor_id, request.anchor_offset, request.direction, [...new Set(protectedIDs)].sort()]);
}


// This is disposable page membership only. The canonical owner rereads these
// identities in one baseline before the visible surface adopts the new range.
export function historyReadingSelection(retained: readonly string[], page: readonly string[], direction: 'before' | 'after',
  pinned: readonly string[], maximum = HISTORY_READING_ITEMS, ordinals?: ReadonlyMap<string, number>, itemBytes?: ReadonlyMap<string, number>): readonly string[] | undefined {
  if (new Set(retained).size !== retained.length || new Set(page).size !== page.length
    || retained.some(id => !id) || page.some(id => !id) || maximum < 1) throw new Error('Invalid history page membership.');
  const old = new Set(retained);
  const added = page.filter(id => !old.has(id));
  if (!added.length) return;
  const combined = direction === 'before' ? [...added, ...retained] : [...retained, ...added];
  if (ordinals) {
    if (combined.some(id => !Number.isSafeInteger(ordinals.get(id)) || ordinals.get(id)! < 1)) throw new Error('Invalid history membership position.');
    combined.sort((a, b) => ordinals.get(a)! - ordinals.get(b)!);
    if (combined.some((id, index) => index > 0 && ordinals.get(id) === ordinals.get(combined[index - 1]))) throw new Error('Ambiguous history membership position.');
  }
  const protectedIDs = new Set(pinned.filter(id => combined.includes(id)));
  const candidates = new Set(protectedIDs);
  const cost = (id: string) => itemBytes?.get(id) ?? 0;
  let bytes = [...protectedIDs].reduce((sum, id) => sum + cost(id), 0);
  if (itemBytes && bytes > HISTORY_READING_BYTES) return;
  const addedSet = new Set(added);
  const first = combined.findIndex(id => addedSet.has(id));
  const last = combined.length - 1 - [...combined].reverse().findIndex(id => addedSet.has(id));
  const ordered = direction === 'before'
    ? [...combined.slice(first), ...combined.slice(0, first).reverse()]
    : [...combined.slice(0, last + 1).reverse(), ...combined.slice(last + 1)];
  for (const id of ordered) {
    if (candidates.size >= maximum) break;
    if (candidates.has(id)) continue;
    if (itemBytes && bytes + cost(id) > HISTORY_READING_BYTES) break;
    candidates.add(id);
    bytes += cost(id);
  }
  // Protected islands stay mounted without retaining the intervening history.
  // A measured gap represents each evicted interval and drives ordinary scroll reads.
  if (!added.some(id => candidates.has(id))) return;
  return combined.filter(id => candidates.has(id));
}

export type HistoryReadingGap = Readonly<{ beforeID: string; afterID: string; first: number; last: number; height: number }>;
type Member = Readonly<{ id: string; ordinal: number }>;

// Retain geometry only for gaps between the current finite selection. No map
// grows with all previously visited history. Ordinals are public membership
// positions, not journal depths, so hidden control records cannot create gaps.
export function historyReadingGaps(previous: readonly Member[], next: readonly Member[], gaps: readonly HistoryReadingGap[],
  heights: ReadonlyMap<string, number>): readonly HistoryReadingGap[] {
  const result: HistoryReadingGap[] = [];
  for (let index = 1; index < next.length; index++) {
    const before = next[index - 1], after = next[index];
    const first = before.ordinal + 1, last = after.ordinal;
    if (first >= last) continue;
    let height = 0;
    for (const gap of gaps) {
      const overlap = Math.max(0, Math.min(last, gap.last) - Math.max(first, gap.first));
      if (overlap) height += gap.height * overlap / (gap.last - gap.first);
    }
    for (const item of previous) if (item.ordinal >= first && item.ordinal < last) height += heights.get(item.id) ?? 0;
    result.push({ beforeID: before.id, afterID: after.id, first, last, height });
  }
  return result;
}

export function historyGapRequest(viewport: HTMLElement, direction: 'before' | 'after' | undefined): FlowerHistoryRequest | undefined {
  const bounds = viewport.getBoundingClientRect();
  const gaps = [...viewport.querySelectorAll<HTMLElement>('[data-flower-history-gap]')].filter(node => {
    const rect = node.getBoundingClientRect();
    if (rect.height <= 0 || rect.bottom <= bounds.top - HISTORY_EDGE_MARGIN_PX || rect.top >= bounds.bottom + HISTORY_EDGE_MARGIN_PX) return false;
    // Only the leading reading edge owns prefetch. A short/collapsed transcript
    // may expose several protected islands at once; filling gaps behind that
    // edge would evict its opposite page and immediately request it again.
    return direction === 'before' ? rect.top <= bounds.top
      : direction === 'after' ? rect.bottom >= bounds.bottom : true;
  });
  const gap = direction === 'before' ? gaps.at(-1) : gaps[0];
  if (!gap) return;
  const before = gap.dataset.flowerHistoryGapBefore;
  const after = gap.dataset.flowerHistoryGapAfter;
  if (!before || !after) return;
  const rect = gap.getBoundingClientRect();
  const first = Number(gap.dataset.flowerHistoryGapFirst), last = Number(gap.dataset.flowerHistoryGapLast);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last <= first) return;
  const limit = Math.min(HISTORY_PAGE_ITEMS, last - first);
  if (rect.top <= bounds.top && rect.bottom >= bounds.bottom) {
    const target = Math.min(last - 1, first + Math.floor((bounds.top - rect.top) / rect.height * (last - first)));
    return { anchor_id: before, anchor_offset: target - first + 1, direction: 'around', limit: HISTORY_PAGE_ITEMS };
  }
  // Read from the edge facing the viewport. The last scroll direction must
  // never turn a nearby gap into a read at its distant opposite end.
  const edge = rect.top < bounds.top ? 'before' : 'after';
  // Do not read past a small missing interval into another retained island.
  // Overshooting would evict the opposite page and alternate between gaps.
  return { anchor_id: edge === 'before' ? after : before, direction: edge, limit };
}
