import type { ContextActionContextItem } from '../contextActionWire';
import type { DirectoryFavorites } from '@floegence/floe-webapp-core/ui';
export type FlowerProviderType =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'moonshot'
  | 'kimi_code'
  | 'chatglm'
  | 'deepseek'
  | 'qwen'
  | 'openrouter'
  | 'xai'
  | 'groq'
  | 'ollama'
  | 'openai_compatible';

export type FlowerWebSearchSource = 'native' | 'brave';
export type FlowerWebSearchPolicy = Readonly<{ editable: boolean; default_enabled: boolean; default_model_enabled: boolean; default_fetch_source: 'direct' | 'deepseek'; enabled: boolean; source: FlowerWebSearchSource; supported_sources: readonly FlowerWebSearchSource[] }>;

export type FlowerReasoningLevel = 'default' | 'off' | 'on' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

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

export type FlowerWebSearchAvailability = Readonly<{ status: 'available' | 'unavailable'; reason: string; recommended_enabled?: boolean; model_enabled?: boolean }>;

export type FlowerProviderModel = Readonly<{
  supports_tools?: boolean;
  model_digest?: string;
  quantization?: string;
  unavailable?: boolean;
  web_search?: FlowerWebSearchAvailability;
  web_search_enabled?: boolean;
  display_name?: string;
  status?: string;
  model_name: string;
  wire_model_name?: string;
  context_window?: number;
  max_output_tokens?: number;
  effective_context_window_percent?: number;
  input_modalities?: readonly string[];
  reasoning_capability?: FlowerReasoningCapability;
  default_reasoning_selection?: FlowerReasoningSelection;
}>;

export type FlowerModelSelection = Readonly<{
  selected_models?: readonly string[];
  disabled_models?: readonly string[];
  custom_models?: readonly FlowerProviderModel[];
  model_overrides?: readonly FlowerProviderModel[];
}>;

export type FlowerProvider = Readonly<{
  enabled?: boolean;
  id: string;
  name?: string;
  type: FlowerProviderType;
  base_url?: string;
  responses_continuation?: boolean;
  web_search?: Readonly<{ enabled: boolean; source: FlowerWebSearchSource }>;
  web_fetch?: Readonly<{ source: 'direct' | 'deepseek' }>;
  search_policy?: FlowerWebSearchPolicy;
  auth_method?: 'api_key' | 'chatgpt';
  account_id?: string;
  models: readonly FlowerProviderModel[];
  model_selection?: FlowerModelSelection;
  // Read-only Runtime defaults; configuration serialization excludes this field.
  model_defaults?: readonly FlowerProviderModel[];
  catalog_models?: readonly FlowerProviderModel[];
  catalog_error?: string;
}>;

export type FlowerProviderDraft = FlowerProvider & Readonly<{
  chatgpt_account?: FlowerChatGPTAccount;
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
  billing_source?: 'chatgpt_plan';
  alias_group?: string;
  quantization?: string;
  web_search?: FlowerWebSearchAvailability;
  id: string;
  label: string;
  context_window?: number;
  max_output_tokens?: number;
  input_modalities?: readonly string[];
  reasoning_capability?: FlowerReasoningCapability;
}>;

export type FlowerModelDirectoryModel = FlowerModelSourceModel & Readonly<{
  source?: 'runtime_config' | 'desktop_model_source' | 'platform';
  state: 'ready' | 'pending' | 'unavailable';
  reason?: string;
  provider_id?: string;
  provider_name?: string;
  provider_type?: FlowerProviderType;
  model_name?: string;
  default_reasoning_selection?: FlowerReasoningSelection;
}>;

export type FlowerModelDirectory = Readonly<{
  search_policies?: Readonly<Partial<Record<FlowerProviderType, FlowerWebSearchPolicy>>>;
  provider_search_policies?: Readonly<Record<string, FlowerWebSearchPolicy>>;
  provider_defaults?: Readonly<Partial<Record<FlowerProviderType, readonly FlowerProviderModel[]>>>;
  provider_catalogs?: Readonly<Record<string, readonly FlowerProviderModel[]>>;
  current_model_id: string;
  models: readonly FlowerModelDirectoryModel[];
  sources: readonly Readonly<{
    id: string;
    kind: 'runtime_config' | 'desktop_model_source' | 'platform';
    state: 'ready' | 'pending' | 'unavailable';
    reason?: string;
    missing_key_provider_ids?: readonly string[];
  }>[];
  checking?: boolean;
  error?: 'directory_unavailable' | 'directory_timeout';
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
      state: 'not_configured';
      label: 'Desktop';
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
  remoteSettings?: FlowerSurfaceAction;
  runtimeSettings: FlowerSurfaceAction;
  connectionCenter: FlowerSurfaceAction;
}>;

export type FlowerConversationPreferences = Readonly<{
  model_id?: string;
  working_dir?: string;
  reasoning_by_model: Readonly<Record<string, FlowerReasoningSelection>>;
  revision: number;
}>;

export type FlowerConversationPreferencePatch = Readonly<{
  model_id?: string;
  working_dir?: string;
  reasoning?: Readonly<{ model_id: string; selection: FlowerReasoningSelection }>;
}>;

export type FlowerSettingsSnapshot = Readonly<{
  conversation_preferences?: FlowerConversationPreferences;
  auth_capabilities?: Readonly<{ openai_chatgpt: Readonly<{ available: boolean; reason?: string; binding_id?: string }> }>;
  chatgpt_accounts?: Readonly<Record<string, FlowerChatGPTAccount>>;
  saved_chatgpt_accounts?: readonly FlowerChatGPTAccount[];
  account_sign_outs?: readonly FlowerAccountSignOutResult[];
  model_directory?: FlowerModelDirectory;
  defaults: Readonly<{
    permission_type: FlowerPermissionType;
    computer_use_enabled?: boolean;
    auto_update_model_catalog?: boolean;
  }>;
  model_profile: FlowerModelProfile | null;
  provider_secrets: readonly FlowerProviderSecretState[];
  model_source?: FlowerModelSourceStatus;
  platform_model_source?: Readonly<{
    error?: string;
    models: readonly FlowerModelSourceModel[];
    current_model_id?: string;
  }>;
}>;

export type FlowerChatMessageRole = 'user' | 'assistant' | 'system';

export type FlowerChatMessageStatus = 'sending' | 'streaming' | 'error' | 'complete' | 'canceled';

export type FlowerMessageReference =
  | Readonly<{ reference_id: string; kind: 'thread'; referenced_thread_id: string; label: string; text: string; truncated?: boolean }>
  | Readonly<{ reference_id: string; kind: 'file' | 'directory'; label: string; truncated?: boolean }>
  | Readonly<{ reference_id: string; kind: 'text' | 'terminal' | 'process'; label: string; text?: string; truncated?: boolean }>;

export type FlowerCitationSource = Readonly<{
  title?: string;
  url: string;
  /** End-exclusive Unicode code-point indices in the exact assistant text. */
  start_index?: number;
  end_index?: number;
}>;

