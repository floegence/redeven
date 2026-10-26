import { untrack } from 'solid-js';
import { flowerToolCallPreviewIdentity } from './toolCallPreview';
import type {
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerCitationSource,
  FlowerInputRequest,
  FlowerParentEvent,
  FlowerQueuedTurn,
  FlowerTimelineDecoration,
  FlowerThreadError,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { flowerActivityIdentity } from './flowerActivityIdentity';
import { trimString } from './flowerSurfaceModel';
import { flowerAttachmentDisplayKind, safeFlowerAttachmentURL } from './attachments/flowerAttachmentPresentation';

export type FlowerRenderableMessageBlock =
  | Readonly<{
    type: 'tool_preview';
    key: string;
    block_index: number;
    block: Extract<NonNullable<FlowerChatMessage['blocks']>[number], { type: 'tool-call-preview' }>;
  }>
  | Readonly<{
    type: 'content';
    key: string;
    block_index: number;
    block_type: 'markdown' | 'text' | 'thinking';
    sources?: readonly FlowerCitationSource[];
    content: string;
  }>
  | Readonly<{
    type: 'activity';
    key: string;
    block_index: number;
    block: FlowerActivityTimelineBlock;
  }>
  | Readonly<{
    type: 'input_response';
    key: string;
    block_index: number;
    block: Extract<NonNullable<FlowerChatMessage['blocks']>[number], { type: 'input-response' }>;
  }>
  | Readonly<{
    type: 'image';
    key: string;
    block_index: number;
    src: string;
    alt?: string;
  }>
  | Readonly<{
    type: 'file';
    key: string;
    block_index: number;
    name: string;
    size?: number;
    mimeType: string;
    url?: string;
  }>;

export type FlowerTimelineEntry =
  | Readonly<{ type: 'parent_event'; key: string; event: FlowerParentEvent }>
  | Readonly<{
    type: 'message';
    key: string;
    message: FlowerChatMessage;
    blocks: readonly FlowerRenderableMessageBlock[];
  }>
  | Readonly<{
    type: 'input_request';
    key: string;
    request: FlowerInputRequest;
  }>
  | Readonly<{
    type: 'queued_turn';
    key: string;
    turn: FlowerQueuedTurn;
    blocks: readonly FlowerRenderableMessageBlock[];
  }>
  | Readonly<{
    type: 'context_compaction';
    key: string;
    decoration: Extract<FlowerTimelineDecoration, { kind: 'context_compaction' }>;
  }>
  | Readonly<{
    type: 'error';
    key: string;
    error: FlowerThreadError;
  }>;

export function flowerTimelineHasUserRejectedTool(entries: readonly FlowerTimelineEntry[]): boolean {
  return entries.some((entry) => (
    entry.type === 'message'
    && entry.blocks.some((block) => (
      block.type === 'activity'
      && block.block.items.some((item) => item.approval_state === 'rejected' || item.status === 'declined')
    ))
  ));
}

function activityRenderableKey(threadID: string, messageID: string, block: FlowerActivityTimelineBlock): string {
  const firstItem = block.items[0];
  if (!firstItem) {
    throw new Error('Flower activity block requires at least one item.');
  }
  if (!block.thread_id || block.thread_id !== threadID || !block.run_id || !block.turn_id) {
    throw new Error(`Flower activity block ${messageID} requires exact thread, run, and turn identity.`);
  }
  return `activity:${flowerActivityIdentity({
    threadID: block.thread_id,
    runID: block.run_id,
    turnID: block.turn_id,
    itemID: firstItem.kind === 'tool' && firstItem.tool_id ? firstItem.tool_id : firstItem.item_id,
  })}`;
}

function contentBlocksFromMessage(threadID: string, message: FlowerChatMessage): readonly FlowerRenderableMessageBlock[] {
  const projectedBlocks = (message.blocks ?? []).flatMap((block, index): readonly FlowerRenderableMessageBlock[] => {
    if (block.type === 'tool-call-preview') {
      if (block.call.thread_id !== threadID || block.call.run_id !== message.run_id || block.call.turn_id !== message.turn_id) {
        throw new Error('Flower contract error: tool argument preview and message identities differ.');
      }
      return [{ type: 'tool_preview', key: `activity:${flowerToolCallPreviewIdentity(block.call)}`, block_index: index, block }];
    }
    if (block.type === 'activity-timeline') {
      if (block.items.length === 0) return [];
      return [{ type: 'activity', key: activityRenderableKey(threadID, message.id, block), block_index: index, block }];
    }
    if (block.type === 'input-response') {
      return [{ type: 'input_response', key: `${message.id}:block:${index}`, block_index: index, block }];
    }
    if (block.type === 'image') {
      return [{
        type: 'image', key: `${message.id}:block:${index}`, block_index: index,
        src: block.src, ...(block.alt ? { alt: block.alt } : {}),
      }];
    }
    if (block.type === 'file') {
      return [{
        type: 'file', key: `${message.id}:block:${index}`, block_index: index,
        name: block.name, size: block.size, mimeType: block.mimeType, url: block.url,
      }];
    }
    const content = String(block.content ?? '');
    return content.trim() || message.live || message.body_pending?.kind === 'text' ? [{ type: 'content', key: `${message.id}:block:${index}`, block_index: index, block_type: block.type, get content() { return String((message.blocks?.[index] as { content?: string })?.content ?? ''); }, get sources() { return (message.blocks?.[index] as { sources?: readonly FlowerCitationSource[] })?.sources; } }] : [];
  });
  // Attachments do not represent the independent canonical message body.
  if (projectedBlocks.some(block => block.type !== 'image' && block.type !== 'file')) return projectedBlocks;

  const content = String(message.content ?? '');
  return content.trim() || message.live || message.body_pending?.kind === 'text'
    ? [...projectedBlocks, {
      type: 'content',
      key: `${message.id}:content`,
      block_index: message.blocks?.length ?? 0,
      block_type: 'markdown',
      get content() { return String(message.content ?? ''); },
      get sources() { return message.sources; },
    }]
    : projectedBlocks;
}

function queuedTurnBlocks(turn: FlowerQueuedTurn): readonly FlowerRenderableMessageBlock[] {
  const queueID = trimString(turn.queue_id);
  const blocks: FlowerRenderableMessageBlock[] = (turn.attachments ?? []).map((attachment, index) => {
    const mimeType = trimString(attachment.mime_type);
    const url = safeFlowerAttachmentURL(attachment.url);
    const attachmentID = trimString(attachment.attachment_id);
    const name = trimString(attachment.name);
    if (!attachmentID || !name || !mimeType || !Number.isFinite(attachment.size_bytes) || attachment.size_bytes < 0) {
      throw new Error(`Flower contract error: queued turn ${queueID} attachment ${index} is invalid.`);
    }
    if (flowerAttachmentDisplayKind(mimeType) === 'image' && url) {
      return {
        type: 'image', key: `queued-turn:${queueID}:attachment:${attachmentID}`, block_index: index,
        src: url, alt: name,
      };
    }
    return {
      type: 'file', key: `queued-turn:${queueID}:attachment:${attachmentID}`, block_index: index,
      name, size: attachment.size_bytes, mimeType, ...(url ? { url } : {}),
    };
  });
  const prompt = trimString(turn.prompt);
  if (prompt) {
    blocks.push({
      type: 'content', key: `queued-turn:${queueID}:content`, block_index: blocks.length,
      block_type: 'markdown', content: prompt,
    });
  }
  return blocks;
}

function activityCounts(items: readonly FlowerActivityTimelineBlock['items'][number][]): FlowerActivityTimelineBlock['summary']['counts'] {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    if (item.requires_approval) counts.approval = (counts.approval ?? 0) + 1;
  }
  return counts as FlowerActivityTimelineBlock['summary']['counts'];
}

