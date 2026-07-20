import type { FlowerChatMessage, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';

export type PendingFlowerTurn = Readonly<{
  thread_id: string;
  turn_id: string;
  prompt: string;
  state: 'sending' | 'queued';
  origin: 'admission' | 'queue_snapshot';
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
  const threadID = trim(thread.thread_id);
  const pendingThreadID = trim(pending.thread_id);
  const turnID = trim(pending.turn_id);
  if (!threadID || !pendingThreadID || threadID !== pendingThreadID || !turnID) return null;
  return (thread.messages ?? []).find((message) => (
    message.role === 'user'
    && trim(message.turn_id) === turnID
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
  const queuedIDs = new Set(queuedTurns.map((turn) => trim(turn.turn_id)).filter(Boolean));
  const retained = current.filter((pending) => (
    pending.thread_id !== thread.thread_id
    || (
      !pendingTurnCanonicalMessage(thread, pending)
      && (pending.origin === 'admission' || queuedIDs.has(trim(pending.turn_id)))
    )
  ));
  const retainedKeys = new Set(retained.map((pending) => `${trim(pending.thread_id)}\x00${trim(pending.turn_id)}`));
  const hydrated = queuedTurns.flatMap((turn): readonly PendingFlowerTurn[] => {
    const pending: PendingFlowerTurn = {
      thread_id: thread.thread_id,
      turn_id: turn.turn_id,
      prompt: turn.prompt,
      state: 'queued',
      origin: 'queue_snapshot',
      created_at_ms: turn.created_at_ms,
      ...(turn.context_action ? { context_action: turn.context_action } : {}),
    };
    const key = `${trim(pending.thread_id)}\x00${trim(pending.turn_id)}`;
    return pendingTurnCanonicalMessage(thread, pending) || retainedKeys.has(key) ? [] : [pending];
  });
  return [...retained, ...hydrated];
}
