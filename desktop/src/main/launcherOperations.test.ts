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
        phase: 'canceled',
      }),
    }));
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
        phase: 'canceled',
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

  it('keeps confirmation operations durable until the user continues or cancels', () => {
    const registry = new LauncherOperationRegistry();
    const confirmation = {
      confirmation_id: 'confirm-runtime-update',
      title: 'Runtime update needs confirmation',
      summary: 'Updating will stop the current Runtime Service.',
      active_work_label: '2 terminals',
      confirm_label: 'Update runtime',
      cancel_label: 'Cancel',
    };
    const operation = registry.create({
      operation_key: 'ssh:devbox:default:key_agent:remote_default',
      action: 'update_environment_runtime',
      subject_kind: 'ssh_environment',
      subject_id: 'ssh:devbox:default:key_agent:remote_default',
      status: 'awaiting_confirmation',
      phase: 'awaiting_confirmation',
      title: confirmation.title,
      detail: confirmation.summary,
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'ssh_host',
        operation: 'update',
        phase: 'awaiting_confirmation',
        targetLabel: 'Devbox',
      }),
      cancelable: true,
      confirmation,
      next_actions: [{
        kind: 'continue_after_confirmation',
        operation_key: 'ssh:devbox:default:key_agent:remote_default',
        confirmation_id: confirmation.confirmation_id,
        label: 'Update runtime',
      }],
    });

    expect(operation.status).toBe('awaiting_confirmation');
    expect(registry.progressItems()[0]).toEqual(expect.objectContaining({
      status: 'awaiting_confirmation',
      confirmation,
      next_actions: expect.arrayContaining([
        expect.objectContaining({ kind: 'continue_after_confirmation' }),
      ]),
    }));
  });
});
