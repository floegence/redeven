import { batch, Show, createEffect, createMemo, createSignal, on, onCleanup, untrack } from 'solid-js';
import { AlertCircle, Check, ChevronDown, Clock, ExternalLink, XCircle } from '@floegence/floe-webapp-core/icons';
import type { FlowerParentEvent, FlowerParentEventPage, FlowerParentEventQuery } from './contracts/flowerSurfaceContracts';
import type { FlowerSubagentsCopy } from './copy';
import { SubagentAvatar } from './SubagentAvatar';
import { validateParentEventPage } from './parentEventPage';
import { createActivityReadQueue } from './activityReadQueue';
import { FlowerReadDeadlineError, withFlowerReadDeadline } from './requestDeadline';
import { recoverHistoryRead } from './historyReadRecovery';
import { historyReadingSelection } from './historyReadingWindow';
import type { FlowerScrollTailController } from './flowerScrollTail';
import { retainKeyedItems } from './presentationIdentity';

type ParentEventReader = (threadID: string, query: FlowerParentEventQuery, signal?: AbortSignal) => Promise<FlowerParentEventPage>;

type EventReadRequest = Readonly<{ threadID: string; query: FlowerParentEventQuery;
  intervalQueries?: readonly FlowerParentEventQuery[]; replaceInterval?: boolean; tailFirst?: number }>;
export type ParentEventReadingInterval = Readonly<{ first: number; last: number; hasAfter: boolean;
  spans?: readonly Readonly<{ first: number; last: number }>[]; revision?: number }>;
type EventReadState = Readonly<
  { status: 'idle' } | { status: 'reading' | 'failed'; request: EventReadRequest; failure?: 'error' | 'timeout' }
>;

