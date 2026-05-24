import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import type { DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import { runtimeLifecycleProgress } from '../shared/desktopRuntimeLifecycleProgress';
import {
  testDesktopPreferences,
  testLocalEnvironment,
} from '../testSupport/desktopTestHelpers';
import {
  beginEnvironmentLifecycleDisclosure,
  closeEnvironmentLifecycleDisclosure,
  environmentActionStartsLifecycleDisclosure,
  lifecycleDisclosureTriggerLabel,
  pendingEnvironmentLifecycleProgress,
  reconcileEnvironmentLifecycleDisclosure,
  reopenEnvironmentLifecycleDisclosure,
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

function lifecycleProgress(environmentID: string): DesktopLauncherActionProgress {
  return {
    action: 'update_environment_runtime',
    environment_id: environmentID,
    environment_label: 'Local Environment',
    operation_key: 'runtime-op',
    subject_kind: 'local_environment',
    subject_id: environmentID,
    started_at_unix_ms: 100,
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

function restartReadyProgress(environmentID: string): DesktopLauncherActionProgress {
  return {
    action: 'restart_environment_runtime',
    environment_id: environmentID,
    environment_label: 'Local Environment',
    operation_key: 'restart-runtime-op',
    subject_kind: 'local_environment',
    subject_id: environmentID,
    started_at_unix_ms: 200,
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
    expect(lifecycleDisclosureTriggerLabel('update_runtime')).toBe('Updating...');
  });

  it('binds real progress and keeps terminal progress while the popup is open', () => {
    const environment = localEnvironmentEntry();
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'update_runtime');
    const realProgress = lifecycleProgress(environment.id);
    const bound = reconcileEnvironmentLifecycleDisclosure(state, [environment], [realProgress]);

    expect(bound).toEqual(expect.objectContaining({
      environment_id: environment.id,
      visibility: 'open',
      operation_key: 'runtime-op:100',
      last_progress: realProgress,
    }));
    expect(reconcileEnvironmentLifecycleDisclosure(bound, [environment], [])).toBe(bound);
  });

  it('keeps terminal restart progress visible until the open popup can offer Open', () => {
    const environment = localEnvironmentEntry();
    const state = beginEnvironmentLifecycleDisclosure(null, environment.id, 'restart_runtime');
    const realProgress = restartReadyProgress(environment.id);
    const bound = reconcileEnvironmentLifecycleDisclosure(state, [environment], [realProgress]);

    expect(bound).toEqual(expect.objectContaining({
      environment_id: environment.id,
      visibility: 'open',
      operation_key: 'restart-runtime-op:200',
      last_progress: realProgress,
    }));
    expect(reconcileEnvironmentLifecycleDisclosure(bound, [environment], [])).toBe(bound);
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

  it('clears terminal progress when the user dismisses the visible disclosure', () => {
    const environment = localEnvironmentEntry();
    const state = reconcileEnvironmentLifecycleDisclosure(
      beginEnvironmentLifecycleDisclosure(null, environment.id, 'update_runtime'),
      [environment],
      [lifecycleProgress(environment.id)],
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
