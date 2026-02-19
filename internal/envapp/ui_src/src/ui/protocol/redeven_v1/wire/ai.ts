export type wire_ai_attachment = {
  name: string;
  mime_type: string;
  url: string;
};

export type wire_ai_waiting_prompt = {
  prompt_id: string;
  message_id: string;
  tool_id: string;
};

export type wire_ai_send_user_turn_req = {
  thread_id: string;
  model?: string;
  input: {
    message_id?: string;
    text: string;
    attachments: wire_ai_attachment[];
  };
  options: {
    max_steps: number;
    mode?: string;
  };
  expected_run_id?: string;
  reply_to_waiting_prompt_id?: string;
};

export type wire_ai_send_user_turn_resp = {
  run_id: string;
  kind: string;
  consumed_waiting_prompt_id?: string;
};

export type wire_ai_cancel_run_req = {
  run_id?: string;
  thread_id?: string;
};

export type wire_ai_cancel_run_resp = {
  ok: boolean;
};

export type wire_ai_active_run = {
  thread_id: string;
  run_id: string;
};

export type wire_ai_subscribe_summary_req = Record<string, never>;

export type wire_ai_subscribe_summary_resp = {
  active_runs: wire_ai_active_run[];
};

export type wire_ai_subscribe_thread_req = {
  thread_id: string;
};

export type wire_ai_subscribe_thread_resp = {
  run_id?: string;
};

export type wire_ai_tool_approval_req = {
  run_id: string;
  tool_id: string;
  approved: boolean;
};

export type wire_ai_tool_approval_resp = {
  ok: boolean;
};

export type wire_ai_event_notify = {
  event_type: 'stream_event' | 'thread_state' | 'transcript_message' | 'thread_summary';
  endpoint_id: string;
  thread_id: string;
  run_id: string;
  at_unix_ms: number;
  stream_kind?: 'lifecycle' | 'assistant' | 'tool' | 'context';
  phase?: 'start' | 'state_change' | 'end' | 'error';
  diag?: Record<string, any>;
  stream_event?: any;
  run_status?: string;
  run_error?: string;
  waiting_prompt?: wire_ai_waiting_prompt;

  message_row_id?: number;
  message_json?: any;

  // thread_summary only
  title?: string;
  updated_at_unix_ms?: number;
  last_message_preview?: string;
  last_message_at_unix_ms?: number;
  active_run_id?: string;
};

export type wire_ai_list_messages_req = {
  thread_id: string;
  after_row_id?: number;
  tail?: boolean;
  limit?: number;
};

export type wire_ai_transcript_message_item = {
  row_id: number;
  message_json: any;
};

export type wire_ai_list_messages_resp = {
  messages: wire_ai_transcript_message_item[];
  next_after_row_id?: number;
  has_more?: boolean;
};

export type wire_ai_get_active_run_snapshot_req = {
  thread_id: string;
};

export type wire_ai_get_active_run_snapshot_resp = {
  ok: boolean;
  run_id?: string;
  message_json?: any;
};

export type wire_ai_set_tool_collapsed_req = {
  thread_id: string;
  message_id: string;
  tool_id: string;
  collapsed: boolean;
};

export type wire_ai_set_tool_collapsed_resp = {
  ok: boolean;
};
