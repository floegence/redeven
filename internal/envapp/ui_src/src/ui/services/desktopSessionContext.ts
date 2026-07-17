import { readDesktopHostBridge } from './desktopHostWindow';

export type LocalUIExposure = Readonly<{
  scope: 'loopback' | 'network';
  transport: 'plaintext';
  password_required: boolean;
}>;

export interface DesktopSessionContextSnapshot {
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
}

export type DesktopTransportRecoveryFailureCode =
  | 'transport_interrupted'
  | 'transport_unavailable'
  | 'authentication_failed'
  | 'remote_command_ended'
  | 'process_identity_changed';

export type DesktopTransportRecoverySnapshot = Readonly<{
  generation: number;
  revision: number;
  phase: 'ready' | 'waiting' | 'connecting' | 'failed';
  attempt_count: number;
  started_at_unix_ms?: number;
  next_attempt_at_unix_ms?: number;
  recovered_at_unix_ms?: number;
  failure?: Readonly<{
    code: DesktopTransportRecoveryFailureCode;
    error_name: string;
    technical_detail: string;
  }>;
  actions: readonly ('retry_now' | 'open_connection_center')[];
}>;

export interface DesktopSessionContextBridge {
  getSnapshot: () => DesktopSessionContextSnapshot | null;
  getTransportRecoverySnapshot?: () => DesktopTransportRecoverySnapshot | null;
  subscribeTransportRecovery?: (listener: (snapshot: DesktopTransportRecoverySnapshot) => void) => () => void;
  requestTransportRecoveryNow?: () => Promise<boolean>;
  notifyAppReady?: (payload: {
    state: 'access_gate_interactive' | 'runtime_connected';
    timings?: Readonly<{
      bootstrap_ms?: number;
      access_ready_ms?: number;
      protocol_connected_ms?: number;
      shell_painted_ms?: number;
    }>;
  }) => void;
}

declare global {
  interface Window {
    redevenDesktopSessionContext?: DesktopSessionContextBridge;
  }
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeDesktopSessionContextSnapshot(value: unknown): DesktopSessionContextSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<DesktopSessionContextSnapshot>;
  const localEnvironmentID = compact(candidate.local_environment_id);
  const rendererStorageScopeID = compact(candidate.renderer_storage_scope_id);
  const targetKind = compact(candidate.target_kind);
  const targetRoute = compact(candidate.target_route);
  const sessionSource = compact(candidate.session_source);
  const providerOrigin = compact(candidate.provider_origin);
  const providerID = compact(candidate.provider_id);
  const envPublicID = compact(candidate.env_public_id);
  const label = compact(candidate.label);
  const localUIExposure = (() => {
    const exposure = candidate.local_ui_exposure;
    if (!exposure || typeof exposure !== 'object') return undefined;
    return exposure.scope === 'network' || exposure.scope === 'loopback'
      ? exposure.transport === 'plaintext' && typeof exposure.password_required === 'boolean'
        ? { scope: exposure.scope, transport: exposure.transport, password_required: exposure.password_required }
        : undefined
      : undefined;
  })();
  if (
    localEnvironmentID === ''
    || rendererStorageScopeID === ''
    || (targetRoute !== 'local_host' && targetRoute !== 'remote_desktop')
  ) {
    return null;
  }
  return {
    local_environment_id: localEnvironmentID,
    renderer_storage_scope_id: rendererStorageScopeID,
    ...(targetKind === 'local_environment' || targetKind === 'external_local_ui' || targetKind === 'ssh_environment' || targetKind === 'gateway_environment' ? { target_kind: targetKind } : {}),
    target_route: targetRoute,
    ...(sessionSource === 'local_runtime' || sessionSource === 'provider_environment' || sessionSource === 'ssh_environment' || sessionSource === 'external_local_ui' || sessionSource === 'runtime_gateway' ? { session_source: sessionSource } : {}),
    ...(providerOrigin !== '' ? { provider_origin: providerOrigin } : {}),
    ...(providerID !== '' ? { provider_id: providerID } : {}),
    ...(envPublicID !== '' ? { env_public_id: envPublicID } : {}),
    ...(label !== '' ? { label } : {}),
    ...(localUIExposure ? { local_ui_exposure: localUIExposure } : {}),
  };
}

function nonNegativeInteger(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) && numberValue >= 0 ? numberValue : null;
}

