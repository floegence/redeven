import type { FlowerChatMessage } from '../contracts/flowerSurfaceContracts';

/** Canonical ordinary user messages only; display receipts are not editable prompts. */
export function flowerInputHistoryEntries(messages: readonly FlowerChatMessage[]) {
  return messages.filter((message) => (
    message.role === 'user'
    && Boolean(message.turn_id?.trim())
    && message.status !== 'sending'
    && message.content.length > 0
    && !message.blocks?.some((block) => block.type === 'input-response')
  )).map((message) => ({ id: message.id, text: message.content }));
}
