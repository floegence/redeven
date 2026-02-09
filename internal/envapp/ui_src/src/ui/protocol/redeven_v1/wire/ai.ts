export type wire_ai_attachment = {
  name: string;
  mime_type: string;
  url: string;
};

export type wire_ai_start_run_req = {
  thread_id: string;
  model?: string;
  input: {
    text: string;
    attachments: wire_ai_attachment[];
  };
  options: {
    max_steps: number;
  };
};

export type wire_ai_start_run_resp = {
  run_id: string;
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

export type wire_ai_subscribe_req = Record<string, never>;

export type wire_ai_subscribe_resp = {
  active_runs: wire_ai_active_run[];
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
  event_type: 'stream_event' | 'thread_state';
  endpoint_id: string;
  thread_id: string;
  run_id: string;
  at_unix_ms: number;
  stream_event?: any;
  run_status?: string;
  run_error?: string;
};
