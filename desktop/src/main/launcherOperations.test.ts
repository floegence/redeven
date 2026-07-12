import { afterEach, describe, expect, it, vi } from 'vitest';

import { openConnectionProgress } from '../shared/desktopOpenConnectionProgress';
import { runtimeLifecycleProgress } from '../shared/desktopRuntimeLifecycleProgress';
import { LauncherOperationRegistry } from './launcherOperations';

describe('LauncherOperationRegistry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('replaces same-key ready progress when a new update attempt starts', () => {
    const registry = new LauncherOperationRegistry();
    const targetID = 'local:container:docker:dev:abcd1234';
    registry.create({
      operation_key: targetID,
      action: 'start_environment_runtime',
      subject_kind: 'runtime_target',
      subject_id: targetID,
      environment_id: targetID,
      environment_label: 'Dev Container',
      phase: 'runtime_ready',
      title: 'Runtime ready',
      detail: 'The previous runtime attempt is ready.',
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'local_container',
        operation: 'start',
        planState: 'terminal',
        phase: 'runtime_ready',
        targetID,
        targetLabel: 'Dev Container',
        stepStates: [
          { id: 'checking_container', status: 'succeeded' },
          { id: 'preparing_runtime_package', status: 'pending' },
          { id: 'checking_runtime_service', status: 'succeeded' },
          { id: 'runtime_ready', status: 'succeeded' },
        ],
      }),
      cancelable: false,
    });
    registry.finish(targetID, 'succeeded', {
      phase: 'runtime_ready',
      title: 'Runtime ready',
      detail: 'The previous runtime attempt is ready.',
    });

    const update = registry.create({
      operation_key: targetID,
      action: 'update_environment_runtime',
      subject_kind: 'runtime_target',
      subject_id: targetID,
      environment_id: targetID,
      environment_label: 'Dev Container',
      phase: 'checking_container',
      title: 'Updating runtime in container',
      detail: 'Desktop is checking the selected running container.',
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'local_container',
        operation: 'update',
        phase: 'checking_container',
        targetID,
        targetLabel: 'Dev Container',
        stepStates: [
          { id: 'checking_container', status: 'running' },
        ],
      }),
      cancelable: true,
      interrupt_label: 'Stop startup',
      interrupt_kind: 'generic',
    });

    expect(registry.progressItems()).toHaveLength(1);
    expect(update.status).toBe('running');
    expect(update.action).toBe('update_environment_runtime');
    expect(update.lifecycle_progress).toEqual(expect.objectContaining({
      operation: 'update',
      active_step_id: 'checking_container',
      plan_state: 'executing',
    }));
    expect(update.lifecycle_progress?.steps.map((step) => [step.id, step.status])).toEqual([
      ['checking_container', 'running'],
    ]);
    expect(update.lifecycle_progress?.steps.map((step) => step.id)).not.toContain('preparing_runtime_package');
    expect(update.lifecycle_progress?.steps.map((step) => step.id)).not.toContain('runtime_ready');
  });

  it('carries Flower warmup presentation context through snapshots and progress', () => {
    const changed: string[] = [];
    const registry = new LauncherOperationRegistry((snapshot) => {
      changed.push(`${snapshot.operation_key}:${snapshot.presentation_context ?? 'none'}:${snapshot.phase}`);
    });
    const operationKey = 'local:host:local';
    const operation = registry.create({
      operation_key: operationKey,
      action: 'start_environment_runtime',
      subject_kind: 'local_environment',
      subject_id: 'local',
      environment_id: 'local',
      environment_label: 'Local Environment',
      phase: 'checking_existing_runtime',
      title: 'Checking existing runtime',
      detail: 'Desktop is checking whether a compatible local runtime is already running.',
      presentation_context: 'flower_warmup',
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'local_host',
        operation: 'start',
        phase: 'checking_existing_runtime',
        targetID: operationKey,
        targetLabel: 'Local Environment',
      }),
      cancelable: false,
    });

    expect(operation.presentation_context).toBe('flower_warmup');
    expect(registry.progressItems()).toEqual([
      expect.objectContaining({
        operation_key: operationKey,
        presentation_context: 'flower_warmup',
        lifecycle_progress: expect.objectContaining({
          operation: 'start',
          phase: 'checking_existing_runtime',
        }),
      }),
    ]);

    registry.update(operationKey, {
      phase: 'starting_runtime_process',
      title: 'Starting runtime',
      detail: 'Desktop is starting the local runtime process.',
    });

    expect(registry.get(operationKey)).toEqual(expect.objectContaining({
      presentation_context: 'flower_warmup',
      phase: 'starting_runtime_process',
    }));
    expect(registry.progressItems()[0]).toEqual(expect.objectContaining({
      presentation_context: 'flower_warmup',
      phase: 'starting_runtime_process',
    }));
    expect(changed).toEqual([
      `${operationKey}:flower_warmup:checking_existing_runtime`,
      `${operationKey}:flower_warmup:starting_runtime_process`,
    ]);
  });

  it('rejects stale same-key attempt updates after a newer operation starts', () => {
    const registry = new LauncherOperationRegistry();
    const operationKey = 'local:host:dev';
    const first = registry.create({
      operation_key: operationKey,
      action: 'start_environment_runtime',
      subject_kind: 'local_environment',
      subject_id: 'dev',
      environment_id: 'dev',
      environment_label: 'Dev',
      phase: 'checking_existing_runtime',
      title: 'Checking runtime',
      detail: 'Desktop is checking the previous runtime.',
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'local_host',
        operation: 'start',
        phase: 'checking_existing_runtime',
        targetID: operationKey,
        targetLabel: 'Dev',
      }),
      cancelable: false,
    });

    const second = registry.create({
      operation_key: operationKey,
      action: 'update_environment_runtime',
      subject_kind: 'local_environment',
      subject_id: 'dev',
      environment_id: 'dev',
      environment_label: 'Dev',
      phase: 'checking_existing_runtime',
      title: 'Updating runtime',
      detail: 'Desktop is checking the current runtime before updating.',
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'local_host',
        operation: 'update',
        phase: 'checking_existing_runtime',
        targetID: operationKey,
        targetLabel: 'Dev',
      }),
      cancelable: false,
    });

    const staleAttempt = {
      action: first.action,
      started_at_unix_ms: first.started_at_unix_ms,
    };
    const currentAttempt = {
      action: second.action,
      started_at_unix_ms: second.started_at_unix_ms,
    };

    expect(registry.updateCurrentAttempt(operationKey, staleAttempt, {
      phase: 'checking_runtime_service',
      title: 'Runtime ready',
      detail: 'A stale ready check completed late.',
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'local_host',
        operation: 'start',
        phase: 'checking_runtime_service',
        targetID: operationKey,
        targetLabel: 'Dev',
      }),
    })).toBeNull();
    expect(registry.finishCurrentAttempt(operationKey, staleAttempt, 'succeeded', {
      phase: 'runtime_ready',
      title: 'Runtime ready',
      detail: 'A stale ready check finished late.',
    })).toBeNull();

    const current = registry.get(operationKey);
    expect(current).toEqual(expect.objectContaining({
      action: 'update_environment_runtime',
      started_at_unix_ms: second.started_at_unix_ms,
      status: 'running',
      phase: 'checking_existing_runtime',
    }));
    expect(current?.lifecycle_progress).toEqual(expect.objectContaining({
      operation: 'update',
      active_step_id: 'checking_existing_runtime',
    }));

    expect(registry.updateCurrentAttempt(operationKey, currentAttempt, {
      phase: 'checking_runtime_service',
      title: 'Checking service',
      detail: 'The active update attempt is checking the runtime service.',
    })).toEqual(expect.objectContaining({
      action: 'update_environment_runtime',
      phase: 'checking_runtime_service',
    }));
  });

  it('gives same-key same-action attempts distinct identities within one millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const registry = new LauncherOperationRegistry();
    const operationKey = 'local:host:dev';
    const first = registry.create({
      operation_key: operationKey,
      action: 'update_environment_runtime',
      subject_kind: 'local_environment',
      subject_id: 'dev',
      environment_id: 'dev',
      environment_label: 'Dev',
      phase: 'checking_existing_runtime',
      title: 'Updating runtime',
      detail: 'Desktop is checking the previous update attempt.',
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'local_host',
        operation: 'update',
        phase: 'checking_existing_runtime',
        targetID: operationKey,
        targetLabel: 'Dev',
      }),
      cancelable: false,
    });
    const second = registry.create({
      operation_key: operationKey,
      action: 'update_environment_runtime',
      subject_kind: 'local_environment',
      subject_id: 'dev',
      environment_id: 'dev',
      environment_label: 'Dev',
      phase: 'checking_existing_runtime',
      title: 'Updating runtime',
      detail: 'Desktop is checking the current update attempt.',
      lifecycle_progress: runtimeLifecycleProgress({
        location: 'local_host',
        operation: 'update',
        phase: 'checking_existing_runtime',
        targetID: operationKey,
        targetLabel: 'Dev',
      }),
      cancelable: false,
    });

    expect(second.started_at_unix_ms).toBeGreaterThan(first.started_at_unix_ms);
    expect(registry.updateCurrentAttempt(operationKey, {
      action: first.action,
      started_at_unix_ms: first.started_at_unix_ms,
    }, {
      phase: 'checking_runtime_service',
      title: 'Runtime ready',
      detail: 'A stale same-action update completed late.',
    })).toBeNull();
    expect(registry.get(operationKey)).toEqual(expect.objectContaining({
      action: second.action,
      started_at_unix_ms: second.started_at_unix_ms,
      phase: 'checking_existing_runtime',
    }));
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

  it('preserves failed Open operation next actions in the durable progress contract', () => {
    const registry = new LauncherOperationRegistry();
    const operation = registry.create({
      operation_key: 'local:host:local:open',
      action: 'open_local_environment',
      subject_kind: 'local_environment',
      subject_id: 'local',
      environment_id: 'local',
      environment_label: 'Local Environment',
      phase: 'checking_runtime_record',
      title: 'Checking runtime status',
      detail: 'Desktop is checking the runtime status before opening this environment.',
      open_progress: openConnectionProgress({
        location: 'local_host',
        phase: 'checking_runtime_record',
        environmentID: 'local',
        environmentLabel: 'Local Environment',
        targetID: 'local:local',
        targetLabel: 'Local Environment',
      }),
      cancelable: true,
    });

    registry.finish(operation.operation_key, 'failed', {
      phase: 'failed',
      title: 'Open failed',
      detail: 'Desktop could not open the local environment.',
      open_progress: openConnectionProgress({
        location: 'local_host',
        phase: 'failed',
        environmentID: 'local',
        environmentLabel: 'Local Environment',
        targetID: 'local:local',
        targetLabel: 'Local Environment',
      }),
      next_actions: [
        {
          kind: 'refresh_status',
          environment_id: 'local',
          label: 'Refresh status',
        },
        {
          kind: 'copy_diagnostics',
          operation_key: operation.operation_key,
          label: 'Copy log',
        },
        {
          kind: 'dismiss',
          operation_key: operation.operation_key,
          label: 'Dismiss',
        },
      ],
    });

    expect(registry.operations()[0]).toEqual(expect.objectContaining({
      status: 'failed',
      next_actions: [
        expect.objectContaining({ kind: 'refresh_status', environment_id: 'local' }),
        expect.objectContaining({ kind: 'copy_diagnostics', operation_key: operation.operation_key }),
        expect.objectContaining({ kind: 'dismiss', operation_key: operation.operation_key }),
      ],
    }));
    expect(registry.progressItems()[0]).toEqual(expect.objectContaining({
      status: 'failed',
      open_progress: expect.objectContaining({ phase: 'failed' }),
      next_actions: [
        expect.objectContaining({ kind: 'refresh_status', environment_id: 'local' }),
        expect.objectContaining({ kind: 'copy_diagnostics', operation_key: operation.operation_key }),
        expect.objectContaining({ kind: 'dismiss', operation_key: operation.operation_key }),
      ],
    }));
  });

  it('projects provider remote Open operations into action progress', () => {
    const registry = new LauncherOperationRegistry();
    const operation = registry.create({
      operation_key: 'env:provider%3Ahttps%253A%252F%252Fprovider.example.invalid%3Aenv%3Aenv_demo:remote_desktop:open',
      action: 'open_provider_environment',
      subject_kind: 'provider_environment',
      subject_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      environment_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      environment_label: 'Demo Environment',
      provider_origin: 'https://provider.example.invalid',
      provider_id: 'example_control_plane',
      phase: 'opening_window',
      title: 'Opening environment',
      detail: 'Desktop is opening the provider environment window.',
      open_progress: openConnectionProgress({
        location: 'provider_remote',
        phase: 'opening_window',
        environmentID: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
        environmentLabel: 'Demo Environment',
        targetID: 'env:provider%3Ahttps%253A%252F%252Fprovider.example.invalid%3Aenv%3Aenv_demo:remote_desktop',
        targetLabel: 'Demo Environment',
        targetDetail: 'Provider route',
      }),
      cancelable: true,
    });

    expect(registry.progressItems()[0]).toEqual(expect.objectContaining({
      operation_key: operation.operation_key,
      action: 'open_provider_environment',
      subject_kind: 'provider_environment',
      status: 'running',
      open_progress: expect.objectContaining({
        location: 'provider_remote',
        phase: 'opening_window',
      }),
    }));
  });

  it('records launcher Open phase transitions and final elapsed time', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_060)
      .mockReturnValueOnce(1_140)
      .mockReturnValueOnce(1_225);
    const registry = new LauncherOperationRegistry();
    const operation = registry.create({
      operation_key: 'ssh:devbox:open',
      action: 'open_ssh_environment',
      subject_kind: 'ssh_environment',
      subject_id: 'ssh:devbox',
      environment_id: 'ssh:devbox',
      environment_label: 'Devbox',
      phase: 'checking_runtime_record',
      title: 'Checking runtime',
      detail: 'Desktop is checking the saved runtime state.',
      open_progress: openConnectionProgress({
        location: 'ssh_host',
        phase: 'checking_runtime_record',
        environmentID: 'ssh:devbox',
        environmentLabel: 'Devbox',
      }),
      cancelable: true,
    });

    registry.update(operation.operation_key, {
      phase: 'opening_ssh_control',
      title: 'Opening SSH connection',
      detail: 'Desktop is opening the SSH control connection.',
      open_progress: openConnectionProgress({
        location: 'ssh_host',
        phase: 'opening_ssh_control',
        environmentID: 'ssh:devbox',
        environmentLabel: 'Devbox',
      }),
    });
    registry.update(operation.operation_key, {
      phase: 'opening_window',
      title: 'Opening environment',
      detail: 'Desktop is loading the hidden environment window.',
      open_progress: openConnectionProgress({
        location: 'ssh_host',
        phase: 'opening_window',
        environmentID: 'ssh:devbox',
        environmentLabel: 'Devbox',
      }),
    });
    const finished = registry.finish(operation.operation_key, 'succeeded', {
      phase: 'open_ready',
      title: 'Environment open',
      detail: 'The environment window is ready.',
      open_progress: openConnectionProgress({
        location: 'ssh_host',
        phase: 'open_ready',
        environmentID: 'ssh:devbox',
        environmentLabel: 'Devbox',
      }),
    });

    expect(finished?.open_timing).toEqual({
      started_at_unix_ms: 1_000,
      phase_started_at_unix_ms: 1_225,
      total_duration_ms: 225,
      completed_phases: [
        {
          phase: 'checking_runtime_record',
          started_at_unix_ms: 1_000,
          duration_ms: 60,
        },
        {
          phase: 'opening_ssh_control',
          started_at_unix_ms: 1_060,
          duration_ms: 80,
        },
        {
          phase: 'opening_window',
          started_at_unix_ms: 1_140,
          duration_ms: 85,
        },
      ],
    });
    expect(registry.progressItems()[0]?.open_timing).toEqual(finished?.open_timing);
  });
});
