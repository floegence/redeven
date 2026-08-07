export type wire_terminal_foreground_command_info = {
  phase: 'unknown' | 'idle' | 'running';
  display_name: string;
  revision: number;
  updated_at_ms: number;
};

export type wire_terminal_output_activity_info = {
  phase: 'unknown' | 'streaming' | 'settled';
  revision: number;
  updated_at_ms: number;
};

export type wire_terminal_location_info = {
  kind: 'unknown' | 'local' | 'remote';
  phase: 'unknown' | 'opening' | 'ready';
  label: string;
  authority: string;
  working_directory: string;
  source: 'unknown' | 'shell_integration' | 'osc7' | 'osc_title' | 'foreground_candidate';
};

export type wire_terminal_application_info = {
  kind: 'unknown' | 'shell' | 'agent_cli' | 'interactive_app';
  identity: string;
  display_name: string;
};

export type wire_terminal_execution_context_info = {
  location: wire_terminal_location_info;
  application: wire_terminal_application_info;
  revision: number;
  updated_at_ms: number;
};

export type wire_terminal_work_state_info = {
  phase: 'unknown' | 'idle' | 'working' | 'waiting_user';
  source: '' | 'semantic';
  context_revision: number;
  foreground_command_revision: number;
  revision: number;
  updated_at_ms: number;
};

export type wire_terminal_local_path_capability = {
  working_dir: string;
};

export type wire_terminal_session_info = {
  id: string;
  name: string;
  working_dir: string;
  created_at_ms: number;
  last_active_at_ms: number;
  is_active: boolean;
  foreground_command?: wire_terminal_foreground_command_info;
  output_activity?: wire_terminal_output_activity_info;
  execution_context?: wire_terminal_execution_context_info;
  work_state?: wire_terminal_work_state_info;
  local_path_capability?: wire_terminal_local_path_capability;
};

export type wire_terminal_session_create_req = {
  name?: string;
  working_dir?: string;
};

export type wire_terminal_session_create_resp = {
  session: wire_terminal_session_info;
};

export type wire_terminal_session_list_req = Record<string, never>;
export type wire_terminal_session_list_resp = {
  sessions: wire_terminal_session_info[];
};

export type wire_terminal_name_update_notify = {
  session_id: string;
  new_name: string;
  working_dir: string;
  local_path_capability: wire_terminal_local_path_capability | null;
};

export type wire_terminal_foreground_command_update_notify = {
  session_id: string;
  foreground_command: wire_terminal_foreground_command_info;
};

export type wire_terminal_output_activity_update_notify = {
  session_id: string;
  output_activity: wire_terminal_output_activity_info;
};

export type wire_terminal_execution_context_update_notify = {
  session_id: string;
  execution_context: wire_terminal_execution_context_info;
};

export type wire_terminal_work_state_update_notify = {
  session_id: string;
  work_state: wire_terminal_work_state_info;
};

export type wire_terminal_history_req = {
  session_id: string;
  start_seq: number;
  end_seq: number;
  history_generation?: number;
  limit_chunks?: number;
  max_bytes?: number;
};

export type wire_terminal_history_chunk = {
  sequence: number;
  timestamp_ms: number;
  data_b64: string;
  geometry_generation?: number;
  cols?: number;
  rows?: number;
};

export type wire_terminal_history_resp = {
  chunks: wire_terminal_history_chunk[];
  next_start_seq?: number;
  has_more?: boolean;
  first_sequence?: number;
  last_sequence?: number;
  covered_through_sequence?: number;
  snapshot_end_sequence?: number;
  first_retained_sequence?: number;
  history_generation?: number;
  history_reset?: boolean;
  history_truncated?: boolean;
  covered_bytes?: number;
  total_bytes?: number;
};

export type wire_terminal_clear_req = {
  session_id: string;
};

export type wire_terminal_clear_resp = {
  ok: boolean;
};

export type wire_terminal_session_delete_req = {
  session_id: string;
};

export type wire_terminal_session_delete_resp = {
  ok: boolean;
};

export type wire_terminal_session_stats_req = {
  session_id: string;
};

export type wire_terminal_session_stats_resp = {
  history: {
    total_bytes: number;
  };
};

export type wire_terminal_sessions_changed_notify = {
  reason: 'created' | 'closing' | 'closed' | 'deleted' | 'close_failed_hidden';
  session_id?: string;
  timestamp_ms?: number;
  lifecycle?: 'open' | 'closing' | 'closed' | 'close_failed_hidden';
  hidden?: boolean;
  owner_widget_id?: string;
  failure_code?: string;
  failure_message?: string;
};
