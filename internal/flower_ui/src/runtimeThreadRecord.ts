import { batch, createSignal } from 'solid-js';
import { createStore, type SetStoreFunction } from 'solid-js/store';
import type { FlowerChatMessage, FlowerHistoryBodyChunk, FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView, FlowerRuntimeUpdate, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { FlowerLiveSyncError } from './flowerLiveWire';
import { retainEqualValue } from './presentationIdentity';
import { projectFlowerRuntimeComponents, runtimeMessages, validateFlowerRuntimeTurns } from './runtimeCurrentView';
import { retainThinkingTiming } from './thinkingTiming';

type ItemRecord = { item: FlowerRuntimeCurrentItem; bytes: number; preview?: FlowerRuntimeCurrentItem; retained?: boolean };
type MutableMessage = { -readonly [K in keyof FlowerChatMessage]: FlowerChatMessage[K] };
type MessageRecord = { value: FlowerChatMessage; set: SetStoreFunction<MutableMessage>; chunks: string[]; setRevision: (value: number) => number };
const utf8 = new TextEncoder();

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
    || source && (source.source_id !== body.source_id || source.entry_id !== body.entry_id || source.field !== body.field)
    || body.run_id && body.run_id !== incoming.run_id
    || body.run_id && !(before.item.text ?? '').startsWith(incoming.text ?? '')) return;
  const sameLiveSource = Boolean(body.run_id) && body.run_id === (source?.run_id ?? before.item.run_id);
  return { item: { ...incoming, text: before.item.text, body: sameLiveSource && before.bytes >= body.bytes ? undefined : body },
    bytes: before.bytes, preview: incoming, retained: before.retained || !before.item.body || Boolean(incoming.live) };
}

