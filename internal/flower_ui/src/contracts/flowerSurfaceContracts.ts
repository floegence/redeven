export type FlowerProviderType =
  | 'openai'
  | 'anthropic'
  | 'moonshot'
  | 'chatglm'
  | 'deepseek'
  | 'qwen'
  | 'openai_compatible';

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
  provider_api_key?: string | null;
  web_search_api_key?: string | null;
}>;

export type FlowerExecutionPolicy = Readonly<{
  require_user_approval: boolean;
  block_dangerous_commands: boolean;
}>;

export type FlowerTerminalExecPolicy = Readonly<{
  default_timeout_ms: number;
  max_timeout_ms: number;
}>;

export type FlowerConfig = Readonly<{
  schema_version: 1;
  current_model_id: string;
  execution_policy: FlowerExecutionPolicy;
  terminal_exec_policy: FlowerTerminalExecPolicy;
  providers: readonly FlowerProvider[];
}>;

export type FlowerSettingsDraft = Readonly<{
  config: Omit<FlowerConfig, 'providers'> & Readonly<{
    providers: readonly FlowerProviderDraft[];
  }>;
}>;

export type FlowerProviderSecretState = Readonly<{
  provider_id: string;
  provider_api_key_configured: boolean;
  web_search_api_key_configured: boolean;
}>;

export type FlowerModelSourceStatus = Readonly<{
  kind: 'desktop_model_source';
  ready: boolean;
  label?: string;
  model_count?: number;
  missing_key_provider_ids?: readonly string[];
  last_error?: string;
}>;

export type FlowerSettingsSnapshot = Readonly<{
  config: FlowerConfig;
  provider_secrets: readonly FlowerProviderSecretState[];
  model_source?: FlowerModelSourceStatus;
}>;

export type FlowerChatMessageRole = 'user' | 'assistant' | 'system';

export type FlowerChatMessageStatus = 'sending' | 'streaming' | 'error' | 'complete';

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
  | 'canceled'
  | 'read_only';

export type FlowerThreadError = Readonly<{
  message: string;
  code?: string;
}>;

export type FlowerActivityStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'success'
  | 'error'
  | 'canceled';

export type FlowerActivityKind = 'tool' | 'hosted_tool' | 'approval' | 'control' | 'budget';
export type FlowerActivitySeverity = 'quiet' | 'normal' | 'warning' | 'error' | 'blocking';
export type FlowerActivityAttentionReason = 'running' | 'waiting' | 'approval' | 'error';
export type FlowerActivityApprovalState = 'requested' | 'approved' | 'rejected' | 'timed_out' | 'canceled';
export type FlowerActivityRenderer = 'structured' | 'terminal' | 'file' | 'patch' | 'web_search' | 'todos' | 'question' | 'completion';

export type FlowerActivityChip = Readonly<{
  kind: string;
  label: string;
  value?: string;
  tone?: string;
}>;

export type FlowerActivityTargetRef = Readonly<{
  kind: string;
  label: string;
  uri?: string;
  line?: number;
}>;

export type FlowerActivityItem = Readonly<{
  item_id: string;
  tool_id?: string;
  tool_name?: string;
  kind: FlowerActivityKind;
  status: FlowerActivityStatus;
  severity: FlowerActivitySeverity;
  needs_attention: boolean;
  attention_reasons?: readonly FlowerActivityAttentionReason[];
  requires_approval: boolean;
  approval_state?: FlowerActivityApprovalState;
  started_at_unix_ms?: number;
  ended_at_unix_ms?: number;
  label?: string;
  description?: string;
  renderer?: FlowerActivityRenderer;
  chips?: readonly FlowerActivityChip[];
  target_refs?: readonly FlowerActivityTargetRef[];
  payload?: Readonly<Record<string, unknown>>;
  metadata?: Readonly<Record<string, string>>;
}>;

export type FlowerActivityFileAction = Readonly<{
  action_id: string;
  display_name: string;
  can_preview: boolean;
  can_browse_directory: boolean;
}>;

export type FlowerActivityTimelineBlock = Readonly<{
  type: 'activity-timeline';
  schema_version: number;
  run_id?: string;
  thread_id?: string;
  turn_id?: string;
  trace_id?: string;
  summary: Readonly<{
    status: FlowerActivityStatus;
    severity: FlowerActivitySeverity;
    needs_attention: boolean;
    attention_reasons?: readonly FlowerActivityAttentionReason[];
    total_items: number;
    counts: Readonly<{
      pending?: number;
      running?: number;
      waiting?: number;
      success?: number;
      error?: number;
      canceled?: number;
      approval?: number;
    }>;
    duration_ms?: number;
  }>;
  items: readonly FlowerActivityItem[];
  file_actions?: Readonly<Record<string, FlowerActivityFileAction>>;
}>;

export type FlowerChatMessageBlock =
  | Readonly<{
    type: 'markdown' | 'text' | 'thinking';
    content?: string;
  }>
  | FlowerActivityTimelineBlock;

export type FlowerInputRequestAction = Readonly<{
  type: string;
  mode?: string;
}>;

