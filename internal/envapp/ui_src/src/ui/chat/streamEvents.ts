// Stream event utilities — forked from @floegence/floe-webapp-core/chat.

import type { MessageBlock, StreamEvent } from './types';

export interface StreamEventBuilder {
  messageStart: () => StreamEvent;
  blockStart: (blockIndex: number, blockType: MessageBlock['type']) => StreamEvent;
  blockDelta: (blockIndex: number, delta: string) => StreamEvent;
  blockSet: (blockIndex: number, block: MessageBlock) => StreamEvent;
  blockEnd: (blockIndex: number) => StreamEvent;
  messageEnd: () => StreamEvent;
  error: (error: string) => StreamEvent;
}

/**
 * Runtime validator for stream events.
 */
export function isStreamEvent(v: unknown): v is StreamEvent {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  const t = obj.type;
  if (typeof t !== 'string') return false;
  switch (t) {
    case 'message-start':
    case 'message-end':
    case 'error':
      return typeof obj.messageId === 'string';
    case 'block-start':
    case 'block-delta':
    case 'block-set':
    case 'block-end':
      return typeof obj.messageId === 'string' && typeof obj.blockIndex === 'number';
    default:
      return false;
  }
}

/**
 * Typed stream-event factory for a single assistant message.
 */
export function createStreamEventBuilder(messageId: string): StreamEventBuilder {
  return {
    messageStart: () => ({ type: 'message-start', messageId }),
    blockStart: (blockIndex, blockType) => ({ type: 'block-start', messageId, blockIndex, blockType }),
    blockDelta: (blockIndex, delta) => ({ type: 'block-delta', messageId, blockIndex, delta }),
    blockSet: (blockIndex, block) => ({ type: 'block-set', messageId, blockIndex, block }),
    blockEnd: (blockIndex) => ({ type: 'block-end', messageId, blockIndex }),
    messageEnd: () => ({ type: 'message-end', messageId }),
    error: (error) => ({ type: 'error', messageId, error }),
  };
}

/**
 * Append a local notice to the current assistant text block and close the message.
 */
export function buildAssistantNoticeEvents(args: {
  messageId: string;
  notice: string;
  blockIndex?: number;
  prefix?: string;
  includeMessageEnd?: boolean;
}): StreamEvent[] {
  const { messageId, notice, blockIndex = 0, prefix = '\n\n---\n\n', includeMessageEnd = true } = args;
  const events: StreamEvent[] = [
    { type: 'block-delta', messageId, blockIndex, delta: `${prefix}${notice}` },
  ];
  if (includeMessageEnd) {
    events.push({ type: 'message-end', messageId });
  }
  return events;
}
