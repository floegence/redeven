export const LOAD_DESKTOP_FLOWER_HOST_SETTINGS_CHANNEL = 'redeven-desktop:flower-host-settings-load';
export const SAVE_DESKTOP_FLOWER_HOST_SETTINGS_CHANNEL = 'redeven-desktop:flower-host-settings-save';
export const LIST_DESKTOP_FLOWER_HOST_THREADS_CHANNEL = 'redeven-desktop:flower-host-threads-list';
export const LOAD_DESKTOP_FLOWER_HOST_THREAD_CHANNEL = 'redeven-desktop:flower-host-thread-load';
export const RENAME_DESKTOP_FLOWER_HOST_THREAD_CHANNEL = 'redeven-desktop:flower-host-thread-rename';
export const SET_DESKTOP_FLOWER_HOST_THREAD_PINNED_CHANNEL = 'redeven-desktop:flower-host-thread-pinned-set';
export const FORK_DESKTOP_FLOWER_HOST_THREAD_CHANNEL = 'redeven-desktop:flower-host-thread-fork';
export const SEND_DESKTOP_FLOWER_HOST_CHAT_CHANNEL = 'redeven-desktop:flower-host-chat-send';
export const SUBMIT_DESKTOP_FLOWER_HOST_INPUT_CHANNEL = 'redeven-desktop:flower-host-input-submit';
export const RESOLVE_DESKTOP_FLOWER_HOST_HANDLER_CHANNEL = 'redeven-desktop:flower-host-handler-resolve';

export type DesktopFlowerHostProviderType =
  | 'openai'
  | 'anthropic'
  | 'moonshot'
  | 'chatglm'
  | 'deepseek'
  | 'qwen'
  | 'openai_compatible';

export type DesktopFlowerHostSecretMode = 'keep' | 'replace' | 'clear';

export type DesktopFlowerHostWebSearchMode = 'disabled' | 'openai_builtin' | 'brave';

export type DesktopFlowerHostWebSearch = Readonly<{
  mode: DesktopFlowerHostWebSearchMode;
}>;

export type DesktopFlowerHostProviderModel = Readonly<{
  model_name: string;
  context_window?: number;
  max_output_tokens?: number;
  effective_context_window_percent?: number;
  input_modalities?: readonly string[];
}>;

export type DesktopFlowerHostProvider = Readonly<{
  id: string;
  name?: string;
  type: DesktopFlowerHostProviderType;
  base_url?: string;
  web_search?: DesktopFlowerHostWebSearch;
  models: readonly DesktopFlowerHostProviderModel[];
}>;

export type DesktopFlowerHostProviderDraft = DesktopFlowerHostProvider & Readonly<{
  provider_api_key?: string;
  provider_api_key_mode?: DesktopFlowerHostSecretMode;
  web_search_api_key?: string;
  web_search_api_key_mode?: DesktopFlowerHostSecretMode;
}>;

export type DesktopFlowerHostExecutionPolicy = Readonly<{
  require_user_approval: boolean;
  block_dangerous_commands: boolean;
}>;

export type DesktopFlowerHostTerminalExecPolicy = Readonly<{
  default_timeout_ms: number;
  max_timeout_ms: number;
}>;

export type DesktopFlowerHostConfig = Readonly<{
  schema_version: 1;
  enabled: boolean;
  current_model_id: string;
  execution_policy: DesktopFlowerHostExecutionPolicy;
  terminal_exec_policy: DesktopFlowerHostTerminalExecPolicy;
  providers: readonly DesktopFlowerHostProvider[];
}>;

export type DesktopFlowerHostSettingsDraft = Readonly<{
  config: Omit<DesktopFlowerHostConfig, 'providers'> & Readonly<{
    providers: readonly DesktopFlowerHostProviderDraft[];
  }>;
}>;

export type DesktopFlowerHostProviderSecretState = Readonly<{
  provider_id: string;
  provider_api_key_configured: boolean;
  web_search_api_key_configured: boolean;
}>;

