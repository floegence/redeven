import { createEffect, createSignal, on, onCleanup, untrack, type Accessor } from 'solid-js';

import type { DesktopTransportRecoverySnapshot } from '../services/desktopSessionContext';

const WAIT_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 12_000, 15_000] as const;
const RECOVERY_SUCCESS_HOLD_MS = 1_500;

export const REMOTE_FAST_RECONNECT_POLICY = {
  enabled: true,
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 3_000,
} as const;

export const LOCAL_FAST_RECONNECT_POLICY = REMOTE_FAST_RECONNECT_POLICY;

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

export type ReconnectAvailability = Readonly<{
  status: ReconnectAvailabilityStatus;
  access?: ReconnectAccessStatus;
  failure?: ReconnectFailure;
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

export type ReconnectDiagnosticEvent = Readonly<{
  stage: string;
  code: string;
  result: string;
  attempt_seq: number;
}>;

export type RuntimeReconnectController = Readonly<{
  snapshot: Accessor<ConnectionRecoverySnapshot>;
  activateWaiting: (failure: ReconnectFailure) => void;
  noteProtocolDiagnostic: (event: ReconnectDiagnosticEvent, failure?: ReconnectFailure) => void;
  noteProtocolConnecting: () => void;
  noteProtocolConnected: () => void;
  noteSecureSession: (state: 'recovering' | 'ready' | 'failed', failure?: ReconnectFailure) => void;
  requestImmediateRetry: () => Promise<void>;
}>;

type CreateRuntimeReconnectControllerArgs = Readonly<{
  enabled: Accessor<boolean>;
  desktopTransport: Accessor<DesktopTransportRecoverySnapshot | null>;
  probeAvailability: () => Promise<ReconnectAvailability>;
  reconnect: () => Promise<void>;
  requestDesktopRecoveryNow: () => Promise<boolean>;
  successHoldMs?: number;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function positiveInteger(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function nextWaitDelayMs(attempt: number): number {
  return WAIT_DELAYS_MS[Math.min(Math.max(0, Math.floor(attempt)), WAIT_DELAYS_MS.length - 1)]!;
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
  let waitTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let successTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let tickInFlight = false;
  let lastDiagnosticAttemptSeq = 0;

  const publish = (next: Omit<ConnectionRecoverySnapshot, 'revision'>) => {
    setSnapshot(freezeSnapshot({ ...next, revision: snapshot().revision + 1 }));
  };

  const clearWaitTimer = () => {
    if (typeof waitTimer !== 'undefined') {
      globalThis.clearTimeout(waitTimer);
      waitTimer = undefined;
    }
  };

  const clearSuccessTimer = () => {
    if (typeof successTimer !== 'undefined') {
      globalThis.clearTimeout(successTimer);
      successTimer = undefined;
    }
  };

  const reset = () => {
    clearWaitTimer();
    clearSuccessTimer();
    tickInFlight = false;
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
    clearWaitTimer();
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

  const completeRecovery = () => {
    const current = snapshot();
    if (current.state === 'idle' || current.state === 'failed' || current.state === 'succeeded') return;
    clearWaitTimer();
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

  const scheduleTick = (delayMs: number, forceReconnect: boolean) => {
    if (!args.enabled() || snapshot().state === 'failed' || desktopTransportBlocksProbe()) return;
    clearWaitTimer();
    const safeDelay = Math.max(0, Math.floor(delayMs));
    const current = snapshot();
    publish({
      ...current,
      phase: 'runtime_probe',
      next_retry_at_unix_ms: Date.now() + safeDelay,
    });
    waitTimer = globalThis.setTimeout(() => {
      waitTimer = undefined;
      void runTick(forceReconnect);
    }, safeDelay);
  };

  const runTick = async (forceReconnect: boolean) => {
    if (!args.enabled() || tickInFlight || snapshot().state === 'failed' || desktopTransportBlocksProbe()) return;
    tickInFlight = true;
    clearWaitTimer();
    const beforeProbe = snapshot();
    const probeAttemptCount = beforeProbe.runtime_probe_attempt_count + 1;
    publish({
      ...beforeProbe,
      phase: 'runtime_probe',
      runtime_probe_attempt_count: probeAttemptCount,
      next_retry_at_unix_ms: undefined,
    });
    try {
      const availability = await args.probeAvailability();
      if (!args.enabled() || snapshot().state === 'failed' || desktopTransportBlocksProbe()) return;
      if (availability.access === 'locked') {
        failRecovery(availability.failure ?? {
          code: 'authentication_failed',
          retryable: false,
          technical_detail: '',
        });
        return;
      }
      const current = snapshot();
      publish({
        ...current,
        availability_status: availability.status,
        ...(availability.failure ? { failure: availability.failure } : {}),
      });
      if (!forceReconnect && availability.status === 'offline') {
        scheduleTick(nextWaitDelayMs(probeAttemptCount), false);
        return;
      }
      const beforeReconnect = snapshot();
      publish({
        ...beforeReconnect,
        phase: 'protocol_connect',
        next_retry_at_unix_ms: undefined,
      });
      await args.reconnect();
    } catch (error) {
      const failure = classifyReconnectFailure(error);
      if (!failure.retryable) {
        failRecovery(failure);
        return;
      }
      const current = snapshot();
      publish({ ...current, failure });
      scheduleTick(nextWaitDelayMs(current.runtime_probe_attempt_count), false);
    } finally {
      tickInFlight = false;
    }
  };

  createEffect(on([args.enabled, args.desktopTransport], ([enabled, desktop]) => {
    const currentSnapshot = untrack(snapshot);
    if (!enabled) {
      if (currentSnapshot.state !== 'idle') reset();
      return;
    }
    if (!desktop) return;
    if (desktop.phase === 'waiting' || desktop.phase === 'connecting') {
      clearWaitTimer();
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
      scheduleTick(0, false);
    }
  }));

  onCleanup(() => {
    clearWaitTimer();
    clearSuccessTimer();
  });

  return {
    snapshot,
    activateWaiting: (failure) => {
      if (!args.enabled()) return;
      if (!failure.retryable) {
        failRecovery(failure);
        return;
      }
      ensureRecovery(desktopTransportBlocksProbe() ? 'desktop_transport' : 'runtime_probe', failure);
      if (!desktopTransportBlocksProbe() && !tickInFlight && typeof waitTimer === 'undefined') {
        scheduleTick(nextWaitDelayMs(snapshot().runtime_probe_attempt_count), false);
      }
    },
    noteProtocolDiagnostic: (event, failure) => {
      if (!args.enabled() || event.stage !== 'reconnect') return;
      const attemptSeq = positiveInteger(event.attempt_seq);
      if (event.code === 'reconnect_attempt' || event.code === 'reconnect_retry_attempt') {
        if (!attemptSeq || attemptSeq <= lastDiagnosticAttemptSeq) return;
        lastDiagnosticAttemptSeq = attemptSeq;
        ensureRecovery(desktopTransportBlocksProbe() ? 'desktop_transport' : 'protocol_connect');
        const current = snapshot();
        publish({
          ...current,
          phase: desktopTransportBlocksProbe() ? 'desktop_transport' : 'protocol_connect',
          protocol_attempt_count: current.protocol_attempt_count + 1,
          next_retry_at_unix_ms: undefined,
        });
        return;
      }
      if (event.code === 'reconnect_exhausted') {
        const exhaustedFailure = failure ?? {
          code: 'transport_unavailable',
          retryable: true,
          technical_detail: '',
        };
        if (!exhaustedFailure.retryable) {
          failRecovery(exhaustedFailure);
          return;
        }
        ensureRecovery(desktopTransportBlocksProbe() ? 'desktop_transport' : 'runtime_probe', exhaustedFailure);
        if (!desktopTransportBlocksProbe() && !tickInFlight && typeof waitTimer === 'undefined') {
          scheduleTick(nextWaitDelayMs(snapshot().runtime_probe_attempt_count), false);
        }
      }
    },
    noteProtocolConnecting: () => {
      if (!args.enabled() || snapshot().state === 'idle') return;
      const current = snapshot();
      publish({ ...current, phase: desktopTransportBlocksProbe() ? 'desktop_transport' : 'protocol_connect' });
    },
    noteProtocolConnected: () => {
      if (snapshot().state === 'idle') return;
      const current = snapshot();
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
      if (snapshot().state === 'idle') return;
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
      scheduleTick(0, true);
    },
  };
}
