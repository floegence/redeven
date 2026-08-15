export type FlowerProviderType =
  | 'openai'
  | 'anthropic'
  | 'moonshot'
  | 'chatglm'
  | 'deepseek'
  | 'qwen'
  | 'openrouter'
  | 'xai'
  | 'groq'
  | 'ollama'
  | 'openai_compatible';

export type FlowerWebSearchMode = 'disabled' | 'openai_builtin' | 'brave';

export type FlowerReasoningLevel = 'default' | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type FlowerReasoningSelection = Readonly<{
  level?: FlowerReasoningLevel;
  budget_tokens?: number;
}>;

export type FlowerReasoningCapability = Readonly<{
  kind?: string;
  supported_levels?: readonly FlowerReasoningLevel[];
  default_level?: FlowerReasoningLevel;
  disable_supported?: boolean;
  default_enabled?: boolean;
  wire_shape?: string;
  disable_shape?: string;
  budget_shape?: string;
  min_budget_tokens?: number;
  max_budget_tokens?: number;
  dynamic_provider_metadata?: boolean;
  response_reasoning_fields?: readonly string[];
  history_replay_requirements?: readonly string[];
  source_urls?: readonly string[];
  source_checked_at?: string;
  fixture?: string;
}>;

export type FlowerProviderModel = Readonly<{
  model_name: string;
  wire_model_name?: string;
  context_window?: number;
  max_output_tokens?: number;
  effective_context_window_percent?: number;
  input_modalities?: readonly string[];
  reasoning_capability?: FlowerReasoningCapability;
  default_reasoning_selection?: FlowerReasoningSelection;
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

export type FlowerPermissionType = 'readonly' | 'approval_required' | 'full_access';

export type FlowerModelProfile = Readonly<{
  schema_version: 1;
  current_model_id: string;
  providers: readonly FlowerProvider[];
}>;

export type FlowerSettingsDraft = Readonly<{
  model_profile: Omit<FlowerModelProfile, 'providers'> & Readonly<{
    providers: readonly FlowerProviderDraft[];
  }>;
}>;

export type FlowerProviderSecretState = Readonly<{
  provider_id: string;
  provider_api_key_configured: boolean;
  web_search_api_key_configured: boolean;
}>;

export type FlowerModelSourceModel = Readonly<{
  id: string;
  label: string;
  context_window?: number;
  max_output_tokens?: number;
  input_modalities?: readonly string[];
  reasoning_capability?: FlowerReasoningCapability;
}>;

export type FlowerModelSourceStatus =
  | Readonly<{
      kind: 'desktop_model_source';
      state: 'ready';
      label: 'Desktop';
      models: readonly [FlowerModelSourceModel, ...FlowerModelSourceModel[]];
      current_model_id?: string;
    }>
  | Readonly<{
      kind: 'desktop_model_source';
      state: 'missing_keys';
      label: 'Desktop';
      missing_key_provider_ids: readonly string[];
    }>
  | Readonly<{
      kind: 'desktop_model_source';
      state: 'empty';
      label: 'Desktop';
    }>
  | Readonly<{
      kind: 'desktop_model_source';
      state: 'connecting' | 'unbound' | 'expired' | 'unsupported';
      label: 'Desktop';
    }>
  | Readonly<{
      kind: 'desktop_model_source';
      state: 'error';
      label: 'Desktop';
      diagnostic_message?: string;
    }>;

export type FlowerSurfaceAction = Readonly<{
  label: string;
  run: () => Promise<void>;
}>;

export type FlowerModelSourceRecovery = Readonly<{
  describe: (status: Exclude<FlowerModelSourceStatus, { state: 'ready' }>) => string;
  localSettings: FlowerSurfaceAction;
  runtimeSettings: FlowerSurfaceAction;
  connectionCenter: FlowerSurfaceAction;
}>;

export type FlowerSettingsSnapshot = Readonly<{
  defaults: Readonly<{
    permission_type: FlowerPermissionType;
  }>;
  model_profile: FlowerModelProfile | null;
  provider_secrets: readonly FlowerProviderSecretState[];
  model_source?: FlowerModelSourceStatus;
}>;

export type FlowerChatMessageRole = 'user' | 'assistant' | 'system';

export type FlowerChatMessageStatus = 'sending' | 'streaming' | 'error' | 'complete' | 'canceled';

export type FlowerMessageReference =
  | Readonly<{ reference_id: string; kind: 'file' | 'directory'; label: string; truncated?: boolean }>
  | Readonly<{ reference_id: string; kind: 'text' | 'terminal' | 'process'; label: string; text?: string; truncated?: boolean }>;

export type FlowerChatMessage = Readonly<{
  id: string;
  // Canonical root-thread and SubAgent messages always carry turn_id. Synthetic
  // local presentation rows may omit it because they are not admission records.
  turn_id?: string;
  thread_id?: string;
  run_id?: string;
  logical_request_id?: string;
  turn_ordinal?: number;
  role: FlowerChatMessageRole;
  content: string;
  status: FlowerChatMessageStatus;
  created_at_ms: number;
  blocks?: readonly FlowerChatMessageBlock[];
  references?: readonly FlowerMessageReference[];
  /** Test and legacy input shape only; admitted messages are projected from references. */
  context_action?: unknown;
  live?: boolean;
  active_cursor?: boolean;
  attempt_epoch?: number;
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

export type FlowerTitleStatus = 'unset' | 'pending' | 'ready' | 'failed';

export type FlowerThreadError = Readonly<{
  message: string;
  code?: string;
}>;

export type FlowerModelIOPhase =
  | 'preparing'
  | 'waiting_response'
  | 'streaming'
  | 'retrying'
  | 'finalizing';

export type FlowerModelIOStatus = Readonly<{
  phase: FlowerModelIOPhase;
  run_id?: string;
  step_index?: number;
  updated_at_ms: number;
}>;

export type FlowerContextPressureStatus =
  | 'stable'
  | 'near_threshold'
  | 'will_compact'
  | 'hard_limit'
  | 'estimated';

export type FlowerContextUsagePhase = 'projected_request' | 'provider_usage';

export type FlowerContextUsage = Readonly<{
  run_id?: string;
  step_index?: number;
  phase: FlowerContextUsagePhase;
  input_tokens?: number;
  context_window_tokens?: number;
  threshold_tokens?: number;
  request_safe_limit_tokens?: number;
  output_headroom_tokens?: number;
  used_ratio?: number;
  threshold_ratio?: number;
  pressure_status: FlowerContextPressureStatus;
  source?: string;
  updated_at_ms: number;
}>;

export type FlowerContextCompactionPhase = 'start' | 'complete' | 'failed' | 'cancelled' | 'noop' | 'checkpoint';

export type FlowerContextCompactionStatus = 'compacting' | 'compacted' | 'failed' | 'cancelled' | 'noop' | 'checkpoint';

export type FlowerContextCompaction = Readonly<{
  operation_id: string;
  run_id?: string;
  step_index?: number;
  phase: FlowerContextCompactionPhase;
  status: FlowerContextCompactionStatus;
  trigger?: string;
  reason?: string;
  tokens_before?: number;
  tokens_after_estimate?: number;
  error?: string;
  updated_at_ms: number;
}>;

export type FlowerTimelineAnchorTargetKind = 'message' | 'block' | 'activity_item';

export type FlowerTimelineAnchorEdge = 'before' | 'after';

export type FlowerTimelineAnchor = Readonly<{
  target_kind: FlowerTimelineAnchorTargetKind;
  message_id: string;
  block_index?: number;
  activity_item_id?: string;
  edge: FlowerTimelineAnchorEdge;
}>;

export type FlowerContextCompactionTimelineDecoration = Readonly<{
  decoration_id: string;
  kind: 'context_compaction';
  anchor: FlowerTimelineAnchor;
  ordinal: number;
  compaction: FlowerContextCompaction;
}>;

export type FlowerTimelineDecoration = FlowerContextCompactionTimelineDecoration;

export type FlowerActivityStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'success'
  | 'error'
  | 'declined'
  | 'canceled';

export type FlowerActivityKind = 'tool' | 'hosted_tool' | 'control' | 'budget';
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
  effect_retry?: Readonly<{
    effect_attempt_id: string;
    tool_call_id: string;
  }>;
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
      declined?: number;
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
  | Readonly<{
    type: 'image';
    src: string;
    alt?: string;
  }>
  | Readonly<{
    type: 'file';
    name: string;
    size: number;
    mimeType: string;
    url: string;
  }>
  | FlowerActivityTimelineBlock;

export type FlowerInputRequestAction = Readonly<{
  type: string;
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
  reasoning_selection?: FlowerReasoningSelection;
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
  reasoning_selection?: FlowerReasoningSelection;
}>;

/** Authoritative thread view returned after a waiting prompt is consumed. */
export type FlowerSubmitInputReceipt = Readonly<{
  thread_id: string;
  consumed_prompt_id: string;
  current: FlowerRuntimeCurrentView;
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

export type FlowerQueuedTurn = Readonly<{
  queue_id: string;
  prompt: string;
  created_at_ms: number;
  attachments?: readonly FlowerQueuedTurnAttachment[];
  context_action?: unknown;
}>;

export type FlowerQueuedTurnAttachment = Readonly<{
  attachment_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  text_stats?: FlowerAttachmentTextStats;
  locator?: string;
  url?: string;
}>;

export type FlowerThreadSnapshot = Readonly<{
  thread_id: string;
  title: string;
  title_status: FlowerTitleStatus;
  model_id: string;
  working_dir: string;
  pinned_at_ms?: number;
  home_runtime_id?: string;
  home_runtime_kind?: 'local_environment' | 'env_local';
  origin_env_public_id?: string;
  created_at_ms: number;
  updated_at_ms: number;
  status: FlowerThreadStatus;
  active_run_id?: string;
  approval_pending?: boolean;
  approval_pending_count?: number;
  queued_turn_count?: number;
  queued_turns?: readonly FlowerQueuedTurn[];
  permission_type?: FlowerPermissionType;
  source_label: string;
  target_labels: readonly string[];
  read_only_reason?: string;
  parent_thread_id?: string;
  messages: readonly FlowerChatMessage[];
  model_io_status?: FlowerModelIOStatus | null;
  reasoning_selection?: FlowerReasoningSelection;
  reasoning_capability?: FlowerReasoningCapability;
  context_usage?: FlowerContextUsage | null;
  context_compactions?: readonly FlowerContextCompaction[];
  timeline_decorations?: readonly FlowerTimelineDecoration[];
  subagents?: readonly FlowerSubagentSummary[];
  approval_actions?: readonly FlowerApprovalAction[];
  input_request?: FlowerInputRequest | null;
  error?: FlowerThreadError | null;
  read_status: FlowerThreadReadStatus;
}>;

export type FlowerSubagentSummary = Readonly<{
  parent_thread_id: string;
  thread_id: string;
  task_name: string;
  task_description?: string;
  agent_type?: string;
  context_mode?: string;
  status: string;
  last_message?: string;
  waiting_prompt?: string;
  queued_inputs?: number;
  can_send_input: boolean;
  can_interrupt: boolean;
  can_close: boolean;
  created_at_ms?: number;
  updated_at_ms?: number;
}>;

export type FlowerSubagentDetailMessage = Readonly<{
  role?: string;
  text?: string;
  preview?: string;
}>;

export type FlowerSubagentToolCallView = Readonly<{
  id?: string;
  name?: string;
  args_preview?: string;
  args_hash?: string;
}>;

export type FlowerSubagentToolResultView = Readonly<{
  call_id?: string;
  tool_name?: string;
  status?: string;
  preview?: string;
  truncated?: boolean;
  original_bytes?: number;
  visible_bytes?: number;
  original_lines?: number;
  visible_lines?: number;
  strategy?: string;
  content_sha256?: string;
}>;

export type FlowerSubagentGenericView = Readonly<{
  title?: string;
  body?: string;
  metadata?: Readonly<Record<string, string>>;
}>;

export type FlowerSubagentApprovalView = Readonly<{
  state?: string;
  tool_id?: string;
  tool_name?: string;
  tool_kind?: string;
  args_hash?: string;
  reason?: string;
  metadata?: Readonly<Record<string, string>>;
}>;

export type FlowerSubagentTurnMarkerView = Readonly<{
  status?: string;
  metadata?: Readonly<Record<string, string>>;
}>;

export type FlowerSubagentCompactionView = Readonly<{
  summary_schema_version?: string;
  summary?: string;
  trigger?: string;
  reason?: string;
  phase?: string;
  tokens_before?: number;
  tokens_after_estimate?: number;
  metadata?: Readonly<Record<string, string>>;
}>;

export type FlowerSubagentTimelineRow = Readonly<{
  ordinal: number;
  kind: string;
  type?: string;
  created_at_ms: number;
  message?: FlowerSubagentDetailMessage;
  tool_call?: FlowerSubagentToolCallView;
  tool_result?: FlowerSubagentToolResultView;
  approval?: FlowerSubagentApprovalView;
  turn_marker?: FlowerSubagentTurnMarkerView;
  compaction?: FlowerSubagentCompactionView;
  generic?: FlowerSubagentGenericView;
  error?: string;
  metadata?: Readonly<Record<string, string>>;
}>;

export type FlowerSubagentDetail = Readonly<{
  summary: FlowerSubagentSummary;
  messages: readonly FlowerChatMessage[];
  timeline: readonly FlowerSubagentTimelineRow[];
  activity?: FlowerActivityTimelineBlock;
  model_io_status?: FlowerModelIOStatus | null;
  context_usage?: FlowerContextUsage | null;
  context_compactions?: readonly FlowerContextCompaction[];
  timeline_decorations?: readonly FlowerTimelineDecoration[];
  next_ordinal?: number;
  has_more?: boolean;
  retained_from?: number;
  generated_at_ms: number;
}>;

export type FlowerSafeTarget = Readonly<{
  kind: string;
  label: string;
  uri?: string;
}>;

export type FlowerApprovalOrigin = 'main_tool' | 'control_confirm' | 'delegated_subagent';

type FlowerApprovalActionBase = Readonly<{
  action_id: string;
  turn_id?: string;
  tool_name: string;
  state: 'requested' | 'approved' | 'rejected' | 'timed_out' | 'canceled' | 'unavailable';
  status: 'pending' | 'resolved' | 'unavailable';
  surface_role?: 'primary_action' | 'locator' | 'mirror';
  scope?: string;
  requested_at_ms: number;
  resolved_at_ms?: number;
  expires_at_ms?: number;
  can_approve: boolean;
  read_only_reason?: string;
  queue_order?: number;
  batch_index?: number;
  batch_size?: number;
  summary: Readonly<{
    label: string;
    description?: string;
    command?: string;
    cwd?: string;
    effects?: readonly string[];
    flags?: readonly string[];
    targets?: readonly FlowerSafeTarget[];
  }>;
}>;

export type FlowerMainToolApprovalAction = FlowerApprovalActionBase & Readonly<{
  origin: 'main_tool' | 'control_confirm';
  run_id: string;
  tool_id: string;
}>;

export type FlowerDelegatedSubagentApprovalAction = FlowerApprovalActionBase & Readonly<{
  origin: 'delegated_subagent';
  run_id: string;
  tool_id: string;
}>;

export type FlowerApprovalAction = FlowerMainToolApprovalAction | FlowerDelegatedSubagentApprovalAction;

export type FlowerLiveStreamConnectInput = Readonly<{
  signal: AbortSignal;
}>;

export type FlowerRuntimeCurrentItem = Readonly<{
  id: string;
  turn_id?: string;
  kind: 'user' | 'assistant' | 'tool' | 'interaction';
  text?: string;
  created_at?: string;
  attachments?: readonly Readonly<{
    resource_ref?: string;
    name: string;
    mime_type?: string;
    size_bytes?: number;
  }>[];
  references?: readonly Readonly<{
    reference_id: string;
    kind: 'text' | 'file' | 'directory' | 'terminal' | 'process';
    label: string;
    text?: string;
    truncated?: boolean;
  }>[];
  activity?: Readonly<Record<string, unknown>>;
  interaction?: FlowerRuntimeInteraction;
}>;

export type FlowerRuntimeInteraction = Readonly<{
  id: string;
  turn_id?: string;
  kind: 'approval' | 'input' | 'effect_retry';
  run_id?: string;
  tool_call_id?: string;
  resolved?: boolean;
  approved?: boolean;
  approval?: Readonly<{
    label: string;
    description?: string;
    command?: string;
    effects?: readonly string[];
    targets?: readonly string[];
    risk?: string;
    tool_name: string;
    tool_call_id: string;
  }>;
  input?: Readonly<{
    summary: string;
    questions: readonly Readonly<{
      id: string;
      prompt: string;
      kind: string;
      options?: readonly string[];
      write_label?: string;
      secret?: boolean;
    }>[];
  }>;
  effect_retry?: Readonly<{
    effect_attempt_id: string;
    tool_call_id: string;
    tool_name: string;
  }>;
  resolution?: Readonly<{
    accepted: boolean;
    redacted?: boolean;
    outcome?: string;
    approved?: boolean;
    input?: Readonly<Record<string, string>>;
    at?: string;
  }>;
  signal?: Readonly<{
    name?: string;
    call_id?: string;
    disposition?: string;
    text?: string;
    payload?: Readonly<Record<string, unknown>>;
  }>;
}>;

export type FlowerRuntimeCurrentView = Readonly<{
  thread_id: string;
  view_version: number;
  activity?: 'idle' | 'active';
  turn_id?: string;
  last_outcome?: 'completed' | 'failed' | 'cancelled' | 'interrupted';
  attention?: Readonly<{ approval_count?: number; input_count?: number }>;
  items?: readonly FlowerRuntimeCurrentItem[];
  queue?: readonly Readonly<{ request_key: string; input: Readonly<{ text?: string }> }>[];
  interactions?: readonly FlowerRuntimeInteraction[];
  assistant_draft?: string;
  thinking_draft?: string;
}>;

// FlowerThreadView is one replaceable detail snapshot. Its version is the
// in-memory ThreadRuntime view version, never a durable replay cursor.
export type FlowerThreadView = Readonly<{
  thread: FlowerThreadSnapshot;
  current: FlowerRuntimeCurrentView;
}>;

export type FlowerLiveStreamEnvelope = Readonly<{
  schema_version: number;
  kind: 'ready' | 'summary.batch' | 'thread.batch' | 'viewer.read_state';
  thread_id?: string;
  summaries?: readonly FlowerThreadSnapshot[];
  /** Typed current-state replacement from Floret; never contains replay metadata. */
  current?: FlowerRuntimeCurrentView;
  read_status?: FlowerThreadReadStatus;
}>;

export type FlowerSubmitApprovalRequest = Readonly<{
  thread_id: string;
  interaction_id: string;
  approved: boolean;
  reject_all?: boolean;
}>;

export type FlowerRetryEffectRequest = Readonly<{
  thread_id: string;
  effect_attempt_id: string;
  tool_call_id: string;
  acknowledge_unknown_risk: true;
}>;

export type FlowerApprovalCommandResult = Readonly<{
  ok: boolean;
  current: FlowerRuntimeCurrentView;
}>;

export type FlowerThreadListItem = Readonly<{
  thread_id: string;
  title: string;
  title_status: FlowerTitleStatus;
  model_id: string;
  working_dir: string;
  pinned: boolean;
  pinned_at_ms?: number;
  created_at_ms: number;
  updated_at_ms: number;
  preview: string;
  status: FlowerThreadStatus;
  approval_pending?: boolean;
  approval_pending_count?: number;
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

export type FlowerTurnLaunchInput = Readonly<{
  client_request_id: string;
  thread_id?: string;
  staging_scope?: FlowerAttachmentStagingScope;
  prompt: string;
  decision?: FlowerRouterDecision | null;
  context_action?: unknown;
  attachment_ids?: readonly string[];
  working_dir?: string;
  model_id?: string;
  permission_type?: FlowerPermissionType;
  reasoning_selection?: FlowerReasoningSelection;
}>;

export type FlowerTurnLaunchReceipt = Readonly<{
  client_request_id: string;
  thread_id: string;
  current: FlowerRuntimeCurrentView;
}>;

export type FlowerTurnLaunchFailure = Error & Readonly<{
  fresh_decision?: FlowerRouterDecision;
}>;

export type FlowerAttachmentSource = 'file' | 'paste' | 'drop' | 'long_text';

export type FlowerAttachmentRoute = 'native_full_content' | 'tool_read' | 'unsupported';

export type FlowerAttachmentCapability = Readonly<{
  model_id: string;
  revision: string;
  enabled: boolean;
  supports_long_text: boolean;
  max_attachments: number;
  max_file_size_bytes: number;
  max_total_size_bytes: number;
  routes: Readonly<Record<string, FlowerAttachmentRoute>>;
  expires_at_unix_ms?: number;
}>;

export type FlowerAttachmentTextStats = Readonly<{
  code_points: number;
  lines: number;
}>;

export type FlowerStagedAttachment = Readonly<{
  attachment_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  digest_sha256: string;
  locator: string;
  source: FlowerAttachmentSource;
  text_stats?: FlowerAttachmentTextStats;
  capability_revision: string;
  created_at_unix_ms?: number;
}>;

export type FlowerAttachmentStagingScope = Readonly<{
  staging_scope_id: string;
  target_id: string;
  capability: string;
  expires_at_unix_ms: number;
}>;

export type FlowerAttachmentUploadProgress = Readonly<{
  attempt_id: string;
  loaded: number;
  indeterminate: boolean;
  total?: number;
}>;

export type FlowerAttachmentUploadInput = Readonly<{
  attempt_id: string;
  request_id: string;
  staging_scope: FlowerAttachmentStagingScope;
  model_id: string;
  capability_revision: string;
  source: FlowerAttachmentSource;
  file: File;
  signal: AbortSignal;
  on_progress: (progress: FlowerAttachmentUploadProgress) => void;
}>;

export type FlowerStagedLongTextReadResult = Readonly<{
  attachment: FlowerStagedAttachment;
  text: string;
}>;

export type FlowerTurnLauncherSourceSurface =
  | 'desktop_welcome_environment_card'
  | 'file_browser'
  | 'terminal'
  | 'file_preview'
  | 'monitoring'
  | 'git_browser'
  | 'editor_preview';

export type FlowerLinkedContextSourceSurface = FlowerTurnLauncherSourceSurface | 'flower_composer';

export type FlowerTurnLauncherContextItem =
  | Readonly<{
      kind: 'environment';
      label: string;
      detail?: string;
      target_id: string;
    }>
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
      working_dir?: string;
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
    }>
  | Readonly<{
      kind: 'attachment';
      name: string;
      mime_type: string;
      source_path?: string;
    }>;

export type FlowerTurnLauncherIntent = Readonly<{
  id: string;
  source_surface: FlowerTurnLauncherSourceSurface;
  initial_prompt?: string;
  suggested_working_dir?: string;
  context_items: readonly FlowerTurnLauncherContextItem[];
  pending_attachments?: readonly File[];
  notes?: readonly string[];
  context_action?: unknown;
}>;

export type FlowerFileOpenRequest = Readonly<{
  thread_id?: string;
  message_id: string;
  block_index: number;
  item_id: string;
  action_id: string;
}>;

export type FlowerLinkedContextPathOpenRequest = Readonly<{
  path: string;
  thread_id?: string;
  message_id: string;
  context_index: number;
  source_surface: FlowerLinkedContextSourceSurface;
  target: string;
}>;

export type FlowerCanonicalReferenceOpenRequest = Readonly<{
  thread_id: string;
  turn_id: string;
  reference_id: string;
}>;

export type FlowerTerminalProcessReadRequest = Readonly<{
  run_id: string;
  process_id: string;
  after_seq: number;
}>;

export type FlowerTerminalProcessSnapshot = Readonly<{
  process_id: string;
  status: string;
  command?: string;
  cwd?: string;
  output: string;
  first_seq: number;
  last_seq: number;
  latest_seq: number;
  has_more: boolean;
  total_bytes?: number;
  truncated?: boolean;
  started_at_ms?: number;
  ended_at_ms?: number;
  duration_ms?: number;
  exit_code?: number;
  execution_location?: string;
}>;

export type FlowerWorkingDirectoryEntry = Readonly<{
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: number;
}>;

export type FlowerWorkingDirectoryPathContext = Readonly<{
  agentHomePathAbs: string;
  homePathAbs: string;
  defaultRootId: string;
  roots: readonly Readonly<{
    id: string;
    label: string;
    pathAbs: string;
    kind: string;
    permissions: Readonly<{
      read: boolean;
      write: boolean;
    }>;
    hidden?: boolean;
    system?: boolean;
  }>[];
}>;

export type FlowerWorkingDirectoryListInput = Readonly<{
  path: string;
  showHidden?: boolean;
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
  canMutate?: boolean;
  /** Keep the canonical summary stream connected while the document is hidden. */
  keepLiveWhenHidden?: boolean;
  loadSettings: () => Promise<FlowerSettingsSnapshot>;
  saveDefaultPermission: (permissionType: FlowerPermissionType) => Promise<FlowerSettingsSnapshot>;
  saveModelProfile: (draft: FlowerSettingsDraft) => Promise<FlowerSettingsSnapshot>;
  listThreads: () => Promise<readonly FlowerThreadSnapshot[]>;
  loadThread: (threadID: string) => Promise<FlowerThreadView>;
  connectLiveStream?: (input: FlowerLiveStreamConnectInput) => AsyncIterable<FlowerLiveStreamEnvelope>;
  loadSubagentDetail: (parentThreadID: string, childThreadID: string, afterOrdinal?: number, limit?: number) => Promise<FlowerSubagentDetail>;
  markThreadRead: (threadID: string, snapshot: FlowerThreadActivitySnapshot) => Promise<FlowerThreadReadStatus>;
  renameThread?: (threadID: string, title: string) => Promise<FlowerThreadView>;
  setThreadPinned?: (threadID: string, pinned: boolean) => Promise<FlowerThreadView | undefined>;
  setThreadPermissionType?: (threadID: string, permissionType: FlowerPermissionType) => Promise<FlowerThreadView>;
  persistDefaultModel: (modelID: string) => Promise<FlowerSettingsSnapshot>;
  setThreadModel?: (threadID: string, modelID: string) => Promise<FlowerThreadView>;
  setThreadReasoningSelection?: (threadID: string, selection: FlowerReasoningSelection | undefined) => Promise<FlowerThreadView>;
  reorderQueuedTurns?: (threadID: string, orderedQueueIDs: readonly string[]) => Promise<FlowerThreadView>;
  deleteQueuedTurn?: (threadID: string, queueID: string) => Promise<FlowerThreadView>;
  promoteQueuedTurn?: (threadID: string, queueID: string) => Promise<FlowerThreadView>;
  forkThread?: (threadID: string, clientRequestID: string) => Promise<FlowerThreadView>;
  deleteThread?: (threadID: string) => Promise<void>;
  resolveHandler: (input?: FlowerResolveHandlerInput) => Promise<FlowerRouterDecision>;
  loadAttachmentCapability?: (modelID: string) => Promise<FlowerAttachmentCapability>;
  createAttachmentStagingScope?: (targetID?: string) => Promise<FlowerAttachmentStagingScope>;
  releaseAttachmentStagingScope?: (scope: FlowerAttachmentStagingScope) => Promise<void>;
  uploadAttachment?: (input: FlowerAttachmentUploadInput) => Promise<FlowerStagedAttachment>;
  deleteStagedAttachment?: (attachmentID: string, scope: FlowerAttachmentStagingScope) => Promise<void>;
  readStagedLongText?: (attachment: FlowerStagedAttachment, scope: FlowerAttachmentStagingScope) => Promise<FlowerStagedLongTextReadResult>;
  loadStagedAttachmentPreview?: (attachment: FlowerStagedAttachment, scope: FlowerAttachmentStagingScope, signal: AbortSignal) => Promise<Blob>;
  previewStagedAttachment?: (attachment: FlowerStagedAttachment, scope: FlowerAttachmentStagingScope) => void | Promise<void>;
  launchTurn: (input: FlowerTurnLaunchInput) => Promise<FlowerTurnLaunchReceipt>;
  retryThread: (threadID: string) => Promise<FlowerThreadView>;
  retryEffect: (input: FlowerRetryEffectRequest) => Promise<void>;
  stopThread: (threadID: string) => Promise<FlowerThreadView>;
  submitInput: (input: FlowerSubmitInputRequest) => Promise<FlowerSubmitInputReceipt>;
  submitApproval: (input: FlowerSubmitApprovalRequest) => Promise<FlowerApprovalCommandResult>;
  readTerminalProcess?: (input: FlowerTerminalProcessReadRequest) => Promise<FlowerTerminalProcessSnapshot>;
  getWorkingDirectoryPathContext?: () => Promise<FlowerWorkingDirectoryPathContext>;
  listWorkingDirectoryEntries?: (input: FlowerWorkingDirectoryListInput) => Promise<readonly FlowerWorkingDirectoryEntry[]>;
  openFileBrowser?: (request: FlowerFileOpenRequest) => Promise<void>;
  openFilePreview?: (request: FlowerFileOpenRequest) => Promise<void>;
  openCanonicalReference?: (request: FlowerCanonicalReferenceOpenRequest) => Promise<void>;
  openLinkedFilePreview?: (request: FlowerLinkedContextPathOpenRequest) => Promise<void>;
  openLinkedDirectoryBrowser?: (request: FlowerLinkedContextPathOpenRequest) => Promise<void>;
  modelSourceRecovery?: FlowerModelSourceRecovery;
}>;
