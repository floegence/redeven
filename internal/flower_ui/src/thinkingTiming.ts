import type { FlowerChatMessage } from './contracts/flowerSurfaceContracts';

/** Keep observed timing in the existing message cache; sealed history has no source duration. */
export function retainThinkingTiming(message: FlowerChatMessage, previous?: FlowerChatMessage, now = Date.now()): FlowerChatMessage {
  if (!message.blocks?.some(block => block.type === 'thinking')) return message;
  const sameSource = previous?.id === message.id && previous.thread_id === message.thread_id
    && previous.turn_id === message.turn_id && previous.run_id === message.run_id;
  const timing = sameSource ? previous.thinking_timing : undefined;
  if (message.live) {
    const startedAt = timing?.started_at_ms ?? message.thinking_timing?.started_at_ms ?? message.created_at_ms;
    if (!Number.isFinite(startedAt) || startedAt <= 0) return message;
    return { ...message, thinking_timing: { started_at_ms: startedAt } };
  }
  if (!timing) return message;
  return { ...message, thinking_timing: timing.ended_at_ms === undefined
    ? { ...timing, ended_at_ms: message.thinking_timing?.ended_at_ms ?? Math.max(timing.started_at_ms, now) } : timing };
}