// Only presentation pages live here. Floret remains the event and admission owner.
export function createParentEventReading(props: Readonly<{
  threadID: string; page?: FlowerParentEventPage; read?: ParentEventReader;
  connectionEpoch?: number; timeoutMessage?: string; scroll?: FlowerScrollTailController;
  interval?: ParentEventReadingInterval;
}>) {
  const [retained, setRetained] = createSignal<readonly FlowerParentEvent[]>([]);
  const [gaps, setGaps] = createSignal<readonly { beforeID: string; afterID: string; height: number }[]>([]);
  const neighbors = new Map<string, { before?: string; after?: string; beforeOrdinal?: number; afterOrdinal?: number; leaf?: string }>();
  const [beforeCursor, setBeforeCursor] = createSignal('');
  const [bodies, setBodies] = createSignal<Readonly<Record<string, FlowerParentEvent>>>({});
  const detailQueue = createActivityReadQueue();
  const demanded = new Map<string, { scope: AbortController; consumers: Set<object>; status: 'reading' | 'failed' | 'ready'; accessed: number }>();
  const [detailRevision, setDetailRevision] = createSignal(0);
  let accessSequence = 0;
  const pruneBodies = () => setBodies(previous => {
    const next = { ...previous };
    let bytes = Object.values(next).reduce((sum, event) => sum + new TextEncoder().encode(event.message ?? '').length, 0);
    const candidates = Object.keys(next).filter(id => !demanded.get(id)?.consumers.size)
      .sort((a, b) => (demanded.get(a)?.accessed ?? 0) - (demanded.get(b)?.accessed ?? 0));
    for (const id of candidates) {
      if (Object.keys(next).length <= 64 && bytes <= (512 << 10)) break;
      bytes -= new TextEncoder().encode(next[id].message ?? '').length;
      delete next[id]; demanded.delete(id);
    }
    return next;
  });
  const readBody = async (id: string) => {
    const owner = demanded.get(id);
    const reader = props.read;
    if (!owner || !owner.consumers.size) return;
    if (!reader) { owner.status = 'failed'; setDetailRevision(value => value + 1); return; }
    const threadID = props.threadID;
    const signal = owner.scope.signal;
    owner.status = 'reading'; setDetailRevision(value => value + 1);
    try {
      const query = { action: 'read' as const, event_id: id };
      const result = validateParentEventPage(await recoverHistoryRead(() => detailQueue.run(JSON.stringify([threadID, id]), signal,
        transportSignal => withFlowerReadDeadline(readSignal => reader(threadID, query, readSignal),
          props.timeoutMessage ?? 'Event read timed out.', transportSignal)), signal), threadID, query);
      signal.throwIfAborted();
      if (demanded.get(id) !== owner || props.threadID !== threadID) return;
      owner.status = 'ready'; owner.accessed = ++accessSequence;
      setBodies(previous => ({ ...previous, [id]: result.events[0] }));
      pruneBodies();
    } catch {
      if (!signal.aborted && demanded.get(id) === owner) owner.status = 'failed';
    } finally { if (demanded.get(id) === owner) setDetailRevision(value => value + 1); }
  };
  const releaseBodies = () => {
    for (const owner of demanded.values()) owner.scope.abort();
    demanded.clear(); setDetailRevision(value => value + 1);
  };
  onCleanup(releaseBodies);
  const [cursor, setCursor] = createSignal('');
  const [state, setState] = createSignal<EventReadState>({ status: 'idle' });
  let generation = 0;
  let controller: AbortController | undefined;
  let previousThread = '';
  let previousRange = '';
  let previousFirst = '';
  let previousEpoch: number | undefined;
  let previousReader: ParentEventReader | undefined;
  let previousPage: FlowerParentEventPage | undefined;
  let previousInterval = '';
  let previousReadingRevision: number | undefined;
  let pendingAlignment: EventReadRequest | undefined;
  // Immutable source-bound pages are presentation cache, not a lifecycle.
  // Repeated tail alignment must not download or reinstall the same receipts.
  const pagesByQuery = new Map<string, FlowerParentEventPage>();
  let pagesLeaf = '';
  const readPage = async (reader: ParentEventReader, threadID: string, query: FlowerParentEventQuery, signal: AbortSignal) => {
    const key = query.leaf_id ? JSON.stringify(query) : '';
    const cached = key && pagesByQuery.get(key);
    if (cached) { signal.throwIfAborted(); return cached; }
    const page = validateParentEventPage(await recoverHistoryRead(() => withFlowerReadDeadline(
      readSignal => reader(threadID, query, readSignal), props.timeoutMessage ?? 'Event read timed out.', signal), signal), threadID, query);
    signal.throwIfAborted();
    if (key && pagesLeaf === query.leaf_id) {
      pagesByQuery.set(key, page);
      if (pagesByQuery.size > 32) pagesByQuery.delete(pagesByQuery.keys().next().value!);
    }
    return page;
  };
  const [initialReady, setInitialReady] = createSignal(true);
  let refreshController: AbortController | undefined;
  let requestedLeaf = '';
  let acceptedLeaf = '';
  const [refreshFailure, setRefreshFailure] = createSignal(false);
  const cancelRefresh = () => { refreshController?.abort(); refreshController = undefined; requestedLeaf = ''; acceptedLeaf = ''; setRefreshFailure(false); };
  onCleanup(cancelRefresh);
  const invalidate = () => { generation++; controller?.abort(); controller = undefined; pendingAlignment = undefined; };
  onCleanup(invalidate);
  const currentPage = createMemo(() => props.page);
  const events = createMemo<readonly FlowerParentEvent[]>(previous => retainKeyedItems(previous, retained().map(event => ({
    ...event, ...(bodies()[event.id]?.message !== undefined ? { message: bodies()[event.id].message } : {}),
  })), event => event.id));
  const rows = () => [...(props.scroll?.viewport()?.querySelectorAll<HTMLElement>('[data-parent-event]') ?? [])];
  const protectedIDs = () => {
    const bounds = props.scroll?.viewport()?.getBoundingClientRect();
    const selection = document.getSelection();
    return rows().filter(row => {
      const rect = row.getBoundingClientRect();
      return bounds && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom
        || row.contains(document.activeElement)
        || Boolean(selection && !selection.isCollapsed && Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)).some(range => range.intersectsNode(row)));
    }).map(row => row.dataset.parentEvent!);
  };
  const preserve = (change: () => void) => {
    const scroll = props.scroll;
    const bounds = scroll?.viewport()?.getBoundingClientRect();
    const anchor = bounds && [...(scroll?.viewport()?.querySelectorAll<HTMLElement>('[data-parent-event], [data-flower-message-id]') ?? [])].find(row => {
      const rect = row.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    if (anchor && !scroll!.followingLatest()) scroll!.preserveLayoutAnchor(anchor);
    batch(change);
    if (anchor) requestAnimationFrame(() => { if (anchor.isConnected) scroll!.finishDisclosure(anchor); });
  };
  const rememberNeighbors = (page: FlowerParentEventPage, query?: FlowerParentEventQuery, tailFirst?: number) => {
    const exhausted = page.events.length < (query?.limit ?? 50);
    const lower = query?.after_ordinal ?? (query?.latest ? tailFirst : undefined);
    for (const [index, event] of page.events.entries()) {
      const old = neighbors.get(event.id);
      const sameSource = old?.leaf === page.leaf_id;
      neighbors.set(event.id, {
        leaf: page.leaf_id,
        beforeOrdinal: index === 0 && exhausted && lower !== undefined ? lower : sameSource ? old?.beforeOrdinal : undefined,
        afterOrdinal: index === page.events.length - 1 && query?.before_ordinal !== undefined ? query.before_ordinal : sameSource ? old?.afterOrdinal : undefined,
        before: page.events[index - 1]?.id ?? query?.after_event_id ?? (event.id === page.first_event_id ? undefined : old?.before),
        after: page.events[index + 1]?.id ?? query?.before_event_id ?? (event.id === page.last_event_id ? undefined : old?.after),
      });
    }
    if (query?.after_event_id && page.events.length) {
      neighbors.set(query.after_event_id, { ...neighbors.get(query.after_event_id), after: page.events[0].id });
    }
    if (query?.before_event_id && page.events.length) {
      neighbors.set(query.before_event_id, { ...neighbors.get(query.before_event_id), before: page.events.at(-1)!.id });
    }
  };
  const install = (page: FlowerParentEventPage, query: FlowerParentEventQuery, reset = false, remember = true) => {
    const previous = retained();
    const direction = query.before_event_id || query.latest ? 'before' : 'after';
    const combined = new Map(previous.map(event => [event.id, event]));
    for (const event of page.events) combined.set(event.id, event);
    const ordinals = [...combined.values()].every(event => event.canonical_ordinal !== undefined)
      ? new Map([...combined.values()].map(event => [event.id, event.canonical_ordinal!])) : undefined;
    const selected = reset ? page.events.map(event => event.id) : props.interval && ordinals
      ? [...combined.keys()].sort((a, b) => ordinals.get(a)! - ordinals.get(b)!)
      : historyReadingSelection(previous.map(event => event.id), page.events.map(event => event.id), direction, protectedIDs(), 150, ordinals)
      ?? previous.map(event => event.id);
    const selectedSet = new Set(selected);
    const heights = new Map(rows().map(row => [row.dataset.parentEvent!, row.getBoundingClientRect().height]));
    if (remember) rememberNeighbors(page, query);
    const next = selected.map(id => combined.get(id)!);
    const nextGaps: { beforeID: string; afterID: string; height: number }[] = [];
    for (let i = 1; i < next.length; i++) {
      const before = next[i - 1], after = next[i];
      if (neighbors.get(before.id)?.after === after.id || neighbors.get(after.id)?.before === before.id) continue;
      let height = 0;
      const first = previous.findIndex(event => event.id === before.id), last = previous.findIndex(event => event.id === after.id);
      if (first >= 0 && last > first) {
        for (const event of previous.slice(first + 1, last)) height += heights.get(event.id) ?? 0;
        for (const gap of gaps()) {
          const index = previous.findIndex(event => event.id === gap.beforeID);
          if (index >= first && index < last) height += gap.height;
        }
      }
      nextGaps.push({ beforeID: before.id, afterID: after.id, height: Math.max(1, height) });
    }
    for (const id of neighbors.keys()) if (!selectedSet.has(id)) neighbors.delete(id);
    preserve(() => {
      setRetained(next); setGaps(nextGaps);
      // Cursors belong to the finite retained window, including evicted ends.
      setBeforeCursor(next.length && next[0].id !== page.first_event_id ? next[0].id : '');
      setCursor(next.length && next.at(-1)!.id !== page.last_event_id ? next.at(-1)!.id : '');
    });
  };
  const read = async (request: EventReadRequest) => {
    const { replaceInterval, intervalQueries } = request;
    const reader = props.read;
    if (state().status === 'reading') return;
    if (!reader) { setState({ status: 'failed', request, failure: 'error' }); return; }
    const current = ++generation;
    const scope = new AbortController(); controller = scope;
    const previous = state();
    setState({ status: 'reading', request, ...(previous.status === 'failed' ? { failure: previous.failure } : {}) });
    try {
      const pages: { page: FlowerParentEventPage; query: FlowerParentEventQuery }[] = [];
      for (const query of intervalQueries ?? [request.query]) {
        const page = await readPage(reader, request.threadID, query, scope.signal);
        if (current !== generation) return;
        pages.push({ page, query });
      }
      // Latest is the canonical owner's bounded reverse seek. Filtering its
      // small result avoids reading an arbitrarily dense receipt-only tail
      // forward from the last message. Keep each span's adjacency independent.
      for (const value of pages) {
        if (value.query.latest && request.tailFirst !== undefined) value.page = { ...value.page,
          events: value.page.events.filter(event => event.canonical_ordinal! >= request.tailFirst!) };
      }
      const result = pages.length === 1 ? pages[0].page : { ...pages[0].page,
        events: pages.flatMap(value => value.page.events).sort((a, b) => a.canonical_ordinal! - b.canonical_ordinal!) };
      if (current !== generation) return;
      if (!result.events.length && (request.query.after_event_id || request.query.before_event_id)) {
        if (request.query.after_event_id === result.last_event_id) setCursor('');
        else if (request.query.before_event_id === result.first_event_id) setBeforeCursor('');
        else throw new Error('Flower contract error: event continuation made no progress.');
        setState({ status: 'idle' }); return;
      }
      const loaded = new Set(retained().map(event => event.id));
      // A gap read may legitimately rejoin a retained island. Reject only
      // identities on the wrong side of its exclusive cursor.
      const anchorID = request.query.after_event_id ?? request.query.before_event_id;
      const anchorIndex = retained().findIndex(event => event.id === anchorID);
      if (!replaceInterval && anchorIndex >= 0) {
        const forbidden = new Set((request.query.after_event_id ? retained().slice(0, anchorIndex + 1)
          : retained().slice(anchorIndex)).map(event => event.id));
        if (result.events.some(event => forbidden.has(event.id))) throw new Error('Flower contract error: event continuation crossed its cursor.');
      }
      if (!replaceInterval && result.events.every(event => loaded.has(event.id))) throw new Error('Flower contract error: event continuation repeated loaded events.');
      if (replaceInterval) {
        // The active document retains every displayed interval. Keep its
        // receipts as well, so warm scrolling cannot split a tool group.
        const pinned = new Set(protectedIDs());
        const interval = props.interval;
        const spans = interval?.spans ?? (interval ? [{ first: interval.first, last: interval.last }] : []);
        preserve(() => {
          setRetained(retained().filter(event => pinned.has(event.id) || event.canonical_ordinal !== undefined && spans.some((span, index) =>
            event.canonical_ordinal! >= span.first && (index === spans.length - 1 && !interval!.hasAfter || event.canonical_ordinal! <= span.last))));
          for (const value of pages) rememberNeighbors(value.page, value.query, request.tailFirst);
          install(result, request.query, retained().length === 0, false);
          setInitialReady(true);
        });
      } else install(result, request.query);
      setState({ status: 'idle' });
    } catch (error) {
      if (current === generation) setState({ status: 'failed', request, failure: error instanceof FlowerReadDeadlineError ? 'timeout' : 'error' });
    } finally { if (current === generation) {
      controller = undefined;
      const next = pendingAlignment; pendingAlignment = undefined;
      if (next) void read(next); else void refresh();
    } }
  };
  // The default component only contains its first page. Refresh the finite
  // retained intervals against the new source, including status changes beyond
  // that page. One accepted read completes while newer notifications coalesce.
  const refresh = async () => {
    const reader = props.read;
    const leaf = requestedLeaf;
    if (!reader || !leaf || leaf === acceptedLeaf || refreshController || controller || refreshFailure()) return;
    const current = retained();
    if (!current.length || current.some(event => event.canonical_ordinal === undefined)) { acceptedLeaf = leaf; return; }
    const thread = props.threadID;
    const scope = new AbortController(); refreshController = scope;
    const intervals: FlowerParentEvent[][] = [];
    for (const event of current) {
      const last = intervals.at(-1)?.at(-1);
      if (!last || neighbors.get(last.id)?.after !== event.id && neighbors.get(event.id)?.before !== last.id) intervals.push([]);
      intervals.at(-1)!.push(event);
    }
    const updated = new Map<string, FlowerParentEvent>();
    const pages: { page: FlowerParentEventPage; query: FlowerParentEventQuery }[] = [];
    try {
      for (const interval of intervals) {
        const lower = interval[0].canonical_ordinal! - 1;
        let upper = interval.at(-1)!.canonical_ordinal! + 1;
        let remaining = interval.length;
        while (remaining > 0) {
          const query: FlowerParentEventQuery = { action: 'list', leaf_id: leaf, after_ordinal: lower, before_ordinal: upper, limit: Math.min(100, remaining) };
          const page = validateParentEventPage(await recoverHistoryRead(() => withFlowerReadDeadline(
            signal => reader(thread, query, signal), props.timeoutMessage ?? 'Event read timed out.', scope.signal), scope.signal), thread, query);
          scope.signal.throwIfAborted();
          pages.push({ page, query });
          for (const event of page.events) updated.set(event.id, event);
          if (!page.events.length) break;
          upper = page.events[0].canonical_ordinal!;
          remaining -= page.events.length;
        }
      }
      scope.signal.throwIfAborted();
      // A navigation response may already have accepted newer identities. Only
      // replace the interval this read owned; retain newer baseline facts.
      const owned = new Set(current.map(event => event.id));
      const retainedIDs = new Set(retained().map(event => event.id));
      // Keep only the parts of the accepted intervals that navigation still
      // owns. A replacement identity is no reason to refill an evicted gap or
      // prefix, including when a selected receipt pins a separate island.
      const surviving: { first: number; last: number }[] = [];
      for (const interval of intervals) {
        let span: { first: number; last: number } | undefined;
        for (const event of interval) {
          if (!retainedIDs.has(event.id)) { span = undefined; continue; }
          if (span) span.last = event.canonical_ordinal!;
          else { span = { first: event.canonical_ordinal!, last: event.canonical_ordinal! }; surviving.push(span); }
        }
      }
      const newer = props.page?.leaf_id !== leaf ? new Map(props.page?.events.map(event => [event.id, event])) : undefined;
      let next = retained().flatMap(event => !owned.has(event.id) ? [event] : updated.has(event.id)
        ? [newer?.get(event.id) ?? updated.get(event.id)!] : []);
      if (props.page?.leaf_id === leaf) {
        const known = new Set(next.map(event => event.id));
        // Navigation can evict a refreshed identity while this read is in
        // flight. Only genuinely new path members may join; old members must
        // never reappear merely because their status refresh completed later.
        const replacements = [...updated.values()].filter(event => !known.has(event.id) && !owned.has(event.id)
          && surviving.some(span => event.canonical_ordinal! >= span.first && event.canonical_ordinal! <= span.last));
        if (replacements.length) {
          const values = new Map([...next, ...replacements].map(event => [event.id, event]));
          const ordinals = new Map([...values].map(([id, event]) => [id, event.canonical_ordinal!]));
          const selected = historyReadingSelection(next.map(event => event.id), replacements.map(event => event.id),
            direction ?? 'after', protectedIDs(), 150, ordinals);
          if (selected) next = selected.map(id => values.get(id)!);
        }
        next.sort((a, b) => a.canonical_ordinal! - b.canonical_ordinal!);
      }
      for (const { page, query } of pages) rememberNeighbors(page, query);
      const ids = new Set(next.map(event => event.id));
      for (const id of neighbors.keys()) if (!ids.has(id)) neighbors.delete(id);
      preserve(() => {
        setRetained(next);
        setGaps(previous => previous.filter(gap => ids.has(gap.beforeID) && ids.has(gap.afterID)));
        setBeforeCursor(next.length && next[0].id !== props.page?.first_event_id ? next[0].id : '');
        setCursor(next.length && next.at(-1)!.id !== props.page?.last_event_id ? next.at(-1)!.id : '');
      });
      acceptedLeaf = leaf;
    } catch { if (!scope.signal.aborted) setRefreshFailure(true); }
    finally {
      if (refreshController === scope) { refreshController = undefined; if (requestedLeaf !== leaf) void refresh(); }
    }
  };
  const request = (direction: 'before' | 'after'): EventReadRequest | undefined => {
    const edge = direction === 'before' ? beforeCursor() : cursor();
    if (!edge || props.page?.thread_id !== props.threadID) return;
    return { threadID: props.threadID, query: { action: 'list', ...(props.page?.leaf_id ? { leaf_id: props.page.leaf_id } : {}), ...(direction === 'before' ? { before_event_id: edge } : { after_event_id: edge }), limit: 50 } };
  };
  let frame = 0;
  let direction: 'before' | 'after' | undefined;
  const schedule = (intent?: 'before' | 'after') => {
    if (intent) direction = intent;
    const interrupted = state();
    if (intent && interrupted.status === 'failed') { void read(interrupted.request); return; }
    if (frame || !props.scroll) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const viewport = props.scroll?.viewport();
      if (!viewport || state().status !== 'idle') return;
      if (!direction && cursor() && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 1) direction = 'after';
      if (!direction) return;
      const bounds = viewport.getBoundingClientRect();
      const gap = [...viewport.querySelectorAll<HTMLElement>('[data-parent-event-gap]')].find(row => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > bounds.top - 600 && rect.top < bounds.bottom + 600;
      });
      if (gap) {
        const before = gap.getBoundingClientRect().top < bounds.top;
        void read({ threadID: props.threadID, query: { action: 'list', ...(props.page?.leaf_id ? { leaf_id: props.page.leaf_id } : {}), ...(before ? { before_event_id: gap.dataset.parentEventAfter } : { after_event_id: gap.dataset.parentEventBefore }), limit: 50 } });
        return;
      }
      const edge = direction === 'before' ? rows()[0] : rows().at(-1);
      if (!edge || edge.getBoundingClientRect().height === 0) return;
      const rect = edge.getBoundingClientRect();
      if (direction === 'before' ? rect.top < bounds.top - 600 || rect.top > bounds.bottom : rect.bottom > bounds.bottom + 600 || rect.bottom < bounds.top) return;
      const next = request(direction);
      if (next) void read(next);
    });
  };
  onCleanup(() => cancelAnimationFrame(frame));
  createEffect(() => { retained(); state(); schedule(); });
  createEffect(() => {
    const threadID = props.threadID;
    const page = props.page;
    const epoch = props.connectionEpoch;
    if (pagesLeaf !== page?.leaf_id || epoch !== previousEpoch || props.read !== previousReader || props.threadID !== previousThread) {
      pagesByQuery.clear(); pagesLeaf = page?.leaf_id ?? '';
    }
    const reader = props.read;
    const interval = props.interval;
    const spans = interval?.spans ?? (interval ? [{ first: interval.first, last: interval.last }] : []);
    const intervalKey = interval ? JSON.stringify([spans.map((span, index) => [span.first,
      index === spans.length - 1 && !interval.hasAfter ? null : span.last]), interval.hasAfter]) : '';
    const range = JSON.stringify([page?.first_event_id, page?.last_event_id]);
    const changed = threadID !== previousThread || range !== previousRange || epoch !== previousEpoch || reader !== previousReader;
    const interruptedOwner = threadID !== previousThread || page?.first_event_id !== previousFirst || epoch !== previousEpoch || reader !== previousReader;
    const align = Boolean(interval && reader && page?.leaf_id && page.first_event_id
      && (intervalKey !== previousInterval || interruptedOwner
        || !interval.hasAfter && range !== previousRange
        || untrack(retained).length === 0 && page.leaf_id !== requestedLeaf));
    const navigating = interval?.revision !== previousReadingRevision;
    // Interval access reads the shared cache. Read confirmations and other
    // metadata can update that cache without changing any receipt source.
    // Preserve the accepted array so those notifications do not re-project
    // every message, group and disclosure in the transcript.
    if (page === previousPage && !interruptedOwner && !align && !navigating) return;
    const sameRange = threadID === previousThread && range === previousRange;
    const interrupted = untrack(state);
    if (interruptedOwner || align && navigating) invalidate();
    if (threadID !== previousThread) { releaseBodies(); cancelRefresh(); }
    else if (epoch !== previousEpoch || reader !== previousReader) {
      cancelRefresh();
      for (const [id, owner] of demanded) {
        owner.scope.abort(); owner.scope = new AbortController();
        if (owner.consumers.size && owner.status !== 'ready') void readBody(id);
      }
    }
    untrack(() => {
      if (threadID !== previousThread || page?.first_event_id !== previousFirst || !retained().length) {
        if (threadID !== previousThread || page?.first_event_id !== previousFirst) setInitialReady(!align);
        cancelRefresh();
        neighbors.clear(); direction = undefined;
        setBodies({}); setRetained([]); setGaps([]); setBeforeCursor(''); setCursor('');
        if (page) install({ ...page, events: interval ? page.events.filter(event => event.canonical_ordinal !== undefined
          && spans.some((span, index) => event.canonical_ordinal! >= span.first
            && (index === spans.length - 1 && !interval.hasAfter || event.canonical_ordinal! <= span.last))) : page.events }, { action: 'list' }, true);
        acceptedLeaf = page?.leaf_id ?? '';
      } else if (page) {
        // Live admission/status updates replace matching facts without replacing
        // mounted rows or losing disclosure bodies. New adjacent receipts join.
        const known = new Set(retained().map(event => event.id));
        const updates = page.events.filter(event => known.has(event.id));
        const append = page.events.filter(event => !known.has(event.id));
        const contiguous = !cursor() && page.events.some(event => event.id === retained().at(-1)?.id);
        install({ ...page, events: contiguous ? [...updates, ...append] : updates }, { action: 'list' });
      }
      previousPage = page; previousThread = threadID; previousFirst = page?.first_event_id ?? ''; previousRange = range; previousEpoch = epoch; previousReader = reader; previousInterval = intervalKey; previousReadingRevision = interval?.revision;
      if (requestedLeaf !== page?.leaf_id) setRefreshFailure(false);
      requestedLeaf = page?.leaf_id ?? '';
      if (align) {
        setInitialReady(false);
        const queries: FlowerParentEventQuery[] = spans.map((span, index) => ({ action: 'list', leaf_id: page!.leaf_id,
          ...(index === spans.length - 1 && !interval!.hasAfter ? { latest: true }
            : { after_ordinal: span.first - 1, before_ordinal: span.last + 1 }),
          limit: Math.max(1, Math.floor(50 / spans.length)) }));
        const request = { threadID, query: queries[0], replaceInterval: true, intervalQueries: queries,
          tailFirst: !interval!.hasAfter ? spans.at(-1)!.first : undefined };
        if (controller) pendingAlignment = request;
        else { setState({ status: 'idle' }); void read(request); }
        return;
      }
      void refresh();
      if (changed && interruptedOwner) {
        setState(sameRange && interrupted.status !== 'idle' ? { ...interrupted, status: 'failed' } : { status: 'idle' });
        if (sameRange && interrupted.status !== 'idle') void read(interrupted.request);
      }
    });
  });
  // Missing receipts can interrupt any tool sequence crossing their interval.
  // They never authorize more reads just to make a group count available.
  const missingIntervals = createMemo(() => {
    const rows = events();
    const positions = new Map(rows.map(event => [event.id, event.canonical_ordinal]));
    const leaf = props.page?.leaf_id;
    const boundary = (id: string | undefined, side: 'beforeOrdinal' | 'afterOrdinal') => {
      const value = id ? neighbors.get(id) : undefined;
      return value?.leaf === leaf ? value?.[side] : undefined;
    };
    return [
      ...(beforeCursor() ? [{ after: -Infinity, before: boundary(rows[0]?.id, 'beforeOrdinal') ?? rows[0]?.canonical_ordinal ?? Infinity }] : []),
      ...gaps().map(gap => ({ after: boundary(gap.beforeID, 'afterOrdinal') ?? positions.get(gap.beforeID) ?? -Infinity, before: boundary(gap.afterID, 'beforeOrdinal') ?? positions.get(gap.afterID) ?? Infinity })),
      ...(cursor() ? [{ after: boundary(rows.at(-1)?.id, 'afterOrdinal') ?? rows.at(-1)?.canonical_ordinal ?? -Infinity, before: Infinity }] : []),
    ];
  });
  return { events, cursor, beforeCursor, gaps, schedule, initialReady, missingIntervals,
    retainBody: (id: string) => {
      const consumer = {};
      let owner = demanded.get(id);
      if (!owner || owner.scope.signal.aborted) {
        owner = { scope: new AbortController(), consumers: new Set(), status: bodies()[id]?.message !== undefined || currentPage()?.events.some(event => event.id === id && event.message !== undefined) ? 'ready' : 'reading', accessed: ++accessSequence };
        demanded.set(id, owner);
      }
      owner.consumers.add(consumer);
      owner.accessed = ++accessSequence;
      if (owner.consumers.size === 1 && owner.status !== 'ready') void readBody(id);
      const current = owner;
      return () => {
        current.consumers.delete(consumer);
        if (!current.consumers.size && current.status !== 'ready') { current.scope.abort(); if (demanded.get(id) === current) demanded.delete(id); }
        pruneBodies();
      };
    },
    bodyState: (id: string) => { detailRevision(); return demanded.get(id)?.status; }, busy: () => state().status === 'reading', failed: () => state().status === 'failed',
    recovering: () => { const current = state(); return refreshFailure() || current.status !== 'idle' && current.failure !== undefined; },
    timedOut: () => { const current = state(); return current.status !== 'idle' && current.failure === 'timeout'; },
    retry: () => { const current = state(); return current.status === 'failed' ? read(current.request) : Promise.resolve(); },
    previous: () => { const next = request('before'); return next && state().status !== 'failed' ? read(next) : Promise.resolve(); },
    more: () => { const next = request('after'); return next && state().status !== 'failed' ? read(next) : Promise.resolve(); } };
}