function activityBlockSlice(
  threadID: string,
  messageID: string,
  block: Extract<FlowerRenderableMessageBlock, { type: 'activity' }>,
  start: number,
  end: number,
): Extract<FlowerRenderableMessageBlock, { type: 'activity' }> | null {
  const from = Math.max(0, Math.floor(start));
  const to = Math.max(from, Math.min(block.block.items.length, Math.floor(end)));
  const items = block.block.items.slice(from, to);
  if (items.length === 0) return null;
  const key = activityRenderableKey(threadID, messageID, {
    ...block.block,
    items,
  });
  return {
    type: 'activity',
    key,
    block_index: block.block_index,
    block: {
      ...block.block,
      summary: {
        ...block.block.summary,
        total_items: items.length,
        counts: activityCounts(items),
      },
      items,
    },
  };
}

type FlowerTimelineDecorationEntry = Extract<FlowerTimelineEntry, { type: 'context_compaction' }>;

function timelineDecorationEntry(decoration: FlowerTimelineDecoration): FlowerTimelineDecorationEntry {
  if (!trimString(decoration.decoration_id)) {
    throw new Error('Flower contract error: timeline decoration requires decoration_id.');
  }
  if (!trimString(decoration.compaction.operation_id)) {
    throw new Error('Flower contract error: context compaction decoration requires compaction payload.');
  }
  return {
    type: 'context_compaction',
    key: `timeline-decoration:${decoration.decoration_id}`,
    decoration,
  };
}

