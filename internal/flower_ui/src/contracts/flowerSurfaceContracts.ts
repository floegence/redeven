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

export type FlowerConfig = Readonly<{
  schema_version: 1;
  current_model_id: string;
  permission_type: FlowerPermissionType;
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

export type FlowerChatMessageStatus = 'sending' | 'streaming' | 'error' | 'complete' | 'canceled';

export type FlowerChatMessage = Readonly<{
  id: string;
  role: FlowerChatMessageRole;
  content: string;
  status: FlowerChatMessageStatus;
  created_at_ms: number;
  blocks?: readonly FlowerChatMessageBlock[];
  context_action?: unknown;
  live?: boolean;
  active_cursor?: boolean;
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
  target_kind: FlowerTimelineAnchorTargetKind | string;
  message_id: string;
  block_index?: number;
  activity_item_id?: string;
  edge: FlowerTimelineAnchorEdge | string;
}>;

export type FlowerTimelineDecoration = Readonly<{
  decoration_id: string;
  kind: 'context_compaction' | string;
  anchor: FlowerTimelineAnchor;
  ordinal: number;
  compaction: FlowerContextCompaction;
}>;

export type FlowerActivityStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'success'
  | 'error'
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
}>;

export type FlowerActivityFileAction = Readonly<{
  action_id: string;
  display_name: string;
  can_preview: boolean;
  can_browse_directory: boolean;
}>;

export type FlowerActivitySubagentActionItem = Readonly<{
  thread_id?: string;
  subagent_id?: string;
  task_name?: string;
  title?: string;
  agent_type?: string;
  context_mode?: string;
  status?: string;
  started_at_ms?: number;
  created_at_ms?: number;
  updated_at_ms?: number;
}>;

export type FlowerActivitySubagentAction = Readonly<{
  operation?: string;
  action?: string;
  delegation_runtime?: string;
  thread_id?: string;
  subagent_id?: string;
  parent_thread_id?: string;
  task_name?: string;
  title?: string;
  agent_type?: string;
  context_mode?: string;
  status?: string;
  started_at_ms?: number;
  created_at_ms?: number;
  updated_at_ms?: number;
  items?: readonly FlowerActivitySubagentActionItem[];
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
  subagent_actions?: Readonly<Record<string, FlowerActivitySubagentAction>>;
}>;

export type FlowerChatMessageBlock =
  | Readonly<{
    type: 'markdown' | 'text' | 'thinking';
    content?: string;
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
  active_run_id?: string;
  queued_turn_count?: number;
  permission_type?: FlowerPermissionType;
  source_label: string;
  target_labels: readonly string[];
  read_only_reason?: string;
  owner_kind?: string;
  owner_id?: string;
  parent_thread_id?: string;
  messages: readonly FlowerChatMessage[];
  model_io_status?: FlowerModelIOStatus | null;
  reasoning_selection?: FlowerReasoningSelection;
  reasoning_capability?: FlowerReasoningCapability;
  context_usage?: FlowerContextUsage | null;
  context_compactions?: readonly FlowerContextCompaction[];
  timeline_decorations?: readonly FlowerTimelineDecoration[];
  approval_actions?: readonly FlowerApprovalAction[];
  input_request?: FlowerInputRequest | null;
  error?: FlowerThreadError | null;
  read_status: FlowerThreadReadStatus;
}>;

