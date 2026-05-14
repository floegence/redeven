import { describe, expect, it } from 'vitest';

import { buildRuntimePlacementBridgePlan } from './runtimePlacementBridge';

describe('runtimePlacementBridge', () => {
  it('keeps host process bridges on the host executor path', () => {
    expect(buildRuntimePlacementBridgePlan({
      host_access: { kind: 'local_host' },
      placement: { kind: 'host_process', install_dir: '' },
      runtime_binary_path: '/Applications/Redeven.app/redeven',
    })).toEqual({
      host_access: { kind: 'local_host' },
      placement: { kind: 'host_process', install_dir: '' },
      bridge_kind: 'host_process',
      command: ['/Applications/Redeven.app/redeven'],
      requires_published_port: false,
      exposes_loopback_only: true,
    });
  });

  it('uses container exec stream bridges without requiring published ports', () => {
    expect(buildRuntimePlacementBridgePlan({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'container-stable-id',
        container_label: 'dev-container',
        container_owner: 'external',
        runtime_root: '/workspace/.redeven',
        bridge_strategy: 'exec_stream',
      },
    })).toMatchObject({
      bridge_kind: 'container_exec_stream',
      command: ['docker', 'exec', '-i', 'container-stable-id', 'redeven', 'desktop-bridge'],
      requires_published_port: false,
      exposes_loopback_only: true,
    });
  });
});
