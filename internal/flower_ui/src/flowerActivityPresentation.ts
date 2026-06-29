import type {
  FlowerActivityFileAction as FlowerActivityFileActionRecord,
  FlowerActivityItem,
  FlowerActivityRenderer,
} from './contracts/flowerSurfaceContracts';
import type { FlowerSubagentsCopy } from './copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from './copy';
import { trimString } from './flowerSurfaceModel';

export type FlowerActivityDetailLine = Readonly<{
  label: string;
  value: string;
  tone?: 'code' | 'muted';
}>;

export type FlowerActivityTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type FlowerActivityTodoItem = Readonly<{
  id?: string;
  content: string;
  status: FlowerActivityTodoStatus;
  note?: string;
}>;

export type FlowerActivityTitle =
  | Readonly<{
    kind: 'file';
    verb: 'Read' | 'Edit' | 'Delete';
    display_name: string;
  }>
  | Readonly<{
    kind: 'command';
    command: string;
  }>
  | Readonly<{
    kind: 'plain';
    text: string;
  }>;

export type FlowerActivityFileAction = Readonly<{
  action_id: string;
  display_name: string;
  can_preview: boolean;
  can_browse_directory: boolean;
}>;

export type FlowerActivityFileActions = Readonly<Record<string, FlowerActivityFileActionRecord>>;

export type FlowerActivityDiffFile = Readonly<{
  display_name: string;
  old_path: string;
  new_path: string;
  change_type: string;
  action: FlowerActivityFileAction;
  additions: number;
  deletions: number;
  patch_text: string;
  truncated: boolean;
  diff_unavailable_reason: string;
}>;

export type FlowerActivityDetailBlock =
  | Readonly<{
    kind: 'structured';
    lines: readonly FlowerActivityDetailLine[];
  }>
  | Readonly<{
    kind: 'terminal';
    lines: readonly FlowerActivityDetailLine[];
  }>
  | Readonly<{
    kind: 'todos';
    items: readonly FlowerActivityTodoItem[];
  }>
  | Readonly<{
    kind: 'file_read';
    action: FlowerActivityFileAction;
    content: string;
    line_offset: number;
    line_count: number;
    total_lines: number;
    truncated: boolean;
  }>
  | Readonly<{
    kind: 'file_diff';
    files: readonly FlowerActivityDiffFile[];
  }>;

export type FlowerActivityPresentation = Readonly<{
  label: string;
  title: FlowerActivityTitle;
  meta: string;
  primaryAction?: FlowerActivityFileAction;
  detailLines: readonly FlowerActivityDetailLine[];
  detailBlocks: readonly FlowerActivityDetailBlock[];
}>;

type FlowerActivityPresentationCopy = Readonly<{
  subagents?: FlowerSubagentsCopy;
}>;

const DETAIL_LABELS: Readonly<Record<string, string>> = {
  command: 'command',
  operation: 'operation',
  name: 'name',
  action: 'action',
  content: 'content',
  activation_id: 'activation',
  already_active: 'already active',
  permission_hints: 'permission hints',
  dependencies: 'dependencies',
  dependency_degraded: 'dependency degraded',
  reason: 'reason',
  id: 'id',
  message: 'message',
  targets: 'targets',
  stats: 'stats',
  output: 'output',
  structured: 'structured',
  key_files: 'key files',
  rows: 'rows',
  cards: 'cards',
  items: 'items',
  timeout_ms: 'timeout',
  timeout_source: 'timeout source',
  requested_timeout_ms: 'requested timeout',
  exit_code: 'exit',
  duration_ms: 'duration',
  stdout: 'stdout',
  stderr: 'stderr',
  timed_out: 'timed out',
  truncated: 'truncated',
  query: 'query',
  provider: 'provider',
  count: 'count',
  sources: 'sources',
  results: 'results',
  sections: 'sections',
  matches: 'matches',
  filters: 'filters',
  total_concepts: 'concepts',
  total_matches: 'total matches',
  match_count: 'matches',
  max_results: 'limit',
  has_more: 'more',
  concept_title: 'concept',
  okf_version: 'OKF',
  total_sections: 'sections',
  concept: 'concept',
  body_offset: 'body offset',
  body_length: 'body length',
  returned_body_length: 'returned',
  links: 'links',
  backlinks: 'backlinks',
  link_count: 'links',
  backlink_count: 'backlinks',
  reason_code: 'reason',
  required_from_user: 'required',
  questions: 'questions',
  contains_secret: 'secret',
  result: 'result',
  thread_id: 'thread',
  subagent_id: 'subagent',
  task_name: 'task',
  title: 'title',
  agent_type: 'profile',
  context_mode: 'context mode',
  target: 'target',
  target_ids: 'targets',
  ids: 'ids',
  accepted: 'accepted',
  closed: 'closed',
  closed_count: 'closed',
  affected_ids: 'affected',
  agent_count: 'agents',
  total: 'total',
  running_only: 'running only',
  queued: 'queued',
  running: 'running',
  waiting_input: 'waiting',
  completed: 'completed',
  failed: 'failed',
  canceled: 'canceled',
  requested_ids: 'requested',
  requested_count: 'requested',
  found_count: 'found',
  missing_count: 'missing',
  missing_ids: 'missing ids',
  final_handoff_report: 'final handoff',
  progress_summary: 'progress summary',
  last_message: 'last message',
  waiting_prompt: 'waiting prompt',
  can_send_input: 'can send input',
  can_interrupt: 'can interrupt',
  can_close: 'can close',
  delegation_runtime: 'runtime',
  evidence_refs: 'evidence',
  remaining_risks: 'risks',
  next_actions: 'next actions',
  summary: 'summary',
  details: 'details',
  status: 'result status',
  error_code: 'error code',
  error_message: 'error message',
  error_retryable: 'retryable',
  content_ref: 'content ref',
};

