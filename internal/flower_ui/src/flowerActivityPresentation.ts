import type {
  FlowerApprovalAction,
  FlowerActivityFileAction as FlowerActivityFileActionRecord,
  FlowerActivityItem,
  FlowerActivityRenderer,
  FlowerSubagentSummary,
} from './contracts/flowerSurfaceContracts';
import type { FlowerSubagentsCopy, FlowerWebSearchCopy } from './copy';
import { DEFAULT_FLOWER_SURFACE_COPY } from './copy';
import { trimString } from './flowerSurfaceModel';

export type FlowerActivityDetailLine = Readonly<{
  label: string;
  value: string;
  tone?: 'code' | 'muted';
}>;

export type FlowerActivityStructuredRow = Readonly<{
  title: string;
  meta: string;
  content: string;
  format: 'text' | 'markdown' | 'code';
}>;

export type FlowerActivityTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type FlowerActivityTodoItem = Readonly<{
  content: string;
  status: FlowerActivityTodoStatus;
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
  }>
  | Readonly<{
    kind: 'web_fetch';
    url: string;
  }>;

export type FlowerActivityFileAction = Readonly<{
  action_id: string;
  display_name: string;
  can_preview: boolean;
  can_browse_directory: boolean;
}>;

export type FlowerActivityFileActions = Readonly<Record<string, FlowerActivityFileActionRecord>>;

/**
 * Approval queue items are authoritative for the command while a tool waits.
 * The activity projection can legitimately arrive first with only its tool id.
 */
export function pendingApprovalCommandForActivityItem(
  item: FlowerActivityItem,
  actions: readonly FlowerApprovalAction[],
): string {
  if (item.status !== 'waiting' || item.requires_approval !== true || item.approval_state !== 'requested') return '';
  const action = actions.find((candidate) => (
    candidate.status === 'pending'
    && candidate.state === 'requested'
    && candidate.tool_id === item.tool_id
  ));
  return trimString(action?.summary.command);
}

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
  operation: string;
  command: string;
  output: string;
  status: FlowerActivityItem['status'];
  process_id: string;
  exit_code?: number;
  first_seq: number;
  last_seq: number;
  has_more: boolean;
  truncated: boolean;
  timed_out: boolean;
  terminated: boolean;
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

export type FlowerWebOperationDetail = Readonly<{
  query: string;
  url: string;
  pattern: string;
  results: readonly FlowerActivityWebSearchEntry[];
  notice: string;
}>;

export type FlowerActivityWebFetchDetail = Readonly<{
  url: string;
  final_url: string;
  status_code?: number;
  content_type: string;
  format: string;
  content_preview: string;
  preview_truncated: boolean;
  bytes_read?: number;
  truncated: boolean;
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
  answers: readonly FlowerActivityQuestionAnswer[];
  contains_secret: boolean;
}>;

export type FlowerActivityQuestionAnswer = Readonly<{
  question_id: string;
  values: readonly string[];
  redacted: boolean;
}>;

export type FlowerActivityErrorDetail = Readonly<{
  message: string;
  code?: string;
  target_kind?: string;
  target_state?: string;
  repair_action?: string;
  suggested_targets?: readonly string[];
}>;

export type FlowerActivitySubagentMessageAction = Readonly<{
  thread_id: string;
}>;

export type FlowerActivitySubagentDetailItem = Readonly<{
  name: string;
  description: string;
  agent_type: string;
  raw_status: string;
  status: string;
  show_status: boolean;
  started_at_ms?: number;
  created_at_ms?: number;
  updated_at_ms?: number;
  open_messages?: FlowerActivitySubagentMessageAction;
}>;

export type FlowerActivitySubagentsDetail = Readonly<{
  action: string;
  status: string;
  task_preview: string;
  elapsed_mode: 'none' | 'running' | 'final';
  items: readonly FlowerActivitySubagentDetailItem[];
}>;

export type FlowerActivityDetailBlock =
  | Readonly<{
    kind: 'structured';
    lines: readonly FlowerActivityDetailLine[];
  }>
  | Readonly<{
    kind: 'structured_rows';
    rows: readonly FlowerActivityStructuredRow[];
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
    kind: 'web_operation';
    search: FlowerWebOperationDetail;
  }>
  | Readonly<{
    kind: 'web_fetch';
    fetch: FlowerActivityWebFetchDetail;
  }>
  | Readonly<{
    kind: 'question';
    question: FlowerActivityQuestionDetail;
  }>
  | Readonly<{
    kind: 'todos';
    items: readonly FlowerActivityTodoItem[];
  }>
  | Readonly<{
    kind: 'computer';
    target: string;
    action: string;
    location: string;
    frame?: string;
    safety?: string;
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
  changeStats?: Readonly<{
    additions: number;
    deletions: number;
  }>;
  primaryAction?: FlowerActivityFileAction;
  detailLines: readonly FlowerActivityDetailLine[];
  detailBlocks: readonly FlowerActivityDetailBlock[];
}>;

type FlowerActivityPresentationCopy = Readonly<{
  webSearch?: FlowerWebSearchCopy;
  statuses?: Readonly<Record<FlowerActivityItem['status'], string>>;
  subagents?: FlowerSubagentsCopy;
  subagentSummaries?: readonly FlowerSubagentSummary[];
  terminal?: Readonly<{
    runCommand: string;
    readCommandOutput: string;
    writeCommandInput: string;
    terminateCommand: string;
  }>;
}>;

