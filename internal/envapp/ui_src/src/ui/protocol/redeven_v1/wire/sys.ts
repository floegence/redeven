export type wire_sys_ping_req = Record<string, never>;

export type wire_sys_ping_resp = {
  server_time_ms: number;
  agent_instance_id?: string;
  version?: string;
  commit?: string;
  build_time?: string;
};

export type wire_sys_upgrade_req = {
  dry_run?: boolean;
  target_version?: string;
};

export type wire_sys_upgrade_resp = {
  ok: boolean;
  message?: string;
};

export type wire_sys_restart_req = Record<string, never>;

export type wire_sys_restart_resp = {
  ok: boolean;
  message?: string;
};
