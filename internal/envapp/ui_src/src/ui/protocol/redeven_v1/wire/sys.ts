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
    open_readiness?: {
      state?: string;
      reason_code?: string;
      message?: string;
    };
    active_workload?: {
      terminal_count?: number;
      session_count?: number;
      task_count?: number;
      port_forward_count?: number;
    };
    capabilities?: {
      desktop_ai_broker?: {
        supported?: boolean;
        bind_method?: string;
        reason_code?: string;
        message?: string;
      };
      provider_link?: {
        supported?: boolean;
        bind_method?: string;
        reason_code?: string;
        message?: string;
      };
    };
    bindings?: {
      desktop_ai_broker?: {
        state?: string;
        session_id?: string;
        ssh_runtime_key?: string;
        expires_at_unix_ms?: number;
        model_source?: string;
        model_count?: number;
        missing_key_provider_ids?: string[];
        last_error?: string;
      };
      provider_link?: {
        state?: string;
        provider_origin?: string;
        provider_id?: string;
        env_public_id?: string;
        local_environment_public_id?: string;
        binding_generation?: number;
        remote_enabled?: boolean;
        last_connected_at_unix_ms?: number;
        last_disconnected_at_unix_ms?: number;
        last_error_code?: string;
        last_error_message?: string;
      };
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
