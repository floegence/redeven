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
  beginEnvironmentLifecycleDisclosure,
  closeEnvironmentLifecycleDisclosure,
  environmentActionStartsLifecycleDisclosure,
  environmentLifecycleDisclosureHasPendingRequest,
  pendingEnvironmentLifecycleProgress,
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

function progressStartedAfter(state: Exclude<ReturnType<typeof beginEnvironmentLifecycleDisclosure>, null>): number {
  return state.started_at_unix_ms + 1;
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
  it('creates pending progress immediately from a lifecycle disclosure', () => {
    const environment = localEnvironmentEntry();
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'update_runtime');
    const progress = pendingEnvironmentLifecycleProgress(environment, state!);

    expect(progress.action).toBe('update_environment_runtime');
    expect(progress.status).toBe('running');
    expect(progress.title).toBe('Updating runtime');
    expect(progress.lifecycle_progress).toEqual(expect.objectContaining({
      kind: 'runtime_lifecycle',
      location: 'local_host',
      phase: 'checking_existing_runtime',
      target_id: environment.id,
      target_label: environment.label,
    }));
  });

  it('uses pending lifecycle progress only until matching real progress exists', () => {
    const environment = localEnvironmentEntry();
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'restart_runtime');
    const progress = visibleEnvironmentLifecycleProgress({
      environment,
      selectedProgress: null,
      disclosure: state,
    });

    expect(progress).toMatchObject({
      action: 'restart_environment_runtime',
      status: 'running',
      title: 'Restarting runtime',
    });
  });

  it('does not synthesize pending lifecycle progress when the current request no longer matches the disclosure', () => {
    const environment = localEnvironmentEntry();
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'restart_runtime');

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
    })).toMatchObject({
      action: 'restart_environment_runtime',
      status: 'running',
      title: 'Restarting runtime',
    });
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
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'restart_runtime');
    const failedRestart = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'checking_runtime_service',
      status: 'failed',
      operationKey: 'restart-failed-op',
      startedAt: progressStartedAfter(state!),
    });

    expect(visibleEnvironmentLifecycleProgress({
      environment,
      selectedProgress: failedRestart,
      disclosure: state,
    })).toBe(failedRestart);
  });

  it('uses the terminal disclosure receipt instead of a stale selected running progress for the same attempt', () => {
    const environment = localEnvironmentEntry();
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'restart_runtime');
    const startedAt = progressStartedAfter(state!);
    const runningRestart = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'checking_runtime_service',
      status: 'running',
      operationKey: 'restart-op',
      startedAt,
    });
    const failedRestart = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'checking_runtime_service',
      status: 'failed',
      operationKey: 'restart-op',
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
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'restart_runtime');
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
    expect(progress).toMatchObject({
      action: 'restart_environment_runtime',
      status: 'running',
    });
  });

  it('does not let a different lifecycle action replace a new pending disclosure', () => {
    const environment = localEnvironmentEntry();
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'restart_runtime');
    const updateFailure = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'update_environment_runtime',
      operation: 'update',
      phase: 'checking_runtime_service',
      status: 'failed',
      operationKey: 'update-failed-op',
      startedAt: progressStartedAfter(state!),
    });

    const progress = visibleEnvironmentLifecycleProgress({
      environment,
      selectedProgress: updateFailure,
      disclosure: state,
    });

    expect(progress).not.toBe(updateFailure);
    expect(progress).toMatchObject({
      action: 'restart_environment_runtime',
      status: 'running',
    });
  });

  it('binds real progress and keeps terminal progress while the popup is open', () => {
    const environment = localEnvironmentEntry();
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'update_runtime');
    const startedAt = progressStartedAfter(state!);
    const realProgress = lifecycleProgress(environment.id, startedAt);
    const bound = reconcileEnvironmentLifecycleDisclosure(state, [environment], [realProgress]);

    expect(bound).toEqual(expect.objectContaining({
      environment_id: environment.id,
      visibility: 'open',
      operation_key: `runtime-op:${startedAt}`,
      last_progress: realProgress,
    }));
    expect(reconcileEnvironmentLifecycleDisclosure(bound, [environment], [])).toBe(bound);
  });

  it('keeps a terminal receipt visible after the registry removes it while the popup is open', () => {
    const environment = localEnvironmentEntry();
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'restart_runtime');
    const failedRestart = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'checking_runtime_service',
      status: 'failed',
      operationKey: 'restart-failed-op',
      startedAt: progressStartedAfter(state!),
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
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'restart_runtime');
    const startedAt = progressStartedAfter(state!);
    const realProgress = restartReadyProgress(environment.id, startedAt);
    const bound = reconcileEnvironmentLifecycleDisclosure(state, [environment], [realProgress]);

    expect(bound).toEqual(expect.objectContaining({
      environment_id: environment.id,
      visibility: 'open',
      operation_key: `restart-runtime-op:${startedAt}`,
      last_progress: realProgress,
    }));
    expect(reconcileEnvironmentLifecycleDisclosure(bound, [environment], [])).toBe(bound);
  });

  it('keeps terminal stop success visible as a receipt while the popup is open', () => {
    const environment = localEnvironmentEntry();
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'stop_runtime');
    const startedAt = progressStartedAfter(state!);
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
      operation_key: `stop-runtime-op:${startedAt}`,
      last_progress: realProgress,
    }));
    expect(reconcileEnvironmentLifecycleDisclosure(bound, [environment], [])).toBe(bound);
    expect(closeEnvironmentLifecycleDisclosure(bound, environment.id)).toBeNull();
  });

  it('binds terminal failure progress without relying on disclosure state as the dismiss owner', () => {
    const environment = localEnvironmentEntry();
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'stop_runtime');
    const startedAt = progressStartedAfter(state!);
    const realProgress = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'stop_environment_runtime',
      operation: 'stop',
      phase: 'verifying_runtime_stopped',
      status: 'failed',
      operationKey: 'stop-failed-op',
      startedAt,
    });
    const bound = reconcileEnvironmentLifecycleDisclosure(state, [environment], [realProgress]);

    expect(bound).toEqual(expect.objectContaining({
      environment_id: environment.id,
      visibility: 'open',
      operation_key: `stop-failed-op:${startedAt}`,
      last_progress: realProgress,
    }));
    expect(reconcileEnvironmentLifecycleDisclosure(bound, [environment], [])).toBe(bound);
    expect(closeEnvironmentLifecycleDisclosure(bound, environment.id)).toBeNull();
  });

  it('keeps canceled lifecycle receipts visible only until the user closes the popup', () => {
    const environment = localEnvironmentEntry();
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'restart_runtime');
    const startedAt = progressStartedAfter(state!);
    const realProgress = actionLifecycleProgress({
      environmentID: environment.id,
      action: 'restart_environment_runtime',
      operation: 'restart',
      phase: 'checking_runtime_service',
      status: 'canceled',
      operationKey: 'restart-canceled-op',
      startedAt,
    });
    const bound = reconcileEnvironmentLifecycleDisclosure(state, [environment], [realProgress]);

    expect(bound).toEqual(expect.objectContaining({
      environment_id: environment.id,
      visibility: 'open',
      operation_key: `restart-canceled-op:${startedAt}`,
      last_progress: realProgress,
    }));
    expect(closeEnvironmentLifecycleDisclosure(bound, environment.id)).toBeNull();
  });

  it('lets the user close a running disclosure and reopen it later', () => {
    const environment = localEnvironmentEntry();
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'restart_runtime');
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
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'restart_runtime');

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
    const initial = beginEnvironmentLifecycleDisclosure(null, environment.id, 'update_runtime');
    const state = reconcileEnvironmentLifecycleDisclosure(
      initial,
      [environment],
      [lifecycleProgress(environment.id, progressStartedAfter(initial!))],
    );

    expect(closeEnvironmentLifecycleDisclosure(state, environment.id)).toBeNull();
  });

  it('does not create disclosure state for Desktop update handoff actions', () => {
    expect(environmentActionStartsLifecycleDisclosure({
      intent: 'update_runtime',
      label: 'Update Desktop',
      enabled: true,
      variant: 'outline',
      runtime_operation_method: 'desktop_local_update_handoff',
    })).toBe(false);
  });
});
