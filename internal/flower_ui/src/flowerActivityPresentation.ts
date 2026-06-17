import type {
  FlowerActivityFileAction as FlowerActivityFileActionRecord,
  FlowerActivityItem,
  FlowerActivityRenderer,
} from './contracts/flowerSurfaceContracts';
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

const DETAIL_LABELS: Readonly<Record<string, string>> = {
  command: 'command',
  operation: 'operation',
  name: 'name',
  action: 'action',
  content: 'content',
  activation_id: 'activation',
  already_active: 'already active',
  mode_hints: 'mode hints',
  dependencies: 'dependencies',
  dependency_degraded: 'dependency degraded',
  reason: 'reason',
  id: 'id',
  message: 'message',
  agents: 'agents',
  created: 'created',
  waiting: 'waiting',
  terminated: 'terminated',
  terminated_all: 'terminated all',
  targets: 'targets',
  validation: 'validation',
  stats: 'stats',
  spec: 'spec',
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
  reason_code: 'reason',
  required_from_user: 'required',
  questions: 'questions',
  contains_secret: 'secret',
  result: 'result',
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
  structured: ['operation', 'name', 'action', 'content', 'content_ref', 'activation_id', 'already_active', 'mode_hints', 'dependencies', 'dependency_degraded', 'reason', 'id', 'status', 'message', 'agents', 'created', 'waiting', 'terminated', 'terminated_all', 'timed_out', 'targets', 'validation', 'stats', 'spec', 'output', 'structured', 'key_files', 'rows', 'cards', 'items', 'query', 'count', 'provider', 'data', 'result', 'limit', 'evidence_refs', 'remaining_risks', 'next_actions', 'truncated', 'summary', 'details', 'error_code', 'error_message', 'error_retryable'],
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

function boolValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
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
  const toolName = trimString(item.tool_name);
  const kind = trimString(item.kind);
  return toolName || kind || 'Activity';
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
    trimString(item.tool_name),
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

function detailLineTone(key: string): FlowerActivityDetailLine['tone'] {
  return key === 'command' || key === 'stdout' || key === 'stderr' ? 'code' : undefined;
}

function errorDetailLineFromPayload(payload: Readonly<Record<string, unknown>>, key: string): FlowerActivityDetailLine | null {
  if (key === 'error_code' || key === 'error_message' || key === 'error_retryable') {
    const error = asRecord(payload.error);
    const nestedKey = key === 'error_code' ? 'code' : key === 'error_message' ? 'message' : 'retryable';
    const value = compactJSON(error[nestedKey]);
    if (!value) return null;
    return {
      label: DETAIL_LABELS[key] ?? key,
      value,
    };
  }
  return null;
}

function errorDetailLinesFromPayload(payload: Readonly<Record<string, unknown>> | undefined): readonly FlowerActivityDetailLine[] {
  if (!payload) return [];
  return (['error_code', 'error_message', 'error_retryable'] as const)
    .map((key) => errorDetailLineFromPayload(payload, key))
    .filter((line): line is FlowerActivityDetailLine => line !== null);
}

function detailLineFromPayload(payload: Readonly<Record<string, unknown>>, key: string): FlowerActivityDetailLine | null {
  const errorLine = errorDetailLineFromPayload(payload, key);
  if (errorLine) return errorLine;
  if (!(key in payload)) return null;
  const value = compactJSON(payload[key]);
  if (!value) return null;
  return {
    label: DETAIL_LABELS[key] ?? key,
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
  return { kind: 'file', verb: 'Edit', display_name: trimString(item.label) || 'files' };
}

function presentationForFile(item: FlowerActivityItem, fileActions?: FlowerActivityFileActions): FlowerActivityPresentation {
  const payload = item.payload ?? {};
  const operation = operationFromPayload(payload) || (trimString(item.tool_name) === 'file.read' ? 'read' : 'edit');
  const verb = fileVerbForOperation(operation);
  const action = actionFromPayload(payload, verb, trimString(item.label), fileActions);
  const displayName = action.display_name || trimString(item.label) || defaultLabelForItem(item);
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

function titleForGenericItem(item: FlowerActivityItem, renderer: FlowerActivityRenderer): FlowerActivityTitle {
  const explicit = trimString(item.label);
  switch (renderer) {
    case 'terminal': {
      const command = payloadValue(item.payload, 'command') || explicit || defaultLabelForItem(item);
      return { kind: 'command', command };
    }
    case 'web_search':
      return { kind: 'plain', text: explicit || payloadValue(item.payload, 'query') || defaultLabelForItem(item) };
    case 'question':
      return { kind: 'plain', text: explicit || trimString(item.description) || payloadValue(item.payload, 'question', 'summary') || defaultLabelForItem(item) };
    case 'completion':
      return { kind: 'plain', text: explicit || payloadValue(item.payload, 'result') || defaultLabelForItem(item) };
    default:
      return { kind: 'plain', text: explicit || defaultLabelForItem(item) };
  }
}

export function presentFlowerActivityItem(item: FlowerActivityItem, fileActions?: FlowerActivityFileActions): FlowerActivityPresentation {
  const renderer = rendererForItem(item);
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
