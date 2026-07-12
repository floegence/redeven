import type { FlowerChatMessage, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';

export type PendingFlowerTurn = Readonly<{
  thread_id: string;
  message_id: string;
  prompt: string;
  state: 'sending' | 'queued';
  created_at_ms: number;
  context_action?: unknown;
}>;

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

export function pendingTurnCanonicalMessage(
  thread: FlowerThreadSnapshot,
  pending: PendingFlowerTurn,
): FlowerChatMessage | null {
  const prompt = trim(pending.prompt);
  const messageID = trim(pending.message_id);
  return (thread.messages ?? []).find((message) => (
    message.role === 'user'
    && (
      trim(message.id) === messageID
      || (messageID === '' && trim(message.content) === prompt)
    )
  )) ?? null;
}

export function reconcilePendingTurnsForThread(
  current: readonly PendingFlowerTurn[],
  thread: FlowerThreadSnapshot,
): readonly PendingFlowerTurn[] {
  const queuedTurns = thread.queued_turns;
  if (queuedTurns === undefined) {
    return current.filter((pending) => (
      pending.thread_id !== thread.thread_id || !pendingTurnCanonicalMessage(thread, pending)
    ));
  }
  const queuedIDs = new Set(queuedTurns.map((turn) => trim(turn.message_id)).filter(Boolean));
  const retained = current.filter((pending) => (
    pending.thread_id !== thread.thread_id
    || (
      !pendingTurnCanonicalMessage(thread, pending)
      && !queuedIDs.has(trim(pending.message_id))
      && pending.state === 'sending'
    )
  ));
  const hydrated = queuedTurns.flatMap((turn): readonly PendingFlowerTurn[] => {
    const pending: PendingFlowerTurn = {
      thread_id: thread.thread_id,
      message_id: turn.message_id,
      prompt: turn.prompt,
      state: 'queued',
      created_at_ms: turn.created_at_ms,
      ...(turn.context_action ? { context_action: turn.context_action } : {}),
    };
    return pendingTurnCanonicalMessage(thread, pending) ? [] : [pending];
  });
  return [...retained, ...hydrated];
}
