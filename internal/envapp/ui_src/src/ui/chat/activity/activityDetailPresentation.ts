import type { ActivityDetailRef, ActivityItem } from '../types';
import type {
  ActivityDetailChip,
  ActivityDetailPresentation,
  ActivityDetailSection,
  ActivityDetailStatus,
  FileChangeDetailSection,
  StructuredFieldsSection,
  TodoDetailSection,
  TodoDetailStatus,
  WebDetailSection,
} from './activityDetailTypes';

type AnyRecord = Record<string, unknown>;

const SECRET_FIELD_PATTERN = /(api[_-]?key|authorization|bearer|credential|password|secret|token|^sk$|[_-]sk$|^sk[_-])/i;
const OMITTED_FIELD_PATTERN = /^(raw_args|raw_result)$/i;
const SECRET_MARKER_PATTERN = /^(contains[_-]?secret|is[_-]?secret|sensitive|is[_-]?sensitive)$/i;
const MARKED_SECRET_VALUE_FIELD_PATTERN = /^(value|text|content|input|output|body|message)$/i;

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(source: AnyRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

function readRawString(source: AnyRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

function readNumber(source: AnyRecord, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readBoolean(source: AnyRecord, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
    }
  }
  return undefined;
}

function booleanLike(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'yes', 'y', 'on'].includes(normalized);
  }
  return false;
}

function compact(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function compactMultiline(value: string, max = 900): string {
  const normalized = value.trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusFrom(value: unknown): ActivityDetailStatus {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'running') return 'running';
  if (normalized === 'success' || normalized === 'succeeded' || normalized === 'complete' || normalized === 'completed') return 'success';
  if (normalized === 'error' || normalized === 'failed' || normalized === 'failure') return 'error';
  if (normalized === 'pending') return 'pending';
  if (normalized === 'waiting' || normalized === 'waiting_approval') return 'waiting';
  return 'info';
}

function statusTone(status: ActivityDetailStatus): ActivityDetailChip['tone'] {
  if (status === 'success') return 'success';
  if (status === 'error') return 'danger';
  if (status === 'waiting' || status === 'pending' || status === 'running') return 'warning';
  return 'neutral';
}

function formatDuration(ms: number | undefined): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function itemTarget(item: ActivityItem): string {
  const first = Array.isArray(item.targetRefs) ? item.targetRefs[0] : undefined;
  return String(first?.label ?? item.description ?? '').trim();
}

function detailID(item: ActivityItem, ref: ActivityDetailRef): string {
  return String(ref.refId || item.itemId || item.toolId || `${item.label}:${ref.kind}`).trim();
}

function basePresentation(item: ActivityItem, ref: ActivityDetailRef, payload: unknown): ActivityDetailPresentation {
  const rec = asRecord(payload);
  const status = statusFrom(readString(rec, 'status') || item.status);
  const latency = readNumber(rec, 'latency_ms', 'duration_ms', 'durationMs');
  const chips: ActivityDetailChip[] = [
    { label: status === 'success' ? 'success' : status, tone: statusTone(status) },
  ];
  const duration = formatDuration(latency);
  if (duration) chips.push({ label: 'duration', value: duration });
  return {
    detailId: detailID(item, ref),
    title: ref.title || item.label || 'Tool detail',
    subtitle: itemTarget(item),
    status,
    toolName: readString(rec, 'tool_name', 'toolName') || item.toolName,
    startedAtUnixMs: readNumber(rec, 'started_at_unix_ms', 'startedAtUnixMs'),
    endedAtUnixMs: readNumber(rec, 'ended_at_unix_ms', 'endedAtUnixMs'),
    durationMs: latency,
    chips,
    sections: [],
    copyTargets: [],
  };
}

function terminalPresentation(item: ActivityItem, ref: ActivityDetailRef, payload: unknown): ActivityDetailPresentation {
  const rec = asRecord(payload);
  const presentation = basePresentation(item, ref, payload);
  const exitCode = readNumber(rec, 'exit_code', 'exitCode');
  const durationMs = readNumber(rec, 'duration_ms', 'durationMs');
  const stdout = readRawString(rec, 'stdout');
  const stderr = readRawString(rec, 'stderr');
  const command = itemTarget(item);
  const timeoutMs = readNumber(rec, 'timeout_ms', 'timeoutMs');
  const timedOut = readBoolean(rec, 'timed_out', 'timedOut');
  const truncated = readBoolean(rec, 'truncated');

  if (typeof exitCode === 'number') {
    presentation.chips.push({ label: 'exit', value: String(exitCode), tone: exitCode === 0 ? 'success' : 'danger' });
  }
  const duration = formatDuration(durationMs);
  if (duration && !presentation.chips.some((chip) => chip.label === 'duration')) {
    presentation.chips.push({ label: 'duration', value: duration });
  }
  if (timedOut) presentation.chips.push({ label: 'timed out', tone: 'danger' });
  if (truncated) presentation.chips.push({ label: 'truncated', tone: 'warning' });

  presentation.sections.push({
    kind: 'terminal',
    command,
    cwd: readString(rec, 'cwd'),
    exitCode,
    stdout,
    stderr,
    timedOut,
    truncated,
    timeoutMs,
  });

  if (command) presentation.copyTargets.push({ id: 'command', label: 'Copy command', text: command });
  if (stdout) presentation.copyTargets.push({ id: 'stdout', label: 'Copy stdout', text: stdout });
  if (stderr) presentation.copyTargets.push({ id: 'stderr', label: 'Copy stderr', text: stderr });
  return ensureContent(presentation);
}

function normalizeTodoStatus(value: unknown): TodoDetailStatus {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'done') return 'completed';
  if (normalized === 'in_progress' || normalized === 'in progress' || normalized === 'active') return 'in_progress';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  return 'pending';
}

