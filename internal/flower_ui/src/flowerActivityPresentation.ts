import type {
  FlowerActivityFileAction as FlowerActivityFileActionRecord,
  FlowerActivityItem,
  FlowerActivityRenderer,
  FlowerActivitySubagentAction as FlowerActivitySubagentActionRecord,
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

export type FlowerActivityTerminalDetail = Readonly<{
  command: string;
  output: string;
  latest_output: string;
  status: FlowerActivityItem['status'];
  process_id: string;
  execution_location: string;
  exit_code?: number;
  duration_ms?: number;
  total_bytes?: number;
  first_seq?: number;
  last_seq?: number;
  truncated: boolean;
  timed_out: boolean;
}>;

export type FlowerActivityWebSearchEntry = Readonly<{
  title: string;
  url: string;
  snippet: string;
  source: string;
}>;

export type FlowerActivityWebSearchDetail = Readonly<{
  query: string;
  provider: string;
  count?: number;
  results: readonly FlowerActivityWebSearchEntry[];
  sources: readonly FlowerActivityWebSearchEntry[];
  matches: readonly FlowerActivityWebSearchEntry[];
  sections: readonly FlowerActivityWebSearchEntry[];
}>;

export type FlowerActivityQuestionChoice = Readonly<{
  label: string;
  description: string;
}>;

export type FlowerActivityQuestionItem = Readonly<{
  id: string;
  question: string;
  choices: readonly FlowerActivityQuestionChoice[];
  write_label: string;
}>;

export type FlowerActivityQuestionDetail = Readonly<{
  reason: string;
  required: readonly string[];
  questions: readonly FlowerActivityQuestionItem[];
  contains_secret: boolean;
}>;

export type FlowerActivityCompletionDetail = Readonly<{
  result: string;
  summary: string;
  details: string;
  evidence_refs: readonly string[];
  remaining_risks: readonly string[];
  next_actions: readonly string[];
}>;

export type FlowerActivityErrorDetail = Readonly<{
  message: string;
}>;

export type FlowerActivitySubagentDetailItem = Readonly<{
  title: string;
  task: string;
  agent_type: string;
  status: string;
  context_mode: string;
  handoff: string;
  progress: string;
}>;

export type FlowerActivitySubagentsDetail = Readonly<{
  action: string;
  task: string;
  agent_type: string;
  status: string;
  context_mode: string;
  summary: string;
  counts: readonly FlowerActivityDetailLine[];
  items: readonly FlowerActivitySubagentDetailItem[];
}>;

export type FlowerActivityDetailBlock =
  | Readonly<{
    kind: 'structured';
    lines: readonly FlowerActivityDetailLine[];
  }>
  | Readonly<{
    kind: 'error';
    error: FlowerActivityErrorDetail;
  }>
  | Readonly<{
    kind: 'subagents';
    subagents: FlowerActivitySubagentsDetail;
  }>
  | Readonly<{
    kind: 'terminal_output';
    terminal: FlowerActivityTerminalDetail;
  }>
  | Readonly<{
    kind: 'web_search';
    search: FlowerActivityWebSearchDetail;
  }>
  | Readonly<{
    kind: 'question';
    question: FlowerActivityQuestionDetail;
  }>
  | Readonly<{
    kind: 'completion';
    completion: FlowerActivityCompletionDetail;
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

type FlowerActivityPresentationSidecars = Readonly<{
  subagentAction?: FlowerActivitySubagentActionRecord;
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
  process_id: 'process',
  execution_location: 'location',
  latest_output: 'latest output',
  first_seq: 'first seq',
  last_seq: 'last seq',
  total_bytes: 'bytes',
  started_at_ms: 'started',
  ended_at_ms: 'ended',
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

const RENDERER_DETAIL_KEYS: Readonly<Record<'structured', readonly string[]>> = {
  structured: ['operation', 'name', 'action', 'content', 'content_ref', 'activation_id', 'already_active', 'permission_hints', 'dependencies', 'dependency_degraded', 'reason', 'id', 'status', 'message', 'timed_out', 'targets', 'stats', 'output', 'structured', 'key_files', 'rows', 'cards', 'items', 'query', 'count', 'provider', 'okf_version', 'total_sections', 'sections', 'filters', 'total_concepts', 'total_matches', 'match_count', 'max_results', 'has_more', 'omitted_count', 'matches', 'concept_title', 'concept', 'body_offset', 'body_length', 'returned_body_length', 'link_count', 'backlink_count', 'links', 'backlinks', 'data', 'result', 'limit', 'evidence_refs', 'remaining_risks', 'next_actions', 'truncated', 'summary', 'details'],
};

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

function optionalNumericValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : undefined;
}

function boolValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function rawTextValue(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\r\n?/g, '\n');
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

function rawPayloadText(payload: Readonly<Record<string, unknown>> | undefined, ...keys: readonly string[]): string {
  if (!payload) return '';
  for (const key of keys) {
    const value = rawTextValue(payload[key]);
    if (value.trim()) return value;
  }
  return '';
}

function compactTextArray(value: unknown): readonly string[] {
  const source = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return source.map((entry) => compactJSON(entry).trim()).filter(Boolean);
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
  const toolName = trimString(item.tool_name);
  if (label && label !== toolName && label !== 'Tool approval') return label;
  return toolName || 'tool';
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
  const desc = trimString(item.description);
  const isApprovalState = /^(requested|approved|rejected|timed_out|canceled)$/.test(desc);
  const parts = [
    ...(isApprovalState ? [] : [desc]),
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

function sidecarRecord(value: FlowerActivitySubagentActionRecord | undefined): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' ? value as Readonly<Record<string, unknown>> : {};
}

function subagentPayloadForItem(item: FlowerActivityItem, subagentAction?: FlowerActivitySubagentActionRecord): Readonly<Record<string, unknown>> {
  const payload = item.payload ?? {};
  if (!subagentAction) return payload;
  const sidecar = sidecarRecord(subagentAction);
  return {
    ...payload,
    ...sidecar,
    operation: payloadValue(payload, 'operation') || payloadValue(sidecar, 'operation') || 'subagents',
    action: payloadValue(payload, 'action') || payloadValue(sidecar, 'action'),
    delegation_runtime: payloadValue(payload, 'delegation_runtime') || payloadValue(sidecar, 'delegation_runtime') || 'floret',
  };
}

function isSubagentsActivityItem(item: FlowerActivityItem, subagentAction?: FlowerActivitySubagentActionRecord): boolean {
  if (subagentAction) return true;
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

function errorMessageFromPayload(payload: Readonly<Record<string, unknown>> | undefined): string {
  if (!payload) return '';
  const error = asRecord(payload.error);
  const nestedMessage = payloadValue(error, 'message');
  if (nestedMessage) return nestedMessage;
  const scalarError = scalarText(payload.error);
  if (scalarError) return scalarError;
  return payloadValue(payload, 'details', 'summary', 'message', 'reason');
}

function errorDetailBlockForItem(item: FlowerActivityItem, payload: Readonly<Record<string, unknown>> | undefined): Extract<FlowerActivityDetailBlock, { kind: 'error' }> | null {
  const message = errorMessageFromPayload(payload) || (item.status === 'error' ? 'Tool failed.' : '');
  if (!message) return null;
  return {
    kind: 'error',
    error: { message },
  };
}

function detailLineFromPayload(payload: Readonly<Record<string, unknown>>, key: string, copy?: FlowerActivityPresentationCopy): FlowerActivityDetailLine | null {
  if (!(key in payload)) return null;
  const value = compactJSON(payload[key]);
  if (!value) return null;
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

function genericDetailLinesForItem(item: FlowerActivityItem, renderer: 'structured'): readonly FlowerActivityDetailLine[] {
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
  return uniqueDetailLines(lines);
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

function subagentContextModeLabel(value: string): string {
  switch (trimString(value)) {
    case 'full_history':
      return 'Full history';
    case 'mission_only':
      return 'Mission only';
    default:
      return '';
  }
}

function subagentItemRecords(payload: Readonly<Record<string, unknown>> | undefined): readonly Readonly<Record<string, unknown>>[] {
  return asArray(payload?.items)
    .map((entry) => asRecord(entry))
    .filter((record) => Object.keys(record).length > 0);
}

function normalizedSubagentStatus(value: string): string {
  switch (trimString(value).toLowerCase()) {
    case 'queued':
    case 'running':
    case 'waiting_input':
    case 'completed':
    case 'failed':
    case 'canceled':
    case 'timed_out':
      return trimString(value).toLowerCase();
    case 'waiting':
    case 'interrupted':
      return 'waiting_input';
    case 'cancelled':
    case 'closed':
      return 'canceled';
    default:
      return '';
  }
}

function subagentStatusFromItemStatus(status: FlowerActivityItem['status']): string {
  switch (status) {
    case 'running':
      return 'running';
    case 'waiting':
    case 'pending':
      return 'queued';
    case 'error':
      return 'failed';
    case 'canceled':
      return 'canceled';
    default:
      return '';
  }
}

function subagentDisplayStatus(raw: string, copy?: FlowerActivityPresentationCopy): string {
  const status = normalizedSubagentStatus(raw);
  return status ? subagentStatusLabel(status, copy) : '';
}

function subagentRecordTitle(record: Readonly<Record<string, unknown>>): string {
  return payloadValue(record, 'task_name', 'title');
}

function subagentDetailItemFromRecord(record: Readonly<Record<string, unknown>>, copy?: FlowerActivityPresentationCopy): FlowerActivitySubagentDetailItem | null {
  const title = subagentRecordTitle(record);
  const task = payloadValue(record, 'task_name');
  const agentType = payloadValue(record, 'agent_type');
  const status = subagentDisplayStatus(payloadValue(record, 'status'), copy);
  const contextMode = subagentContextModeLabel(payloadValue(record, 'context_mode'));
  const handoff = payloadValue(record, 'handoff');
  const progress = payloadValue(record, 'current_signal', 'state', 'next_expected_step');
  if (!title && !task && !status && !contextMode && !handoff && !progress) return null;
  return {
    title: title || task || status,
    task,
    agent_type: agentType ? subagentTypeLabel(agentType, copy) : '',
    status,
    context_mode: contextMode,
    handoff,
    progress,
  };
}

function subagentDetailItemsFromSummary(summary: Readonly<Record<string, unknown>>, key: 'reports' | 'items' | 'progress', copy?: FlowerActivityPresentationCopy): readonly FlowerActivitySubagentDetailItem[] {
  return asArray(summary[key])
    .map((entry) => subagentDetailItemFromRecord(asRecord(entry), copy))
    .filter((item): item is FlowerActivitySubagentDetailItem => item !== null);
}

function uniqueSubagentDetailItems(items: readonly FlowerActivitySubagentDetailItem[]): readonly FlowerActivitySubagentDetailItem[] {
  const seen = new Set<string>();
  const out: FlowerActivitySubagentDetailItem[] = [];
  for (const item of items) {
    const key = [item.title, item.task, item.agent_type, item.status, item.context_mode, item.handoff, item.progress].join('\x1e');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function subagentCountLines(payload: Readonly<Record<string, unknown>> | undefined, copy?: FlowerActivityPresentationCopy): readonly FlowerActivityDetailLine[] {
  if (!payload) return [];
  const out: FlowerActivityDetailLine[] = [];
  const counts = asRecord(payload.counts);
  const add = (key: string, value: unknown) => {
    const text = scalarText(value);
    if (!text || text === '0') return;
    out.push({ label: detailLabel(key, copy), value: text });
  };
  for (const key of ['agent_count', 'total', 'queued', 'running', 'waiting_input', 'completed', 'failed', 'canceled', 'timed_out', 'requested_count', 'found_count', 'missing_count', 'closed_count', 'stopped_count', 'omitted_count']) {
    if (key in payload) add(key, payload[key]);
  }
  for (const key of ['queued', 'running', 'waiting_input', 'waiting', 'completed', 'failed', 'canceled', 'cancelled', 'timed_out', 'total']) {
    if (key in counts) add(key, counts[key]);
  }
  return uniqueDetailLines(out);
}

function subagentSummaryText(payload: Readonly<Record<string, unknown>> | undefined): string {
  if (!payload) return '';
  const handoff = asRecord(payload.final_handoff_report);
  const progress = asRecord(payload.progress_summary);
  return payloadValue(handoff, 'summary')
    || payloadValue(progress, 'summary')
    || payloadValue(payload, 'summary');
}

function subagentsDetailFromPayload(item: FlowerActivityItem, payload: Readonly<Record<string, unknown>>, copy?: FlowerActivityPresentationCopy): FlowerActivitySubagentsDetail {
  const items = subagentItemRecords(payload);
  const primary = items[0] ?? payload;
  const handoff = asRecord(payload.final_handoff_report);
  const progress = asRecord(payload.progress_summary);
  const handoffItems = subagentDetailItemsFromSummary(handoff, 'reports', copy);
  const progressItems = [
    ...subagentDetailItemsFromSummary(progress, 'items', copy),
    ...subagentDetailItemsFromSummary(progress, 'progress', copy),
  ];
  const directItems = items.map((record) => subagentDetailItemFromRecord(record, copy)).filter((entry): entry is FlowerActivitySubagentDetailItem => entry !== null);
  const topLevelItem = directItems.length === 0 ? subagentDetailItemFromRecord(payload, copy) : null;
  const rawStatus = payloadValue(payload, 'status') !== 'ok'
    ? payloadValue(payload, 'status')
    : payloadValue(primary, 'status') || subagentStatusFromItemStatus(item.status);
  const agentType = payloadValue(payload, 'agent_type') || payloadValue(primary, 'agent_type');
  return {
    action: subagentActionLabel(payloadValue(payload, 'action'), copy),
    task: payloadValue(payload, 'task_name', 'title') || payloadValue(primary, 'task_name', 'title'),
    agent_type: agentType ? subagentTypeLabel(agentType, copy) : '',
    status: subagentDisplayStatus(rawStatus, copy),
    context_mode: subagentContextModeLabel(payloadValue(payload, 'context_mode') || payloadValue(primary, 'context_mode')),
    summary: subagentSummaryText(payload),
    counts: subagentCountLines(payload, copy),
    items: uniqueSubagentDetailItems([
      ...(topLevelItem ? [topLevelItem] : []),
      ...directItems,
      ...handoffItems,
      ...progressItems,
    ]),
  };
}

function subagentTitleText(item: FlowerActivityItem, copy?: FlowerActivityPresentationCopy, subagentAction?: FlowerActivitySubagentActionRecord): string {
  const payload = subagentPayloadForItem(item, subagentAction);
  const action = payloadValue(payload, 'action');
  const directTitle = payloadValue(payload, 'task_name', 'title');
  const verbs = subagentsCopy(copy).activity.titleVerbs;
  if (directTitle) {
    const verb = action ? verbs[action as keyof typeof verbs] ?? subagentActionLabel(action, copy) : '';
    return verb ? `${verb} ${directTitle}` : directTitle;
  }
  const nested = subagentItemRecords(payload);
  if (nested.length === 1) {
    const title = payloadValue(nested[0], 'task_name', 'title');
    if (title && action === 'spawn') return `${verbs.spawn} ${title}`;
    if (title) return action ? `${verbs[action as keyof typeof verbs] ?? subagentActionLabel(action, copy)} ${title}` : title;
  }
  const verb = action ? verbs[action as keyof typeof verbs] ?? subagentActionLabel(action, copy) : '';
  if (nested.length > 1) return `${verb || subagentActionLabel(action, copy)} (${nested.length})`;
  return verb || trimString(item.label) || subagentActionLabel(action, copy);
}

function metaForSubagents(item: FlowerActivityItem, copy?: FlowerActivityPresentationCopy, subagentAction?: FlowerActivitySubagentActionRecord): string {
  const payload = subagentPayloadForItem(item, subagentAction);
  const nested = subagentItemRecords(payload);
  const primary = nested[0] ?? {};
  const action = payloadValue(payload, 'action');
  const agentType = payloadValue(payload, 'agent_type') || payloadValue(primary, 'agent_type');
  const topLevelStatus = payloadValue(payload, 'status');
  const status = topLevelStatus && topLevelStatus !== 'ok' ? topLevelStatus : payloadValue(primary, 'status') || subagentStatusFromItemStatus(item.status);
  const count = payloadValue(payload, 'agent_count', 'total', 'found_count', 'requested_count');
  const publicChips = chipText(item).filter((chip) => !/^status\s+ok$/i.test(chip));
  const parts = [
    action ? subagentActionLabel(action, copy) : '',
    agentType ? subagentTypeLabel(agentType, copy) : '',
    count ? subagentsCopy(copy).activity.agentsCount(count) : '',
    subagentDisplayStatus(status, copy),
    ...publicChips,
  ].filter(Boolean);
  return Array.from(new Set(parts)).join(' · ');
}

function presentationForSubagents(item: FlowerActivityItem, copy?: FlowerActivityPresentationCopy, subagentAction?: FlowerActivitySubagentActionRecord): FlowerActivityPresentation {
  const payload = subagentPayloadForItem(item, subagentAction);
  const title: FlowerActivityTitle = { kind: 'plain', text: subagentTitleText(item, copy, subagentAction) };
  const detail = subagentsDetailFromPayload(item, payload, copy);
  const approvalLines: FlowerActivityDetailLine[] = [];
  if (item.requires_approval) {
    approvalLines.push({ label: subagentsCopy(copy).activity.labels.approval, value: trimString(item.approval_state) || 'requested' });
  }
  const detailLines = uniqueDetailLines([...approvalLines, ...detail.counts]);
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  const errorBlock = errorDetailBlockForItem(item, payload);
  if (errorBlock) detailBlocks.push(errorBlock);
  detailBlocks.push({ kind: 'subagents', subagents: detail });
  if (approvalLines.length > 0) detailBlocks.push({ kind: 'structured', lines: approvalLines });
  return {
    label: title.text,
    title,
    meta: metaForSubagents(item, copy, subagentAction),
    detailLines,
    detailBlocks,
  };
}

function fileStatusLines(item: FlowerActivityItem, payload: Readonly<Record<string, unknown>> | undefined): readonly FlowerActivityDetailLine[] {
  const lines: FlowerActivityDetailLine[] = [];
  if (item.requires_approval) {
    lines.push({ label: 'approval', value: trimString(item.approval_state) || 'requested' });
  }
  for (const key of ['status', 'summary', 'details', 'truncated']) {
    if (item.status === 'error' && key === 'status') continue;
    if (!payload || FILE_RAW_DETAIL_KEYS.has(key)) continue;
    if (key === 'truncated' && !boolValue(payload.truncated)) continue;
    const line = detailLineFromPayload(payload, key);
    if (line) lines.push(line);
  }
  return uniqueDetailLines(lines);
}

function resultStatusLines(item: FlowerActivityItem, payload: Readonly<Record<string, unknown>> | undefined): readonly FlowerActivityDetailLine[] {
  const lines: FlowerActivityDetailLine[] = [];
  if (item.requires_approval) {
    lines.push({ label: 'approval', value: trimString(item.approval_state) || 'requested' });
  }
  if (payload) {
    for (const key of ['status', 'summary', 'details', 'truncated']) {
      if (item.status === 'error' && key === 'status') continue;
      if (key === 'truncated' && !boolValue(payload.truncated)) continue;
      const line = detailLineFromPayload(payload, key);
      if (line) lines.push(line);
    }
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
  const errorBlock = errorDetailBlockForItem(item, payload);
  if (errorBlock) detailBlocks.push(errorBlock);
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
  const errorBlock = errorDetailBlockForItem(item, payload);
  if (errorBlock) detailBlocks.push(errorBlock);
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
  const errorBlock = errorDetailBlockForItem(item, item.payload);
  const statusLines = errorBlock ? [] : resultStatusLines(item, item.payload);
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  if (errorBlock) {
    detailBlocks.push(errorBlock);
  }
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

function terminalCommandForItem(item: FlowerActivityItem): string {
  const payload = item.payload ?? {};
  const toolName = trimString(item.tool_name);
  const label = trimString(item.label);
  const meaningfulLabel = label && label !== toolName && label !== 'Tool approval' ? label : '';
  return payloadValue(payload, 'command') || meaningfulLabel || defaultLabelForItem(item);
}

function terminalOutputFromPayload(payload: Readonly<Record<string, unknown>>): string {
  const output = rawPayloadText(payload, 'output');
  if (output.trim()) return output;
  const stdout = rawPayloadText(payload, 'stdout');
  const stderr = rawPayloadText(payload, 'stderr');
  if (stdout.trim() && stderr.trim()) return `${stdout.replace(/\s+$/g, '')}\n\n[stderr]\n${stderr}`;
  return stdout || stderr;
}

function terminalStatusLines(item: FlowerActivityItem): readonly FlowerActivityDetailLine[] {
  if (item.requires_approval) {
    return [{ label: 'approval', value: trimString(item.approval_state) || 'requested' }];
  }
  return [];
}

function presentationForTerminal(item: FlowerActivityItem): FlowerActivityPresentation {
  const payload = item.payload ?? {};
  const command = terminalCommandForItem(item);
  const title: FlowerActivityTitle = { kind: 'command', command };
  const detailLines = terminalStatusLines(item);
  const terminal: FlowerActivityTerminalDetail = {
    command,
    output: terminalOutputFromPayload(payload),
    latest_output: rawPayloadText(payload, 'latest_output'),
    status: item.status,
    process_id: payloadValue(payload, 'process_id'),
    execution_location: payloadValue(payload, 'execution_location'),
    exit_code: optionalNumericValue(payload.exit_code),
    duration_ms: optionalNumericValue(payload.duration_ms),
    total_bytes: optionalNumericValue(payload.total_bytes),
    first_seq: optionalNumericValue(payload.first_seq),
    last_seq: optionalNumericValue(payload.last_seq),
    truncated: boolValue(payload.truncated),
    timed_out: boolValue(payload.timed_out),
  };
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  const errorBlock = errorDetailBlockForItem(item, payload);
  if (errorBlock) detailBlocks.push(errorBlock);
  detailBlocks.push({ kind: 'terminal_output', terminal });
  if (detailLines.length > 0) detailBlocks.push({ kind: 'structured', lines: detailLines });
  return {
    label: command,
    title,
    meta: metaForTerminalItem(item),
    detailLines,
    detailBlocks,
  };
}

function entryFromRecord(value: unknown): FlowerActivityWebSearchEntry | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    const title = scalarText(value);
    return title ? { title, url: '', snippet: '', source: '' } : null;
  }
  const title = payloadValue(record, 'title', 'name', 'concept_title', 'label', 'url', 'uri', 'source');
  const url = payloadValue(record, 'url', 'uri', 'href');
  const snippet = payloadValue(record, 'snippet', 'summary', 'text', 'content', 'body', 'description');
  const source = payloadValue(record, 'source', 'provider', 'concept', 'section');
  if (!title && !url && !snippet && !source) return null;
  return { title: title || url || source || snippet, url, snippet, source };
}

function webEntries(payload: Readonly<Record<string, unknown>>, key: string): readonly FlowerActivityWebSearchEntry[] {
  return asArray(payload[key]).map(entryFromRecord).filter((entry): entry is FlowerActivityWebSearchEntry => entry !== null);
}

function firstAvailableEntries(payload: Readonly<Record<string, unknown>>, keys: readonly string[]): readonly FlowerActivityWebSearchEntry[] {
  for (const key of keys) {
    const entries = webEntries(payload, key);
    if (entries.length > 0) return entries;
  }
  return [];
}

function countFromPayload(payload: Readonly<Record<string, unknown>>): number | undefined {
  for (const key of ['count', 'result_count', 'total_results', 'total_matches', 'match_count', 'total_sections']) {
    const value = optionalNumericValue(payload[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function presentationForWebSearch(item: FlowerActivityItem): FlowerActivityPresentation {
  const payload = item.payload ?? {};
  const title = titleForGenericItem(item, 'web_search');
  const errorBlock = errorDetailBlockForItem(item, payload);
  const detailLines = errorBlock ? resultStatusLines(item, payload).filter((line) => line.label !== 'summary' && line.label !== 'details') : resultStatusLines(item, payload);
  const search: FlowerActivityWebSearchDetail = {
    query: payloadValue(payload, 'query') || trimString(item.label),
    provider: payloadValue(payload, 'provider', 'okf_version'),
    count: countFromPayload(payload),
    results: firstAvailableEntries(payload, ['results', 'items', 'cards', 'rows']),
    sources: firstAvailableEntries(payload, ['sources', 'links', 'backlinks']),
    matches: firstAvailableEntries(payload, ['matches']),
    sections: firstAvailableEntries(payload, ['sections']),
  };
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  if (errorBlock) detailBlocks.push(errorBlock);
  detailBlocks.push({ kind: 'web_search', search });
  if (detailLines.length > 0) detailBlocks.push({ kind: 'structured', lines: detailLines });
  return {
    label: titleText(title),
    title,
    meta: metaForItem(item),
    detailLines,
    detailBlocks,
  };
}

function questionChoices(value: unknown): readonly FlowerActivityQuestionChoice[] {
  return asArray(value).map((entry) => {
    const record = asRecord(entry);
    const label = payloadValue(record, 'label', 'value', 'id', 'text') || scalarText(entry);
    if (!label) return null;
    return {
      label,
      description: payloadValue(record, 'description', 'help', 'detail'),
    };
  }).filter((choice): choice is FlowerActivityQuestionChoice => choice !== null);
}

function questionItems(payload: Readonly<Record<string, unknown>>): readonly FlowerActivityQuestionItem[] {
  const questions = asArray(payload.questions).map((entry) => {
    const record = asRecord(entry);
    const question = payloadValue(record, 'question', 'prompt', 'label', 'text');
    if (!question) return null;
    return {
      id: payloadValue(record, 'id'),
      question,
      choices: questionChoices(record.choices ?? record.options),
      write_label: payloadValue(record, 'write_label', 'writeLabel', 'input_label'),
    };
  }).filter((question): question is FlowerActivityQuestionItem => question !== null);
  if (questions.length > 0) return questions;
  const question = payloadValue(payload, 'question', 'prompt', 'summary');
  return question ? [{
    id: '',
    question,
    choices: questionChoices(payload.choices ?? payload.options),
    write_label: payloadValue(payload, 'write_label', 'writeLabel', 'input_label'),
  }] : [];
}

function presentationForQuestion(item: FlowerActivityItem): FlowerActivityPresentation {
  const payload = item.payload ?? {};
  const title = titleForGenericItem(item, 'question');
  const errorBlock = errorDetailBlockForItem(item, payload);
  const detailLines = errorBlock ? resultStatusLines(item, payload).filter((line) => line.label !== 'summary' && line.label !== 'details') : resultStatusLines(item, payload);
  const question: FlowerActivityQuestionDetail = {
    reason: payloadValue(payload, 'reason_code', 'reason'),
    required: compactTextArray(payload.required_from_user),
    questions: questionItems(payload),
    contains_secret: boolValue(payload.contains_secret),
  };
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  if (errorBlock) detailBlocks.push(errorBlock);
  detailBlocks.push({ kind: 'question', question });
  if (detailLines.length > 0) detailBlocks.push({ kind: 'structured', lines: detailLines });
  return {
    label: titleText(title),
    title,
    meta: metaForItem(item),
    detailLines,
    detailBlocks,
  };
}

function presentationForCompletion(item: FlowerActivityItem): FlowerActivityPresentation {
  const payload = item.payload ?? {};
  const title = titleForGenericItem(item, 'completion');
  const errorBlock = errorDetailBlockForItem(item, payload);
  const detailLines = errorBlock ? resultStatusLines(item, payload).filter((line) => line.label !== 'summary' && line.label !== 'details') : resultStatusLines(item, payload);
  const completion: FlowerActivityCompletionDetail = {
    result: payloadValue(payload, 'result'),
    summary: payloadValue(payload, 'summary'),
    details: payloadValue(payload, 'details'),
    evidence_refs: compactTextArray(payload.evidence_refs),
    remaining_risks: compactTextArray(payload.remaining_risks),
    next_actions: compactTextArray(payload.next_actions),
  };
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  if (errorBlock) detailBlocks.push(errorBlock);
  detailBlocks.push({ kind: 'completion', completion });
  if (detailLines.length > 0) detailBlocks.push({ kind: 'structured', lines: detailLines });
  return {
    label: titleText(title),
    title,
    meta: metaForItem(item),
    detailLines,
    detailBlocks,
  };
}

function titleWithToolContext(toolName: string, explicit: string, fallback: string): string {
  const meaningful = explicit && explicit !== toolName && explicit !== 'Tool approval' ? explicit : '';
  const label = meaningful || fallback;
  switch (toolName) {
    case 'okf.search': return meaningful ? `OKF search "${meaningful}"` : 'OKF search';
    case 'okf.open': return meaningful ? `OKF concept "${meaningful}"` : 'OKF concept';
    case 'okf.index': return meaningful ? `OKF index · ${meaningful}` : 'OKF index';
    case 'rgrep': return meaningful ? `rgrep "${meaningful}"` : 'rgrep';
    case 'find': return meaningful ? `find ${meaningful}` : 'find';
    case 'web.search': return meaningful ? `Web search "${meaningful}"` : 'Web search';
    case 'web_fetch': return meaningful ? `Web fetch ${meaningful}` : 'Web fetch';
    case 'use_skill': return meaningful ? `Skill ${meaningful}` : 'Skill';
    default: return label;
  }
}

function titleForGenericItem(item: FlowerActivityItem, renderer: FlowerActivityRenderer): FlowerActivityTitle {
  const explicit = trimString(item.label);
  const toolName = trimString(item.tool_name);
  const meaningful = (text: string) => text && text !== 'Tool approval' ? text : '';
  const meaningfulTerminalTitle = (text: string) => text && text !== toolName && text !== 'Tool approval' ? text : '';
  switch (renderer) {
    case 'terminal': {
      const command = payloadValue(item.payload, 'command') || meaningfulTerminalTitle(explicit) || defaultLabelForItem(item);
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

export function presentFlowerActivityItem(item: FlowerActivityItem, fileActions?: FlowerActivityFileActions, copy?: FlowerActivityPresentationCopy, sidecars?: FlowerActivityPresentationSidecars): FlowerActivityPresentation {
  const renderer = rendererForItem(item);
  if (isSubagentsActivityItem(item, sidecars?.subagentAction)) return presentationForSubagents(item, copy, sidecars?.subagentAction);
  if (renderer === 'file') return presentationForFile(item, fileActions);
  if (renderer === 'patch') return presentationForPatch(item, fileActions);
  if (renderer === 'todos') return presentationForTodos(item);
  if (renderer === 'terminal') return presentationForTerminal(item);
  if (renderer === 'web_search') return presentationForWebSearch(item);
  if (renderer === 'question') return presentationForQuestion(item);
  if (renderer === 'completion') return presentationForCompletion(item);
  const title = titleForGenericItem(item, renderer);
  const errorBlock = errorDetailBlockForItem(item, item.payload);
  const detailLines = genericDetailLinesForItem(item, 'structured');
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  if (errorBlock) detailBlocks.push(errorBlock);
  if (detailLines.length > 0) detailBlocks.push({ kind: 'structured', lines: detailLines });
  return {
    label: titleText(title),
    title,
    meta: metaForItem(item),
    detailLines,
    detailBlocks,
  };
}
