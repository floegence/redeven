import { describe, expect, it } from 'vitest';

import { buildRuntimePlacementBridgePlan } from './runtimePlacementBridge';
import { DEFAULT_DESKTOP_SSH_RUNTIME_ROOT } from '../shared/desktopSSH';

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

  it('resolves host process bridge state roots before attaching', () => {
    const plan = buildRuntimePlacementBridgePlan({
      host_access: {
        kind: 'ssh_host',
        ssh: {
          ssh_destination: 'bastion',
          ssh_port: null,
          auth_mode: 'key_agent',
          connect_timeout_seconds: 10,
        },
      },
      placement: {
        kind: 'host_process',
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
      },
      runtime_binary_path: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
    });
    expect(plan).toMatchObject({
      bridge_kind: 'host_process',
      command: [
        'sh',
        '-c',
        expect.stringContaining(`if [ "$install_root" = "${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}" ]; then`),
        'redeven-host-desktop-bridge',
        DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
      ],
    });
    const command = plan.command[2];
    expect(command).toContain('runtime_binary_path="${install_root%/}/runtime/managed/bin/redeven"');
    expect(command).toContain('exec "$runtime_binary_path" desktop-bridge --state-root "$state_root"');
  });

  it('keeps Gateway host bridge install and state roots separate', () => {
    const plan = buildRuntimePlacementBridgePlan({
      host_access: {
        kind: 'ssh_host',
        ssh: {
          ssh_destination: 'bastion',
          ssh_port: null,
          auth_mode: 'key_agent',
          connect_timeout_seconds: 10,
        },
      },
      placement: {
        kind: 'host_process',
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        runtime_state_root: `${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/gateways/gw_demo`,
      },
      runtime_binary_path: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
    });

    expect(plan.command).toEqual([
      'sh',
      '-c',
      expect.stringContaining('runtime_binary_path="${install_root%/}/runtime/managed/bin/redeven"'),
      'redeven-host-desktop-bridge',
      DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
      DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
      `${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/gateways/gw_demo`,
    ]);
    expect(plan.command[2]).toContain('exec "$runtime_binary_path" desktop-bridge --state-root "$state_root"');
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
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        bridge_strategy: 'exec_stream',
      },
      runtime_binary_path: '/home/app/.redeven/runtime/managed/bin/redeven',
    })).toMatchObject({
      bridge_kind: 'container_exec_stream',
      command: [
        'docker',
        'exec',
        '-i',
        '--env',
        'REDEVEN_DESKTOP_OWNER_ID',
        'container-stable-id',
        'sh',
        '-c',
        expect.stringContaining(`if [ "$runtime_root" = "${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}" ]; then`),
        'redeven-container-desktop-bridge',
        DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        '/home/app/.redeven/runtime/managed/bin/redeven',
        DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
      ],
      requires_published_port: false,
      exposes_loopback_only: true,
    });
  });

  it('keeps Gateway container bridge install and state roots separate', () => {
    expect(buildRuntimePlacementBridgePlan({
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'container-stable-id',
        container_ref: 'dev-container',
        container_label: 'dev-container',
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        runtime_state_root: `${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/gateways/gw_demo`,
        bridge_strategy: 'exec_stream',
      },
      runtime_binary_path: '/home/app/.redeven/runtime/managed/bin/redeven',
    })).toMatchObject({
      bridge_kind: 'container_exec_stream',
      command: [
        'docker',
        'exec',
        '-i',
        '--env',
        'REDEVEN_DESKTOP_OWNER_ID',
        'container-stable-id',
        'sh',
        '-c',
        expect.stringContaining('exec "$runtime_binary_path" desktop-bridge --state-root "$state_root"'),
        'redeven-container-desktop-bridge',
        DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        '/home/app/.redeven/runtime/managed/bin/redeven',
        `${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/gateways/gw_demo`,
      ],
      requires_published_port: false,
      exposes_loopback_only: true,
    });
  });
});
