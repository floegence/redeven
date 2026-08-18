import type { DesktopRuntimeHealth } from '../shared/desktopRuntimeHealth';
import { runtimeServiceIsOpenable } from '../shared/runtimeService';

export type DesktopRuntimeLifecycleReadinessOperation =
  | 'initialize'
  | 'start'
  | 'stop'
  | 'restart'
  | 'update_runtime';

function lifecycleReadinessReached(
  operation: DesktopRuntimeLifecycleReadinessOperation,
  health: DesktopRuntimeHealth | null | undefined,
): health is DesktopRuntimeHealth {
  if (health?.freshness !== 'fresh') {
    return false;
  }
  if (operation === 'stop') {
    return health.status === 'offline';
  }
  return health.status === 'online' && runtimeServiceIsOpenable(health.runtime_service);
}

export async function waitForDesktopRuntimeLifecycleReadiness(input: Readonly<{
  operation: DesktopRuntimeLifecycleReadinessOperation;
  observe: () => Promise<DesktopRuntimeHealth | null | undefined>;
  wait?: () => Promise<void>;
  maxAttempts?: number;
}>): Promise<DesktopRuntimeHealth> {
  const wait = input.wait ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 250)));
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts ?? 40));
  let lastHealth: DesktopRuntimeHealth | null | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      lastHealth = await input.observe();
      lastError = undefined;
      if (lifecycleReadinessReached(input.operation, lastHealth)) {
        return lastHealth;
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < maxAttempts) {
      await wait();
    }
  }
  const detail = lastHealth?.offline_reason
    || (lastError instanceof Error ? lastError.message : String(lastError ?? '').trim())
    || (input.operation === 'stop'
      ? 'Desktop could not verify that the Runtime stopped.'
      : 'Desktop could not verify that the Runtime became ready to open.');
  throw new Error(detail);
}