export type FlowerMessageTextSource = Readonly<{
  readonly start?: number;
  readonly length: number;
  readonly revision: number;
  read(from: number): readonly string[];
}>;

export type FlowerChatMessage = Readonly<{
  body_pending?: Readonly<{ kind: 'text' | 'activity'; bytes: number; retained?: boolean }>;
  /** In-memory append source owned by ThreadCache, never serialized. */
  text_source?: FlowerMessageTextSource;
  goal?: FlowerGoalChange;
  id: string;
  // Canonical root-thread and SubAgent messages always carry turn_id. Synthetic
  // local presentation rows may omit it because they are not admission records.
  turn_id?: string;
  thread_id?: string;
  run_id?: string;
  logical_request_id?: string;
  turn_ordinal?: number;
  canonical_ordinal?: number;
  sources?: readonly FlowerCitationSource[];
  role: FlowerChatMessageRole;
  content: string;
  status: FlowerChatMessageStatus;
  created_at_ms: number;
  /** Canonical output receipt interval, or an in-session observation for older runtimes. */
  thinking_timing?: Readonly<{ started_at_ms: number; ended_at_ms?: number; source?: 'runtime' }>;
  blocks?: readonly FlowerChatMessageBlock[];
  references?: readonly FlowerMessageReference[];
  /** Test and legacy input shape only; admitted messages are projected from references. */
  context_action?: unknown;
  live?: boolean;
  active_cursor?: boolean;
  attempt_epoch?: number;
  steering?: Readonly<{ status: 'pending' | 'applied' | 'cancelled'; reason?: string }>;
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
  detail?: string;
  message: string;
  code?: string;
}>;

export type FlowerRunProgressPhase =
  | 'preparing'
  | 'waiting_response'
  | 'streaming'
  | 'retrying'
  | 'finalizing'
  | 'tool_execution';

export type FlowerRunRetry = Readonly<{
  retry: number;
  max_retries: number;
  next_attempt_at: string;
  reason: string;
  replaced_attempt_id?: string;
  replaced_attempt_epoch?: number;
}>;

export type FlowerProviderRequestProgress = Readonly<{
  logical_request_id: string;
  attempt_id: string;
  attempt_epoch: number;
  started_at: string;
  first_output_at?: string;
  last_progress_at?: string;
  estimated_output_tokens: number;
  // Browser-only monotonic anchor, retained with the cached detail.
  wait_anchor_monotonic_ms?: number;
  progress_anchor_monotonic_ms?: number;
}>;

export type FlowerArgumentPreview = Readonly<{
  display_name?: string;
  additions?: number;
  deletions?: number;
}>;

export type FlowerToolCallPreview = Readonly<{
  thread_id: string;
  turn_id: string;
  run_id: string;
  logical_request_id: string;
  attempt_id: string;
  attempt_epoch: number;
  call_id: string;
  name: string;
  arguments_complete: boolean;
  preview: FlowerArgumentPreview | null;
}>;

export type FlowerToolCallPreviewBlock = Readonly<{
  type: 'tool-call-preview';
  call: FlowerToolCallPreview;
}>;

export type FlowerProviderTransportProgress = Readonly<{
 logical_request_id: string;
 attempt_id: string;
 attempt_epoch: number;
 transport: 'http' | 'http_sse' | 'websocket';
 phase: 'connecting' | 'sending' | 'receiving' | 'completed' | 'failed';
 next_transport?: 'http' | 'http_sse' | 'websocket';
 reason?: string;
}>;

export type FlowerRunProgress = Readonly<{
 transport?: FlowerProviderTransportProgress;
  retry?: FlowerRunRetry;
  phase: FlowerRunProgressPhase;
  run_id: string;
  turn_id: string;
  request?: FlowerProviderRequestProgress;
  sampled_at_ms?: number;
}>;

export type FlowerContextPressureStatus =
  | 'stable'
  | 'near_threshold'
  | 'will_compact'
  | 'hard_limit'
  | 'estimated';

export type FlowerModelContext = Readonly<{
  snapshot: Readonly<{ sections: readonly Readonly<{ key: string; title: string; text: string }>[] }>;
  entry_id: string;
  path_depth: number;
  turn_id: string;
  run_id: string;
  updated_at: string;
  changed_keys: readonly string[];
  removed_keys: readonly string[];
  used_by_request_id?: string;
  used_by_turn_id?: string;
  used_by_run_id?: string;
  used_at?: string;
}>;

export type FlowerContextUsagePhase = 'projected_request' | 'provider_usage';

export type FlowerThreadTokenUsage = Readonly<{
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}>;

export type FlowerContextUsage = Readonly<{
  recent_request_usage?: FlowerThreadTokenUsage;
  confirmed?: FlowerContextSample;
  estimate?: FlowerContextSample;
  thread_usage?: FlowerThreadTokenUsage;
}>;

export const FLOWER_CONTEXT_CATEGORIES = [
  'system', 'user', 'assistant', 'tool_definition', 'tool_call', 'tool_result',
  'model_context', 'compaction', 'reasoning', 'hosted_context', 'unlabelled',
] as const;
export type FlowerContextCategory = typeof FLOWER_CONTEXT_CATEGORIES[number];
export type FlowerContextCharacterDetail = Readonly<{
  key: string; source?: string; namespace?: string; characters: number;
}>;
export type FlowerContextCharacterBreakdown = Readonly<{
  source: 'prepared_characters_v1'; unit: 'unicode_code_points'; total_characters: number;
  categories: readonly Readonly<{ category: FlowerContextCategory; characters: number; details?: readonly FlowerContextCharacterDetail[] }>[];
  limitations?: readonly string[];
}>;

export type FlowerContextSample = Readonly<{
  available?: boolean;
  measured?: boolean;
  characters_available?: boolean;
  character_limitation?: string;
  request_id?: string;
  attempt_id?: string;
  attempt_epoch?: number;
  payload_fingerprint?: string;
  provider?: string;
  model?: string;
  characters?: FlowerContextCharacterBreakdown;
  run_id?: string;
  step_index?: number;
  phase: FlowerContextUsagePhase;
  input_tokens?: number;
  context_window_tokens?: number;
  threshold_tokens?: number;
  request_safe_limit_tokens?: number;
  output_headroom_tokens?: number;
  request_output_tokens?: number;
  output_control?: 'client' | 'server';
  safety_margin_tokens?: number;
  used_ratio?: number;
  threshold_ratio?: number;
  pressure_status: FlowerContextPressureStatus;
  source?: string;
  updated_at_ms: number;
}>;

export type FlowerContextCompactionPhase = 'start' | 'complete' | 'failed' | 'cancelled' | 'noop' | 'checkpoint';

export type FlowerContextCompactionStatus = 'compacting' | 'compacted' | 'failed' | 'cancelled' | 'noop' | 'checkpoint';

