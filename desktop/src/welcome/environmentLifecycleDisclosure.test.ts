import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import type { DesktopLauncherActionKind, DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import {
  runtimeLifecycleProgress,
  type DesktopRuntimeLifecycleOperation,
  type DesktopRuntimeLifecyclePhase,
} from '../shared/desktopRuntimeLifecycleProgress';
import {
  testDesktopPreferences,
  testLocalEnvironment,
} from '../testSupport/desktopTestHelpers';
import {
  abandonEnvironmentLifecycleDisclosureAttempt,
  beginEnvironmentLifecycleDisclosure,
  bindEnvironmentLifecycleDisclosureOperation,
  closeEnvironmentLifecycleDisclosure,
  environmentActionStartsLifecycleDisclosure,
  environmentLifecycleDisclosureHasPendingRequest,
  focusEnvironmentLifecycleDisclosure,
  reconcileEnvironmentLifecycleDisclosure,
  reopenEnvironmentLifecycleDisclosure,
  visibleEnvironmentLifecycleProgress,
} from './environmentLifecycleDisclosure';

function localEnvironmentEntry() {
  const local = testLocalEnvironment({ label: 'Local Environment' });
  const snapshot = buildDesktopWelcomeSnapshot({
    preferences: testDesktopPreferences({
      local_environment: local,
    }),
  });
  const entry = snapshot.environments.find((environment) => environment.id === local.id);
  if (!entry) {
    throw new Error('Expected local environment entry.');
  }
  return entry;
}

function lifecycleProgress(environmentID: string, startedAt = 100): DesktopLauncherActionProgress {
  return {
    action: 'update_environment_runtime',
    environment_id: environmentID,
    environment_label: 'Local Environment',
    operation_key: 'runtime-op',
    subject_kind: 'local_environment',
    subject_id: environmentID,
    started_at_unix_ms: startedAt,
    status: 'succeeded',
    phase: 'runtime_ready',
    title: 'Runtime ready',
    detail: 'The runtime is ready.',
    lifecycle_progress: runtimeLifecycleProgress({
      location: 'local_host',
      operation: 'update',
      phase: 'runtime_ready',
      targetID: environmentID,
      targetLabel: 'Local Environment',
    }),
  };
}

function restartReadyProgress(environmentID: string, startedAt = 200): DesktopLauncherActionProgress {
  return {
    action: 'restart_environment_runtime',
    environment_id: environmentID,
    environment_label: 'Local Environment',
    operation_key: 'restart-runtime-op',
    subject_kind: 'local_environment',
    subject_id: environmentID,
    started_at_unix_ms: startedAt,
    status: 'succeeded',
    phase: 'runtime_ready',
    title: 'Runtime ready',
    detail: 'Desktop restarted the local runtime.',
    lifecycle_progress: runtimeLifecycleProgress({
      location: 'local_host',
      operation: 'restart',
      phase: 'runtime_ready',
      targetID: environmentID,
      targetLabel: 'Local Environment',
    }),
  };
}

function beginDisclosure(
  environmentID: string,
  intent: 'start_runtime' | 'stop_runtime' | 'restart_runtime' | 'update_runtime' | 'refresh_runtime' | 'reinstall_target',
) {
  const operationKey = intent === 'update_runtime'
    ? 'runtime-op'
    : `${intent.replace('_runtime', '')}-runtime-op`;
  return beginEnvironmentLifecycleDisclosure(null, environmentID, intent, {
    operation_key: operationKey,
    started_at_unix_ms: 300,
  });
}

function reinstallProgress(input: Readonly<{
  environmentID: string;
  operationKey: string;
  startedAt: number;
  status?: DesktopLauncherActionProgress['status'];
}>): DesktopLauncherActionProgress {
  return {
    action: 'reinstall_target',
    environment_id: input.environmentID,
    environment_label: 'Local Environment',
    operation_key: input.operationKey,
    subject_kind: 'runtime_target',
    subject_id: input.environmentID,
    started_at_unix_ms: input.startedAt,
    status: input.status ?? 'running',
    phase: input.status === 'needs_confirmation' ? 'confirmation' : 'preflight',
    title: 'Reinstall Redeven',
    detail: 'Desktop is preparing the reinstall.',
  };
}

function actionLifecycleProgress(input: Readonly<{
  environmentID: string;
  action: DesktopLauncherActionKind;
  operation: DesktopRuntimeLifecycleOperation;
  phase: DesktopRuntimeLifecyclePhase;
  status: DesktopLauncherActionProgress['status'];
  operationKey?: string;
  startedAt?: number;
}>): DesktopLauncherActionProgress {
  return {
    action: input.action,
    environment_id: input.environmentID,
    environment_label: 'Local Environment',
    operation_key: input.operationKey ?? `${input.operation}-runtime-op`,
    subject_kind: 'local_environment',
    subject_id: input.environmentID,
    started_at_unix_ms: input.startedAt ?? 300,
    status: input.status,
    phase: input.phase,
    title: input.phase === 'runtime_stopped' ? 'Runtime stopped' : 'Runtime needs attention',
    detail: 'Desktop updated the local runtime lifecycle.',
    lifecycle_progress: runtimeLifecycleProgress({
      location: 'local_host',
      operation: input.operation,
      phase: input.phase,
      targetID: input.environmentID,
      targetLabel: 'Local Environment',
    }),
  };
}

describe('environmentLifecycleDisclosure', () => {
  it('waits for the main process snapshot instead of fabricating progress', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'update_runtime');
    expect(visibleEnvironmentLifecycleProgress({
      environment,
      selectedProgress: null,
      disclosure: state,
      busyState: { action: 'update_environment_runtime', environment_id: environment.id },
    })).toBeNull();
  });

  it('waits for the main process snapshot instead of fabricating progress', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'restart_runtime');
    const progress = visibleEnvironmentLifecycleProgress({
      environment,
      selectedProgress: null,
      disclosure: state,
    });

    expect(progress).toBeNull();
  });

  it('does not synthesize pending lifecycle progress when the current request no longer matches the disclosure', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'restart_runtime');

    expect(visibleEnvironmentLifecycleProgress({
      environment,
      selectedProgress: null,
      disclosure: state,
      busyState: {
        action: '',
        environment_id: '',
      },
    })).toBeNull();
    expect(visibleEnvironmentLifecycleProgress({
      environment,
      selectedProgress: null,
      disclosure: state,
      busyState: {
        action: 'restart_environment_runtime',
        environment_id: environment.id,
      },
    })).toBeNull();
  });

  it('returns selected lifecycle progress directly when no disclosure is active', () => {
    const environment = localEnvironmentEntry();
    const selectedProgress = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'update_environment_runtime',
      operation: 'update',
      phase: 'checking_runtime_service',
      status: 'running',
      operationKey: 'update-op',
      startedAt: 500,
    });

    expect(visibleEnvironmentLifecycleProgress({
      environment,
      selectedProgress,
      disclosure: null,
    })).toBe(selectedProgress);
  });

  it('uses a matching real failed progress instead of synthetic pending progress', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'restart_runtime');
    const failedRestart = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'checking_runtime_service',
      status: 'failed',
      operationKey: state!.operation_key,
      startedAt: state!.started_at_unix_ms,
    });

    expect(visibleEnvironmentLifecycleProgress({
      environment,
      selectedProgress: failedRestart,
      disclosure: state,
    })).toBe(failedRestart);
  });

  it('uses the terminal disclosure receipt instead of a stale selected running progress for the same attempt', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'restart_runtime');
    const startedAt = state!.started_at_unix_ms;
    const runningRestart = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'checking_runtime_service',
      status: 'running',
      operationKey: state!.operation_key,
      startedAt,
    });
    const failedRestart = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'checking_runtime_service',
      status: 'failed',
      operationKey: state!.operation_key,
      startedAt,
    });
    const bound = reconcileEnvironmentLifecycleDisclosure(state, [environment], [failedRestart]);

    expect(visibleEnvironmentLifecycleProgress({
      environment,
      selectedProgress: runningRestart,
      disclosure: bound,
    })).toBe(failedRestart);
  });

  it('does not let an older lifecycle progress replace a new pending disclosure', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'restart_runtime');
    const oldUpdateFailure = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'checking_runtime_service',
      status: 'failed',
      operationKey: 'restart-failed-op',
      startedAt: state!.started_at_unix_ms - 1,
    });

    const progress = visibleEnvironmentLifecycleProgress({
      environment,
      selectedProgress: oldUpdateFailure,
      disclosure: state,
    });

    expect(progress).not.toBe(oldUpdateFailure);
    expect(progress).toBeNull();
  });

  it('does not let a different lifecycle action replace a new pending disclosure', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'restart_runtime');
    const updateFailure = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'update_environment_runtime',
      operation: 'update',
      phase: 'checking_runtime_service',
      status: 'failed',
      operationKey: 'update-failed-op',
      startedAt: state!.started_at_unix_ms,
    });

    const progress = visibleEnvironmentLifecycleProgress({
      environment,
      selectedProgress: updateFailure,
      disclosure: state,
    });

    expect(progress).not.toBe(updateFailure);
    expect(progress).toBeNull();
  });

  it('binds real progress and keeps terminal progress while the popup is open', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'update_runtime');
    const startedAt = state!.started_at_unix_ms;
    const realProgress = lifecycleProgress(environment.id, startedAt);
    const bound = reconcileEnvironmentLifecycleDisclosure(state, [environment], [realProgress]);

    expect(bound).toEqual(expect.objectContaining({
      environment_id: environment.id,
      visibility: 'open',
      operation_key: 'runtime-op',
      last_progress: realProgress,
    }));
    expect(reconcileEnvironmentLifecycleDisclosure(bound, [environment], [])).toBe(bound);
  });

  it('keeps a terminal receipt visible after the registry removes it while the popup is open', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'restart_runtime');
    const failedRestart = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'checking_runtime_service',
      status: 'failed',
      operationKey: state!.operation_key,
      startedAt: state!.started_at_unix_ms,
    });
    const bound = reconcileEnvironmentLifecycleDisclosure(
      state,
      [environment],
      [failedRestart],
    );

    expect(visibleEnvironmentLifecycleProgress({
      environment,
      selectedProgress: null,
      disclosure: bound,
    })).toBe(failedRestart);
  });

  it('keeps terminal restart progress visible until the open popup can offer Open', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'restart_runtime');
    const startedAt = state!.started_at_unix_ms;
    const realProgress = restartReadyProgress(environment.id, startedAt);
    const bound = reconcileEnvironmentLifecycleDisclosure(state, [environment], [realProgress]);

    expect(bound).toEqual(expect.objectContaining({
      environment_id: environment.id,
      visibility: 'open',
      operation_key: 'restart-runtime-op',
      last_progress: realProgress,
    }));
    expect(reconcileEnvironmentLifecycleDisclosure(bound, [environment], [])).toBe(bound);
  });

  it('keeps terminal stop success visible as a receipt while the popup is open', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'stop_runtime');
    const startedAt = state!.started_at_unix_ms;
    const realProgress = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'stop_environment_runtime',
      operation: 'stop',
      phase: 'runtime_stopped',
      status: 'succeeded',
      operationKey: 'stop-runtime-op',
      startedAt,
    });
    const bound = reconcileEnvironmentLifecycleDisclosure(state, [environment], [realProgress]);

    expect(bound).toEqual(expect.objectContaining({
      environment_id: environment.id,
      visibility: 'open',
      operation_key: 'stop-runtime-op',
      last_progress: realProgress,
    }));
    expect(reconcileEnvironmentLifecycleDisclosure(bound, [environment], [])).toBe(bound);
    expect(closeEnvironmentLifecycleDisclosure(bound, environment.id)).toBeNull();
  });

  it('binds terminal failure progress without relying on disclosure state as the dismiss owner', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'stop_runtime');
    const startedAt = state!.started_at_unix_ms;
    const realProgress = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'stop_environment_runtime',
      operation: 'stop',
      phase: 'verifying_runtime_stopped',
      status: 'failed',
      operationKey: state!.operation_key,
      startedAt,
    });
    const bound = reconcileEnvironmentLifecycleDisclosure(state, [environment], [realProgress]);

    expect(bound).toEqual(expect.objectContaining({
      environment_id: environment.id,
      visibility: 'open',
      operation_key: 'stop-runtime-op',
      last_progress: realProgress,
    }));
    expect(reconcileEnvironmentLifecycleDisclosure(bound, [environment], [])).toBe(bound);
    expect(closeEnvironmentLifecycleDisclosure(bound, environment.id)).toBeNull();
  });

  it('keeps canceled lifecycle receipts visible only until the user closes the popup', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'restart_runtime');
    const startedAt = state!.started_at_unix_ms;
    const realProgress = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'checking_runtime_service',
      status: 'canceled',
      operationKey: state!.operation_key,
      startedAt,
    });
    const bound = reconcileEnvironmentLifecycleDisclosure(state, [environment], [realProgress]);

    expect(bound).toEqual(expect.objectContaining({
      environment_id: environment.id,
      visibility: 'open',
      operation_key: 'restart-runtime-op',
      last_progress: realProgress,
    }));
    expect(closeEnvironmentLifecycleDisclosure(bound, environment.id)).toBeNull();
  });

  it('lets the user close a running disclosure and reopen it later', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'restart_runtime');
    const closed = closeEnvironmentLifecycleDisclosure(state, environment.id);

    expect(closed).toEqual(expect.objectContaining({
      environment_id: environment.id,
      visibility: 'user_closed',
    }));
    expect(reopenEnvironmentLifecycleDisclosure(closed, environment.id)).toEqual(expect.objectContaining({
      environment_id: environment.id,
      visibility: 'open',
    }));
  });

  it('treats pending disclosure progress as visible only while the matching request is in flight', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'restart_runtime');

    expect(environmentLifecycleDisclosureHasPendingRequest(state, {
      action: 'restart_environment_runtime',
      environment_id: environment.id,
    })).toBe(true);
    expect(environmentLifecycleDisclosureHasPendingRequest(state, {
      action: '',
      environment_id: environment.id,
    })).toBe(false);
    expect(environmentLifecycleDisclosureHasPendingRequest(state, {
      action: 'stop_environment_runtime',
      environment_id: environment.id,
    })).toBe(false);
  });

  it('clears terminal progress when the user dismisses the visible disclosure', () => {
    const environment = localEnvironmentEntry();
    const initial = beginDisclosure(environment.id, 'update_runtime');
    const state = reconcileEnvironmentLifecycleDisclosure(
      initial,
      [environment],
      [lifecycleProgress(environment.id, initial!.started_at_unix_ms)],
    );

    expect(closeEnvironmentLifecycleDisclosure(state, environment.id)).toBeNull();
  });

  it('creates disclosure state for every product-managed Runtime update', () => {
    expect(environmentActionStartsLifecycleDisclosure({
      intent: 'update_runtime',
      label: 'Update Runtime',
      enabled: true,
      variant: 'outline',
      runtime_operation_method: 'runtime_gateway',
    })).toBe(true);
  });

  it('keeps a direct Runtime refresh inside the shared lifecycle disclosure', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'refresh_runtime');

    expect(environmentActionStartsLifecycleDisclosure({
      intent: 'refresh_runtime',
      label: 'Refresh Runtime status',
      enabled: true,
      variant: 'outline',
      runtime_operation_method: 'runtime_gateway',
    })).toBe(true);
    expect(environmentLifecycleDisclosureHasPendingRequest(state, {
      action: 'refresh_environment_runtime',
      environment_id: environment.id,
    })).toBe(true);
  });

  it('opens one pending disclosure for the first reinstall click and ignores older progress', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'reinstall_target');
    const oldFailure = reinstallProgress({
      environmentID: environment.id,
      operationKey: 'reinstall-old',
      startedAt: state!.started_at_unix_ms - 1,
      status: 'failed',
    });

    expect(state).toEqual(expect.objectContaining({
      environment_id: environment.id,
      intent: 'reinstall_target',
      visibility: 'open',
      operation_binding: 'next_reinstall',
    }));
    expect(reconcileEnvironmentLifecycleDisclosure(state, [environment], [oldFailure])).toBe(state);
    expect(visibleEnvironmentLifecycleProgress({
      environment,
      selectedProgress: oldFailure,
      disclosure: state,
    })).toBeNull();
  });

  it('binds the first new reinstall operation whether progress arrives before or after the action result', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'reinstall_target');
    const current = reinstallProgress({
      environmentID: environment.id,
      operationKey: 'reinstall-current',
      startedAt: state!.started_at_unix_ms + 1,
    });
    const delayed = reconcileEnvironmentLifecycleDisclosure(state, [environment], []);
    const boundAfterDelay = reconcileEnvironmentLifecycleDisclosure(delayed, [environment], [current]);
    const boundImmediately = reconcileEnvironmentLifecycleDisclosure(state, [environment], [current]);

    for (const bound of [boundAfterDelay, boundImmediately]) {
      expect(bound).toEqual(expect.objectContaining({
        operation_key: 'reinstall-current',
        operation_binding: 'exact',
        last_progress: current,
      }));
      expect(visibleEnvironmentLifecycleProgress({
        environment,
        selectedProgress: current,
        disclosure: bound,
      })).toBe(current);
    }
  });

  it('binds target-owned reinstall progress for the selected registration', () => {
    const target = localEnvironmentEntry();
    const targetID = target.managed_runtime_target_id;
    if (!targetID) {
      throw new Error('Expected a managed Runtime target id.');
    }
    const registration = {
      ...target,
      id: 'registration:local',
      managed_runtime_target_id: targetID,
    };
    const state = beginDisclosure(registration.id, 'reinstall_target');
    const current = reinstallProgress({
      environmentID: targetID,
      operationKey: 'reinstall-shared-target',
      startedAt: state!.started_at_unix_ms + 1,
    });
    const bound = reconcileEnvironmentLifecycleDisclosure(state, [registration], [current]);

    expect(bound).toEqual(expect.objectContaining({
      operation_key: 'reinstall-shared-target',
      last_progress: current,
    }));
  });

  it('binds an existing operation returned by the action without reopening through a second focus path', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'reinstall_target');
    const attempt = {
      operation_key: state!.operation_key,
      started_at_unix_ms: state!.started_at_unix_ms,
    };
    const existing = reinstallProgress({
      environmentID: environment.id,
      operationKey: 'reinstall-existing',
      startedAt: state!.started_at_unix_ms - 100,
      status: 'failed',
    });
    const identified = bindEnvironmentLifecycleDisclosureOperation(state, environment.id, attempt, {
      operation_key: existing.operation_key!,
      started_at_unix_ms: existing.started_at_unix_ms!,
    });
    const bound = reconcileEnvironmentLifecycleDisclosure(identified, [environment], [existing]);

    expect(bound).toEqual(expect.objectContaining({
      operation_key: 'reinstall-existing',
      operation_binding: 'exact',
      last_progress: existing,
    }));
  });

  it('keeps the latest clicked Environment as the only disclosure owner', () => {
    const firstEnvironment = localEnvironmentEntry();
    const secondEnvironment = {
      ...firstEnvironment,
      id: 'local:second',
      managed_runtime_target_id: undefined,
      managed_runtime_placement_target_id: undefined,
      provider_runtime_link_target: undefined,
    };
    const first = beginDisclosure(firstEnvironment.id, 'reinstall_target');
    const second = beginEnvironmentLifecycleDisclosure(
      first,
      secondEnvironment.id,
      'reinstall_target',
      {
        operation_key: 'second-request',
        started_at_unix_ms: first!.started_at_unix_ms + 1,
      },
    );
    const lateFirstProgress = reinstallProgress({
      environmentID: firstEnvironment.id,
      operationKey: 'reinstall-first',
      startedAt: second!.started_at_unix_ms + 1,
    });

    expect(reconcileEnvironmentLifecycleDisclosure(
      second,
      [firstEnvironment, secondEnvironment],
      [lateFirstProgress],
    )).toBe(second);
    expect(second?.environment_id).toBe(secondEnvironment.id);
  });

  it('abandons only an unbound failed request and preserves progress owned by the main process', () => {
    const environment = localEnvironmentEntry();
    const state = beginDisclosure(environment.id, 'reinstall_target');
    const attempt = {
      operation_key: state!.operation_key,
      started_at_unix_ms: state!.started_at_unix_ms,
    };
    const current = reinstallProgress({
      environmentID: environment.id,
      operationKey: 'reinstall-current',
      startedAt: state!.started_at_unix_ms + 1,
      status: 'failed',
    });
    const bound = reconcileEnvironmentLifecycleDisclosure(state, [environment], [current]);

    expect(abandonEnvironmentLifecycleDisclosureAttempt(state, environment.id, attempt)).toBeNull();
    expect(abandonEnvironmentLifecycleDisclosureAttempt(bound, environment.id, attempt)).toBe(bound);
  });

  it('routes an exact external focus request through the same disclosure state', () => {
    const environment = localEnvironmentEntry();
    const progress = reinstallProgress({
      environmentID: environment.id,
      operationKey: 'reinstall-confirmation',
      startedAt: 900,
      status: 'needs_confirmation',
    });
    const focused = focusEnvironmentLifecycleDisclosure(null, environment.id, progress);

    expect(focused).toEqual(expect.objectContaining({
      environment_id: environment.id,
      visibility: 'open',
      operation_key: 'reinstall-confirmation',
      operation_binding: 'exact',
      last_progress: progress,
    }));
  });

  it('starts disclosure only for a fresh reinstall preview, not for confirmation', () => {
    expect(environmentActionStartsLifecycleDisclosure({
      intent: 'reinstall_target',
      label: 'Reinstall Redeven',
      enabled: true,
      variant: 'outline',
    })).toBe(true);
    expect(environmentActionStartsLifecycleDisclosure({
      intent: 'reinstall_target',
      label: 'Reinstall Redeven',
      enabled: true,
      variant: 'outline',
      operation_key: 'reinstall-confirmation',
      preflight_id: 'preflight-confirmation',
    })).toBe(false);
  });
});