function timelineAnchorKey(decoration: FlowerTimelineDecoration): string {
  const anchor = decoration.anchor;
  const targetKind = trimString(anchor.target_kind);
  const messageID = trimString(anchor.message_id);
  const edge = trimString(anchor.edge);
  if (!messageID || (edge !== 'before' && edge !== 'after')) {
    throw new Error('Flower contract error: timeline decoration requires a valid timeline anchor.');
  }
  if (targetKind === 'message') {
    return `message:${messageID}:${edge}`;
  }
  if (targetKind === 'block' && anchor.block_index !== undefined) {
    return `block:${messageID}:${Math.max(0, Math.floor(Number(anchor.block_index)))}:${edge}`;
  }
  if (targetKind === 'activity_item' && anchor.block_index !== undefined && trimString(anchor.activity_item_id)) {
    return `activity-item:${messageID}:${Math.max(0, Math.floor(Number(anchor.block_index)))}:${trimString(anchor.activity_item_id)}:${edge}`;
  }
  throw new Error('Flower contract error: timeline decoration requires a valid timeline anchor.');
}

function decorationsByTimelineAnchor(
  decorations: readonly FlowerTimelineDecoration[],
): ReadonlyMap<string, readonly FlowerTimelineDecorationEntry[]> {
  const byAnchor = new Map<string, FlowerTimelineDecorationEntry[]>();
  const entries = decorations
    .map(timelineDecorationEntry)
    .sort((left, right) => left.decoration.compaction.canonical_ordinal - right.decoration.compaction.canonical_ordinal
      || left.decoration.decoration_id.localeCompare(right.decoration.decoration_id));

  for (const entry of entries) {
    const key = timelineAnchorKey(entry.decoration);
    byAnchor.set(key, [...(byAnchor.get(key) ?? []), entry]);
  }

  return byAnchor;
}

function timelineAnchorEntries(
  decorations: ReadonlyMap<string, readonly FlowerTimelineDecorationEntry[]>,
  key: string,
): readonly FlowerTimelineDecorationEntry[] {
  return decorations.get(key) ?? [];
}

function messageSegmentEntry(
  message: FlowerChatMessage,
  blocks: readonly FlowerRenderableMessageBlock[],
  segmentIndex: number,
  totalSegments: number,
): Extract<FlowerTimelineEntry, { type: 'message' }> | null {
  if (blocks.length === 0 && !message.goal && !message.references?.length && message.active_cursor !== true) return null;
  const activity = blocks.find((block) => block.type === 'activity' || block.type === 'tool_preview');
  return {
    type: 'message',
    key: activity?.key ?? (totalSegments <= 1 ? `message:${message.id}` : `message:${message.id}:segment:${segmentIndex}`),
    message,
    blocks,
  };
}

