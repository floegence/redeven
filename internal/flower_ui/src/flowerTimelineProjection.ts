import type {
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerInputRequest,
  FlowerTimelineDecoration,
  FlowerThreadError,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { flowerActivityIdentity } from './flowerActivityIdentity';
import { trimString } from './flowerSurfaceModel';

export type FlowerRenderableMessageBlock =
  | Readonly<{
    type: 'content';
    key: string;
    block_index: number;
    block_type: 'markdown' | 'text' | 'thinking';
    content: string;
  }>
  | Readonly<{
    type: 'activity';
    key: string;
    block_index: number;
    block: FlowerActivityTimelineBlock;
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
    size: number;
    mimeType: string;
    url: string;
  }>;

export type FlowerTimelineEntry =
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
    type: 'context_compaction';
    key: string;
    decoration: Extract<FlowerTimelineDecoration, { kind: 'context_compaction' }>;
  }>
  | Readonly<{
    type: 'turn_projection_unavailable';
    key: string;
    decoration: Extract<FlowerTimelineDecoration, { kind: 'turn_projection_unavailable' }>;
  }>
  | Readonly<{
    type: 'error';
    key: string;
    error: FlowerThreadError;
  }>;

export function activityTimelineSignature(timeline: FlowerActivityTimelineBlock): string {
  return [
    timeline.run_id ?? '',
    timeline.turn_id ?? '',
    timeline.summary.status,
    timeline.summary.severity,
    String(timeline.summary.total_items),
    String(timeline.summary.duration_ms ?? ''),
    timeline.summary.needs_attention ? 'attention' : '',
    timeline.summary.attention_reasons?.join(',') ?? '',
    Object.entries(timeline.summary.counts).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}:${value}`).join('|'),
    timeline.file_actions
      ? Object.entries(timeline.file_actions)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, action]) => [key, action.action_id, action.display_name, action.can_preview ? 'preview' : '', action.can_browse_directory ? 'browse' : ''].join(','))
        .join('|')
      : '',
    timeline.items.map((item) => [
      item.item_id,
      item.tool_id ?? '',
      item.tool_name ?? '',
      item.kind,
      item.status,
      item.severity,
      item.needs_attention ? 'attention' : '',
      item.attention_reasons?.join(',') ?? '',
      item.requires_approval ? 'approval' : '',
      item.approval_state ?? '',
      String(item.started_at_unix_ms ?? ''),
      String(item.ended_at_unix_ms ?? ''),
      item.label ?? '',
      item.description ?? '',
      item.renderer ?? '',
      item.chips?.map((chip) => [chip.kind, chip.label, chip.value ?? '', chip.tone ?? ''].join(',')).join(';') ?? '',
      item.target_refs?.map((ref) => [ref.kind, ref.label, ref.uri ?? '', String(ref.line ?? '')].join(',')).join(';') ?? '',
      item.payload ? JSON.stringify(item.payload) : '',
      item.metadata ? Object.entries(item.metadata).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}:${value}`).join(',') : '',
    ].join(':')).join('|'),
  ].join('\x1e');
}

export function messageBlockSignature(block: NonNullable<FlowerChatMessage['blocks']>[number]): string {
  if (block.type === 'activity-timeline') return `activity:${activityTimelineSignature(block)}`;
  if (block.type === 'image') return `image:${block.src}:${block.alt ?? ''}`;
  if (block.type === 'file') return `file:${block.name}:${block.size}:${block.mimeType}:${block.url}`;
  return `${block.type}:${block.content ?? ''}`;
}

