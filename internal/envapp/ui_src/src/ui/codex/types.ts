export type CodexStatus = Readonly<{
  available: boolean;
  ready: boolean;
  binary_path?: string;
  agent_home_dir?: string;
  error?: string;
}>;

export type CodexSurfaceActivationSnapshot = Readonly<{
  mounted: boolean;
  active: boolean;
  activation_seq: number;
  after_paint_seq: number;
}>;

export type CodexThreadRuntimeConfig = Readonly<{
  model?: string;
  model_provider?: string;
  cwd?: string;
  approval_policy?: string;
  approvals_reviewer?: string;
  sandbox_mode?: string;
  reasoning_effort?: string;
}>;

export type CodexModelOption = Readonly<{
  id: string;
  display_name: string;
  description?: string;
  is_default?: boolean;
  supports_image_input?: boolean;
  default_reasoning_effort?: string;
  supported_reasoning_efforts?: string[];
}>;

export type CodexConfigRequirements = Readonly<{
  allowed_approval_policies?: string[];
  allowed_sandbox_modes?: string[];
}>;

export type CodexOperationName =
  | 'thread_archive'
  | 'thread_unarchive'
  | 'thread_fork'
  | 'thread_list_archived'
  | 'turn_steer'
  | 'turn_interrupt'
  | 'review_start';

export type CodexCapabilitiesSnapshot = Readonly<{
  models?: CodexModelOption[];
  effective_config?: CodexThreadRuntimeConfig;
  requirements?: CodexConfigRequirements | null;
  operations?: CodexOperationName[];
}>;

export type CodexForkThreadRequest = Readonly<{
  thread_id: string;
  model?: string;
  approval_policy?: string;
  sandbox_mode?: string;
  approvals_reviewer?: string;
}>;

export type CodexInterruptTurnRequest = Readonly<{
  thread_id: string;
  turn_id: string;
}>;

export type CodexSteerTurnRequest = Readonly<{
  thread_id: string;
  expected_turn_id: string;
  inputs: CodexUserInputEntry[];
}>;

export type CodexReviewStartRequest = Readonly<{
  thread_id: string;
  target: 'uncommitted_changes';
}>;

export type CodexComposerAttachmentDraft = Readonly<{
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  data_url: string;
  preview_url: string;
}>;

export type CodexComposerMentionDraft = Readonly<{
  id: string;
  name: string;
  path: string;
  kind: 'file';
  is_image: boolean;
}>;

export type CodexOptimisticUserTurn = Readonly<{
  id: string;
  thread_id: string;
  text: string;
  inputs: CodexUserInputEntry[];
}>;

export type CodexQueuedFollowupRuntimeConfig = Readonly<{
  cwd: string;
  model: string;
  effort: string;
  approval_policy: string;
  sandbox_mode: string;
  approvals_reviewer: string;
}>;

export type CodexDispatchingInput = Readonly<{
  id: string;
  thread_id: string;
  text: string;
  attachments: CodexComposerAttachmentDraft[];
  mentions: CodexComposerMentionDraft[];
  runtime_config: CodexQueuedFollowupRuntimeConfig;
  created_at_unix_ms: number;
  source: 'send_now' | 'auto_send';
}>;

export type CodexQueuedFollowup = Readonly<{
  id: string;
  thread_id: string;
  text: string;
  attachments: CodexComposerAttachmentDraft[];
  mentions: CodexComposerMentionDraft[];
  runtime_config: CodexQueuedFollowupRuntimeConfig;
  created_at_unix_ms: number;
  source: 'queued' | 'rejected_steer' | 'auto_send';
}>;

export type CodexFileChange = Readonly<{
  path: string;
  kind: string;
  move_path?: string;
  diff?: string;
}>;

export type CodexTextElement = Readonly<{
  start: number;
  end: number;
  placeholder?: string;
}>;

export type CodexUserInputEntry = Readonly<{
  type: string;
  text?: string;
  url?: string;
  path?: string;
  name?: string;
  text_elements?: CodexTextElement[];
}>;

export type CodexWebSearchAction = Readonly<{
  type: string;
  query?: string;
  queries?: string[];
  url?: string;
  pattern?: string;
}>;

export type CodexTokenUsageBreakdown = Readonly<{
  total_tokens: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
}>;

export type CodexThreadTokenUsage = Readonly<{
  total: CodexTokenUsageBreakdown;
  last: CodexTokenUsageBreakdown;
  model_context_window?: number;
}>;

export type CodexThreadReadSnapshot = Readonly<{
  updated_at_unix_s: number;
  activity_signature?: string;
}>;

export type CodexThreadReadState = Readonly<{
  last_read_updated_at_unix_s: number;
  last_seen_activity_signature?: string;
}>;

export type CodexThreadReadStatus = Readonly<{
  is_unread: boolean;
  snapshot: CodexThreadReadSnapshot;
  read_state: CodexThreadReadState;
}>;

export type CodexThreadStreamState = Readonly<{
  last_applied_seq: number;
  oldest_retained_seq: number;
  stream_epoch: number;
  last_event_at_unix_ms: number;
}>;