// ThreadCache owns these records. There is no second raw current snapshot or
// lifecycle: components supply the shared projection, and items are indexed once.
export function createRuntimeThreadRecord(current: FlowerRuntimeCurrentView, initial: FlowerThreadSnapshot, previous?: { findMessage(id: string): MessageRecord | undefined; retainedItem(item: FlowerRuntimeCurrentItem): ItemRecord | undefined }) {
  const threadID = current.thread_id;
  let acceptedVersion = current.view_version;
  const items = new Map<string, ItemRecord>();
  for (const item of current.items ?? []) {
    if (items.has(item.id)) invalid('duplicate runtime item');
    const retained = previous?.retainedItem(item);
    items.set(item.id, retained ?? { item, bytes: utf8.encode(item.text ?? '').length, retained: Boolean(item.live) });
  }
  let order = [...items.keys()];
  let components: FlowerRuntimeCurrentView = { ...current, items: undefined };
  const messages = new Map<string, MessageRecord>();
  const makeMessage = (message: FlowerChatMessage) => {
    const prior = messages.get(message.id) ?? previous?.findMessage(message.id);
    message = retainThinkingTiming(message, prior?.value);
    if (prior) {
      const { text_source: _source, ...presentation } = prior.value;
      if (retainEqualValue(presentation, message) === presentation) {
        messages.set(message.id, prior);
        return prior;
      }
    }
    const chunks: string[] = [];
    const [revision, setRevision] = createSignal(0);
    const textSource = { get length() { return chunks.length; }, get revision() { return revision(); }, read(from: number) { return chunks.slice(from); } };
    const [value, set] = createStore<MutableMessage>({ ...message, ...(message.role === 'assistant' && !message.blocks?.length ? { text_source: textSource } : {}) });
    const record = { value, set, chunks, setRevision };
    messages.set(message.id, record);
    return record;
  };
  const present = (record: ItemRecord, message: FlowerChatMessage): FlowerChatMessage => message.body_pending && record.retained ? { ...message, body_pending: { ...message.body_pending, retained: true } } : message;
  const retainedMessages = new Map(runtimeMessages(initial, { ...current, tool_call_previews: [], items: [...items.values()].filter(value => value.preview || value.item.body && value.retained).map(value => value.item) }).map(message => [message.id, present(items.get(message.id)!, message)]));
  let projectedMessages: readonly FlowerChatMessage[] = initial.messages.map(message =>
    makeMessage(retainThinkingTiming(retainedMessages.get(message.id) ?? message, message)).value);
  previous = undefined;
  const [thread, setThread] = createStore<{ -readonly [K in keyof FlowerThreadSnapshot]: FlowerThreadSnapshot[K] }>({ ...initial, messages: projectedMessages });
  projectedMessages = thread.messages;
  const updateMessage = (message: FlowerChatMessage) => {
    const prior = messages.get(message.id);
    if (prior && !message.blocks?.length && !prior.value.blocks?.length && message.content.startsWith(prior.value.content)) {
      const suffix = message.content.slice(prior.value.content.length);
      if (suffix) prior.chunks.push(suffix);
      for (const key of new Set([...Object.keys(prior.value), ...Object.keys(message)])) {
        if (key !== 'text_source') prior.set({ [key]: message[key as keyof FlowerChatMessage] });
      }
      if (suffix) prior.setRevision(prior.chunks.length);
      return;
    }
    const value = makeMessage(message).value;
    projectedMessages = projectedMessages.map(previous => previous.id === value.id ? value : previous);
    setThread('messages', projectedMessages);
    projectedMessages = thread.messages;
  };

  return {
    get version() { return acceptedVersion; },
    item(id: string) { return items.get(id)?.item; },
    retainedItem(item: FlowerRuntimeCurrentItem) {
      return retainBody(items.get(item.id), item);
    },
    hydrate(expected: FlowerRuntimeCurrentItem, loaded: FlowerRuntimeCurrentItem) {
      const before = items.get(expected.id);
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
        items.set(loaded.id, after);
        updateMessage(present(after, projected));
      });
      return true;
    },
    bodyOffset(id: string) { return items.get(id)?.bytes; },
    appendBody(chunk: FlowerHistoryBodyChunk) {
      const before = items.get(chunk.source_id);
      const body = before?.item.body;
      if (!before || !body || chunk.thread_id !== threadID || chunk.run_id !== body.run_id
        || chunk.source_id !== body.source_id || chunk.offset_bytes !== before.bytes) return false;
      const size = utf8.encode(chunk.text).length;
      if (!size || size > 16 * 1024 || !version(chunk.through_bytes)
        || before.bytes + size > chunk.through_bytes || chunk.through_bytes > body.bytes) invalid('invalid body chunk extent');
      const bytes = before.bytes + size;
      const item = { ...before.item, text: (before.item.text ?? '') + chunk.text, body: bytes < body.bytes ? body : undefined };
      const after = { item, bytes, preview: before.preview ?? before.item, retained: true };
      batch(() => {
        items.set(item.id, after);
        const message = messages.get(item.id)!;
        if (item.kind === 'thinking') message.set('blocks', [{ type: 'thinking', content: item.text }]);
        else { message.set('content', item.text); message.chunks.push(chunk.text); message.setRevision(message.chunks.length); }
        message.set('body_pending', item.body ? { kind: 'text', bytes: body.bytes, retained: true } : undefined);
      });
      return true;
    },
    findMessage(id: string) { return messages.get(id); },
    initializeThread(): FlowerThreadSnapshot { return thread; },
    syncAdjuncts(source: FlowerThreadSnapshot) {
      batch(() => {
        for (const key of Object.keys(source) as (keyof FlowerThreadSnapshot)[]) {
          if (key !== 'messages' && key !== 'turns' && !Object.is(thread[key], source[key])) setThread({ [key]: source[key] });
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
      const affected = new Set(staged.keys());
      // Tool decoration depends on interactions and argument previews, never on
      // ordinary text growth. Revisit only tools at these explicit boundaries.
      if (update.interactions || update.tool_call_previews) {
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
      if (update.turns || structure || (update.items ?? []).some(change => change.kind === 'replace')) {
        const validated = validateFlowerRuntimeTurns({ ...next, items: nextOrder.map(id => read(id)!.item) });
        const prior = new Map(base.turns?.map(turn => [turn.turn_id, turn]));
        const retained = validated.map(turn => retainEqualValue(prior.get(turn.turn_id), turn));
        turns = base.turns?.length === retained.length && retained.every((turn, index) => turn === base.turns![index])
          ? base.turns : retained;
      }
      const projectionView = update.interactions ? { ...next, items: [...items.keys()].flatMap(id => {
        const record = read(id);
        return record?.item.kind === 'tool' ? [record.item] : [];
      }) } : next;
      const projected = projectFlowerRuntimeComponents(base, projectionView, update.context?.value ?? {}, update);
      const previewChanged = Boolean(update.tool_call_previews) || components.turn_id !== next.turn_id || components.run_id !== next.run_id;
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
        for (const [id, record] of staged) { if (record) items.set(id, record); else items.delete(id); }
        for (const [id, message] of replacements) {
          const previous = messages.get(id);
          if (!message) messages.delete(id);
          else if (previous && bodyOnly.has(id)) previous.set('body_pending', message.body_pending);
          else if (previous && appendOnly.has(id)) {
            if (read(id)!.item.kind === 'thinking') previous.set('blocks', message.blocks);
            else {
              previous.set('content', read(id)!.item.text ?? '');
              for (const change of update.items ?? []) if (change.item_id === id && change.kind === 'append') previous.chunks.push(change.append!.text);
              previous.setRevision(previous.chunks.length);
            }
          }
          else if (previous) updateMessage(message);
          else makeMessage(message);
        }
        if (structure || update.item_order) {
          projectedMessages = [...nextOrder.flatMap(id => messages.has(id) ? [messages.get(id)!.value] : []),
            ...(previews ?? projectedMessages.filter(message => message.blocks?.[0]?.type === 'tool-call-preview')).flatMap(message => messages.has(message.id) ? [messages.get(message.id)!.value] : [])];
        }
        components = next; order = nextOrder; acceptedVersion = update.view_version;
        const incoming = { ...projected, history_window: next.window, messages: projectedMessages, turns };
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