function todoText(rec: AnyRecord): string {
  return readString(rec, 'content', 'title', 'task', 'text', 'description') || 'Untitled todo';
}

function todoPresentation(item: ActivityItem, ref: ActivityDetailRef, payload: unknown): ActivityDetailPresentation | null {
  const rec = asRecord(payload);
  const args = asRecord(rec.args);
  const result = asRecord(rec.result);
  const todos = asArray(result.todos).length > 0 ? asArray(result.todos) : asArray(args.todos);
  if (todos.length === 0) return null;
  const presentation = basePresentation(item, ref, payload);
  const section: TodoDetailSection = {
    kind: 'todo_delta',
    title: 'Todo changes',
    items: todos.map((entry) => {
      const todo = asRecord(entry);
      const rawBeforeStatus = todo.before_status ?? todo.beforeStatus;
      return {
        id: readString(todo, 'id'),
        content: todoText(todo),
        beforeStatus: rawBeforeStatus === undefined || rawBeforeStatus === null ? undefined : normalizeTodoStatus(rawBeforeStatus),
        afterStatus: normalizeTodoStatus(todo.status ?? todo.after_status ?? todo.afterStatus),
        note: readString(todo, 'note'),
      };
    }),
  };
  presentation.sections.push(section);
  const completed = section.items.filter((todo) => todo.afterStatus === 'completed').length;
  const active = section.items.filter((todo) => todo.afterStatus === 'in_progress').length;
  presentation.chips.push({ label: `${section.items.length} items` });
  if (completed > 0) presentation.chips.push({ label: 'completed', value: String(completed), tone: 'success' });
  if (active > 0) presentation.chips.push({ label: 'in progress', value: String(active), tone: 'accent' });
  presentation.copyTargets.push({
    id: 'todos',
    label: 'Copy summary',
    text: section.items.map((todo) => `${todo.afterStatus}: ${todo.content}`).join('\n'),
  });
  return ensureContent(presentation);
}

function presentationDetailKind(item: ActivityItem, ref: ActivityDetailRef): ActivityDetailSection['kind'] {
  const explicitKind = String(ref.kind ?? '').trim();
  if (explicitKind && explicitKind !== 'tool_detail') {
    if (['terminal', 'todo_delta', 'file_change', 'web_results', 'error', 'structured_fields'].includes(explicitKind)) {
      return explicitKind as ActivityDetailSection['kind'];
    }
    if (explicitKind === 'terminal_output') return 'terminal';
  }
  const renderer = String(item.renderer ?? '').trim();
  if (renderer === 'command') return 'terminal';
  if (renderer === 'todos') return 'todo_delta';
  if (renderer === 'file_change' || renderer === 'file_context') return 'file_change';
  if (renderer === 'sources' || renderer === 'knowledge') return 'web_results';
  return 'structured_fields';
}

