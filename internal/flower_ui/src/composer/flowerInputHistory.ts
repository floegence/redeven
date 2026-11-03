import type { FlowerChatMessage } from '../contracts/flowerSurfaceContracts';
import { readPresentationValue } from '../presentationIdentity';

/** Canonical ordinary user messages only; display receipts are not editable prompts. */
export function flowerInputHistoryEntries(messages: readonly FlowerChatMessage[]) {
  return readPresentationValue(messages).flatMap((source, index) => {
    // Assistant arrivals change membership but cannot enter prompt history.
    // Subscribe to editable user facts only, retaining their live owner.
    if (readPresentationValue(source).role !== 'user') return [];
    const message = messages[index];
    return Boolean(message.turn_id?.trim())
    && message.status !== 'sending'
    && message.content.length > 0
    && !message.blocks?.some((block) => block.type === 'input-response')
      ? [{ id: message.id, text: message.content }] : [];
  });
}
