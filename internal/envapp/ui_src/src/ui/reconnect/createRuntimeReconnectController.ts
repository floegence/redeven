import { createEffect, createSignal, on, onCleanup, untrack, type Accessor } from 'solid-js';

import type { DesktopTransportRecoverySnapshot } from '../services/desktopSessionContext';

const RECOVERY_SUCCESS_HOLD_MS = 1_500;

export type ReconnectAvailabilityStatus = 'online' | 'offline' | 'unknown';
export type ReconnectAccessStatus = 'ready' | 'locked' | 'unknown';

export type ReconnectFailureCode =
  | 'runtime_offline'
  | 'runtime_unavailable'
  | 'transport_unavailable'
  | 'authentication_failed'
  | 'missing_environment_context'
  | 'secure_session_failed';

export type ReconnectFailure = Readonly<{
  code: ReconnectFailureCode;
  retryable: boolean;
  technical_detail: string;
  error_code?: string;
  http_status?: number;
}>;

export type ConnectionRecoveryPhase =
  | 'interrupted'
  | 'desktop_transport'
  | 'runtime_probe'
  | 'protocol_connect'
  | 'secure_session'
  | 'completed'
  | 'failed';

export type ConnectionRecoverySnapshot = Readonly<{
  generation: number;
  revision: number;
  state: 'idle' | 'recovering' | 'succeeded' | 'failed';
  phase: ConnectionRecoveryPhase;
  started_at_unix_ms?: number;
  recovered_at_unix_ms?: number;
  next_retry_at_unix_ms?: number;
  runtime_probe_attempt_count: number;
  protocol_attempt_count: number;
  availability_status: ReconnectAvailabilityStatus;
  protocol_connected: boolean;
  secure_session: 'pending' | 'recovering' | 'ready' | 'failed';
  desktop_transport?: DesktopTransportRecoverySnapshot;
  failure?: ReconnectFailure;
}>;

export type ProtocolWaitingPresentation = Readonly<{
  attempt: number;
  terminal: boolean;
  nextRetryAtUnixMs?: number;
}>;

export type RuntimeReconnectController = Readonly<{
  snapshot: Accessor<ConnectionRecoverySnapshot>;
  activateWaiting: (failure: ReconnectFailure, protocol: ProtocolWaitingPresentation) => void;
  noteProtocolConnecting: (attempt: number) => void;
  noteProtocolConnected: () => void;
  noteSecureSession: (state: 'recovering' | 'ready' | 'failed', failure?: ReconnectFailure) => void;
  requestImmediateRetry: () => Promise<void>;
}>;

type CreateRuntimeReconnectControllerArgs = Readonly<{
  enabled: Accessor<boolean>;
  desktopTransport: Accessor<DesktopTransportRecoverySnapshot | null>;
  retryProtocolNow: () => boolean;
  requestDesktopRecoveryNow: () => Promise<boolean>;
  successHoldMs?: number;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function positiveInteger(value: unknown): number {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) && numberValue > 0 ? numberValue : 0;
}

function freezeSnapshot(snapshot: ConnectionRecoverySnapshot): ConnectionRecoverySnapshot {
  return Object.freeze({
    ...snapshot,
    ...(snapshot.desktop_transport ? { desktop_transport: snapshot.desktop_transport } : {}),
    ...(snapshot.failure ? { failure: Object.freeze({ ...snapshot.failure }) } : {}),
  });
}

function idleSnapshot(generation = 0, revision = 0): ConnectionRecoverySnapshot {
  return freezeSnapshot({
    generation,
    revision,
    state: 'idle',
    phase: 'interrupted',
    runtime_probe_attempt_count: 0,
    protocol_attempt_count: 0,
    availability_status: 'unknown',
    protocol_connected: false,
    secure_session: 'pending',
  });
}

