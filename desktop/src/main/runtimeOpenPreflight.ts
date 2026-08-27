import { desktopWelcomeRuntimeHealthIsFresh } from './desktopWelcomeRuntimeHealth';
import type { DesktopRuntimeHealth } from '../shared/desktopRuntimeHealth';
import {
  runtimeServiceIsOpenable,
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
