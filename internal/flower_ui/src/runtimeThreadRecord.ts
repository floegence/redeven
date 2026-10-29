import { batch, createSignal } from 'solid-js';
import { createStore, type SetStoreFunction } from 'solid-js/store';
import type { FlowerChatMessage, FlowerHistoryPage, FlowerHistoryBodyChunk, FlowerHistoryWindow, FlowerRuntimeTurn, FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView, FlowerRuntimeUpdate, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { FlowerLiveSyncError } from './flowerLiveWire';
import { readPresentationValue, retainEqualValue } from './presentationIdentity';
import { projectFlowerRuntimeComponents, runtimeMessages, validateFlowerRuntimeTurns } from './runtimeCurrentView';
import { retainThinkingTiming } from './thinkingTiming';
import { createMessageTextSource } from './messageTextSource';
import { historyItemConfirmsPrefix, historyItemNeedsObservation, historyWindowForItems } from './historyWindowRetention';
import { flowerCurrentToolCallPreviews } from './toolCallPreview';

type ItemRecord = { item: FlowerRuntimeCurrentItem; bytes: number; preview?: FlowerRuntimeCurrentItem; retained?: boolean; displayText?: string };
type MutableMessage = Omit<{ -readonly [K in keyof FlowerChatMessage]: FlowerChatMessage[K] }, 'blocks'>
  & { blocks?: NonNullable<FlowerChatMessage['blocks']>[number][] };
type MessageRecord = { value: FlowerChatMessage; set: SetStoreFunction<MutableMessage>; appendText: (text: string) => void };
const utf8 = new TextEncoder();
export type HistoryBodyAppendResult = 'applied' | 'covered' | 'superseded';

function advanceMessage(prior: MessageRecord, message: FlowerChatMessage): boolean {
  const before = readPresentationValue(prior.value);
  if (before.id !== message.id || before.thread_id !== message.thread_id || before.turn_id !== message.turn_id
    || before.run_id !== message.run_id || before.role !== message.role
    || before.logical_request_id !== message.logical_request_id || before.attempt_epoch !== message.attempt_epoch
    || before.blocks?.length || message.blocks?.length || !message.content.startsWith(before.content)) return false;
  const suffix = message.content.slice(before.content.length);
  batch(() => {
    if (suffix) prior.appendText(suffix);
    for (const key of new Set([...Object.keys(before), ...Object.keys(message)])) {
      if (key !== 'text_source') prior.set({ [key]: message[key as keyof FlowerChatMessage] });
    }
  });
  return true;
}

function invalid(message: string): never { throw new Error(`Flower contract error: ${message}.`); }
function version(value: number) { return Number.isSafeInteger(value) && value >= 0; }

function sameItem(a: FlowerRuntimeCurrentItem, b: FlowerRuntimeCurrentItem) {
  return a.id === b.id && a.turn_id === b.turn_id && a.run_id === b.run_id && a.kind === b.kind;
}
function retainBody(before: ItemRecord | undefined, incoming: FlowerRuntimeCurrentItem): ItemRecord | undefined {
  if (!before || !sameItem(before.item, incoming)) return;
  if (before.preview && retainEqualValue(before.preview, incoming) === before.preview) return { ...before, preview: incoming };
  const source = before.item.body ?? before.preview?.body;
  const body = incoming.body;
  if (!body || !['assistant', 'thinking', 'user'].includes(incoming.kind)
    || body.run_id && body.run_id !== incoming.run_id) return;
  const sameSource = source
    ? source.run_id === body.run_id && source.source_id === body.source_id && source.entry_id === body.entry_id && source.field === body.field
    : Boolean(before.item.live) === Boolean(incoming.live);
  if (!sameSource) {
    // Sealing can normalize or replace text under the same item ID. Live byte
    // offsets never belong to the canonical source, even if its preview matches.
    // Keep the visible prose while reading the new source in bounded chunks;
    // publish it once complete instead of flashing a preview or mixed sources.
    return { item: incoming, bytes: utf8.encode(incoming.text ?? '').length, preview: incoming, retained: before.retained || !before.item.body,
      displayText: before.displayText ?? before.item.text ?? '' };
  }
  const sameLiveSource = Boolean(body.run_id) && body.run_id === (source?.run_id ?? before.item.run_id);
  let text = before.item.text ?? '';
  let bytes = before.bytes;
  if (!text.startsWith(incoming.text ?? '')) {
    if (!sameLiveSource) return;
    if (!(incoming.text ?? '').startsWith(text)) invalid('live body preview changed its prefix');
    text = incoming.text ?? '';
    bytes = utf8.encode(text).length;
    if (body.preview_bytes !== bytes || bytes > body.bytes) invalid('invalid live body preview extent');
  }
  // Ending a segment can publish a longer preview from the same live source.
  // Accept that prefix atomically with its pending state, retaining the locator
  // in preview for later growth even when this extent is already complete.
  return { ...before, bytes, item: { ...incoming, text, body: sameLiveSource && bytes >= body.bytes ? undefined : body },
    displayText: sameLiveSource && bytes >= body.bytes ? undefined : before.displayText,
    preview: incoming, retained: before.retained || !before.item.body || Boolean(incoming.live) };
}

type PreviousRecord = {
  readonly threadID: string;
  findMessage(id: string): MessageRecord | undefined;
  retainedItem(item: FlowerRuntimeCurrentItem): ItemRecord | undefined;
  readingState(): { window?: FlowerHistoryWindow; records: readonly ItemRecord[]; turns: readonly FlowerRuntimeTurn[];
    context_compactions?: FlowerThreadSnapshot['context_compactions']; timeline_decorations?: FlowerThreadSnapshot['timeline_decorations'] };
};
// An active document retains inspected history, like selected text. Evict only
// whole inactive documents in ThreadCache; dropping individual rows would split
// tool groups and discard local disclosure/scroll state. Network interest stays
// bounded independently of the user's explicitly loaded reading document.

// ThreadCache owns these records. There is no second raw current snapshot or
// lifecycle: components supply the shared projection, and items are indexed once.
export function createRuntimeThreadRecord(current: FlowerRuntimeCurrentView, initial: FlowerThreadSnapshot, previous?: PreviousRecord) {
  const threadID = current.thread_id;
  if (previous?.threadID !== threadID) previous = undefined;
  let acceptedVersion = current.view_version;
  const items = new Map<string, ItemRecord>();
  for (const item of current.items ?? []) {
    if (items.has(item.id)) invalid('duplicate runtime item');
    const retained = previous?.retainedItem(item);
    items.set(item.id, retained ?? { item, bytes: utf8.encode(item.text ?? '').length, retained: Boolean(item.live) });
  }
  let order = [...items.keys()];
  let priorReading = previous?.readingState();
  const priorWindow = priorReading?.window;
  const priorTurns = new Map((priorReading?.turns ?? []).map(turn => [turn.turn_id, turn]));
  const archive = new Map<string, ItemRecord>();
  const sameLeaf = Boolean(current.window?.leaf_id && current.window.leaf_id === priorReading?.window?.leaf_id);
  // A matching sealed canonical item proves its preceding active-path prefix.
  // On a changed leaf keep only that prefix, never an unconfirmed suffix.
  const sharedPrefix = current.window?.leaf_id && priorReading?.window?.leaf_id
    ? Math.max(-1, ...priorReading.records.flatMap(record => {
      const incoming = items.get(record.item.id)?.item;
      return incoming && historyItemConfirmsPrefix(incoming, record.item) ? [incoming.ordinal] : [];
    })) : -1;
  const retainedPrefix = sameLeaf || sharedPrefix >= 0;
  if (!retainedPrefix) priorTurns.clear();
  const sharedCanonicalOrdinal = current.items?.find(item => item.ordinal === sharedPrefix)?.canonical_ordinal ?? -1;
  if (retainedPrefix) {
    for (const record of priorReading!.records) {
      if (items.has(record.item.id) || record.item.live || !sameLeaf && record.item.ordinal > sharedPrefix) continue;
      archive.set(record.item.id, record);
    }
  }
  const retainedWindows = retainedPrefix && priorWindow ? [priorWindow] : [];
  const compactions = new Map([...(retainedPrefix ? priorReading?.context_compactions?.filter(value => sameLeaf || value.canonical_ordinal <= sharedCanonicalOrdinal) ?? [] : []),
    ...initial.context_compactions ?? []].map(value => [value.operation_id, value]));
  const decorations = new Map([...(retainedPrefix ? priorReading?.timeline_decorations ?? [] : []),
    ...initial.timeline_decorations ?? []].map(value => [value.decoration_id, value]));
  let lastCompactions = priorReading?.context_compactions;
  let lastDecorations = priorReading?.timeline_decorations;
  priorReading = undefined;
  const readingDecorations = (source: FlowerThreadSnapshot) => {
    // Current-window metadata is authoritative, including explicit clearing.
    // Retain only metadata whose canonical anchor belongs to archived history.
    if (source.timeline_decorations !== undefined) {
      for (const [id, value] of decorations) if (!archive.has(value.anchor.message_id)) decorations.delete(id);
    }
    if (source.context_compactions !== undefined) {
      const archivedTurns = new Set([...archive.values()].map(record => record.item.turn_id));
      for (const [id, value] of compactions) if (!archivedTurns.has(value.turn_id)) compactions.delete(id);
    }
    for (const value of source.context_compactions ?? []) compactions.set(value.operation_id, value);
    for (const value of source.timeline_decorations ?? []) decorations.set(value.decoration_id, value);
    lastCompactions = retainEqualValue(lastCompactions, compactions.size ? [...compactions.values()] : source.context_compactions);
    lastDecorations = retainEqualValue(lastDecorations, decorations.size
      ? [...decorations.values()].filter(value => items.has(value.anchor.message_id) || archive.has(value.anchor.message_id)) : source.timeline_decorations);
    return {
      context_compactions: lastCompactions,
      timeline_decorations: lastDecorations,
    };
  };
  let readingOrder: string[] | undefined;
  const readingRecords = () => {
    readingOrder ??= [...new Set([...archive.keys(), ...items.keys()])].sort((a, b) =>
      (items.get(a) ?? archive.get(a))!.item.ordinal - (items.get(b) ?? archive.get(b))!.item.ordinal);
    return readingOrder.map(id => (items.get(id) ?? archive.get(id))!);
  };
  const readingWindow = (window: FlowerHistoryWindow | undefined) => {
    if (!window || !archive.size) return window;
    const records = readingRecords();
    return historyWindowForItems(window, retainedWindows, records.map(record => record.item));
  };
  const mergeTurns = (turns: readonly FlowerRuntimeTurn[] | undefined) => {
    if (!archive.size) return turns;
    const ids = new Set(readingRecords().map(record => record.item.turn_id));
    const byID = new Map([...priorTurns.values()].filter(turn => ids.has(turn.turn_id)).map(turn => [turn.turn_id, turn]));
    const positions = new Map(readingRecords().map(record => [record.item.id, record.item.ordinal]));
    const mergeMembership = (previous: readonly string[], incoming: readonly string[]) =>
      [...new Set([...previous.filter(id => archive.has(id)), ...incoming])].filter(id => positions.has(id))
        .sort((a, b) => positions.get(a)! - positions.get(b)!);
    for (const turn of turns ?? []) {
      const prior = byID.get(turn.turn_id);
      byID.set(turn.turn_id, prior ? { ...turn,
        final_boundary_complete: turn.final_boundary_complete || prior.run_id === turn.run_id && sameLeaf && prior.final_boundary_complete,
        intermediate_item_ids: mergeMembership(prior.intermediate_item_ids ?? [], turn.intermediate_item_ids ?? []),
        final_item_ids: mergeMembership(prior.run_id === turn.run_id ? prior.final_item_ids : [], turn.final_item_ids),
      } : turn);
    }
    return [...byID.values()].sort((a, b) => a.started_at.localeCompare(b.started_at));
  };
  let components: FlowerRuntimeCurrentView = { ...current, items: undefined };
  const messages = new Map<string, MessageRecord>();
  const makeMessage = (message: FlowerChatMessage) => {
    const prior = messages.get(message.id) ?? previous?.findMessage(message.id);
    message = retainThinkingTiming(message, prior?.value);
    if (prior) {
      const { text_source: _source, ...presentation } = readPresentationValue(prior.value);
      if (retainEqualValue(presentation, message) === presentation || advanceMessage(prior, message)) {
        messages.set(message.id, prior);
        return prior;
      }
    }
    const [revision, setRevision] = createSignal(0);
    const text = createMessageTextSource(revision, setRevision);
    const textSource = text.source;
    const [value, set] = createStore<MutableMessage>({ ...message, blocks: message.blocks ? [...message.blocks] : undefined, ...(message.role === 'assistant' && !message.blocks?.length ? { text_source: textSource } : {}) });
    const record = { value, set, appendText: text.append };
    messages.set(message.id, record);
    return record;
  };
  const present = (record: ItemRecord, message: FlowerChatMessage): FlowerChatMessage => ({ ...message,
    ...(message.body_pending && record.retained ? { body_pending: { ...message.body_pending, retained: true } } : {}),
    ...(record.displayText !== undefined ? record.item.kind === 'thinking'
      ? { blocks: [{ type: 'thinking' as const, content: record.displayText }] } : { content: record.displayText } : {}),
  });
  const retainedMessages = new Map(runtimeMessages(initial, { ...current, tool_call_previews: [], items: [...items.values()].filter(value => value.preview || value.item.body && value.retained).map(value => value.item) }).map(message => [message.id, present(items.get(message.id)!, message)]));
  let projectedMessages: readonly FlowerChatMessage[] = initial.messages.map(message =>
    makeMessage(retainThinkingTiming(retainedMessages.get(message.id) ?? message, message)).value);
  for (const [id] of archive) {
    const message = previous?.findMessage(id);
    if (message) messages.set(id, message);
  }
  const withReadingMessages = (observed: readonly FlowerChatMessage[]) => archive.size
    ? [...readingRecords().flatMap(record => messages.has(record.item.id) ? [messages.get(record.item.id)!.value] : []),
      ...observed.filter(message => !items.has(message.id) && !archive.has(message.id))] : observed;
  projectedMessages = withReadingMessages(projectedMessages);
  previous = undefined;
  const [thread, setThread] = createStore<{ -readonly [K in keyof FlowerThreadSnapshot]: FlowerThreadSnapshot[K] }>({ ...initial, ...readingDecorations(initial), messages: projectedMessages, turns: mergeTurns(initial.turns), history_window: readingWindow(current.window) });
  projectedMessages = thread.messages;
  const updateMessage = (message: FlowerChatMessage, rebuildMembership = true) => {
    const prior = messages.get(message.id);
    const value = makeMessage(message).value;
    if (value === prior?.value || !rebuildMembership) return;
    projectedMessages = projectedMessages.map(previous => previous.id === value.id ? value : previous);
    setThread('messages', projectedMessages);
    projectedMessages = thread.messages;
  };

  return {
    threadID,
    get version() { return acceptedVersion; },
    item(id: string) { return (items.get(id) ?? archive.get(id))?.item; },
    previewItem(id: string) { const record = items.get(id) ?? archive.get(id); return record?.preview ?? record?.item; },
    itemIDs(): readonly string[] { return [...order]; },
    retainedItem(item: FlowerRuntimeCurrentItem) {
      return retainBody(items.get(item.id) ?? archive.get(item.id), item);
    },
    readingState() { return { window: thread.history_window, records: readingRecords(), turns: thread.turns ?? [],
      context_compactions: thread.context_compactions, timeline_decorations: thread.timeline_decorations }; },
    readingItemIDs(): readonly string[] { return readingRecords().map(record => record.item.id); },
    acceptPage(page: FlowerHistoryPage, anchor: FlowerRuntimeCurrentItem) {
      // The request belongs to this document and its exact canonical anchor.
      // New live facts always win; a page cannot replace lifecycle or bodies.
      if ((items.get(anchor.id) ?? archive.get(anchor.id))?.item !== anchor) return false;
      if (page.thread_id !== threadID || !page.leaf_id || page.items.length > 150
        || page.first_item_id !== page.items[0]?.id || page.last_item_id !== page.items.at(-1)?.id
        || new Set(page.items.map(item => item.id)).size !== page.items.length
        || page.items.some((item, i) => !item.id || item.live || !Number.isSafeInteger(item.ordinal) || item.ordinal < 0
          || i > 0 && item.ordinal <= page.items[i - 1].ordinal)) invalid('invalid history page');
      for (const item of page.items) {
        const known = items.get(item.id) ?? archive.get(item.id);
        if (known && (known.item.ordinal !== item.ordinal || known.item.kind !== item.kind
          || known.item.turn_id !== item.turn_id || known.item.run_id !== item.run_id
          || known.item.canonical_ordinal !== item.canonical_ordinal)) invalid('history page identity changed');
      }
      const added = page.items.filter(item => !items.has(item.id) && !archive.has(item.id));
      if (added.some(item => historyItemNeedsObservation(item, page.turns))) invalid('unobserved mutable history item');
      const projected = runtimeMessages(thread, { ...components, tool_call_previews: [], items: added });
      batch(() => {
        if (added.length) readingOrder = undefined;
        for (const item of added) archive.set(item.id, { item, bytes: utf8.encode(item.text ?? '').length });
        for (const message of projected) makeMessage(message);
        for (const turn of page.turns ?? []) {
          const prior = priorTurns.get(turn.turn_id);
          priorTurns.set(turn.turn_id, prior ? { ...turn,
            intermediate_item_ids: [...new Set([...(prior.intermediate_item_ids ?? []), ...(turn.intermediate_item_ids ?? [])])],
            final_item_ids: [...new Set([...(prior.run_id === turn.run_id ? prior.final_item_ids : []), ...turn.final_item_ids])] } : turn);
        }
        retainedWindows.push({ leaf_id: page.leaf_id, first_item_id: page.first_item_id, last_item_id: page.last_item_id, has_before: page.has_before, has_after: page.has_after });
        // Keep only the two outer coverage proofs, not one object per page.
        if (retainedWindows.length > 2) {
          const records = readingRecords();
          const first = records[0]?.item.id, last = records.at(-1)?.item.id;
          const before = retainedWindows.find(value => value.first_item_id === first);
          const after = retainedWindows.find(value => value.last_item_id === last);
          retainedWindows.splice(0, retainedWindows.length, ...[before, after].filter((value): value is FlowerHistoryWindow => Boolean(value)));
        }
        projectedMessages = withReadingMessages(projectedMessages);
        setThread({ messages: projectedMessages, turns: mergeTurns(components.turns ?? []), history_window: readingWindow(components.window) });
        projectedMessages = thread.messages;
      });
      return true;
    },
    hydrate(expected: FlowerRuntimeCurrentItem, loaded: FlowerRuntimeCurrentItem) {
      const before = items.get(expected.id) ?? archive.get(expected.id);
      const source = before?.item.body ?? before?.preview?.body;
      if (expected.body && (!source || source.run_id !== expected.body.run_id || source.source_id !== expected.body.source_id
        || source.entry_id !== expected.body.entry_id || source.field !== expected.body.field)) return false;
      // A response may finish after a newer live replacement or navigation.
      if (!before || before.item !== expected && (!expected.body || !sameItem(before.item, expected)
        || Boolean(before.item.live) !== Boolean(expected.live) || before.item.canonical_ordinal !== expected.canonical_ordinal
        || !retainBody(before, expected))) return false;
      if (loaded.id !== expected.id || loaded.turn_id !== expected.turn_id || loaded.run_id !== expected.run_id
        || loaded.kind !== expected.kind || loaded.ordinal !== expected.ordinal || loaded.canonical_ordinal !== expected.canonical_ordinal || Boolean(loaded.live) !== Boolean(expected.live) || loaded.body || loaded.activity_bodies?.length) invalid('expanded item identity differs');
      if (expected.body && !(loaded.text ?? '').startsWith((before.preview ?? expected).text ?? '')) return false;
      const bytes = utf8.encode(loaded.text ?? '').length;
      if (expected.body?.run_id && bytes < before.bytes) return false;
      if (expected.activity && (loaded.activity?.tool_id !== expected.activity.tool_id || loaded.activity?.status !== expected.activity.status || loaded.activity?.ended_at_unix_ms !== expected.activity.ended_at_unix_ms)) return false;
      const pending = before.item.body;
      const item = { ...loaded, ...(pending?.run_id && pending.bytes > bytes ? { body: pending } : {}) };
      const after = { item, bytes, preview: before.preview ?? expected, retained: true };
      const projected = runtimeMessages(thread, { ...components, items: [item] }).find(message => message.id === loaded.id);
      if (!projected) invalid('expanded item has no presentation');
      batch(() => {
        (items.has(loaded.id) ? items : archive).set(loaded.id, after);
        updateMessage(present(after, projected));
      });
      return true;
    },
    bodyOffset(id: string) { return (items.get(id) ?? archive.get(id))?.bytes; },
    appendBody(chunk: FlowerHistoryBodyChunk): HistoryBodyAppendResult {
      const before = items.get(chunk.item_id) ?? archive.get(chunk.item_id);
      const body = before?.item.body ?? before?.preview?.body;
      if (!before || !body || chunk.thread_id !== threadID || chunk.run_id !== body.run_id
        || chunk.source_id !== body.source_id || chunk.entry_id !== body.entry_id || chunk.field !== body.field) return 'superseded';
      const size = utf8.encode(chunk.text).length;
      if ((!size && chunk.offset_bytes !== chunk.through_bytes) || size > 16 * 1024 || !version(chunk.bytes) || !version(chunk.through_bytes)
        || !version(chunk.offset_bytes) || chunk.offset_bytes > before.bytes
        || chunk.offset_bytes + size > chunk.through_bytes || chunk.through_bytes > body.bytes || chunk.through_bytes > chunk.bytes) invalid('invalid body chunk extent');
      if (chunk.offset_bytes < before.bytes) {
        // Only a raced response inspects the cached suffix. Ordinary chunks
        // never encode the growing document again. Validate overlap before
        // yielding; the next read starts at the cache's authoritative offset.
        const distance = before.bytes - chunk.offset_bytes;
        const tail = utf8.encode((before.item.text ?? '').slice(-distance));
        const incoming = utf8.encode(chunk.text);
        const start = tail.length - distance;
        if ((tail[start] & 0xc0) === 0x80) invalid('body chunk starts inside a UTF-8 code point');
        for (let index = 0; index < Math.min(size, distance); index++) {
          if (tail[start + index] !== incoming[index]) invalid('body chunk conflicts with its cached prefix');
        }
        if (size < distance && (tail[start + size] & 0xc0) === 0x80) invalid('body chunk ends inside a UTF-8 code point');
        return 'covered';
      }
      if (!before.item.body) return 'covered';
      const bytes = before.bytes + size;
      const item = { ...before.item, text: (before.item.text ?? '') + chunk.text, body: bytes < (body.run_id ? body.bytes : Math.min(body.bytes, chunk.bytes)) ? body : undefined };
      // A sealed historical body is one document, not a stream. Keep its
      // loading presentation (or already readable text) until the complete
      // source is available; partial Markdown would visibly reflow per chunk.
      const staged = !before.item.live || before.displayText !== undefined;
      const after = { item, bytes, preview: before.preview ?? before.item,
        retained: before.retained || !staged || !item.body,
        ...(item.body && staged ? { displayText: before.displayText ?? before.item.text ?? '' } : {}) };
      batch(() => {
        (items.has(item.id) ? items : archive).set(item.id, after);
        if (staged) {
          if (item.body) return;
          const projected = runtimeMessages(thread, { ...components, items: [item] }).find(message => message.id === item.id);
          if (!projected) invalid('sealed item has no presentation');
          updateMessage(present(after, projected));
          return;
        }
        const message = messages.get(item.id)!;
        if (item.kind === 'thinking') message.set('blocks', 0, { content: item.text ?? '' });
        else { message.set('content', item.text); message.appendText(chunk.text); }
        message.set('body_pending', item.body ? { kind: 'text', bytes: body.bytes, retained: true } : undefined);
      });
      return 'applied';
    },
    findMessage(id: string) { return messages.get(id); },
    initializeThread(): FlowerThreadSnapshot { return thread; },
    syncAdjuncts(source: FlowerThreadSnapshot) {
      batch(() => {
        setThread(readingDecorations(source));
        for (const key of Object.keys(source) as (keyof FlowerThreadSnapshot)[]) {
          if (key !== 'messages' && key !== 'turns' && key !== 'history_window' && key !== 'context_compactions' && key !== 'timeline_decorations' && !Object.is(thread[key], source[key])) setThread({ [key]: source[key] });
        }
      });
      return thread;
    },
    syncMetadata(source: FlowerThreadSnapshot) {
      batch(() => {
        for (const key of ['title', 'title_status', 'title_generation', 'read_status', 'model_id', 'working_dir', 'pinned_at_ms', 'pin_rank', 'permission_type', 'reasoning_selection', 'reasoning_capability', 'settings_revision', 'updated_at_ms'] as const) {
          if (source[key] !== thread[key]) setThread({ [key]: source[key] });
        }
      });
      return thread;
    },
    apply(base: FlowerThreadSnapshot, update: FlowerRuntimeUpdate) {
      if (update.thread_id !== threadID || !version(update.base_version) || !version(update.view_version)
        || update.view_version <= update.base_version) invalid('invalid runtime update identity or version');
      if (update.view_version <= acceptedVersion) return undefined;
      if (update.base_version !== acceptedVersion) throw new FlowerLiveSyncError('Flower runtime update lost its baseline.');
      if (!update.facts || !['idle', 'active'].includes(update.facts.activity ?? '')
        || !Number.isSafeInteger(update.facts.queue_count) || update.facts.queue_count < 0) invalid('invalid runtime update facts');
      const staged = new Map<string, ItemRecord | undefined>();
      const read = (id: string) => staged.has(id) ? staged.get(id) : items.get(id);
      let structure = false;
      for (const change of update.items ?? []) {
        const id = change.item_id;
        if (typeof id !== 'string' || !id.trim()) invalid('runtime change requires item identity');
        const before = read(id);
        if (change.kind === 'append') {
          const append = change.append;
          if (!before || !append || change.item || !before.item.live
            || !['assistant', 'thinking'].includes(before.item.kind)
            || before.item.turn_id !== update.turn_id || before.item.run_id !== update.run_id
            || !Number.isSafeInteger(append.offset_bytes) || append.offset_bytes < 0
            || typeof append.text !== 'string') invalid('runtime text append has invalid identity or UTF-8 offset');
          if (append.offset_bytes !== before.bytes) throw new FlowerLiveSyncError('Flower runtime append lost its UTF-8 baseline.');
          staged.set(id, { item: { ...before.item, text: (before.item.text ?? '') + append.text }, bytes: before.bytes + utf8.encode(append.text).length });
        } else if (change.kind === 'body') {
          if (!before || !change.body || change.item || change.append) invalid('invalid body locator update');
          const preview = before.preview ?? before.item;
          const source = before.item.body ?? before.preview?.body;
          if (!source || change.body.run_id !== source.run_id || change.body.source_id !== source.source_id
            || change.body.entry_id !== source.entry_id || change.body.field !== source.field
            || !version(change.body.bytes) || change.body.bytes < source.bytes) invalid('body source changed during growth');
          staged.set(id, { ...before, item: { ...before.item, body: change.body.bytes > before.bytes ? change.body : undefined }, preview: { ...preview, body: change.body } });
        } else if (change.kind === 'remove') {
          if (!before || change.item || change.append) invalid('runtime removal requires an existing item');
          staged.set(id, undefined); structure = true;
        } else if (change.kind === 'add' || change.kind === 'replace') {
          const item = change.item;
          if (!item || item.id !== id || change.append || (change.kind === 'add' ? Boolean(before) : !before)) invalid('runtime replacement has invalid item identity');
          if (!Number.isSafeInteger(item.ordinal) || item.ordinal < 0) invalid('runtime item requires an ordinal');
          staged.set(id, retainBody(before, item) ?? { item, bytes: utf8.encode(item.text ?? '').length, retained: Boolean(item.live) });
          structure ||= change.kind === 'add' || before?.item.ordinal !== item.ordinal;
        } else invalid('unknown runtime item change');
      }
      let nextOrder = order;
      if (structure || update.item_order) {
        const all = new Map(items);
        for (const [id, record] of staged) { if (record) all.set(id, record); else all.delete(id); }
        nextOrder = update.item_order ? [...update.item_order.value] : [...all].sort((a, b) => a[1].item.ordinal - b[1].item.ordinal).map(([id]) => id);
        if (new Set(nextOrder).size !== all.size || nextOrder.length !== all.size || nextOrder.some(id => !all.has(id))) invalid('runtime item order is incomplete');
      }
      let next: FlowerRuntimeCurrentView = {
        ...components, ...update.facts, thread_id: update.thread_id, turn_id: update.turn_id, run_id: update.run_id, view_version: update.view_version,
        turn_kind: update.facts.turn_kind, last_outcome: update.facts.last_outcome, cancellation: update.facts.cancellation,
        run_progress: update.facts.run_progress, sampled_at_ms: update.facts.sampled_at_ms, error: update.facts.error,
        run_error_code: update.facts.run_error_code, run_error_detail: update.facts.run_error_detail,
        ...(update.goal ? { goal: update.goal.value ?? undefined } : {}),
        ...(update.parent_events ? { parent_events: update.parent_events.value ?? undefined } : {}),
        ...(update.turns ? { turns: update.turns.value ?? [] } : {}),
        ...(update.queue ? { queue: update.queue.value ?? [] } : {}),
        ...(update.interactions ? { interactions: update.interactions.value ?? [] } : {}),
        ...(update.tool_call_previews ? { tool_call_previews: update.tool_call_previews.value ?? [] } : {}),
        ...(update.restored_inputs ? { restored_inputs: update.restored_inputs.value ?? [] } : {}),
      };
      if (next.window && (structure || update.item_order)) {
        next = { ...next, window: { ...next.window, first_item_id: nextOrder[0], last_item_id: nextOrder.at(-1) } };
      }
      const priorPreviews = update.tool_call_previews ? flowerCurrentToolCallPreviews(components) : [];
      const nextPreviews = update.tool_call_previews ? flowerCurrentToolCallPreviews(next) : [];
      const previewGrowth = Boolean(update.tool_call_previews) && priorPreviews.length > 0
        && priorPreviews.length === nextPreviews.length && priorPreviews.every((call, index) => {
          const value = nextPreviews[index];
          return messages.get(`tool:${call.turn_id}:${call.call_id}`)?.value.blocks?.[0]?.type === 'tool-call-preview'
            && !call.arguments_complete && !value.arguments_complete && call.thread_id === value.thread_id
            && call.turn_id === value.turn_id && call.run_id === value.run_id && call.logical_request_id === value.logical_request_id
            && call.attempt_id === value.attempt_id && call.attempt_epoch === value.attempt_epoch
            && call.call_id === value.call_id && call.name === value.name;
        });
      const affected = new Set(staged.keys());
      // Tool decoration depends on interactions and argument previews, never on
      // ordinary text growth. Revisit only tools at these explicit boundaries.
      if (update.interactions || update.tool_call_previews && !previewGrowth) {
        for (const [id, record] of items) if (record.item.kind === 'tool') affected.add(id);
      }
      const bodyOnly = new Set((update.items ?? []).filter(change => change.kind === 'body').map(change => change.item_id));
      for (const change of update.items ?? []) if (change.kind !== 'body') bodyOnly.delete(change.item_id);
      const appendOnly = new Set((update.items ?? []).filter(change => change.kind === 'append').map(change => change.item_id));
      // A replacement followed by growth requires a complete local projection.
      for (const change of update.items ?? []) if (change.kind !== 'append') appendOnly.delete(change.item_id);
      const replacements = new Map<string, FlowerChatMessage | undefined>();
      for (const id of affected) {
        const record = read(id);
        const before = messages.get(id)?.value;
        replacements.set(id, record && before && appendOnly.has(id)
          ? record.item.kind === 'thinking'
            ? { ...before, blocks: [{ type: 'thinking', content: record.item.text ?? '' }] }
            : { ...before, content: record.item.text ?? '' }
          : record ? runtimeMessages(base, { ...next, items: [record.item] }).map(message => present(record, message)).find(message => message.id === id) : undefined);
      }
      let turns = base.turns;
      const turnsChanged = Boolean(update.turns) || structure || (update.items ?? []).some(change => change.kind === 'replace');
      if (turnsChanged) {
        const validated = validateFlowerRuntimeTurns({ ...next, items: nextOrder.map(id => read(id)!.item) });
        const priorTurns = base.turns && readPresentationValue(base.turns);
        const prior = new Map(priorTurns?.map(turn => [turn.turn_id, readPresentationValue(turn)]));
        const retained = validated.map(turn => retainEqualValue(prior.get(turn.turn_id), turn));
        turns = priorTurns?.length === retained.length && retained.every((turn, index) => turn === readPresentationValue(priorTurns[index]))
          ? base.turns : retained;
      }
      const projectionView = update.interactions ? { ...next, items: [...items.keys()].flatMap(id => {
        const record = read(id);
        return record?.item.kind === 'tool' ? [record.item] : [];
      }) } : next;
      const projected = projectFlowerRuntimeComponents(base, projectionView, update.context?.value ?? {}, update);
      const previewChanged = Boolean(update.tool_call_previews) && !previewGrowth || components.turn_id !== next.turn_id || components.run_id !== next.run_id;
      const previews = previewChanged ? runtimeMessages(base, { ...next, items: [] }).filter(message => !nextOrder.some(id => {
        const item = read(id)!.item;
        return item.kind === 'tool' && item.turn_id === message.turn_id && item.run_id === message.run_id && `tool:${item.turn_id}:${item.activity?.tool_id}` === message.id;
      })) : undefined;
      if (previews) {
        for (const message of projectedMessages) if (message.blocks?.[0]?.type === 'tool-call-preview') replacements.set(message.id, undefined);
        for (const message of previews) replacements.set(message.id, message);
      }
      structure ||= (update.items ?? []).some(change => change.kind === 'replace') || Boolean(previews) || [...replacements].some(([id, message]) => Boolean(messages.has(id)) !== Boolean(message));
      let result!: FlowerThreadSnapshot;
      batch(() => {
        if (structure || update.item_order) readingOrder = undefined;
        for (const [id, record] of staged) { if (record) items.set(id, record); else items.delete(id); }
        if (previewGrowth) for (const call of nextPreviews) {
          const message = messages.get('tool:' + call.turn_id + ':' + call.call_id);
          if (message?.value.blocks?.[0]?.type === 'tool-call-preview') message.set('blocks', 0, block => ({ ...block, call }));
        }
        for (const [id, message] of replacements) {
          const previous = messages.get(id);
          if (!message) messages.delete(id);
          else if (previous && bodyOnly.has(id)) previous.set('body_pending', message.body_pending);
          else if (previous && appendOnly.has(id)) {
            if (read(id)!.item.kind === 'thinking') previous.set('blocks', 0, { content: read(id)!.item.text ?? '' });
            else {
              previous.set('content', read(id)!.item.text ?? '');
              for (const change of update.items ?? []) if (change.item_id === id && change.kind === 'append') previous.appendText(change.append!.text);
            }
          }
          // Structural replacements publish their complete ordered membership once below.
          else if (previous) updateMessage(message, !(structure || update.item_order));
          else makeMessage(message);
        }
        if (structure || update.item_order) {
          projectedMessages = [...nextOrder.flatMap(id => messages.has(id) ? [messages.get(id)!.value] : []),
            ...(previews ?? projectedMessages.filter(message => message.blocks?.[0]?.type === 'tool-call-preview')).flatMap(message => messages.has(message.id) ? [messages.get(message.id)!.value] : [])];
        }
        if (structure || update.item_order) projectedMessages = withReadingMessages(projectedMessages);
        components = next; order = nextOrder; acceptedVersion = update.view_version;
        // Historical membership, metadata and turn boundaries do not depend on
        // text growth. Preserve their identities so an append neither sorts the
        // retained document nor invalidates every completed timeline section.
        const membershipChanged = structure || Boolean(update.item_order);
        const incoming = { ...projected,
          ...(membershipChanged || update.context ? readingDecorations(projected) : {}),
          history_window: membershipChanged ? readingWindow(next.window) : thread.history_window,
          messages: projectedMessages, turns: turnsChanged ? mergeTurns(turns) : thread.turns };
        for (const key of Object.keys(incoming) as (keyof FlowerThreadSnapshot)[]) {
          if (!Object.is(thread[key], incoming[key])) setThread({ [key]: incoming[key] });
        }
        projectedMessages = thread.messages;
        result = thread;
      });
      return { thread: result, changedIDs: affected, structure, observation: { ...next, items: [...staged.values()].flatMap(record => record ? [record.item] : []) } };
    },
  };
}

export type RuntimeThreadRecord = ReturnType<typeof createRuntimeThreadRecord>;
