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
      kind: 'file_selection';
      path: string;
      selection: string;
      selection_chars: number;
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
      platform?: string;
      captured_at_ms?: number;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringMember(value: unknown, choices: readonly string[]): boolean {
  return typeof value === 'string' && choices.includes(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isAskFlowerTarget(value: unknown): value is ContextActionTarget {
  return isRecord(value)
    && typeof value.target_id === 'string'
    && value.target_id.trim().length > 0
    && isStringMember(value.locality, ASK_FLOWER_LOCALITIES);
}

function isAskFlowerSource(value: unknown): value is ContextActionSource {
  return isRecord(value)
    && isStringMember(value.surface, ASK_FLOWER_SURFACES)
    && isOptionalString(value.surface_id);
}

function isAskFlowerExecutionContext(value: unknown): value is ContextActionExecutionContext {
  if (value === undefined) return true;
  return isRecord(value)
    && isOptionalString(value.current_target_id)
    && isOptionalString(value.source_env_public_id)
    && (value.runtime_hint === undefined || isStringMember(value.runtime_hint, ASK_FLOWER_RUNTIME_HINTS))
    && (value.session_source === undefined || isStringMember(value.session_source, ASK_FLOWER_SESSION_SOURCES));
}

function isAskFlowerContextItem(value: unknown): value is ContextActionContextItem {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'file_path':
      return typeof value.path === 'string'
        && typeof value.is_directory === 'boolean'
        && isOptionalString(value.root_label);
    case 'file_selection':
      return typeof value.path === 'string'
        && typeof value.selection === 'string'
        && typeof value.selection_chars === 'number';
    case 'terminal_selection':
      return typeof value.working_dir === 'string'
        && typeof value.selection === 'string'
        && typeof value.selection_chars === 'number';
    case 'process_snapshot':
      return typeof value.pid === 'number'
        && typeof value.name === 'string'
        && typeof value.username === 'string'
        && typeof value.cpu_percent === 'number'
        && typeof value.memory_bytes === 'number'
        && isOptionalString(value.platform)
        && (value.captured_at_ms === undefined || typeof value.captured_at_ms === 'number');
    case 'text_snapshot':
      return typeof value.title === 'string'
        && isOptionalString(value.detail)
        && typeof value.content === 'string';
    default:
      return false;
  }
}

function isAskFlowerPresentation(value: unknown): value is ContextActionPresentation {
  return isRecord(value)
    && typeof value.label === 'string'
    && typeof value.priority === 'number'
    && isOptionalString(value.status_label)
    && isOptionalString(value.disabled_reason);
}

export function createCurrentRuntimeTarget(locality: ContextActionLocality = 'auto'): ContextActionTarget {
  return {
    target_id: 'current',
    locality,
  };
}

export function isAskFlowerContextActionEnvelope(value: unknown): value is ContextActionEnvelope {
  if (!value || typeof value !== 'object') return false;
  const action = value as Partial<ContextActionEnvelope>;
  return action.schema_version === CONTEXT_ACTION_SCHEMA_VERSION
    && action.action_id === 'assistant.ask.flower'
    && action.provider === 'flower'
    && Array.isArray(action.context)
    && action.context.every((item) => isAskFlowerContextItem(item))
    && isAskFlowerTarget(action.target)
    && isAskFlowerSource(action.source)
    && isAskFlowerExecutionContext(action.execution_context)
    && isAskFlowerPresentation(action.presentation);
}

export function requireAskFlowerContextActionEnvelope(value: unknown): ContextActionEnvelope | undefined {
  if (value === undefined || value === null) return undefined;
  if (isAskFlowerContextActionEnvelope(value)) return value;
  throw new Error('Invalid Flower context action.');
}
