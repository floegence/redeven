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
  session_source?: 'local_runtime' | 'provider_environment' | 'ssh_environment' | 'external_local_ui' | 'region_sandbox';
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

export function createCurrentRuntimeTarget(locality: ContextActionLocality = 'auto'): ContextActionTarget {
  return {
    target_id: 'current',
    locality,
  };
}
