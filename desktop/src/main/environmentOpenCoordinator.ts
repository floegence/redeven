import type { DesktopRuntimeHealth, DesktopRuntimeMaintenanceRequirement } from '../shared/desktopRuntimeHealth';

export type ManagedRuntimeLifecycleOperation = 'start' | 'stop' | 'restart' | 'update_runtime';

export type ManagedEnvironmentOpenDecision = Readonly<
  | { kind: 'open' }
  | {
      kind: 'lifecycle';
      operation: ManagedRuntimeLifecycleOperation;
      reason: 'runtime_stopped' | 'runtime_missing' | 'runtime_update_required' | 'runtime_restart_required' | 'runtime_unverified';
    }
  | {
      kind: 'blocked';
      message: string;
    }
>;

export type ManagedRuntimeLifecycleDecision = Readonly<
  | { kind: 'complete' }
  | { kind: 'execute'; operation: ManagedRuntimeLifecycleOperation }
  | { kind: 'blocked'; message: string }
>;

function operationsSet(operations: readonly string[]): ReadonlySet<string> {
  return new Set(operations);
}

function updateOrBlocked(
  operations: ReadonlySet<string>,
  message: string,
  reason: Extract<ManagedEnvironmentOpenDecision, { kind: 'lifecycle' }>['reason'],
): ManagedEnvironmentOpenDecision {
  return operations.has('update_runtime')
    ? { kind: 'lifecycle', operation: 'update_runtime', reason }
    : { kind: 'blocked', message };
}

function restartOrUpdate(
  operations: ReadonlySet<string>,
  message: string,
  reason: Extract<ManagedEnvironmentOpenDecision, { kind: 'lifecycle' }>['reason'],
): ManagedEnvironmentOpenDecision {
  if (operations.has('restart')) {
    return { kind: 'lifecycle', operation: 'restart', reason };
  }
  return updateOrBlocked(operations, message, reason);
}

function startOrInstall(
  operations: ReadonlySet<string>,
  message: string,
): ManagedEnvironmentOpenDecision {
  if (operations.has('start')) {
    return { kind: 'lifecycle', operation: 'start', reason: 'runtime_stopped' };
  }
  return updateOrBlocked(operations, message, 'runtime_missing');
}

function maintenanceRecoveryAction(
  maintenance: DesktopRuntimeMaintenanceRequirement | null | undefined,
): DesktopRuntimeMaintenanceRequirement['recovery_action'] | undefined {
  return maintenance?.recovery_action;
}

export function decideManagedEnvironmentOpen(input: Readonly<{
  runtimeReady: boolean;
  health: DesktopRuntimeHealth | null | undefined;
  managementOperations: readonly string[];
}>): ManagedEnvironmentOpenDecision {
  if (input.runtimeReady) {
    return { kind: 'open' };
  }

  const operations = operationsSet(input.managementOperations);
  const health = input.health;
  const recoveryAction = maintenanceRecoveryAction(health?.runtime_maintenance);
  if (recoveryAction === 'update_runtime') {
    return updateOrBlocked(
      operations,
      'This Runtime requires an update, but the target supervisor does not support Runtime updates.',
      'runtime_update_required',
    );
  }
  if (recoveryAction === 'restart_runtime') {
    return restartOrUpdate(
      operations,
      'This Runtime requires recovery, but the target supervisor cannot restart or update it.',
      'runtime_restart_required',
    );
  }
  if (recoveryAction === 'start_runtime') {
    return startOrInstall(
      operations,
      'This Runtime is stopped, but the target supervisor cannot start or install it.',
    );
  }

  const offlineReasonCode = health?.offline_reason_code;
  if (
    health?.status === 'offline'
    && (offlineReasonCode === 'not_started' || offlineReasonCode === 'container_not_running')
  ) {
    return startOrInstall(
      operations,
      'This Runtime is stopped, but the target supervisor cannot start or install it.',
    );
  }

  if (health?.status === 'online') {
    return restartOrUpdate(
      operations,
      'The Runtime is running but cannot be opened, and the target supervisor cannot restart or update it.',
      'runtime_unverified',
    );
  }

  return restartOrUpdate(
    operations,
    'Desktop could not verify this Runtime, and the target supervisor does not expose a safe recovery operation.',
    'runtime_unverified',
  );
}

export function decideManagedRuntimeLifecycle(input: Readonly<{
  requestedOperation: ManagedRuntimeLifecycleOperation;
  health: DesktopRuntimeHealth | null | undefined;
  managementOperations: readonly string[];
}>): ManagedRuntimeLifecycleDecision {
  const operations = operationsSet(input.managementOperations);
  const running = input.health?.status === 'online';
  const definitelyStopped = input.health?.status === 'offline'
    && (input.health.offline_reason_code === 'not_started'
      || input.health.offline_reason_code === 'container_not_running');

  switch (input.requestedOperation) {
    case 'start':
      if (running) {
        return { kind: 'complete' };
      }
      if (operations.has('start')) {
        return { kind: 'execute', operation: 'start' };
      }
      if (operations.has('update_runtime')) {
        return { kind: 'execute', operation: 'update_runtime' };
      }
      return { kind: 'blocked', message: 'The target supervisor cannot start or install this Runtime.' };
    case 'stop':
      if (definitelyStopped) {
        return { kind: 'complete' };
      }
      return operations.has('stop')
        ? { kind: 'execute', operation: 'stop' }
        : { kind: 'blocked', message: 'The target supervisor cannot stop this Runtime safely.' };
    case 'restart':
      if (operations.has('restart')) {
        return { kind: 'execute', operation: 'restart' };
      }
      if (definitelyStopped && operations.has('start')) {
        return { kind: 'execute', operation: 'start' };
      }
      if (operations.has('update_runtime')) {
        return { kind: 'execute', operation: 'update_runtime' };
      }
      return { kind: 'blocked', message: 'The target supervisor cannot restart, start, or reinstall this Runtime.' };
    case 'update_runtime':
      return operations.has('update_runtime')
        ? { kind: 'execute', operation: 'update_runtime' }
        : { kind: 'blocked', message: 'The target supervisor does not support Runtime updates.' };
  }
}