function messageTimelineEntries(
  threadID: string,
  message: FlowerChatMessage,
  decorations: ReadonlyMap<string, readonly FlowerTimelineDecorationEntry[]>,
): readonly FlowerTimelineEntry[] {
  const blocks = contentBlocksFromMessage(threadID, message);
  type RawTimelineEntry = readonly FlowerRenderableMessageBlock[] | FlowerTimelineDecorationEntry;
  const isMessageSegment = (entry: RawTimelineEntry): entry is readonly FlowerRenderableMessageBlock[] => Array.isArray(entry);
  const rawEntries: RawTimelineEntry[] = [];
  let currentBlocks: FlowerRenderableMessageBlock[] = [];
  let activeActivityBlock: Extract<FlowerRenderableMessageBlock, { type: 'activity' }> | null = null;
  let activeActivityStart = 0;
  let activeActivityEnd = 0;

  const flushActivity = () => {
    if (!activeActivityBlock) return;
    const sliced = activityBlockSlice(threadID, message.id, activeActivityBlock, activeActivityStart, activeActivityEnd);
    if (sliced) currentBlocks.push(sliced);
    activeActivityBlock = null;
    activeActivityStart = 0;
    activeActivityEnd = 0;
  };
  const flushMessageSegment = () => {
    flushActivity();
    if (message.goal || currentBlocks.length > 0 || message.references?.length || message.active_cursor === true) {
      rawEntries.push(currentBlocks);
      currentBlocks = [];
    }
  };
  const addDecorations = (entries: readonly FlowerTimelineDecorationEntry[]) => {
    if (entries.length === 0) return;
    flushMessageSegment();
    rawEntries.push(...entries);
  };
  const appendActivityItem = (block: Extract<FlowerRenderableMessageBlock, { type: 'activity' }>, itemIndex: number) => {
    if (activeActivityBlock !== block || itemIndex !== activeActivityEnd) {
      flushActivity();
      activeActivityBlock = block;
      activeActivityStart = itemIndex;
      activeActivityEnd = itemIndex;
    }
    activeActivityEnd = itemIndex + 1;
  };

  addDecorations(timelineAnchorEntries(decorations, `message:${message.id}:before`));
  for (const block of blocks) {
    const blockKeyBefore = `block:${message.id}:${block.block_index}:before`;
    const blockKeyAfter = `block:${message.id}:${block.block_index}:after`;
    addDecorations(timelineAnchorEntries(decorations, blockKeyBefore));
    if (block.type !== 'activity') {
      flushActivity();
      currentBlocks.push(block);
    } else {
      block.block.items.forEach((item, itemIndex) => {
        addDecorations(timelineAnchorEntries(decorations, `activity-item:${message.id}:${block.block_index}:${item.item_id}:before`));
        appendActivityItem(block, itemIndex);
        addDecorations(timelineAnchorEntries(decorations, `activity-item:${message.id}:${block.block_index}:${item.item_id}:after`));
      });
    }
    addDecorations(timelineAnchorEntries(decorations, blockKeyAfter));
  }
  addDecorations(timelineAnchorEntries(decorations, `message:${message.id}:after`));
  flushMessageSegment();

  const messageSegments = rawEntries.filter(Array.isArray) as readonly (readonly FlowerRenderableMessageBlock[])[];
  const totalSegments = messageSegments.length;
  let segmentIndex = 0;
  return rawEntries.flatMap((entry): readonly FlowerTimelineEntry[] => {
    if (!isMessageSegment(entry)) return [entry];
    const segment = messageSegmentEntry(message, entry, segmentIndex, totalSegments);
    segmentIndex += 1;
    return segment ? [segment] : [];
  });
}

const emptyDecorations: readonly FlowerTimelineDecoration[] = [];
type MessageProjection = Readonly<{
  threadID: string;
  activeCursor: boolean;
  decorations: readonly FlowerTimelineDecoration[];
  entries: readonly FlowerTimelineEntry[];
}>;
const messageProjections = new WeakMap<FlowerChatMessage, MessageProjection>();
const decorationProjections = new WeakMap<readonly FlowerTimelineDecoration[], ReadonlyMap<string, readonly FlowerTimelineDecorationEntry[]>>();
const decorationsByMessage = new WeakMap<readonly FlowerTimelineDecoration[], ReadonlyMap<string, readonly FlowerTimelineDecoration[]>>();
const parentEventProjections = new WeakMap<FlowerParentEvent, Extract<FlowerTimelineEntry, { type: 'parent_event' }>>();
const timelineProjections = new WeakMap<readonly FlowerChatMessage[], Readonly<{
  threadID: string;
  cursorID: string;
  decorations: readonly FlowerTimelineDecoration[];
  queued: FlowerThreadSnapshot['queued_turns'];
  input: FlowerThreadSnapshot['input_request'];
  error: FlowerThreadSnapshot['error'];
  status: FlowerThreadSnapshot['status'];
  parentEvents: readonly FlowerParentEvent[];
  entries: readonly FlowerTimelineEntry[];
}>>();
const queueProjections = new WeakMap<FlowerQueuedTurn, Readonly<{ threadID: string; entry: FlowerTimelineEntry }>>();

const emptyParentEvents: readonly FlowerParentEvent[] = [];

