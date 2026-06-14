import type {
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
    path: string;
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
  path: string;
  can_preview: boolean;
  can_browse_directory: boolean;
}>;

export type FlowerActivityDiffHunk = Readonly<{
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  before: readonly string[];
  after: readonly string[];
  before_kinds: readonly FlowerActivityDiffLineKind[];
  after_kinds: readonly FlowerActivityDiffLineKind[];
}>;

export type FlowerActivityDiffLineKind = 'context' | 'removed' | 'added';

export type FlowerActivityDiffFile = Readonly<{
  path: string;
  change_type: string;
  action: FlowerActivityFileAction;
  hunks: readonly FlowerActivityDiffHunk[];
  truncated: boolean;
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
  detailLines: readonly FlowerActivityDetailLine[];
  detailBlocks: readonly FlowerActivityDetailBlock[];
}>;

const DETAIL_LABELS: Readonly<Record<string, string>> = {
  command: 'command',
  cwd: 'cwd',
  workdir: 'workdir',
  timeout_ms: 'timeout',
  timeout_source: 'timeout source',
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
  status: 'status',
  error: 'error',
  content_ref: 'content ref',
};

const RENDERER_DETAIL_KEYS: Readonly<Record<Exclude<FlowerActivityRenderer, 'file' | 'patch' | 'todos'>, readonly string[]>> = {
  terminal: ['command', 'cwd', 'workdir', 'timeout_ms', 'timeout_source', 'exit_code', 'duration_ms', 'timed_out', 'truncated', 'stdout', 'stderr', 'summary', 'details', 'error'],
  web_search: ['query', 'provider', 'count', 'sources', 'results', 'summary', 'details', 'error'],
  question: ['reason_code', 'required_from_user', 'questions', 'contains_secret', 'summary', 'details', 'error'],
  completion: ['result', 'evidence_refs', 'remaining_risks', 'next_actions', 'summary', 'details', 'error'],
  structured: ['summary', 'details', 'status', 'error', 'content_ref'],
};

