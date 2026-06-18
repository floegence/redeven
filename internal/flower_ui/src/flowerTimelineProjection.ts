import type {
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerInputRequest,
  FlowerThreadError,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
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
    type: 'error';
    key: string;
    error: FlowerThreadError;
  }>;

export type FlowerTimelineEntryIdentityCache = Map<string, {
  signature: string;
  entry: FlowerTimelineEntry;
}>;

function stableSignatureValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableSignatureValue).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.entries(record)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSignatureValue(item)}`)
    .join(',')}}`;
}

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
      stableSignatureValue(item.payload),
      item.metadata ? Object.entries(item.metadata).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}:${value}`).join(',') : '',
    ].join(':')).join('|'),
  ].join('\x1e');
}

export function messageBlockSignature(block: NonNullable<FlowerChatMessage['blocks']>[number]): string {
  return block.type === 'activity-timeline'
    ? `activity:${activityTimelineSignature(block)}`
    : `${block.type}:${block.content ?? ''}`;
}

export function flowerMessageSignature(message: FlowerChatMessage): string {
  return [
    message.id,
    message.role,
    message.content,
    message.status,
    String(message.created_at_ms),
    message.blocks?.map(messageBlockSignature).join('\x1d') ?? '',
    stableSignatureValue(message.context_action),
  ].join('\x1e');
}

export function flowerTimelineEntrySignature(entry: FlowerTimelineEntry): string {
  switch (entry.type) {
    case 'message':
      return `message:${flowerMessageSignature(entry.message)}:${entry.blocks.map((block) => (
        block.type === 'content'
          ? `content:${block.key}:${block.block_index}:${block.block_type}:${block.content}`
          : `activity:${block.key}:${block.block_index}:${activityTimelineSignature(block.block)}`
      )).join('\x1d')}`;
    case 'input_request':
      return `input:${entry.request.prompt_id}:${stableSignatureValue(entry.request)}`;
    case 'error':
      return `error:${entry.error.code ?? ''}:${entry.error.message}`;
  }
}

function timelineEntryCacheKey(scope: string, key: string): string {
  return `${scope}\x1f${key}`;
}

export function preserveFlowerTimelineEntryIdentity(
  entries: readonly FlowerTimelineEntry[],
  cache: FlowerTimelineEntryIdentityCache,
  scope = '',
): readonly FlowerTimelineEntry[] {
  const visibleCacheKeys = new Set<string>();
  const stableEntries = entries.map((entry) => {
    const cacheKey = timelineEntryCacheKey(scope, entry.key);
    visibleCacheKeys.add(cacheKey);
    const signature = flowerTimelineEntrySignature(entry);
    const cached = cache.get(cacheKey);
    if (cached?.signature === signature) {
      return cached.entry;
    }
    cache.set(cacheKey, { signature, entry });
    return entry;
  });

  for (const key of Array.from(cache.keys())) {
    if (!visibleCacheKeys.has(key)) {
      cache.delete(key);
    }
  }

  return stableEntries;
}

function contentBlocksFromMessage(message: FlowerChatMessage): readonly FlowerRenderableMessageBlock[] {
  const projectedBlocks = (message.blocks ?? []).flatMap((block, index): readonly FlowerRenderableMessageBlock[] => {
    const key = `${message.id}:block:${index}`;
    if (block.type === 'activity-timeline') {
      if (block.items.length === 0) return [];
      return [{ type: 'activity', key, block_index: index, block }];
    }
    const content = trimString(block.content);
    return content ? [{ type: 'content', key, block_index: index, block_type: block.type, content }] : [];
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

export function buildFlowerTimelineEntries(thread: FlowerThreadSnapshot | null | undefined): readonly FlowerTimelineEntry[] {
  if (!thread) return [];
  const entries: FlowerTimelineEntry[] = thread.messages.flatMap((message): readonly FlowerTimelineEntry[] => {
    const blocks = contentBlocksFromMessage(message);
    if (blocks.length === 0 && message.status !== 'streaming' && message.status !== 'error') {
      return [];
    }
    return [{
      type: 'message',
      key: `message:${message.id}`,
      message,
      blocks,
    }];
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