// A canonical Goal fact replaces its one successful invocation in the visible
// timeline. Ambiguous batches retain every tool row, including conflicts and
// reviews that never produced a committed completion. Source messages stay intact.
function coalesceGoalActivity(entries: readonly FlowerTimelineEntry[]): readonly FlowerTimelineEntry[] {
  const pending = new Map<string, FlowerTimelineEntry[]>();
  const replaced = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== 'message') continue;
    const { message } = entry;
    if (!message.turn_id || !message.run_id || message.canonical_ordinal === undefined) continue;
    const execution = JSON.stringify([message.turn_id, message.run_id]);
    if (message.goal) {
      const candidates = pending.get(execution) ?? [];
      pending.delete(execution);
      if (message.goal.actor !== 'model' || candidates.length !== 1) continue;
      const candidate = candidates[0];
      if (candidate.type !== 'message' || candidate.message.canonical_ordinal! >= message.canonical_ordinal) continue;
      const block = candidate.blocks[0];
      if (block.type !== 'activity') continue;
      const item = block.block.items[0];
      if (item.status === 'success' && !item.needs_attention && !item.requires_approval
        && !item.approval_state && !item.attention_reasons?.length
        && !item.payload?.error && !item.chips?.some(chip => chip.kind === 'effect_outcome' && chip.value === 'uncertain')
        && (item.severity === 'normal' || item.severity === 'quiet')) replaced.add(candidate.key);
      continue;
    }
    if (entry.blocks.length !== 1) continue;
    const block = entry.blocks[0];
    if (block.type !== 'activity' || block.block.items.length !== 1 || block.block.items[0].tool_name !== 'goal') continue;
    const candidates = pending.get(execution) ?? [];
    candidates.push(entry);
    pending.set(execution, candidates);
  }
  return replaced.size ? entries.filter(entry => !replaced.has(entry.key)) : entries;
}

