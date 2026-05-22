import { describe, expect, it } from 'vitest';

import { runtimeLifecycleProgress } from '../shared/desktopRuntimeLifecycleProgress';
import { LauncherOperationRegistry } from './launcherOperations';

describe('LauncherOperationRegistry', () => {
  it('tracks operations as cancelable runtime lifecycle progress snapshots', () => {
    const changed: string[] = [];
    const registry = new LauncherOperationRegistry((snapshot) => {
      changed.push(`${snapshot.operation_key}:${snapshot.status}:${snapshot.phase}`);
    });

    const operation = registry.create({
      operation_key: 'ssh:devbox:default:key_agent:remote_default',
      action: 'start_environment_runtime',
      subject_kind: 'ssh_environment',
      subject_id: 'ssh:devbox:default:key_agent:remote_default',
      environment_id: 'ssh:devbox:default:key_agent:remote_default',
      environment_label: 'Devbox',
      phase: 'ssh_connecting',
      title: 'Opening SSH control connection',
      detail: 'Connecting to devbox.',
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'ssh_host',
        phase: 'checking_host',
        targetLabel: 'Devbox',
        targetDetail: 'devbox',
      }),
      cancelable: true,
      interrupt_label: 'Stop startup',
      interrupt_detail: 'Stops this SSH runtime startup.',
      interrupt_kind: 'generic',
    });

    expect(operation.subject_generation).toBe(0);
    expect(registry.progressItems()).toEqual([
      expect.objectContaining({
        operation_key: operation.operation_key,
        action: 'start_environment_runtime',
        subject_kind: 'ssh_environment',
        subject_id: operation.subject_id,
        status: 'running',
        lifecycle_progress: expect.objectContaining({
          kind: 'runtime_lifecycle',
          location: 'ssh_host',
          phase: 'checking_host',
          target_label: 'Devbox',
        }),
        cancelable: true,
        interrupt_label: 'Stop startup',
        interrupt_kind: 'generic',
      }),
    ]);
    expect(changed).toEqual([`${operation.operation_key}:running:ssh_connecting`]);
  });

  it('bumps subject generation on delete and marks matching operations stale', () => {
    const registry = new LauncherOperationRegistry();
    const operation = registry.create({
      operation_key: 'ssh:devbox:default:key_agent:remote_default',
      action: 'start_environment_runtime',
      subject_kind: 'ssh_environment',
      subject_id: 'ssh:devbox:default:key_agent:remote_default',
      phase: 'ssh_uploading_archive',
      title: 'Uploading runtime package',
      detail: 'Uploading.',
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'ssh_host',
        phase: 'installing_runtime_package',
        targetLabel: 'Devbox',
        stepStates: [
          { id: 'checking_host', status: 'succeeded' },
          { id: 'checking_runtime_package', status: 'succeeded' },
          { id: 'detecting_platform', status: 'succeeded' },
          { id: 'preparing_runtime_package', status: 'succeeded' },
          { id: 'installing_runtime_package', status: 'running', detail: 'Uploading.' },
        ],
      }),
      cancelable: true,
    });

    const touched = registry.markSubjectDeleted('ssh_environment', operation.subject_id, {
      status: 'canceling',
      phase: 'canceling_deleted_connection',
      title: 'Connection removed',
      detail: 'Desktop is canceling the startup task for this deleted connection.',
    });

    expect(touched).toHaveLength(1);
    expect(touched[0]).toEqual(expect.objectContaining({
      operation_key: operation.operation_key,
      deleted_subject: true,
      status: 'canceling',
      lifecycle_progress: expect.objectContaining({
        location: 'ssh_host',
        phase: 'installing_runtime_package',
        active_step_id: 'installing_runtime_package',
      }),
    }));
    expect(touched[0]?.lifecycle_progress?.steps.map((step) => [step.id, step.status, step.detail ?? ''])).toEqual([
      ['checking_host', 'succeeded', ''],
      ['checking_runtime_package', 'succeeded', ''],
      ['detecting_platform', 'succeeded', ''],
      ['preparing_runtime_package', 'succeeded', ''],
      ['installing_runtime_package', 'running', 'Uploading.'],
      ['starting_runtime_process', 'pending', ''],
      ['checking_runtime_service', 'pending', ''],
      ['runtime_ready', 'pending', ''],
    ]);
    expect(registry.currentSubjectGeneration('ssh_environment', operation.subject_id)).toBe(1);
    expect(registry.isStale(operation.operation_key)).toBe(true);
  });

  it('aborts cancelable operations without removing their cleanup progress', () => {
    const registry = new LauncherOperationRegistry();
    const operation = registry.create({
      operation_key: 'ssh:devbox:default:key_agent:remote_default',
      action: 'start_environment_runtime',
      subject_kind: 'ssh_environment',
      subject_id: 'ssh:devbox:default:key_agent:remote_default',
      phase: 'ssh_waiting_report',
      title: 'Waiting for runtime readiness',
      detail: 'Waiting.',
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'ssh_host',
        phase: 'checking_runtime_service',
        targetLabel: 'Devbox',
      }),
      cancelable: true,
    });
    const signal = registry.operationSignal(operation.operation_key);

    const canceled = registry.cancel(operation.operation_key, 'User canceled SSH startup.');

    expect(signal?.aborted).toBe(true);
    expect(canceled).toEqual(expect.objectContaining({
      status: 'canceling',
      cancelable: false,
      phase: 'runtime_lifecycle_canceling',
      title: 'Stopping runtime startup',
      lifecycle_progress: expect.objectContaining({
        phase: 'checking_runtime_service',
        active_step_id: 'checking_runtime_service',
      }),
      interrupt_label: undefined,
      interrupt_kind: undefined,
    }));
    registry.finish(operation.operation_key, 'canceled', {
      phase: 'canceled',
      title: 'Startup canceled',
      detail: 'Desktop stopped the SSH runtime startup.',
    });
    expect(registry.progressItems()[0]).toEqual(expect.objectContaining({
      status: 'canceled',
      title: 'Startup canceled',
    }));
  });

  it('still aborts a deleted-subject operation after the UI cancel affordance is removed', () => {
    const registry = new LauncherOperationRegistry();
    const operation = registry.create({
      operation_key: 'ssh:devbox:default:key_agent:remote_default',
      action: 'start_environment_runtime',
      subject_kind: 'ssh_environment',
      subject_id: 'ssh:devbox:default:key_agent:remote_default',
      phase: 'ssh_remote_installing',
      title: 'Installing remote runtime',
      detail: 'Installing.',
      cancelable: true,
    });
    const signal = registry.operationSignal(operation.operation_key);

    registry.markSubjectDeleted('ssh_environment', operation.subject_id, {
      cancelable: false,
      deleted_subject: true,
    });
    const canceled = registry.cancel(operation.operation_key, 'Connection removed. Desktop is canceling the SSH startup task in the background.');

    expect(signal?.aborted).toBe(true);
    expect(canceled).toEqual(expect.objectContaining({
      status: 'canceling',
      phase: 'canceling_deleted_connection',
      title: 'Connection removed',
      cancelable: false,
      deleted_subject: true,
    }));
  });

  it('carries structured failure presentation without rewriting it', () => {
    const registry = new LauncherOperationRegistry();
    const operation = registry.create({
      operation_key: 'ssh:dify:default:key_agent:remote_default',
      action: 'start_environment_runtime',
      subject_kind: 'ssh_environment',
      subject_id: 'ssh:dify:default:key_agent:remote_default',
      phase: 'ssh_waiting_report',
      title: 'Waiting for runtime readiness',
      detail: 'Waiting.',
      cancelable: true,
    });
    const failure = {
      code: 'ssh_connection_failed' as const,
      severity: 'error' as const,
      title: 'SSH Connection Failed',
      summary: 'SSH connection to "dify" failed.',
      diagnostics: [{
        channel: 'control_stderr',
        label: 'SSH command stderr',
        text: 'ssh: Could not resolve hostname dify',
      }],
    };

    registry.finish(operation.operation_key, 'failed', {
      phase: 'failed',
      title: 'SSH runtime start failed',
      detail: failure.summary,
      failure,
    });

    expect(registry.progressItems()[0]?.failure).toEqual(failure);
  });

  it('keeps failed operation next actions durable until the user dismisses', () => {
    const registry = new LauncherOperationRegistry();
    const operation = registry.create({
      operation_key: 'ssh:devbox:default:key_agent:remote_default',
      action: 'update_environment_runtime',
      subject_kind: 'ssh_environment',
      subject_id: 'ssh:devbox:default:key_agent:remote_default',
      phase: 'checking_runtime_package',
      title: 'Updating runtime',
      detail: 'Desktop is checking the SSH runtime package.',
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'ssh_host',
        operation: 'update',
        phase: 'checking_runtime_package',
        targetLabel: 'Devbox',
      }),
      cancelable: true,
    });

    registry.finish(operation.operation_key, 'failed', {
      phase: 'failed',
      title: 'Runtime update failed',
      detail: 'Desktop could not update the runtime.',
      next_actions: [{
        kind: 'dismiss',
        operation_key: operation.operation_key,
        label: 'Dismiss',
      }],
    });

    expect(registry.progressItems()[0]).toEqual(expect.objectContaining({
      status: 'failed',
      next_actions: expect.arrayContaining([
        expect.objectContaining({ kind: 'dismiss' }),
      ]),
    }));
  });
});
