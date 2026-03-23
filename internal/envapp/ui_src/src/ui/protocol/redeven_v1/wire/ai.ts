export type wire_ai_attachment = {
  name: string;
  mime_type: string;
  url: string;
};

export type wire_ai_request_user_input_action = {
  type: string;
  mode?: string;
};

export type wire_ai_request_user_input_choice = {
  choice_id?: string;
  option_id?: string;
  label: string;
  description?: string;
  kind?: string;
  input_placeholder?: string;
  detail_input_mode?: string;
  detail_input_placeholder?: string;
  actions?: wire_ai_request_user_input_action[];
};

export type wire_ai_request_user_input_question = {
  id: string;
  header: string;
  question: string;
  is_secret: boolean;
  choices?: wire_ai_request_user_input_choice[];
  is_other?: boolean;
  options?: wire_ai_request_user_input_choice[];
};

export type wire_ai_waiting_prompt = {
  prompt_id: string;
  message_id: string;
  tool_id: string;
  reason_code?: string;
  required_from_user?: string[];
  evidence_refs?: string[];
  public_summary?: string;
  contains_secret?: boolean;
  questions?: wire_ai_request_user_input_question[];
};

export type wire_ai_request_user_input_answer = {
  choice_id?: string;
  text?: string;
  selected_option_id?: string;
  answers?: string[];
};

export type wire_ai_request_user_input_response = {
  prompt_id: string;
  answers: Record<string, wire_ai_request_user_input_answer>;
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
  queue_after_waiting_user?: boolean;
  source_followup_id?: string;
};

export type wire_ai_send_user_turn_resp = {
  run_id: string;
  kind: string;
  queue_id?: string;
  queue_position?: number;
  consumed_waiting_prompt_id?: string;
  applied_execution_mode?: string;
};

export type wire_ai_submit_structured_prompt_response_req = {
  thread_id: string;
  model?: string;
  response: wire_ai_request_user_input_response;
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
  source_followup_id?: string;
};

export type wire_ai_submit_structured_prompt_response_resp = {
  run_id: string;
  kind: string;
  consumed_waiting_prompt_id?: string;
  applied_execution_mode?: string;
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
  event_type: 'stream_event' | 'thread_state' | 'transcript_message' | 'transcript_reset' | 'thread_summary';
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
  execution_mode?: string;
  queued_turn_count?: number;

  // transcript_reset only
  reset_reason?: string;
  reset_checkpoint_id?: string;
};

export type wire_ai_thread_rewind_req = {
  thread_id: string;
};

export type wire_ai_thread_rewind_resp = {
  ok: boolean;
  checkpoint_id?: string;
};

export type wire_ai_followup_attachment = {
  name: string;
  mime_type?: string;
  url?: string;
};

export type wire_ai_followup_item = {
  followup_id: string;
  lane: string;
  message_id: string;
  text: string;
  model_id?: string;
  execution_mode?: string;
  position: number;
  created_at_unix_ms: number;
  attachments?: wire_ai_followup_attachment[];
};

export type wire_ai_stop_thread_req = {
  thread_id: string;
};

export type wire_ai_stop_thread_resp = {
  ok: boolean;
  recovered_followups?: wire_ai_followup_item[];
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