export type FlowerSubagentSummary = Readonly<{
  parent_thread_id: string;
  subagent_id: string;
  thread_id: string;
  task_name?: string;
  title?: string;
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
  activity?: FlowerActivityTimelineBlock;
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
  timeline: readonly FlowerSubagentTimelineRow[];
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

export type FlowerApprovalOrigin = 'main_tool' | 'delegated_subagent';

export type FlowerDelegatedApprovalRef = Readonly<{
  parent_thread_id: string;
  parent_run_id: string;
  parent_turn_id?: string;
  subagent_id: string;
  child_thread_id: string;
  child_run_id: string;
  child_turn_id?: string;
  child_tool_call_id: string;
  approval_id: string;
}>;

type FlowerApprovalActionBase = Readonly<{
  action_id: string;
  turn_id?: string;
  tool_name: string;
  state: 'requested' | 'approved' | 'rejected' | 'timed_out' | 'canceled' | 'unavailable';
  status: 'pending' | 'resolved' | 'unavailable';
  revision: number;
  version: number;
  surface_epoch?: number;
  surface_role?: 'primary_action' | 'locator' | 'mirror';
  scope?: string;
  requested_at_ms: number;
  resolved_at_ms?: number;
  expires_at_ms?: number;
  can_approve: boolean;
  expected_seq?: number;
  read_only_reason?: string;
  delegated_ref?: FlowerDelegatedApprovalRef;
  delivery_state?: 'waiting_decision' | 'delivery_pending' | 'delivery_delivered' | 'delivery_failed' | 'delivery_ack_unknown' | 'delivery_unavailable';
  child_execution_state?: 'unknown' | 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
  primary_wait_anchor?: string;
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
  origin: 'main_tool';
  run_id: string;
  tool_id: string;
  delegated_ref?: never;
}>;

export type FlowerDelegatedSubagentApprovalAction = FlowerApprovalActionBase & Readonly<{
  origin: 'delegated_subagent';
  delegated_ref: FlowerDelegatedApprovalRef;
  run_id?: never;
  tool_id?: never;
}>;

export type FlowerApprovalAction = FlowerMainToolApprovalAction | FlowerDelegatedSubagentApprovalAction;

export type FlowerLiveKind =
  | 'run.started'
  | 'run.status_changed'
  | 'thread.patched'
  | 'message.started'
  | 'message.block_started'
  | 'message.block_delta'
  | 'message.block_set'
  | 'message.committed'
  | 'message.failed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'input.requested'
  | 'input.resolved'
  | 'model_io.updated'
  | 'context.usage.updated'
  | 'context.compaction.updated'
  | 'timeline.replaced'
  | 'stream.resync_required';

export type FlowerLiveBlock = Readonly<{
  type: string;
  content?: string;
  block?: unknown;
}>;

export type FlowerLiveRunState = Readonly<{
  run_id: string;
  status: string;
  message_id?: string;
  waiting_prompt?: FlowerInputRequest | null;
  error_code?: string;
  error?: string;
}>;

export type FlowerLiveThreadPatch = Readonly<{
  thread_id?: string;
  title?: string;
  model_id?: string;
  permission_type?: FlowerPermissionType;
  working_dir?: string;
  queued_turn_count?: number;
  run_status?: string;
  run_updated_at_ms?: number;
  run_error_code?: string;
  run_error?: string;
  waiting_prompt?: FlowerInputRequest | null;
  last_context_run_id?: string;
  pinned_at_ms?: number;
  created_at_ms?: number;
  updated_at_ms?: number;
  last_message_at_ms?: number;
  last_message_preview?: string;
  reasoning_selection?: FlowerReasoningSelection | null;
  reasoning_capability?: FlowerReasoningCapability | null;
  read_only_reason?: string;
  owner_kind?: string;
  owner_id?: string;
  parent_thread_id?: string;
  read_status?: FlowerThreadReadStatus;
}>;

export type FlowerLiveMaterializedState = Readonly<{
  thread_patch: FlowerLiveThreadPatch;
  runs: Readonly<Record<string, FlowerLiveRunState>>;
  model_io?: FlowerModelIOStatus | null;
  context_usage?: FlowerContextUsage | null;
  context_compactions?: readonly FlowerContextCompaction[];
  timeline_decorations?: readonly FlowerTimelineDecoration[];
  approval_actions?: Readonly<Record<string, FlowerApprovalAction>>;
  input_requests: Readonly<Record<string, FlowerInputRequest>>;
}>;

export type FlowerLiveBootstrap = Readonly<{
  schema_version: number;
  endpoint_id: string;
  thread_id: string;
  stream_generation: number;
  cursor: number;
  retained_from_seq: number;
  thread: FlowerThreadSnapshot;
  timeline_messages: readonly FlowerChatMessage[];
  live_state: FlowerLiveMaterializedState;
  read_status: FlowerThreadReadStatus;
  generated_at_ms: number;
}>;

export type FlowerLiveMessageStartedPayload = Readonly<{
  message_id: string;
  role: 'assistant';
  status: 'streaming';
  created_at_ms: number;
}>;

export type FlowerLiveMessageBlockStartedPayload = Readonly<{
  message_id: string;
  block_index: number;
  block_type: string;
}>;

export type FlowerLiveMessageBlockDeltaPayload = Readonly<{
  message_id: string;
  block_index: number;
  delta: string;
}>;

export type FlowerLiveMessageBlockSetPayload = Readonly<{
  message_id: string;
  block_index: number;
  block: FlowerLiveBlock;
}>;

export type FlowerLiveMessageCommittedPayload = Readonly<{
  message_id: string;
  message: FlowerChatMessage;
}>;

export type FlowerLiveMessageFailedPayload = Readonly<{
  message_id: string;
  error: string;
}>;

export type FlowerLiveApprovalPayload = Readonly<{
  action: FlowerApprovalAction;
}>;

export type FlowerLiveInputRequestedPayload = Readonly<{
  request: FlowerInputRequest;
}>;

export type FlowerLiveInputResolvedPayload = Readonly<{
  prompt_id: string;
}>;

export type FlowerLiveUsageUpdatedPayload = Readonly<{
  usage: FlowerContextUsage;
}>;

export type FlowerLiveContextCompactionUpdatedPayload = Readonly<{
  compaction: FlowerContextCompaction;
  timeline_decoration: FlowerTimelineDecoration;
}>;

export type FlowerLiveModelIOUpdatedPayload = Readonly<{
  status?: FlowerModelIOStatus | null;
}>;

export type FlowerLiveTimelineReplacedPayload = Readonly<{
  messages: readonly FlowerChatMessage[];
  stream_generation: number;
  snapshot_through_seq: number;
  thread_patch?: FlowerLiveThreadPatch;
  live_state?: FlowerLiveMaterializedState;
  read_status?: FlowerThreadReadStatus;
  context_usage?: FlowerContextUsage | null;
  context_compactions?: readonly FlowerContextCompaction[];
  timeline_decorations?: readonly FlowerTimelineDecoration[];
}>;

export type FlowerLiveResyncRequiredPayload = Readonly<{
  reason: string;
}>;

export type FlowerLiveRunStartedPayload = Readonly<{
  run_id: string;
  turn_id?: string;
  message_id?: string;
  status: string;
  model_id?: string;
}>;

export type FlowerLiveRunStatusChangedPayload = Readonly<{
  run_id: string;
  status: string;
  error_code?: string;
  error?: string;
  waiting_prompt?: FlowerInputRequest | null;
}>;

export type FlowerLiveThreadPatchedPayload = Readonly<{
  patch: FlowerLiveThreadPatch;
}>;

export type FlowerLiveEventPayloadByKind = Readonly<{
  'run.started': FlowerLiveRunStartedPayload;
  'run.status_changed': FlowerLiveRunStatusChangedPayload;
  'thread.patched': FlowerLiveThreadPatchedPayload;
  'message.started': FlowerLiveMessageStartedPayload;
  'message.block_started': FlowerLiveMessageBlockStartedPayload;
  'message.block_delta': FlowerLiveMessageBlockDeltaPayload;
  'message.block_set': FlowerLiveMessageBlockSetPayload;
  'message.committed': FlowerLiveMessageCommittedPayload;
  'message.failed': FlowerLiveMessageFailedPayload;
  'approval.requested': FlowerLiveApprovalPayload;
  'approval.resolved': FlowerLiveApprovalPayload;
  'input.requested': FlowerLiveInputRequestedPayload;
  'input.resolved': FlowerLiveInputResolvedPayload;
  'model_io.updated': FlowerLiveModelIOUpdatedPayload;
  'context.usage.updated': FlowerLiveUsageUpdatedPayload;
  'context.compaction.updated': FlowerLiveContextCompactionUpdatedPayload;
  'timeline.replaced': FlowerLiveTimelineReplacedPayload;
  'stream.resync_required': FlowerLiveResyncRequiredPayload;
}>;

export type FlowerLiveEvent<K extends FlowerLiveKind = FlowerLiveKind> = K extends FlowerLiveKind ? Readonly<{
  schema_version: number;
  seq: number;
  endpoint_id: string;
  thread_id: string;
  run_id?: string;
  turn_id?: string;
  trace_id?: string;
  step?: string;
  at_unix_ms: number;
  kind: K;
  payload: FlowerLiveEventPayloadByKind[K];
}> : never;

export type FlowerLiveEventsResponse = Readonly<{
  stream_generation: number;
  events: readonly FlowerLiveEvent[];
  next_cursor: number;
  has_more?: boolean;
  retained_from_seq: number;
}>;

type FlowerSubmitApprovalRequestBase = Readonly<{
  thread_id: string;
  action_id: string;
  approved: boolean;
  expected_seq?: number;
  revision?: number;
  version?: number;
  surface_epoch?: number;
  idempotency_key?: string;
}>;

export type FlowerSubmitApprovalRequest =
  | (FlowerSubmitApprovalRequestBase & Readonly<{
      origin?: 'main_tool';
      run_id: string;
      tool_id: string;
      delegated_ref?: never;
    }>)
  | (FlowerSubmitApprovalRequestBase & Readonly<{
      origin: 'delegated_subagent';
      delegated_ref: FlowerDelegatedApprovalRef;
      run_id?: never;
      tool_id?: never;
    }>);

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
  owner_kind?: string;
  owner_id?: string;
  parent_thread_id?: string;
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
  thread_id?: string;
  message_id?: string;
  prompt: string;
  decision?: FlowerRouterDecision | null;
  context_action?: unknown;
  attachments?: readonly FlowerTurnAttachment[];
  pending_files?: readonly File[];
  working_dir?: string;
  model_id?: string;
  permission_type?: FlowerPermissionType;
  reasoning_selection?: FlowerReasoningSelection;
}>;