function fileOperation(item: ActivityItem, path: string, args: AnyRecord): FileChangeDetailSection['files'][number]['operation'] {
  if (item.renderer === 'file_context') return 'read';
  if (readString(args, 'operation') === 'delete') return 'deleted';
  return path ? 'updated' : 'unknown';
}

function patchFiles(patch: string): FileChangeDetailSection['files'] {
  const files: FileChangeDetailSection['files'] = [];
  const seen = new Set<string>();
  for (const rawLine of patch.split('\n')) {
    const line = rawLine.trim();
    const match = /^(?:\*\*\* (Add|Update|Delete) File:|---|\+\+\+)\s+(.+)$/.exec(line);
    if (!match) continue;
    const operation = match[1] === 'Add' ? 'created' : match[1] === 'Delete' ? 'deleted' : 'updated';
    const path = match[2].replace(/^[ab]\//, '').trim();
    if (!path || seen.has(path) || path === '/dev/null') continue;
    seen.add(path);
    files.push({ path, operation, diffPreview: compactMultiline(patch, 900) });
  }
  return files;
}

function filePresentation(item: ActivityItem, ref: ActivityDetailRef, payload: unknown): ActivityDetailPresentation | null {
  const rec = asRecord(payload);
  const args = asRecord(rec.args);
  const patch = readString(args, 'patch');
  const files = patch ? patchFiles(patch) : [];
  const directPath = readString(args, 'file_path', 'path') || item.targetRefs?.find((target) => target.kind === 'file')?.path || itemTarget(item);
  if (files.length === 0 && directPath) {
    files.push({
      path: directPath,
      operation: fileOperation(item, directPath, args),
      summary: readString(args, 'summary') || item.description,
    });
  }
  if (files.length === 0) return null;
  const presentation = basePresentation(item, ref, payload);
  presentation.sections.push({ kind: 'file_change', files });
  presentation.chips.push({ label: `${files.length} file${files.length === 1 ? '' : 's'}` });
  presentation.copyTargets.push({ id: 'paths', label: 'Copy paths', text: files.map((file) => file.path).join('\n') });
  return ensureContent(presentation);
}

function webPresentation(item: ActivityItem, ref: ActivityDetailRef, payload: unknown): ActivityDetailPresentation | null {
  const rec = asRecord(payload);
  const args = asRecord(rec.args);
  const result = asRecord(rec.result);
  const sourceInputs = asArray(result.sources).length > 0 ? asArray(result.sources) : asArray(result.results);
  const sources = sourceInputs.map((entry) => {
    const source = asRecord(entry);
    return {
      title: readString(source, 'title', 'name') || readString(source, 'url', 'uri') || 'Untitled source',
      url: readString(source, 'url', 'uri'),
      snippet: readString(source, 'snippet', 'summary', 'content'),
    };
  }).filter((source) => source.title || source.url);
  const targetSources = (item.targetRefs ?? [])
    .filter((target) => target.kind === 'url' || target.uri)
    .map((target) => ({ title: target.label, url: target.uri }));
  const allSources = sources.length > 0 ? sources : targetSources;
  const query = readString(args, 'query') || itemTarget(item);
  if (!query && allSources.length === 0) return null;
  const presentation = basePresentation(item, ref, payload);
  const section: WebDetailSection = { kind: 'web_results', query, sources: allSources };
  presentation.sections.push(section);
  if (allSources.length > 0) presentation.chips.push({ label: `${allSources.length} source${allSources.length === 1 ? '' : 's'}` });
  if (query) presentation.copyTargets.push({ id: 'query', label: 'Copy query', text: query });
  return ensureContent(presentation);
}

function errorSection(payload: AnyRecord): ActivityDetailSection | null {
  const message = readString(payload, 'error_message', 'errorMessage', 'error');
  if (!message) return null;
  return {
    kind: 'error',
    code: readString(payload, 'error_code', 'errorCode'),
    message,
    retryable: readBoolean(payload, 'retryable'),
    recoveryAction: readString(payload, 'recovery_action', 'recoveryAction'),
  };
}

function isSecretMarker(key: string, value: unknown): boolean {
  return SECRET_MARKER_PATTERN.test(key) && booleanLike(value);
}

function shouldOmitStructuredField(key: string, value: unknown): boolean {
  return OMITTED_FIELD_PATTERN.test(key) || isSecretMarker(key, value);
}

function displayValue(key: string, value: unknown, forceSecret = false): { value: string; secret: boolean } | null {
  if (OMITTED_FIELD_PATTERN.test(key)) return null;
  if (isSecretMarker(key, value)) return null;
  const secret = forceSecret || SECRET_FIELD_PATTERN.test(key);
  if (secret) return { value: '********', secret: true };
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized ? { value: compact(normalized, 220), secret: false } : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { value: String(value), secret: false };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const scalar = value.filter((entry) => ['string', 'number', 'boolean'].includes(typeof entry)).map(String);
    if (scalar.length === value.length) return { value: compact(scalar.join(', '), 220), secret: false };
    return { value: `${value.length} item${value.length === 1 ? '' : 's'}`, secret: false };
  }
  if (typeof value === 'object') {
    const count = Object.entries(asRecord(value)).filter(([field, entry]) => !shouldOmitStructuredField(field, entry)).length;
    return count > 0 ? { value: `${count} field${count === 1 ? '' : 's'}`, secret: false } : null;
  }
  return null;
}

