import { createSignal, createEffect, onCleanup, type Accessor } from 'solid-js';

const WAIT_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 12_000, 15_000] as const;

export const REMOTE_FAST_RECONNECT_POLICY = {
  enabled: true,
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 3_000,
} as const;

export const LOCAL_FAST_RECONNECT_POLICY = REMOTE_FAST_RECONNECT_POLICY;

export type ReconnectAvailabilityStatus = 'online' | 'offline' | 'unknown';
export type ReconnectAccessStatus = 'ready' | 'locked' | 'unknown';

export type ReconnectAvailability = Readonly<{
  status: ReconnectAvailabilityStatus;
  access?: ReconnectAccessStatus;
}>;

export type ReconnectPhase = 'idle' | 'transport_retry' | 'waiting_for_runtime' | 'reconnecting';

export type ReconnectFailureKind = 'runtime_offline' | 'runtime_unavailable' | 'transport' | 'fatal';

export type ReconnectFailure = Readonly<{
  kind: ReconnectFailureKind;
  message: string;
}>;

export type RuntimeReconnectController = Readonly<{
  phase: Accessor<ReconnectPhase>;
  failure: Accessor<ReconnectFailure | null>;
  availabilityStatus: Accessor<ReconnectAvailabilityStatus | null>;
  nextRetryAtMs: Accessor<number | null>;
  activateWaiting: (failure: ReconnectFailure) => void;
  noteTransportRetry: () => void;
  noteConnected: () => void;
  noteBlocked: () => void;
  requestImmediateTick: () => void;
  requestReconnectNow: () => void;
}>;

type CreateRuntimeReconnectControllerArgs = Readonly<{
  enabled: Accessor<boolean>;
  probeAvailability: () => Promise<ReconnectAvailability>;
  reconnect: () => Promise<void>;
}>;

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeAvailabilityStatus(value: unknown): ReconnectAvailabilityStatus {
  const status = trimString(value).toLowerCase();
  if (status === 'online') return 'online';
  if (status === 'offline') return 'offline';
  return 'unknown';
}

function normalizeAccessStatus(value: unknown): ReconnectAccessStatus {
  const status = trimString(value).toLowerCase();
  if (status === 'ready') return 'ready';
  if (status === 'locked') return 'locked';
  return 'unknown';
}

function nextWaitDelayMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt <= 0) return WAIT_DELAYS_MS[0];
  return WAIT_DELAYS_MS[Math.min(Math.floor(attempt), WAIT_DELAYS_MS.length - 1)] ?? WAIT_DELAYS_MS[WAIT_DELAYS_MS.length - 1]!;
}

export function classifyReconnectFailure(error: unknown): ReconnectFailure {
  const candidate = (error ?? {}) as { code?: unknown; message?: unknown; status?: unknown };
  const code = trimString(candidate.code).toUpperCase();
  const status = Number(candidate.status ?? Number.NaN);
  const message = trimString(candidate.message ?? (error instanceof Error ? error.message : error));
  const lowerMessage = message.toLowerCase();

  if (
    code === 'AGENT_OFFLINE'
    || lowerMessage.includes('runtime is offline')
  ) {
    return {
      kind: 'runtime_offline',
      message: 'The runtime is offline. Waiting for it to come back online.',
    };
  }

  if (
    code === 'AGENT_UNAVAILABLE'
    || lowerMessage.includes('failed to deliver grant_server')
    || lowerMessage.includes('runtime is restarting')
    || lowerMessage.includes('runtime unavailable')
  ) {
    return {
      kind: 'runtime_unavailable',
      message: 'The runtime is restarting or not ready yet. Retrying automatically.',
    };
  }

  if (
    status === 401
    || lowerMessage.includes('invalid resume token')
    || lowerMessage.includes('resume token')
    || lowerMessage.includes('access password')
    || lowerMessage.includes('reopen from the control plane')
    || lowerMessage.includes('missing env context')
    || lowerMessage.includes('redirecting to the control plane')
  ) {
    return {
      kind: 'fatal',
      message: message || 'Connection recovery is blocked.',
    };
  }

  if (code === 'SERVICE_UNAVAILABLE') {
    return {
      kind: 'transport',
      message: 'Control plane is unavailable. Retrying automatically.',
    };
  }

  return {
    kind: 'transport',
    message: message || 'Connection lost. Retrying automatically.',
  };
}

