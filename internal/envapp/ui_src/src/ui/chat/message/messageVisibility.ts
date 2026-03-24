import { normalizeMarkdownForDisplay } from '../markdown/normalizeMarkdownForDisplay';
import type { Message, MessageBlock, MessageStatus } from '../types';

function hasVisibleString(value: unknown): boolean {
  return String(value ?? '').trim() !== '';
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
  return message.blocks.flatMap((block, index) => (
    isMessageBlockVisible(block, message.status)
      ? [{ block, index }]
      : []
  ));
}

export function hasNonEmptyVisibleMessageContent(message: Message): boolean {
  return message.blocks.some((block) => hasNonEmptyVisibleBlockContent(block, message.status)) || hasVisibleString(message.error);
}

export function hasVisibleMessageContent(message: Message): boolean {
  return visibleMessageBlocks(message).length > 0 || hasVisibleString(message.error);
}
