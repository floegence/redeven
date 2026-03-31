import { createSignal, createEffect, onCleanup, type Accessor } from 'solid-js';

import type { EnvironmentDetail } from '../services/controlplaneApi';

const WAIT_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 12_000, 15_000] as const;

export const REMOTE_FAST_RECONNECT_POLICY = {
  enabled: true,
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 3_000,
} as const;

export type ReconnectPhase = 'idle' | 'transport_retry' | 'waiting_for_agent' | 'reconnecting';

export type ReconnectFailureKind = 'agent_offline' | 'agent_unavailable' | 'transport' | 'fatal';

export type ReconnectFailure = Readonly<{
  kind: ReconnectFailureKind;
  message: string;
}>;

export type AgentReconnectController = Readonly<{
  phase: Accessor<ReconnectPhase>;
  failure: Accessor<ReconnectFailure | null>;
  controlplaneStatus: Accessor<string | null>;
  nextRetryAtMs: Accessor<number | null>;
  activateWaiting: (failure: ReconnectFailure) => void;
  noteTransportRetry: () => void;
  noteConnected: () => void;
  noteBlocked: () => void;
  requestImmediateTick: () => void;
  requestReconnectNow: () => void;
}>;

type CreateAgentReconnectControllerArgs = Readonly<{
  enabled: Accessor<boolean>;
  envId: Accessor<string>;
  getEnvironment: (envId: string) => Promise<EnvironmentDetail | null>;
  reconnect: () => Promise<void>;
}>;

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeStatus(value: unknown): string | null {
  const status = trimString(value).toLowerCase();
  return status ? status : null;
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
    || lowerMessage.includes('no agent connected')
    || lowerMessage.includes('agent is offline')
  ) {
    return {
      kind: 'agent_offline',
      message: 'The runtime is offline. Waiting for it to come back online.',
    };
  }

  if (
    code === 'AGENT_UNAVAILABLE'
    || lowerMessage.includes('failed to deliver grant_server')
    || lowerMessage.includes('agent is restarting')
    || lowerMessage.includes('agent unavailable')
  ) {
    return {
      kind: 'agent_unavailable',
      message: 'The runtime is restarting or not ready yet. Retrying automatically.',
    };
  }

  if (
    status === 401
    || lowerMessage.includes('invalid resume token')
    || lowerMessage.includes('resume token')
    || lowerMessage.includes('access password')
    || lowerMessage.includes('reopen from the redeven portal')
    || lowerMessage.includes('missing env context')
    || lowerMessage.includes('redirecting to redeven portal')
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

export function createAgentReconnectController(args: CreateAgentReconnectControllerArgs): AgentReconnectController {
  const [phase, setPhase] = createSignal<ReconnectPhase>('idle');
  const [failure, setFailure] = createSignal<ReconnectFailure | null>(null);
  const [controlplaneStatus, setControlplaneStatus] = createSignal<string | null>(null);
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
    setControlplaneStatus(null);
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

    const envId = trimString(args.envId());
    if (!envId) {
      resetState();
      return;
    }

    tickInFlight = true;
    clearWaitTimer();

    try {
      let nextStatus: string | null = null;
      try {
        const detail = await args.getEnvironment(envId);
        nextStatus = normalizeStatus(detail?.status);
      } catch {
        nextStatus = null;
      }

      if (!args.enabled()) {
        resetState();
        return;
      }

      if (nextStatus) {
        setControlplaneStatus(nextStatus);
      }

      const shouldReconnect = forceReconnect || nextStatus !== 'offline';
      if (!shouldReconnect) {
        setPhase('waiting_for_agent');
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
    controlplaneStatus,
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
        && (phase() === 'waiting_for_agent' || phase() === 'reconnecting')
      ) {
        return;
      }

      lastFailureKey = failureKey;
      setFailure(normalizedFailure);
      setPhase('waiting_for_agent');
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
      setPhase('waiting_for_agent');
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
