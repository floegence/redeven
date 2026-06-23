// Shared data normalizers for AI chat blocks and page-level views.

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface ThreadTodoItem {
  readonly id: string;
  readonly content: string;
  readonly status: TodoStatus;
  readonly note?: string;
}

export interface ThreadTodosView {
  readonly version: number;
  readonly updated_at_unix_ms: number;
  readonly todos: ThreadTodoItem[];
}

export function normalizeTodoStatus(raw: unknown): TodoStatus {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'in_progress' || value === 'completed' || value === 'cancelled') {
    return value;
  }
  return 'pending';
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

function readNumber(raw: unknown, fallback = 0): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function normalizeTodoItems(raw: unknown): ThreadTodoItem[] {
  const listRaw = Array.isArray(raw) ? raw : [];
  const todos: ThreadTodoItem[] = [];
  listRaw.forEach((entry, index) => {
    const item = asRecord(entry);
    const content = String(item.content ?? '').trim();
    if (!content) return;
    const id = String(item.id ?? '').trim() || `todo_${index + 1}`;
    const note = String(item.note ?? '').trim();
    todos.push({
      id,
      content,
      status: normalizeTodoStatus(item.status),
      note: note || undefined,
    });
  });
  return todos;
}

export function normalizeThreadTodosView(raw: unknown): ThreadTodosView {
  const source = asRecord(raw);
  const todos = normalizeTodoItems(source.todos);

  return {
    version: Math.max(0, Number(source.version ?? 0) || 0),
    updated_at_unix_ms: Math.max(0, Number(source.updated_at_unix_ms ?? 0) || 0),
    todos,
  };
}

export function normalizeWriteTodosToolView(resultRaw: unknown, argsRaw: unknown): ThreadTodosView {
  const normalizedResult = normalizeThreadTodosView(resultRaw);
  if (normalizedResult.todos.length > 0) {
    return normalizedResult;
  }

  const args = asRecord(argsRaw);
  const todosFromArgs = normalizeTodoItems(args.todos);
  if (todosFromArgs.length === 0) {
    return normalizedResult;
  }

  return {
    version: normalizedResult.version,
    updated_at_unix_ms: normalizedResult.updated_at_unix_ms,
    todos: todosFromArgs,
  };
}

export function todoStatusLabel(status: TodoStatus): string {
  switch (status) {
    case 'in_progress':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Pending';
  }
}

export function todoStatusBadgeClass(status: TodoStatus): string {
  switch (status) {
    case 'in_progress':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25';
    case 'completed':
      return 'bg-success/10 text-success border-success/20';
    case 'cancelled':
      return 'bg-muted text-muted-foreground border-border';
    default:
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20';
  }
}

export interface ContextUsageView {
  readonly eventId?: number;
  readonly atUnixMs: number;
  readonly stepIndex: number;
  readonly estimateTokens: number;
  readonly estimateSource?: string;
  readonly contextWindow?: number;
  readonly contextLimit: number;
  readonly pressure: number;
  readonly usagePercent: number;
  readonly effectiveThreshold?: number;
  readonly configuredThreshold?: number;
  readonly windowBasedThreshold?: number;
  readonly turnMessages?: number;
  readonly historyMessages?: number;
  readonly promptPackEstimate?: number;
  readonly sectionsTokens: Record<string, number>;
  readonly sectionsTokensTotal: number;
  readonly unattributedTokens: number;
}

export interface ContextCompactionEventView {
  readonly eventId?: number;
  readonly atUnixMs: number;
  readonly eventType: string;
  readonly stage: 'started' | 'applied' | 'skipped' | 'failed' | 'unknown';
  readonly compactionId: string;
  readonly stepIndex: number;
  readonly strategy?: string;
  readonly reason?: string;
  readonly error?: string;
  readonly estimateTokensBefore?: number;
  readonly estimateTokensAfter?: number;
  readonly contextWindow?: number;
  readonly contextLimit?: number;
  readonly pressure?: number;
  readonly effectiveThreshold?: number;
  readonly configuredThreshold?: number;
  readonly windowBasedThreshold?: number;
  readonly messagesBefore?: number;
  readonly messagesAfter?: number;
  readonly dedupeKey: string;
}

function normalizeSectionTokens(raw: unknown): Record<string, number> {
  const rec = asRecord(raw);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(rec)) {
    const normalizedKey = String(key ?? '').trim();
    if (!normalizedKey) continue;
    const numeric = Math.floor(readNumber(value, -1));
    if (numeric < 0) continue;
    out[normalizedKey] = numeric;
  }
  return out;
}

