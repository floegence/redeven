export type FlowerProviderType =
  | 'openai'
  | 'anthropic'
  | 'moonshot'
  | 'chatglm'
  | 'deepseek'
  | 'qwen'
  | 'openai_compatible';

export type FlowerProviderSecretMode = 'keep' | 'replace' | 'clear';
export type FlowerWebSearchMode = 'disabled' | 'openai_builtin' | 'brave';

export type FlowerProviderModel = Readonly<{
  model_name: string;
  context_window?: number;
  max_output_tokens?: number;
  effective_context_window_percent?: number;
  input_modalities?: readonly string[];
}>;

export type FlowerProvider = Readonly<{
  id: string;
  name?: string;
  type: FlowerProviderType;
  base_url?: string;
  web_search?: Readonly<{ mode: FlowerWebSearchMode }>;
  models: readonly FlowerProviderModel[];
}>;

export type FlowerProviderDraft = FlowerProvider & Readonly<{
  provider_api_key?: string;
  provider_api_key_mode?: FlowerProviderSecretMode;
  web_search_api_key?: string;
  web_search_api_key_mode?: FlowerProviderSecretMode;
}>;

export type FlowerExecutionPolicy = Readonly<{
  require_user_approval: boolean;
  block_dangerous_commands: boolean;
}>;

export type FlowerTerminalExecPolicy = Readonly<{
  default_timeout_ms: number;
  max_timeout_ms: number;
}>;

export type FlowerHostConfig = Readonly<{
  schema_version: 1;
  enabled: boolean;
  current_model_id: string;
  execution_policy: FlowerExecutionPolicy;
  terminal_exec_policy: FlowerTerminalExecPolicy;
  providers: readonly FlowerProvider[];
}>;

export type FlowerSettingsDraft = Readonly<{
  config: Omit<FlowerHostConfig, 'providers'> & Readonly<{
    providers: readonly FlowerProviderDraft[];
  }>;
}>;

export type FlowerProviderSecretState = Readonly<{
  provider_id: string;
  provider_api_key_configured: boolean;
  web_search_api_key_configured: boolean;
}>;

