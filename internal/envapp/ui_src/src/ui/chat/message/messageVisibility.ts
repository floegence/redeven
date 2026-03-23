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
      return hasVisibleString(block.content)
        || (typeof block.duration === 'number' && Number.isFinite(block.duration));
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

export function hasVisibleMessageContent(message: Message): boolean {
  return visibleMessageBlocks(message).length > 0 || hasVisibleString(message.error);
}
