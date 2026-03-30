import { normalizeMarkdownForDisplay, normalizeMarkdownForStreamingDisplay } from '../markdown/normalizeMarkdownForDisplay';
import type { Message, MessageBlock, MessageStatus } from '../types';

function hasVisibleString(value: unknown): boolean {
  return String(value ?? '').trim() !== '';
}

function isEmptyStreamingMarkdownPlaceholder(block: MessageBlock, messageStatus: MessageStatus): boolean {
  return block.type === 'markdown'
    && messageStatus === 'streaming'
    && normalizeMarkdownForStreamingDisplay(String(block.content ?? '')) === '';
}

function normalizeMarkdownBlockContent(block: Extract<MessageBlock, { type: 'markdown' }>, messageStatus: MessageStatus): string {
  const content = String(block.content ?? '');
  return messageStatus === 'streaming'
    ? normalizeMarkdownForStreamingDisplay(content)
    : normalizeMarkdownForDisplay(content);
}

export function isMessageBlockVisible(block: MessageBlock, messageStatus: MessageStatus): boolean {
  switch (block.type) {
    case 'markdown':
      return messageStatus === 'streaming' || normalizeMarkdownBlockContent(block, messageStatus) !== '';
    case 'text':
      return hasVisibleString(block.content);
    case 'thinking':
      return false;
    default:
      return true;
  }
}

export function hasNonEmptyVisibleBlockContent(block: MessageBlock, messageStatus: MessageStatus): boolean {
  if (!isMessageBlockVisible(block, messageStatus)) {
    return false;
  }
  switch (block.type) {
    case 'markdown':
      return normalizeMarkdownBlockContent(block, messageStatus) !== '';
    case 'text':
    case 'code':
    case 'svg':
    case 'mermaid':
      return hasVisibleString(block.content);
    case 'code-diff':
      return hasVisibleString(block.oldCode) || hasVisibleString(block.newCode);
    case 'thinking':
      return false;
    default:
      return true;
  }
}

export function visibleMessageBlocks(message: Message): number[] {
  let lastRenderableIndex = -1;
  message.blocks.forEach((block, index) => {
    if (isMessageBlockVisible(block, message.status)) {
      lastRenderableIndex = index;
    }
  });

  return message.blocks.flatMap((block, index) => {
    if (!isMessageBlockVisible(block, message.status)) {
      return [];
    }
    if (isEmptyStreamingMarkdownPlaceholder(block, message.status) && index !== lastRenderableIndex) {
      return [];
    }
    return [index];
  });
}

export function resolveStreamingCursorBlockIndex(
  message: Message,
  visibleBlockIndices: number[] = visibleMessageBlocks(message),
): number | null {
  if (message.role !== 'assistant' || message.status !== 'streaming') {
    return null;
  }

  for (let cursor = visibleBlockIndices.length - 1; cursor >= 0; cursor -= 1) {
    const blockIndex = visibleBlockIndices[cursor];
    const block = message.blocks[blockIndex];
    if (block?.type === 'markdown') {
      return blockIndex;
    }
  }

  return null;
}

export function hasNonEmptyVisibleMessageContent(message: Message): boolean {
  return message.blocks.some((block) => hasNonEmptyVisibleBlockContent(block, message.status)) || hasVisibleString(message.error);
}

export function hasVisibleMessageContent(message: Message): boolean {
  return visibleMessageBlocks(message).length > 0 || hasVisibleString(message.error);
}