const DEFAULT_TERMINAL_ACTIVITY_COPY = {
  runCommand: 'Run command',
  readCommandOutput: 'View command output',
  writeCommandInput: 'Send input to command',
  terminateCommand: 'Terminate command execution',
} as const;

const DETAIL_LABELS: Readonly<Record<string, string>> = {
  truncated: 'truncated',
  summary: 'summary',
};

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
  const source = asArray(payload.items);
  return source.map((entry) => {
    const record = asRecord(entry);
    const content = payloadValue(record, 'text');
    if (!content) return null;
    return {
      content,
      status: normalizeTodoStatus(record.status),
    };
  }).filter((todo): todo is FlowerActivityTodoItem => todo !== null);
}

function rendererForItem(item: FlowerActivityItem): FlowerActivityRenderer {
  if (trimString(item.tool_name).startsWith('terminal.')) return 'terminal';
  return item.renderer ?? 'structured';
}

function isApprovalLifecycleText(value: string): boolean {
  const normalized = trimString(value).toLowerCase().replace(/[_:-]+/g, ' ').replace(/\s+/g, ' ');
  return /^(?:tool )?approval(?: (?:requested|approved|rejected|timed out|canceled))?$/.test(normalized)
    || /^(?:requested|approved|rejected|timed out|canceled)$/.test(normalized);
}

function defaultLabelForItem(item: FlowerActivityItem): string {
  const label = trimString(item.label);
  const toolName = trimString(item.tool_name);
  if (label && label !== toolName && !isApprovalLifecycleText(label)) return label;
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

const FILE_TITLE_CHIP_KINDS = new Set(['operation', 'display_name', 'change_type']);

function actionFromPayload(
  payload: Readonly<Record<string, unknown>> | undefined,
  verb: 'Read' | 'Edit' | 'Delete',
  label: string,
  fileActions?: FlowerActivityFileActions,
  actionID = '',
): FlowerActivityFileAction {
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
    case 'web_fetch':
      return title.url ? `Web fetch · ${title.url}` : 'Web fetch';
  }
}

function chipText(item: FlowerActivityItem, hiddenKinds?: ReadonlySet<string>): readonly string[] {
  return (item.chips ?? []).map((chip) => {
    if (hiddenKinds?.has(trimString(chip.kind))) return '';
    const label = trimString(chip.label);
    const value = trimString(chip.value);
    return value ? `${label} ${value}` : label;
  }).filter(Boolean);
}

function metaForItem(item: FlowerActivityItem, hiddenChipKinds?: ReadonlySet<string>): string {
  const desc = trimString(item.description);
  const parts = [
    ...(isApprovalLifecycleText(desc) ? [] : [desc]),
    ...chipText(item, hiddenChipKinds),
  ].filter(Boolean);
  return Array.from(new Set(parts)).join(' · ');
}

function metaWithError(item: FlowerActivityItem, base: string): string {
  const error = item.status === 'error' && item.approval_state !== 'rejected' ? errorMessageFromPayload(item.payload) : '';
  return Array.from(new Set([base, error].filter(Boolean))).join(' · ');
}

function diffStats(files: readonly FlowerActivityDiffFile[]): FlowerActivityPresentation['changeStats'] {
  if (files.length === 0) return undefined;
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  return { additions, deletions };
}

function metaForTerminalItem(item: FlowerActivityItem): string {
  const error = errorMessageFromPayload(item.payload);
  const executionFacts = (item.chips ?? [])
    .filter((chip) => chip.kind === 'target' || chip.kind === 'execution_location')
    .map((chip) => trimString(chip.value));
  return [...executionFacts, trimString(typeof item.payload?.execution_location === 'string' ? item.payload.execution_location : ''), item.status === 'error' && item.approval_state !== 'rejected' ? error : '']
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(' · ');
}

function detailLabel(key: string): string {
  return DETAIL_LABELS[key] ?? key;
}

function errorMessageFromPayload(payload: Readonly<Record<string, unknown>> | undefined): string {
  if (!payload) return '';
  const error = asRecord(payload.error);
  const nestedMessage = payloadValue(error, 'message');
  if (nestedMessage) return nestedMessage;
  const scalarError = scalarText(payload.error);
  if (scalarError) return scalarError;
  return payloadValue(payload, 'message', 'reason');
}

function errorDetailBlockForItem(item: FlowerActivityItem, payload: Readonly<Record<string, unknown>> | undefined): Extract<FlowerActivityDetailBlock, { kind: 'error' }> | null {
  if (item.approval_state === 'rejected') return null;
  const message = errorMessageFromPayload(payload);
  if (!message) return null;
  const error = asRecord(payload?.error);
  const meta = asRecord(error?.meta);
  const validationDetails = asRecord(meta?.validation_details);
  const suggestedTargets = asArray(validationDetails?.suggested_targets ?? meta?.suggested_targets)
    .map((value) => trimString(String(value)))
    .filter(Boolean);
  const code = trimString(String(error?.code ?? ''));
  const targetKind = trimString(String(validationDetails?.target_kind ?? meta?.target_kind ?? ''));
  const targetState = trimString(String(validationDetails?.target_state ?? meta?.target_state ?? ''));
  const repairAction = trimString(String(validationDetails?.repair_action ?? meta?.repair_action ?? ''));
  const detail: {
    message: string;
    code?: string;
    target_kind?: string;
    target_state?: string;
    repair_action?: string;
    suggested_targets?: readonly string[];
  } = { message };
  if (targetKind) detail.target_kind = targetKind;
  if (targetState) detail.target_state = targetState;
  if (repairAction) detail.repair_action = repairAction;
  if (suggestedTargets.length > 0) detail.suggested_targets = suggestedTargets;
  // Keep legacy error projections stable; expose the machine code alongside
  // the new target recovery metadata where it is actionable to the user.
  if (code && (targetKind || targetState || repairAction || suggestedTargets.length > 0)) detail.code = code;
  return {
    kind: 'error',
    error: detail,
  };
}

