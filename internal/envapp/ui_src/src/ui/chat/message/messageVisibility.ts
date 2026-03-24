import { normalizeMarkdownForDisplay } from '../markdown/normalizeMarkdownForDisplay';
import type { Message, MessageBlock, MessageStatus } from '../types';

function hasVisibleString(value: unknown): boolean {
  return String(value ?? '').trim() !== '';
}

function isEmptyStreamingMarkdownPlaceholder(block: MessageBlock, messageStatus: MessageStatus): boolean {
  return block.type === 'markdown'
    && messageStatus === 'streaming'
    && normalizeMarkdownForDisplay(String(block.content ?? '')) === '';
}

export function isMessageBlockVisible(block: MessageBlock, messageStatus: MessageStatus): boolean {
  switch (block.type) {
    case 'markdown':
      return messageStatus === 'streaming' || normalizeMarkdownForDisplay(String(block.content ?? '')) !== '';
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
      return normalizeMarkdownForDisplay(String(block.content ?? '')) !== '';
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

export function visibleMessageBlocks(message: Message): Array<{ block: MessageBlock; index: number }> {
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
    return [{ block, index }];
  });
}

export function hasNonEmptyVisibleMessageContent(message: Message): boolean {
  return message.blocks.some((block) => hasNonEmptyVisibleBlockContent(block, message.status)) || hasVisibleString(message.error);
}

export function hasVisibleMessageContent(message: Message): boolean {
  return visibleMessageBlocks(message).length > 0 || hasVisibleString(message.error);
}
