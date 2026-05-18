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
      'attaching_existing_runtime',
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
      'runtime_ready',
    ]);
    expect(runtimeLifecyclePhaseSequence('ssh_host')).toEqual([
      'checking_host',
      'checking_runtime_package',
      'detecting_platform',
      'preparing_runtime_package',
      'installing_runtime_package',
      'starting_runtime_process',
      'attaching_existing_runtime',
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
      'runtime_ready',
    ]);
  });

  it('builds bounded stage metadata without faking percentage precision', () => {
    expect(runtimeLifecycleProgress({
      location: 'ssh_container',
      phase: 'installing_runtime_package',
      targetID: 'ssh:container:devbox:docker:dev',
      targetLabel: ' Devbox Container ',
      targetDetail: ' devbox · docker/dev ',
    })).toEqual({
      kind: 'runtime_lifecycle',
      location: 'ssh_container',
      phase: 'installing_runtime_package',
      stage_index: 6,
      stage_count: 7,
      target_id: 'ssh:container:devbox:docker:dev',
      target_label: 'Devbox Container',
      target_detail: 'devbox · docker/dev',
    });
    expect(runtimeLifecycleProgress({
      location: 'local_host',
      phase: 'failed',
      targetLabel: '',
    })).toEqual({
      kind: 'runtime_lifecycle',
      location: 'local_host',
      phase: 'failed',
      stage_index: 5,
      stage_count: 5,
      target_id: 'runtime',
      target_label: 'Runtime',
    });
  });
});
