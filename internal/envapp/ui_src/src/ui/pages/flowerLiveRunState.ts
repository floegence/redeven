import { applyStreamEventBatchToMessages } from '../chat/messageState';
import type { Message, MessageBlock, StreamEvent } from '../chat/types';
import { getMessageSourceId } from '../chat/messageIdentity';

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
  const normalized = normalizeLiveRunMessage(next);
  if (!normalized) {
    return normalized;
  }
  return current ? preserveVisibleAnswerBlocks(current, normalized) : normalized;
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
  return preserveVisibleAnswerBlocks(current, normalizedSnapshot);
}

export function clearLiveRunMessageIfTranscriptCaughtUp(
  current: Message | null,
  transcriptMessages: Message[],
): Message | null {
  if (!current) {
    return current;
  }
  const currentSourceId = getMessageSourceId(current);
  if (!currentSourceId) {
    return current;
  }
  return transcriptMessages.some((message) => getMessageSourceId(message) === currentSourceId)
    ? null
    : current;
}

function liveRunAnswerBlockScore(block: MessageBlock | null | undefined): number {
  if (!block || !isLiveRunAnswerBlock(block)) {
    return 0;
  }

  switch (block.type) {
    case 'markdown':
    case 'text':
    case 'code':
    case 'svg':
    case 'mermaid':
      return String(block.content ?? '').trim().length;
    case 'code-diff':
      return String(block.oldCode ?? '').trim().length + String(block.newCode ?? '').trim().length;
    case 'image':
      return String(block.src ?? '').trim().length;
    case 'file':
      return String(block.name ?? '').trim().length;
    default:
      return 0;
  }
}

function liveRunMessageAnswerScore(message: Message | null | undefined): number {
  if (!message) {
    return 0;
  }
  return message.blocks.reduce((score, block) => score + liveRunAnswerBlockScore(block), 0);
}

function sameLiveRunLineage(left: Message | null | undefined, right: Message | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  const leftSourceId = getMessageSourceId(left);
  const rightSourceId = getMessageSourceId(right);
  if (leftSourceId && rightSourceId && leftSourceId === rightSourceId) {
    return true;
  }

  const leftId = String(left.id ?? '').trim();
  const rightId = String(right.id ?? '').trim();
  if (leftId && rightId && leftId === rightId) {
    return true;
  }
  return !!leftSourceId && !!rightId && leftSourceId === rightId
    || (!!rightSourceId && !!leftId && rightSourceId === leftId);
}

function carryForwardVisibleAnswerBlocks(previous: Message, current: Message): MessageBlock[] {
  const previousScore = liveRunMessageAnswerScore(previous);
  const currentScore = liveRunMessageAnswerScore(current);
  if (previousScore <= 0 || currentScore >= previousScore) {
    return current.blocks;
  }

  const maxLength = Math.max(previous.blocks.length, current.blocks.length);
  let changed = false;
  const merged: MessageBlock[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const previousBlock = previous.blocks[index];
    const currentBlock = current.blocks[index];

    if (!previousBlock) {
      if (currentBlock) {
        merged.push(currentBlock);
      }
      continue;
    }

    if (!currentBlock) {
      merged.push(previousBlock);
      changed = true;
      continue;
    }

    if (liveRunAnswerBlockScore(previousBlock) > liveRunAnswerBlockScore(currentBlock)) {
      merged.push(previousBlock);
      changed = true;
      continue;
    }

    merged.push(currentBlock);
  }

  return changed ? merged : current.blocks;
}

function preserveVisibleAnswerBlocks(previous: Message, current: Message): Message {
  if (!sameLiveRunLineage(previous, current)) {
    return current;
  }

  const mergedBlocks = carryForwardVisibleAnswerBlocks(previous, current);
  if (mergedBlocks === current.blocks) {
    return current;
  }

  return {
    ...current,
    blocks: mergedBlocks,
  };
}

export function resolveRenderableLiveRunMessage(
  current: Message | null,
  transcriptMessages: Message[],
): Message | null {
  return clearLiveRunMessageIfTranscriptCaughtUp(current, transcriptMessages);
}