function positiveInteger(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

export function normalizeDesktopTransportRecoverySnapshot(
  value: unknown,
): DesktopTransportRecoverySnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<DesktopTransportRecoverySnapshot>;
  const generation = nonNegativeInteger(candidate.generation);
  const revision = nonNegativeInteger(candidate.revision);
  const attemptCount = nonNegativeInteger(candidate.attempt_count);
  const phase = compact(candidate.phase);
  if (
    generation === null
    || revision === null
    || attemptCount === null
    || (phase !== 'ready' && phase !== 'waiting' && phase !== 'connecting' && phase !== 'failed')
  ) {
    return null;
  }
  const failure = (() => {
    if (!candidate.failure || typeof candidate.failure !== 'object') return undefined;
    const failureCandidate = candidate.failure as Partial<NonNullable<DesktopTransportRecoverySnapshot['failure']>>;
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
    return Object.freeze({
      code,
      error_name: compact(failureCandidate.error_name),
      technical_detail: compact(failureCandidate.technical_detail),
    });
  })();
  if (phase === 'failed' && !failure) {
    return null;
  }
  const actions = Array.isArray(candidate.actions)
    ? candidate.actions.flatMap((action) => (
        action === 'retry_now' || action === 'open_connection_center' ? [action] : []
      ))
    : [];
  const startedAtUnixMS = positiveInteger(candidate.started_at_unix_ms);
  const nextAttemptAtUnixMS = positiveInteger(candidate.next_attempt_at_unix_ms);
  const recoveredAtUnixMS = positiveInteger(candidate.recovered_at_unix_ms);
  return Object.freeze({
    generation,
    revision,
    phase,
    attempt_count: attemptCount,
    ...(startedAtUnixMS === null ? {} : { started_at_unix_ms: startedAtUnixMS }),
    ...(nextAttemptAtUnixMS === null ? {} : { next_attempt_at_unix_ms: nextAttemptAtUnixMS }),
    ...(recoveredAtUnixMS === null ? {} : { recovered_at_unix_ms: recoveredAtUnixMS }),
    ...(failure ? { failure } : {}),
    actions: Object.freeze([...new Set(actions)]),
  });
}

function isDesktopSessionContextBridge(candidate: unknown): candidate is DesktopSessionContextBridge {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const bridge = candidate as Partial<DesktopSessionContextBridge>;
  return typeof bridge.getSnapshot === 'function';
}

export function readDesktopSessionContextSnapshot(): DesktopSessionContextSnapshot | null {
  const bridge = readDesktopHostBridge('redevenDesktopSessionContext', isDesktopSessionContextBridge);
  if (!bridge) {
    return null;
  }
  try {
    return normalizeDesktopSessionContextSnapshot(bridge.getSnapshot());
  } catch {
    return null;
  }
}

export function readDesktopTransportRecoverySnapshot(): DesktopTransportRecoverySnapshot | null {
  const bridge = readDesktopHostBridge('redevenDesktopSessionContext', isDesktopSessionContextBridge);
  if (!bridge || typeof bridge.getTransportRecoverySnapshot !== 'function') {
    return null;
  }
  try {
    return normalizeDesktopTransportRecoverySnapshot(bridge.getTransportRecoverySnapshot());
  } catch {
    return null;
  }
}

export function subscribeDesktopTransportRecovery(
  listener: (snapshot: DesktopTransportRecoverySnapshot) => void,
): () => void {
  const bridge = readDesktopHostBridge('redevenDesktopSessionContext', isDesktopSessionContextBridge);
  if (!bridge || typeof bridge.subscribeTransportRecovery !== 'function') {
    return () => undefined;
  }
  let current = readDesktopTransportRecoverySnapshot();
  return bridge.subscribeTransportRecovery((value) => {
    const snapshot = normalizeDesktopTransportRecoverySnapshot(value);
    if (
      !snapshot
      || (
        current
        && (
          snapshot.generation < current.generation
          || (snapshot.generation === current.generation && snapshot.revision <= current.revision)
        )
      )
    ) {
      return;
    }
    current = snapshot;
    listener(snapshot);
  });
}

export async function requestDesktopTransportRecoveryNow(): Promise<boolean> {
  const bridge = readDesktopHostBridge('redevenDesktopSessionContext', isDesktopSessionContextBridge);
  if (!bridge || typeof bridge.requestTransportRecoveryNow !== 'function') {
    return false;
  }
  try {
    return await bridge.requestTransportRecoveryNow() === true;
  } catch {
    return false;
  }
}

export function desktopRendererStorageScopeID(): string {
  return compact(readDesktopSessionContextSnapshot()?.renderer_storage_scope_id);
}

export function resolveRendererStorageScopeID(fallback: string): string {
  return desktopRendererStorageScopeID() || compact(fallback);
}

export function notifyDesktopSessionAppReady(
  state: 'access_gate_interactive' | 'runtime_connected',
  timings?: Readonly<{
    bootstrap_ms?: number;
    access_ready_ms?: number;
    protocol_connected_ms?: number;
    shell_painted_ms?: number;
  }>,
): boolean {
  const bridge = readDesktopHostBridge('redevenDesktopSessionContext', isDesktopSessionContextBridge);
  if (!bridge || typeof bridge.notifyAppReady !== 'function') {
    return false;
  }
  try {
    bridge.notifyAppReady({ state, ...(timings ? { timings } : {}) });
    return true;
  } catch {
    return false;
  }
}
