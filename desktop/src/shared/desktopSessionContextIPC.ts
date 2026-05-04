export const DESKTOP_SESSION_CONTEXT_GET_CHANNEL = 'redeven-desktop:session-context-get';
export const DESKTOP_SESSION_APP_READY_CHANNEL = 'redeven-desktop:session-app-ready';

export type DesktopSessionContextSnapshot = Readonly<{
  managed_environment_id: string;
  environment_storage_scope_id: string;
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
}>;

export type DesktopSessionAppReadyState = 'access_gate_interactive' | 'runtime_connected';

export type DesktopSessionAppReadyPayload = Readonly<{
  state: DesktopSessionAppReadyState;
}>;