export type FlowerCompactThreadContextInput = Readonly<{
  thread_id: string;
  active_run_id?: string;
}>;

export type FlowerTurnLaunchFailure = Error & Readonly<{
  fresh_decision?: FlowerRouterDecision;
}>;

export type FlowerTurnAttachment = Readonly<{
  name: string;
  mime_type: string;
  url: string;
}>;

export type FlowerTurnLauncherSourceSurface =
  | 'desktop_welcome_environment_card'
  | 'file_browser'
  | 'terminal'
  | 'file_preview'
  | 'monitoring'
  | 'git_browser'
  | 'editor_preview';

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

export type FlowerTerminalProcessReadRequest = Readonly<{
  run_id: string;
  process_id: string;
  after_seq?: number;
  wait_ms?: number;
  max_bytes?: number;
}>;

export type FlowerTerminalProcessSnapshot = Readonly<{
  process_id: string;
  status: string;
  command?: string;
  cwd?: string;
  output?: string;
  stdout?: string;
  stderr?: string;
  latest_output?: string;
  first_seq?: number;
  last_seq?: number;
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
  loadSettings: () => Promise<FlowerSettingsSnapshot>;
  saveSettings: (draft: FlowerSettingsDraft) => Promise<FlowerSettingsSnapshot>;
  listThreads: () => Promise<readonly FlowerThreadSnapshot[]>;
  loadThread: (threadID: string) => Promise<FlowerLiveBootstrap>;
  listThreadLiveEvents: (threadID: string, afterSeq: number, limit?: number) => Promise<FlowerLiveEventsResponse>;
  loadSubagentDetail: (parentThreadID: string, childThreadID: string, afterOrdinal?: number, limit?: number) => Promise<FlowerSubagentDetail>;
  markThreadRead: (threadID: string, snapshot: FlowerThreadActivitySnapshot) => Promise<FlowerThreadReadStatus>;
  renameThread?: (threadID: string, title: string) => Promise<FlowerLiveBootstrap>;
  setThreadPinned?: (threadID: string, pinned: boolean) => Promise<FlowerLiveBootstrap>;
  setThreadPermissionType?: (threadID: string, permissionType: FlowerPermissionType) => Promise<FlowerLiveBootstrap>;
  setThreadModel?: (threadID: string, modelID: string) => Promise<FlowerLiveBootstrap>;
  setThreadReasoningSelection?: (threadID: string, selection: FlowerReasoningSelection | undefined) => Promise<FlowerLiveBootstrap>;
  forkThread?: (threadID: string) => Promise<FlowerLiveBootstrap>;
  resolveHandler: (input?: FlowerResolveHandlerInput) => Promise<FlowerRouterDecision>;
  launchTurn: (input: FlowerTurnLaunchInput) => Promise<FlowerLiveBootstrap>;
  compactThreadContext: (input: FlowerCompactThreadContextInput) => Promise<FlowerLiveBootstrap>;
  stopThread: (threadID: string) => Promise<FlowerLiveBootstrap>;
  submitInput: (input: FlowerSubmitInputRequest) => Promise<FlowerLiveBootstrap>;
  submitApproval: (input: FlowerSubmitApprovalRequest) => Promise<void>;
  readTerminalProcess?: (input: FlowerTerminalProcessReadRequest) => Promise<FlowerTerminalProcessSnapshot>;
  getWorkingDirectoryPathContext?: () => Promise<FlowerWorkingDirectoryPathContext>;
  listWorkingDirectoryEntries?: (input: FlowerWorkingDirectoryListInput) => Promise<readonly FlowerWorkingDirectoryEntry[]>;
  openFileBrowser?: (request: FlowerFileOpenRequest) => Promise<void>;
  openFilePreview?: (request: FlowerFileOpenRequest) => Promise<void>;
}>;
