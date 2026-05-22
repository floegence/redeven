import { describe, expect, it } from 'vitest';

import {
  desktopRuntimeLifecycleLocation,
  runtimeLifecyclePhaseSequence,
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

  it('keeps ordered phase metadata for all runtime startup locations', () => {
    expect(runtimeLifecyclePhaseSequence('local_host')).toEqual([
      'checking_existing_runtime',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ]);
    expect(runtimeLifecyclePhaseSequence('local_container')).toEqual([
      'checking_container',
      'detecting_platform',
      'checking_runtime_package',
      'preparing_runtime_package',
      'installing_runtime_package',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ]);
    expect(runtimeLifecyclePhaseSequence('ssh_host')).toEqual([
      'checking_host',
      'checking_runtime_package',
      'detecting_platform',
      'preparing_runtime_package',
      'installing_runtime_package',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ]);
    expect(runtimeLifecyclePhaseSequence('ssh_container')).toEqual([
      'checking_host',
      'checking_container',
      'detecting_platform',
      'checking_runtime_package',
      'preparing_runtime_package',
      'installing_runtime_package',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ]);
  });

  it('keeps stop verification in uninterrupted restart/update workflows', () => {
    expect(runtimeLifecyclePhaseSequence('ssh_host', 'restart')).toEqual([
      'checking_host',
      'checking_runtime_package',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'detecting_platform',
      'preparing_runtime_package',
      'installing_runtime_package',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ]);
    expect(runtimeLifecyclePhaseSequence('local_container', 'restart')).toEqual([
      'checking_container',
      'checking_runtime_package',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'detecting_platform',
      'preparing_runtime_package',
      'installing_runtime_package',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ]);
    expect(runtimeLifecyclePhaseSequence('local_container', 'update')).toEqual([
      'checking_container',
      'checking_runtime_package',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'detecting_platform',
      'preparing_runtime_package',
      'installing_runtime_package',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ]);
    expect(runtimeLifecyclePhaseSequence('ssh_host', 'update')).toEqual([
      'checking_host',
      'checking_runtime_package',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'detecting_platform',
      'preparing_runtime_package',
      'installing_runtime_package',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ]);
    expect(runtimeLifecyclePhaseSequence('local_host', 'update')).toEqual([
      'checking_existing_runtime',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'starting_runtime_process',
      'checking_runtime_service',
      'runtime_ready',
    ]);
    expect(runtimeLifecycleProgress({
      location: 'local_container',
      operation: 'update',
      phase: 'verifying_runtime_stopped',
      targetLabel: 'Container',
    }).stage_index).toBeLessThan(runtimeLifecycleProgress({
      location: 'local_container',
      operation: 'update',
      phase: 'detecting_platform',
      targetLabel: 'Container',
    }).stage_index);
    expect(runtimeLifecyclePhaseSequence('ssh_host', 'stop')).toEqual([
      'checking_host',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'runtime_stopped',
    ]);
    expect(runtimeLifecyclePhaseSequence('local_host', 'stop')).toEqual([
      'checking_existing_runtime',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'runtime_stopped',
    ]);
    expect(runtimeLifecyclePhaseSequence('local_container', 'stop')).toEqual([
      'checking_container',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'runtime_stopped',
    ]);
    expect(runtimeLifecyclePhaseSequence('ssh_container', 'stop')).toEqual([
      'checking_host',
      'checking_container',
      'stopping_runtime_process',
      'verifying_runtime_stopped',
      'runtime_stopped',
    ]);
  });

  it('builds bounded stage metadata without faking percentage precision', () => {
    expect(runtimeLifecycleProgress({
      location: 'ssh_container',
      phase: 'installing_runtime_package',
      targetID: 'ssh:container:devbox:docker:dev',
      targetLabel: ' Devbox Container ',
      targetDetail: ' devbox · docker/dev ',
    })).toEqual(expect.objectContaining({
      kind: 'runtime_lifecycle',
      location: 'ssh_container',
      operation: 'start',
      phase: 'installing_runtime_package',
      active_step_id: 'installing_runtime_package',
      stage_index: 6,
      stage_count: 9,
      target_id: 'ssh:container:devbox:docker:dev',
      target_label: 'Devbox Container',
      target_detail: 'devbox · docker/dev',
      steps: expect.arrayContaining([
        expect.objectContaining({
          id: 'installing_runtime_package',
          status: 'running',
        }),
      ]),
    }));
  });

  it('keeps the failed step anchored to the real workflow step', () => {
    const progress = runtimeLifecycleProgress({
      location: 'local_container',
      operation: 'update',
      phase: 'preparing_runtime_package',
      failedPhase: 'preparing_runtime_package',
      targetLabel: 'Dev Container',
    });

    expect(progress).toEqual(expect.objectContaining({
      operation: 'update',
      phase: 'preparing_runtime_package',
      active_step_id: 'preparing_runtime_package',
      failed_step_id: 'preparing_runtime_package',
      stage_index: 6,
      stage_count: 10,
    }));
    expect(progress.steps.map((step) => [step.id, step.status])).toEqual([
      ['checking_container', 'succeeded'],
      ['checking_runtime_package', 'succeeded'],
      ['stopping_runtime_process', 'succeeded'],
      ['verifying_runtime_stopped', 'succeeded'],
      ['detecting_platform', 'succeeded'],
      ['preparing_runtime_package', 'failed'],
      ['installing_runtime_package', 'pending'],
      ['starting_runtime_process', 'pending'],
      ['checking_runtime_service', 'pending'],
      ['runtime_ready', 'pending'],
    ]);
  });
});
