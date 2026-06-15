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
  ].join('\x1e');
}

function contentBlocksFromMessage(message: FlowerChatMessage): readonly FlowerRenderableMessageBlock[] {
  const sourceBlocks = message.blocks?.length
    ? message.blocks
    : trimString(message.content)
      ? [{ type: 'markdown' as const, content: message.content }]
      : [];
  return sourceBlocks.flatMap((block, index): readonly FlowerRenderableMessageBlock[] => {
    const key = `${message.id}:block:${index}`;
    if (block.type === 'activity-timeline') {
      if (block.items.length === 0) return [];
      return [{ type: 'activity', key, block_index: index, block }];
    }
    const content = trimString(block.content);
    return content ? [{ type: 'content', key, block_index: index, block_type: block.type, content }] : [];
  });
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