function normalizeOptionalNumber(raw: unknown): number | undefined {
  const n = readNumber(raw, NaN);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function normalizeOptionalInteger(raw: unknown): number | undefined {
  const n = normalizeOptionalNumber(raw);
  if (!Number.isFinite(n ?? NaN)) return undefined;
  return Math.max(0, Math.floor(n as number));
}

function normalizeStructuredCompactionStage(statusRaw: unknown, phaseRaw: unknown): ContextCompactionEventView['stage'] {
  const status = String(statusRaw ?? '').trim().toLowerCase();
  if (status === 'compacting') return 'started';
  if (status === 'compacted') return 'applied';
  if (status === 'failed') return 'failed';
  const phase = String(phaseRaw ?? '').trim().toLowerCase();
  if (phase === 'start') return 'started';
  if (phase === 'complete') return 'applied';
  if (phase === 'failed') return 'failed';
  return 'unknown';
}

export function normalizeContextUsage(
  payloadRaw: unknown,
  meta?: {
    eventId?: unknown;
    atUnixMs?: unknown;
  },
): ContextUsageView | null {
  const source = asRecord(payloadRaw);
  const payload = asRecord(source.usage);
  const normalizedPayload = Object.keys(payload).length > 0 ? payload : source;
  const estimateTokens = Math.max(0, Math.floor(readNumber(
    normalizedPayload.estimate_tokens ?? normalizedPayload.input_tokens,
    -1,
  )));
  const contextLimit = Math.max(0, Math.floor(readNumber(
    normalizedPayload.context_limit ?? normalizedPayload.context_window_tokens ?? normalizedPayload.request_safe_limit_tokens,
    -1,
  )));
  if (estimateTokens < 0 || contextLimit <= 0) return null;

  const pressureRaw = readNumber(normalizedPayload.pressure ?? normalizedPayload.used_ratio, NaN);
  const pressure = Number.isFinite(pressureRaw) && pressureRaw >= 0 ? pressureRaw : estimateTokens / contextLimit;
  const usagePercentRaw = readNumber(normalizedPayload.usage_percent, NaN);
  const usagePercent = Number.isFinite(usagePercentRaw) && usagePercentRaw >= 0 ? usagePercentRaw : pressure * 100;

  const sectionsTokens = normalizeSectionTokens(normalizedPayload.sections_tokens);
  const sectionsTokensTotalRaw = Math.floor(readNumber(normalizedPayload.sections_tokens_total, -1));
  const sectionsTokensTotal = sectionsTokensTotalRaw >= 0
    ? sectionsTokensTotalRaw
    : Object.values(sectionsTokens).reduce((sum, value) => sum + value, 0);

  const unattributedTokensRaw = Math.floor(readNumber(normalizedPayload.unattributed_tokens, -1));
  const unattributedTokens = unattributedTokensRaw >= 0
    ? unattributedTokensRaw
    : Math.max(0, estimateTokens - sectionsTokensTotal);

  const atUnixMs = Math.max(0, Math.floor(readNumber(meta?.atUnixMs, 0)));
  const eventId = normalizeOptionalInteger(meta?.eventId);
  const stepIndex = Math.max(0, Math.floor(readNumber(normalizedPayload.step_index, 0)));
  const estimateSource = String(normalizedPayload.estimate_source ?? normalizedPayload.source ?? normalizedPayload.phase ?? '').trim();
  const contextWindow = normalizeOptionalInteger(normalizedPayload.context_window ?? normalizedPayload.context_window_tokens);
  const turnMessages = normalizeOptionalInteger(normalizedPayload.turn_messages);
  const historyMessages = normalizeOptionalInteger(normalizedPayload.history_messages);
  const promptPackEstimate = normalizeOptionalInteger(normalizedPayload.prompt_pack_estimate);

  return {
    eventId,
    atUnixMs,
    stepIndex,
    estimateTokens,
    estimateSource: estimateSource || undefined,
    contextWindow,
    contextLimit,
    pressure,
    usagePercent,
    effectiveThreshold: normalizeOptionalNumber(normalizedPayload.effective_threshold ?? normalizedPayload.threshold_ratio),
    configuredThreshold: normalizeOptionalNumber(normalizedPayload.configured_threshold),
    windowBasedThreshold: normalizeOptionalNumber(normalizedPayload.window_based_threshold),
    turnMessages,
    historyMessages,
    promptPackEstimate,
    sectionsTokens,
    sectionsTokensTotal,
    unattributedTokens,
  };
}

export function normalizeContextCompactionEvent(
  eventTypeRaw: unknown,
  payloadRaw: unknown,
  meta?: {
    eventId?: unknown;
    atUnixMs?: unknown;
  },
): ContextCompactionEventView | null {
  const rawEventType = String(eventTypeRaw ?? '').trim();
  if (!rawEventType) return null;
  const source = asRecord(payloadRaw);
  const structured = asRecord(source.compaction);
  const payload = Object.keys(structured).length > 0 ? structured : source;
  const eventType = rawEventType;
  if (!eventType) return null;
  const compactionId = String(payload.compaction_id ?? payload.operation_id ?? '').trim();
  if (!compactionId) return null;

  const stepIndex = Math.max(0, Math.floor(readNumber(payload.step_index, 0)));
  const eventId = normalizeOptionalInteger(meta?.eventId);
  const atUnixMs = Math.max(0, Math.floor(readNumber(meta?.atUnixMs, 0)));
  const stage = rawEventType === 'context.compaction.updated'
    ? normalizeStructuredCompactionStage(payload.status, payload.phase)
    : 'unknown';
  const strategy = String(payload.strategy ?? payload.trigger ?? '').trim();
  const reason = String(payload.reason ?? '').trim();
  const error = String(payload.error ?? '').trim();
  const effectiveThreshold = normalizeOptionalNumber(payload.effective_threshold);
  const configuredThreshold = normalizeOptionalNumber(payload.configured_threshold);
  const windowBasedThreshold = normalizeOptionalNumber(payload.window_based_threshold);
  const messagesBefore = normalizeOptionalInteger(payload.messages_before);
  const messagesAfter = normalizeOptionalInteger(payload.messages_after);
  const dedupeKey = `${compactionId}:${eventType}:${stepIndex}`;

  return {
    eventId,
    atUnixMs,
    eventType,
    stage,
    compactionId,
    stepIndex,
    strategy: strategy || undefined,
    reason: reason || undefined,
    error: error || undefined,
    estimateTokensBefore: normalizeOptionalInteger(payload.estimate_tokens_before ?? payload.estimate_tokens ?? payload.tokens_before),
    estimateTokensAfter: normalizeOptionalInteger(payload.estimate_tokens_after ?? payload.tokens_after_estimate),
    contextWindow: normalizeOptionalInteger(payload.context_window ?? payload.context_window_tokens),
    contextLimit: normalizeOptionalInteger(payload.context_limit ?? payload.request_safe_limit_tokens),
    pressure: normalizeOptionalNumber(payload.pressure),
    effectiveThreshold,
    configuredThreshold,
    windowBasedThreshold,
    messagesBefore,
    messagesAfter,
    dedupeKey,
  };
}

export function mergeContextCompactionEvents(
  current: ContextCompactionEventView[],
  incoming: ContextCompactionEventView[],
  maxItems = 200,
): ContextCompactionEventView[] {
  if (!Array.isArray(incoming) || incoming.length <= 0) return current;

  const byEventId = new Map<number, ContextCompactionEventView>();
  const byKey = new Map<string, ContextCompactionEventView>();

  const register = (item: ContextCompactionEventView) => {
    if (!item) return;
    if (typeof item.eventId === 'number' && Number.isFinite(item.eventId) && item.eventId > 0) {
      byEventId.set(item.eventId, item);
      return;
    }
    byKey.set(item.dedupeKey, item);
  };

  current.forEach(register);
  incoming.forEach(register);

  const merged = [
    ...Array.from(byEventId.values()),
    ...Array.from(byKey.values()).filter((item) => {
      if (typeof item.eventId === 'number' && Number.isFinite(item.eventId) && item.eventId > 0) {
        return !byEventId.has(item.eventId);
      }
      return true;
    }),
  ];

  merged.sort((a, b) => {
    const atA = a.atUnixMs || 0;
    const atB = b.atUnixMs || 0;
    if (atA !== atB) return atA - atB;
    const idA = a.eventId ?? 0;
    const idB = b.eventId ?? 0;
    if (idA !== idB) return idA - idB;
    return a.dedupeKey.localeCompare(b.dedupeKey);
  });

  if (maxItems > 0 && merged.length > maxItems) {
    return merged.slice(merged.length - maxItems);
  }
  return merged;
}