export type CodexEventTransport = Readonly<{
  state?: 'lagged' | 'desynced' | string;
  reason?: string;
  dropped_events?: number;
  reset_required?: boolean;
}>;

export type CodexStreamTransportPhase =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'lagged'
  | 'reconnecting'
  | 'desynced'
  | 'closed';

export type CodexStreamTransportState = Readonly<{
  phase: CodexStreamTransportPhase;
  thread_id: string | null;
  retry_count: number;
  last_event_at_unix_ms: number | null;
  last_disconnect_reason: string | null;
  last_lagged_dropped_events: number;
  stream_epoch: number | null;
  desync_reason: string | null;
}>;

export type CodexItem = Readonly<{
  id: string;
  type: string;
  text?: string;
  phase?: string;
  summary?: string[];
  content?: string[];
  command?: string;
  cwd?: string;
  status?: string;
  aggregated_output?: string;
  exit_code?: number;
  duration_ms?: number;
  changes?: CodexFileChange[];
  query?: string;
  action?: CodexWebSearchAction;
  inputs?: CodexUserInputEntry[];
}>;

export type CodexTurnError = Readonly<{
  message: string;
  additional_details?: string;
  codex_error_code?: string;
}>;

export type CodexTurn = Readonly<{
  id: string;
  kind?: string;
  accepts_steer?: boolean;
  status: string;
  error?: CodexTurnError | null;
  items?: CodexItem[];
}>;

export type CodexThread = Readonly<{
  id: string;
  preview: string;
  ephemeral: boolean;
  model_provider: string;
  created_at_unix_s: number;
  updated_at_unix_s: number;
  status: string;
  active_flags?: string[];
  path?: string;
  cwd: string;
  cli_version?: string;
  source?: string;
  agent_nickname?: string;
  agent_role?: string;
  name?: string;
  turns?: CodexTurn[];
  read_status?: CodexThreadReadStatus;
}>;

export type CodexPermissionProfile = Readonly<{
  file_system_read?: string[];
  file_system_write?: string[];
  network_enabled?: boolean;
}>;

export type CodexUserInputOption = Readonly<{
  label: string;
  description: string;
}>;

export type CodexUserInputQuestion = Readonly<{
  id: string;
  header: string;
  question: string;
  is_other: boolean;
  is_secret: boolean;
  options?: CodexUserInputOption[];
}>;

export type CodexPendingRequest = Readonly<{
  id: string;
  type: 'command_approval' | 'file_change_approval' | 'user_input' | 'permissions' | string;
  thread_id: string;
  turn_id: string;
  item_id: string;
  reason?: string;
  command?: string;
  cwd?: string;
  grant_root?: string;
  available_decisions?: string[];
  questions?: CodexUserInputQuestion[];
  permissions?: CodexPermissionProfile | null;
  additional_permissions?: CodexPermissionProfile | null;
}>;

export type CodexThreadDetail = Readonly<{
  thread: CodexThread;
  runtime_config?: CodexThreadRuntimeConfig;
  pending_requests?: CodexPendingRequest[];
  token_usage?: CodexThreadTokenUsage | null;
  last_applied_seq: number;
  stream?: CodexThreadStreamState;
  active_status?: string;
  active_status_flags?: string[];
}>;

export type CodexEvent = Readonly<{
  seq: number;
  type:
    | 'thread_started'
    | 'turn_started'
    | 'turn_completed'
    | 'item_started'
    | 'item_completed'
    | 'agent_message_delta'
    | 'command_output_delta'
    | 'file_change_delta'
    | 'plan_delta'
    | 'reasoning_delta'
    | 'reasoning_summary_delta'
    | 'reasoning_summary_part_added'
    | 'request_created'
    | 'request_resolved'
    | 'thread_status_changed'
    | 'thread_name_updated'
    | 'thread_token_usage_updated'
    | 'thread_archived'
    | 'thread_unarchived'
    | 'thread_closed'
    | 'error'
    | string;
  thread_id: string;
  turn_id?: string;
  item_id?: string;
  request_id?: string;
  thread?: CodexThread;
  turn?: CodexTurn;
  item?: CodexItem;
  request?: CodexPendingRequest;
  token_usage?: CodexThreadTokenUsage | null;
  stream?: CodexThreadStreamState;
  transport?: CodexEventTransport;
  delta?: string;
  status?: string;
  flags?: string[];
  thread_name?: string;
  summary_index?: number;
  content_index?: number;
  error?: string;
  will_retry?: boolean;
}>;

export type CodexTranscriptItem = CodexItem & Readonly<{
  order: number;
}>;

export type CodexThreadSession = Readonly<{
  thread: CodexThread;
  runtime_config: CodexThreadRuntimeConfig;
  items_by_id: Record<string, CodexTranscriptItem>;
  item_order: string[];
  pending_requests: Record<string, CodexPendingRequest>;
  token_usage?: CodexThreadTokenUsage | null;
  last_applied_seq: number;
  stream: CodexThreadStreamState;
  active_status: string;
  active_status_flags: string[];
}>;