export function flowerMessageSignature(message: FlowerChatMessage): string {
  return [
    message.id,
    message.role,
    message.content,
    message.status,
    String(message.created_at_ms),
    message.blocks?.map(messageBlockSignature).join('\x1d') ?? '',
    message.context_action ? JSON.stringify(message.context_action) : '',
  ].join('\x1e');
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
    itemID: firstItem.item_id,
  })}`;
}

function contentBlocksFromMessage(threadID: string, message: FlowerChatMessage): readonly FlowerRenderableMessageBlock[] {
  const projectedBlocks = (message.blocks ?? []).flatMap((block, index): readonly FlowerRenderableMessageBlock[] => {
    if (block.type === 'activity-timeline') {
      if (block.items.length === 0) return [];
      return [{ type: 'activity', key: activityRenderableKey(threadID, message.id, block), block_index: index, block }];
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
    const content = trimString(block.content);
    return content ? [{ type: 'content', key: `${message.id}:block:${index}`, block_index: index, block_type: block.type, content }] : [];
  });
  if (projectedBlocks.length > 0) return projectedBlocks;

  const content = trimString(message.content);
  return content
    ? [{
      type: 'content',
      key: `${message.id}:content`,
      block_index: 0,
      block_type: 'markdown',
      content,
    }]
    : [];
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

function decorationSortKey(decoration: FlowerTimelineDecoration): string {
  return [
    String(Math.max(0, Math.floor(Number(decoration.ordinal ?? 0))).toString().padStart(8, '0')),
    trimString(decoration.decoration_id),
  ].join(':');
}

type FlowerTimelineDecorationEntry = Extract<FlowerTimelineEntry, { type: 'context_compaction' | 'turn_projection_unavailable' }>;

function timelineDecorationEntry(decoration: FlowerTimelineDecoration): FlowerTimelineDecorationEntry {
  if (!trimString(decoration.decoration_id)) {
    throw new Error('Flower contract error: timeline decoration requires decoration_id.');
  }
  switch (decoration.kind) {
    case 'context_compaction':
      if (!trimString(decoration.compaction.operation_id)) {
        throw new Error('Flower contract error: context compaction decoration requires compaction payload.');
      }
      return {
        type: 'context_compaction',
        key: `timeline-decoration:${decoration.decoration_id}`,
        decoration,
      };
    case 'turn_projection_unavailable':
      if (
        !trimString(decoration.projection_unavailable.turn_id)
        || !trimString(decoration.projection_unavailable.run_id)
        || !trimString(decoration.projection_unavailable.expected_message_id)
      ) {
        throw new Error('Flower contract error: unavailable projection decoration requires projection payload.');
      }
      return {
        type: 'turn_projection_unavailable',
        key: `timeline-decoration:${decoration.decoration_id}`,
        decoration,
      };
  }
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
    .sort((left, right) => decorationSortKey(left.decoration).localeCompare(decorationSortKey(right.decoration)));

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
  if (blocks.length === 0 && message.status !== 'error' && message.active_cursor !== true) return null;
  const activity = blocks.find((block): block is Extract<FlowerRenderableMessageBlock, { type: 'activity' }> => block.type === 'activity');
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
    if (currentBlocks.length > 0 || message.status === 'error' || message.active_cursor === true) {
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

export function buildFlowerTimelineEntries(thread: FlowerThreadSnapshot | null | undefined): readonly FlowerTimelineEntry[] {
  if (!thread) return [];
  const threadRunning = thread.status === 'running';
  const activeCursorMessageID = threadRunning
    ? [...thread.messages].reverse().find((message) => message.role === 'assistant' && message.active_cursor === true)?.id ?? ''
    : '';
  const decorations = decorationsByTimelineAnchor(thread.timeline_decorations ?? []);
  const entries: FlowerTimelineEntry[] = thread.messages.flatMap((message): readonly FlowerTimelineEntry[] => {
    const activeCursor = message.id === activeCursorMessageID;
    const projectedMessage = activeCursor === message.active_cursor
      ? message
      : { ...message, active_cursor: activeCursor };
    return messageTimelineEntries(thread.thread_id, projectedMessage, decorations);
  });
  if (thread.status === 'waiting_user' && thread.input_request) {
    entries.push({
      type: 'input_request',
      key: `input:${thread.input_request.prompt_id}`,
      request: thread.input_request,
    });
  }
  if (thread.error && trimString(thread.error.message)) {
    entries.push({
      type: 'error',
      key: `error:${thread.error.code ?? 'run'}:${thread.error.message}`,
      error: thread.error,
    });
  }
  return entries;
}
