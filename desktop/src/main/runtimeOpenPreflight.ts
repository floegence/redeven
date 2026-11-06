import { desktopWelcomeRuntimeHealthIsFresh } from './desktopWelcomeRuntimeHealth';
import type { DesktopRuntimeHealth } from '../shared/desktopRuntimeHealth';
import {
  runtimeServiceIsOpenable,
  runtimeServiceNeedsRuntimeUpdate,
  runtimeServiceNeedsDesktopUpdate,
  runtimeServiceMatchesIdentity,
  type RuntimeServiceSnapshot,
} from '../shared/runtimeService';

export type RuntimeOpenReadyIdentity = Readonly<{
  runtime_pid?: number;
  runtime_started_at_unix_ms?: number;
  runtime_service?: RuntimeServiceSnapshot;
}>;

function positiveInteger(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

/**
 * A cached Welcome observation can replace only the separate managed Runtime
 * status probe. Open still creates a live private bridge and validates the
 * Runtime and Env App through the bridge before presenting a window.
 */
export function canReuseFreshRuntimeOpenPreflight(
  health: DesktopRuntimeHealth | null | undefined,
  ready: RuntimeOpenReadyIdentity | null | undefined,
  nowUnixMS: number = Date.now(),
): ready is RuntimeOpenReadyIdentity {
  if (
    !ready
    || health?.status !== 'online'
    || !desktopWelcomeRuntimeHealthIsFresh(health, nowUnixMS)
    || !runtimeServiceIsOpenable(health.runtime_service)
  ) {
    return false;
  }

  const healthPID = positiveInteger(health.runtime_pid);
  const readyPID = positiveInteger(ready.runtime_pid);
  const healthStartedAt = positiveInteger(health.started_at_unix_ms);
  const readyStartedAt = positiveInteger(ready.runtime_started_at_unix_ms);
  if (
    healthPID === null
    || readyPID === null
    || healthPID !== readyPID
    || healthStartedAt === null
    || readyStartedAt === null
    || healthStartedAt !== readyStartedAt
  ) {
    return false;
  }

  return runtimeServiceMatchesIdentity(health.runtime_service, ready.runtime_service)
    && runtimeServiceMatchesIdentity(ready.runtime_service, health.runtime_service);
}

/** A previously verified placement is a dial hint, never current admission authority. */
export function canAttemptKnownRuntimeBridge(ready: RuntimeOpenReadyIdentity | null | undefined): boolean {
  return !!ready && positiveInteger(ready.runtime_started_at_unix_ms) !== null
    && runtimeServiceIsOpenable(ready.runtime_service)
    && !runtimeServiceNeedsRuntimeUpdate(ready.runtime_service) && !runtimeServiceNeedsDesktopUpdate(ready.runtime_service);
}

/** A failed observation must not become permission to start or restart a service. */
export function runtimeOpenHasManagementEvidence(health: DesktopRuntimeHealth | null | undefined): boolean {
  return health?.freshness === 'fresh' && (health.status === 'online'
    || health.offline_reason_code === 'not_started' || health.offline_reason_code === 'container_not_running');
}


/** One budget for read-only opening work; installation has its own lifecycle. */
export function createRuntimeOpenConnectionBudget(parent?: AbortSignal, timeoutMs = 30_000) {
  const deadline = new AbortController();
  const signal = parent ? AbortSignal.any([parent, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(new DOMException('Runtime connection deadline exceeded.', 'TimeoutError')), timeoutMs);
  timer.unref();
  return {
    signal,
    dispose: () => clearTimeout(timer),
    wait: <T>(task: Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
      void task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    }),
  };
}
