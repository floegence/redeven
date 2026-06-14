import type { ActivityDetailRef, ActivityItem } from '../types';
import type { EnvAppTranslationKey } from '../../i18n/locales';
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
  if (normalized === 'waiting') return 'waiting';
  return 'info';
}

function statusTone(status: ActivityDetailStatus): ActivityDetailChip['tone'] {
  if (status === 'success') return 'success';
  if (status === 'error') return 'danger';
  if (status === 'waiting' || status === 'pending' || status === 'running') return 'warning';
  return 'neutral';
}

function statusLabelKey(status: ActivityDetailStatus): EnvAppTranslationKey {
  return `chatActivity.status.${status}` as EnvAppTranslationKey;
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
  const first = Array.isArray(item.target_refs) ? item.target_refs[0] : undefined;
  return String(first?.label ?? item.description ?? '').trim();
}

function detailID(item: ActivityItem, ref: ActivityDetailRef): string {
  return String(ref.ref_id || item.item_id || item.tool_id || `${item.label}:${ref.kind}`).trim();
}

function basePresentation(item: ActivityItem, ref: ActivityDetailRef, payload: unknown): ActivityDetailPresentation {
  const rec = asRecord(payload);
  const status = statusFrom(readString(rec, 'status') || item.status);
  const latency = readNumber(rec, 'latency_ms', 'duration_ms');
  const chips: ActivityDetailChip[] = [
    { labelKey: statusLabelKey(status), tone: statusTone(status) },
  ];
  const duration = formatDuration(latency);
  if (duration) chips.push({ labelKey: 'chatActivity.chip.duration', value: duration });
  return {
    detailId: detailID(item, ref),
    ...(ref.title || item.label ? { title: ref.title || item.label } : { titleKey: 'chatActivity.fallback.toolDetail' }),
    subtitle: itemTarget(item),
    status,
    toolName: readString(rec, 'tool_name') || item.tool_name,
    startedAtUnixMs: readNumber(rec, 'started_at_unix_ms'),
    endedAtUnixMs: readNumber(rec, 'ended_at_unix_ms'),
    durationMs: latency,
    chips,
    sections: [],
    copyTargets: [],
  };
}

function terminalPresentation(item: ActivityItem, ref: ActivityDetailRef, payload: unknown): ActivityDetailPresentation {
  const rec = asRecord(payload);
  const presentation = basePresentation(item, ref, payload);
  const exitCode = readNumber(rec, 'exit_code');
  const durationMs = readNumber(rec, 'duration_ms');
  const stdout = readRawString(rec, 'stdout');
  const stderr = readRawString(rec, 'stderr');
  const command = readString(rec, 'command') || itemTarget(item);
  const timeoutMs = readNumber(rec, 'timeout_ms');
  const timedOut = readBoolean(rec, 'timed_out');
  const truncated = readBoolean(rec, 'truncated');

  if (typeof exitCode === 'number') {
    presentation.chips.push({ labelKey: 'chatActivity.chip.exit', value: String(exitCode), tone: exitCode === 0 ? 'success' : 'danger' });
  }
  const duration = formatDuration(durationMs);
  if (duration && !presentation.chips.some((chip) => chip.labelKey === 'chatActivity.chip.duration')) {
    presentation.chips.push({ labelKey: 'chatActivity.chip.duration', value: duration });
  }
  if (timedOut) presentation.chips.push({ labelKey: 'chatActivity.chip.timedOut', tone: 'danger' });
  if (truncated) presentation.chips.push({ labelKey: 'chatActivity.truncated', tone: 'warning' });

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

  if (command) presentation.copyTargets.push({ id: 'command', labelKey: 'chatActivity.copyTarget.command', text: command });
  if (stdout) presentation.copyTargets.push({ id: 'stdout', labelKey: 'chatActivity.copyTarget.stdout', text: stdout });
  if (stderr) presentation.copyTargets.push({ id: 'stderr', labelKey: 'chatActivity.copyTarget.stderr', text: stderr });
  return ensureContent(presentation);
}

function normalizeTodoStatus(value: unknown): TodoDetailStatus {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'done') return 'completed';
  if (normalized === 'in_progress' || normalized === 'in progress' || normalized === 'active') return 'in_progress';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  return 'pending';
}

