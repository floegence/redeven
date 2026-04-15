export const DESKTOP_SESSION_CONTEXT_GET_CHANNEL = 'redeven-desktop:session-context-get';

export type DesktopSessionContextSnapshot = Readonly<{
  managed_environment_id: string;
  environment_storage_scope_id: string;
}>;
