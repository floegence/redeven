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

export type FlowerChatMessage = Readonly<{
  id: string;
  role: FlowerChatMessageRole;
  content: string;
  created_at_ms: number;
}>;

export type FlowerThreadStatus =
  | 'idle'
  | 'running'
  | 'waiting_user'
  | 'waiting_approval'
  | 'failed'
  | 'success'
  | 'read_only';

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
  status?: FlowerThreadStatus;
  source_label?: string;
  target_labels?: readonly string[];
  messages: readonly FlowerChatMessage[];
}>;

export type FlowerThreadListItem = Readonly<{
  thread_id: string;
  title: string;
  model_id: string;
  updated_at_ms: number;
  preview: string;
  status: FlowerThreadStatus;
  source_label?: string;
  target_labels?: readonly string[];
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

export type FlowerRouterDecision = Readonly<{
  decision_id: string;
  decision_revision: number;
  route: 'flower_host' | 'env_local' | 'blocked' | 'needs_clarification';
  reason_code: string;
  selected_handler: FlowerHandlerRef | null;
  available_handlers: readonly FlowerHandlerRef[];
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
  ui_chips: readonly Readonly<{ kind: string; label: string; tone: string }>[];
  blocker?: Readonly<{ code: string; message: string }> | null;
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
}>;