function structuredGroup(title: string, value: unknown): StructuredFieldsSection['groups'][number] | null {
  const record = asRecord(value);
  const forceSecret = Object.entries(record).some(([key, entry]) => isSecretMarker(key, entry));
  const fields = Object.entries(record)
    .map(([key, entry]) => {
      const displayed = displayValue(key, entry, forceSecret && MARKED_SECRET_VALUE_FIELD_PATTERN.test(key));
      if (!displayed) return null;
      return {
        label: titleCase(key),
        value: displayed.value,
        secret: displayed.secret,
      };
    })
    .filter((field): field is NonNullable<typeof field> => field !== null);
  return fields.length > 0 ? { title, fields } : null;
}

function structuredPresentation(item: ActivityItem, ref: ActivityDetailRef, payload: unknown): ActivityDetailPresentation {
  const rec = asRecord(payload);
  const presentation = basePresentation(item, ref, payload);
  const groups = [
    structuredGroup('Arguments', rec.args),
    structuredGroup('Result', rec.result),
  ].filter((group): group is NonNullable<typeof group> => group !== null);
  const section: StructuredFieldsSection = {
    kind: 'structured_fields',
    title: 'Tool details',
    groups: groups.length > 0 ? groups : [{
      title: 'Summary',
      fields: [
        { label: 'Tool', value: presentation.toolName || item.toolName || 'Unknown tool' },
        { label: 'Status', value: presentation.status },
      ],
    }],
  };
  const err = errorSection(rec);
  if (err) presentation.sections.push(err);
  presentation.sections.push(section);
  return ensureContent(presentation);
}

function ensureContent(presentation: ActivityDetailPresentation): ActivityDetailPresentation {
  if (presentation.sections.length > 0) return presentation;
  presentation.sections.push({
    kind: 'structured_fields',
    title: 'No captured content',
    groups: [{
      title: 'Summary',
      fields: [
        { label: 'Status', value: presentation.status },
        { label: 'Detail', value: 'No output was captured for this tool call.' },
      ],
    }],
  });
  return presentation;
}

export function normalizeActivityDetail(item: ActivityItem, ref: ActivityDetailRef, payload: unknown): ActivityDetailPresentation {
  const detailKind = presentationDetailKind(item, ref);
  if (detailKind === 'terminal') {
    return terminalPresentation(item, ref, payload);
  }
  const rec = asRecord(payload);
  const err = errorSection(rec);
  const semanticPresentation = (() => {
    if (detailKind === 'todo_delta') return todoPresentation(item, ref, payload);
    if (detailKind === 'file_change') return filePresentation(item, ref, payload);
    if (detailKind === 'web_results') return webPresentation(item, ref, payload);
    return null;
  })();
  if (semanticPresentation) {
    if (err && !semanticPresentation.sections.some((section) => section.kind === 'error')) {
      semanticPresentation.sections.unshift(err);
    }
    return semanticPresentation;
  }
  return structuredPresentation(item, ref, payload);
}
