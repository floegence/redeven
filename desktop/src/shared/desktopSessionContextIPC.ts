import type { LocalUIExposure } from './localUIExposure';

export const DESKTOP_SESSION_CONTEXT_GET_CHANNEL = 'redeven-desktop:session-context-get';
export const DESKTOP_SESSION_APP_READY_CHANNEL = 'redeven-desktop:session-app-ready';
export const DESKTOP_SESSION_TRANSPORT_RECOVERY_GET_CHANNEL = 'redeven-desktop:session-transport-recovery-get';
export const DESKTOP_SESSION_TRANSPORT_RECOVERY_UPDATED_CHANNEL = 'redeven-desktop:session-transport-recovery-updated';
export const DESKTOP_SESSION_TRANSPORT_RECOVERY_RETRY_CHANNEL = 'redeven-desktop:session-transport-recovery-retry';

export type DesktopSessionTransportRecoveryPhase = 'ready' | 'waiting' | 'connecting' | 'failed';

export type DesktopSessionTransportRecoveryFailureCode =
  | 'transport_interrupted'
  | 'transport_unavailable'
  | 'authentication_failed'
  | 'remote_command_ended'
  | 'process_identity_changed';

export type DesktopSessionTransportRecoveryAction = 'retry_now' | 'open_connection_center';

export type DesktopSessionTransportRecoveryFailure = Readonly<{
  code: DesktopSessionTransportRecoveryFailureCode;
  error_name: string;
  technical_detail: string;
}>;

export type DesktopSessionTransportRecoverySnapshot = Readonly<{
  generation: number;
  revision: number;
  phase: DesktopSessionTransportRecoveryPhase;
  attempt_count: number;
  started_at_unix_ms?: number;
  next_attempt_at_unix_ms?: number;
  recovered_at_unix_ms?: number;
  failure?: DesktopSessionTransportRecoveryFailure;
  actions: readonly DesktopSessionTransportRecoveryAction[];
}>;

export type DesktopSessionContextSnapshot = Readonly<{
  local_environment_id: string;
  renderer_storage_scope_id: string;
  target_kind?: 'local_environment' | 'external_local_ui' | 'ssh_environment' | 'gateway_environment';
  target_route: 'local_host' | 'remote_desktop';
  session_source?: 'local_runtime' | 'provider_environment' | 'ssh_environment' | 'external_local_ui' | 'runtime_gateway';
  provider_origin?: string;
  provider_id?: string;
  env_public_id?: string;
  label?: string;
  local_ui_exposure?: LocalUIExposure;
}>;

export type DesktopSessionAppReadyState = 'access_gate_interactive' | 'runtime_connected';

export type DesktopSessionAppReadyPayload = Readonly<{
  state: DesktopSessionAppReadyState;
  timings?: Readonly<{
    bootstrap_ms?: number;
    access_ready_ms?: number;
    protocol_connected_ms?: number;
    shell_painted_ms?: number;
  }>;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) && numberValue >= 0 ? numberValue : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

export function normalizeDesktopSessionTransportRecoverySnapshot(
  value: unknown,
): DesktopSessionTransportRecoverySnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<DesktopSessionTransportRecoverySnapshot>;
  const generation = normalizeNonNegativeInteger(candidate.generation);
  const revision = normalizeNonNegativeInteger(candidate.revision);
  const attemptCount = normalizeNonNegativeInteger(candidate.attempt_count);
  const phase = compact(candidate.phase);
  if (
    generation === null
    || revision === null
    || attemptCount === null
    || (phase !== 'ready' && phase !== 'waiting' && phase !== 'connecting' && phase !== 'failed')
  ) {
    return null;
  }

  const startedAtUnixMS = normalizePositiveInteger(candidate.started_at_unix_ms);
  const nextAttemptAtUnixMS = normalizePositiveInteger(candidate.next_attempt_at_unix_ms);
  const recoveredAtUnixMS = normalizePositiveInteger(candidate.recovered_at_unix_ms);
  const failure = (() => {
    if (!candidate.failure || typeof candidate.failure !== 'object') {
      return undefined;
    }
    const failureCandidate = candidate.failure as Partial<DesktopSessionTransportRecoveryFailure>;
    const code = compact(failureCandidate.code);
    if (
      code !== 'transport_interrupted'
      && code !== 'transport_unavailable'
      && code !== 'authentication_failed'
      && code !== 'remote_command_ended'
      && code !== 'process_identity_changed'
    ) {
      return undefined;
    }
    return {
      code,
      error_name: compact(failureCandidate.error_name),
      technical_detail: compact(failureCandidate.technical_detail),
    } satisfies DesktopSessionTransportRecoveryFailure;
  })();
  const actions = Array.isArray(candidate.actions)
    ? candidate.actions.flatMap((action) => (
        action === 'retry_now' || action === 'open_connection_center' ? [action] : []
      ))
    : [];

  if (phase === 'failed' && !failure) {
    return null;
  }

  return Object.freeze({
    generation,
    revision,
    phase,
    attempt_count: attemptCount,
    ...(startedAtUnixMS === null ? {} : { started_at_unix_ms: startedAtUnixMS }),
    ...(nextAttemptAtUnixMS === null ? {} : { next_attempt_at_unix_ms: nextAttemptAtUnixMS }),
    ...(recoveredAtUnixMS === null ? {} : { recovered_at_unix_ms: recoveredAtUnixMS }),
    ...(failure ? { failure: Object.freeze(failure) } : {}),
    actions: Object.freeze([...new Set(actions)]),
  });
}