function todoContent(rec: AnyRecord): Pick<TodoDetailSection['items'][number], 'content' | 'contentKey'> {
  const content = readString(rec, 'content', 'title', 'task', 'text', 'description');
  return content ? { content } : { contentKey: 'chatActivity.fallback.untitledTodo' };
}

function todoPresentation(item: ActivityItem, ref: ActivityDetailRef, payload: unknown): ActivityDetailPresentation | null {
  const rec = asRecord(payload);
  const args = asRecord(rec.args);
  const result = asRecord(rec.result);
  const todos = asArray(rec.todos).length > 0 ? asArray(rec.todos) : asArray(result.todos).length > 0 ? asArray(result.todos) : asArray(args.todos);
  if (todos.length === 0) return null;
  const presentation = basePresentation(item, ref, payload);
  const section: TodoDetailSection = {
    kind: 'todo_delta',
    titleKey: 'chatActivity.sectionTitle.todoChanges',
    items: todos.map((entry) => {
      const todo = asRecord(entry);
      const rawBeforeStatus = todo.before_status;
      return {
        id: readString(todo, 'id'),
        ...todoContent(todo),
        beforeStatus: rawBeforeStatus === undefined || rawBeforeStatus === null ? undefined : normalizeTodoStatus(rawBeforeStatus),
        afterStatus: normalizeTodoStatus(todo.status ?? todo.after_status),
        note: readString(todo, 'note'),
      };
    }),
  };
  presentation.sections.push(section);
  const completed = section.items.filter((todo) => todo.afterStatus === 'completed').length;
  const active = section.items.filter((todo) => todo.afterStatus === 'in_progress').length;
  presentation.chips.push({ labelKey: 'chatActivity.todoItems', labelCount: section.items.length });
  if (completed > 0) presentation.chips.push({ labelKey: 'chatActivity.chip.completed', value: String(completed), tone: 'success' });
  if (active > 0) presentation.chips.push({ labelKey: 'chatActivity.chip.inProgress', value: String(active), tone: 'accent' });
  presentation.copyTargets.push({
    id: 'todos',
    labelKey: 'chatActivity.copyTarget.summary',
    text: section.items.map((todo) => `${todo.afterStatus}: ${todo.content ?? ''}`.trim()).join('\n'),
    textKey: 'chatActivity.fallback.untitledTodo',
    textPrefixSeparator: ':',
  });
  return ensureContent(presentation);
}

function presentationDetailKind(item: ActivityItem, ref: ActivityDetailRef, payload: unknown): ActivityDetailSection['kind'] {
  const explicitKind = String(ref.kind ?? '').trim();
  if (explicitKind && explicitKind !== 'tool_detail') {
    if (['terminal', 'todo_delta', 'file_change', 'file_read_content', 'web_results', 'error', 'structured_fields'].includes(explicitKind)) {
      return explicitKind as ActivityDetailSection['kind'];
    }
  }
  const renderer = String(item.renderer ?? '').trim();
  if (renderer === 'terminal') return 'terminal';
  if (renderer === 'todos') return 'todo_delta';
  if (renderer === 'file') {
    const detailPayload = Object.keys(asRecord(ref.payload)).length > 0 ? asRecord(ref.payload) : asRecord(payload);
    const operation = readString(detailPayload, 'operation');
    if (operation === 'read' || Object.prototype.hasOwnProperty.call(detailPayload, 'content')) {
      return 'file_read_content';
    }
    return 'file_change';
  }
  if (renderer === 'patch') return 'file_change';
  if (renderer === 'web_search') return 'web_results';
  return 'structured_fields';
}

function fileOperation(item: ActivityItem, path: string, payload: AnyRecord, args: AnyRecord): FileChangeDetailSection['files'][number]['operation'] {
  const operation = readString(payload, 'operation') || readString(args, 'operation');
  if (operation === 'read') return 'read';
  if (operation === 'delete') return 'deleted';
  if (operation === 'apply_patch') return path ? 'updated' : 'unknown';
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
  const patch = readString(rec, 'patch') || readString(args, 'patch');
  const files = patch ? patchFiles(patch) : [];
  const directPath = readString(rec, 'file_path', 'path') || readString(args, 'file_path', 'path') || item.target_refs?.find((target) => target.kind === 'file')?.path || itemTarget(item);
  if (files.length === 0 && directPath) {
    files.push({
      path: directPath,
      operation: fileOperation(item, directPath, rec, args),
      summary: readString(rec, 'summary') || readString(args, 'summary') || item.description,
    });
  }
  if (files.length === 0) return null;
  const presentation = basePresentation(item, ref, payload);
  presentation.sections.push({ kind: 'file_change', files });
  presentation.chips.push({ labelKey: 'chatActivity.fileCount', labelCount: files.length });
  presentation.copyTargets.push({ id: 'paths', labelKey: 'chatActivity.copyTarget.paths', text: files.map((file) => file.path).join('\n') });
  return ensureContent(presentation);
}