function isNonInformativeSuccessText(value: string): boolean {
  const normalized = trimString(value).toLowerCase().replace(/\s+/g, ' ');
  if (isApprovalLifecycleText(normalized)) return true;
  if (normalized === 'tool execution completed'
    || normalized === 'tool completed'
    || normalized === 'execution completed'
    || normalized === 'tool execution failed'
    || normalized === 'tool failed'
    || normalized === 'completed'
    || normalized === 'success'
    || normalized === 'ok'
    || normalized === 'done'
    || normalized === 'tool.error'
    || normalized === 'tool.timeout'
    || normalized === 'tool.aborted'
    || normalized === 'permission_denied') return true;
  return /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(normalized);
}

function shouldHideDetailLine(key: string, value: string): boolean {
  if (!isNonInformativeSuccessText(value)) return false;
  return key === 'status' || key === 'summary' || key === 'details' || key === 'message';
}

function detailLineFromPayload(payload: Readonly<Record<string, unknown>>, key: string): FlowerActivityDetailLine | null {
  if (!(key in payload)) return null;
  const value = compactJSON(payload[key]);
  if (!value) return null;
  if (shouldHideDetailLine(key, value)) return null;
  return {
    label: detailLabel(key),
    value,
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

function structuredRowsFromPayload(payload: Readonly<Record<string, unknown>> | undefined): readonly FlowerActivityStructuredRow[] {
  return asArray(payload?.rows).flatMap((value) => {
    const record = asRecord(value);
    const title = typeof record.title === 'string' ? trimString(record.title) : '';
    const meta = typeof record.meta === 'string' ? trimString(record.meta) : '';
    const content = typeof record.content === 'string' ? trimString(record.content) : '';
    const format = typeof record.format === 'string' ? trimString(record.format) : 'text';
    if ((!title && !meta && !content) || (format !== 'text' && format !== 'markdown' && format !== 'code')) return [];
    return [{ title, meta, content, format }];
  });
}

function meaningfulStructuredSummary(item: FlowerActivityItem, title: FlowerActivityTitle): readonly FlowerActivityDetailLine[] {
  const summary = payloadValue(item.payload, 'summary');
  if (!summary || shouldHideDetailLine('summary', summary)) return [];
  const normalizedSummary = trimString(summary).toLowerCase();
  const repeatedValues = [titleText(title), item.label, item.description]
    .map((value) => trimString(value).toLowerCase())
    .filter(Boolean);
  if (repeatedValues.includes(normalizedSummary)) return [];
  return [{ label: detailLabel('summary'), value: summary }];
}

function subagentsCopy(copy?: FlowerActivityPresentationCopy): FlowerSubagentsCopy {
  return copy?.subagents ?? DEFAULT_FLOWER_SURFACE_COPY.subagents!;
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

function subagentItemRecords(payload: Readonly<Record<string, unknown>> | undefined): readonly Readonly<Record<string, unknown>>[] {
  return asArray(payload?.targets)
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

function subagentThreadID(record: Readonly<Record<string, unknown>>): string {
  return payloadValue(record, 'thread_id');
}

function subagentNameFromRecord(record: Readonly<Record<string, unknown>>): string {
  const threadID = subagentThreadID(record);
  const task = payloadValue(record, 'task_name');
  return task && task !== threadID ? task : '';
}

function subagentDescriptionFromRecord(record: Readonly<Record<string, unknown>>, fallback: Readonly<Record<string, unknown>>): string {
  return payloadValue(record, 'task_description') || payloadValue(fallback, 'task_description');
}

function shouldShowSubagentStatus(status: string): boolean {
  switch (normalizedSubagentStatus(status)) {
    case 'failed':
    case 'canceled':
    case 'timed_out':
    case 'waiting_input':
      return true;
    default:
      return false;
  }
}

function subagentActionItems(item: FlowerActivityItem, payload: Readonly<Record<string, unknown>>): readonly Readonly<Record<string, unknown>>[] {
  const nested = subagentItemRecords(payload);
  if (nested.length > 0) return nested;
  return item.renderer === 'subagent' ? [payload] : [];
}

function subagentDetailItemFromRecord(
  record: Readonly<Record<string, unknown>>,
  item: FlowerActivityItem,
  payload: Readonly<Record<string, unknown>>,
  copy?: FlowerActivityPresentationCopy,
): FlowerActivitySubagentDetailItem | null {
  const rawStatus = payloadValue(record, 'status') || payloadValue(payload, 'status') || subagentStatusFromItemStatus(item.status);
  const normalizedStatus = normalizedSubagentStatus(rawStatus);
  const status = subagentDisplayStatus(rawStatus, copy);
  const threadID = subagentThreadID(record) || subagentThreadID(payload);
  const name = subagentNameFromRecord(record) || (threadID ? subagentsCopy(copy).activity.labels.subagent : '');
  const description = subagentDescriptionFromRecord(record, payload);
  const agentType = item.renderer === 'subagent'
    ? payloadValue(record, 'agent_type', 'host_profile_ref') || payloadValue(payload, 'agent_type', 'host_profile_ref')
    : '';
  if (!name) return null;
  return {
    name,
    description,
    agent_type: agentType,
    raw_status: normalizedStatus,
    status,
    show_status: item.renderer === 'subagent_operation' ? Boolean(status) : shouldShowSubagentStatus(rawStatus),
    ...(optionalNumericValue(record.started_at_ms) ? { started_at_ms: optionalNumericValue(record.started_at_ms) } : {}),
    ...(optionalNumericValue(record.created_at_ms) ? { created_at_ms: optionalNumericValue(record.created_at_ms) } : {}),
    ...(optionalNumericValue(record.updated_at_ms) ? { updated_at_ms: optionalNumericValue(record.updated_at_ms) } : {}),
    ...(threadID ? {
      open_messages: {
        thread_id: threadID,
      },
    } : {}),
  };
}

function subagentSummaryRecord(summary: FlowerSubagentSummary): Readonly<Record<string, unknown>> {
  return {
    thread_id: summary.thread_id,
    task_name: summary.task_name,
    task_description: summary.task_description,
    agent_type: summary.agent_type,
    status: summary.status,
    created_at_ms: summary.created_at_ms,
    updated_at_ms: summary.updated_at_ms,
  };
}

function uniqueSubagentDetailItems(items: readonly FlowerActivitySubagentDetailItem[]): readonly FlowerActivitySubagentDetailItem[] {
  const seen = new Set<string>();
  const out: FlowerActivitySubagentDetailItem[] = [];
  for (const item of items) {
    const key = [item.open_messages?.thread_id, item.name, item.description].join('\x1e');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function subagentsDetailItemsFromPayload(
  item: FlowerActivityItem,
  payload: Readonly<Record<string, unknown>>,
  copy?: FlowerActivityPresentationCopy,
): readonly FlowerActivitySubagentDetailItem[] {
  const summariesByThreadID = new Map(
    (copy?.subagentSummaries ?? []).map((summary) => [trimString(summary.thread_id), summary] as const),
  );
  const payloadItems = uniqueSubagentDetailItems(
    subagentActionItems(item, payload)
      .map((record) => {
        const summary = summariesByThreadID.get(subagentThreadID(record));
        const resolved = summary ? { ...subagentSummaryRecord(summary), ...record } : record;
        return subagentDetailItemFromRecord(resolved, item, payload, copy);
      })
      .filter((entry): entry is FlowerActivitySubagentDetailItem => entry !== null),
  );
  return payloadItems;
}

function subagentNeedsAttention(items: readonly FlowerActivitySubagentDetailItem[]): boolean {
  return items.some((entry) => entry.show_status);
}

function subagentPayloadCount(payload: Readonly<Record<string, unknown>>, key: string): number {
  const value = optionalNumericValue(payload[key]);
  return value === undefined ? 0 : Math.max(0, Math.trunc(value));
}

function subagentActionTitle(
  action: string,
  items: readonly FlowerActivitySubagentDetailItem[],
  item: FlowerActivityItem,
  payload: Readonly<Record<string, unknown>>,
  copy?: FlowerActivityPresentationCopy,
): string {
  const activityCopy = subagentsCopy(copy).activity;
  const normalizedAction = trimString(action);
  const requestedCount = Math.max(subagentPayloadCount(payload, 'requested_count'), items.length);
  const completedCount = Math.max(
    subagentPayloadCount(payload, 'completed_count'),
    items.filter((entry) => entry.raw_status === 'completed').length,
  );
  const missingCount = subagentPayloadCount(payload, 'missing_count');
  const countText = String(requestedCount || items.length);
  const isActive = item.status === 'pending' || item.status === 'running' || item.status === 'waiting';
  const timedOut = boolValue(payload.timed_out) || items.some((entry) => entry.raw_status === 'timed_out');
  const actionTitle = activityCopy.actions[normalizedAction as keyof typeof activityCopy.actions];
  const statusTitle = (status: string, fallback: string): string => (
    actionTitle && normalizedAction !== 'unknown' ? `${actionTitle} · ${status}` : fallback
  );
  const singleName = items.length === 1 ? trimString(items[0]?.name) : '';
  const withSingleName = (title: string): string => singleName ? `${title} · ${singleName}` : title;
  if (normalizedAction === 'spawn') {
    if (item.status === 'error') return withSingleName(activityCopy.titles.createFailed);
    return withSingleName(item.status === 'success' ? activityCopy.titles.started : activityCopy.titles.starting);
  }
  if (item.status === 'error') return statusTitle(subagentsCopy(copy).statusLabels.failed, activityCopy.titles.failed);
  if (items.some((entry) => entry.raw_status === 'waiting_input')) {
    return statusTitle(subagentsCopy(copy).statusLabels.waiting_input, activityCopy.titles.needsInput);
  }
  if (normalizedAction === 'wait') {
    if (requestedCount === 0) return timedOut ? activityCopy.titles.timedOut : activityCopy.actions.wait;
    if (timedOut) return activityCopy.titles.waitTimedOut(String(completedCount), countText);
    if (isActive) return activityCopy.titles.waiting(countText);
    if (requestedCount > 0 && completedCount === requestedCount && missingCount === 0) {
      return activityCopy.titles.completed(countText);
    }
    return activityCopy.titles.waitTimedOut(String(completedCount), countText);
  }
  if (timedOut) return statusTitle(subagentsCopy(copy).statusLabels.timed_out, activityCopy.titles.timedOut);
  if (!actionTitle || normalizedAction === 'unknown') return activityCopy.titles.operation;
  return `${actionTitle} · ${isActive ? subagentsCopy(copy).statusLabels.running : subagentsCopy(copy).statusLabels.completed}`;
}

function subagentTaskPreview(items: readonly FlowerActivitySubagentDetailItem[], copy?: FlowerActivityPresentationCopy): string {
  if (items.length === 0) return '';
  if (items.length > 1) return subagentsCopy(copy).activity.agentsCount(String(items.length));
  const item = items[0];
  return item.description;
}

function subagentMetaText(items: readonly FlowerActivitySubagentDetailItem[]): string {
  if (items.length === 0) return '';
  if (items.length > 1) {
    const names = items.map((item) => item.name).filter(Boolean);
    return [...names.slice(0, 2), ...(names.length > 2 ? [`+${names.length - 2}`] : [])].join(' · ');
  }
  const item = items[0];
  return [item.name, item.description].filter(Boolean).join(' · ');
}

function subagentsElapsedMode(action: string, items: readonly FlowerActivitySubagentDetailItem[]): FlowerActivitySubagentsDetail['elapsed_mode'] {
  const hasTiming = items.some((entry) => entry.started_at_ms || entry.created_at_ms);
  if (!hasTiming) return 'none';
  if (trimString(action) === 'wait' || items.some((entry) => entry.raw_status === 'running' || entry.raw_status === 'queued')) {
    return 'running';
  }
  return 'final';
}

function subagentsDetailFromPayload(item: FlowerActivityItem, payload: Readonly<Record<string, unknown>>, copy?: FlowerActivityPresentationCopy): FlowerActivitySubagentsDetail {
  const action = payloadValue(payload, 'action');
  const items = subagentsDetailItemsFromPayload(item, payload, copy);
  const firstStatus = items.find((entry) => entry.show_status)?.status ?? '';
  return {
    action,
    status: subagentNeedsAttention(items) ? firstStatus : '',
    task_preview: subagentTaskPreview(items, copy),
    elapsed_mode: subagentsElapsedMode(action, items),
    items,
  };
}

function presentationForSubagents(item: FlowerActivityItem, copy?: FlowerActivityPresentationCopy): FlowerActivityPresentation {
  const payload = item.payload ?? {};
  const detail = subagentsDetailFromPayload(item, payload, copy);
  const titleText = item.renderer === 'subagent'
    ? subagentsCopy(copy).typeLabels.unknown
    : subagentActionTitle(detail.action, detail.items, item, payload, copy);
  const title: FlowerActivityTitle = { kind: 'plain', text: titleText };
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  const errorBlock = errorDetailBlockForItem(item, payload);
  if (errorBlock) detailBlocks.push(errorBlock);
  if (detail.items.length > 0 || detail.task_preview || detail.status) {
    detailBlocks.push({ kind: 'subagents', subagents: detail });
  }
  return {
    label: title.text,
    title,
    meta: detail.action === 'spawn' && detail.items.length === 1
      ? detail.items[0]?.description ?? ''
      : subagentMetaText(detail.items),
    detailLines: [],
    detailBlocks,
  };
}

function fileStatusLines(payload: Readonly<Record<string, unknown>> | undefined): readonly FlowerActivityDetailLine[] {
  const lines: FlowerActivityDetailLine[] = [];
  if (payload && boolValue(payload.truncated)) {
    const line = detailLineFromPayload(payload, 'truncated');
    if (line) lines.push(line);
  }
  return uniqueDetailLines(lines);
}

function resultStatusLines(payload: Readonly<Record<string, unknown>> | undefined): readonly FlowerActivityDetailLine[] {
  const lines: FlowerActivityDetailLine[] = [];
  if (payload && boolValue(payload.truncated)) {
    const line = detailLineFromPayload(payload, 'truncated');
    if (line) lines.push(line);
  }
  return uniqueDetailLines(lines);
}

function diffFileFromMutation(
  item: FlowerActivityItem,
  mutation: Readonly<Record<string, unknown>>,
  defaultDisplayName: string,
  fileActions?: FlowerActivityFileActions,
  actionID = '',
): FlowerActivityDiffFile | null {
  const hasMutationDetail = ['additions', 'deletions', 'unified_diff', 'diff_unavailable_reason']
    .some((key) => mutation[key] !== undefined);
  if (!hasMutationDetail) return null;
  const changeType = payloadValue(mutation, 'change_type') || operationFromPayload(item.payload) || 'update';
  const verb = fileVerbForOperation(changeType);
  const action = actionFromPayload(mutation, verb, displayNameFromPayload(mutation, defaultDisplayName), fileActions, actionID);
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

function fileActionIDs(item: FlowerActivityItem): readonly string[] {
  return (item.target_refs ?? []).flatMap((target) => {
    const kind = trimString(target.kind);
    return kind.startsWith('file_action:') && kind.length > 'file_action:'.length
      ? [kind.slice('file_action:'.length)]
      : [];
  });
}

function diffFilesFromPayload(item: FlowerActivityItem, fileActions?: FlowerActivityFileActions): readonly FlowerActivityDiffFile[] {
  const payload = item.payload ?? {};
  const defaultDisplayName = payloadValue(payload, 'display_name') || trimString(item.label);
  const mutationSource = asArray(payload.mutations).length > 0 ? asArray(payload.mutations) : [payload];
  const actionIDs = fileActionIDs(item);
  return mutationSource.map((entry, index) => diffFileFromMutation(item, asRecord(entry), defaultDisplayName, fileActions, actionIDs[index]))
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
  const action = actionFromPayload(payload, verb, trimString(item.label), fileActions, fileActionIDs(item)[0]);
  let displayName = action.display_name || trimString(item.label) || defaultLabelForItem(item);
  if (displayName === 'read_files') displayName = 'files';
  if (displayName === 'apply_patch') displayName = 'files';
  const title: FlowerActivityTitle = { kind: 'file', verb, display_name: displayName };
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  let files: readonly FlowerActivityDiffFile[] = [];
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
    files = diffFilesFromPayload(item, fileActions);
    if (files.length > 0) {
      detailBlocks.push({ kind: 'file_diff', files });
    }
  }
  const statusLines = fileStatusLines(payload);
  if (statusLines.length > 0) {
    detailBlocks.push({ kind: 'structured', lines: statusLines });
  }
  const changeStats = verb === 'Read' ? undefined : diffStats(files);
  return {
    label: titleText(title),
    title,
    meta: metaWithError(item, verb === 'Read' ? '' : metaForItem(item, FILE_TITLE_CHIP_KINDS)),
    ...(changeStats ? { changeStats } : {}),
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
  const statusLines = fileStatusLines(payload);
  if (statusLines.length > 0) {
    detailBlocks.push({ kind: 'structured', lines: statusLines });
  }
  const changeStats = diffStats(files);
  return {
    label: titleText(title),
    title,
    meta: metaWithError(item, metaForItem(item, FILE_TITLE_CHIP_KINDS)),
    ...(changeStats ? { changeStats } : {}),
    ...(files.length === 1 ? { primaryAction: files[0].action } : {}),
    detailLines: statusLines,
    detailBlocks,
  };
}

function presentationForTodos(item: FlowerActivityItem): FlowerActivityPresentation {
  const title: FlowerActivityTitle = { kind: 'plain', text: trimString(item.label) || 'Todos' };
  const items = todoItemsFromPayload(item.payload);
  const errorBlock = errorDetailBlockForItem(item, item.payload);
  const statusLines = errorBlock ? [] : resultStatusLines(item.payload);
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
    items.length > 0 ? `${counts.completed}/${items.length} completed` : '',
    counts.in_progress > 0 ? `in progress ${counts.in_progress}` : '',
    counts.pending > 0 ? `pending ${counts.pending}` : '',
    counts.cancelled > 0 ? `cancelled ${counts.cancelled}` : '',
  ]).filter(Boolean).join(' · ');
  return {
    label: title.text,
    title,
    meta: metaWithError(item, meta),
    detailLines: statusLines,
    detailBlocks,
  };
}

function terminalOperationLabel(item: FlowerActivityItem, copy?: FlowerActivityPresentationCopy): string {
  const terminalCopy = copy?.terminal ?? DEFAULT_TERMINAL_ACTIVITY_COPY;
  switch (payloadValue(item.payload, 'operation') || trimString(item.tool_name)) {
    case 'terminal.read':
    case 'read': return terminalCopy.readCommandOutput;
    case 'terminal.write':
    case 'write': return terminalCopy.writeCommandInput;
    case 'terminal.terminate':
    case 'terminate': return terminalCopy.terminateCommand;
    default: return terminalCopy.runCommand;
  }
}

function terminalTitleForItem(item: FlowerActivityItem, copy?: FlowerActivityPresentationCopy): FlowerActivityTitle {
  const operation = terminalOperationLabel(item, copy);
  const label = trimString(item.label);
  const description = trimString(item.description);
  const generic = new Set<string>([...Object.values(DEFAULT_TERMINAL_ACTIVITY_COPY), trimString(item.tool_name), payloadValue(item.payload, 'command')]);
  if (label && !generic.has(label)) return { kind: 'plain', text: label };
  return { kind: 'plain', text: description || operation };
}

function terminalOutputFromPayload(payload: Readonly<Record<string, unknown>>): string {
  return rawPayloadText(payload, 'output');
}

function presentationForTerminal(item: FlowerActivityItem, copy?: FlowerActivityPresentationCopy): FlowerActivityPresentation {
  const payload = item.payload ?? {};
  const title = terminalTitleForItem(item, copy);
  const detailLines: readonly FlowerActivityDetailLine[] = [];
  const terminal: FlowerActivityTerminalDetail = {
    operation: payloadValue(payload, 'operation'),
    command: payloadValue(payload, 'command'),
    output: payloadValue(payload, 'operation') === 'write' ? '' : terminalOutputFromPayload(payload),
    status: item.status,
    process_id: payloadValue(payload, 'process_id'),
    exit_code: optionalNumericValue(payload.exit_code),
    first_seq: optionalNumericValue(payload.first_seq) ?? 0,
    last_seq: optionalNumericValue(payload.last_seq) ?? 0,
    has_more: boolValue(payload.has_more),
    truncated: boolValue(payload.truncated),
    timed_out: boolValue(payload.timed_out),
    terminated: boolValue(payload.terminated),
  };
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  const errorBlock = item.status === 'canceled' || item.approval_state === 'rejected' ? null : errorDetailBlockForItem(item, payload);
  if (errorBlock) detailBlocks.push(errorBlock);
  detailBlocks.push({ kind: 'terminal_output', terminal });
  if (detailLines.length > 0) detailBlocks.push({ kind: 'structured', lines: detailLines });
  return {
    label: titleText(title),
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

function presentationForKnowledgeSearch(item: FlowerActivityItem): FlowerActivityPresentation {
  const payload = item.payload ?? {};
  const title = titleForGenericItem(item, 'web_search');
  const errorBlock = errorDetailBlockForItem(item, payload);
  const detailLines = errorBlock ? resultStatusLines(payload).filter((line) => line.label !== 'summary' && line.label !== 'details') : resultStatusLines(payload);
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
    meta: metaWithError(item, metaForItem(item)),
    detailLines,
    detailBlocks,
  };
}

function presentationForWebSearch(item: FlowerActivityItem, copy?: FlowerActivityPresentationCopy): FlowerActivityPresentation {
  if (item.tool_name?.startsWith('okf.') || item.tool_name === 'sources') return presentationForKnowledgeSearch(item);
  const words = copy?.webSearch ?? DEFAULT_FLOWER_SURFACE_COPY.chat.webSearch;
  const payload = item.payload ?? {};
  const query = payloadValue(payload, 'query');
  const queries = query.split('\n').map((value) => value.trim()).filter(Boolean);
  const url = payloadValue(payload, 'url');
  const pattern = payloadValue(payload, 'pattern');
  const operation = payloadValue(payload, 'operation');
  const safeURL = safeWebFetchURL(url);
  const domain = safeURL ? new URL(safeURL).host : url;
  const results = asArray(payload.results).map((value) => {
    const result = asRecord(value);
    return {title:payloadValue(result, 'title'), url:payloadValue(result, 'url'), snippet:payloadValue(result, 'snippet'), source:''};
  }).filter((result) => result.title || result.url);
  const provided = payload.results_provided === true || results.length > 0;
  const titleParts = operation === 'open_page' ? [words.openPage, domain]
    : operation === 'find_in_page' ? [words.findInPage, pattern ? `“${pattern}”` : '', domain]
      : [operation === 'search' ? words.search : words.webActivity, queries[0]];
  const label = titleParts.filter(Boolean).join(' · ');
  const active = item.status === 'running' || item.status === 'pending' || item.status === 'waiting';
  const failed = item.status === 'error' || item.status === 'canceled' || item.status === 'declined';
  const notice = active || failed || results.length > 0 ? '' : provided ? words.noSources : words.sourcesUnavailable;
  const hasFacts = Boolean(query || url || pattern || results.length);
  const status = (copy?.statuses ?? DEFAULT_FLOWER_SURFACE_COPY.chat.toolStatuses)[item.status];
  const meta = [queries.length > 1 ? words.queries(queries.length) : '', results.length ? words.sources(results.length) : '',
    active || failed || !hasFacts ? status : '', !hasFacts && !active && !failed ? (provided ? words.noSources : words.noDetails) : '',
  ].filter(Boolean).join(' · ');
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  const error = errorDetailBlockForItem(item, payload);
  if (error) detailBlocks.push(error);
  if (hasFacts) detailBlocks.push({kind:'web_operation', search:{query, url, pattern, results, notice}});
  return {label, title:{kind:'plain',text:label},meta,detailLines:[],detailBlocks};
}

export function safeWebFetchURL(value: string): string {
  const raw = trimString(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function webFetchTargetRefURL(item: FlowerActivityItem): string {
  for (const target of item.target_refs ?? []) {
    if (trimString(target.kind).toLowerCase() !== 'url') continue;
    const uri = trimString(target.uri);
    if (safeWebFetchURL(uri)) return uri;
  }
  return '';
}

function presentationForWebFetch(item: FlowerActivityItem): FlowerActivityPresentation {
  const payload = item.payload ?? {};
  const requestedURL = payloadValue(payload, 'url') || webFetchTargetRefURL(item);
  const finalURL = payloadValue(payload, 'final_url');
  const title: FlowerActivityTitle = requestedURL
    ? { kind: 'web_fetch', url: requestedURL }
    : { kind: 'plain', text: 'Web fetch' };
  const errorBlock = errorDetailBlockForItem(item, payload);
  const fetch: FlowerActivityWebFetchDetail = {
    url: requestedURL,
    final_url: finalURL,
    status_code: optionalNumericValue(payload.status_code),
    content_type: payloadValue(payload, 'content_type'),
    format: payloadValue(payload, 'format'),
    content_preview: rawPayloadText(payload, 'content_preview'),
    preview_truncated: boolValue(payload.preview_truncated),
    bytes_read: optionalNumericValue(payload.bytes_read),
    truncated: boolValue(payload.truncated),
  };
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  if (errorBlock) detailBlocks.push(errorBlock);
  if (fetch.url || fetch.final_url || fetch.status_code !== undefined || fetch.content_type || fetch.format
    || fetch.content_preview || fetch.bytes_read !== undefined || fetch.truncated) {
    detailBlocks.push({ kind: 'web_fetch', fetch });
  }
  return {
    label: titleText(title),
    title,
    meta: metaWithError(item, metaForItem(item)),
    detailLines: [],
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

function questionAnswers(payload: Readonly<Record<string, unknown>>): readonly FlowerActivityQuestionAnswer[] {
  return asArray(payload.answers).map((entry) => {
    const record = asRecord(entry);
    const questionID = payloadValue(record, 'question_id', 'id');
    if (!questionID) return null;
    const redacted = boolValue(record.redacted);
    const values = redacted ? [] : compactTextArray(record.values ?? record.value);
    if (!redacted && values.length === 0) return null;
    return { question_id: questionID, values, redacted };
  }).filter((answer): answer is FlowerActivityQuestionAnswer => answer !== null);
}

function presentationForQuestion(item: FlowerActivityItem): FlowerActivityPresentation {
  const payload = item.payload ?? {};
  const title = titleForGenericItem(item, 'question');
  const errorBlock = errorDetailBlockForItem(item, payload);
  const detailLines = errorBlock ? resultStatusLines(payload).filter((line) => line.label !== 'summary' && line.label !== 'details') : resultStatusLines(payload);
  const question: FlowerActivityQuestionDetail = {
    reason: payloadValue(payload, 'reason_code', 'reason'),
    required: compactTextArray(payload.required_from_user),
    questions: questionItems(payload),
    answers: questionAnswers(payload),
    contains_secret: boolValue(payload.contains_secret),
  };
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  if (errorBlock) detailBlocks.push(errorBlock);
  detailBlocks.push({ kind: 'question', question });
  if (detailLines.length > 0) detailBlocks.push({ kind: 'structured', lines: detailLines });
  return {
    label: titleText(title),
    title,
    meta: metaWithError(item, metaForItem(item)),
    detailLines,
    detailBlocks,
  };
}

function titleWithToolContext(toolName: string, explicit: string, fallback: string): string {
  const meaningful = explicit && explicit !== toolName && !isApprovalLifecycleText(explicit) ? explicit : '';
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
    default: {
      if (meaningful) return label;
      if (toolName === 'terminal.exec') return fallback;
      const semantic = toolName.replace(/[._:-]+/g, ' ').trim();
      return semantic ? `Called ${semantic}` : 'Called tool';
    }
  }
}

function titleForGenericItem(item: FlowerActivityItem, renderer: FlowerActivityRenderer): FlowerActivityTitle {
  const explicit = trimString(item.label);
  const toolName = trimString(item.tool_name);
  const meaningful = (text: string) => text && text !== 'Tool approval' ? text : '';
  switch (renderer) {
    case 'web_search':
      return { kind: 'plain', text: titleWithToolContext(toolName, explicit, defaultLabelForItem(item)) };
    case 'question':
      return { kind: 'plain', text: meaningful(explicit) || trimString(item.description) || payloadValue(item.payload, 'question', 'summary') || defaultLabelForItem(item) };
    default:
      return { kind: 'plain', text: titleWithToolContext(toolName, explicit, defaultLabelForItem(item)) };
  }
}

type FlowerActivityRendererContext = Readonly<{
  fileActions?: FlowerActivityFileActions;
  copy?: FlowerActivityPresentationCopy;
}>;

type FlowerActivityRendererHandler = (
  item: FlowerActivityItem,
  context: FlowerActivityRendererContext,
) => FlowerActivityPresentation;

function presentationForStructured(item: FlowerActivityItem): FlowerActivityPresentation {
  const title = titleForGenericItem(item, 'structured');
  const errorBlock = errorDetailBlockForItem(item, item.payload);
  const rows = structuredRowsFromPayload(item.payload);
  const detailLines = rows.length > 0 ? [] : meaningfulStructuredSummary(item, title);
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  if (errorBlock) detailBlocks.push(errorBlock);
  if (rows.length > 0) detailBlocks.push({ kind: 'structured_rows', rows });
  if (detailLines.length > 0) detailBlocks.push({ kind: 'structured', lines: detailLines });
  return {
    label: titleText(title),
    title,
    meta: metaWithError(item, metaForItem(item)),
    detailLines,
    detailBlocks,
  };
}

function presentationForComputer(item: FlowerActivityItem): FlowerActivityPresentation {
  const payload = asRecord(item.payload);
  const target = payloadValue(payload, 'target_name', 'target_id') || trimString(item.tool_name);
  const action = payloadValue(payload, 'action_summary', 'operation') || defaultLabelForItem(item);
  const location = payloadValue(payload, 'execution_location');
  const frame = payloadValue(payload, 'after_frame', 'screenshot');
  const safetyRecord = asRecord(payload.safety);
  const safety = payloadValue(safetyRecord, 'level', 'reason_codes');
  const title: FlowerActivityTitle = { kind: 'plain', text: action };
  return {
    label: action,
    title,
    meta: metaWithError(item, metaForItem(item)),
    detailLines: [],
    detailBlocks: [{ kind: 'computer', target, action, location, ...(frame ? { frame } : {}), ...(safety ? { safety } : {}) }],
  };
}

const FLOWER_ACTIVITY_RENDERERS: Readonly<Record<FlowerActivityRenderer, FlowerActivityRendererHandler>> = {
  structured: (item) => presentationForStructured(item),
  terminal: (item, context) => presentationForTerminal(item, context.copy),
  file: (item, context) => presentationForFile(item, context.fileActions),
  patch: (item, context) => presentationForPatch(item, context.fileActions),
  web_search: (item, context) => presentationForWebSearch(item, context.copy),
  web_fetch: (item) => presentationForWebFetch(item),
  todos: (item) => presentationForTodos(item),
  question: (item) => presentationForQuestion(item),
  subagent: (item, context) => presentationForSubagents(item, context.copy),
  subagent_operation: (item, context) => presentationForSubagents(item, context.copy),
  computer: (item) => presentationForComputer(item),
  browser: (item) => presentationForComputer(item),
};

export function presentFlowerActivityItem(item: FlowerActivityItem, fileActions?: FlowerActivityFileActions, copy?: FlowerActivityPresentationCopy): FlowerActivityPresentation {
  const renderer = rendererForItem(item);
  return FLOWER_ACTIVITY_RENDERERS[renderer](item, { fileActions, copy });
}
