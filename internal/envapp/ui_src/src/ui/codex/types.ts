export type CodexStatus = Readonly<{
  enabled: boolean;
  ready: boolean;
  binary_path?: string;
  default_model?: string;
  approval_policy?: string;
  sandbox_mode?: string;
  agent_home_dir?: string;
  error?: string;
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
  pending_requests?: CodexPendingRequest[];
  last_event_seq: number;
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
    | 'reasoning_delta'
    | 'request_created'
    | 'request_resolved'
    | 'thread_status_changed'
    | 'thread_archived'
    | string;
  thread_id: string;
  turn_id?: string;
  item_id?: string;
  request_id?: string;
  thread?: CodexThread;
  turn?: CodexTurn;
  item?: CodexItem;
  request?: CodexPendingRequest;
  delta?: string;
  status?: string;
  flags?: string[];
  error?: string;
}>;

export type CodexTranscriptItem = CodexItem & Readonly<{
  order: number;
}>;

export type CodexThreadSession = Readonly<{
  thread: CodexThread;
  items_by_id: Record<string, CodexTranscriptItem>;
  item_order: string[];
  pending_requests: Record<string, CodexPendingRequest>;
  last_event_seq: number;
  active_status: string;
  active_status_flags: string[];
}>;
