export const CONTEXT_ACTION_SCHEMA_VERSION = 2 as const;

export type ContextActionID =
  | 'assistant.ask.flower'
  | 'assistant.ask.codex'
  | 'handoff.terminal.open'
  | 'handoff.files.browse';

export type ContextActionProvider = 'flower' | 'codex';

export type ContextActionLocality =
  | 'auto'
  | 'current_runtime'
  | 'local_model_remote_target'
  | 'remote_runtime';

export type ContextActionSurface =
  | 'desktop_welcome_environment_card'
  | 'file_browser'
  | 'terminal'
  | 'file_preview'
  | 'monitoring'
  | 'git_browser'
  | 'editor_preview';

export type ContextActionTarget = Readonly<{
  target_id: string;
  locality: ContextActionLocality;
}>;

export type ContextActionSource = Readonly<{
  surface: ContextActionSurface;
  surface_id?: string;
}>;

export type ContextActionExecutionContext = Readonly<{
  current_target_id?: string;
  source_env_public_id?: string;
  runtime_hint?: 'auto' | 'local_environment' | 'env_local';
  session_source?: 'local_runtime' | 'provider_environment' | 'ssh_environment' | 'external_local_ui' | 'runtime_gateway' | 'region_sandbox';
}>;

export type ContextActionPresentation = Readonly<{
  label: string;
  priority: number;
  status_label?: string;
  disabled_reason?: string;
}>;

export type ContextActionContextItem =
  | Readonly<{
      kind: 'file_path';
      path: string;
      is_directory: boolean;
      root_label?: string;
    }>
  | Readonly<{
      kind: 'terminal_selection';
      working_dir: string;
      selection: string;
      selection_chars: number;
    }>
  | Readonly<{
      kind: 'process_snapshot';
      pid: number;
      name: string;
      username: string;
      cpu_percent: number;
      memory_bytes: number;
      platform: string;
      captured_at_ms: number;
    }>
  | Readonly<{
      kind: 'text_snapshot';
      title: string;
      detail?: string;
      content: string;
    }>;

export type ContextActionEnvelope = Readonly<{
  schema_version: typeof CONTEXT_ACTION_SCHEMA_VERSION;
  action_id: ContextActionID;
  provider?: ContextActionProvider;
  target: ContextActionTarget;
  source: ContextActionSource;
  execution_context?: ContextActionExecutionContext;
  context: ContextActionContextItem[];
  presentation: ContextActionPresentation;
  suggested_working_dir_abs?: string;
}>;

const ASK_FLOWER_LOCALITIES: readonly ContextActionLocality[] = [
  'auto',
  'current_runtime',
  'local_model_remote_target',
  'remote_runtime',
];

const ASK_FLOWER_SURFACES: readonly ContextActionSurface[] = [
  'desktop_welcome_environment_card',
  'file_browser',
  'terminal',
  'file_preview',
  'monitoring',
  'git_browser',
  'editor_preview',
];

const ASK_FLOWER_RUNTIME_HINTS: readonly NonNullable<ContextActionExecutionContext['runtime_hint']>[] = [
  'auto',
  'local_environment',
  'env_local',
];

const ASK_FLOWER_SESSION_SOURCES: readonly NonNullable<ContextActionExecutionContext['session_source']>[] = [
  'local_runtime',
  'provider_environment',
  'ssh_environment',
  'external_local_ui',
  'runtime_gateway',
  'region_sandbox',
];

const KNOWN_CONTEXT_KINDS = new Set([
  'file_path',
  'terminal_selection',
  'process_snapshot',
  'text_snapshot',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringMember<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.includes(value as T);
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined | null {
  if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] === undefined) return undefined;
  return typeof record[key] === 'string' ? record[key] : null;
}

function validPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value === value.trim()
    && !/[\r\n]/.test(value);
}

function validNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validSingleLineString(value: unknown): value is string {
  return validNonEmptyString(value) && !/[\r\n]/.test(value);
}

function validCharacterCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseSelectionItem(record: Record<string, unknown>): Readonly<{ selection: string; selection_chars: number }> | null {
  if (typeof record.selection !== 'string') return null;
  const selection = record.selection;
  if (!validCharacterCount(record.selection_chars)) return null;
  if (selection !== '' && record.selection_chars !== Array.from(selection.trim()).length) return null;
  return { selection, selection_chars: record.selection_chars };
}

function parseContextItem(value: unknown): ContextActionContextItem | null {
  if (!isRecord(value)) return null;
  const kind = typeof value.kind === 'string' ? value.kind : '';
  switch (kind) {
    case 'file_path': {
      if (!validPath(value.path)) return null;
      if (typeof value.is_directory !== 'boolean') return null;
      const rootLabel = optionalString(value, 'root_label');
      if (rootLabel === null || (rootLabel !== undefined && /[\r\n]/.test(rootLabel))) return null;
      return {
        kind,
        path: value.path,
        is_directory: value.is_directory,
        ...(rootLabel !== undefined ? { root_label: rootLabel } : {}),
      };
    }
    case 'terminal_selection': {
      if (!validSingleLineString(value.working_dir)) return null;
      const selection = parseSelectionItem(value);
      return selection ? { kind, working_dir: value.working_dir.trim(), ...selection } : null;
    }
    case 'process_snapshot': {
      if (typeof value.pid !== 'number' || !Number.isInteger(value.pid) || value.pid <= 0) return null;
      if (!validSingleLineString(value.name) || !validSingleLineString(value.username)) return null;
      if (typeof value.cpu_percent !== 'number' || !Number.isFinite(value.cpu_percent) || value.cpu_percent < 0) return null;
      if (typeof value.memory_bytes !== 'number' || !Number.isFinite(value.memory_bytes) || value.memory_bytes < 0) return null;
      if (!validSingleLineString(value.platform)) return null;
      if (typeof value.captured_at_ms !== 'number' || !Number.isFinite(value.captured_at_ms) || value.captured_at_ms <= 0) return null;
      return {
        kind,
        pid: value.pid,
        name: value.name.trim(),
        username: value.username.trim(),
        cpu_percent: value.cpu_percent,
        memory_bytes: value.memory_bytes,
        platform: value.platform.trim(),
        captured_at_ms: value.captured_at_ms,
      };
    }
    case 'text_snapshot': {
      if (!validSingleLineString(value.title)) return null;
      const detail = optionalString(value, 'detail');
      if (detail === null || (detail !== undefined && /[\r\n]/.test(detail))) return null;
      if (!validNonEmptyString(value.content)) return null;
      return {
        kind,
        title: value.title.trim(),
        content: value.content,
        ...(detail !== undefined ? { detail } : {}),
      };
    }
    default: return null;
  }
}