export type FlowerCompactionPressure = Readonly<{
  request_output_tokens?: number;
  output_control?: string;
  safety_margin_tokens?: number;
  window_input_tokens?: number;
  projected_input_tokens?: number;
  context_window_tokens?: number;
  threshold_tokens?: number;
  request_safe_limit_tokens?: number;
  output_headroom_tokens?: number;
  pressure_signal?: string;
  pressure_source?: string;
  estimate_method?: string;
  confidence?: string;
  compaction_needed?: boolean;
  hard_limit_exceeded?: boolean;
}>;

export type FlowerCompactionRequestSnapshot = Readonly<{
  payload_fingerprint: string;
  provider: string;
  model: string;
  estimated_input_tokens: number;
  source: string;
  estimate_method: string;
  estimate_confidence: string;
  pressure: FlowerCompactionPressure;
  calibration_request_id?: string;
}>;

export type FlowerCompactionDecision = Readonly<{
  pressure: FlowerCompactionPressure;
  before?: FlowerCompactionRequestSnapshot;
  after?: FlowerCompactionRequestSnapshot;
}>;

export type FlowerContextCompaction = Readonly<{
  turn_id: string;
  canonical_ordinal: number;
  decision?: FlowerCompactionDecision;
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
export type FlowerActivityRenderer = 'structured' | 'terminal' | 'file' | 'patch' | 'web_search' | 'web_fetch' | 'todos' | 'question' | 'subagent' | 'subagent_operation' | 'computer' | 'browser';

export type FlowerActivityChip = Readonly<{
  kind: string;
  label: string;
  value?: string;
  tone?: string;
}>;

export type FlowerActivityTargetRef = Readonly<{
  path?: string;
  kind: string;
  label: string;
  uri?: string;
  resource_ref?: string;
  line?: number;
}>;

export type FlowerActivityItem = Readonly<{
  field_summary?: FlowerActivitySummary;
  body_pending?: boolean;
  item_id: string;
  tool_id?: string;
  tool_name?: string;
  argument_preview?: FlowerArgumentPreview;
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
}>;

export type FlowerInputResponseBlock = Readonly<{
  type: 'input-response';
  questions: readonly Readonly<{
    question_id: string;
    question: string;
    answer?: string;
    redacted?: true;
  }>[];
}>;

export type FlowerChatMessageBlock =
  | Readonly<{
    type: 'markdown' | 'text' | 'thinking';
    sources?: readonly FlowerCitationSource[];
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
    url?: string;
  }>
  | FlowerInputResponseBlock
  | FlowerActivityTimelineBlock
  | FlowerToolCallPreviewBlock;

export type FlowerInputRequestAction = Readonly<{
  type: string;
}>;

export type FlowerInputRequestChoice = Readonly<{
  choice_id: string;
  value: string;
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
  computer_assistance?: Readonly<{ kind: string; target_id?: string; tool_call_id: string }>;
  prompt_id: string;
  message_id: string;
  tool_id: string;
  tool_call_id?: string;
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
}>;

export type FlowerThreadReadState = Readonly<{
  last_seen_activity_revision: number;
}>;

export type FlowerThreadReadStatus = Readonly<{
  is_unread: boolean;
  snapshot: FlowerThreadActivitySnapshot;
  read_state: FlowerThreadReadState;
}>;

export type FlowerQueuedTurn = Readonly<{
  queue_id: string;
  request_key?: string;
  input_fingerprint?: string;
  references?: readonly FlowerMessageReference[];
  prompt: string;
  created_at_ms: number;
  attachments?: readonly FlowerQueuedTurnAttachment[];
  context_action?: unknown;
}>;

export type FlowerQueuedDraft = Readonly<{
  prompt: string;
  references: readonly ContextActionContextItem[];
  attachments: readonly FlowerStagedAttachment[];
}>;
export type FlowerQueuedDraftInput = Readonly<{ expected_input_fingerprint: string; staging_scope?: FlowerAttachmentStagingScope }>;

export type FlowerQueuedTurnEditInput = Readonly<{
  client_request_id: string;
  expected_input_fingerprint: string;
  prompt: string;
  retained_attachment_ids: readonly string[];
  retained_reference_ids: readonly string[];
  attachment_ids?: readonly string[];
  context_action?: unknown;
  staging_scope?: FlowerAttachmentStagingScope;
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

export type FlowerThreadSummary = Omit<FlowerThreadSnapshot, 'read_status'> & { readonly read_status?: FlowerThreadReadStatus };

export type FlowerThreadSnapshot = Readonly<{
  history_window?: FlowerHistoryWindow;
  goal?: FlowerGoal;
  parent_events?: FlowerParentEventPage;
  turns?: readonly FlowerRuntimeTurn[];
  cancellation?: FlowerThreadCancellation;
  thread_id: string;
  title: string;
  title_status: FlowerTitleStatus;
  title_generation: number;
  model_id: string;
  working_dir: string;
  pinned_at_ms?: number;
  pin_rank?: number;
  settings_revision: number;
  home_runtime_id?: string;
  home_runtime_kind?: 'local_environment' | 'env_local';
  origin_env_public_id?: string;
  created_at_ms: number;
  updated_at_ms: number;
  status: FlowerThreadStatus;
  active_run_id?: string;
  // Detail-only projection of the accepted canonical current, including terminal identity.
  current_execution?: Readonly<{ turn_id: string; run_id: string; status: FlowerThreadStatus; turn_kind?: 'context_compaction' | 'goal_continuation' }>;
  run_progress?: FlowerRunProgress | null;
  approval_pending?: boolean;
  approval_pending_count?: number;
  queued_turn_count?: number;
  queued_turns?: readonly FlowerQueuedTurn[];
  restored_inputs?: readonly FlowerRestoredInput[];
  permission_type?: FlowerPermissionType;
  source_label: string;
  target_labels: readonly string[];
  read_only_reason?: string;
  parent_thread_id?: string;
  messages: readonly FlowerChatMessage[];
  reasoning_selection?: FlowerReasoningSelection;
  reasoning_capability?: FlowerReasoningCapability;
  model_context?: FlowerModelContext | null;
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
  title: string;
  title_status: FlowerTitleStatus;
  title_generation: number;
  parent_thread_id: string;
  thread_id: string;
  task_name: string;
  task_description?: string;
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

export type FlowerSubagentInputOperation = Readonly<{
  action: 'steer_queue' | 'remove_queue' | 'resend_steering';
  item_id: string;
  expected_input_fingerprint?: string;
  client_request_id: string;
}>;

export type FlowerSubagentDetail = Readonly<{
  window?: FlowerHistoryWindow;
  model_context?: FlowerModelContext | null;
  context_usage?: FlowerContextUsage | null;
  context_compactions?: readonly FlowerContextCompaction[];
  timeline_decorations?: readonly FlowerTimelineDecoration[];
  summary: FlowerSubagentSummary;
  current: FlowerRuntimeCurrentView;
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
    risk?: string;
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

export type FlowerGoal = Readonly<{ version: number; text?: string; status: 'absent' | 'active' | 'completed'; actor: 'user' | 'model' | ''; reviewing?: boolean }>;
export type FlowerGoalChange = Readonly<{ goal: FlowerGoal; operation: 'set' | 'delete' | 'completed'; actor: 'user' | 'model'; reason?: string; at: string }>;
export type FlowerGoalInput = Readonly<{
  storage_generation: string; client_request_id: string; thread_id?: string;
  operation: 'set' | 'submit' | 'delete'; expected_version: number; text?: string;
  new_thread?: Readonly<{ model_id?: string; working_dir?: string; permission_type?: FlowerPermissionType; reasoning_selection?: FlowerReasoningSelection }>;
}>;
export type FlowerGoalResult = Readonly<{ client_request_id: string; thread_id: string; current: FlowerRuntimeCurrentView; goal: FlowerGoal; conflict: boolean; replayed?: boolean }>;

export type FlowerHistoryWindow = Readonly<{ leaf_id?: string; first_item_id?: string; last_item_id?: string; has_before: boolean; has_after: boolean }>;
export type FlowerHistoryBodyRequest = Readonly<{ item_id: string; run_id?: string; source_id?: string; entry_id?: string; field: string; through_bytes: number; offset_bytes: number }>;
export type FlowerHistoryBodyChunk = FlowerHistoryBodyRequest & Readonly<{ thread_id: string; bytes: number; text: string }>;
export type FlowerHistoryRequest = Readonly<{ anchor_offset?: number; item_ids?: readonly string[]; anchor_id?: string; direction?: 'before' | 'after' | 'around'; limit?: number; observer_id?: string; reading_revision?: number }>;
// Field sources freeze decoded UTF-8 independently of subsequent live growth.
export type FlowerActivityField = Readonly<{
  path: string; kind: 'object' | 'array' | 'string' | 'scalar';
  bytes?: number; source_offset_bytes?: number; count?: number; value?: unknown;
  entry_id?: string; source_path?: string; source_sha256?: string; sha256?: string;
  source_id?: string; run_id?: string; inline_text?: string;
  text_extent?: Readonly<{ start_bytes: number; end_bytes: number }>;
}>;
export type FlowerActivitySummary = Readonly<{
  version?: string;
  values?: Readonly<Record<string, unknown>>;
  label?: string; description?: string; renderer?: FlowerActivityRenderer;
  action?: string; has_error?: boolean; uncertain_effect?: boolean;
  fields: readonly FlowerActivityField[];
}>;
export type FlowerActivityValueRequest = Readonly<{ item_id: string; path: string; maximum_bytes: number; maximum_nodes: number; fields?: readonly string[]; text_fields?: readonly string[] }>;
export type FlowerActivityValue = Readonly<{ thread_id: string; item_id: string; turn_id: string; run_id: string; path: string; value: unknown; text_fields?: readonly FlowerActivityField[] }>;
export type FlowerActivityStructureRequest = Readonly<{ item_id: string; path: string; version?: string; offset?: number; limit?: number }>;
export type FlowerActivityStructurePage = Readonly<{
  thread_id: string; item_id: string; turn_id: string; run_id: string; version: string;
  field: FlowerActivityField; children: readonly FlowerActivityField[]; next: number; has_more: boolean;
}>;
export type FlowerActivityFieldRequest = Readonly<{
	align_start?: boolean;
  item_id: string; path: string; entry_id?: string; source_sha256?: string; sha256?: string;
  source_id?: string; run_id?: string; offset_bytes: number; limit_bytes?: number;
}>;
export type FlowerActivityFieldChunk = Readonly<{
  thread_id: string; path: string; entry_id?: string; source_sha256?: string; sha256?: string;
  source_id?: string; run_id?: string; bytes: number; offset_bytes: number; text: string;
}>;
export type FlowerItemBody = Readonly<{ run_id?: string; entry_id?: string; source_id?: string; field: string; bytes: number; preview_bytes: number }>;
export type FlowerRuntimeCurrentItem = Readonly<{
  /** Canonical window cost before product summary compaction; never body bytes. */
  window_bytes?: number;
  body?: FlowerItemBody;
  activity_summary?: FlowerActivitySummary;
  activity_bodies?: readonly Readonly<{ entry_id: string; bytes: number; sha256: string }>[];
  id: string;
  turn_id?: string;
  run_id?: string;
  ordinal: number;
  canonical_ordinal?: number;
  kind: 'user' | 'steering' | 'thinking' | 'assistant' | 'tool' | 'interaction' | 'goal';
  goal?: FlowerGoalChange;
  steering?: FlowerChatMessage['steering'];
  sources?: readonly FlowerCitationSource[];
  text?: string;
  live?: boolean;
  created_at?: string;
  output_started_at?: string;
  output_ended_at?: string;
  attachments?: readonly Readonly<{
    name: string;
    mime_type?: string;
    size_bytes?: number;
    url?: string;
  }>[];
  references?: readonly FlowerMessageReference[];
  activity?: Readonly<Record<string, unknown>>;
  interaction?: FlowerRuntimeInteraction;
}>;

export type FlowerRuntimeInteraction = Readonly<{
  computer_assistance?: FlowerInputRequest['computer_assistance'];
  id: string;
  turn_id: string;
  run_id: string;
  kind: 'approval' | 'input';
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
    reason_code?: string;
    required_from_user?: readonly string[];
    evidence_refs?: readonly string[];
    summary: string;
    questions: readonly Readonly<{
      id: string;
      prompt: string;
      kind: string;
      options?: readonly string[];
      header?: string;
      write_placeholder?: string;
      choices_exhaustive?: boolean;
      choices?: readonly Readonly<{ choice_id?: string; value: string; label: string; description?: string }>[];
      write_label?: string;
      secret?: boolean;
    }>[];
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

export type FlowerRestoredInput = Readonly<{
 id: string;
 input: Readonly<{ text?: string; attachments?: FlowerRuntimeCurrentItem['attachments']; references?: FlowerRuntimeCurrentItem['references'] }>;
}>;

export type FlowerThreadCancellation = Readonly<{
  thread_id: string;
  turn_id: string;
  run_id: string;
  source: string;
  mode: 'immediate' | 'graceful';
  requested_at: string;
}>;

// Canonical detail facts from Floret. Summaries never author turn presentation.
export type FlowerRuntimeTurn = Readonly<{
  turn_id: string;
  run_id: string;
  kind?: 'context_compaction' | 'goal_continuation';
  started_at: string;
  ended_at?: string;
  outcome?: 'completed' | 'failed' | 'cancelled' | 'interrupted';
  elapsed_ms: number;
  waiting_ms: number;
  work_duration_ms: number;
  intermediate_item_ids?: readonly string[];
  final_item_ids: readonly string[];
  final_boundary_complete: boolean;
}>;

export type FlowerParentEvent = Readonly<{
  canonical_ordinal?: number;
  id: string; parent_thread_id: string; parent_turn_id?: string; source_thread_id: string; source_turn_id: string; source_run_id: string;
  source_entry_id: string; kind: 'report' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'timed_out' | 'input_required' | 'approval_required';
  reason_code?: string; interaction_id?: string; message?: string; received_at: string; admitted: boolean; resolved?: boolean;
}>;
export type FlowerParentEventPage = Readonly<{ leaf_id?: string; thread_id: string; events: readonly FlowerParentEvent[]; first_event_id?: string; last_event_id?: string; next_after_event_id?: string; previous_before_event_id?: string }>;
export type FlowerParentEventQuery = Readonly<{ leaf_id?: string; after_ordinal?: number; before_ordinal?: number; action: 'list' | 'read'; event_id?: string; first_event_id?: string; last_event_id?: string; after_event_id?: string; before_event_id?: string; latest?: boolean; limit?: number }>;

export type FlowerRuntimeCurrentView = Readonly<{
  window?: FlowerHistoryWindow;
  goal?: FlowerGoal;
  parent_events?: FlowerParentEventPage;
  turns?: readonly FlowerRuntimeTurn[] | null;
  turn_kind?: 'context_compaction' | 'goal_continuation';
  cancellation?: FlowerThreadCancellation;
  restored_inputs?: readonly FlowerRestoredInput[];
  thread_id: string;
  view_version: number;
  activity?: 'idle' | 'active';
  turn_id?: string;
  run_id?: string;
  sampled_at_ms?: number;
  tool_call_previews?: readonly FlowerToolCallPreview[];
  run_progress?: Readonly<{ phase: FlowerRunProgressPhase; retry?: FlowerRunRetry; request?: FlowerProviderRequestProgress; transport?: FlowerProviderTransportProgress }> | null;
  last_outcome?: 'completed' | 'failed' | 'cancelled' | 'interrupted';
  error?: string;
  run_error_code?: string;
  run_error_detail?: string;
  attention?: Readonly<{ approval_count?: number; input_count?: number }>;
  items?: readonly FlowerRuntimeCurrentItem[];
  queue?: readonly Readonly<{
    id: string;
    request_key: string;
    input_fingerprint?: string;
    created_at?: string;
    input: Readonly<{
      text?: string;
      references?: readonly FlowerMessageReference[];
      attachments?: readonly Readonly<{
        attachment_id?: string;
        name: string;
        mime_type?: string;
        size_bytes?: number;
        text_stats?: FlowerQueuedTurnAttachment['text_stats'];
        url?: string;
      }>[];
    }>;
  }>[];
  interactions?: readonly FlowerRuntimeInteraction[];
}>;

// FlowerThreadView is one replaceable detail snapshot. Its version is the
// in-memory ThreadRuntime view version, never a durable replay cursor.
export type FlowerThreadView = Readonly<{
  thread: FlowerThreadSnapshot;
  current: FlowerRuntimeCurrentView;
}>;

export type FlowerRuntimeComponent<T> = Readonly<{ value: T }>;
export type FlowerRuntimeUpdate = Readonly<{
  thread_id: string;
  turn_id?: string;
  run_id?: string;
  base_version: number;
  view_version: number;
  facts: Pick<FlowerRuntimeCurrentView, 'activity' | 'attention' | 'turn_kind' | 'last_outcome' | 'cancellation' | 'run_progress' | 'sampled_at_ms' | 'error' | 'run_error_code' | 'run_error_detail'> & { queue_count: number };
  items?: readonly Readonly<{
    kind: 'add' | 'replace' | 'remove' | 'append' | 'body';
    body?: FlowerItemBody;
    item_id: string;
    item?: FlowerRuntimeCurrentItem;
    append?: Readonly<{ offset_bytes: number; text: string }>;
  }>[];
  item_order?: FlowerRuntimeComponent<readonly string[]>;
  context?: FlowerRuntimeComponent<Pick<FlowerLiveStreamEnvelope, 'model_context' | 'context_usage' | 'context_compactions' | 'timeline_decorations'>>;
  goal?: FlowerRuntimeComponent<FlowerGoal | null>;
  parent_events?: FlowerRuntimeComponent<FlowerParentEventPage | null>;
  turns?: FlowerRuntimeComponent<readonly FlowerRuntimeTurn[] | null>;
  queue?: FlowerRuntimeComponent<FlowerRuntimeCurrentView['queue'] | null>;
  interactions?: FlowerRuntimeComponent<readonly FlowerRuntimeInteraction[] | null>;
  tool_call_previews?: FlowerRuntimeComponent<readonly FlowerToolCallPreview[] | null>;
  restored_inputs?: FlowerRuntimeComponent<readonly FlowerRestoredInput[] | null>;
}>;

export type FlowerLiveStreamEnvelope = Readonly<{
  baseline_complete?: boolean;
  facts_only?: boolean;
  history_invalidated?: Readonly<{ thread_id: string; parent_thread_id?: string }>;
  reading_revision?: number;
  window?: FlowerHistoryWindow;
  schema_version: number;
  kind: 'ready' | 'summary.batch' | 'thread.batch' | 'viewer.read_state' | 'computer.frame' | 'computer.status' | 'model_directory.changed';
  observer_id?: string;
  thread_id?: string;
  summaries?: readonly FlowerThreadSummary[];
  /** Typed current-state replacement from Floret; never contains replay metadata. */
  current?: FlowerRuntimeCurrentView;
  update?: FlowerRuntimeUpdate;
  /** Parent-scoped typed current-state replacement for one SubAgent thread. */
  subagent_current?: FlowerRuntimeCurrentView;
  subagent_update?: FlowerRuntimeUpdate;
  /** Full replacement of the parent thread's canonical Subagent inventory. */
  subagents?: readonly FlowerSubagentSummary[];
  model_context?: FlowerModelContext | null;
  context_usage?: FlowerContextUsage | null;
  context_compactions?: readonly FlowerContextCompaction[];
  timeline_decorations?: readonly FlowerTimelineDecoration[];
  read_status?: FlowerThreadReadStatus;
  computer_frame?: Readonly<{
    session_id: string;
    target_id: string;
    viewer_revision: number;
    interaction_id?: string;
    frame_id?: string;
    error_code?: string;
    assistance_kind?: string;
    resource_ref?: string;
    sha256?: string;
    mime_type: string;
    width?: number;
    height?: number;
    sequence: number;
    captured_at_ms?: number;
  }>;
  computer_status?: Readonly<{
    thread_id: string;
    interaction_id?: string;
    target_id: string;
    state: 'available' | 'unavailable' | 'changed';
    reason_code?: string;
    at_unix_ms: number;
  }>;
}>;

export type FlowerSubmitApprovalRequest = Readonly<{
  thread_id: string;
  interaction_id?: string;
  interaction_ids?: readonly string[];
  approved: boolean;
  reject_all?: boolean;
}>;

export type FlowerApprovalCommandResult = Readonly<{
  ok: boolean;
  current: FlowerRuntimeCurrentView;
}>;

export type FlowerThreadPinPosition = Readonly<{
  anchor_thread_id: string;
  placement: 'before' | 'after';
}>;

export type FlowerThreadPinMetadata = Readonly<{
  thread_id: string;
  pinned_at_ms: number;
  pin_rank: number;
  settings_revision: number;
}>;

export type FlowerThreadListItem = Readonly<{
  cancellation?: FlowerThreadCancellation;
  thread_id: string;
  title: string;
  title_status: FlowerTitleStatus;
  model_id: string;
  working_dir: string;
  pinned: boolean;
  pinned_at_ms?: number;
  pin_rank?: number;
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
  storage_generation?: string;
  client_request_id: string;
  thread_id?: string;
  staging_scope?: FlowerAttachmentStagingScope;
  prompt: string;
  decision?: FlowerRouterDecision | null;
  context_action?: unknown;
  attachment_ids?: readonly string[];
  working_dir?: string;
  model_id?: string;
  /** Explicit permission override for a new Thread; omitted uses the environment default. */
  permission_type?: FlowerPermissionType;
  reasoning_selection?: FlowerReasoningSelection;
}>;

export type FlowerCompactContextInput = Readonly<{
  continue_goal?: boolean;
  storage_generation: string;
  client_request_id: string;
}>;

export type FlowerTurnLaunchReceipt = Readonly<{
  client_request_id: string;
  thread_id: string;
  /** Immediate canonical detail when available; acceptance does not depend on this projection. */
  current?: FlowerRuntimeCurrentView;
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
  | 'editor_preview'
  | 'tessiven';

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
  /** Localized opening question owned by the launching product surface. */
  opening_question?: string;
  suggested_working_dir?: string;
  context_items: readonly FlowerTurnLauncherContextItem[];
  pending_attachments?: readonly File[];
  notes?: readonly string[];
  context_action?: unknown;
}>;

export type FlowerWorkingDirectoryOpenRequest = Readonly<{
  /** Absent when browsing the current new-conversation draft directory. */
  thread_id?: string;
  path: string;
}>;

export type FlowerWorkingDirectoryActionAvailability = Readonly<{
  browse: Readonly<{ enabled: boolean; reason?: string }>;
  terminal: Readonly<{ enabled: boolean; reason?: string }>;
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
  turn_id?: string;
  queue_id?: string;
  reference_id: string;
}>;

export type FlowerToolPreviewRequest = Readonly<{
  thread_id: string;
  turn_id: string;
  run_id: string;
  tool_call_id: string;
}>;

export type FlowerToolPreview = Readonly<{
  tool_name: string;
  inputs: readonly Readonly<{ title?: string; content?: string; format: 'text'; truncated?: boolean }>[];
  rows: readonly Readonly<{ title?: string; meta?: string; content?: string; format: 'text'; truncated?: boolean }>[];
  total?: number;
  has_more: boolean;
  content_unavailable?: boolean;
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

export type FlowerChatGPTAccountState = 'ready' | 'renewing' | 'temporarily_unavailable' | 'review_required' | 'plan_permission_required' | 'authorization_required' | 'signing_out' | 'signed_out' | 'storage_unavailable';
export type FlowerChatGPTAccount = Readonly<{ account_id: string; email: string; state: FlowerChatGPTAccountState; welcome_acknowledged: boolean; error_code?: string; retry_at?: string; revocation_confirmed?: boolean; binding_count?: number; active_task_count?: number; http_status?: number; request_id?: string }>;
export type FlowerAccountSignOutResult = Readonly<{ account_id: string; local_cleanup_complete: boolean; revocation_confirmed: boolean; error_code?: string }>;
export type FlowerChatGPTAuth = (action: 'start' | 'status' | 'cancel' | 'sign-out' | 'remove' | 'acknowledge' | 'retry', input: Readonly<{ scope_id: string; attempt_id?: string; previous_attempt_id?: string; account_id?: string; reconsent?: boolean; new_registration?: boolean }>) => Promise<Readonly<{ id?: string; state?: string; account?: FlowerChatGPTAccount; error_code?: string; revocation_confirmed?: boolean; local_cleanup_complete?: boolean }>>;
export type FlowerModelCatalogQuery = Readonly<{ provider_id?: string; type: FlowerProviderType; base_url?: string; api_key?: string; auth_method?: 'api_key' | 'chatgpt'; account_id?: string }>;
export type FlowerModelCatalogDiscovery = (input: FlowerModelCatalogQuery) => Promise<Readonly<{ models: readonly FlowerProviderModel[] }>>;

export type FlowerTargetDescriptor = Readonly<{
  id: string;
  kind: string;
  display_name: string;
  state?: string;
  ready: boolean;
  locality?: string;
  app_bundle_id?: string;
}>;

export type FlowerComputerCandidate = Readonly<{
  candidate_ref: string; target_id?: string; kind: string; display_name: string;
  profile_name?: string; title?: string; url?: string; app_bundle_id?: string;
  state: string; new_tab?: boolean;
}>;
export type FlowerComputerInventory = Readonly<{
  browser_source?: 'auto' | 'system' | 'managed'; connection_required?: boolean;
  current_target_id: string; default_candidate_ref?: string; candidates: readonly FlowerComputerCandidate[];
}>;

export type FlowerComputerCapability = Readonly<{ state: 'ready' | 'on_demand' | 'setup_required' | 'permission_required' | 'disabled' | 'installation_required' | 'system_preparation_required' | 'unavailable'; reason?: string }>;
export type FlowerComputerEnvironment = Readonly<{
  hostname: string; platform: string;
  managed: FlowerComputerCapability; desktop: FlowerComputerCapability;
  chrome: FlowerChromeStatus;
}>;

export type FlowerComputerAccess = Readonly<{
  origins: readonly string[];
  apps: readonly string[];
  allow_foreground: boolean;
}>;
export type FlowerChromeDiagnostic = Readonly<{ stage: 'prepare' | 'open' | 'check' | 'continue'; reason: string; diagnostic_id?: string }>;
export type FlowerBrowserDeviceInstallation = Readonly<{ id: string; kind: 'google_chrome' | 'chromium' | 'chromium_snap'; name: string; installed: boolean; prepared: boolean; connected: boolean; diagnostic?: FlowerChromeDiagnostic; reason?: string }>;
export type FlowerChromeStatus = Readonly<{ installations: readonly FlowerBrowserDeviceInstallation[]; profiles: readonly Readonly<{ id: string; name: string; installation_id: string; library_id: string }>[]; prepared?: boolean; error?: 'extension_update_required'; hostname?: string; runtime_version?: string; platform?: string; browser_installed?: boolean; diagnostic?: FlowerChromeDiagnostic }>;
export type FlowerComputerExtensionSetup = Readonly<{ installation_id: string; browser_name: string; native_host: string; extension_id: string; extension_path: string; extension_home_path: readonly string[]; platform: 'darwin' | 'linux' }>;
export type FlowerBrowserInstallation = Readonly<{
  storage_bytes: number;
  launch: Readonly<{ state: 'ready' | 'disabled' | 'installation_required' | 'system_preparation_required' | 'unavailable'; reason?: string; action?: string }>; authorization_command?: string;
  enabled: boolean; state: 'awaiting_authorization' | 'verifying_system' | 'preparing_system' | 'not_installed' | 'installed' | 'downloading' | 'uploading' | 'verifying' | 'installing' | 'failed' | 'cancelled';
  package: Readonly<{ id: string; name: string; platform: string; architecture: string; version: string; url: string; sha256: string; size_bytes: number; installed_bytes: number }>;
  directory: string; operation_id?: string; received_bytes: number; error?: string;
}>;
export type FlowerBrowserInstallationSnapshot = FlowerBrowserInstallation & Readonly<{
  transfer_active?: boolean;
  desktop_progress?: Readonly<{ phase: 'checking' | 'downloading' | 'verifying'; received_bytes: number; total_bytes: number }>;
  desktop_error?: 'package_mismatch' | 'desktop_download_failed' | 'desktop_upload_failed' | 'status_failed';
}>;
export type FlowerBrowserInstallRequest = Readonly<{ action: 'prepare_system' | 'start' | 'chunk' | 'complete' | 'cancel'; package_id?: string; source?: 'download' | 'upload'; operation_id?: string; offset?: number; data?: string }>;
export type FlowerComputerManagement = Readonly<{
  loadBrowserInstallation?: () => Promise<FlowerBrowserInstallationSnapshot>;
  saveBrowserEnabled?: (enabled: boolean) => Promise<FlowerBrowserInstallationSnapshot>;
  installBrowser?: (request: FlowerBrowserInstallRequest) => Promise<FlowerBrowserInstallationSnapshot>;
  browserDesktopAvailable?: boolean;
  subscribeBrowserInstallation?: (listener: (status: FlowerBrowserInstallationSnapshot) => void) => () => void;

  loadEnvironment?: () => Promise<FlowerComputerEnvironment>;
  discoverBrowser?: (threadID: string, endpoint: string) => Promise<FlowerComputerInventory>;
  revealTarget?: (threadID: string, targetID: string) => Promise<void>;
  listCandidates: (threadID: string) => Promise<FlowerComputerInventory>;
  selectCandidate: (threadID: string, candidateRef: string) => Promise<FlowerTargetDescriptor>;
  listManagedProfiles?: () => Promise<readonly Readonly<{ id: string; name: string }>[]>;
  createManagedProfile?: (name: string) => Promise<readonly Readonly<{ id: string; name: string }>[]>;
  openExtension?: (action: 'extensions' | 'folder' | 'connect', installationID: string) => Promise<void>;
  setupExtension?: (installationID: string) => Promise<FlowerComputerExtensionSetup>;
  prepareRemoteBrowser?: (installationID: string, signal: AbortSignal) => Promise<void>;
  loadExtensionStatus?: () => Promise<FlowerChromeStatus>;
  loadAccess: (threadID: string) => Promise<FlowerComputerAccess>;
  saveAccess: (threadID: string, access: FlowerComputerAccess) => Promise<void>;
}>;

export type FlowerComputerUserInput = Readonly<{
  observer_id: string;
  viewer_revision: number;
  thread_id: string;
  interaction_id: string;
  action: 'click' | 'type' | 'key' | 'scroll';
  x?: number; y?: number; text?: string; key?: string; delta_x?: number; delta_y?: number;
}>;

export type FlowerForkThreadInput = Readonly<{
  client_request_id: string;
  title: string;
  source_item_id?: string;
}>;

export type FlowerSurfaceAdapter = Readonly<{
  extensions?: import('../extensions/types').FlowerExtensionsAdapter;
  runtime: FlowerSurfaceRuntimeDescriptor;
  canMutate?: boolean;
  /** Keep the canonical summary stream connected while the document is hidden. */
  keepLiveWhenHidden?: boolean;
  chatGPTAuth?: FlowerChatGPTAuth;
  loadChatGPTAccounts?: () => Promise<Readonly<{ accounts: Readonly<Record<string, FlowerChatGPTAccount>>; saved_accounts: readonly FlowerChatGPTAccount[]; account_sign_outs?: readonly FlowerAccountSignOutResult[] }>>;
  discoverProviderModels?: FlowerModelCatalogDiscovery;
  loadSettings: (refresh?: boolean, signal?: AbortSignal) => Promise<FlowerSettingsSnapshot>;
  loadModelDirectory?: (refresh?: boolean) => Promise<FlowerModelDirectory>;
  subscribeModelDirectory?: (listener: (directory: FlowerModelDirectory) => void) => () => void;
  saveDefaultPermission: (permissionType: FlowerPermissionType) => Promise<FlowerSettingsSnapshot>;
  saveComputerUseEnabled?: (enabled: boolean) => Promise<FlowerSettingsSnapshot>;
  saveAutoUpdateModelCatalog?: (enabled: boolean) => Promise<FlowerSettingsSnapshot>;
  saveModelProfile: (draft: FlowerSettingsDraft) => Promise<FlowerSettingsSnapshot>;
  listThreads: (options?: { signal?: AbortSignal; onPage?: (threads: readonly FlowerThreadSnapshot[]) => void }) => Promise<readonly FlowerThreadSnapshot[]>;
  loadThread: (threadID: string, signal: AbortSignal) => Promise<FlowerThreadView>;
  releaseHistory?: (threadID: string, input: { observer_id: string; reading_revision: number; subagent?: boolean }) => Promise<void>;
  loadHistory?: (threadID: string, input: FlowerHistoryRequest, signal: AbortSignal) => Promise<FlowerThreadView>;
  loadActivityValue?: (threadID: string, input: FlowerActivityValueRequest, signal: AbortSignal) => Promise<FlowerActivityValue>;
  loadActivityStructure?: (threadID: string, input: FlowerActivityStructureRequest, signal: AbortSignal) => Promise<FlowerActivityStructurePage>;
  loadActivityField?: (threadID: string, input: FlowerActivityFieldRequest, signal: AbortSignal) => Promise<FlowerActivityFieldChunk>;
  loadHistoryItem?: (threadID: string, itemID: string, signal: AbortSignal) => Promise<FlowerRuntimeCurrentItem>;
  loadHistoryBody?: (threadID: string, input: FlowerHistoryBodyRequest, signal: AbortSignal) => Promise<FlowerHistoryBodyChunk>;
  connectLiveStream?: (input: FlowerLiveStreamConnectInput) => AsyncIterable<FlowerLiveStreamEnvelope>;
  readParentEvents?: (threadID: string, query: FlowerParentEventQuery, signal?: AbortSignal) => Promise<FlowerParentEventPage>;
  loadSubagentDetail: (parentThreadID: string, childThreadID: string, input?: FlowerHistoryRequest, signal?: AbortSignal) => Promise<FlowerSubagentDetail>;
  operateSubagentInput?: (parentThreadID: string, childThreadID: string, input: FlowerSubagentInputOperation) => Promise<FlowerSubagentDetail>;
  markThreadRead: (threadID: string, snapshot: FlowerThreadActivitySnapshot) => Promise<FlowerThreadReadStatus>;
  renameThread?: (threadID: string, title: string) => Promise<FlowerThreadView>;
  setThreadPinned?: (threadID: string, pinned: boolean) => Promise<readonly FlowerThreadPinMetadata[]>;
  movePinnedThread?: (threadID: string, input: FlowerThreadPinPosition) => Promise<readonly FlowerThreadPinMetadata[]>;
  setThreadPermissionType?: (threadID: string, permissionType: FlowerPermissionType) => Promise<FlowerThreadView>;
  persistDefaultModel: (modelID: string) => Promise<FlowerSettingsSnapshot>;
  saveConversationPreferences?: (patch: FlowerConversationPreferencePatch) => Promise<FlowerConversationPreferences>;
  setThreadModel?: (threadID: string, modelID: string) => Promise<FlowerThreadView>;
  setThreadReasoningSelection?: (threadID: string, selection: FlowerReasoningSelection | undefined) => Promise<FlowerThreadView>;
  reorderQueuedTurns?: (threadID: string, orderedQueueIDs: readonly string[]) => Promise<void>;
  deleteQueuedTurn?: (threadID: string, queueID: string) => Promise<void>;
  prepareQueuedTurnDraft?: (threadID: string, queueID: string, input: FlowerQueuedDraftInput) => Promise<FlowerQueuedDraft>;
  takeBackQueuedTurn?: (threadID: string, queueID: string, fingerprint: string) => Promise<FlowerRuntimeCurrentView>;
  editQueuedTurn?: (threadID: string, queueID: string, input: FlowerQueuedTurnEditInput) => Promise<void>;
  sendQueuedTurnNow?: (threadID: string, queueID: string) => Promise<void>;
  forkThread?: (threadID: string, input: FlowerForkThreadInput) => Promise<FlowerThreadSnapshot>;
  deleteThread?: (threadID: string) => Promise<void>;
  resolveHandler: (input?: FlowerResolveHandlerInput) => Promise<FlowerRouterDecision>;
  loadAttachmentCapability?: (modelID: string) => Promise<FlowerAttachmentCapability>;
  createAttachmentStagingScope?: (targetID?: string) => Promise<FlowerAttachmentStagingScope>;
  bindAttachmentStagingScope?: (scope: FlowerAttachmentStagingScope, threadID: string) => Promise<FlowerAttachmentStagingScope>;
  releaseAttachmentStagingScope?: (scope: FlowerAttachmentStagingScope) => Promise<void>;
  uploadAttachment?: (input: FlowerAttachmentUploadInput) => Promise<FlowerStagedAttachment>;
  deleteStagedAttachment?: (attachmentID: string, scope: FlowerAttachmentStagingScope) => Promise<void>;
  readStagedLongText?: (attachment: FlowerStagedAttachment, scope: FlowerAttachmentStagingScope) => Promise<FlowerStagedLongTextReadResult>;
  loadStagedAttachmentPreview?: (attachment: FlowerStagedAttachment, scope: FlowerAttachmentStagingScope, signal: AbortSignal) => Promise<Blob>;
  previewStagedAttachment?: (attachment: FlowerStagedAttachment, scope: FlowerAttachmentStagingScope) => void | Promise<void>;
  loadComputerFrame?: (input: FlowerComputerFrameSource & Readonly<{ signal: AbortSignal }>) => Promise<Blob>;
  loadToolImage?: (input: Readonly<{ thread_id: string; resource_ref: string; signal: AbortSignal }>) => Promise<Blob>;
  resolveSourceIcon?: (origin: string) => Promise<Readonly<{ data_url?: string; expires_at: string }>>;
  loadMessageAttachment?: (input: Readonly<{ url: string; signal: AbortSignal }>) => Promise<Blob>;
  openMessageFile?: (input: Readonly<{ path: string; action: 'preview' | 'reveal'; kind?: 'file' | 'directory'; signal?: AbortSignal }>) => Promise<void>;
  openMessageURL?: (input: Readonly<{ url: string; signal: AbortSignal }>) => Promise<void>;
  loadMessageFile?: (input: Readonly<{ path: string; signal: AbortSignal }>) => Promise<Blob>;
  computerFrameRate?: Readonly<{ read: () => number; write: (fps: number) => void }>;
  inputComputerControl?: (input: FlowerComputerUserInput) => Promise<void>;
  setComputerViewer?: (input: Readonly<{
    observer_id: string; revision: number; thread_id?: string; target_id?: string; resource_ref?: string;
    interaction_id?: string; fps?: number;
  }>) => Promise<void>;
  computerManagement?: FlowerComputerManagement;
  resolveStorageGeneration?: () => Promise<string>;
  launchTurn: (input: FlowerTurnLaunchInput) => Promise<FlowerTurnLaunchReceipt>;
  manageGoal?: (input: FlowerGoalInput) => Promise<FlowerGoalResult>;
  compactThreadContext?: (threadID: string, input: FlowerCompactContextInput) => Promise<FlowerRuntimeCurrentView>;
  retryThread: (threadID: string) => Promise<void>;
  stopThread: (threadID: string) => Promise<void>;
  submitInput: (input: FlowerSubmitInputRequest) => Promise<FlowerSubmitInputReceipt>;
  submitApproval: (input: FlowerSubmitApprovalRequest) => Promise<FlowerApprovalCommandResult>;
  loadToolPreview?: (input: FlowerToolPreviewRequest) => Promise<FlowerToolPreview>;
  readTerminalProcess?: (input: FlowerTerminalProcessReadRequest, signal?: AbortSignal) => Promise<FlowerTerminalProcessSnapshot>;
  getWorkingDirectoryPathContext?: () => Promise<FlowerWorkingDirectoryPathContext>;
  directoryFavorites?: (failureMessage: () => string) => DirectoryFavorites | undefined;
  listWorkingDirectoryEntries?: (input: FlowerWorkingDirectoryListInput) => Promise<readonly FlowerWorkingDirectoryEntry[]>;
  openCanonicalReference?: (request: FlowerCanonicalReferenceOpenRequest) => Promise<void>;
  resolveCanonicalReference?: (request: FlowerCanonicalReferenceOpenRequest) => Promise<Readonly<{ kind: 'file' | 'directory'; label: string; path: string }>>;
  openLinkedFilePreview?: (request: FlowerLinkedContextPathOpenRequest) => Promise<void>;
  openWorkingDirectoryInFileBrowser?: (request: FlowerWorkingDirectoryOpenRequest) => Promise<void>;
  openWorkingDirectoryInTerminal?: (request: FlowerWorkingDirectoryOpenRequest) => Promise<void>;
  workingDirectoryActionAvailability?: () => FlowerWorkingDirectoryActionAvailability;
  openLinkedDirectoryBrowser?: (request: FlowerLinkedContextPathOpenRequest) => Promise<void>;
  modelSourceRecovery?: FlowerModelSourceRecovery;
  recoverModelSource?: () => Promise<void>;
}>;

export type FlowerComputerFrameSource = Readonly<{ thread_id: string; target_id: string }> & (
  Readonly<{ resource_ref: string; sha256: string; viewer_revision?: number; sequence?: number; private_frame?: never }>
  | Readonly<{ private_frame: Readonly<{ observer_id: string; viewer_revision: number; interaction_id: string; frame_id: string }>; resource_ref?: never; sha256?: never }>
);
export type FlowerComputerInputCommand = Omit<FlowerComputerUserInput, 'thread_id' | 'interaction_id' | 'observer_id' | 'viewer_revision'>;
