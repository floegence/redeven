export type wire_terminal_session_info = {
  id: string;
  name: string;
  working_dir: string;
  created_at_ms: number;
  last_active_at_ms: number;
  is_active: boolean;
};

export type wire_terminal_session_create_req = {
  name?: string;
  working_dir?: string;
  cols: number;
  rows: number;
};

export type wire_terminal_session_create_resp = {
  session: wire_terminal_session_info;
};

export type wire_terminal_session_list_req = Record<string, never>;
export type wire_terminal_session_list_resp = {
  sessions: wire_terminal_session_info[];
};

export type wire_terminal_session_attach_req = {
  session_id: string;
  conn_id: string;
  cols: number;
  rows: number;
};

export type wire_terminal_session_attach_resp = {
  ok: boolean;
};

export type wire_terminal_input_notify = {
  session_id: string;
  conn_id: string;
  data_b64: string;
};

export type wire_terminal_output_notify = {
  session_id: string;
  data_b64: string;
  sequence?: number;
  timestamp_ms?: number;
  echo_of_input?: boolean;
  original_source?: string;
};

export type wire_terminal_resize_notify = {
  session_id: string;
  conn_id: string;
  cols: number;
  rows: number;
};

export type wire_terminal_name_update_notify = {
  session_id: string;
  new_name: string;
  working_dir: string;
};

export type wire_terminal_history_req = {
  session_id: string;
  start_seq: number;
  end_seq: number;
};

export type wire_terminal_history_chunk = {
  sequence: number;
  timestamp_ms: number;
  data_b64: string;
};

export type wire_terminal_history_resp = {
  chunks: wire_terminal_history_chunk[];
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
  reason: 'created' | 'closed' | 'deleted';
  session_id?: string;
  timestamp_ms?: number;
};