export function parentEventLabel(event: FlowerParentEvent, copy: FlowerSubagentsCopy): string {
  switch (event.kind) {
    case 'report': return copy.events.report;
    case 'input_required': return copy.events.input;
    case 'approval_required': return copy.events.approval;
    case 'interrupted': return copy.events.interrupted;
    case 'cancelled': return copy.statusLabels.canceled;
    default: return copy.statusLabels[event.kind];
  }
}

export function ParentEventRow(props: Readonly<{
  event: FlowerParentEvent; copy: FlowerSubagentsCopy; sourceName: string;
  canOpenSource: boolean; onOpenSource: () => void; onDisclosureClick: (title: HTMLElement) => void;
  expanded: boolean; onExpandedChange: (expanded: boolean) => void;
  visible?: boolean; connection?: number; retainBody?: (id: string) => () => void;
  bodyState?: 'reading' | 'failed' | 'ready'; loadingLabel?: string;

}>) {
  const open = () => props.expanded;
  const report = () => props.event.kind === 'report';
  const message = () => props.event.message ?? '';
  let reportBody!: HTMLDivElement;
  createEffect(on([() => props.expanded, () => props.visible, () => props.connection, () => props.event.id], () => {
    if (!props.expanded || props.visible === false || props.event.kind !== 'report') return;
    const release = props.retainBody?.(props.event.id);
    if (release) onCleanup(release);
  }));
  const time = () => {
    const date = new Date(props.event.received_at);
    return Number.isFinite(date.getTime()) ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
  };
  return <article class="flower-parent-event" data-parent-event={props.event.id} data-parent-event-kind={props.event.kind}>
    <div class="flower-parent-event-heading">
      <SubagentAvatar threadID={props.event.source_thread_id} class="flower-parent-event-avatar" />
      <Show when={report()}><span class="flower-parent-event-type">{props.copy.events.report}</span></Show>
      <Show when={props.canOpenSource} fallback={<span class="flower-parent-event-source" title={props.sourceName}>{props.sourceName}</span>}>
        <button type="button" class="flower-parent-event-source" title={props.sourceName} onClick={props.onOpenSource}>{props.sourceName}</button>
      </Show>
      <Show when={!report()}>
        <span class="flower-parent-event-status">
          <Show when={props.event.kind === 'completed'} fallback={
            <Show when={props.event.kind === 'cancelled'} fallback={
              <Show when={props.event.kind === 'timed_out' || props.event.kind === 'interrupted'} fallback={<AlertCircle aria-hidden="true" />}>
                <Clock aria-hidden="true" />
              </Show>
            }><XCircle aria-hidden="true" /></Show>
          }><Check aria-hidden="true" /></Show>
          {parentEventLabel(props.event, props.copy)}
        </span>
      </Show>
      <time dateTime={props.event.received_at}>{time()}</time>
      <Show when={!report() && props.canOpenSource}>
        <button type="button" class="flower-parent-event-action flower-parent-event-open" onClick={props.onOpenSource}>
          {props.copy.events.open}<ExternalLink aria-hidden="true" />
        </button>
      </Show>
    </div>
    <Show when={report()}>
      <div class="flower-parent-event-report">
        <Show when={message() || open()}>
          <div ref={reportBody} id={`flower-parent-event-body-${encodeURIComponent(props.event.parent_thread_id + ':' + props.event.id)}`}
            class="flower-parent-event-body" data-parent-event-body={props.event.id} data-expanded={open()} aria-busy={props.bodyState === 'reading'}>{message() || (props.bodyState === 'failed' ? props.copy.events.readFailed : props.loadingLabel)}</div>
        </Show>
        <div class="flower-parent-event-actions">
          <Show when={report()}>
            <button type="button" class="flower-parent-event-action flower-parent-event-disclosure" data-flower-disclosure-trigger aria-expanded={open()}
              aria-controls={`flower-parent-event-body-${encodeURIComponent(props.event.parent_thread_id + ':' + props.event.id)}`}
              onClick={event => {
                props.onDisclosureClick(open() || !reportBody ? event.currentTarget : reportBody);
                props.onExpandedChange(!open());
              }}>
              {open() ? props.copy.events.collapse : props.copy.events.read}<ChevronDown aria-hidden="true" />
            </button>
          </Show>
          <Show when={props.canOpenSource}>
            <button type="button" class="flower-parent-event-action flower-parent-event-open" onClick={props.onOpenSource}>
              {props.copy.events.open}<ExternalLink aria-hidden="true" />
            </button>
          </Show>
        </div>
      </div>
    </Show>
  </article>;
}