const RENDERER_DETAIL_KEYS: Readonly<Record<Exclude<FlowerActivityRenderer, 'file' | 'patch' | 'todos'>, readonly string[]>> = {
  terminal: ['command', 'status', 'timeout_ms', 'timeout_source', 'requested_timeout_ms', 'exit_code', 'duration_ms', 'timed_out', 'truncated', 'stdout', 'stderr', 'summary', 'details', 'error_code', 'error_message', 'error_retryable'],
  web_search: ['query', 'provider', 'count', 'sources', 'results', 'status', 'summary', 'details', 'error_code', 'error_message', 'error_retryable'],
  question: ['reason_code', 'required_from_user', 'questions', 'contains_secret', 'status', 'summary', 'details', 'error_code', 'error_message', 'error_retryable'],
  completion: ['result', 'evidence_refs', 'remaining_risks', 'next_actions', 'status', 'summary', 'details', 'error_code', 'error_message', 'error_retryable'],
  structured: ['operation', 'name', 'action', 'content', 'content_ref', 'activation_id', 'already_active', 'permission_hints', 'dependencies', 'dependency_degraded', 'reason', 'id', 'status', 'message', 'timed_out', 'targets', 'stats', 'output', 'structured', 'key_files', 'rows', 'cards', 'items', 'query', 'count', 'provider', 'okf_version', 'total_sections', 'sections', 'filters', 'total_concepts', 'total_matches', 'match_count', 'max_results', 'has_more', 'omitted_count', 'matches', 'concept_title', 'concept', 'body_offset', 'body_length', 'returned_body_length', 'link_count', 'backlink_count', 'links', 'backlinks', 'data', 'result', 'limit', 'evidence_refs', 'remaining_risks', 'next_actions', 'truncated', 'summary', 'details', 'error_code', 'error_message', 'error_retryable'],
};

const SUBAGENT_DETAIL_KEYS: readonly string[] = [
  'action',
  'status',
  'thread_id',
  'subagent_id',
  'task_name',
  'title',
  'agent_type',
  'context_mode',
  'target',
  'target_ids',
  'ids',
  'accepted',
  'closed',
  'closed_count',
  'affected_ids',
  'agent_count',
  'total',
  'running_only',
  'queued',
  'running',
  'waiting_input',
  'completed',
  'failed',
  'canceled',
  'timed_out',
  'requested_ids',
  'requested_count',
  'found_count',
  'missing_count',
  'missing_ids',
  'final_handoff_report',
  'progress_summary',
  'last_message',
  'waiting_prompt',
  'can_send_input',
  'can_interrupt',
  'can_close',
  'delegation_runtime',
  'summary',
  'details',
  'error_code',
  'error_message',
  'error_retryable',
];

const SUBAGENT_BOOLEAN_DETAIL_KEYS = new Set([
  'accepted',
  'closed',
  'running_only',
  'can_send_input',
  'can_interrupt',
  'can_close',
  'error_retryable',
]);

const FILE_RAW_DETAIL_KEYS = new Set([
  'args',
  'additions',
  'content',
  'deletions',
  'diff_unavailable_reason',
  'display_name',
  'file_action_id',
  'files',
  'line_count',
  'line_offset',
  'mutations',
  'operation',
  'patch',
  'patch_text',
  'result',
  'total_lines',
  'unified_diff',
]);

