export type ThreadUnreadSnapshot = Readonly<{
  lastMessageAtUnixMs: number;
  waitingPromptId?: string;
}>;

export type ThreadReadState = Readonly<{
  lastReadMessageAtUnixMs: number;
  lastSeenWaitingPromptId?: string;
}>;

export type ThreadReadStateByThread = Record<string, ThreadReadState>;

type ThreadReadBaselineEntry = Readonly<{
  threadId: string;
  snapshot?: Partial<ThreadUnreadSnapshot> | null;
}>;

function normalizeNonNegativeInt(value: unknown): number {
  const next = Math.floor(Number(value ?? 0) || 0);
  return next > 0 ? next : 0;
}

function normalizeOptionalID(value: unknown): string | undefined {
  const next = String(value ?? '').trim();
  return next || undefined;
}

export function normalizeThreadUnreadSnapshot(raw: Partial<ThreadUnreadSnapshot> | null | undefined): ThreadUnreadSnapshot {
  return {
    lastMessageAtUnixMs: normalizeNonNegativeInt(raw?.lastMessageAtUnixMs),
    waitingPromptId: normalizeOptionalID(raw?.waitingPromptId),
  };
}

export function normalizeThreadReadStateByThread(raw: unknown): ThreadReadStateByThread {
  if (!raw || typeof raw !== 'object') return {};

  const out: ThreadReadStateByThread = {};
  for (const [threadId, value] of Object.entries(raw as Record<string, unknown>)) {
    const tid = String(threadId ?? '').trim();
    if (!tid || !value || typeof value !== 'object') continue;

    const lastReadMessageAtUnixMs = normalizeNonNegativeInt((value as { lastReadMessageAtUnixMs?: unknown }).lastReadMessageAtUnixMs);
    const lastSeenWaitingPromptId = normalizeOptionalID((value as { lastSeenWaitingPromptId?: unknown }).lastSeenWaitingPromptId);
    if (lastReadMessageAtUnixMs <= 0 && !lastSeenWaitingPromptId) continue;

    out[tid] = {
      lastReadMessageAtUnixMs,
      lastSeenWaitingPromptId,
    };
  }

  return out;
}

export function markThreadReadFromSnapshot(
  prev: ThreadReadStateByThread,
  threadId: string,
  snapshot: Partial<ThreadUnreadSnapshot> | null | undefined,
): ThreadReadStateByThread {
  const tid = String(threadId ?? '').trim();
  if (!tid) return prev;

  const normalized = normalizeThreadUnreadSnapshot(snapshot);
  const hasActivity = normalized.lastMessageAtUnixMs > 0 || !!normalized.waitingPromptId;
  if (!hasActivity) return prev;

  const current = prev[tid];
  const next: ThreadReadState = {
    lastReadMessageAtUnixMs: Math.max(
      normalizeNonNegativeInt(current?.lastReadMessageAtUnixMs),
      normalized.lastMessageAtUnixMs,
    ),
    lastSeenWaitingPromptId: normalized.waitingPromptId || current?.lastSeenWaitingPromptId,
  };

  if (
    current
    && current.lastReadMessageAtUnixMs === next.lastReadMessageAtUnixMs
    && current.lastSeenWaitingPromptId === next.lastSeenWaitingPromptId
  ) {
    return prev;
  }

  return {
    ...prev,
    [tid]: next,
  };
}

export function buildThreadReadStateBaseline(entries: readonly ThreadReadBaselineEntry[]): ThreadReadStateByThread {
  let out: ThreadReadStateByThread = {};
  for (const entry of entries) {
    out = markThreadReadFromSnapshot(out, entry.threadId, entry.snapshot);
  }
  return out;
}

export function threadHasUnreadFromSnapshot(
  readStateByThread: ThreadReadStateByThread,
  threadId: string,
  snapshot: Partial<ThreadUnreadSnapshot> | null | undefined,
): boolean {
  const tid = String(threadId ?? '').trim();
  if (!tid) return false;

  const normalized = normalizeThreadUnreadSnapshot(snapshot);
  const current = readStateByThread[tid];
  if (!current) {
    return normalized.lastMessageAtUnixMs > 0 || !!normalized.waitingPromptId;
  }

  if (normalized.lastMessageAtUnixMs > normalizeNonNegativeInt(current.lastReadMessageAtUnixMs)) {
    return true;
  }

  if (normalized.waitingPromptId && normalized.waitingPromptId !== current.lastSeenWaitingPromptId) {
    return true;
  }

  return false;
}
