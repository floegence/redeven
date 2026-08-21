import type { GatewayRuntimeOperation, GatewayRuntimeOperationState } from './gatewayClient';

export const RUNTIME_OPERATION_RENEWAL_INTERVAL_MS = 60_000;
export const RUNTIME_OPERATION_RENEWAL_LEAD_MS = 5 * 60_000;

type RenewableState = Extract<
  GatewayRuntimeOperationState,
  'preflighting' | 'awaiting_confirmation' | 'awaiting_artifact' | 'staging' | 'commit_ready' | 'confirmation_required'
>;

function isRenewableState(state: GatewayRuntimeOperationState): state is RenewableState {
  return state === 'preflighting'
    || state === 'awaiting_confirmation'
    || state === 'awaiting_artifact'
    || state === 'staging'
    || state === 'commit_ready'
    || state === 'confirmation_required';
}
function renewalTarget(operation: GatewayRuntimeOperation, now: number): number | undefined {
  if (!isRenewableState(operation.state)) {
    return undefined;
  }
  const expiresAt = Number(operation.expires_at_unix_ms);
  const maximumExpiresAt = Number(operation.maximum_expires_at_unix_ms);
  if (!Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(maximumExpiresAt) || maximumExpiresAt <= expiresAt) {
    return undefined;
  }
  if (expiresAt - now > RUNTIME_OPERATION_RENEWAL_LEAD_MS) {
    return undefined;
  }
  return maximumExpiresAt;
}

export type RuntimeOperationLease = Readonly<{
  stop: () => void;
  current: () => GatewayRuntimeOperation;
}>;

export function startRuntimeOperationLease(
  initial: GatewayRuntimeOperation,
  renew: ((expiresAtUnixMS: number) => Promise<GatewayRuntimeOperation>) | undefined,
  onRenewed?: (operation: GatewayRuntimeOperation) => void,
  options: Readonly<{
    now?: () => number;
    intervalMs?: number;
  }> = {},
): RuntimeOperationLease {
  let current = initial;
  let stopped = false;
  let inFlight = false;
  const now = options.now ?? Date.now;
  const interval = options.intervalMs ?? RUNTIME_OPERATION_RENEWAL_INTERVAL_MS;
  const timer = renew
    ? setInterval(() => {
        if (stopped || inFlight) {
          return;
        }
        const target = renewalTarget(current, now());
        if (!target) {
          return;
        }
        inFlight = true;
        void renew(target)
          .then((next) => {
            if (stopped) {
              return;
            }
            current = next;
            onRenewed?.(next);
          })
          .catch(() => undefined)
          .finally(() => {
            inFlight = false;
          });
      }, interval)
    : undefined;
  timer?.unref?.();
  return {
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (timer) {
        clearInterval(timer);
      }
    },
    current: () => current,
  };
}
