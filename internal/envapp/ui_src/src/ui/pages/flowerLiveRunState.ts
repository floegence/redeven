import { applyStreamEventBatchToMessages } from '../chat/messageState';
import {
  hasNonEmptyVisibleMessageContent,
  hasVisibleMessageContent,
} from '../chat/message/messageVisibility';
import type { Message, MessageBlock, StreamEvent } from '../chat/types';
import { getMessageRenderKey, getMessageSourceId } from '../chat/messageIdentity';

const PENDING_LIVE_RUN_MESSAGE_ID_PREFIX = 'm_ai_pending:';

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

export function buildPendingLiveRunMessage(args: {
  messageId: string;
  renderKey: string;
  timestamp: number;
}): Message {
  return {
    id: args.messageId,
    renderKey: args.renderKey,
    role: 'assistant',
    status: 'streaming',
    timestamp: args.timestamp,
    blocks: [{ type: 'markdown', content: '' }],
  };
}

function hasPendingDisplayMessageId(message: Message | null | undefined): boolean {
  return String(message?.id ?? '').trim().startsWith(PENDING_LIVE_RUN_MESSAGE_ID_PREFIX);
}

function readStreamEventMessageId(event: StreamEvent): string {
  switch (event.type) {
    case 'message-start':
    case 'message-end':
    case 'error':
      return String(event.messageId ?? '').trim();
    case 'block-start':
    case 'block-delta':
    case 'block-set':
    case 'block-end':
      return String(event.messageId ?? '').trim();
    default:
      return '';
  }
}

function writeStreamEventMessageId(event: StreamEvent, messageId: string): StreamEvent {
  switch (event.type) {
    case 'message-start':
    case 'message-end':
    case 'error':
      return { ...event, messageId };
    case 'block-start':
    case 'block-delta':
    case 'block-set':
    case 'block-end':
      return { ...event, messageId };
    default:
      return event;
  }
}

function remapEventsIntoActiveDisplaySlot(
  current: Message | null,
  events: StreamEvent[],
): {
  events: StreamEvent[];
  sourceMessageId: string;
} {
  const currentMessageId = String(current?.id ?? '').trim();
  if (!current || !currentMessageId) {
    return { events, sourceMessageId: '' };
  }

  const currentSourceMessageId = String(current.sourceMessageId ?? '').trim();
  const firstIncomingMessageId = events.map((event) => readStreamEventMessageId(event)).find(Boolean) ?? '';

  if (!firstIncomingMessageId) {
    return { events, sourceMessageId: currentSourceMessageId };
  }

  const shouldBindPendingDisplaySlot =
    !currentSourceMessageId
    && hasPendingDisplayMessageId(current)
    && firstIncomingMessageId !== currentMessageId;
  const shouldFollowKnownSourceMessage =
    !!currentSourceMessageId
    && firstIncomingMessageId === currentSourceMessageId;

  if (!shouldBindPendingDisplaySlot && !shouldFollowKnownSourceMessage) {
    return { events, sourceMessageId: currentSourceMessageId };
  }

  const sourceMessageId = shouldBindPendingDisplaySlot ? firstIncomingMessageId : currentSourceMessageId;
  const rewrittenEvents = events.map((event) => {
    const incomingMessageId = readStreamEventMessageId(event);
    if (!incomingMessageId) {
      return event;
    }
    if (incomingMessageId === currentMessageId) {
      return event;
    }
    if (incomingMessageId !== sourceMessageId) {
      return event;
    }
    return writeStreamEventMessageId(event, currentMessageId);
  });

  return {
    events: rewrittenEvents,
    sourceMessageId,
  };
}

export function applyStreamEventBatchToLiveRunMessage(
  current: Message | null,
  events: StreamEvent[],
  now = Date.now(),
): Message | null {
  if (events.length <= 0) {
    return current;
  }

  const remapped = remapEventsIntoActiveDisplaySlot(current, events);

  const result = applyStreamEventBatchToMessages(
    current ? [current] : [],
    remapped.events,
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

  const sourceMessageId = remapped.sourceMessageId || String(current?.sourceMessageId ?? '').trim();
  if (!sourceMessageId || sourceMessageId === String(normalized.id ?? '').trim()) {
    return normalized;
  }

  return {
    ...normalized,
    sourceMessageId,
  };
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

  const currentMessageId = String(current.id ?? '').trim();
  const currentSourceMessageId = String(current.sourceMessageId ?? '').trim();
  const snapshotMessageId = String(normalizedSnapshot.id ?? '').trim();
  if (!currentMessageId || !snapshotMessageId) {
    return normalizedSnapshot;
  }

  if (snapshotMessageId === currentMessageId) {
    const sourceMessageId = currentSourceMessageId && currentSourceMessageId !== currentMessageId
      ? currentSourceMessageId
      : '';
    return sourceMessageId
      ? { ...normalizedSnapshot, renderKey: current.renderKey ?? normalizedSnapshot.renderKey, sourceMessageId }
      : { ...normalizedSnapshot, renderKey: current.renderKey ?? normalizedSnapshot.renderKey };
  }

  if (hasPendingDisplayMessageId(current) || (currentSourceMessageId && snapshotMessageId === currentSourceMessageId)) {
    return {
      ...normalizedSnapshot,
      id: currentMessageId,
      renderKey: current.renderKey ?? normalizedSnapshot.renderKey,
      sourceMessageId: snapshotMessageId,
    };
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

function sameLiveRunDisplayLineage(left: Message | null | undefined, right: Message | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  const leftSourceId = getMessageSourceId(left);
  const rightSourceId = getMessageSourceId(right);
  if (leftSourceId && rightSourceId && leftSourceId === rightSourceId) {
    return true;
  }

  const leftRenderKey = getMessageRenderKey(left);
  const rightRenderKey = getMessageRenderKey(right);
  return !!leftRenderKey && leftRenderKey === rightRenderKey;
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

export function resolveDisplayedLiveRunMessage(args: {
  current: Message | null;
  previousDisplayed: Message | null;
  pending: Message | null;
  transcriptMessages: Message[];
}): Message | null {
  const current = clearLiveRunMessageIfTranscriptCaughtUp(args.current, args.transcriptMessages);
  const previousDisplayed = clearLiveRunMessageIfTranscriptCaughtUp(args.previousDisplayed, args.transcriptMessages);

  if (current) {
    if (previousDisplayed && sameLiveRunDisplayLineage(previousDisplayed, current)) {
      const mergedBlocks = carryForwardVisibleAnswerBlocks(previousDisplayed, current);
      if (mergedBlocks !== current.blocks) {
        return {
          ...current,
          blocks: mergedBlocks,
        };
      }
    }

    if (hasVisibleMessageContent(current)) {
      return current;
    }
  }

  if (previousDisplayed && hasNonEmptyVisibleMessageContent(previousDisplayed)) {
    return previousDisplayed;
  }

  if (args.pending) {
    return args.pending;
  }

  return current;
}

export function resolveRenderableLiveRunMessage(
  current: Message | null,
  transcriptMessages: Message[],
): Message | null {
  return clearLiveRunMessageIfTranscriptCaughtUp(current, transcriptMessages);
}
