import { beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycleMocks = vi.hoisted(() => ({
  ensureManagedGatewayServiceReady: vi.fn(),
  probeManagedGatewayServiceStatus: vi.fn(),
  stopManagedGatewayService: vi.fn(),
  startRuntimePlacementBridgeSession: vi.fn(),
}));

vi.mock('./gatewayServiceHost', async () => {
  const actual = await vi.importActual<typeof import('./gatewayServiceHost')>('./gatewayServiceHost');
  return {
    ...actual,
    ensureManagedGatewayServiceReady: lifecycleMocks.ensureManagedGatewayServiceReady,
    probeManagedGatewayServiceStatus: lifecycleMocks.probeManagedGatewayServiceStatus,
    stopManagedGatewayService: lifecycleMocks.stopManagedGatewayService,
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
  GatewayNotManageableError,
  GatewayServiceStartRequiredError,
  GatewayServiceUnavailableError,
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
    host_access: {
      kind: 'ssh_host',
      ssh: {
        ssh_destination: 'bastion',
        ssh_port: null,
        auth_mode: 'key_agent',
        connect_timeout_seconds: 15,
        runtime_root: '/opt/redeven',
        bootstrap_strategy: 'auto',
        release_base_url: '',
      },
    },
    placement: { kind: 'host_process', runtime_root: '/opt/redeven' },
    hello: {
      protocol_version: 'redeven-desktop-bridge-v1',
      runtime_version: 'v0.0.0-test',
      local_ui: { available: false, base_path: '/' },
      runtime_control: { available: false },
    },
    startup: {
      local_ui_url: '',
      local_ui_urls: [],
    },
    local_ui_url: '',
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

function sshGateway(overrides: Partial<GatewayRecord> = {}): GatewayRecord {
  return {
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
    ...overrides,
  };
}

function containerGateway(): GatewayRecord {
  return {
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
}

describe('GatewayLifecycleManager', () => {
  beforeEach(() => {
    lifecycleMocks.ensureManagedGatewayServiceReady.mockReset();
    lifecycleMocks.probeManagedGatewayServiceStatus.mockReset();
    lifecycleMocks.stopManagedGatewayService.mockReset();
    lifecycleMocks.startRuntimePlacementBridgeSession.mockReset();
    lifecycleMocks.ensureManagedGatewayServiceReady.mockResolvedValue('/opt/redeven/gateway/managed/bin/redeven-gateway');
    lifecycleMocks.probeManagedGatewayServiceStatus.mockResolvedValue({
      status: 'not_running',
      message: 'Gateway service is not running.',
      binary_path: '/opt/redeven/gateway/managed/bin/redeven-gateway',
      state_root: '/opt/redeven/gateways/gw_bastion/state',
    });
    lifecycleMocks.stopManagedGatewayService.mockResolvedValue(undefined);
    lifecycleMocks.startRuntimePlacementBridgeSession.mockResolvedValue(fakeBridgeSession());
  });

  it('starts SSH host Gateways through the managed Gateway service before opening one bridge session', async () => {
    const progress: string[] = [];
    const record = sshGateway();

    await manager(progress).bridgeClient(record, { startPolicy: 'start_if_needed' });

    expect(lifecycleMocks.ensureManagedGatewayServiceReady).toHaveBeenCalledTimes(1);
    expect(lifecycleMocks.ensureManagedGatewayServiceReady).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        ssh_destination: 'bastion.internal',
        ssh_port: 2222,
        auth_mode: 'key_agent',
        connect_timeout_seconds: 20,
        runtime_root: '/opt/redeven',
        bootstrap_strategy: 'desktop_upload',
        release_base_url: 'https://mirror.example.invalid/releases',
      }),
      placement: expect.objectContaining({
        kind: 'host_process',
        runtime_root: '/opt/redeven',
        runtime_state_root: '/opt/redeven/gateways/gw_bastion/state',
        bootstrap_strategy: 'desktop_upload',
      }),
      stateRoot: '/opt/redeven/gateways/gw_bastion/state',
      releaseTag: 'v1.2.3',
      tempRoot: '/tmp/redeven-temp',
      assetCacheRoot: '/tmp/redeven-assets',
      sourceRuntimeRoot: '/Applications/Redeven.app/Contents/Resources',
      sshPassword: '',
    }));
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).toHaveBeenCalledWith(expect.objectContaining({
      host_access: expect.objectContaining({ kind: 'ssh_host' }),
      placement: expect.objectContaining({
        kind: 'host_process',
        runtime_root: '/opt/redeven',
        runtime_state_root: '/opt/redeven/gateways/gw_bastion/state',
        bootstrap_strategy: 'desktop_upload',
      }),
      runtime_binary_path: '/opt/redeven/gateway/managed/bin/redeven-gateway',
      bridge_command_kind: 'gateway',
      require_local_ui: false,
      desktop_owner_id: 'desktop-owner',
      ssh_password: '',
      fallback_local_id: 'gw_bastion',
    }));
    expect(progress).toEqual(['opening_bridge', 'gateway_ready']);
  });

  it('uses the Gateway profile state root for SSH host Gateway bridges', async () => {
    const record = sshGateway({
      gateway_id: 'gw_home',
      display_name: 'Home Gateway',
      connection: {
        kind: 'ssh_host',
        ssh_destination: 'bastion.internal',
        auth_mode: 'key_agent',
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        bootstrap_strategy: 'auto',
      },
    });

    await manager().bridgeClient(record, { startPolicy: 'start_if_needed' });

    expect(lifecycleMocks.ensureManagedGatewayServiceReady).toHaveBeenCalledWith(expect.objectContaining({
      placement: expect.objectContaining({
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        runtime_state_root: `${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/gateways/gw_home/state`,
      }),
      stateRoot: `${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/gateways/gw_home/state`,
    }));
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).toHaveBeenCalledWith(expect.objectContaining({
      placement: expect.objectContaining({
        kind: 'host_process',
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        runtime_state_root: `${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/gateways/gw_home/state`,
      }),
      runtime_binary_path: '/opt/redeven/gateway/managed/bin/redeven-gateway',
      bridge_command_kind: 'gateway',
    }));
  });

  it('keeps Gateway SSH host sessions isolated from regular SSH runtimes on the same install root', async () => {
    const sessionCache = new Map();
    const first = sshGateway({
      gateway_id: 'gw_first',
      display_name: 'First Gateway',
      connection: {
        kind: 'ssh_host',
        ssh_destination: 'bastion.internal',
        auth_mode: 'key_agent',
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
      },
    });
    const second = {
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
        runtime_state_root: `${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/gateways/gw_first/state`,
      }),
    }));
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
      placement: expect.objectContaining({
        runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
        runtime_state_root: `${DEFAULT_DESKTOP_SSH_RUNTIME_ROOT}/gateways/gw_second/state`,
      }),
    }));
  });

  it('passes stored SSH passwords through Gateway service setup and bridge attach', async () => {
    const record = sshGateway({
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
    });

    await manager([], memorySecretStore([
      ['gateway-ssh-password:gw_password', 'secret-password'],
    ])).bridgeClient(record, { startPolicy: 'start_if_needed' });

    expect(lifecycleMocks.ensureManagedGatewayServiceReady).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        auth_mode: 'password',
      }),
      sshPassword: 'secret-password',
    }));
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).toHaveBeenCalledWith(expect.objectContaining({
      ssh_password: 'secret-password',
    }));
  });

  it('coalesces concurrent managed Gateway starts for the same target', async () => {
    let releaseGateway: () => void = () => undefined;
    lifecycleMocks.ensureManagedGatewayServiceReady.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        releaseGateway = resolve;
      });
      return '/opt/redeven/gateway/managed/bin/redeven-gateway';
    });
    const record = sshGateway({
      gateway_id: 'gw_parallel',
      display_name: 'Parallel Gateway',
      connection: {
        kind: 'ssh_host',
        ssh_destination: 'bastion.internal',
        auth_mode: 'key_agent',
        runtime_root: '/opt/redeven',
      },
    });
    const lifecycle = manager();

    const first = lifecycle.startGateway(record);
    const second = lifecycle.ensureGatewayReady(record, { startPolicy: 'start_if_needed' });
    await vi.waitFor(() => {
      expect(lifecycleMocks.ensureManagedGatewayServiceReady).toHaveBeenCalledTimes(1);
    });
    releaseGateway();
    const [firstSession, secondSession] = await Promise.all([first, second]);

    expect(firstSession).toBe(secondSession);
    expect(lifecycleMocks.ensureManagedGatewayServiceReady).toHaveBeenCalledTimes(1);
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).toHaveBeenCalledTimes(1);
  });

  it('requires explicit start policy only when an SSH Gateway service is installed but stopped', async () => {
    const record = sshGateway();

    await expect(manager().ensureGatewayReady(record, { startPolicy: 'require_ready' }))
      .rejects.toBeInstanceOf(GatewayServiceStartRequiredError);

    expect(lifecycleMocks.probeManagedGatewayServiceStatus).toHaveBeenCalledWith(expect.objectContaining({
      stateRoot: '/opt/redeven/gateways/gw_bastion/state',
    }));
    expect(lifecycleMocks.ensureManagedGatewayServiceReady).not.toHaveBeenCalled();
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).not.toHaveBeenCalled();
  });

  it('reports unreachable SSH Gateways as unavailable instead of asking to start them', async () => {
    lifecycleMocks.probeManagedGatewayServiceStatus.mockResolvedValue({
      status: 'failed',
      message: 'SSH connection to "bastion.internal" failed.',
      binary_path: '/opt/redeven/gateway/managed/bin/redeven-gateway',
      state_root: '/opt/redeven/gateways/gw_bastion/state',
    });
    const record = sshGateway();

    await expect(manager().ensureGatewayReady(record, { startPolicy: 'require_ready' })).rejects.toMatchObject({
      code: 'gateway_bridge_unavailable',
      message: 'SSH connection to "bastion.internal" failed.',
    } satisfies Partial<GatewayServiceUnavailableError>);

    expect(lifecycleMocks.ensureManagedGatewayServiceReady).not.toHaveBeenCalled();
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).not.toHaveBeenCalled();
  });

  it('prepares SSH container Gateways through the Gateway service host and exec-stream bridge', async () => {
    const progress: string[] = [];
    lifecycleMocks.ensureManagedGatewayServiceReady.mockImplementation(async (args) => {
      args.onProgress?.({ phase: 'checking_container', title: 'Checking', detail: 'Checking container' });
      args.onProgress?.({ phase: 'preparing_gateway_package', title: 'Preparing', detail: 'Preparing package' });
      args.onProgress?.({ phase: 'installing_gateway', title: 'Installing', detail: 'Installing Gateway' });
      args.onProgress?.({ phase: 'starting_gateway', title: 'Starting', detail: 'Starting Gateway' });
      args.onProgress?.({ phase: 'gateway_ready', title: 'Ready', detail: 'Gateway ready' });
      return '/root/.redeven/gateway/managed/bin/redeven-gateway';
    });
    const record = containerGateway();

    await manager(progress).bridgeClient(record, { startPolicy: 'start_if_needed' });

    expect(lifecycleMocks.ensureManagedGatewayServiceReady).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        ssh_destination: 'bastion.internal',
        ssh_port: 2222,
        auth_mode: 'key_agent',
        runtime_root: '/root/.redeven',
      }),
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'container-stable-id',
        container_ref: 'dev-container',
        container_label: 'dev-container',
        runtime_root: '/root/.redeven',
        runtime_state_root: '/root/.redeven/gateways/gw_container/state',
        bridge_strategy: 'exec_stream',
      },
      stateRoot: '/root/.redeven/gateways/gw_container/state',
      sshPassword: '',
    }));
    expect(lifecycleMocks.startRuntimePlacementBridgeSession).toHaveBeenCalledWith(expect.objectContaining({
      host_access: expect.objectContaining({ kind: 'ssh_host' }),
      placement: expect.objectContaining({
        kind: 'container_process',
        container_id: 'container-stable-id',
        bridge_strategy: 'exec_stream',
        runtime_root: '/root/.redeven',
        runtime_state_root: '/root/.redeven/gateways/gw_container/state',
      }),
      runtime_binary_path: '/root/.redeven/gateway/managed/bin/redeven-gateway',
      bridge_command_kind: 'gateway',
      require_local_ui: false,
      desktop_owner_id: 'desktop-owner',
      ssh_password: '',
      fallback_local_id: 'gw_container',
    }));
    expect(progress).toEqual([
      'checking_container',
      'preparing_gateway_package',
      'installing_gateway',
      'starting_gateway',
      'gateway_ready',
      'opening_bridge',
      'gateway_ready',
    ]);
  });

  it('does not open a Gateway bridge when service startup fails', async () => {
    lifecycleMocks.ensureManagedGatewayServiceReady.mockRejectedValue(new Error('host unavailable'));
    const record = sshGateway();

    await expect(manager().bridgeClient(record, { startPolicy: 'start_if_needed' })).rejects.toMatchObject({
      code: 'gateway_service_start_failed',
      message: 'host unavailable',
    } satisfies Partial<GatewayServiceUnavailableError>);

    expect(lifecycleMocks.startRuntimePlacementBridgeSession).not.toHaveBeenCalled();
  });

  it('does not open a Gateway bridge when container service startup fails', async () => {
    lifecycleMocks.ensureManagedGatewayServiceReady.mockRejectedValue(new Error('container unavailable'));
    const record = containerGateway();

    await expect(manager().bridgeClient(record, { startPolicy: 'start_if_needed' })).rejects.toMatchObject({
      code: 'gateway_container_unavailable',
      message: 'container unavailable',
    } satisfies Partial<GatewayServiceUnavailableError>);

    expect(lifecycleMocks.startRuntimePlacementBridgeSession).not.toHaveBeenCalled();
  });

  it('reports bridge attach failures with structured Gateway bridge errors', async () => {
    lifecycleMocks.startRuntimePlacementBridgeSession.mockRejectedValue(new Error('bridge refused'));
    const record = sshGateway();

    await expect(manager().bridgeClient(record, { startPolicy: 'start_if_needed' })).rejects.toMatchObject({
      code: 'gateway_bridge_unavailable',
      message: 'bridge refused',
    } satisfies Partial<GatewayServiceUnavailableError>);
  });

  it('uses Gateway service stop instead of runtime stop', async () => {
    const record = sshGateway();

    await manager().stopGateway(record);

    expect(lifecycleMocks.stopManagedGatewayService).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({ ssh_destination: 'bastion.internal' }),
      placement: expect.objectContaining({
        kind: 'host_process',
        runtime_root: '/opt/redeven',
        runtime_state_root: '/opt/redeven/gateways/gw_bastion/state',
      }),
      stateRoot: '/opt/redeven/gateways/gw_bastion/state',
      releaseTag: 'v1.2.3',
    }));
  });

  it('does not allow Desktop to manage URL Gateways as local services', async () => {
    const record: GatewayRecord = {
      schema_version: 1,
      gateway_id: 'gw_url',
      display_name: 'URL Gateway',
      connection: {
        kind: 'url',
        base_url: 'https://gateway.example/',
        allow_loopback_http: false,
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };

    await expect(manager().startGateway(record)).rejects.toBeInstanceOf(GatewayNotManageableError);
    await expect(manager().stopGateway(record)).rejects.toBeInstanceOf(GatewayNotManageableError);
    expect(lifecycleMocks.ensureManagedGatewayServiceReady).not.toHaveBeenCalled();
    expect(lifecycleMocks.stopManagedGatewayService).not.toHaveBeenCalled();
  });
});
