import { describe, expect, it } from 'vitest';

import {
  desktopOpenConnectionLocation,
  openConnectionPhaseSequence,
  openConnectionProgress,
} from './desktopOpenConnectionProgress';

describe('desktopOpenConnectionProgress', () => {
  it('resolves Open connection locations from host access and placement', () => {
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

    expect(desktopOpenConnectionLocation(localHost, hostPlacement)).toBe('local_host');
    expect(desktopOpenConnectionLocation(localHost, containerPlacement)).toBe('local_container');
    expect(desktopOpenConnectionLocation(sshHost, hostPlacement)).toBe('ssh_host');
    expect(desktopOpenConnectionLocation(sshHost, containerPlacement)).toBe('ssh_container');
  });

  it('keeps tunnel and bridge phases out of runtime lifecycle progress', () => {
    expect(openConnectionPhaseSequence('ssh_host')).toEqual([
      'checking_runtime_record',
      'ensuring_runtime_ready',
      'opening_ssh_control',
      'opening_local_tunnel',
      'connecting_runtime_control',
      'connecting_desktop_model_source',
      'checking_env_app_readiness',
      'opening_window',
      'open_ready',
    ]);
    expect(openConnectionPhaseSequence('local_container')).toEqual([
      'checking_runtime_record',
      'ensuring_runtime_ready',
      'starting_container_bridge',
      'opening_bridge_proxy',
      'connecting_runtime_control',
      'connecting_desktop_model_source',
      'checking_env_app_readiness',
      'opening_window',
      'open_ready',
    ]);
    expect(openConnectionPhaseSequence('provider_remote')).toEqual([
      'checking_runtime_record',
      'opening_window',
      'open_ready',
    ]);
    expect(openConnectionPhaseSequence('external_local_ui')).toEqual([
      'checking_runtime_record',
      'opening_window',
      'open_ready',
    ]);
  });

  it('builds bounded stage metadata for the current Desktop Open session', () => {
    expect(openConnectionProgress({
      location: 'ssh_container',
      phase: 'starting_container_bridge',
      environmentID: ' ssh-container ',
      environmentLabel: ' SSH Container ',
      targetID: ' ssh:container:devbox:docker:dev ',
      targetLabel: ' Devbox Container ',
      targetDetail: ' devbox · docker/dev ',
    })).toEqual({
      kind: 'open_connection',
      location: 'ssh_container',
      phase: 'starting_container_bridge',
      stage_index: 4,
      stage_count: 10,
      environment_id: 'ssh-container',
      environment_label: 'SSH Container',
      target_id: 'ssh:container:devbox:docker:dev',
      target_label: 'Devbox Container',
      target_detail: 'devbox · docker/dev',
    });
  });
});
