import { createEnvironmentOperationObserver } from '../envcenter/controller';
import { classifyEnvironmentFailure } from '../envcenter/core';
import type { EnvironmentCenterHost, EnvironmentOperationState, OpenTarget } from '../envcenter/contracts';
import type { DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';

export function createDesktopCenterHost(actions: {
  focus(key: string): Promise<boolean>;
  open(target: OpenTarget): Promise<boolean>;
  invalidTarget(): void;
}): EnvironmentCenterHost {
  return { focus: actions.focus, invalidTarget: actions.invalidTarget,
    open: async target => ({ kind: 'window', accepted: await actions.open(target) }) };
}

export function desktopCenterOperation(progress: DesktopLauncherActionProgress): EnvironmentOperationState | undefined {
  if (progress.action !== 'open_gateway_environment' || !progress.operation_key || !progress.operation_revision) return undefined;
  const status = progress.status;
  return { id: JSON.stringify([progress.operation_key, progress.started_at_unix_ms]), sequence: progress.operation_revision,
    status: status === 'succeeded' ? 'succeeded' : status === 'canceled' ? 'canceled'
      : status === 'failed' || status === 'cleanup_failed' || status === 'needs_confirmation' ? 'failed' : 'running',
    failure: progress.failure ? classifyEnvironmentFailure(progress.failure.code.toUpperCase()) : undefined };
}

/** Retain only the newest attempt for each existing Desktop operation owner. */
export function createDesktopCenterProgressAdapter() {
  const observers = new Map<string, { started: number; observe: ReturnType<typeof createEnvironmentOperationObserver> }>();
  return (progress: DesktopLauncherActionProgress): boolean => {
    const event = desktopCenterOperation(progress);
    if (!event) return true; // Older hosts retain their existing IPC behavior.
    const key = progress.operation_key!;
    const started = progress.started_at_unix_ms ?? 0;
    let owner = observers.get(key);
    if (owner && started < owner.started) return false;
    if (!owner || started > owner.started) {
      owner = { started, observe: createEnvironmentOperationObserver(event.id) };
      observers.set(key, owner);
    }
    return owner.observe(event) === event;
  };
}