export function classifyReconnectFailure(error: unknown): ReconnectFailure {
  const candidate = (error ?? {}) as { code?: unknown; message?: unknown; status?: unknown; name?: unknown };
  const errorCode = compact(candidate.code).toUpperCase();
  const statusValue = Number(candidate.status);
  const httpStatus = Number.isInteger(statusValue) && statusValue > 0 ? statusValue : undefined;
  const technicalDetail = compact(candidate.message ?? (error instanceof Error ? error.message : error));

  if (errorCode === 'AGENT_OFFLINE') {
    return Object.freeze({
      code: 'runtime_offline',
      retryable: true,
      technical_detail: technicalDetail,
      error_code: errorCode,
      ...(httpStatus ? { http_status: httpStatus } : {}),
    });
  }
  if (errorCode === 'AGENT_UNAVAILABLE') {
    return Object.freeze({
      code: 'runtime_unavailable',
      retryable: true,
      technical_detail: technicalDetail,
      error_code: errorCode,
      ...(httpStatus ? { http_status: httpStatus } : {}),
    });
  }
  if (
    httpStatus === 401
    || httpStatus === 403
    || errorCode === 'INVALID_ENV_SESSION'
    || errorCode === 'MISSING_ENV_SESSION'
    || errorCode === 'UNAUTHORIZED'
    || errorCode === 'ACCESS_PASSWORD_REQUIRED'
  ) {
    return Object.freeze({
      code: 'authentication_failed',
      retryable: false,
      technical_detail: technicalDetail,
      ...(errorCode ? { error_code: errorCode } : {}),
      ...(httpStatus ? { http_status: httpStatus } : {}),
    });
  }
  if (errorCode === 'MISSING_ENV_CONTEXT') {
    return Object.freeze({
      code: 'missing_environment_context',
      retryable: false,
      technical_detail: technicalDetail,
      error_code: errorCode,
    });
  }
  if (errorCode === 'ENV_SESSION_REDIRECTING' || errorCode === 'ENV_SESSION_REOPEN_REQUIRED') {
    return Object.freeze({
      code: 'authentication_failed',
      retryable: false,
      technical_detail: technicalDetail,
      error_code: errorCode,
    });
  }
  return Object.freeze({
    code: httpStatus === 502 || httpStatus === 503 || httpStatus === 504
      ? 'runtime_unavailable'
      : 'transport_unavailable',
    retryable: true,
    technical_detail: technicalDetail,
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(httpStatus ? { http_status: httpStatus } : {}),
  });
}

