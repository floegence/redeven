// Shared data normalizers for AI chat blocks and page-level views.
// Extracted from EnvAIPage.tsx so that both aiBlockPresentation and EnvAIPage can share
// the same logic without circular dependencies.

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

function normalizeCompactionStage(eventType: string): ContextCompactionEventView['stage'] {
  const normalized = String(eventType ?? '').trim().toLowerCase();
  if (normalized.endsWith('.started')) return 'started';
  if (normalized.endsWith('.applied')) return 'applied';
  if (normalized.endsWith('.skipped')) return 'skipped';
  if (normalized.endsWith('.failed')) return 'failed';
  return 'unknown';
}

export function normalizeContextUsage(
  payloadRaw: unknown,
  meta?: {
    eventId?: unknown;
    atUnixMs?: unknown;
  },
): ContextUsageView | null {
  const payload = asRecord(payloadRaw);
  const estimateTokens = Math.max(0, Math.floor(readNumber(payload.estimate_tokens, -1)));
  const contextLimit = Math.max(0, Math.floor(readNumber(payload.context_limit, -1)));
  if (estimateTokens < 0 || contextLimit <= 0) return null;

  const pressureRaw = readNumber(payload.pressure, NaN);
  const pressure = Number.isFinite(pressureRaw) && pressureRaw >= 0 ? pressureRaw : estimateTokens / contextLimit;
  const usagePercentRaw = readNumber(payload.usage_percent, NaN);
  const usagePercent = Number.isFinite(usagePercentRaw) && usagePercentRaw >= 0 ? usagePercentRaw : pressure * 100;

  const sectionsTokens = normalizeSectionTokens(payload.sections_tokens);
  const sectionsTokensTotalRaw = Math.floor(readNumber(payload.sections_tokens_total, -1));
  const sectionsTokensTotal = sectionsTokensTotalRaw >= 0
    ? sectionsTokensTotalRaw
    : Object.values(sectionsTokens).reduce((sum, value) => sum + value, 0);

  const unattributedTokensRaw = Math.floor(readNumber(payload.unattributed_tokens, -1));
  const unattributedTokens = unattributedTokensRaw >= 0
    ? unattributedTokensRaw
    : Math.max(0, estimateTokens - sectionsTokensTotal);

  const atUnixMs = Math.max(0, Math.floor(readNumber(meta?.atUnixMs, 0)));
  const eventId = normalizeOptionalInteger(meta?.eventId);
  const stepIndex = Math.max(0, Math.floor(readNumber(payload.step_index, 0)));
  const estimateSource = String(payload.estimate_source ?? '').trim();
  const contextWindow = normalizeOptionalInteger(payload.context_window);
  const turnMessages = normalizeOptionalInteger(payload.turn_messages);
  const historyMessages = normalizeOptionalInteger(payload.history_messages);
  const promptPackEstimate = normalizeOptionalInteger(payload.prompt_pack_estimate);

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
    effectiveThreshold: normalizeOptionalNumber(payload.effective_threshold),
    configuredThreshold: normalizeOptionalNumber(payload.configured_threshold),
    windowBasedThreshold: normalizeOptionalNumber(payload.window_based_threshold),
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
  const eventType = String(eventTypeRaw ?? '').trim();
  if (!eventType) return null;
  const payload = asRecord(payloadRaw);
  const compactionId = String(payload.compaction_id ?? '').trim();
  if (!compactionId) return null;

  const stepIndex = Math.max(0, Math.floor(readNumber(payload.step_index, 0)));
  const eventId = normalizeOptionalInteger(meta?.eventId);
  const atUnixMs = Math.max(0, Math.floor(readNumber(meta?.atUnixMs, 0)));
  const stage = normalizeCompactionStage(eventType);
  const strategy = String(payload.strategy ?? '').trim();
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
    estimateTokensBefore: normalizeOptionalInteger(payload.estimate_tokens_before ?? payload.estimate_tokens),
    estimateTokensAfter: normalizeOptionalInteger(payload.estimate_tokens_after),
    contextWindow: normalizeOptionalInteger(payload.context_window),
    contextLimit: normalizeOptionalInteger(payload.context_limit),
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

export type SubagentStatus =
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'timed_out'
  | 'unknown';

export interface SubagentKeyFile {
  readonly path: string;
  readonly line?: number;
  readonly purpose?: string;
}

export interface SubagentStatsView {
  readonly steps: number;
  readonly toolCalls: number;
  readonly tokens: number;
  readonly elapsedMs: number;
  readonly outcome: string;
}

export interface SubagentHistoryMessageView {
  readonly role: 'user' | 'assistant' | 'system';
  readonly text: string;
}

export interface SubagentView {
  readonly subagentId: string;
  readonly taskId: string;
  readonly specId?: string;
  readonly title?: string;
  readonly objective?: string;
  readonly contextMode?: string;
  readonly promptHash?: string;
  readonly delegationPromptMarkdown?: string;
  readonly deliverables?: string[];
  readonly definitionOfDone?: string[];
  readonly outputSchema?: Record<string, unknown>;
  readonly agentType: string;
  readonly triggerReason: string;
  readonly status: SubagentStatus;
  readonly summary: string;
  readonly evidenceRefs: string[];
  readonly keyFiles: SubagentKeyFile[];
  readonly openRisks: string[];
  readonly nextActions: string[];
  readonly history: SubagentHistoryMessageView[];
  readonly stats: SubagentStatsView;
  readonly updatedAtUnixMs: number;
  readonly error?: string;
}

export function normalizeSubagentStatus(raw: unknown): SubagentStatus {
  const value = String(raw ?? '').trim().toLowerCase();
  switch (value) {
    case 'queued':
    case 'running':
    case 'waiting_input':
    case 'completed':
    case 'failed':
    case 'canceled':
    case 'timed_out':
      return value;
    default:
      return 'unknown';
  }
}

function readNumber(raw: unknown, fallback = 0): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const value = String(item ?? '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function normalizeSubagentKeyFiles(raw: unknown): SubagentKeyFile[] {
  if (!Array.isArray(raw)) return [];
  const out: SubagentKeyFile[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    const path = String(rec.path ?? '').trim();
    if (!path) continue;
    const lineRaw = readNumber(rec.line, 0);
    const purpose = String(rec.purpose ?? '').trim();
    out.push({
      path,
      line: lineRaw > 0 ? Math.floor(lineRaw) : undefined,
      purpose: purpose || undefined,
    });
  }
  return out;
}

function normalizeSubagentHistory(raw: unknown): SubagentHistoryMessageView[] {
  if (!Array.isArray(raw)) return [];
  const out: SubagentHistoryMessageView[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    const roleRaw = String(rec.role ?? '').trim().toLowerCase();
    const role = roleRaw === 'user' || roleRaw === 'assistant' || roleRaw === 'system'
      ? roleRaw
      : '';
    const text = String(rec.text ?? '').trim();
    if (!role || !text) continue;
    out.push({
      role,
      text,
    });
  }
  return out;
}

export function normalizeSubagentStats(raw: unknown): SubagentStatsView {
  const rec = asRecord(raw);
  return {
    steps: Math.max(0, Math.floor(readNumber(rec.steps, 0))),
    toolCalls: Math.max(0, Math.floor(readNumber(rec.tool_calls ?? rec.toolCalls, 0))),
    tokens: Math.max(0, Math.floor(readNumber(rec.tokens, 0))),
    elapsedMs: Math.max(0, Math.floor(readNumber(rec.elapsed_ms ?? rec.elapsedMs, 0))),
    outcome: String(rec.outcome ?? '').trim(),
  };
}

type SubagentResultView = {
  summary: string;
  evidenceRefs: string[];
  keyFiles: SubagentKeyFile[];
  openRisks: string[];
  nextActions: string[];
};

export function normalizeSubagentResult(resultRaw: unknown, fallbackSummary = ''): SubagentResultView {
  if (typeof resultRaw === 'string') {
    return {
      summary: resultRaw.trim() || fallbackSummary,
      evidenceRefs: [],
      keyFiles: [],
      openRisks: [],
      nextActions: [],
    };
  }
  const rec = asRecord(resultRaw);
  const summary = String(rec.summary ?? rec.result ?? '').trim() || fallbackSummary;
  return {
    summary,
    evidenceRefs: toStringArray(rec.evidence_refs ?? rec.evidenceRefs),
    keyFiles: normalizeSubagentKeyFiles(rec.key_files ?? rec.keyFiles),
    openRisks: toStringArray(rec.open_risks ?? rec.openRisks),
    nextActions: toStringArray(rec.next_actions ?? rec.nextActions),
  };
}

export function mapSubagentPayloadSnakeToCamel(raw: unknown): SubagentView | null {
  const rec = asRecord(raw);
  const subagentId = String(rec.subagent_id ?? rec.subagentId ?? rec.id ?? '').trim();
  if (!subagentId) return null;
  const taskId = String(rec.task_id ?? rec.taskId ?? '').trim();
  const specId = String(rec.spec_id ?? rec.specId ?? '').trim();
  const title = String(rec.title ?? '').trim();
  const objective = String(rec.objective ?? '').trim();
  const contextMode = String(rec.context_mode ?? rec.contextMode ?? '').trim();
  const promptHash = String(rec.prompt_hash ?? rec.promptHash ?? '').trim();
  const delegationPromptMarkdown = String(rec.delegation_prompt_markdown ?? rec.delegationPromptMarkdown ?? '').trim();
  const deliverables = toStringArray(rec.deliverables);
  const definitionOfDone = toStringArray(rec.definition_of_done ?? rec.definitionOfDone);
  const outputSchemaRaw = asRecord(rec.output_schema ?? rec.outputSchema);
  const agentType = String(rec.agent_type ?? rec.agentType ?? '').trim();
  const triggerReason = String(rec.trigger_reason ?? rec.triggerReason ?? '').trim();
  const status = normalizeSubagentStatus(rec.status ?? rec.subagent_status ?? rec.subagentStatus);
  const fallbackSummary = String(rec.result ?? '').trim();
  const resultPayload = rec.result_struct ?? rec.resultStruct ?? rec.result ?? {};
  const normalizedResult = normalizeSubagentResult(resultPayload, fallbackSummary);
  const history = normalizeSubagentHistory(rec.history);
  const stats = normalizeSubagentStats(rec.stats);
  const updatedAtUnixMs = Math.max(
    0,
    Math.floor(
      readNumber(rec.updated_at_ms ?? rec.updatedAtUnixMs, 0) ||
      readNumber(rec.ended_at_ms, 0) ||
      readNumber(rec.started_at_ms, 0),
    ),
  );
  const error = String(rec.error ?? '').trim();
  return {
    subagentId,
    taskId,
    specId: specId || undefined,
    title: title || undefined,
    objective: objective || undefined,
    contextMode: contextMode || undefined,
    promptHash: promptHash || undefined,
    delegationPromptMarkdown: delegationPromptMarkdown || undefined,
    deliverables,
    definitionOfDone,
    outputSchema: outputSchemaRaw,
    agentType,
    triggerReason,
    status,
    summary: normalizedResult.summary,
    evidenceRefs: normalizedResult.evidenceRefs,
    keyFiles: normalizedResult.keyFiles,
    openRisks: normalizedResult.openRisks,
    nextActions: normalizedResult.nextActions,
    history,
    stats,
    updatedAtUnixMs,
    error: error || undefined,
  };
}

function subagentStatusRank(status: SubagentStatus): number {
  switch (status) {
    case 'queued':
      return 1;
    case 'running':
      return 2;
    case 'waiting_input':
      return 3;
    case 'completed':
    case 'failed':
    case 'canceled':
    case 'timed_out':
      return 4;
    default:
      return 0;
  }
}

export function mergeSubagentEventsByTimestamp(
  current: SubagentView | null,
  incoming: SubagentView | null,
): SubagentView | null {
  if (!current) return incoming;
  if (!incoming) return current;
  const mergeComplementaryFields = (base: SubagentView, patch: SubagentView): SubagentView => ({
    ...base,
    specId: base.specId || patch.specId,
    title: base.title || patch.title,
    objective: base.objective || patch.objective,
    contextMode: base.contextMode || patch.contextMode,
    promptHash: base.promptHash || patch.promptHash,
    delegationPromptMarkdown: base.delegationPromptMarkdown || patch.delegationPromptMarkdown,
    deliverables: (base.deliverables && base.deliverables.length > 0) ? base.deliverables : (patch.deliverables ?? []),
    definitionOfDone: (base.definitionOfDone && base.definitionOfDone.length > 0) ? base.definitionOfDone : (patch.definitionOfDone ?? []),
    outputSchema: (base.outputSchema && Object.keys(base.outputSchema).length > 0) ? base.outputSchema : (patch.outputSchema ?? {}),
  });
  if (incoming.updatedAtUnixMs > current.updatedAtUnixMs) return mergeComplementaryFields(incoming, current);
  if (incoming.updatedAtUnixMs < current.updatedAtUnixMs) return mergeComplementaryFields(current, incoming);
  const incomingRank = subagentStatusRank(incoming.status);
  const currentRank = subagentStatusRank(current.status);
  if (incomingRank > currentRank) return mergeComplementaryFields(incoming, current);
  if (incomingRank < currentRank) return mergeComplementaryFields(current, incoming);
  if (incoming.history.length > current.history.length) return mergeComplementaryFields(incoming, current);
  if (incoming.history.length < current.history.length) return mergeComplementaryFields(current, incoming);
  if (incoming.summary.length > current.summary.length) return mergeComplementaryFields(incoming, current);
  return mergeComplementaryFields(current, incoming);
}

export function extractSubagentViewsFromWaitResult(raw: unknown): SubagentView[] {
  const root = asRecord(raw);
  const statusPayload = asRecord(root.status ?? root.snapshots);
  const out: SubagentView[] = [];
  for (const value of Object.values(statusPayload)) {
    const view = mapSubagentPayloadSnakeToCamel(value);
    if (view) out.push(view);
  }
  return out;
}