export function createRuntimeReconnectController(args: CreateRuntimeReconnectControllerArgs): RuntimeReconnectController {
  const [phase, setPhase] = createSignal<ReconnectPhase>('idle');
  const [failure, setFailure] = createSignal<ReconnectFailure | null>(null);
  const [availabilityStatus, setAvailabilityStatus] = createSignal<ReconnectAvailabilityStatus | null>(null);
  const [nextRetryAtMs, setNextRetryAtMs] = createSignal<number | null>(null);

  let waitAttempt = 0;
  let lastFailureKey = '';
  let waitTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let tickInFlight = false;

  const clearWaitTimer = () => {
    if (typeof waitTimer !== 'undefined') {
      globalThis.clearTimeout(waitTimer);
      waitTimer = undefined;
    }
    setNextRetryAtMs(null);
  };

  const resetState = () => {
    clearWaitTimer();
    tickInFlight = false;
    waitAttempt = 0;
    lastFailureKey = '';
    setPhase('idle');
    setFailure(null);
    setAvailabilityStatus(null);
  };

  const scheduleTick = (delayMs: number, forceReconnect: boolean) => {
    if (!args.enabled()) return;
    clearWaitTimer();

    const safeDelay = Math.max(0, Math.floor(delayMs));
    setNextRetryAtMs(Date.now() + safeDelay);
    waitTimer = globalThis.setTimeout(() => {
      waitTimer = undefined;
      setNextRetryAtMs(null);
      void runTick(forceReconnect);
    }, safeDelay);
  };

  const runTick = async (forceReconnect: boolean) => {
    if (!args.enabled() || tickInFlight) return;

    tickInFlight = true;
    clearWaitTimer();

    try {
      let nextAvailability: ReconnectAvailability = { status: 'unknown', access: 'unknown' };
      try {
        nextAvailability = args.probeAvailability
          ? await args.probeAvailability()
          : { status: 'unknown', access: 'unknown' };
      } catch {
        nextAvailability = { status: 'unknown', access: 'unknown' };
      }

      if (!args.enabled()) {
        resetState();
        return;
      }

      const nextStatus = normalizeAvailabilityStatus(nextAvailability.status);
      const nextAccess = normalizeAccessStatus(nextAvailability.access);
      setAvailabilityStatus(nextStatus === 'unknown' ? null : nextStatus);

      if (nextAccess === 'locked') {
        setPhase('idle');
        return;
      }

      const shouldReconnect = forceReconnect || nextStatus !== 'offline';
      if (!shouldReconnect) {
        setPhase('waiting_for_runtime');
        scheduleTick(nextWaitDelayMs(waitAttempt), false);
        waitAttempt += 1;
        return;
      }

      setPhase('reconnecting');
      try {
        await args.reconnect();
      } catch {
        // Reconnect state is reconciled by the caller via protocol status updates.
      }
    } finally {
      tickInFlight = false;
    }
  };

  createEffect(() => {
    if (args.enabled()) return;
    resetState();
  });

  onCleanup(() => {
    resetState();
  });

  return {
    phase,
    failure,
    availabilityStatus,
    nextRetryAtMs,
    activateWaiting: (nextFailure) => {
      if (!args.enabled()) return;

      const normalizedFailure = {
        kind: nextFailure.kind,
        message: trimString(nextFailure.message),
      } satisfies ReconnectFailure;
      const failureKey = `${normalizedFailure.kind}:${normalizedFailure.message}`;
      if (normalizedFailure.kind === 'fatal') {
        setFailure(normalizedFailure);
        setPhase('idle');
        clearWaitTimer();
        lastFailureKey = failureKey;
        return;
      }

      if (
        lastFailureKey === failureKey
        && (phase() === 'waiting_for_runtime' || phase() === 'reconnecting')
      ) {
        return;
      }

      lastFailureKey = failureKey;
      setFailure(normalizedFailure);
      setPhase('waiting_for_runtime');
      scheduleTick(nextWaitDelayMs(waitAttempt), false);
      waitAttempt += 1;
    },
    noteTransportRetry: () => {
      if (!args.enabled()) return;
      clearWaitTimer();
      if (phase() !== 'reconnecting') {
        setPhase('transport_retry');
      }
    },
    noteConnected: () => {
      resetState();
    },
    noteBlocked: () => {
      resetState();
    },
    requestImmediateTick: () => {
      if (!args.enabled()) return;
      if (tickInFlight) return;
      setPhase('waiting_for_runtime');
      scheduleTick(0, false);
    },
    requestReconnectNow: () => {
      if (!args.enabled()) return;
      if (tickInFlight) return;
      setPhase('reconnecting');
      scheduleTick(0, true);
    },
  };
}