function scalarText(value: unknown): string {
  if (typeof value === 'string') return trimString(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

function payloadValue(payload: Readonly<Record<string, unknown>> | undefined, ...keys: readonly string[]): string {
  if (!payload) return '';
  for (const key of keys) {
    const text = scalarText(payload[key]);
    if (text) return text;
  }
  return '';
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function compactJSON(value: unknown): string {
  if (value === undefined || value === null) return '';
  const scalar = scalarText(value);
  if (scalar) return scalar;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function numericValue(value: unknown): number {
  const raw = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

function boolValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function isSubagentBooleanDetailKey(key: string): boolean {
  return SUBAGENT_BOOLEAN_DETAIL_KEYS.has(key);
}

function isContentRefSuffix(value: string): boolean {
  return /^(?:[a-f0-9]{8,}|L\d+)$/i.test(value);
}

function displayFileName(value: string): string {
  let out = trimString(value);
  while (out.includes('#')) {
    const hashIndex = out.lastIndexOf('#');
    const suffix = out.slice(hashIndex + 1);
    if (!isContentRefSuffix(suffix)) break;
    out = trimString(out.slice(0, hashIndex));
  }
  return out;
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  return scalarText(value);
}

function normalizeTodoStatus(value: unknown): FlowerActivityTodoStatus {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'complete' || normalized === 'done') return 'completed';
  if (normalized === 'in_progress' || normalized === 'in progress' || normalized === 'active' || normalized === 'running') return 'in_progress';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  return 'pending';
}

function todoItemsFromPayload(payload: Readonly<Record<string, unknown>> | undefined): readonly FlowerActivityTodoItem[] {
  if (!payload) return [];
  const result = asRecord(payload.result);
  const args = asRecord(payload.args);
  const source = asArray(payload.todos).length > 0
    ? asArray(payload.todos)
    : asArray(result.todos).length > 0
      ? asArray(result.todos)
      : asArray(args.todos);
  return source.map((entry) => {
    const record = asRecord(entry);
    const content = payloadValue(record, 'content', 'title', 'task', 'text', 'description');
    if (!content) return null;
    const id = payloadValue(record, 'id');
    const note = payloadValue(record, 'note');
    return {
      ...(id ? { id } : {}),
      content,
      status: normalizeTodoStatus(record.after_status ?? record.status),
      ...(note ? { note } : {}),
    };
  }).filter((todo): todo is FlowerActivityTodoItem => todo !== null);
}

function rendererForItem(item: FlowerActivityItem): FlowerActivityRenderer {
  return item.renderer ?? 'structured';
}

function defaultLabelForItem(item: FlowerActivityItem): string {
  const label = trimString(item.label);
  return label || 'Activity';
}

function operationFromPayload(payload: Readonly<Record<string, unknown>> | undefined): string {
  return payloadValue(payload, 'operation', 'change_type').toLowerCase();
}

function isDeleteOperation(value: string): boolean {
  const normalized = trimString(value).toLowerCase();
  return normalized === 'delete' || normalized === 'deleted' || normalized === 'remove' || normalized === 'removed';
}

function fileVerbForOperation(operation: string): 'Read' | 'Edit' | 'Delete' {
  if (operation === 'read') return 'Read';
  if (isDeleteOperation(operation)) return 'Delete';
  return 'Edit';
}

function displayNameFromPayload(payload: Readonly<Record<string, unknown>> | undefined, label = ''): string {
  const explicit = displayFileName(payloadValue(payload, 'display_name'));
  if (explicit) return explicit;
  return displayFileName(label);
}

function actionFromPayload(
  payload: Readonly<Record<string, unknown>> | undefined,
  verb: 'Read' | 'Edit' | 'Delete',
  label: string,
  fileActions?: FlowerActivityFileActions,
): FlowerActivityFileAction {
  const actionID = payloadValue(payload, 'file_action_id');
  const registered = actionID ? fileActions?.[actionID] : undefined;
  const displayName = displayFileName(registered?.display_name ?? '') || displayNameFromPayload(payload, label);
  return {
    action_id: actionID,
    display_name: displayName,
    can_browse_directory: registered?.can_browse_directory === true,
    can_preview: registered?.can_preview === true && verb !== 'Delete',
  };
}

function titleText(title: FlowerActivityTitle): string {
  switch (title.kind) {
    case 'file':
      return [title.verb, title.display_name].filter(Boolean).join(' ');
    case 'command':
      return title.command;
    case 'plain':
      return title.text;
  }
}

function chipText(item: FlowerActivityItem): readonly string[] {
  return (item.chips ?? []).map((chip) => {
    const label = trimString(chip.label);
    const value = trimString(chip.value);
    return value ? `${label} ${value}` : label;
  }).filter(Boolean);
}

function metaForItem(item: FlowerActivityItem): string {
  const parts = [
    trimString(item.description),
    ...chipText(item),
  ].filter(Boolean);
  return Array.from(new Set(parts)).join(' · ');
}

function metaForTerminalItem(item: FlowerActivityItem): string {
  const payload = item.payload ?? {};
  const exit = payloadValue(payload, 'exit_code');
  const duration = payloadValue(payload, 'duration_ms');
  const timeout = payloadValue(payload, 'timed_out') === 'true' ? 'timed out' : '';
  const parts = [
    trimString(item.description),
    ...chipText(item),
    exit ? `exit ${exit}` : '',
    duration ? `${duration}ms` : '',
    timeout,
  ].filter(Boolean);
  return Array.from(new Set(parts)).join(' · ');
}

function isSubagentsActivityItem(item: FlowerActivityItem): boolean {
  const payload = item.payload ?? {};
  return trimString(item.tool_name) === 'subagents'
    || payloadValue(payload, 'operation') === 'subagents'
    || payloadValue(payload, 'delegation_runtime') === 'floret';
}

function detailLineTone(key: string): FlowerActivityDetailLine['tone'] {
  return key === 'command' || key === 'stdout' || key === 'stderr' ? 'code' : undefined;
}

function detailLabel(key: string, copy?: FlowerActivityPresentationCopy): string {
  const subagents = copy?.subagents?.activity.labels;
  switch (key) {
    case 'action':
      return subagents?.action ?? DETAIL_LABELS[key] ?? key;
    case 'status':
      return subagents?.status ?? DETAIL_LABELS[key] ?? key;
    case 'thread_id':
      return subagents?.thread ?? DETAIL_LABELS[key] ?? key;
    case 'subagent_id':
      return subagents?.subagent ?? DETAIL_LABELS[key] ?? key;
    case 'task_name':
      return subagents?.task ?? DETAIL_LABELS[key] ?? key;
    case 'title':
      return subagents?.title ?? DETAIL_LABELS[key] ?? key;
    case 'agent_type':
      return subagents?.profile ?? DETAIL_LABELS[key] ?? key;
    case 'target':
      return subagents?.target ?? DETAIL_LABELS[key] ?? key;
    case 'target_ids':
      return subagents?.targets ?? DETAIL_LABELS[key] ?? key;
    case 'ids':
      return subagents?.ids ?? DETAIL_LABELS[key] ?? key;
    case 'accepted':
      return subagents?.accepted ?? DETAIL_LABELS[key] ?? key;
    case 'closed':
    case 'closed_count':
      return subagents?.closed ?? DETAIL_LABELS[key] ?? key;
    case 'affected_ids':
      return subagents?.affected ?? DETAIL_LABELS[key] ?? key;
    case 'agent_count':
      return subagents?.agents ?? DETAIL_LABELS[key] ?? key;
    case 'total':
      return subagents?.total ?? DETAIL_LABELS[key] ?? key;
    case 'running_only':
      return subagents?.runningOnly ?? DETAIL_LABELS[key] ?? key;
    case 'queued':
      return subagents?.queued ?? DETAIL_LABELS[key] ?? key;
    case 'running':
      return subagents?.running ?? DETAIL_LABELS[key] ?? key;
    case 'waiting_input':
      return subagents?.waiting ?? DETAIL_LABELS[key] ?? key;
    case 'completed':
      return subagents?.completed ?? DETAIL_LABELS[key] ?? key;
    case 'failed':
      return subagents?.failed ?? DETAIL_LABELS[key] ?? key;
    case 'canceled':
      return subagents?.canceled ?? DETAIL_LABELS[key] ?? key;
    case 'timed_out':
      return subagents?.timedOut ?? DETAIL_LABELS[key] ?? key;
    case 'requested_ids':
    case 'requested_count':
      return subagents?.requested ?? DETAIL_LABELS[key] ?? key;
    case 'found_count':
      return subagents?.found ?? DETAIL_LABELS[key] ?? key;
    case 'missing_count':
      return subagents?.missing ?? DETAIL_LABELS[key] ?? key;
    case 'missing_ids':
      return subagents?.missingIds ?? DETAIL_LABELS[key] ?? key;
    case 'last_message':
      return subagents?.lastMessage ?? DETAIL_LABELS[key] ?? key;
    case 'waiting_prompt':
      return subagents?.waitingPrompt ?? DETAIL_LABELS[key] ?? key;
    case 'can_send_input':
      return subagents?.canSendInput ?? DETAIL_LABELS[key] ?? key;
    case 'can_interrupt':
      return subagents?.canInterrupt ?? DETAIL_LABELS[key] ?? key;
    case 'can_close':
      return subagents?.canClose ?? DETAIL_LABELS[key] ?? key;
    case 'delegation_runtime':
      return subagents?.runtime ?? DETAIL_LABELS[key] ?? key;
    case 'summary':
      return subagents?.summary ?? DETAIL_LABELS[key] ?? key;
    case 'details':
      return subagents?.details ?? DETAIL_LABELS[key] ?? key;
    case 'error_code':
      return subagents?.errorCode ?? DETAIL_LABELS[key] ?? key;
    case 'error_message':
      return subagents?.errorMessage ?? DETAIL_LABELS[key] ?? key;
    case 'error_retryable':
      return subagents?.retryable ?? DETAIL_LABELS[key] ?? key;
    default:
      return DETAIL_LABELS[key] ?? key;
  }
}

function errorDetailLineFromPayload(payload: Readonly<Record<string, unknown>>, key: string, copy?: FlowerActivityPresentationCopy): FlowerActivityDetailLine | null {
  if (key === 'error_code' || key === 'error_message' || key === 'error_retryable') {
    const error = asRecord(payload.error);
    const nestedKey = key === 'error_code' ? 'code' : key === 'error_message' ? 'message' : 'retryable';
    const value = compactJSON(error[nestedKey]);
    if (!value) return null;
    return {
      label: detailLabel(key, copy),
      value,
    };
  }
  return null;
}

function errorDetailLinesFromPayload(payload: Readonly<Record<string, unknown>> | undefined, copy?: FlowerActivityPresentationCopy): readonly FlowerActivityDetailLine[] {
  if (!payload) return [];
  return (['error_code', 'error_message', 'error_retryable'] as const)
    .map((key) => errorDetailLineFromPayload(payload, key, copy))
    .filter((line): line is FlowerActivityDetailLine => line !== null);
}

function detailLineFromPayload(payload: Readonly<Record<string, unknown>>, key: string, copy?: FlowerActivityPresentationCopy): FlowerActivityDetailLine | null {
  const errorLine = errorDetailLineFromPayload(payload, key, copy);
  if (errorLine) return errorLine;
  if (!(key in payload)) return null;
  const value = compactJSON(payload[key]);
  if (!value) return null;
  return {
    label: detailLabel(key, copy),
    value,
    ...(detailLineTone(key) ? { tone: detailLineTone(key) } : {}),
  };
}

function subagentDetailLineFromPayload(payload: Readonly<Record<string, unknown>>, key: string, copy?: FlowerActivityPresentationCopy): FlowerActivityDetailLine | null {
  if (!(key in payload)) return null;
  const rawValue = compactJSON(payload[key]);
  if (!rawValue) return null;
  let value = rawValue;
  if (key === 'action') {
    value = subagentActionLabel(rawValue, copy);
  } else if (key === 'status') {
    if (rawValue === 'ok') return null;
    value = subagentStatusLabel(rawValue, copy);
  } else if (key === 'agent_type') {
    value = subagentTypeLabel(rawValue, copy);
  } else if (isSubagentBooleanDetailKey(key) && typeof payload[key] === 'boolean') {
    value = payload[key] ? subagentsCopy(copy).activity.values.yes : subagentsCopy(copy).activity.values.no;
  }
  return {
    label: detailLabel(key, copy),
    value,
    ...(detailLineTone(key) ? { tone: detailLineTone(key) } : {}),
  };
}

function uniqueDetailLines(lines: readonly FlowerActivityDetailLine[]): readonly FlowerActivityDetailLine[] {
  const seen = new Set<string>();
  const out: FlowerActivityDetailLine[] = [];
  for (const line of lines) {
    const key = `${line.label}\x1e${line.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function genericDetailLinesForItem(item: FlowerActivityItem, renderer: Exclude<FlowerActivityRenderer, 'file' | 'patch' | 'todos'>): readonly FlowerActivityDetailLine[] {
  const payload = item.payload ?? {};
  const orderedKeys = new Set<string>(RENDERER_DETAIL_KEYS[renderer] ?? RENDERER_DETAIL_KEYS.structured);
  const lines = Array.from(orderedKeys)
    .map((key) => detailLineFromPayload(payload, key))
    .filter((line): line is FlowerActivityDetailLine => line !== null);
  if (item.requires_approval) {
    lines.unshift({
      label: 'approval',
      value: trimString(item.approval_state) || 'requested',
    });
  }
  if (lines.length === 0) {
    const defaultLines = [
      { label: 'status', value: item.status },
      { label: 'kind', value: item.kind },
      { label: 'tool', value: trimString(item.tool_name) },
      { label: 'item', value: trimString(item.item_id) },
    ].filter((line) => trimString(line.value));
    lines.push(...defaultLines);
  }
  return uniqueDetailLines(lines);
}

function nestedSubagentRecords(payload: Readonly<Record<string, unknown>> | undefined): readonly Readonly<Record<string, unknown>>[] {
  if (!payload) return [];
  const out: Readonly<Record<string, unknown>>[] = [];
  const pushRecord = (value: unknown) => {
    const record = asRecord(value);
    if (Object.keys(record).length > 0) out.push(record);
  };
  for (const key of ['snapshot', 'subagent', 'item']) pushRecord(payload[key]);
  for (const key of ['items']) asArray(payload[key]).forEach(pushRecord);
  return out;
}

function subagentDetailLinesFromRecord(record: Readonly<Record<string, unknown>>, copy?: FlowerActivityPresentationCopy): readonly FlowerActivityDetailLine[] {
  return SUBAGENT_DETAIL_KEYS
    .map((key) => subagentDetailLineFromPayload(record, key, copy))
    .filter((line): line is FlowerActivityDetailLine => line !== null);
}

function subagentsCopy(copy?: FlowerActivityPresentationCopy): FlowerSubagentsCopy {
  return copy?.subagents ?? DEFAULT_FLOWER_SURFACE_COPY.subagents!;
}

function subagentActionLabel(action: string, copy?: FlowerActivityPresentationCopy): string {
  const labels = subagentsCopy(copy).activity.actions;
  switch (trimString(action)) {
    case 'spawn':
      return labels.spawn;
    case 'send_input':
      return labels.send_input;
    case 'wait':
      return labels.wait;
    case 'list':
      return labels.list;
    case 'inspect':
      return labels.inspect;
    case 'close':
      return labels.close;
    case 'close_all':
      return labels.close_all;
    default:
      return labels.unknown;
  }
}

function subagentStatusLabel(status: string, copy?: FlowerActivityPresentationCopy): string {
  const labels = subagentsCopy(copy).statusLabels;
  switch (trimString(status)) {
    case 'queued':
      return labels.queued;
    case 'running':
      return labels.running;
    case 'waiting_input':
    case 'waiting':
      return labels.waiting_input;
    case 'completed':
      return labels.completed;
    case 'failed':
      return labels.failed;
    case 'canceled':
    case 'cancelled':
      return labels.canceled;
    case 'timed_out':
      return labels.timed_out;
    default:
      return labels.unknown;
  }
}

function subagentTypeLabel(agentType: string, copy?: FlowerActivityPresentationCopy): string {
  const labels = subagentsCopy(copy).typeLabels;
  const value = trimString(agentType);
  switch (value) {
    case 'explore':
      return labels.explore;
    case 'worker':
      return labels.worker;
    case 'reviewer':
      return labels.reviewer;
    default:
      return labels.unknown;
  }
}

function subagentTitleText(item: FlowerActivityItem, copy?: FlowerActivityPresentationCopy): string {
  const payload = item.payload ?? {};
  const action = payloadValue(payload, 'action');
  const directTitle = payloadValue(payload, 'task_name', 'title', 'target', 'subagent_id', 'thread_id');
  const verbs = subagentsCopy(copy).activity.titleVerbs;
  if (action === 'spawn' && directTitle) return `${verbs.spawn} ${directTitle}`;
  if ((action === 'send_input' || action === 'close') && directTitle) return `${verbs[action]} ${directTitle}`;
  const nested = nestedSubagentRecords(payload);
  if (nested.length === 1) {
    const title = payloadValue(nested[0], 'task_name', 'title', 'subagent_id', 'thread_id');
    if (title && action === 'spawn') return `${verbs.spawn} ${title}`;
    if (title) return action ? `${verbs[action as keyof typeof verbs] ?? subagentActionLabel(action, copy)} ${title}` : title;
  }
  const verb = action ? verbs[action as keyof typeof verbs] ?? subagentActionLabel(action, copy) : '';
  if (nested.length > 1) return `${verb || subagentActionLabel(action, copy)} (${nested.length})`;
  return verb || trimString(item.label) || subagentActionLabel(action, copy);
}

function metaForSubagents(item: FlowerActivityItem, copy?: FlowerActivityPresentationCopy): string {
  const payload = item.payload ?? {};
  const nested = nestedSubagentRecords(payload);
  const primary = nested[0] ?? {};
  const action = payloadValue(payload, 'action');
  const agentType = payloadValue(payload, 'agent_type') || payloadValue(primary, 'agent_type');
  const topLevelStatus = payloadValue(payload, 'status');
  const status = topLevelStatus && topLevelStatus !== 'ok' ? topLevelStatus : payloadValue(primary, 'status');
  const count = payloadValue(payload, 'agent_count', 'total', 'found_count', 'requested_count');
  const parts = [
    action ? subagentActionLabel(action, copy) : '',
    subagentTypeLabel(agentType, copy),
    count ? subagentsCopy(copy).activity.agentsCount(count) : '',
    status && status !== 'ok' ? subagentStatusLabel(status, copy) : '',
    ...chipText(item),
  ].filter(Boolean);
  return Array.from(new Set(parts)).join(' · ');
}

function presentationForSubagents(item: FlowerActivityItem, copy?: FlowerActivityPresentationCopy): FlowerActivityPresentation {
  const payload = item.payload ?? {};
  const title: FlowerActivityTitle = { kind: 'plain', text: subagentTitleText(item, copy) };
  const lines: FlowerActivityDetailLine[] = [];
  if (item.requires_approval) {
    lines.push({ label: subagentsCopy(copy).activity.labels.approval, value: trimString(item.approval_state) || 'requested' });
  }
  lines.push(...subagentDetailLinesFromRecord(payload, copy));
  const nested = nestedSubagentRecords(payload);
  nested.forEach((record) => {
    lines.push(...subagentDetailLinesFromRecord(record, copy));
  });
  if (lines.length === 0) {
    lines.push(...genericDetailLinesForItem(item, 'structured'));
  }
  const detailLines = uniqueDetailLines(lines);
  return {
    label: title.text,
    title,
    meta: metaForSubagents(item, copy),
    detailLines,
    detailBlocks: [{ kind: 'structured', lines: detailLines }],
  };
}

function fileStatusLines(item: FlowerActivityItem, payload: Readonly<Record<string, unknown>> | undefined): readonly FlowerActivityDetailLine[] {
  const lines: FlowerActivityDetailLine[] = [];
  if (item.requires_approval) {
    lines.push({ label: 'approval', value: trimString(item.approval_state) || 'requested' });
  }
  for (const key of ['status', 'summary', 'details', 'truncated']) {
    if (!payload || FILE_RAW_DETAIL_KEYS.has(key)) continue;
    if (key === 'truncated' && !boolValue(payload.truncated)) continue;
    const line = detailLineFromPayload(payload, key);
    if (line) lines.push(line);
  }
  lines.push(...errorDetailLinesFromPayload(payload));
  return uniqueDetailLines(lines);
}

function resultStatusLines(item: FlowerActivityItem, payload: Readonly<Record<string, unknown>> | undefined): readonly FlowerActivityDetailLine[] {
  const lines: FlowerActivityDetailLine[] = [];
  if (item.requires_approval) {
    lines.push({ label: 'approval', value: trimString(item.approval_state) || 'requested' });
  }
  if (payload) {
    for (const key of ['status', 'summary', 'details', 'truncated']) {
      if (key === 'truncated' && !boolValue(payload.truncated)) continue;
      const line = detailLineFromPayload(payload, key);
      if (line) lines.push(line);
    }
    lines.push(...errorDetailLinesFromPayload(payload));
  }
  return uniqueDetailLines(lines);
}

function diffFileFromMutation(
  item: FlowerActivityItem,
  mutation: Readonly<Record<string, unknown>>,
  defaultDisplayName: string,
  fileActions?: FlowerActivityFileActions,
): FlowerActivityDiffFile | null {
  const changeType = payloadValue(mutation, 'change_type') || operationFromPayload(item.payload) || 'update';
  const verb = fileVerbForOperation(changeType);
  const action = actionFromPayload(mutation, verb, displayNameFromPayload(mutation, defaultDisplayName), fileActions);
  const displayName = trimString(action.display_name) || defaultDisplayName;
  return {
    display_name: displayName,
    old_path: '',
    new_path: '',
    change_type: changeType,
    action,
    additions: numericValue(mutation.additions),
    deletions: numericValue(mutation.deletions),
    patch_text: contentText(mutation.unified_diff ?? mutation.patch_text),
    truncated: boolValue(mutation.truncated),
    diff_unavailable_reason: payloadValue(mutation, 'diff_unavailable_reason'),
  };
}

function diffFilesFromPayload(item: FlowerActivityItem, fileActions?: FlowerActivityFileActions): readonly FlowerActivityDiffFile[] {
  const payload = item.payload ?? {};
  const defaultDisplayName = payloadValue(payload, 'display_name') || trimString(item.label);
  const mutationSource = asArray(payload.mutations).length > 0 ? asArray(payload.mutations) : [payload];
  return mutationSource.map((entry) => diffFileFromMutation(item, asRecord(entry), defaultDisplayName, fileActions))
    .filter((file): file is FlowerActivityDiffFile => file !== null && trimString(file.display_name) !== '');
}

function titleForPatchItem(item: FlowerActivityItem, files: readonly FlowerActivityDiffFile[]): FlowerActivityTitle {
  if (files.length === 1) {
    const file = files[0];
    return { kind: 'file', verb: fileVerbForOperation(file.change_type), display_name: file.display_name };
  }
  if (files.length > 1) {
    return { kind: 'file', verb: 'Edit', display_name: `${files.length} files` };
  }
  const fallbackName = trimString(item.label);
  return { kind: 'file', verb: 'Edit', display_name: (fallbackName && fallbackName !== 'apply_patch' ? fallbackName : 'files') };
}

function presentationForFile(item: FlowerActivityItem, fileActions?: FlowerActivityFileActions): FlowerActivityPresentation {
  const payload = item.payload ?? {};
  const operation = operationFromPayload(payload) || 'edit';
  const verb = fileVerbForOperation(operation);
  const action = actionFromPayload(payload, verb, trimString(item.label), fileActions);
  let displayName = action.display_name || trimString(item.label) || defaultLabelForItem(item);
  if (displayName === 'read_files') displayName = 'files';
  if (displayName === 'apply_patch') displayName = 'files';
  const title: FlowerActivityTitle = { kind: 'file', verb, display_name: displayName };
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  if (verb === 'Read') {
    detailBlocks.push({
      kind: 'file_read',
      action,
      content: contentText(payload.content),
      line_offset: numericValue(payload.line_offset) || 1,
      line_count: numericValue(payload.line_count),
      total_lines: numericValue(payload.total_lines),
      truncated: boolValue(payload.truncated),
    });
  } else {
    const files = diffFilesFromPayload(item, fileActions);
    if (files.length > 0) {
      detailBlocks.push({ kind: 'file_diff', files });
    }
  }
  const statusLines = fileStatusLines(item, payload);
  if (statusLines.length > 0) {
    detailBlocks.push({ kind: 'structured', lines: statusLines });
  }
  return {
    label: titleText(title),
    title,
    meta: metaForItem(item),
    primaryAction: action,
    detailLines: statusLines,
    detailBlocks,
  };
}

function presentationForPatch(item: FlowerActivityItem, fileActions?: FlowerActivityFileActions): FlowerActivityPresentation {
  const files = diffFilesFromPayload(item, fileActions);
  const title = titleForPatchItem(item, files);
  const payload = item.payload ?? {};
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  if (files.length > 0) {
    detailBlocks.push({ kind: 'file_diff', files });
  }
  const statusLines = fileStatusLines(item, payload);
  if (statusLines.length > 0) {
    detailBlocks.push({ kind: 'structured', lines: statusLines });
  }
  return {
    label: titleText(title),
    title,
    meta: metaForItem(item),
    ...(files.length === 1 ? { primaryAction: files[0].action } : {}),
    detailLines: statusLines,
    detailBlocks,
  };
}

function presentationForTodos(item: FlowerActivityItem): FlowerActivityPresentation {
  const title: FlowerActivityTitle = { kind: 'plain', text: trimString(item.label) || 'Update todos' };
  const items = todoItemsFromPayload(item.payload);
  const statusLines = resultStatusLines(item, item.payload);
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  if (items.length > 0) {
    detailBlocks.push({ kind: 'todos', items });
  }
  if (statusLines.length > 0) {
    detailBlocks.push({ kind: 'structured', lines: statusLines });
  }
  const counts = items.reduce<Record<FlowerActivityTodoStatus, number>>((acc, todo) => {
    acc[todo.status] += 1;
    return acc;
  }, { pending: 0, in_progress: 0, completed: 0, cancelled: 0 });
  const meta = ([
    counts.completed > 0 ? `completed ${counts.completed}` : '',
    counts.in_progress > 0 ? `in progress ${counts.in_progress}` : '',
    counts.pending > 0 ? `pending ${counts.pending}` : '',
    counts.cancelled > 0 ? `cancelled ${counts.cancelled}` : '',
  ]).filter(Boolean).join(' · ');
  return {
    label: title.text,
    title,
    meta,
    detailLines: statusLines,
    detailBlocks,
  };
}

function titleWithToolContext(toolName: string, explicit: string, fallback: string): string {
  const meaningful = explicit && explicit !== 'Tool approval' ? explicit : '';
  const label = meaningful || fallback;
  switch (toolName) {
    case 'okf.search': return explicit ? `OKF search "${explicit}"` : 'OKF search';
    case 'okf.open': return explicit ? `OKF concept "${explicit}"` : 'OKF concept';
    case 'okf.index': return explicit ? `OKF index · ${explicit}` : 'OKF index';
    case 'rgrep': return explicit ? `rgrep "${explicit}"` : 'rgrep';
    case 'find': return explicit ? `find ${explicit}` : 'find';
    case 'web.search': return explicit ? `Web search "${explicit}"` : 'Web search';
    case 'web_fetch': return explicit ? `Web fetch ${explicit}` : 'Web fetch';
    case 'use_skill': return explicit ? `Skill ${explicit}` : 'Skill';
    default: return label;
  }
}

function titleForGenericItem(item: FlowerActivityItem, renderer: FlowerActivityRenderer): FlowerActivityTitle {
  const explicit = trimString(item.label);
  const toolName = trimString(item.tool_name);
  const meaningful = (text: string) => text && text !== 'Tool approval' ? text : '';
  switch (renderer) {
    case 'terminal': {
      const command = payloadValue(item.payload, 'command') || meaningful(explicit) || toolName || defaultLabelForItem(item);
      return { kind: 'command', command };
    }
    case 'web_search':
      return { kind: 'plain', text: titleWithToolContext(toolName, explicit, defaultLabelForItem(item)) };
    case 'question':
      return { kind: 'plain', text: meaningful(explicit) || trimString(item.description) || payloadValue(item.payload, 'question', 'summary') || defaultLabelForItem(item) };
    case 'completion':
      return { kind: 'plain', text: meaningful(explicit) || payloadValue(item.payload, 'result') || defaultLabelForItem(item) };
    default:
      return { kind: 'plain', text: titleWithToolContext(toolName, explicit, defaultLabelForItem(item)) };
  }
}

export function presentFlowerActivityItem(item: FlowerActivityItem, fileActions?: FlowerActivityFileActions, copy?: FlowerActivityPresentationCopy): FlowerActivityPresentation {
  const renderer = rendererForItem(item);
  if (isSubagentsActivityItem(item)) return presentationForSubagents(item, copy);
  if (renderer === 'file') return presentationForFile(item, fileActions);
  if (renderer === 'patch') return presentationForPatch(item, fileActions);
  if (renderer === 'todos') return presentationForTodos(item);
  const title = titleForGenericItem(item, renderer);
  const detailLines = genericDetailLinesForItem(item, renderer);
  const detailBlocks: FlowerActivityDetailBlock[] = [{
    kind: renderer === 'terminal' ? 'terminal' : 'structured',
    lines: detailLines,
  }];
  return {
    label: titleText(title),
    title,
    meta: renderer === 'terminal' ? metaForTerminalItem(item) : metaForItem(item),
    detailLines,
    detailBlocks,
  };
}