function projectFlowerTimelineEntries(thread: FlowerThreadSnapshot | null | undefined, parentEvents = thread?.parent_events ? thread.parent_events.events : emptyParentEvents): readonly FlowerTimelineEntry[] {
  if (!thread) return [];
  const threadRunning = thread.status === 'running';
  const activeCursorMessageID = threadRunning
    ? [...thread.messages].reverse().find((message) => message.role === 'assistant' && message.active_cursor === true)?.id ?? ''
    : '';
  const sourceDecorations = thread.timeline_decorations ?? emptyDecorations;
  const input = thread.status === 'waiting_user' ? thread.input_request : undefined;
  const previous = timelineProjections.get(thread.messages);
  if (previous && previous.threadID === thread.thread_id && previous.cursorID === activeCursorMessageID
    && previous.decorations === sourceDecorations && previous.queued === thread.queued_turns
    && previous.input === input && previous.error === thread.error && previous.status === thread.status
    && previous.parentEvents === parentEvents) return previous.entries;
  let decorations = decorationProjections.get(sourceDecorations);
  if (!decorations) {
    decorations = decorationsByTimelineAnchor(sourceDecorations);
    decorationProjections.set(sourceDecorations, decorations);
  }
  let messageDecorations = decorationsByMessage.get(sourceDecorations);
  if (!messageDecorations) {
    const byMessage = new Map<string, FlowerTimelineDecoration[]>();
    for (const decoration of sourceDecorations) {
      const id = decoration.anchor.message_id;
      const values = byMessage.get(id);
      if (values) values.push(decoration); else byMessage.set(id, [decoration]);
    }
    messageDecorations = byMessage;
    decorationsByMessage.set(sourceDecorations, byMessage);
  }
  const seenMessageIDs = new Set<string>();
  const positions = new Map<string, number>();
  const entries: FlowerTimelineEntry[] = thread.messages.flatMap((message): readonly FlowerTimelineEntry[] => {
    const messageID = trimString(message.id);
    if (!messageID || seenMessageIDs.has(messageID)) return [];
    seenMessageIDs.add(messageID);
    const activeCursor = message.id === activeCursorMessageID;
    const prior = messageProjections.get(message);
    const localDecorations = messageDecorations.get(message.id) ?? emptyDecorations;
    let entries: readonly FlowerTimelineEntry[];
    if (prior && prior.threadID === thread.thread_id && prior.activeCursor === activeCursor
      && prior.decorations.length === localDecorations.length
      && prior.decorations.every((value, index) => value === localDecorations[index])) {
      entries = prior.entries;
    } else {
      const projectedMessage = activeCursor === message.active_cursor
        ? message
        // Cursor decoration must not snapshot reactive text/body fields.
        // This view lives as long as the cached message projection.
        : new Proxy(message, { get: (target, key, receiver) => key === 'active_cursor' ? activeCursor : Reflect.get(target, key, receiver) });
      entries = messageTimelineEntries(thread.thread_id, projectedMessage, decorations);
      messageProjections.set(message, { threadID: thread.thread_id, activeCursor, decorations: localDecorations, entries });
    }
    if (message.canonical_ordinal !== undefined) {
      for (const entry of entries) {
        const ordinal = entry.type === 'context_compaction' && entry.decoration.anchor.target_kind === 'message'
          && entry.decoration.anchor.edge === 'after'
          ? entry.decoration.compaction.canonical_ordinal : message.canonical_ordinal;
        positions.set(entry.key, ordinal);
      }
    }
    return entries;
  });
  // Canonical Path positions order messages, their anchored decorations and
  // receipts together. Uncommitted tail rows retain their original order.
  const seenEvents = new Set<string>();
  for (const event of parentEvents) {
    if (seenEvents.has(event.id)) continue;
    seenEvents.add(event.id);
    const key = 'parent-event:' + event.id;
    if (event.canonical_ordinal !== undefined) positions.set(key, event.canonical_ordinal);
    let projected = parentEventProjections.get(event);
    if (!projected) { projected = { type: 'parent_event', key, event }; parentEventProjections.set(event, projected); }
    entries.push(projected);
  }
  entries.sort((left, right) => {
    const a = positions.get(left.key), b = positions.get(right.key);
    return a === undefined ? b === undefined ? 0 : 1 : b === undefined ? -1 : a - b;
  });

  const queuedIDs = new Set<string>();
  for (const turn of thread.queued_turns ?? []) {
    const queueID = trimString(turn.queue_id);
    if (!queueID) throw new Error('Flower contract error: queued turn requires queue_id.');
    if (queuedIDs.has(queueID)) throw new Error(`Flower contract error: queued turn ${queueID} is duplicated.`);
    queuedIDs.add(queueID);
    const retained = queueProjections.get(turn);
    if (retained?.threadID === thread.thread_id) {
      entries.push(retained.entry);
      continue;
    }
    const blocks = queuedTurnBlocks(turn);
    if (blocks.length === 0) throw new Error(`Flower contract error: queued turn ${queueID} has no content.`);
    const entry: FlowerTimelineEntry = {
      type: 'queued_turn',
      key: `queued-turn:${thread.thread_id}:${queueID}`,
      turn,
      blocks,
    };
    queueProjections.set(turn, { threadID: thread.thread_id, entry });
    entries.push(entry);
  }
  if (thread.status === 'waiting_user' && thread.input_request) {
    entries.push({
      type: 'input_request',
      key: `input:${thread.input_request.prompt_id}`,
      request: thread.input_request,
    });
  }
  const error = thread.error ?? (thread.status === 'failed' ? { message: '' } : null);
  if (error && (thread.status === 'failed' || trimString(error.message))) {
    entries.push({
      type: 'error',
      key: `error:${error.code ?? 'run'}:${error.message}`,
      error,
    });
  }
  const visibleEntries = coalesceGoalActivity(entries);
  timelineProjections.set(thread.messages, {
    threadID: thread.thread_id, cursorID: activeCursorMessageID, decorations: sourceDecorations,
    queued: thread.queued_turns, input, error: thread.error, status: thread.status, parentEvents, entries: visibleEntries,
  });
  return visibleEntries;
}

// Content lives in indexed reactive records. Only structural inputs invalidate
// the timeline, so text growth never re-groups all historical turns or rows.
export function createFlowerTimelineProjection() {
  let prior: readonly unknown[] | undefined;
  let entries: readonly FlowerTimelineEntry[] = [];
  return (thread: FlowerThreadSnapshot | null | undefined, parentEvents = thread?.parent_events?.events ?? emptyParentEvents) => {
    const inputs = [thread?.thread_id, thread?.messages, thread?.status, thread?.timeline_decorations, thread?.queued_turns, thread?.input_request, thread?.error, parentEvents];
    if (prior && inputs.every((value, index) => value === prior![index])) return entries;
    prior = inputs;
    entries = untrack(() => projectFlowerTimelineEntries(thread, parentEvents));
    return entries;
  };
}

export function buildFlowerTimelineEntries(thread: FlowerThreadSnapshot | null | undefined, parentEvents = thread?.parent_events?.events ?? emptyParentEvents) {
  return untrack(() => projectFlowerTimelineEntries(thread, parentEvents));
}
