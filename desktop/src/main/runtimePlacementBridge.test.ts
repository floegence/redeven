import { describe, expect, it } from 'vitest';

import { buildRuntimePlacementBridgePlan } from './runtimePlacementBridge';

describe('runtimePlacementBridge', () => {
  it('keeps host process bridges on the host executor path', () => {
    expect(buildRuntimePlacementBridgePlan({
      host_access: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '' },
      runtime_binary_path: '/Applications/Redeven.app/redeven',
    })).toEqual({
      host_access: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '' },
      bridge_kind: 'host_process',
      command: ['/Applications/Redeven.app/redeven', 'desktop-bridge'],
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
        container_ref: 'dev-container',
        container_label: 'dev-container',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      runtime_binary_path: '/root/.redeven/runtime/managed/bin/redeven',
    })).toMatchObject({
      bridge_kind: 'container_exec_stream',
      command: ['docker', 'exec', '-i', '--env', 'REDEVEN_DESKTOP_OWNER_ID', 'container-stable-id', '/root/.redeven/runtime/managed/bin/redeven', 'desktop-bridge', '--state-root', '/root/.redeven'],
      requires_published_port: false,
      exposes_loopback_only: true,
    });
  });
});