function fileReadContentPresentation(item: ActivityItem, ref: ActivityDetailRef, payload: unknown): ActivityDetailPresentation | null {
  const rec = asRecord(payload);
  const args = asRecord(rec.args);
  const result = asRecord(rec.result);
  const filePath = readString(rec, 'file_path', 'path') || readString(args, 'file_path', 'path') || itemTarget(item);
  if (!filePath) return null;
  const content = readRawString(rec, 'content') || readRawString(result, 'content');
  const lineOffset = readNumber(rec, 'line_offset', 'offset') ?? readNumber(result, 'line_offset', 'offset');
  const lineCount = readNumber(rec, 'line_count', 'lines') ?? readNumber(result, 'line_count', 'lines');
  const totalLines = readNumber(rec, 'total_lines') ?? readNumber(result, 'total_lines');
  const truncated = readBoolean(rec, 'truncated') ?? readBoolean(result, 'truncated');

  const presentation: ActivityDetailPresentation = {
    detailId: detailID(item, ref),
    ...(item.label ? { title: item.label } : { titleKey: 'chatActivity.fallback.readFile' }),
    subtitle: filePath,
    status: 'success',
    toolName: readString(rec, 'tool_name') || item.tool_name,
    startedAtUnixMs: readNumber(rec, 'started_at_unix_ms'),
    endedAtUnixMs: readNumber(rec, 'ended_at_unix_ms'),
    durationMs: readNumber(rec, 'latency_ms', 'duration_ms'),
    chips: [],
    sections: [],
    copyTargets: [],
  };

  presentation.sections.push({
    kind: 'file_read_content',
    filePath,
    content,
    lineOffset,
    lineCount,
    totalLines,
    truncated,
  });

  if (content) {
    presentation.copyTargets.push({ id: 'content', labelKey: 'chatActivity.copyTarget.content', text: content });
  }

  return presentation;
}

function webPresentation(item: ActivityItem, ref: ActivityDetailRef, payload: unknown): ActivityDetailPresentation | null {
  const rec = asRecord(payload);
  const args = asRecord(rec.args);
  const result = asRecord(rec.result);
  const sourceInputs = asArray(rec.sources).length > 0 ? asArray(rec.sources) : asArray(rec.results).length > 0 ? asArray(rec.results) : asArray(result.sources).length > 0 ? asArray(result.sources) : asArray(result.results);
  const sources: WebDetailSection['sources'] = sourceInputs.map((entry) => {
    const source = asRecord(entry);
    const title = readString(source, 'title', 'name') || readString(source, 'url', 'uri');
    return {
      title: title || undefined,
      titleKey: title ? undefined : 'chatActivity.fallback.untitledSource' as EnvAppTranslationKey,
      url: readString(source, 'url', 'uri'),
      snippet: readString(source, 'snippet', 'summary', 'content'),
    };
  }).filter((source) => source.title || source.titleKey || source.url);
  const targetSources = (item.target_refs ?? [])
    .filter((target) => target.kind === 'url' || target.uri)
    .map((target) => ({ title: target.label, url: target.uri }));
  const allSources = sources.length > 0 ? sources : targetSources;
  const query = readString(rec, 'query') || readString(args, 'query') || itemTarget(item);
  if (!query && allSources.length === 0) return null;
  const presentation = basePresentation(item, ref, payload);
  const section: WebDetailSection = { kind: 'web_results', query, sources: allSources };
  presentation.sections.push(section);
  if (allSources.length > 0) presentation.chips.push({ labelKey: 'chatActivity.chip.sourceCount', labelCount: allSources.length });
  if (query) presentation.copyTargets.push({ id: 'query', labelKey: 'chatActivity.copyTarget.query', text: query });
  return ensureContent(presentation);
}

