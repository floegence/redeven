export type CodexThreadUnreadSnapshot = Readonly<{
  updatedAtUnixS: number;
  activitySignature?: string;
}>;

export type CodexThreadReadState = Readonly<{
  lastReadUpdatedAtUnixS: number;
  lastSeenActivitySignature?: string;
}>;

export type CodexThreadReadStateByThread = Record<string, CodexThreadReadState>;

type CodexThreadReadBaselineEntry = Readonly<{
  threadId: string;
  snapshot?: Partial<CodexThreadUnreadSnapshot> | null;
}>;

function normalizeNonNegativeInt(value: unknown): number {
  const next = Math.floor(Number(value ?? 0) || 0);
  return next > 0 ? next : 0;
}

function normalizeOptionalSignature(value: unknown): string | undefined {
  const next = String(value ?? '').trim();
  return next || undefined;
}

export function normalizeCodexThreadUnreadSnapshot(
  raw: Partial<CodexThreadUnreadSnapshot> | null | undefined,
): CodexThreadUnreadSnapshot {
  return {
    updatedAtUnixS: normalizeNonNegativeInt(raw?.updatedAtUnixS),
    activitySignature: normalizeOptionalSignature(raw?.activitySignature),
  };
}

export function normalizeCodexThreadReadStateByThread(raw: unknown): CodexThreadReadStateByThread {
  if (!raw || typeof raw !== 'object') return {};

  const out: CodexThreadReadStateByThread = {};
  for (const [threadId, value] of Object.entries(raw as Record<string, unknown>)) {
    const tid = String(threadId ?? '').trim();
    if (!tid || !value || typeof value !== 'object') continue;

    const lastReadUpdatedAtUnixS = normalizeNonNegativeInt((value as { lastReadUpdatedAtUnixS?: unknown }).lastReadUpdatedAtUnixS);
    const lastSeenActivitySignature = normalizeOptionalSignature((value as { lastSeenActivitySignature?: unknown }).lastSeenActivitySignature);
    if (lastReadUpdatedAtUnixS <= 0 && !lastSeenActivitySignature) continue;

    out[tid] = {
      lastReadUpdatedAtUnixS,
      lastSeenActivitySignature,
    };
  }

  return out;
}

export function markCodexThreadReadFromSnapshot(
  prev: CodexThreadReadStateByThread,
  threadId: string,
  snapshot: Partial<CodexThreadUnreadSnapshot> | null | undefined,
): CodexThreadReadStateByThread {
  const tid = String(threadId ?? '').trim();
  if (!tid) return prev;

  const normalized = normalizeCodexThreadUnreadSnapshot(snapshot);
  const hasActivity = normalized.updatedAtUnixS > 0 || !!normalized.activitySignature;
  if (!hasActivity) return prev;

  const current = prev[tid];
  const next: CodexThreadReadState = {
    lastReadUpdatedAtUnixS: Math.max(
      normalizeNonNegativeInt(current?.lastReadUpdatedAtUnixS),
      normalized.updatedAtUnixS,
    ),
    lastSeenActivitySignature: normalized.activitySignature || current?.lastSeenActivitySignature,
  };

  if (
    current
    && current.lastReadUpdatedAtUnixS === next.lastReadUpdatedAtUnixS
    && current.lastSeenActivitySignature === next.lastSeenActivitySignature
  ) {
    return prev;
  }

  return {
    ...prev,
    [tid]: next,
  };
}

export function buildCodexThreadReadStateBaseline(
  entries: readonly CodexThreadReadBaselineEntry[],
): CodexThreadReadStateByThread {
  let out: CodexThreadReadStateByThread = {};
  for (const entry of entries) {
    out = markCodexThreadReadFromSnapshot(out, entry.threadId, entry.snapshot);
  }
  return out;
}

export function codexThreadHasUnreadFromSnapshot(
  readStateByThread: CodexThreadReadStateByThread,
  threadId: string,
  snapshot: Partial<CodexThreadUnreadSnapshot> | null | undefined,
): boolean {
  const tid = String(threadId ?? '').trim();
  if (!tid) return false;

  const normalized = normalizeCodexThreadUnreadSnapshot(snapshot);
  const current = readStateByThread[tid];
  if (!current) {
    return normalized.updatedAtUnixS > 0 || !!normalized.activitySignature;
  }

  if (normalized.updatedAtUnixS > normalizeNonNegativeInt(current.lastReadUpdatedAtUnixS)) {
    return true;
  }

  if (normalized.activitySignature && normalized.activitySignature !== current.lastSeenActivitySignature) {
    return true;
  }

  return false;
}
