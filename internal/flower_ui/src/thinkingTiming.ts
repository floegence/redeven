import type { FlowerChatMessage, FlowerRuntimeCurrentItem } from './contracts/flowerSurfaceContracts';

/** Project source timestamps without inferring timing from commit or arrival times. */
export function runtimeThinkingTiming(item: FlowerRuntimeCurrentItem): FlowerChatMessage['thinking_timing'] {
  if (item.output_started_at === undefined && item.output_ended_at === undefined) return undefined;
  const start = Date.parse(item.output_started_at ?? '');
  const end = item.output_ended_at === undefined ? undefined : Date.parse(item.output_ended_at);
  if (!Number.isFinite(start) || start <= 0 || (end !== undefined && (!Number.isFinite(end) || end < start))
    || (!item.live && end === undefined)) {
    throw new Error('Flower contract error: invalid output timing.');
  }
  return { started_at_ms: start, ...(end === undefined ? {} : { ended_at_ms: end }), source: 'runtime' };
}

/** Canonical timing always supersedes observations retained for older runtime output. */
export function retainThinkingTiming(message: FlowerChatMessage, previous?: FlowerChatMessage, now = Date.now()): FlowerChatMessage {
  if (!message.blocks?.some(block => block.type === 'thinking') || message.thinking_timing?.source === 'runtime') return message;
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
