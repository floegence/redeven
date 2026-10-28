/** Shared presentation contracts. Hosts own identity, permissions and side effects. */
export type EnvironmentEntry = Readonly<{
  id: string;
  label: string;
  gateway_id?: string;
  gateway_env_id?: string;
  access_group_id?: string;
  is_open?: boolean;
  open_session_key?: string;
  gateway_member?: { connected: boolean; metadata: { hostname: string } };
  runtime_operations: { open: { availability: string } };
}>;
export type OpenProgress = Readonly<{
  action: string;
  gateway_id?: string;
  environment_id?: string;
  status?: string;
}>;
export type ListTranslationKey = 'gatewayMembers.connected' | 'gatewayMembers.offline'
  | 'gatewayAccess.checkingAccess' | 'environmentAction.open';
export type ListI18n = Readonly<{ t: (key: ListTranslationKey) => string }>;
export type OpenTarget = Readonly<{ environment_id: string; gateway_id: string; gateway_env_id: string; label: string }>;
export type OpenResult = Readonly<{ kind: 'window' | 'navigation'; accepted: boolean }>;
export interface EnvironmentCenterHost {
  focus(sessionKey: string): Promise<boolean>;
  open(target: OpenTarget): Promise<OpenResult>;
  invalidTarget(): void;
}

/** Facts are host verified; the shared reducer never grants permission. */
export type EnvironmentFailure = 'authentication' | 'permission' | 'offline' | 'unsupported' | 'conflict' | 'capacity' | 'canceled' | 'configuration' | 'browser' | 'unknown';
export type EnvironmentOperationStatus = 'running' | 'succeeded' | 'failed' | 'canceled';
export type EnvironmentOperationState = Readonly<{ id: string; sequence: number; status: EnvironmentOperationStatus; failure?: EnvironmentFailure }>;
export type EnvironmentOperationEvent = EnvironmentOperationState;

export type EnvironmentRecoveryAction = 'sign_in' | 'request_access' | 'check_connection' | 'update_target' | 'refresh' | 'wait' | 'configure' | 'browser_settings' | 'retry' | 'none';
export type EnvironmentPresentation = Readonly<{
  identity: string;
  label: string;
  hostname: string;
  connected: boolean;
  openAvailable: boolean;
  target?: OpenTarget;
}>;