function errorSection(payload: AnyRecord): ActivityDetailSection | null {
  const message = readString(payload, 'error_message', 'error');
  if (!message) return null;
  return {
    kind: 'error',
    code: readString(payload, 'error_code'),
    message,
    retryable: readBoolean(payload, 'retryable'),
    recoveryAction: readString(payload, 'recovery_action'),
  };
}

function isSecretMarker(key: string, value: unknown): boolean {
  return SECRET_MARKER_PATTERN.test(key) && booleanLike(value);
}

function shouldOmitStructuredField(key: string, value: unknown): boolean {
  return OMITTED_FIELD_PATTERN.test(key) || isSecretMarker(key, value);
}

function displayValue(key: string, value: unknown, forceSecret = false): {
  value?: string;
  valueKey?: EnvAppTranslationKey;
  valueCount?: number;
  secret: boolean;
} | null {
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
    return { valueKey: 'chatActivity.todoItems', valueCount: value.length, secret: false };
  }
  if (typeof value === 'object') {
    const count = Object.entries(asRecord(value)).filter(([field, entry]) => !shouldOmitStructuredField(field, entry)).length;
    return count > 0 ? { valueKey: 'chatActivity.chip.fieldCount', valueCount: count, secret: false } : null;
  }
  return null;
}

function structuredGroup(titleKey: EnvAppTranslationKey, value: unknown): StructuredFieldsSection['groups'][number] | null {
  const record = asRecord(value);
  const forceSecret = Object.entries(record).some(([key, entry]) => isSecretMarker(key, entry));
  const fields = Object.entries(record)
    .map(([key, entry]) => {
      const displayed = displayValue(key, entry, forceSecret && MARKED_SECRET_VALUE_FIELD_PATTERN.test(key));
      if (!displayed) return null;
      return {
        label: titleCase(key),
        value: displayed.value,
        valueKey: displayed.valueKey,
        valueCount: displayed.valueCount,
        secret: displayed.secret,
      };
    })
    .filter((field): field is NonNullable<typeof field> => field !== null);
  return fields.length > 0 ? { titleKey, fields } : null;
}

function structuredPresentation(item: ActivityItem, ref: ActivityDetailRef, payload: unknown): ActivityDetailPresentation {
  const rec = asRecord(payload);
  const presentation = basePresentation(item, ref, payload);
  const groups = [
    structuredGroup('chatActivity.sectionTitle.summary', rec),
    structuredGroup('chatActivity.sectionTitle.arguments', rec.args),
    structuredGroup('chatActivity.sectionTitle.result', rec.result),
  ].filter((group): group is NonNullable<typeof group> => group !== null);
  const section: StructuredFieldsSection = {
    kind: 'structured_fields',
    titleKey: 'chatActivity.sectionTitle.toolDetails',
    groups: groups.length > 0 ? groups : [{
      titleKey: 'chatActivity.sectionTitle.summary',
      fields: [
        {
          labelKey: 'chatActivity.field.tool',
          value: presentation.toolName || item.tool_name,
          valueKey: presentation.toolName || item.tool_name ? undefined : 'chatActivity.fallback.unknownTool',
        },
        { labelKey: 'chatActivity.field.status', valueKey: statusLabelKey(presentation.status) },
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
    titleKey: 'chatActivity.sectionTitle.noCapturedContent',
    groups: [{
      titleKey: 'chatActivity.sectionTitle.summary',
      fields: [
        { labelKey: 'chatActivity.field.status', valueKey: statusLabelKey(presentation.status) },
        { labelKey: 'chatActivity.field.detail', valueKey: 'chatActivity.fallback.noOutputCaptured' },
      ],
    }],
  });
  return presentation;
}

export function normalizeActivityDetail(item: ActivityItem, ref: ActivityDetailRef, payload: unknown): ActivityDetailPresentation {
  const detailKind = presentationDetailKind(item, ref, payload);
  if (detailKind === 'terminal') {
    return terminalPresentation(item, ref, payload);
  }
  const rec = asRecord(payload);
  const err = errorSection(rec);
  const semanticPresentation = (() => {
    if (detailKind === 'todo_delta') return todoPresentation(item, ref, payload);
    if (detailKind === 'file_change') return filePresentation(item, ref, payload);
    if (detailKind === 'file_read_content') return fileReadContentPresentation(item, ref, payload);
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
