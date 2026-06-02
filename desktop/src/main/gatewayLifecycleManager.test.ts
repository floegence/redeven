import { beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycleMocks = vi.hoisted(() => ({
  ensureManagedSSHRuntimeReady: vi.fn(),
  probeManagedSSHRuntimeStatus: vi.fn(),
  stopManagedSSHRuntimeProcess: vi.fn(),
  ensureRuntimePlacementReady: vi.fn(),
  startRuntimePlacementBridgeSession: vi.fn(),
}));

vi.mock('./sshRuntime', async () => {
  const actual = await vi.importActual<typeof import('./sshRuntime')>('./sshRuntime');
  return {
    ...actual,
    ensureManagedSSHRuntimeReady: lifecycleMocks.ensureManagedSSHRuntimeReady,
    probeManagedSSHRuntimeStatus: lifecycleMocks.probeManagedSSHRuntimeStatus,
    stopManagedSSHRuntimeProcess: lifecycleMocks.stopManagedSSHRuntimeProcess,
  };
});

vi.mock('./runtimePlacementManager', async () => {
  const actual = await vi.importActual<typeof import('./runtimePlacementManager')>('./runtimePlacementManager');
  return {
    ...actual,
    ensureRuntimePlacementReady: lifecycleMocks.ensureRuntimePlacementReady,
  };
});

vi.mock('./runtimePlacementBridgeSession', async () => {
  const actual = await vi.importActual<typeof import('./runtimePlacementBridgeSession')>('./runtimePlacementBridgeSession');
  return {
    ...actual,
    startRuntimePlacementBridgeSession: lifecycleMocks.startRuntimePlacementBridgeSession,
  };
});

import {
  GatewayLifecycleManager,
  GatewayRuntimeStartRequiredError,
  GatewayRuntimeUnavailableError,
} from './gatewayLifecycleManager';
import type { GatewayRecord } from './gatewayStore';
import type { GatewaySecretStore } from './gatewayTrust';
import { DEFAULT_DESKTOP_SSH_RUNTIME_ROOT } from '../shared/desktopSSH';
import { desktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';

function memorySecretStore(seed: readonly (readonly [string, string])[] = []): GatewaySecretStore {
  const values = new Map<string, string>(seed);
  return {
    writeSecret: (key, value) => {
      values.set(key, value);
    },
    readSecret: (key) => values.get(key) ?? '',
    deleteSecret: (key) => {
      values.delete(key);
    },
  };
}

function fakeBridgeSession() {
  return {
    placement_target_id: 'gateway-target',
    host_access: { kind: 'ssh_host', ssh: { ssh_destination: 'bastion', ssh_port: null, auth_mode: 'key_agent', connect_timeout_seconds: 15, runtime_root: '/opt/redeven', bootstrap_strategy: 'auto', release_base_url: '' } },
    placement: { kind: 'host_process', runtime_root: '/opt/redeven' },
    hello: {
      protocol_version: 'redeven-desktop-bridge-v1',
      runtime_version: 'v0.0.0-test',
      local_ui: { available: true, base_path: '/' },
      runtime_control: { available: false },
    },
    startup: {
      local_ui_url: 'http://127.0.0.1:24000/',
      local_ui_urls: ['http://127.0.0.1:24000/'],
    },
    local_ui_url: 'http://127.0.0.1:24000/',
    runtime_handle: { disconnect: vi.fn(), stop: vi.fn() },
    openStream: vi.fn(),
    disconnect: vi.fn(),
    stop: vi.fn(),
  };
}

function manager(progress: string[] = [], secretStore = memorySecretStore()): GatewayLifecycleManager {
  return new GatewayLifecycleManager({
    secret_store: secretStore,
    runtime_release_tag: 'v1.2.3',
    release_base_url: 'https://releases.example.invalid',
    asset_cache_root: '/tmp/redeven-assets',
    temp_root: '/tmp/redeven-temp',
    source_runtime_root: '/Applications/Redeven.app/Contents/Resources',
    desktop_owner_id: vi.fn(async () => 'desktop-owner'),
    on_progress: (event) => {
      progress.push(event.phase);
    },
  });
}

describe('GatewayLifecycleManager', () => {
  beforeEach(() => {
    lifecycleMocks.ensureManagedSSHRuntimeReady.mockReset();
    lifecycleMocks.probeManagedSSHRuntimeStatus.mockReset();
    lifecycleMocks.stopManagedSSHRuntimeProcess.mockReset();
    lifecycleMocks.ensureRuntimePlacementReady.mockReset();
    lifecycleMocks.startRuntimePlacementBridgeSession.mockReset();
    lifecycleMocks.ensureManagedSSHRuntimeReady.mockResolvedValue({
      startup: {
        local_ui_url: 'http://127.0.0.1:24000/',
        local_ui_urls: ['http://127.0.0.1:24000/'],
      },
      runtime_handle: {},
      disconnect: vi.fn(),
      stop: vi.fn(),
    });
    lifecycleMocks.probeManagedSSHRuntimeStatus.mockResolvedValue({
      status: 'not_running',
      message: 'Gateway Runtime is not running.',
    });
    lifecycleMocks.stopManagedSSHRuntimeProcess.mockResolvedValue(undefined);
    lifecycleMocks.ensureRuntimePlacementReady.mockResolvedValue({
      runtime_binary_path: '/root/.redeven/runtime/managed/bin/redeven',
      probe: { status: 'ready' },
    });
    lifecycleMocks.startRuntimePlacementBridgeSession.mockResolvedValue(fakeBridgeSession());
  });

  it('prepares SSH host Gateways through the managed SSH runtime lifecycle before opening one bridge session', async () => {
    const progress: string[] = [];
    const record: GatewayRecord = {
      schema_version: 1,
      gateway_id: 'gw_bastion',
      display_name: 'Bastion',
      connection: {
        kind: 'ssh_host',
        ssh_destination: 'bastion.internal',
        ssh_port: 2222,
        auth_mode: 'key_agent',
        connect_timeout_seconds: 20,
        runtime_root: '/opt/redeven',
        bootstrap_strategy: 'desktop_upload',
        release_base_url: 'https://mirror.example.invalid/releases',
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };

    await manager(progress).bridgeClient(record, { startPolicy: 'start_if_needed' });

    expect(lifecycleMocks.ensureManagedSSHRuntimeReady).toHaveBeenCalledTimes(1);
    expect(lifecycleMocks.ensureManagedSSHRuntimeReady).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        ssh_destination: 'bastion.internal',
        ssh_port: 2222,
        auth_mode: 'key_agent',
        connect_timeout_seconds: 20,
        runtime_root: '/opt/redeven',
        bootstrap_strategy: 'desktop_upload',
        release_base_url: 'https://mirror.example.invalid/releases',
      }),
      runtimeStateRoot: '/opt/redeven/gateways/gw_bastion',
      runtimeReleaseTag: 'v1.2.3',
      tempRoot: '/tmp/redeven-temp',
      assetCacheRoot: '/tmp/redeven-assets',
      sourceRuntimeRoot: '/Applications/Redeven.app/Contents/Resources',
      sshPassword: '',
      desktopOwnerID: 'desktop-owner',
    }));
    expect(lifecycleMocks.ensureRuntimePlacementReady).not.toHaveBeenCalled();
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).toHaveBeenCalledWith(expect.objectContaining({
      host_access: expect.objectContaining({ kind: 'ssh_host' }),
      placement: expect.objectContaining({
        kind: 'host_process',
        runtime_root: '/opt/redeven',
        runtime_state_root: '/opt/redeven/gateways/gw_bastion',
        bootstrap_strategy: 'desktop_upload',
      }),
      runtime_binary_path: '/opt/redeven/runtime/managed/bin/redeven',
      desktop_owner_id: 'desktop-owner',
      ssh_password: '',
      fallback_local_id: 'gw_bastion',
    }));
    expect(progress).toEqual(['checking_host', 'opening_bridge', 'gateway_ready']);
  });

  it('uses a Gateway profile state root for SSH host Gateway bridges', async () => {
    const record: GatewayRecord = {
      schema_version: 1,
      gateway_id: 'gw_home',
      display_name: 'Home Gateway',
      connection: {
        kind: 'ssh_host',
        ssh_destination: 'bastion.internal',
        auth_mode: 'key_agent',
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        bootstrap_strategy: 'auto',
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };

    await manager().bridgeClient(record, { startPolicy: 'start_if_needed' });

    expect(lifecycleMocks.ensureManagedSSHRuntimeReady).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
      }),
      runtimeStateRoot: `${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/gateways/gw_home`,
    }));
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).toHaveBeenCalledWith(expect.objectContaining({
      placement: expect.objectContaining({
        kind: 'host_process',
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        runtime_state_root: `${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/gateways/gw_home`,
      }),
      runtime_binary_path: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
    }));
  });

  it('keeps Gateway SSH host sessions isolated from regular SSH runtimes on the same install root', async () => {
    const sessionCache = new Map();
    const first: GatewayRecord = {
      schema_version: 1,
      gateway_id: 'gw_first',
      display_name: 'First Gateway',
      connection: {
        kind: 'ssh_host',
        ssh_destination: 'bastion.internal',
        auth_mode: 'key_agent',
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };
    const second: GatewayRecord = {
      ...first,
      gateway_id: 'gw_second',
      display_name: 'Second Gateway',
    };
    const lifecycle = new GatewayLifecycleManager({
      secret_store: memorySecretStore(),
      runtime_release_tag: 'v1.2.3',
      release_base_url: 'https://releases.example.invalid',
      asset_cache_root: '/tmp/redeven-assets',
      temp_root: '/tmp/redeven-temp',
      source_runtime_root: '/Applications/Redeven.app/Contents/Resources',
      desktop_owner_id: vi.fn(async () => 'desktop-owner'),
      session_cache: sessionCache,
    });

    await lifecycle.bridgeClient(first, { startPolicy: 'start_if_needed' });
    await lifecycle.bridgeClient(second, { startPolicy: 'start_if_needed' });

    const regularSSHRuntimeTarget = desktopRuntimeTargetID({
      kind: 'ssh_host',
      ssh: {
        ssh_destination: 'bastion.internal',
        ssh_port: null,
        auth_mode: 'key_agent',
        connect_timeout_seconds: 15,
      },
    }, { kind: 'host_process', runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT });
    expect([...sessionCache.keys()]).toHaveLength(2);
    expect([...sessionCache.keys()][0]).not.toBe([...sessionCache.keys()][1]);
    expect([...sessionCache.keys()]).not.toContain(regularSSHRuntimeTarget);
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).toHaveBeenNthCalledWith(1, expect.objectContaining({
      placement: expect.objectContaining({
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        runtime_state_root: `${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/gateways/gw_first`,
      }),
    }));
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
      placement: expect.objectContaining({
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        runtime_state_root: `${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/gateways/gw_second`,
      }),
    }));
  });

  it('passes stored SSH passwords through Gateway host runtime and bridge setup', async () => {
    const record: GatewayRecord = {
      schema_version: 1,
      gateway_id: 'gw_password',
      display_name: 'Password Gateway',
      connection: {
        kind: 'ssh_host',
        ssh_destination: 'bastion.internal',
        auth_mode: 'password',
        ssh_password_configured: true,
        ssh_password_ref: 'gateway-ssh-password:gw_password',
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };

    await manager([], memorySecretStore([
      ['gateway-ssh-password:gw_password', 'secret-password'],
    ])).bridgeClient(record, { startPolicy: 'start_if_needed' });

    expect(lifecycleMocks.ensureManagedSSHRuntimeReady).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        auth_mode: 'password',
      }),
      sshPassword: 'secret-password',
    }));
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).toHaveBeenCalledWith(expect.objectContaining({
      ssh_password: 'secret-password',
    }));
  });

  it('requires explicit start policy only when an SSH Gateway is startable but not running', async () => {
    const record: GatewayRecord = {
      schema_version: 1,
      gateway_id: 'gw_bastion',
      display_name: 'Bastion',
      connection: {
        kind: 'ssh_host',
        ssh_destination: 'bastion.internal',
        auth_mode: 'key_agent',
        runtime_root: '/opt/redeven',
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };

    await expect(manager().ensureGatewayReady(record, { startPolicy: 'require_ready' }))
      .rejects.toBeInstanceOf(GatewayRuntimeStartRequiredError);

    expect(lifecycleMocks.probeManagedSSHRuntimeStatus).toHaveBeenCalledWith(expect.objectContaining({
      runtimeStateRoot: '/opt/redeven/gateways/gw_bastion',
    }));
    expect(lifecycleMocks.ensureManagedSSHRuntimeReady).not.toHaveBeenCalled();
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).not.toHaveBeenCalled();
  });

  it('reports unreachable SSH Gateways as unavailable instead of asking to start them', async () => {
    lifecycleMocks.probeManagedSSHRuntimeStatus.mockResolvedValue({
      status: 'failed',
      message: 'SSH connection to "bastion.internal" failed.',
    });
    const record: GatewayRecord = {
      schema_version: 1,
      gateway_id: 'gw_bastion',
      display_name: 'Bastion',
      connection: {
        kind: 'ssh_host',
        ssh_destination: 'bastion.internal',
        auth_mode: 'key_agent',
        runtime_root: '/opt/redeven',
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };

    await expect(manager().ensureGatewayReady(record, { startPolicy: 'require_ready' })).rejects.toMatchObject({
      code: 'gateway_runtime_unreachable',
      message: 'SSH connection to "bastion.internal" failed.',
    } satisfies Partial<GatewayRuntimeUnavailableError>);

    expect(lifecycleMocks.ensureManagedSSHRuntimeReady).not.toHaveBeenCalled();
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).not.toHaveBeenCalled();
  });

  it('prepares SSH container Gateways through runtime placement and exec-stream bridge only', async () => {
    const progress: string[] = [];
    lifecycleMocks.ensureRuntimePlacementReady.mockImplementation(async (args) => {
      args.on_progress?.({ phase: 'preparing_runtime_package', title: 'Preparing', detail: 'Preparing package' });
      args.on_progress?.({ phase: 'installing_runtime', title: 'Installing', detail: 'Installing runtime' });
      args.on_progress?.({ phase: 'starting_runtime_daemon', title: 'Starting', detail: 'Starting runtime' });
      return {
        runtime_binary_path: '/root/.redeven/runtime/managed/bin/redeven',
        probe: { status: 'ready' },
      };
    });
    const record: GatewayRecord = {
      schema_version: 1,
      gateway_id: 'gw_container',
      display_name: 'Container Gateway',
      connection: {
        kind: 'ssh_container',
        ssh_destination: 'bastion.internal',
        ssh_port: 2222,
        auth_mode: 'key_agent',
        container_engine: 'docker',
        container_id: 'container-stable-id',
        container_ref: 'dev-container',
        container_label: 'dev-container',
        runtime_root: '/root/.redeven',
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };

    await manager(progress).bridgeClient(record, { startPolicy: 'start_if_needed' });

    expect(lifecycleMocks.ensureManagedSSHRuntimeReady).not.toHaveBeenCalled();
    expect(lifecycleMocks.ensureRuntimePlacementReady).toHaveBeenCalledWith(expect.objectContaining({
      host_access: expect.objectContaining({
        kind: 'ssh_host',
        ssh: expect.objectContaining({
          ssh_destination: 'bastion.internal',
          ssh_port: 2222,
          auth_mode: 'key_agent',
          runtime_root: '/root/.redeven',
        }),
      }),
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'container-stable-id',
        container_ref: 'dev-container',
        container_label: 'dev-container',
        runtime_root: '/root/.redeven',
        runtime_state_root: '/root/.redeven/gateways/gw_container',
        bridge_strategy: 'exec_stream',
      },
      ssh_password: '',
      runtime_release_tag: 'v1.2.3',
      release_base_url: 'https://releases.example.invalid',
      source_runtime_root: '/Applications/Redeven.app/Contents/Resources',
      asset_cache_root: '/tmp/redeven-assets',
      timeout_ms: 45_000,
      desktop_owner_id: 'desktop-owner',
    }));
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).toHaveBeenCalledWith(expect.objectContaining({
      host_access: expect.objectContaining({ kind: 'ssh_host' }),
      placement: expect.objectContaining({
        kind: 'container_process',
        container_id: 'container-stable-id',
        bridge_strategy: 'exec_stream',
        runtime_root: '/root/.redeven',
        runtime_state_root: '/root/.redeven/gateways/gw_container',
      }),
      runtime_binary_path: '/root/.redeven/runtime/managed/bin/redeven',
      desktop_owner_id: 'desktop-owner',
      ssh_password: '',
      fallback_local_id: 'gw_container',
    }));
    expect(progress).toEqual([
      'checking_container',
      'preparing_runtime_package',
      'installing_runtime',
      'starting_runtime',
      'opening_bridge',
      'gateway_ready',
    ]);
  });

  it('does not open a Gateway bridge when SSH host runtime preparation fails', async () => {
    lifecycleMocks.ensureManagedSSHRuntimeReady.mockRejectedValue(new Error('host unavailable'));
    const record: GatewayRecord = {
      schema_version: 1,
      gateway_id: 'gw_bastion',
      display_name: 'Bastion',
      connection: {
        kind: 'ssh_host',
        ssh_destination: 'bastion.internal',
        auth_mode: 'key_agent',
        runtime_root: '/opt/redeven',
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };

    await expect(manager().bridgeClient(record, { startPolicy: 'start_if_needed' })).rejects.toMatchObject({
      code: 'gateway_runtime_start_failed',
      message: 'host unavailable',
    } satisfies Partial<GatewayRuntimeUnavailableError>);

    expect(lifecycleMocks.startRuntimePlacementBridgeSession).not.toHaveBeenCalled();
  });

  it('does not open a Gateway bridge when container runtime placement fails', async () => {
    lifecycleMocks.ensureRuntimePlacementReady.mockRejectedValue(new Error('container unavailable'));
    const record: GatewayRecord = {
      schema_version: 1,
      gateway_id: 'gw_container',
      display_name: 'Container Gateway',
      connection: {
        kind: 'ssh_container',
        ssh_destination: 'bastion.internal',
        auth_mode: 'key_agent',
        container_engine: 'docker',
        container_id: 'container-stable-id',
        runtime_root: '/root/.redeven',
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };

    await expect(manager().bridgeClient(record, { startPolicy: 'start_if_needed' })).rejects.toMatchObject({
      code: 'gateway_container_unavailable',
      message: 'container unavailable',
    } satisfies Partial<GatewayRuntimeUnavailableError>);

    expect(lifecycleMocks.startRuntimePlacementBridgeSession).not.toHaveBeenCalled();
  });

  it('reports bridge attach failures with structured Gateway bridge errors', async () => {
    lifecycleMocks.startRuntimePlacementBridgeSession.mockRejectedValue(new Error('bridge refused'));
    const record: GatewayRecord = {
      schema_version: 1,
      gateway_id: 'gw_bastion',
      display_name: 'Bastion',
      connection: {
        kind: 'ssh_host',
        ssh_destination: 'bastion.internal',
        auth_mode: 'key_agent',
        runtime_root: '/opt/redeven',
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };

    await expect(manager().bridgeClient(record, { startPolicy: 'start_if_needed' })).rejects.toMatchObject({
      code: 'gateway_bridge_unavailable',
      message: 'bridge refused',
    } satisfies Partial<GatewayRuntimeUnavailableError>);
  });
});
