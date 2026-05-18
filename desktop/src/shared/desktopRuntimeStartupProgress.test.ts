import { describe, expect, it } from 'vitest';

import {
  desktopRuntimeStartupLocation,
  runtimeStartupPhaseSequence,
  runtimeStartupProgress,
} from './desktopRuntimeStartupProgress';

describe('desktopRuntimeStartupProgress', () => {
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

    expect(desktopRuntimeStartupLocation(localHost, hostPlacement)).toBe('local_host');
    expect(desktopRuntimeStartupLocation(localHost, containerPlacement)).toBe('local_container');
    expect(desktopRuntimeStartupLocation(sshHost, hostPlacement)).toBe('ssh_host');
    expect(desktopRuntimeStartupLocation(sshHost, containerPlacement)).toBe('ssh_container');
  });

  it('keeps ordered phase metadata for all runtime startup locations', () => {
    expect(runtimeStartupPhaseSequence('local_host')).toEqual([
      'checking_existing_runtime',
      'starting_runtime',
      'waiting_for_readiness',
      'runtime_ready',
    ]);
    expect(runtimeStartupPhaseSequence('local_container')).toEqual([
      'checking_container',
      'detecting_platform',
      'checking_runtime',
      'preparing_runtime_package',
      'installing_runtime',
      'starting_bridge',
      'waiting_for_readiness',
      'runtime_ready',
    ]);
    expect(runtimeStartupPhaseSequence('ssh_host')).toEqual([
      'checking_host',
      'checking_runtime',
      'detecting_platform',
      'preparing_runtime_package',
      'installing_runtime',
      'starting_runtime',
      'waiting_for_readiness',
      'runtime_ready',
    ]);
    expect(runtimeStartupPhaseSequence('ssh_container')).toEqual([
      'checking_host',
      'checking_container',
      'detecting_platform',
      'checking_runtime',
      'preparing_runtime_package',
      'installing_runtime',
      'starting_bridge',
      'waiting_for_readiness',
      'runtime_ready',
    ]);
  });

  it('builds bounded stage metadata without faking percentage precision', () => {
    expect(runtimeStartupProgress({
      location: 'ssh_container',
      phase: 'installing_runtime',
      targetLabel: ' Devbox Container ',
      targetDetail: ' devbox · docker/dev ',
    })).toEqual({
      kind: 'runtime_startup',
      location: 'ssh_container',
      phase: 'installing_runtime',
      stage_index: 6,
      stage_count: 9,
      target_label: 'Devbox Container',
      target_detail: 'devbox · docker/dev',
    });
    expect(runtimeStartupProgress({
      location: 'local_host',
      phase: 'failed',
      targetLabel: '',
    })).toEqual({
      kind: 'runtime_startup',
      location: 'local_host',
      phase: 'failed',
      stage_index: 4,
      stage_count: 4,
      target_label: 'Runtime',
    });
  });
});