export type DesktopFlowerHostTargetCacheEntry = Readonly<{
  target_id: string;
  label: string;
  target_url: string;
  last_seen_at_unix_ms: number;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type DesktopFlowerHostDecisionScope = Readonly<{
  thread_kind: 'chat' | 'task';
  context_envelope_id?: string | null;
  client_surface: string;
  primary_target_id?: string | null;
}>;

export type DesktopFlowerHostUIChip = Readonly<{
  kind: string;
  label: string;
  tone: string;
}>;

export type DesktopFlowerHostHandlerRef = Readonly<{
  handler_id: string;
  handler_kind: 'global' | 'env_local';
  display_name: string;
  carrier_kind?: 'desktop' | 'server' | 'runtime';
  state: 'online' | 'unreachable';
  selection_source?: 'router_default' | 'user_selected';
  supports_thread_kinds: readonly string[];
  allowed_target_ids: readonly string[];
}>;

export type DesktopFlowerHostUnavailableHandler = Readonly<{
  handler_id: string;
  handler_kind: 'global' | 'env_local';
  display_name: string;
  carrier_kind?: 'desktop' | 'server' | 'runtime';
  state: 'online' | 'unreachable';
  disabled_reason: string;
}>;

export type DesktopFlowerHostPresence = Readonly<{
  schema_version: 1;
  host_id: string;
  host_kind: 'global' | 'env_local';
  carrier_kind: 'desktop' | 'server' | 'runtime';
  display_name: string;
  state: 'online' | 'unreachable';
  endpoint: Readonly<{
    visibility: string;
    base_url?: string;
  }>;
  capabilities: readonly string[];
  last_seen_at_unix_ms: number;
}>;

export type DesktopFlowerHostRouterDecision = Readonly<{
  decision_id: string;
  decision_revision: number;
  route: 'flower_host' | 'env_local' | 'blocked' | 'needs_clarification';
  reason_code: string;
  selected_handler: DesktopFlowerHostHandlerRef | null;
  available_handlers: readonly DesktopFlowerHostHandlerRef[];
  unavailable_handlers: readonly DesktopFlowerHostUnavailableHandler[];
  handler_selection: Readonly<{
    can_switch: boolean;
    lock_reason?: string | null;
    requires_user_visible_confirmation: boolean;
  }>;
  decision_scope: DesktopFlowerHostDecisionScope;
  host_presence: DesktopFlowerHostPresence;
  current_target_id?: string;
  allowed_actions: readonly string[];
  ui_chips: readonly DesktopFlowerHostUIChip[];
  primary_message?: string;
  blocker?: Readonly<{ code: string; message: string }> | null;
  created_at_unix_ms: number;
}>;

export type DesktopFlowerHostContextEnvelopeHeader = Readonly<{
  id: string;
  provider?: string;
  raw?: unknown;
}>;

export type DesktopFlowerHostResolveHandlerRequest = Readonly<{
  thread_kind?: 'chat' | 'task';
  context_envelope_id?: string | null;
  client_surface?: string;
  primary_target_id?: string | null;
  requested_handler_id?: string;
}>;

export type DesktopFlowerHostTargetCache = Readonly<{
  version: 1;
  entries: readonly DesktopFlowerHostTargetCacheEntry[];
}>;

export type DesktopFlowerHostSettingsSnapshot = Readonly<{
  config: DesktopFlowerHostConfig;
  provider_secrets: readonly DesktopFlowerHostProviderSecretState[];
  target_cache: DesktopFlowerHostTargetCache;
}>;

export type DesktopFlowerHostChatMessageRole = 'user' | 'assistant' | 'system';
export type DesktopFlowerHostChatMessageStatus = 'sending' | 'streaming' | 'error' | 'complete';
export type DesktopFlowerHostThreadStatus =
  | 'idle'
  | 'running'
  | 'waiting_user'
  | 'waiting_approval'
  | 'failed'
  | 'success'
  | 'read_only';

export type DesktopFlowerHostChatMessageBlock = Readonly<{
  type: 'markdown' | 'text' | 'thinking';
  content?: string;
}>;

export type DesktopFlowerHostChatMessage = Readonly<{
  id: string;
  role: DesktopFlowerHostChatMessageRole;
  content: string;
  status: DesktopFlowerHostChatMessageStatus;
  created_at_ms: number;
  blocks?: readonly DesktopFlowerHostChatMessageBlock[];
}>;

export type DesktopFlowerHostThreadError = Readonly<{
  message: string;
  code?: string;
}>;

export type DesktopFlowerHostToolActivityStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'success'
  | 'error'
  | 'canceled';

export type DesktopFlowerHostToolActivity = Readonly<{
  run_id?: string;
  tool_id: string;
  tool_name: string;
  status: DesktopFlowerHostToolActivityStatus;
  summary: string;
  requires_approval?: boolean;
  approval_state?: string;
  error_message?: string;
  started_at_ms?: number;
  ended_at_ms?: number;
}>;

export type DesktopFlowerHostInputAction = Readonly<{
  type: string;
  mode?: string;
}>;

export type DesktopFlowerHostInputChoice = Readonly<{
  choice_id: string;
  label: string;
  description?: string;
  kind: 'select';
  input_placeholder?: string;
  actions?: readonly DesktopFlowerHostInputAction[];
}>;

export type DesktopFlowerHostInputQuestion = Readonly<{
  id: string;
  header: string;
  question: string;
  is_secret?: boolean;
  response_mode: 'select' | 'write' | 'select_or_write';
  choices_exhaustive?: boolean;
  write_label?: string;
  write_placeholder?: string;
  choices?: readonly DesktopFlowerHostInputChoice[];
}>;

export type DesktopFlowerHostInputRequest = Readonly<{
  prompt_id: string;
  message_id: string;
  tool_id: string;
  tool_name: string;
  reason_code?: string;
  required_from_user?: readonly string[];
  evidence_refs?: readonly string[];
  questions: readonly DesktopFlowerHostInputQuestion[];
  public_summary?: string;
  contains_secret?: boolean;
}>;

export type DesktopFlowerHostInputAnswer = Readonly<{
  choice_id?: string;
  text?: string;
}>;

export type DesktopFlowerHostSubmitInputRequest = Readonly<{
  thread_id: string;
  prompt_id: string;
  answers: Readonly<Record<string, DesktopFlowerHostInputAnswer>>;
}>;

export type DesktopFlowerHostThread = Readonly<{
  thread_id: string;
  title: string;
  model_id: string;
  working_dir: string;
  pinned_at_ms?: number;
  created_at_ms: number;
  updated_at_ms: number;
  status: DesktopFlowerHostThreadStatus;
  home_host_id?: string;
  home_host_kind?: 'global' | 'env_local';
  source_label: string;
  target_labels: readonly string[];
  messages: readonly DesktopFlowerHostChatMessage[];
  tool_activity?: readonly DesktopFlowerHostToolActivity[];
  input_request?: DesktopFlowerHostInputRequest | null;
  error?: DesktopFlowerHostThreadError | null;
  has_unread?: boolean;
}>;

export type DesktopFlowerHostRenameThreadRequest = Readonly<{
  thread_id: string;
  title: string;
}>;

export type DesktopFlowerHostSetThreadPinnedRequest = Readonly<{
  thread_id: string;
  pinned: boolean;
}>;

export type DesktopFlowerHostForkThreadRequest = Readonly<{
  thread_id: string;
}>;

export type DesktopFlowerHostSendChatRequest = Readonly<{
  thread_id?: string;
  prompt: string;
  reply_mode?: 'await' | 'background';
  decision_id?: string;
  decision_revision?: number;
  selected_handler_id?: string;
  thread_kind?: 'chat' | 'task';
  primary_target_id?: string | null;
  context_envelope?: DesktopFlowerHostContextEnvelopeHeader | null;
  client_surface?: string;
  context_action?: unknown;
}>;

export type DesktopFlowerHostError = Readonly<{
  code: string;
  message: string;
}>;

export type DesktopFlowerHostFailure = Readonly<{
  ok: false;
  error: DesktopFlowerHostError;
}>;

export type ListDesktopFlowerHostThreadsResult = Readonly<
  | {
      ok: true;
      threads: readonly DesktopFlowerHostThread[];
    }
  | DesktopFlowerHostFailure
>;

export type LoadDesktopFlowerHostThreadResult = Readonly<
  | {
      ok: true;
      thread: DesktopFlowerHostThread;
    }
  | DesktopFlowerHostFailure
>;

export type RenameDesktopFlowerHostThreadResult = Readonly<
  | {
      ok: true;
      thread: DesktopFlowerHostThread;
    }
  | DesktopFlowerHostFailure
>;

export type SetDesktopFlowerHostThreadPinnedResult = Readonly<
  | {
      ok: true;
      thread: DesktopFlowerHostThread;
    }
  | DesktopFlowerHostFailure
>;

export type ForkDesktopFlowerHostThreadResult = Readonly<
  | {
      ok: true;
      thread: DesktopFlowerHostThread;
    }
  | DesktopFlowerHostFailure
>;

export type SendDesktopFlowerHostChatResult = Readonly<
  | {
      ok: true;
      thread: DesktopFlowerHostThread;
    }
  | {
      ok: false;
      error: DesktopFlowerHostError;
      fresh_decision: DesktopFlowerHostRouterDecision;
    }
  | DesktopFlowerHostFailure
>;

export type SubmitDesktopFlowerHostInputResult = Readonly<
  | {
      ok: true;
      thread: DesktopFlowerHostThread;
    }
  | DesktopFlowerHostFailure
>;

export type LoadDesktopFlowerHostSettingsResult = Readonly<
  | {
      ok: true;
      snapshot: DesktopFlowerHostSettingsSnapshot;
    }
  | DesktopFlowerHostFailure
>;

export type ResolveDesktopFlowerHostHandlerResult = Readonly<
  | {
      ok: true;
      decision: DesktopFlowerHostRouterDecision;
    }
  | DesktopFlowerHostFailure
>;

export type SaveDesktopFlowerHostSettingsResult = Readonly<
  | {
      ok: true;
      snapshot: DesktopFlowerHostSettingsSnapshot;
    }
  | DesktopFlowerHostFailure
>;

export function normalizeDesktopFlowerHostSecretMode(
  value: unknown,
  fallback: DesktopFlowerHostSecretMode = 'replace',
): DesktopFlowerHostSecretMode {
  return value === 'keep' || value === 'replace' || value === 'clear' ? value : fallback;
}
