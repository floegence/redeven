export type CodexStatus = Readonly<{
  available: boolean;
  ready: boolean;
  binary_path?: string;
  agent_home_dir?: string;
  error?: string;
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

export type CodexCapabilitiesSnapshot = Readonly<{
  models?: CodexModelOption[];
  effective_config?: CodexThreadRuntimeConfig;
  requirements?: CodexConfigRequirements | null;
}>;

export type CodexComposerAttachmentDraft = Readonly<{
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  data_url: string;
  preview_url: string;
}>;

export type CodexOptimisticUserTurn = Readonly<{
  id: string;
  thread_id: string;
  text: string;
  inputs: CodexUserInputEntry[];
}>;

export type CodexFileChange = Readonly<{
  path: string;
  kind: string;
  move_path?: string;
  diff?: string;
}>;

export type CodexUserInputEntry = Readonly<{
  type: string;
  text?: string;
  url?: string;
  path?: string;
  name?: string;
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
  active_status: string;
  active_status_flags: string[];
}>;
