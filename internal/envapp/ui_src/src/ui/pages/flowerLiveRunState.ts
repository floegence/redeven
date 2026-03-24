import { applyStreamEventBatchToMessages } from '../chat/messageState';
import type { Message, MessageBlock, StreamEvent } from '../chat/types';

function hasVisibleString(value: unknown): boolean {
  return String(value ?? '').trim() !== '';
}

function hasVisibleLiveRunAnswerContent(block: MessageBlock): boolean {
  switch (block.type) {
    case 'markdown':
    case 'text':
    case 'code':
    case 'svg':
    case 'mermaid':
      return hasVisibleString(block.content);
    case 'code-diff':
      return hasVisibleString(block.oldCode) || hasVisibleString(block.newCode);
    case 'image':
      return hasVisibleString(block.src);
    case 'file':
      return hasVisibleString(block.name);
    default:
      return false;
  }
}

export function isLiveRunAnswerBlock(block: MessageBlock): boolean {
  switch (block.type) {
    case 'markdown':
    case 'text':
    case 'code':
    case 'code-diff':
    case 'image':
    case 'file':
    case 'svg':
    case 'mermaid':
      return true;
    default:
      return false;
  }
}

function hasVisibleLiveRunMessageContent(message: Message | null | undefined): boolean {
  if (!message) {
    return false;
  }
  return message.blocks.some((block) => (
    (isLiveRunAnswerBlock(block) && hasVisibleLiveRunAnswerContent(block))
    || (block.type !== 'thinking' && !isLiveRunAnswerBlock(block))
  )) || hasVisibleString(message.error);
}

function normalizeLiveRunMessage(message: Message | null | undefined): Message | null {
  if (!message || message.role !== 'assistant') {
    return null;
  }
  if (message.status === 'streaming') {
    return message;
  }
  return hasVisibleLiveRunMessageContent(message) ? message : null;
}

export function applyStreamEventBatchToLiveRunMessage(
  current: Message | null,
  events: StreamEvent[],
  now = Date.now(),
): Message | null {
  if (events.length <= 0) {
    return current;
  }

  const result = applyStreamEventBatchToMessages(
    current ? [current] : [],
    events,
    {
      currentStreamingMessageId: current?.status === 'streaming' ? current.id : null,
      now,
    },
  );

  const next = result.messages.find((message) => message.role === 'assistant') ?? null;
  return normalizeLiveRunMessage(next);
}

export function mergeLiveRunSnapshot(current: Message | null, snapshot: Message | null | undefined): Message | null {
  if (!snapshot || snapshot.role !== 'assistant') {
    return current;
  }
  const normalizedSnapshot = normalizeLiveRunMessage(snapshot);
  if (!normalizedSnapshot) {
    return null;
  }
  if (!current) {
    return normalizedSnapshot;
  }
  if (String(current.id ?? '').trim() && String(normalizedSnapshot.id ?? '').trim() !== String(current.id ?? '').trim()) {
    return normalizedSnapshot;
  }
  return normalizedSnapshot;
}

export function clearLiveRunMessageIfTranscriptCaughtUp(
  current: Message | null,
  transcriptMessages: Message[],
): Message | null {
  if (!current) {
    return current;
  }
  const currentId = String(current.id ?? '').trim();
  if (!currentId) {
    return current;
  }
  return transcriptMessages.some((message) => String(message?.id ?? '').trim() === currentId)
    ? null
    : current;
}

export function resolveRenderableLiveRunMessage(
  current: Message | null,
  transcriptMessages: Message[],
): Message | null {
  return clearLiveRunMessageIfTranscriptCaughtUp(current, transcriptMessages);
}
