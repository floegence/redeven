export const DESKTOP_SESSION_CONTEXT_GET_CHANNEL = 'redeven-desktop:session-context-get';
export const DESKTOP_SESSION_APP_READY_CHANNEL = 'redeven-desktop:session-app-ready';

export type DesktopSessionContextSnapshot = Readonly<{
  local_environment_id: string;
  renderer_storage_scope_id: string;
  target_kind?: 'local_environment' | 'external_local_ui' | 'ssh_environment';
  target_route?: 'local_host' | 'remote_desktop';
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
}>;

export type DesktopSessionAppReadyState = 'access_gate_interactive' | 'runtime_connected';

export type DesktopSessionAppReadyPayload = Readonly<{
  state: DesktopSessionAppReadyState;
}>;
