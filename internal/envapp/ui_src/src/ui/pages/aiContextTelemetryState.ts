import {
  mergeContextCompactionEvents,
  normalizeContextCompactionEvent,
  normalizeContextUsage,
  type ContextCompactionEventView,
  type ContextUsageView,
} from './aiDataNormalizers';

export interface ContextTelemetryRunState {
  readonly runId: string;
  readonly usage: ContextUsageView | null;
  readonly compactions: ContextCompactionEventView[];
  readonly cursor: number;
}

export type ContextTelemetryByRun = Record<string, ContextTelemetryRunState>;

function createContextTelemetryRunState(runId: string): ContextTelemetryRunState {
  return {
    runId,
    usage: null,
    compactions: [],
    cursor: 0,
  };
}

export function ensureContextTelemetryRun(
  current: ContextTelemetryByRun,
  runId: string,
): ContextTelemetryByRun {
  const rid = String(runId ?? '').trim();
  if (!rid || current[rid]) {
    return current;
  }
  return {
    ...current,
    [rid]: createContextTelemetryRunState(rid),
  };
}

export function getContextTelemetryRun(
  current: ContextTelemetryByRun,
  runId: string,
): ContextTelemetryRunState | null {
  const rid = String(runId ?? '').trim();
  if (!rid) {
    return null;
  }
  return current[rid] ?? null;
}

export function hasContextTelemetryData(
  runState: ContextTelemetryRunState | null | undefined,
): boolean {
  if (!runState) {
    return false;
  }
  return !!runState.usage || runState.compactions.length > 0;
}

function sameNumberMap(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}

function sameContextUsage(
  current: ContextUsageView | null,
  next: ContextUsageView,
): boolean {
  if (!current) {
    return false;
  }

  return current.eventId === next.eventId
    && current.atUnixMs === next.atUnixMs
    && current.stepIndex === next.stepIndex
    && current.estimateTokens === next.estimateTokens
    && current.estimateSource === next.estimateSource
    && current.contextWindow === next.contextWindow
    && current.contextLimit === next.contextLimit
    && current.pressure === next.pressure
    && current.usagePercent === next.usagePercent
    && current.effectiveThreshold === next.effectiveThreshold
    && current.configuredThreshold === next.configuredThreshold
    && current.windowBasedThreshold === next.windowBasedThreshold
    && current.turnMessages === next.turnMessages
    && current.historyMessages === next.historyMessages
    && current.promptPackEstimate === next.promptPackEstimate
    && current.sectionsTokensTotal === next.sectionsTokensTotal
    && current.unattributedTokens === next.unattributedTokens
    && sameNumberMap(current.sectionsTokens, next.sectionsTokens);
}

function shouldReplaceContextUsage(
  current: ContextUsageView | null,
  next: ContextUsageView,
): boolean {
  if (!current) {
    return true;
  }
  if (sameContextUsage(current, next)) {
    return false;
  }

  const nextEventId = Number(next.eventId ?? 0);
  const currentEventId = Number(current.eventId ?? 0);
  const nextAt = Number(next.atUnixMs ?? 0);
  const currentAt = Number(current.atUnixMs ?? 0);

  if (nextEventId > 0 && currentEventId > 0 && nextEventId < currentEventId) return false;
  if (nextEventId > 0 && currentEventId > 0 && nextEventId === currentEventId && nextAt <= currentAt) return false;
  if (nextEventId <= 0 && currentEventId > 0 && nextAt <= currentAt) return false;
  if (nextEventId <= 0 && currentEventId <= 0 && nextAt <= currentAt) return false;

  return true;
}

function sameContextCompactionEvent(
  left: ContextCompactionEventView,
  right: ContextCompactionEventView,
): boolean {
  return left.eventId === right.eventId
    && left.atUnixMs === right.atUnixMs
    && left.eventType === right.eventType
    && left.stage === right.stage
    && left.compactionId === right.compactionId
    && left.stepIndex === right.stepIndex
    && left.strategy === right.strategy
    && left.reason === right.reason
    && left.error === right.error
    && left.estimateTokensBefore === right.estimateTokensBefore
    && left.estimateTokensAfter === right.estimateTokensAfter
    && left.contextWindow === right.contextWindow
    && left.contextLimit === right.contextLimit
    && left.pressure === right.pressure
    && left.effectiveThreshold === right.effectiveThreshold
    && left.configuredThreshold === right.configuredThreshold
    && left.windowBasedThreshold === right.windowBasedThreshold
    && left.messagesBefore === right.messagesBefore
    && left.messagesAfter === right.messagesAfter
    && left.dedupeKey === right.dedupeKey;
}

function sameContextCompactionList(
  left: ContextCompactionEventView[],
  right: ContextCompactionEventView[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!sameContextCompactionEvent(left[index]!, right[index]!)) {
      return false;
    }
  }
  return true;
}

export function applyContextUsageToRun(
  current: ContextTelemetryByRun,
  runId: string,
  payload: unknown,
  meta?: {
    eventId?: unknown;
    atUnixMs?: unknown;
  },
): ContextTelemetryByRun {
  const rid = String(runId ?? '').trim();
  if (!rid) {
    return current;
  }

  const normalized = normalizeContextUsage(payload, meta);
  if (!normalized) {
    return current;
  }

  const ensured = ensureContextTelemetryRun(current, rid);
  const runState = ensured[rid]!;
  if (!shouldReplaceContextUsage(runState.usage, normalized)) {
    return ensured;
  }

  return {
    ...ensured,
    [rid]: {
      ...runState,
      usage: normalized,
    },
  };
}

export function applyContextCompactionToRun(
  current: ContextTelemetryByRun,
  runId: string,
  eventType: string,
  payload: unknown,
  meta?: {
    eventId?: unknown;
    atUnixMs?: unknown;
  },
  maxItems = 200,
): ContextTelemetryByRun {
  const rid = String(runId ?? '').trim();
  if (!rid) {
    return current;
  }

  const normalized = normalizeContextCompactionEvent(eventType, payload, meta);
  if (!normalized) {
    return current;
  }

  const ensured = ensureContextTelemetryRun(current, rid);
  const runState = ensured[rid]!;
  const compactions = mergeContextCompactionEvents(runState.compactions, [normalized], maxItems);
  if (compactions === runState.compactions || sameContextCompactionList(runState.compactions, compactions)) {
    return ensured;
  }

  return {
    ...ensured,
    [rid]: {
      ...runState,
      compactions,
    },
  };
}

export function setContextTelemetryCursor(
  current: ContextTelemetryByRun,
  runId: string,
  cursor: number,
): ContextTelemetryByRun {
  const rid = String(runId ?? '').trim();
  if (!rid) {
    return current;
  }

  const nextCursor = Math.max(0, Math.floor(Number(cursor) || 0));
  const ensured = ensureContextTelemetryRun(current, rid);
  const runState = ensured[rid]!;
  if (nextCursor <= runState.cursor) {
    return ensured;
  }

  return {
    ...ensured,
    [rid]: {
      ...runState,
      cursor: nextCursor,
    },
  };
}
