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

export type FlowerActivityDetailBlock =
  | Readonly<{
    kind: 'lines';
    lines: readonly FlowerActivityDetailLine[];
  }>
  | Readonly<{
    kind: 'todos';
    items: readonly FlowerActivityTodoItem[];
  }>;

export type FlowerActivityPresentation = Readonly<{
  label: string;
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
  operation: 'operation',
  path: 'path',
  file_path: 'path',
  offset: 'offset',
  limit: 'limit',
  content: 'content',
  bytes: 'bytes',
  lines: 'lines',
  line_count: 'lines',
  patch: 'patch',
  files: 'files',
  query: 'query',
  provider: 'provider',
  count: 'count',
  sources: 'sources',
  results: 'results',
  counts: 'counts',
  expected_version: 'version',
  explanation: 'explanation',
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

const RENDERER_DETAIL_KEYS: Readonly<Record<FlowerActivityRenderer, readonly string[]>> = {
  terminal: ['command', 'cwd', 'workdir', 'timeout_ms', 'timeout_source', 'exit_code', 'duration_ms', 'timed_out', 'truncated', 'stdout', 'stderr', 'summary', 'details', 'error'],
  file: ['operation', 'path', 'file_path', 'offset', 'limit', 'bytes', 'lines', 'line_count', 'truncated', 'content', 'summary', 'details', 'error'],
  patch: ['operation', 'files', 'patch', 'truncated', 'summary', 'details', 'error'],
  web_search: ['query', 'provider', 'count', 'sources', 'results', 'summary', 'details', 'error'],
  todos: ['counts', 'expected_version', 'explanation', 'summary', 'details', 'error'],
  question: ['reason_code', 'required_from_user', 'questions', 'contains_secret', 'summary', 'details', 'error'],
  completion: ['result', 'evidence_refs', 'remaining_risks', 'next_actions', 'summary', 'details', 'error'],
  structured: ['summary', 'details', 'status', 'error', 'content_ref'],
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

function labelForItem(item: FlowerActivityItem, renderer: FlowerActivityRenderer): string {
  const explicit = trimString(item.label);
  switch (renderer) {
    case 'terminal':
      return payloadValue(item.payload, 'command') || explicit || defaultLabelForItem(item);
    case 'file':
      if (explicit) return explicit;
      return payloadValue(item.payload, 'path', 'file_path') || item.target_refs?.[0]?.label || defaultLabelForItem(item);
    case 'patch':
      if (explicit) return explicit;
      return payloadValue(item.payload, 'operation') || 'apply_patch';
    case 'web_search':
      if (explicit) return explicit;
      return payloadValue(item.payload, 'query') || defaultLabelForItem(item);
    case 'todos':
      if (explicit) return explicit;
      return 'Update todos';
    case 'question':
      if (explicit) return explicit;
      return trimString(item.description) || payloadValue(item.payload, 'question', 'summary') || defaultLabelForItem(item);
    case 'completion':
      if (explicit) return explicit;
      return payloadValue(item.payload, 'result') || defaultLabelForItem(item);
    case 'structured':
      if (explicit) return explicit;
      return defaultLabelForItem(item);
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
  return key === 'command' || key === 'stdout' || key === 'stderr' || key === 'content' || key === 'patch' ? 'code' : undefined;
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

function shouldIncludeDetailKey(renderer: FlowerActivityRenderer, key: string): boolean {
  if (renderer !== 'todos') return true;
  return key !== 'todos' && key !== 'args' && key !== 'result' && key !== 'counts';
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

function detailLinesForItem(item: FlowerActivityItem, renderer: FlowerActivityRenderer): readonly FlowerActivityDetailLine[] {
  const payload = item.payload ?? {};
  const orderedKeys = new Set<string>(RENDERER_DETAIL_KEYS[renderer] ?? RENDERER_DETAIL_KEYS.structured);
  for (const key of Object.keys(payload).sort()) {
    if (!shouldIncludeDetailKey(renderer, key)) continue;
    orderedKeys.add(key);
  }
  const lines = Array.from(orderedKeys)
    .filter((key) => shouldIncludeDetailKey(renderer, key))
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

export function presentFlowerActivityItem(item: FlowerActivityItem): FlowerActivityPresentation {
  const renderer = rendererForItem(item);
  const detailLines = detailLinesForItem(item, renderer);
  const todoItems = renderer === 'todos' ? todoItemsFromPayload(item.payload) : [];
  const detailBlocks: FlowerActivityDetailBlock[] = [];
  if (todoItems.length > 0) {
    detailBlocks.push({ kind: 'todos', items: todoItems });
  }
  if (detailLines.length > 0) {
    detailBlocks.push({ kind: 'lines', lines: detailLines });
  }
  return {
    label: labelForItem(item, renderer),
    meta: metaForItem(item),
    detailLines,
    detailBlocks,
  };
}