function surfaceAllowsKind(surface: ContextActionSurface, kind: string): boolean {
  switch (surface) {
    case 'terminal': return kind === 'terminal_selection';
    case 'monitoring': return kind === 'process_snapshot';
    case 'git_browser':
    case 'desktop_welcome_environment_card': return kind === 'text_snapshot';
    case 'file_browser':
    case 'file_preview':
    case 'editor_preview': return kind === 'file_path';
  }
}

export function parseAskFlowerContextActionEnvelope(value: unknown): ContextActionEnvelope | null {
  if (!isRecord(value)) return null;
  if (value.schema_version !== CONTEXT_ACTION_SCHEMA_VERSION || value.action_id !== 'assistant.ask.flower' || value.provider !== 'flower') return null;
  if (!isRecord(value.target) || !validNonEmptyString(value.target.target_id) || !isStringMember(value.target.locality, ASK_FLOWER_LOCALITIES)) return null;
  if (!isRecord(value.source) || !isStringMember(value.source.surface, ASK_FLOWER_SURFACES)) return null;
  const surfaceID = optionalString(value.source, 'surface_id');
  if (surfaceID === null) return null;
  if (value.execution_context !== undefined && !isRecord(value.execution_context)) return null;
  const execution = value.execution_context as Record<string, unknown> | undefined;
  if (execution) {
    for (const key of ['current_target_id', 'source_env_public_id'] as const) {
      if (optionalString(execution, key) === null) return null;
    }
    if (execution.runtime_hint !== undefined && !isStringMember(execution.runtime_hint, ASK_FLOWER_RUNTIME_HINTS)) return null;
    if (execution.session_source !== undefined && !isStringMember(execution.session_source, ASK_FLOWER_SESSION_SOURCES)) return null;
  }
  if (!isRecord(value.presentation) || typeof value.presentation.label !== 'string' || typeof value.presentation.priority !== 'number' || !Number.isFinite(value.presentation.priority)) return null;
  for (const key of ['status_label', 'disabled_reason'] as const) {
    if (optionalString(value.presentation, key) === null) return null;
  }
  if (!Array.isArray(value.context) || value.context.length === 0) return null;

  const context: ContextActionContextItem[] = [];
  for (const rawItem of value.context) {
    const rawKind = isRecord(rawItem) && typeof rawItem.kind === 'string' ? rawItem.kind : '';
    if (!KNOWN_CONTEXT_KINDS.has(rawKind) || !surfaceAllowsKind(value.source.surface, rawKind)) return null;
    const item = parseContextItem(rawItem);
    if (!item) return null;
    context.push(item);
  }

  return {
    schema_version: CONTEXT_ACTION_SCHEMA_VERSION,
    action_id: 'assistant.ask.flower',
    provider: 'flower',
    target: {
      target_id: value.target.target_id.trim(),
      locality: value.target.locality,
    },
    source: {
      surface: value.source.surface,
      ...(surfaceID !== undefined ? { surface_id: surfaceID } : {}),
    },
    ...(execution ? {
      execution_context: {
        ...(typeof execution.current_target_id === 'string' ? { current_target_id: execution.current_target_id } : {}),
        ...(typeof execution.source_env_public_id === 'string' ? { source_env_public_id: execution.source_env_public_id } : {}),
        ...(isStringMember(execution.runtime_hint, ASK_FLOWER_RUNTIME_HINTS) ? { runtime_hint: execution.runtime_hint } : {}),
        ...(isStringMember(execution.session_source, ASK_FLOWER_SESSION_SOURCES) ? { session_source: execution.session_source } : {}),
      },
    } : {}),
    context,
    presentation: {
      label: value.presentation.label,
      priority: value.presentation.priority,
      ...(typeof value.presentation.status_label === 'string' ? { status_label: value.presentation.status_label } : {}),
      ...(typeof value.presentation.disabled_reason === 'string' ? { disabled_reason: value.presentation.disabled_reason } : {}),
    },
    ...(typeof value.suggested_working_dir_abs === 'string' ? { suggested_working_dir_abs: value.suggested_working_dir_abs } : {}),
  };
}

export function isAskFlowerContextActionEnvelope(value: unknown): value is ContextActionEnvelope {
  return parseAskFlowerContextActionEnvelope(value) !== null;
}

export function requireAskFlowerContextActionEnvelope(value: unknown): ContextActionEnvelope | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = parseAskFlowerContextActionEnvelope(value);
  if (parsed) return parsed;
  throw new Error('Invalid Flower context action.');
}

export function createCurrentRuntimeTarget(locality: ContextActionLocality = 'auto'): ContextActionTarget {
  return { target_id: 'current', locality };
}
