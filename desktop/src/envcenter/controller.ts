import { projectEnvironment, reduceEnvironmentOperation } from './core';
import type { EnvironmentCenterHost, EnvironmentEntry, OpenProgress, EnvironmentOperationState } from './contracts';

/** One open intent, delegated to the existing host owner. No frontend retries. */
export async function requestEnvironmentOpen(host: EnvironmentCenterHost, environment: EnvironmentEntry,
  presentationEnvironmentID?: string): Promise<boolean> {
  if (environment.is_open && environment.open_session_key) return host.focus(environment.open_session_key);
  const target = projectEnvironment(environment, presentationEnvironmentID).target;
  if (!target) { host.invalidTarget(); return false; }
  const result = await host.open(target);
  return result.accepted;
}
export function environmentOpenRunning(environment: EnvironmentEntry, progress?: readonly OpenProgress[]): boolean {
  return progress?.some(item => item.action === 'open_gateway_environment'
    && item.gateway_id === environment.gateway_id && item.environment_id === environment.id && item.status === 'running') ?? false;
}

/** A host instance owns one pending intent per exact route. Repeated clicks join
 * that intent; completion removes it so a later explicit click can open again. */
export function createEnvironmentOpenController(host: EnvironmentCenterHost) {
  const pending = new Map<string, Promise<boolean>>();
  return {
    open(environment: EnvironmentEntry, presentationEnvironmentID?: string): Promise<boolean> {
      const key = JSON.stringify([projectEnvironment(environment, presentationEnvironmentID).identity, environment.open_session_key]);
      const existing = pending.get(key);
      if (existing) return existing;
      const result = requestEnvironmentOpen(host, environment, presentationEnvironmentID);
      pending.set(key, result);
      void result.finally(() => { if (pending.get(key) === result) pending.delete(key); }).catch(() => {});
      return result;
    },
  };
}

/** Accept only owner-issued observations for the explicitly selected operation.
 * Reconnect re-reads that operation; it never creates a replacement open intent. */
export function createEnvironmentOperationObserver(id: string) {
  let current: EnvironmentOperationState | undefined;
  return (event: EnvironmentOperationState): EnvironmentOperationState | undefined => {
    if (event.id !== id || !Number.isSafeInteger(event.sequence) || event.sequence < 0) return current;
    current = reduceEnvironmentOperation(current, event);
    return current;
  };
}

/** Local cancellation fences presentation before a delayed ready response. */
export function createEnvironmentHandoffGuard() {
  let state: 'pending' | 'cancel_requested' | 'handed_off' = 'pending';
  return {
    requestCancel(): boolean {
      if (state === 'handed_off') return false;
      state = 'cancel_requested';
      return true;
    },
    claim(): boolean {
      if (state !== 'pending') return false;
      state = 'handed_off';
      return true;
    },
  };
}
