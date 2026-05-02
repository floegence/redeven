export type wire_sys_ping_req = Record<string, never>;

export type wire_sys_ping_resp = {
  server_time_ms: number;
  agent_instance_id?: string;
  process_started_at_ms?: number;
  version?: string;
  commit?: string;
  build_time?: string;
  maintenance?: {
    kind?: string;
    state?: string;
    target_version?: string;
    message?: string;
    started_at_ms?: number;
    updated_at_ms?: number;
  };
  runtime_service?: {
    runtime_version?: string;
    runtime_commit?: string;
    runtime_build_time?: string;
    protocol_version?: string;
    compatibility_epoch?: number;
    service_owner?: string;
    desktop_managed?: boolean;
    effective_run_mode?: string;
    remote_enabled?: boolean;
    compatibility?: string;
    compatibility_message?: string;
    minimum_desktop_version?: string;
    minimum_runtime_version?: string;
    compatibility_review_id?: string;
    active_workload?: {
      terminal_count?: number;
      session_count?: number;
      task_count?: number;
      port_forward_count?: number;
    };
  };
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