export function createRuntimeReconnectController(args: CreateRuntimeReconnectControllerArgs): RuntimeReconnectController {
  const [snapshot, setSnapshot] = createSignal<ConnectionRecoverySnapshot>(idleSnapshot());
  let successTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

  const publish = (next: Omit<ConnectionRecoverySnapshot, 'revision'>) => {
    setSnapshot(freezeSnapshot({ ...next, revision: snapshot().revision + 1 }));
  };

  const clearSuccessTimer = () => {
    if (typeof successTimer !== 'undefined') {
      globalThis.clearTimeout(successTimer);
      successTimer = undefined;
    }
  };

  const reset = () => {
    clearSuccessTimer();
    const current = snapshot();
    setSnapshot(idleSnapshot(current.generation, current.revision + 1));
  };

  const ensureRecovery = (phase: ConnectionRecoveryPhase, failure?: ReconnectFailure) => {
    const current = snapshot();
    if (current.state === 'failed') {
      return;
    }
    if (current.state === 'recovering') {
      publish({
        ...current,
        phase,
        ...(failure ? { failure } : {}),
      });
      return;
    }
    if (current.state === 'succeeded') {
      clearSuccessTimer();
    }
    publish({
      generation: current.generation + 1,
      state: 'recovering',
      phase,
      started_at_unix_ms: Date.now(),
      runtime_probe_attempt_count: 0,
      protocol_attempt_count: 0,
      availability_status: 'unknown',
      protocol_connected: false,
      secure_session: 'pending',
      ...(args.desktopTransport() ? { desktop_transport: args.desktopTransport()! } : {}),
      ...(failure ? { failure } : {}),
    });
  };

  const failRecovery = (failure: ReconnectFailure) => {
    clearSuccessTimer();
    ensureRecovery('failed', failure);
    const current = snapshot();
    publish({
      ...current,
      state: 'failed',
      phase: 'failed',
      failure,
      secure_session: failure.code === 'secure_session_failed' || failure.code === 'authentication_failed'
        ? 'failed'
        : current.secure_session,
    });
  };

  const isRecoverableAuthenticationFailure = (current: ConnectionRecoverySnapshot): boolean => (
    current.state === 'failed' && current.failure?.code === 'authentication_failed'
  );

  const completeRecovery = () => {
    const current = snapshot();
    if (current.state === 'idle' || current.state === 'succeeded') return;
    if (current.state === 'failed' && !isRecoverableAuthenticationFailure(current)) return;
    clearSuccessTimer();
    publish({
      ...current,
      state: 'succeeded',
      phase: 'completed',
      recovered_at_unix_ms: Date.now(),
      next_retry_at_unix_ms: undefined,
      protocol_connected: true,
      secure_session: 'ready',
      failure: undefined,
    });
    successTimer = globalThis.setTimeout(reset, Math.max(0, args.successHoldMs ?? RECOVERY_SUCCESS_HOLD_MS));
  };

  const desktopTransportBlocksProbe = () => {
    const phase = args.desktopTransport()?.phase;
    return phase === 'waiting' || phase === 'connecting' || phase === 'failed';
  };

  createEffect(on([args.enabled, args.desktopTransport], ([enabled, desktop]) => {
    const currentSnapshot = untrack(snapshot);
    if (!enabled) {
      if (currentSnapshot.state !== 'idle') reset();
      return;
    }
    if (!desktop) return;
    if (desktop.phase === 'waiting' || desktop.phase === 'connecting') {
      ensureRecovery('desktop_transport', desktop.failure ? {
        code: desktop.failure.code === 'authentication_failed' ? 'authentication_failed' : 'transport_unavailable',
        retryable: desktop.failure.code !== 'authentication_failed',
        technical_detail: desktop.failure.technical_detail,
        error_code: desktop.failure.code,
      } : undefined);
      const current = snapshot();
      publish({
        ...current,
        phase: 'desktop_transport',
        desktop_transport: desktop,
        next_retry_at_unix_ms: desktop.next_attempt_at_unix_ms,
      });
      return;
    }
    if (desktop.phase === 'failed') {
      failRecovery({
        code: desktop.failure?.code === 'authentication_failed' ? 'authentication_failed' : 'transport_unavailable',
        retryable: false,
        technical_detail: desktop.failure?.technical_detail ?? '',
        error_code: desktop.failure?.code,
      });
      const current = snapshot();
      publish({ ...current, desktop_transport: desktop });
      return;
    }
    if (currentSnapshot.state === 'recovering' && desktop.recovered_at_unix_ms) {
      const current = snapshot();
      publish({ ...current, desktop_transport: desktop });
      args.retryProtocolNow();
    }
  }));

  onCleanup(() => {
    clearSuccessTimer();
  });

  return {
    snapshot,
    activateWaiting: (failure, protocol) => {
      if (!args.enabled()) return;
      if (!failure.retryable || protocol.terminal) {
        failRecovery(failure);
        return;
      }
      ensureRecovery(desktopTransportBlocksProbe() ? 'desktop_transport' : 'protocol_connect', failure);
      const current = snapshot();
      publish({
        ...current,
        phase: desktopTransportBlocksProbe() ? 'desktop_transport' : 'protocol_connect',
        protocol_attempt_count: Math.max(current.protocol_attempt_count, positiveInteger(protocol.attempt)),
        next_retry_at_unix_ms: protocol.nextRetryAtUnixMs,
      });
    },
    noteProtocolConnecting: (attempt) => {
      if (!args.enabled() || snapshot().state === 'idle') return;
      const current = snapshot();
      publish({
        ...current,
        phase: desktopTransportBlocksProbe() ? 'desktop_transport' : 'protocol_connect',
        protocol_attempt_count: Math.max(current.protocol_attempt_count, positiveInteger(attempt)),
        next_retry_at_unix_ms: undefined,
      });
    },
    noteProtocolConnected: () => {
      const current = snapshot();
      if (current.state === 'idle') return;
      if (current.state === 'failed' && !isRecoverableAuthenticationFailure(current)) return;
      publish({
        ...current,
        phase: current.secure_session === 'ready' ? 'completed' : 'secure_session',
        protocol_connected: true,
        availability_status: 'online',
        next_retry_at_unix_ms: undefined,
      });
      if (snapshot().secure_session === 'ready') completeRecovery();
    },
    noteSecureSession: (state, failure) => {
      const beforeUpdate = snapshot();
      if (beforeUpdate.state === 'idle') return;
      if (beforeUpdate.state === 'failed' && !isRecoverableAuthenticationFailure(beforeUpdate)) return;
      if (state === 'failed') {
        failRecovery(failure ?? {
          code: 'secure_session_failed',
          retryable: false,
          technical_detail: '',
        });
        return;
      }
      const current = snapshot();
      publish({
        ...current,
        phase: current.protocol_connected ? 'secure_session' : current.phase,
        secure_session: state,
      });
      if (state === 'ready' && snapshot().protocol_connected) completeRecovery();
    },
    requestImmediateRetry: async () => {
      if (snapshot().state === 'failed') return;
      const desktop = args.desktopTransport();
      if (desktop?.phase === 'waiting' && desktop.actions.includes('retry_now')) {
        await args.requestDesktopRecoveryNow();
        return;
      }
      if (desktopTransportBlocksProbe()) return;
      args.retryProtocolNow();
    },
  };
}
