import type { Message } from './types';

export function getMessageRenderKey(message: Pick<Message, 'id' | 'renderKey'>): string {
  const renderKey = String(message.renderKey ?? '').trim();
  if (renderKey) {
    return renderKey;
  }
  return String(message.id ?? '').trim();
}

export function getMessageSourceId(message: Pick<Message, 'id' | 'sourceMessageId'>): string {
  const sourceMessageId = String(message.sourceMessageId ?? '').trim();
  if (sourceMessageId) {
    return sourceMessageId;
  }
  return String(message.id ?? '').trim();
}
