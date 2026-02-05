export type wire_sessions_active_session = {
  channel_id: string;

  user_public_id: string;
  user_email: string;

  floe_app: string;
  code_space_id?: string;
  session_kind?: string;
  tunnel_url: string;

  created_at_unix_ms: number;
  connected_at_unix_ms: number;

  can_read: boolean;
  can_write: boolean;
  can_execute: boolean;
};

export type wire_sessions_list_active_req = Record<string, never>;

export type wire_sessions_list_active_resp = {
  sessions: wire_sessions_active_session[];
};
