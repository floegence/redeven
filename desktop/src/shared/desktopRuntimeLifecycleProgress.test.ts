import { describe, expect, it } from 'vitest';

import {
  desktopRuntimeLifecycleLocation,
  runtimeLifecycleProgress,
} from './desktopRuntimeLifecycleProgress';

describe('desktopRuntimeLifecycleProgress', () => {
  it('resolves startup locations from host access and placement', () => {
    const localHost = { kind: 'local_host' as const };
    const sshHost = {
      kind: 'ssh_host' as const,
      ssh: {
        ssh_destination: 'devbox',
        ssh_port: null,
        auth_mode: 'key_agent' as const,
      },
    };
    const hostPlacement = { kind: 'host_process' as const, runtime_root: '/home/dev/.redeven' };
    const containerPlacement = {
      kind: 'container_process' as const,
      container_engine: 'docker' as const,
      container_id: 'dev',
      container_ref: 'dev',
      container_label: 'dev',
      runtime_root: '/root/.redeven',
      bridge_strategy: 'exec_stream' as const,
    };

    expect(desktopRuntimeLifecycleLocation(localHost, hostPlacement)).toBe('local_host');
    expect(desktopRuntimeLifecycleLocation(localHost, containerPlacement)).toBe('local_container');
    expect(desktopRuntimeLifecycleLocation(sshHost, hostPlacement)).toBe('ssh_host');
    expect(desktopRuntimeLifecycleLocation(sshHost, containerPlacement)).toBe('ssh_container');
  });

  it('builds runtime lifecycle progress from the visible execution plan only', () => {
    const progress = runtimeLifecycleProgress({
      location: 'ssh_host',
      operation: 'start',
      planState: 'executing',
      planRevision: 2,
      phase: 'checking_runtime_service',
      targetID: 'ssh:devbox',
      targetLabel: 'Devbox',
      targetDetail: 'devbox',
      stepStates: [
        { id: 'checking_host', key: 'runtime-plan:0:checking_host', status: 'succeeded' },
        { id: 'checking_runtime_package', key: 'runtime-plan:1:checking_runtime_package', status: 'succeeded' },
        { id: 'checking_runtime_service', key: 'runtime-plan:2:checking_runtime_service', status: 'running', detail: 'Verifying service.' },
        { id: 'runtime_ready', key: 'runtime-plan:3:runtime_ready', status: 'pending' },
      ],
      omittedSteps: [
        { id: 'stopping_runtime_process', reason: 'runtime_already_openable' },
        { id: 'installing_runtime_package', reason: 'runtime_already_openable' },
      ],
    });

    expect(progress).toEqual(expect.objectContaining({
      kind: 'runtime_lifecycle',
      location: 'ssh_host',
      operation: 'start',
      plan_state: 'executing',
      plan_revision: 2,
      phase: 'checking_runtime_service',
      active_step_id: 'checking_runtime_service',
      stage_index: 3,
      stage_count: 4,
      target_id: 'ssh:devbox',
      target_label: 'Devbox',
      target_detail: 'devbox',
    }));
    expect(progress.steps.map((step) => [step.id, step.key, step.status, step.detail ?? ''])).toEqual([
      ['checking_host', 'runtime-plan:0:checking_host', 'succeeded', ''],
      ['checking_runtime_package', 'runtime-plan:1:checking_runtime_package', 'succeeded', ''],
      ['checking_runtime_service', 'runtime-plan:2:checking_runtime_service', 'running', 'Verifying service.'],
      ['runtime_ready', 'runtime-plan:3:runtime_ready', 'pending', ''],
    ]);
    expect(progress.diagnostics?.omitted_steps).toEqual([
      { id: 'stopping_runtime_process', reason: 'runtime_already_openable' },
      { id: 'installing_runtime_package', reason: 'runtime_already_openable' },
    ]);
  });

  it('keeps failed progress scoped to the execution plan instead of a static maximum sequence', () => {
    const progress = runtimeLifecycleProgress({
      location: 'local_container',
      operation: 'update',
      planState: 'terminal',
      phase: 'preparing_runtime_package',
      failedPhase: 'preparing_runtime_package',
      targetLabel: 'Dev Container',
      stepStates: [
        { id: 'checking_container', status: 'succeeded' },
        { id: 'checking_runtime_package', status: 'succeeded' },
        { id: 'preparing_runtime_package', status: 'failed', detail: 'go build failed' },
        { id: 'installing_runtime_package', status: 'pending' },
      ],
    });

    expect(progress).toEqual(expect.objectContaining({
      operation: 'update',
      phase: 'preparing_runtime_package',
      active_step_id: 'preparing_runtime_package',
      failed_step_id: 'preparing_runtime_package',
      stage_index: 3,
      stage_count: 4,
    }));
    expect(progress.steps.map((step) => [step.id, step.status, step.detail ?? ''])).toEqual([
      ['checking_container', 'succeeded', ''],
      ['checking_runtime_package', 'succeeded', ''],
      ['preparing_runtime_package', 'failed', 'go build failed'],
      ['installing_runtime_package', 'pending', ''],
    ]);
  });

  it('keeps the explicit active step after completion instead of jumping to the next pending step', () => {
    const progress = runtimeLifecycleProgress({
      location: 'local_container',
      operation: 'update',
      planState: 'executing',
      phase: 'detecting_platform',
      targetLabel: 'Dev Container',
      stepStates: [
        { id: 'checking_container', status: 'succeeded' },
        { id: 'detecting_platform', status: 'succeeded' },
        { id: 'checking_runtime_package', status: 'pending' },
      ],
    });

    expect(progress).toEqual(expect.objectContaining({
      phase: 'detecting_platform',
      active_step_id: 'detecting_platform',
      stage_index: 2,
      stage_count: 3,
    }));
  });

  it('keeps explicit container failures anchored to their failed step', () => {
    const progress = runtimeLifecycleProgress({
      location: 'ssh_container',
      operation: 'update',
      planState: 'terminal',
      phase: 'detecting_platform',
      failedPhase: 'detecting_platform',
      targetLabel: 'SSH Container',
      stepStates: [
        { id: 'checking_host', status: 'succeeded' },
        { id: 'checking_container', status: 'succeeded' },
        { id: 'detecting_platform', status: 'failed', detail: 'platform probe failed' },
        { id: 'checking_runtime_package', status: 'pending' },
      ],
    });

    expect(progress).toEqual(expect.objectContaining({
      phase: 'detecting_platform',
      active_step_id: 'detecting_platform',
      failed_step_id: 'detecting_platform',
      stage_index: 3,
      stage_count: 4,
    }));
    expect(progress.steps.map((step) => [step.id, step.status, step.detail ?? ''])).toEqual([
      ['checking_host', 'succeeded', ''],
      ['checking_container', 'succeeded', ''],
      ['detecting_platform', 'failed', 'platform probe failed'],
      ['checking_runtime_package', 'pending', ''],
    ]);
  });

  it('supports explicit terminal steps for update-current and already-stopped outcomes', () => {
    const upToDate = runtimeLifecycleProgress({
      location: 'ssh_host',
      operation: 'update',
      planState: 'terminal',
      phase: 'runtime_up_to_date',
      targetLabel: 'Devbox',
      stepStates: [
        { id: 'checking_host', status: 'succeeded' },
        { id: 'checking_runtime_package', status: 'succeeded' },
        { id: 'checking_runtime_service', status: 'succeeded' },
        { id: 'runtime_up_to_date', status: 'succeeded' },
      ],
    });
    const stopped = runtimeLifecycleProgress({
      location: 'local_host',
      operation: 'stop',
      planState: 'terminal',
      phase: 'runtime_already_stopped',
      targetLabel: 'Local',
      stepStates: [
        { id: 'checking_existing_runtime', status: 'succeeded' },
        { id: 'runtime_already_stopped', status: 'succeeded' },
      ],
    });

    expect(upToDate.steps.at(-1)).toEqual(expect.objectContaining({
      id: 'runtime_up_to_date',
      label: 'Runtime up to date',
      status: 'succeeded',
    }));
    expect(stopped.steps.at(-1)).toEqual(expect.objectContaining({
      id: 'runtime_already_stopped',
      label: 'Runtime already stopped',
      status: 'succeeded',
    }));
  });
});