export type FlowerInputRequestChoice = Readonly<{
  choice_id: string;
  label: string;
  description?: string;
  kind: 'select';
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

export type FlowerThreadActivitySnapshot = Readonly<{
  activity_revision: number;
  last_message_at_unix_ms: number;
  activity_signature: string;
  waiting_prompt_id?: string;
}>;

export type FlowerThreadReadState = Readonly<{
  last_seen_activity_revision: number;
  last_read_message_at_unix_ms: number;
  last_seen_activity_signature: string;
  last_seen_waiting_prompt_id?: string;
}>;

export type FlowerThreadReadStatus = Readonly<{
  is_unread: boolean;
  snapshot: FlowerThreadActivitySnapshot;
  read_state: FlowerThreadReadState;
}>;

export type FlowerThreadSnapshot = Readonly<{
  thread_id: string;
  title: string;
  model_id: string;
  working_dir: string;
  pinned_at_ms?: number;
  home_runtime_id?: string;
  home_runtime_kind?: 'local_environment' | 'env_local';
  origin_env_public_id?: string;
  created_at_ms: number;
  updated_at_ms: number;
  status: FlowerThreadStatus;
  source_label: string;
  target_labels: readonly string[];
  messages: readonly FlowerChatMessage[];
  input_request?: FlowerInputRequest | null;
  error?: FlowerThreadError | null;
  read_status: FlowerThreadReadStatus;
}>;

export type FlowerThreadListItem = Readonly<{
  thread_id: string;
  title: string;
  model_id: string;
  working_dir: string;
  pinned: boolean;
  pinned_at_ms?: number;
  created_at_ms: number;
  updated_at_ms: number;
  preview: string;
  status: FlowerThreadStatus;
  source_label: string;
  target_labels: readonly string[];
  read_only_reason?: string;
  read_status: FlowerThreadReadStatus;
}>;

export type FlowerHandlerRef = Readonly<{
  handler_id: string;
  handler_kind: 'local_environment' | 'env_local';
  display_name: string;
  carrier_kind?: 'desktop' | 'server' | 'runtime';
  state: 'online' | 'unreachable';
  selection_source?: 'router_default' | 'user_selected';
  supports_thread_kinds: readonly string[];
}>;

export type FlowerUnavailableHandler = Readonly<{
  handler_id: string;
  handler_kind: 'local_environment' | 'env_local';
  display_name: string;
  carrier_kind?: 'desktop' | 'server' | 'runtime';
  state: 'online' | 'unreachable';
  disabled_reason: string;
}>;

export type FlowerRuntimePresence = Readonly<{
  schema_version: 1;
  runtime_id: string;
  runtime_kind: 'local_environment' | 'env_local';
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
  route: 'flower' | 'env_local' | 'blocked' | 'needs_clarification';
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
  }>;
  runtime_presence: FlowerRuntimePresence;
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
  requested_handler_id?: string;
}>;

export type FlowerSendMessageInput = Readonly<{
  thread_id?: string;
  prompt: string;
  decision?: FlowerRouterDecision | null;
  context_action?: unknown;
}>;

export type FlowerSendMessageFailure = Error & Readonly<{
  fresh_decision?: FlowerRouterDecision;
}>;

export type FlowerFileOpenRequest = Readonly<{
  thread_id?: string;
  message_id: string;
  block_index: number;
  item_id: string;
  action_id: string;
}>;

export type FlowerSurfaceRuntimeDescriptor = Readonly<{
  runtime_id: string;
  runtime_kind: 'local_environment' | 'env_local';
  carrier_kind: 'desktop' | 'server' | 'runtime';
  display_name: string;
  subtitle: string;
}>;

export type FlowerSurfaceAdapter = Readonly<{
  runtime: FlowerSurfaceRuntimeDescriptor;
  loadSettings: () => Promise<FlowerSettingsSnapshot>;
  saveSettings: (draft: FlowerSettingsDraft) => Promise<FlowerSettingsSnapshot>;
  listThreads: () => Promise<readonly FlowerThreadSnapshot[]>;
  loadThread?: (threadID: string) => Promise<FlowerThreadSnapshot>;
  markThreadRead: (threadID: string, snapshot: FlowerThreadActivitySnapshot) => Promise<FlowerThreadSnapshot>;
  renameThread?: (threadID: string, title: string) => Promise<FlowerThreadSnapshot>;
  setThreadPinned?: (threadID: string, pinned: boolean) => Promise<FlowerThreadSnapshot>;
  forkThread?: (threadID: string) => Promise<FlowerThreadSnapshot>;
  resolveHandler: (input?: FlowerResolveHandlerInput) => Promise<FlowerRouterDecision>;
  sendMessage: (input: FlowerSendMessageInput) => Promise<FlowerThreadSnapshot>;
  submitInput: (input: FlowerSubmitInputRequest) => Promise<FlowerThreadSnapshot>;
  openFileBrowser?: (request: FlowerFileOpenRequest) => Promise<void>;
  openFilePreview?: (request: FlowerFileOpenRequest) => Promise<void>;
}>;

export type FlowerSurfaceDraftIntent = Readonly<{
  id: string;
  thread_id?: string;
  prompt: string;
  context_action?: unknown;
}>;
