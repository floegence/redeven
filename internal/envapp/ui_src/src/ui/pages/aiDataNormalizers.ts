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
  const agentType = String(rec.agent_type ?? rec.agentType ?? '').trim();
  const triggerReason = String(rec.trigger_reason ?? rec.triggerReason ?? '').trim();
  const status = normalizeSubagentStatus(rec.status);
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
  if (incoming.updatedAtUnixMs > current.updatedAtUnixMs) return incoming;
  if (incoming.updatedAtUnixMs < current.updatedAtUnixMs) return current;
  const incomingRank = subagentStatusRank(incoming.status);
  const currentRank = subagentStatusRank(current.status);
  if (incomingRank > currentRank) return incoming;
  if (incomingRank < currentRank) return current;
  if (incoming.history.length > current.history.length) return incoming;
  if (incoming.history.length < current.history.length) return current;
  if (incoming.summary.length > current.summary.length) return incoming;
  return current;
}

export function extractSubagentViewsFromWaitResult(raw: unknown): SubagentView[] {
  const root = asRecord(raw);
  const statusPayload = asRecord(root.status);
  const out: SubagentView[] = [];
  for (const value of Object.values(statusPayload)) {
    const view = mapSubagentPayloadSnakeToCamel(value);
    if (view) out.push(view);
  }
  return out;
}
