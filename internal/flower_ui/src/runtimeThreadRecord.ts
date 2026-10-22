import { batch, createSignal } from 'solid-js';
import { createStore, type SetStoreFunction } from 'solid-js/store';
import type { FlowerChatMessage, FlowerRuntimeCurrentItem, FlowerRuntimeCurrentView, FlowerRuntimeUpdate, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { FlowerLiveSyncError } from './flowerLiveWire';
import { retainEqualValue } from './presentationIdentity';
import { projectFlowerRuntimeComponents, runtimeMessages, validateFlowerRuntimeTurns } from './runtimeCurrentView';

type ItemRecord = { item: FlowerRuntimeCurrentItem; bytes: number };
type MutableMessage = { -readonly [K in keyof FlowerChatMessage]: FlowerChatMessage[K] };
type MessageRecord = { value: FlowerChatMessage; set: SetStoreFunction<MutableMessage>; chunks: string[]; setRevision: (value: number) => number };
const utf8 = new TextEncoder();

function invalid(message: string): never { throw new Error(`Flower contract error: ${message}.`); }
function version(value: number) { return Number.isSafeInteger(value) && value >= 0; }

// ThreadCache owns these records. There is no second raw current snapshot or
// lifecycle: components supply the shared projection, and items are indexed once.
export function createRuntimeThreadRecord(current: FlowerRuntimeCurrentView, initial: FlowerThreadSnapshot, previous?: { findMessage(id: string): MessageRecord | undefined }) {
  const threadID = current.thread_id;
  let acceptedVersion = current.view_version;
  const items = new Map<string, ItemRecord>();
  for (const item of current.items ?? []) {
    if (items.has(item.id)) invalid('duplicate runtime item');
    items.set(item.id, { item, bytes: utf8.encode(item.text ?? '').length });
  }
  let order = [...items.keys()];
  let components: FlowerRuntimeCurrentView = { ...current, items: undefined };
  const messages = new Map<string, MessageRecord>();
  const makeMessage = (message: FlowerChatMessage) => {
    const prior = messages.get(message.id) ?? previous?.findMessage(message.id);
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
  let projectedMessages: readonly FlowerChatMessage[] = initial.messages.map(message => makeMessage(message).value);
  previous = undefined;
  const [thread, setThread] = createStore<{ -readonly [K in keyof FlowerThreadSnapshot]: FlowerThreadSnapshot[K] }>({ ...initial, messages: projectedMessages });
  projectedMessages = thread.messages;

  return {
    get version() { return acceptedVersion; },
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
        } else if (change.kind === 'remove') {
          if (!before || change.item || change.append) invalid('runtime removal requires an existing item');
          staged.set(id, undefined); structure = true;
        } else if (change.kind === 'add' || change.kind === 'replace') {
          const item = change.item;
          if (!item || item.id !== id || change.append || (change.kind === 'add' ? Boolean(before) : !before)) invalid('runtime replacement has invalid item identity');
          if (!Number.isSafeInteger(item.ordinal) || item.ordinal < 0) invalid('runtime item requires an ordinal');
          staged.set(id, { item, bytes: utf8.encode(item.text ?? '').length });
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
      const next: FlowerRuntimeCurrentView = {
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
      const affected = new Set(staged.keys());
      // Tool decoration depends on interactions and argument previews, never on
      // ordinary text growth. Revisit only tools at these explicit boundaries.
      if (update.interactions || update.tool_call_previews) {
        for (const [id, record] of items) if (record.item.kind === 'tool') affected.add(id);
      }
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
          : record ? runtimeMessages(base, { ...next, items: [record.item] }).find(message => message.id === id) : undefined);
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
          else if (previous && appendOnly.has(id)) {
            if (read(id)!.item.kind === 'thinking') previous.set('blocks', message.blocks);
            else {
              previous.set('content', read(id)!.item.text ?? '');
              for (const change of update.items ?? []) if (change.item_id === id && change.kind === 'append') previous.chunks.push(change.append!.text);
              previous.setRevision(previous.chunks.length);
            }
          }
          else makeMessage(message);
        }
        if (structure || update.item_order) {
          projectedMessages = [...nextOrder.flatMap(id => messages.has(id) ? [messages.get(id)!.value] : []),
            ...(previews ?? projectedMessages.filter(message => message.blocks?.[0]?.type === 'tool-call-preview')).flatMap(message => messages.has(message.id) ? [messages.get(message.id)!.value] : [])];
        }
        components = next; order = nextOrder; acceptedVersion = update.view_version;
        const incoming = { ...projected, messages: projectedMessages, turns };
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