export type FlowerTargetView = Readonly<{
  target_id: string;
  label: string;
  target_url: string;
  last_seen_at_unix_ms: number;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type FlowerTargetCache = Readonly<{
  version: 1;
  entries: readonly FlowerTargetView[];
}>;

export type FlowerSettingsSnapshot = Readonly<{
  config: FlowerHostConfig;
  provider_secrets: readonly FlowerProviderSecretState[];
  target_cache: FlowerTargetCache;
}>;

export type FlowerChatMessageRole = 'user' | 'assistant' | 'system';

export type FlowerChatMessageStatus = 'sending' | 'streaming' | 'error' | 'complete';

export type FlowerChatMessageBlock = Readonly<{
  type: 'markdown' | 'text' | 'thinking';
  content?: string;
}>;

export type FlowerChatMessage = Readonly<{
  id: string;
  role: FlowerChatMessageRole;
  content: string;
  status: FlowerChatMessageStatus;
  created_at_ms: number;
  blocks?: readonly FlowerChatMessageBlock[];
}>;

export type FlowerThreadStatus =
  | 'idle'
  | 'running'
  | 'waiting_user'
  | 'waiting_approval'
  | 'failed'
  | 'success'
  | 'read_only';

export type FlowerThreadError = Readonly<{
  message: string;
  code?: string;
}>;

export type FlowerToolActivityStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'success'
  | 'error'
  | 'canceled';

export type FlowerToolActivity = Readonly<{
  run_id?: string;
  tool_id: string;
  tool_name: string;
  status: FlowerToolActivityStatus;
  summary: string;
  requires_approval?: boolean;
  approval_state?: string;
  error_message?: string;
  started_at_ms?: number;
  ended_at_ms?: number;
}>;

export type FlowerInputRequestAction = Readonly<{
  type: string;
  mode?: string;
}>;

export type FlowerInputRequestChoice = Readonly<{
  choice_id: string;
  label: string;
  description?: string;
  kind: 'select' | 'write';
  input_placeholder?: string;
  actions?: readonly FlowerInputRequestAction[];
}>;

export type FlowerInputRequestQuestion = Readonly<{
  id: string;
  header: string;
  question: string;
  is_secret?: boolean;
  response_mode: 'select' | 'write' | 'select_or_write';
  choices_exhaustive?: boolean;
  write_label?: string;
  write_placeholder?: string;
  choices?: readonly FlowerInputRequestChoice[];
}>;

export type FlowerInputRequest = Readonly<{
  prompt_id: string;
  message_id: string;
  tool_id: string;
  tool_name: string;
  reason_code?: string;
  required_from_user?: readonly string[];
  evidence_refs?: readonly string[];
  questions: readonly FlowerInputRequestQuestion[];
  public_summary?: string;
  contains_secret?: boolean;
}>;

export type FlowerInputAnswer = Readonly<{
  choice_id?: string;
  text?: string;
}>;

export type FlowerSubmitInputRequest = Readonly<{
  thread_id: string;
  prompt_id: string;
  answers: Readonly<Record<string, FlowerInputAnswer>>;
}>;

export type FlowerThreadSnapshot = Readonly<{
  thread_id: string;
  title: string;
  model_id: string;
  home_host_id?: string;
  home_host_kind?: 'global' | 'env_local';
  origin_env_public_id?: string;
  primary_target_id?: string;
  active_target_ids?: readonly string[];
  created_at_ms: number;
  updated_at_ms: number;
  status: FlowerThreadStatus;
  source_label: string;
  target_labels: readonly string[];
  messages: readonly FlowerChatMessage[];
  tool_activity?: readonly FlowerToolActivity[];
  input_request?: FlowerInputRequest | null;
  error?: FlowerThreadError | null;
}>;

export type FlowerThreadListItem = Readonly<{
  thread_id: string;
  title: string;
  model_id: string;
  created_at_ms: number;
  updated_at_ms: number;
  preview: string;
  status: FlowerThreadStatus;
  source_label: string;
  target_labels: readonly string[];
  read_only_reason?: string;
}>;

export type FlowerHandlerRef = Readonly<{
  handler_id: string;
  handler_kind: 'global' | 'env_local';
  display_name: string;
  carrier_kind?: 'desktop' | 'server' | 'runtime';
  state: 'online' | 'unreachable';
  selection_source?: 'router_default' | 'user_selected';
  supports_thread_kinds: readonly string[];
  allowed_target_ids: readonly string[];
}>;

export type FlowerUnavailableHandler = Readonly<{
  handler_id: string;
  handler_kind: 'global' | 'env_local';
  display_name: string;
  carrier_kind?: 'desktop' | 'server' | 'runtime';
  state: 'online' | 'unreachable';
  disabled_reason: string;
}>;

export type FlowerHostPresence = Readonly<{
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

export type FlowerRouterDecision = Readonly<{
  decision_id: string;
  decision_revision: number;
  route: 'flower_host' | 'env_local' | 'blocked' | 'needs_clarification';
  reason_code: string;
  selected_handler: FlowerHandlerRef | null;
  available_handlers: readonly FlowerHandlerRef[];
  unavailable_handlers: readonly FlowerUnavailableHandler[];
  handler_selection: Readonly<{
    can_switch: boolean;
    lock_reason?: string | null;
    requires_user_visible_confirmation: boolean;
  }>;
  decision_scope: Readonly<{
    thread_kind: 'chat' | 'task';
    context_envelope_id?: string | null;
    client_surface: string;
    primary_target_id?: string | null;
  }>;
  host_presence: FlowerHostPresence;
  current_target_id?: string;
  allowed_actions: readonly string[];
  ui_chips: readonly Readonly<{ kind: string; label: string; tone: string }>[];
  primary_message?: string;
  blocker?: Readonly<{ code: string; message: string }> | null;
  created_at_unix_ms: number;
}>;

export type FlowerResolveHandlerInput = Readonly<{
  thread_kind?: 'chat' | 'task';
  context_envelope_id?: string | null;
  client_surface?: string;
  primary_target_id?: string | null;
  requested_handler_id?: string;
}>;

export type FlowerSendMessageInput = Readonly<{
  thread_id?: string;
  prompt: string;
  decision?: FlowerRouterDecision | null;
}>;

export type FlowerSendMessageFailure = Error & Readonly<{
  fresh_decision?: FlowerRouterDecision;
}>;

export type FlowerSurfaceHostDescriptor = Readonly<{
  host_id: string;
  host_kind: 'global' | 'env_local';
  carrier_kind: 'desktop' | 'server' | 'runtime';
  display_name: string;
  subtitle: string;
}>;

export type FlowerSurfaceAdapter = Readonly<{
  host: FlowerSurfaceHostDescriptor;
  loadSettings: () => Promise<FlowerSettingsSnapshot>;
  saveSettings: (draft: FlowerSettingsDraft) => Promise<FlowerSettingsSnapshot>;
  listThreads: () => Promise<readonly FlowerThreadSnapshot[]>;
  loadThread?: (threadID: string) => Promise<FlowerThreadSnapshot>;
  resolveHandler: (input?: FlowerResolveHandlerInput) => Promise<FlowerRouterDecision>;
  sendMessage: (input: FlowerSendMessageInput) => Promise<FlowerThreadSnapshot>;
  submitInput: (input: FlowerSubmitInputRequest) => Promise<FlowerThreadSnapshot>;
}>;