const FILE_RAW_DETAIL_KEYS = new Set([
  'args',
  'content',
  'file_path',
  'files',
  'line_count',
  'line_offset',
  'mutations',
  'old_path',
  'operation',
  'original_file',
  'path',
  'patch',
  'result',
  'structured_diff',
  'total_lines',
  'updated_file',
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

function pathFromRefs(item: FlowerActivityItem): string {
  for (const ref of item.target_refs ?? []) {
    const path = trimString(ref.path) || trimString(ref.label) || trimString(ref.uri);
    if (path) return path;
  }
  return '';
}

function payloadPath(item: FlowerActivityItem, payload: Readonly<Record<string, unknown>> | undefined): string {
  return payloadValue(payload, 'file_path', 'path', 'new_path', 'old_path') || pathFromRefs(item);
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

function fileAction(path: string, verb: 'Read' | 'Edit' | 'Delete'): FlowerActivityFileAction {
  const cleanPath = trimString(path);
  return {
    path: cleanPath,
    can_browse_directory: cleanPath !== '',
    can_preview: cleanPath !== '' && verb !== 'Delete',
  };
}

function titleText(title: FlowerActivityTitle): string {
  switch (title.kind) {
    case 'file':
      return [title.verb, title.path].filter(Boolean).join(' ');
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

function refText(item: FlowerActivityItem): readonly string[] {
  return (item.target_refs ?? []).map((ref) => {
    const label = trimString(ref.label);
    const path = trimString(ref.path);
    const uri = trimString(ref.uri);
    const target = label || path || uri;
    return ref.line ? `${target}:${ref.line}` : target;
  }).filter(Boolean);
}

function metaForItem(item: FlowerActivityItem): string {
  const parts = [
    trimString(item.description),
    ...chipText(item),
    ...refText(item),
    trimString(item.tool_name),
  ].filter(Boolean);
  return Array.from(new Set(parts)).join(' · ');
}

function detailLineTone(key: string): FlowerActivityDetailLine['tone'] {
  return key === 'command' || key === 'stdout' || key === 'stderr' ? 'code' : undefined;
}

function detailLineFromPayload(payload: Readonly<Record<string, unknown>>, key: string): FlowerActivityDetailLine | null {
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
  for (const key of Object.keys(payload).sort()) {
    orderedKeys.add(key);
  }
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
    const fallbackLines = [
      { label: 'status', value: item.status },
      { label: 'kind', value: item.kind },
      { label: 'tool', value: trimString(item.tool_name) },
      { label: 'item', value: trimString(item.item_id) },
    ].filter((line) => trimString(line.value));
    lines.push(...fallbackLines);
  }
  return uniqueDetailLines(lines);
}

function fileStatusLines(item: FlowerActivityItem, payload: Readonly<Record<string, unknown>> | undefined): readonly FlowerActivityDetailLine[] {
  const lines: FlowerActivityDetailLine[] = [];
  if (item.requires_approval) {
    lines.push({ label: 'approval', value: trimString(item.approval_state) || 'requested' });
  }
  for (const key of ['status', 'summary', 'details', 'error', 'truncated']) {
    if (!payload || FILE_RAW_DETAIL_KEYS.has(key)) continue;
    const line = detailLineFromPayload(payload, key);
    if (line) lines.push(line);
  }
  return uniqueDetailLines(lines);
}

function normalizeDiffHunks(value: unknown): readonly FlowerActivityDiffHunk[] {
  return asArray(value).map((entry): FlowerActivityDiffHunk | null => {
    const record = asRecord(entry);
    const before = asArray(record.before).map((line) => String(line ?? ''));
    const after = asArray(record.after).map((line) => String(line ?? ''));
    if (before.length === 0 && after.length === 0) return null;
    return {
      old_start: numericValue(record.old_start) || 1,
      old_lines: numericValue(record.old_lines) || before.length,
      new_start: numericValue(record.new_start) || 1,
      new_lines: numericValue(record.new_lines) || after.length,
      before,
      after,
      before_kinds: normalizeDiffLineKinds(record.before_kinds, before.length, 'removed'),
      after_kinds: normalizeDiffLineKinds(record.after_kinds, after.length, 'added'),
    };
  }).filter((hunk): hunk is FlowerActivityDiffHunk => hunk !== null);
}

function normalizeDiffLineKinds(value: unknown, count: number, fallback: FlowerActivityDiffLineKind): readonly FlowerActivityDiffLineKind[] {
  const source = asArray(value).map((item) => normalizeDiffLineKind(item, fallback));
  if (source.length >= count) return source.slice(0, count);
  return [...source, ...Array.from({ length: count - source.length }, () => fallback)];
}

function normalizeDiffLineKind(value: unknown, fallback: FlowerActivityDiffLineKind): FlowerActivityDiffLineKind {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'context' || normalized === 'removed' || normalized === 'added') return normalized;
  return fallback;
}

function diffFileFromMutation(item: FlowerActivityItem, mutation: Readonly<Record<string, unknown>>, defaultPath: string): FlowerActivityDiffFile | null {
  const changeType = payloadValue(mutation, 'change_type') || operationFromPayload(item.payload) || 'update';
  const path = payloadValue(mutation, 'file_path', 'new_path', 'old_path', 'path') || defaultPath;
  const verb = fileVerbForOperation(changeType);
  const hunks = normalizeDiffHunks(mutation.structured_diff);
  return {
    path,
    change_type: changeType,
    action: fileAction(path, verb),
    hunks,
    truncated: boolValue(mutation.truncated),
  };
}

function diffFilesFromPayload(item: FlowerActivityItem): readonly FlowerActivityDiffFile[] {
  const payload = item.payload ?? {};
  const defaultPath = payloadPath(item, payload);
  const mutationSource = asArray(payload.mutations).length > 0 ? asArray(payload.mutations) : [payload];
  return mutationSource.map((entry) => diffFileFromMutation(item, asRecord(entry), defaultPath))
    .filter((file): file is FlowerActivityDiffFile => file !== null && trimString(file.path) !== '');
}

function titleForPatchItem(item: FlowerActivityItem, files: readonly FlowerActivityDiffFile[]): FlowerActivityTitle {
  if (files.length === 1) {
    const file = files[0];
    return { kind: 'file', verb: fileVerbForOperation(file.change_type), path: file.path };
  }
  if (files.length > 1) {
    return { kind: 'file', verb: 'Edit', path: `${files.length} files` };
  }
  return { kind: 'file', verb: 'Edit', path: trimString(item.label) || 'files' };
}

function presentationForFile(item: FlowerActivityItem): FlowerActivityPresentation {
  const payload = item.payload ?? {};
  const operation = operationFromPayload(payload) || (trimString(item.tool_name) === 'file.read' ? 'read' : 'edit');
  const verb = fileVerbForOperation(operation);
  const path = payloadPath(item, payload) || trimString(item.label) || defaultLabelForItem(item);
  const title: FlowerActivityTitle = { kind: 'file', verb, path };
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  if (verb === 'Read') {
    detailBlocks.push({
      kind: 'file_read',
      action: fileAction(path, verb),
      content: contentText(payload.content),
      line_offset: numericValue(payload.line_offset) || 1,
      line_count: numericValue(payload.line_count),
      total_lines: numericValue(payload.total_lines),
      truncated: boolValue(payload.truncated),
    });
  } else {
    const files = diffFilesFromPayload(item);
    if (files.length > 0) {
      detailBlocks.push({ kind: 'file_diff', files });
    }
  }
  const statusLines = fileStatusLines(item, payload);
  if (statusLines.length > 0 && detailBlocks.length === 0) {
    detailBlocks.push({ kind: 'structured', lines: statusLines });
  }
  return {
    label: titleText(title),
    title,
    meta: metaForItem(item),
    detailLines: statusLines,
    detailBlocks,
  };
}

function presentationForPatch(item: FlowerActivityItem): FlowerActivityPresentation {
  const files = diffFilesFromPayload(item);
  const title = titleForPatchItem(item, files);
  const payload = item.payload ?? {};
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  if (files.length > 0) {
    detailBlocks.push({ kind: 'file_diff', files });
  }
  const statusLines = fileStatusLines(item, payload);
  if (statusLines.length > 0 && detailBlocks.length === 0) {
    detailBlocks.push({ kind: 'structured', lines: statusLines });
  }
  return {
    label: titleText(title),
    title,
    meta: metaForItem(item),
    detailLines: statusLines,
    detailBlocks,
  };
}

function presentationForTodos(item: FlowerActivityItem): FlowerActivityPresentation {
  const title: FlowerActivityTitle = { kind: 'plain', text: trimString(item.label) || 'Update todos' };
  const items = todoItemsFromPayload(item.payload);
  return {
    label: title.text,
    title,
    meta: metaForItem(item),
    detailLines: [],
    detailBlocks: items.length > 0 ? [{ kind: 'todos', items }] : [],
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

export function presentFlowerActivityItem(item: FlowerActivityItem): FlowerActivityPresentation {
  const renderer = rendererForItem(item);
  if (renderer === 'file') return presentationForFile(item);
  if (renderer === 'patch') return presentationForPatch(item);
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
    meta: metaForItem(item),
    detailLines,
    detailBlocks,
  };
}
