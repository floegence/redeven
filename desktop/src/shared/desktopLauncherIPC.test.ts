import { describe, expect, it } from 'vitest';

import {
  DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL,
  desktopWelcomeSnapshotGeneration,
  desktopWelcomeSnapshotRevision,
  isDesktopLauncherActionFailure,
  isDesktopLauncherActionSuccess,
  normalizeDesktopLauncherActionRequest,
  selectLatestDesktopWelcomeSnapshot,
} from './desktopLauncherIPC';
import type { DesktopLauncherActionProgress, DesktopLauncherOperationSnapshot } from './desktopLauncherIPC';
import { DEFAULT_DESKTOP_SSH_RUNTIME_ROOT } from './desktopSSH';
import { runtimeLifecycleProgress } from './desktopRuntimeLifecycleProgress';

describe('desktopLauncherIPC', () => {
  it('orders welcome snapshots by generation before revision', () => {
    const running = { snapshot_generation: 4, snapshot_revision: 10, value: 'running' };
    const failed = { snapshot_generation: 5, snapshot_revision: 9, value: 'failed' };
    const duplicateGeneration = { snapshot_generation: 5, snapshot_revision: 11, value: 'failed-later-revision' };
    const staleDuplicateGeneration = { snapshot_generation: 5, snapshot_revision: 8, value: 'stale-failed' };
    const legacy = { snapshot_revision: 12, value: 'legacy' };
    const newerLegacy = { snapshot_revision: 13, value: 'legacy-newer' };
    const newerGenerationLowerRevision = { snapshot_generation: 6, snapshot_revision: 1, value: 'newer-generation' };
    const sameGenerationMissingRevision = { snapshot_generation: 5, value: 'same-generation-missing-revision' };
    const generationZero = { snapshot_generation: 0, snapshot_revision: 14, value: 'generation-zero-legacy' };

    expect(desktopWelcomeSnapshotGeneration(failed)).toBe(5);
    expect(desktopWelcomeSnapshotRevision(failed)).toBe(9);
    expect(selectLatestDesktopWelcomeSnapshot(failed, running)).toBe(failed);
    expect(selectLatestDesktopWelcomeSnapshot(running, failed)).toBe(failed);
    expect(selectLatestDesktopWelcomeSnapshot(failed, duplicateGeneration)).toBe(duplicateGeneration);
    expect(selectLatestDesktopWelcomeSnapshot(failed, staleDuplicateGeneration)).toBe(failed);
    expect(selectLatestDesktopWelcomeSnapshot(failed, newerGenerationLowerRevision)).toBe(newerGenerationLowerRevision);
    expect(selectLatestDesktopWelcomeSnapshot(failed, sameGenerationMissingRevision)).toBe(failed);
    expect(selectLatestDesktopWelcomeSnapshot(failed, legacy)).toBe(failed);
    expect(selectLatestDesktopWelcomeSnapshot(legacy, newerLegacy)).toBe(newerLegacy);
    expect(selectLatestDesktopWelcomeSnapshot(newerLegacy, legacy)).toBe(newerLegacy);
    expect(selectLatestDesktopWelcomeSnapshot(newerLegacy, generationZero)).toBe(generationZero);
  });

  it('normalizes launcher actions and trims Environment inputs', () => {
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'open_local_environment',
      environment_id: ' local ',
    })).toEqual({
      kind: 'open_local_environment',
      environment_id: 'local',
      route: 'auto',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'open_local_environment',
      environment_id: ' local-container ',
      runtime_target_id: ' local:container:docker:container-stable-id:e832df85 ',
      placement_target_id: ' local:container:docker:container-stable-id:e832df85 ',
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: ' Docker ',
        container_id: ' container-stable-id ',
        container_ref: ' dev-container ',
        container_label: ' Dev Container ',
        runtime_root: ' /workspace/.redeven ',
      },
    })).toEqual({
      kind: 'open_local_environment',
      environment_id: 'local-container',
      runtime_target_id: 'local:container:docker:container-stable-id:e832df85',
      placement_target_id: 'local:container:docker:container-stable-id:e832df85',
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'container-stable-id',
        container_ref: 'dev-container',
        container_label: 'Dev Container',
        runtime_root: '/workspace/.redeven',
        bridge_strategy: 'exec_stream',
      },
      route: 'auto',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'open_environment_settings',
      environment_id: ' local ',
    })).toEqual({
      kind: 'open_environment_settings',
      environment_id: 'local',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'open_environment_center',
    })).toEqual({
      kind: 'open_environment_center',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'start_environment_runtime',
      environment_id: ' provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo ',
      runtime_target_id: ' local:container:docker:container-stable-id:abc12345 ',
      placement_target_id: ' local:container:docker:container-stable-id:abc12345 ',
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: ' Docker ',
        container_id: ' container-stable-id ',
        container_ref: ' dev-container ',
        container_label: ' Dev Container ',
        runtime_root: ' /workspace/.redeven ',
      },
      force_runtime_update: true,
    })).toEqual({
      kind: 'start_environment_runtime',
      environment_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      runtime_target_id: 'local:container:docker:container-stable-id:abc12345',
      placement_target_id: 'local:container:docker:container-stable-id:abc12345',
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'container-stable-id',
        container_ref: 'dev-container',
        container_label: 'Dev Container',
        runtime_root: '/workspace/.redeven',
        bridge_strategy: 'exec_stream',
      },
      force_runtime_update: true,
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'restart_environment_runtime',
      environment_id: ' provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo ',
      runtime_target_id: ' local:container:docker:container-stable-id:abc12345 ',
      placement_target_id: ' local:container:docker:container-stable-id:abc12345 ',
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: ' Docker ',
        container_id: ' container-stable-id ',
        container_ref: ' dev-container ',
        container_label: ' Dev Container ',
        runtime_root: ' /workspace/.redeven ',
      },
    })).toEqual(expect.objectContaining({
      kind: 'restart_environment_runtime',
      environment_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      runtime_target_id: 'local:container:docker:container-stable-id:abc12345',
      placement: expect.objectContaining({
        kind: 'container_process',
        runtime_root: '/workspace/.redeven',
      }),
    }));
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'manage_desktop_update',
      environment_id: ' local ',
      label: ' Local Environment ',
    })).toEqual({
      kind: 'manage_desktop_update',
      environment_id: 'local',
      label: 'Local Environment',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'prepare_environment_open',
      environment_id: ' ssh-container ',
      label: ' SSH container ',
      runtime_target_id: ' ssh:container:devbox%3A2222:docker:container-stable-id:e832df85 ',
      host_access: {
        kind: 'ssh_host',
        ssh: {
          ssh_destination: ' devbox ',
          ssh_port: ' 2222 ',
          auth_mode: ' key_agent ',
        },
      },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'container-stable-id',
        container_ref: 'dev-container',
        container_label: 'dev-container',
        runtime_root: '/root/.redeven',
      },
    })).toEqual(expect.objectContaining({
      kind: 'prepare_environment_open',
      environment_id: 'ssh-container',
      label: 'SSH container',
      runtime_target_id: 'ssh:container:devbox%3A2222:docker:container-stable-id:e832df85',
    }));
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'connect_provider_runtime',
      provider_environment_id: ' provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo ',
      runtime_target_id: ' ssh:ssh%3Adevbox%3Adefault%3Akey_agent%3Aremote_default ',
    })).toEqual({
      kind: 'connect_provider_runtime',
      provider_environment_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      runtime_target_id: 'ssh:ssh%3Adevbox%3Adefault%3Akey_agent%3Aremote_default',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'disconnect_provider_runtime',
      provider_environment_id: ' provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo ',
      runtime_target_id: ' local:local ',
    })).toEqual({
      kind: 'disconnect_provider_runtime',
      provider_environment_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      runtime_target_id: 'local:local',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'disconnect_provider_runtime',
      runtime_target_id: ' local:local ',
    })).toEqual({
      kind: 'disconnect_provider_runtime',
      runtime_target_id: 'local:local',
    });
    expect(normalizeDesktopLauncherActionRequest({ kind: 'close_launcher_or_quit' })).toEqual({ kind: 'close_launcher_or_quit' });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'save_local_environment_settings',
      local_ui_bind: ' localhost:23998 ',
      local_ui_password: ' secret ',
      local_ui_password_mode: ' replace ',
      auto_runtime_probe_enabled: true,
    })).toEqual({
      kind: 'save_local_environment_settings',
      local_ui_bind: 'localhost:23998',
      local_ui_password: ' secret ',
      local_ui_password_mode: 'replace',
      auto_runtime_probe_enabled: true,
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'open_remote_environment',
      external_local_ui_url: '  http://192.168.1.11:24000/  ',
      environment_id: ' env-1 ',
      label: ' Work laptop ',
    })).toEqual({
      kind: 'open_remote_environment',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      environment_id: 'env-1',
      label: 'Work laptop',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'focus_environment_window',
      session_key: ' url:http://192.168.1.11:24000/ ',
    })).toEqual({
      kind: 'focus_environment_window',
      session_key: 'url:http://192.168.1.11:24000/',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'upsert_saved_environment',
      environment_id: ' env-1 ',
      label: ' Work laptop ',
      external_local_ui_url: ' http://192.168.1.11:24000/ ',
      auto_runtime_probe_enabled: true,
    })).toEqual({
      kind: 'upsert_saved_environment',
      environment_id: 'env-1',
      label: 'Work laptop',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      auto_runtime_probe_enabled: true,
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'delete_saved_environment',
      environment_id: ' env-1 ',
    })).toEqual({
      kind: 'delete_saved_environment',
      environment_id: 'env-1',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'upsert_gateway',
      gateway_id: ' gw-demo ',
      display_name: ' Lab Gateway ',
      gateway_url: ' https://gateway.example/path?token=leak ',
      allow_loopback_http: true,
      user_confirmed: true,
    })).toEqual({
      kind: 'upsert_gateway',
      gateway_id: 'gw-demo',
      display_name: 'Lab Gateway',
      connection_kind: 'url',
      gateway_url: 'https://gateway.example/path?token=leak',
      allow_loopback_http: true,
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'upsert_gateway',
      gateway_id: ' gw-ssh ',
      display_name: ' SSH Gateway ',
      connection_kind: 'ssh_host',
      ssh_destination: ' dev@bastion ',
      ssh_port: ' 2222 ',
      auth_mode: ' password ',
      ssh_password: ' secret ',
      ssh_password_mode: 'replace',
      connect_timeout_seconds: '15',
      runtime_root: ' ~/.redeven ',
      bootstrap_strategy: ' desktop_upload ',
      release_base_url: ' https://mirror.example/releases?token=drop ',
      gateway_url: ' https://gateway.example/path?token=must-not-cross ',
      proof: 'renderer-proof-must-not-cross',
      client_private_key: 'renderer-private-key-must-not-cross',
    })).toEqual({
      kind: 'upsert_gateway',
      gateway_id: 'gw-ssh',
      display_name: 'SSH Gateway',
      connection_kind: 'ssh_host',
      ssh_destination: 'dev@bastion',
      ssh_port: 2222,
      auth_mode: 'password',
      ssh_password: ' secret ',
      ssh_password_mode: 'replace',
      connect_timeout_seconds: 15,
      runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
      bootstrap_strategy: 'desktop_upload',
      release_base_url: 'https://mirror.example/releases',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'upsert_gateway',
      gateway_id: ' gw-container ',
      display_name: ' Container Gateway ',
      connection_kind: 'ssh_container',
      ssh_destination: ' bastion ',
      ssh_port: '',
      auth_mode: 'key_agent',
      connect_timeout_seconds: '',
      container_engine: 'podman',
      container_id: ' container-123 ',
      container_ref: '',
      container_label: ' api-net ',
      runtime_root: ' ',
      artifact_nonce: 'renderer-artifact-nonce-must-not-cross',
      private_key: 'renderer-private-key-must-not-cross',
    })).toEqual({
      kind: 'upsert_gateway',
      gateway_id: 'gw-container',
      display_name: 'Container Gateway',
      connection_kind: 'ssh_container',
      ssh_destination: 'bastion',
      ssh_port: null,
      auth_mode: 'key_agent',
      ssh_password: '',
      ssh_password_mode: 'replace',
      connect_timeout_seconds: 10,
      container_engine: 'podman',
      container_id: 'container-123',
      container_ref: 'api-net',
      container_label: 'api-net',
      runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'pair_gateway',
      gateway_id: ' gw-demo ',
      user_confirmed: true,
      proof: 'renderer-proof-must-not-cross',
    })).toEqual({
      kind: 'pair_gateway',
      gateway_id: 'gw-demo',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'open_gateway_environment',
      environment_id: ' gateway:gw-demo:env:env-demo ',
      gateway_id: ' gw-demo ',
      gateway_env_id: ' env-demo ',
      label: ' Demo Gateway Env ',
      connect_artifact: {
        proof: 'renderer-proof-must-not-cross',
        artifact_nonce: 'renderer-artifact-nonce-must-not-cross',
        url: 'https://gateway.example/session',
      },
      gateway_session_id: 'renderer-gateway-session-must-not-cross',
      client_nonce: 'renderer-nonce-must-not-cross',
      client_private_key: 'renderer-private-key-must-not-cross',
    })).toEqual({
      kind: 'open_gateway_environment',
      environment_id: 'gateway:gw-demo:env:env-demo',
      gateway_id: 'gw-demo',
      gateway_env_id: 'env-demo',
      label: 'Demo Gateway Env',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'delete_gateway',
      gateway_id: ' gw-demo ',
    })).toEqual({
      kind: 'delete_gateway',
      gateway_id: 'gw-demo',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'start_control_plane_connect',
      provider_origin: ' https://provider.example.invalid/root ',
      display_label: ' Example Control Plane ',
    })).toEqual({
      kind: 'start_control_plane_connect',
      provider_origin: 'https://provider.example.invalid',
      display_label: 'Example Control Plane',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'set_local_environment_pinned',
      environment_id: ' local ',
      pinned: true,
    })).toEqual({
      kind: 'set_local_environment_pinned',
      environment_id: 'local',
      pinned: true,
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'set_provider_environment_pinned',
      environment_id: ' provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo ',
      pinned: true,
    })).toEqual({
      kind: 'set_provider_environment_pinned',
      environment_id: 'provider:https%3A%2F%2Fprovider.example.invalid:env:env_demo',
      pinned: true,
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'set_saved_environment_pinned',
      environment_id: ' env-1 ',
      label: ' Work laptop ',
      external_local_ui_url: ' http://192.168.1.11:24000/ ',
      pinned: false,
    })).toEqual({
      kind: 'set_saved_environment_pinned',
      environment_id: 'env-1',
      label: 'Work laptop',
      external_local_ui_url: 'http://192.168.1.11:24000/',
      pinned: false,
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'open_ssh_environment',
      environment_id: ' ssh-1 ',
      label: ' SSH lab ',
      ssh_destination: ' devbox ',
      ssh_port: ' 2222 ',
      auth_mode: ' password ',
      runtime_root: ' /opt/redeven ',
      bootstrap_strategy: ' desktop_upload ',
      release_base_url: ' https://mirror.example.invalid/releases/ ',
      connect_timeout_seconds: ' 45 ',
    })).toEqual({
      kind: 'open_ssh_environment',
      environment_id: 'ssh-1',
      label: 'SSH lab',
      ssh_destination: 'devbox',
      ssh_port: 2222,
      auth_mode: 'password',
      runtime_root: '/opt/redeven',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: 'https://mirror.example.invalid/releases/',
      connect_timeout_seconds: 45,
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'open_ssh_environment',
      environment_id: ' ssh-container ',
      label: ' SSH container ',
      ssh_destination: ' devbox ',
      runtime_target_id: ' ssh:container:devbox%3A2222:docker:container-stable-id:e832df85 ',
      host_access: {
        kind: 'ssh_host',
        ssh: {
          ssh_destination: ' devbox ',
          ssh_port: ' 2222 ',
          auth_mode: ' key_agent ',
        },
      },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'container-stable-id',
        container_ref: 'dev-container',
        container_label: 'dev-container',
        runtime_root: '/root/.redeven',
      },
    })).toEqual(expect.objectContaining({
      kind: 'open_ssh_environment',
      environment_id: 'ssh-container',
      label: 'SSH container',
      runtime_target_id: 'ssh:container:devbox%3A2222:docker:container-stable-id:e832df85',
      host_access: expect.objectContaining({
        kind: 'ssh_host',
        ssh: expect.objectContaining({
          ssh_destination: 'devbox',
          ssh_port: 2222,
        }),
      }),
      placement: expect.objectContaining({
        kind: 'container_process',
      }),
    }));
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'upsert_saved_ssh_environment',
      environment_id: ' ssh-1 ',
      label: ' SSH lab ',
      ssh_destination: ' devbox ',
      ssh_port: '',
      auth_mode: ' ',
      runtime_root: ' ',
      bootstrap_strategy: ' ',
      release_base_url: ' ',
    })).toEqual({
      kind: 'upsert_saved_ssh_environment',
      environment_id: 'ssh-1',
      label: 'SSH lab',
      ssh_destination: 'devbox',
      ssh_port: null,
      auth_mode: '',
      runtime_root: '',
      bootstrap_strategy: '',
      release_base_url: '',
      connect_timeout_seconds: 10,
      ssh_password: '',
      ssh_password_mode: 'replace',
      auto_runtime_probe_enabled: false,
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'delete_saved_ssh_environment',
      environment_id: ' ssh-1 ',
    })).toEqual({
      kind: 'delete_saved_ssh_environment',
      environment_id: 'ssh-1',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'cancel_launcher_operation',
      operation_key: ' ssh:devbox:default:key_agent:remote_default ',
    })).toEqual({
      kind: 'cancel_launcher_operation',
      operation_key: 'ssh:devbox:default:key_agent:remote_default',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'dismiss_launcher_operation',
      operation_key: ' ssh:devbox:default:key_agent:remote_default ',
    })).toEqual({
      kind: 'dismiss_launcher_operation',
      operation_key: 'ssh:devbox:default:key_agent:remote_default',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'set_saved_ssh_environment_pinned',
      environment_id: ' ssh-1 ',
      label: ' SSH lab ',
      pinned: true,
      ssh_destination: ' devbox ',
      ssh_port: ' 2222 ',
      auth_mode: ' key_agent ',
      runtime_root: ' /opt/redeven ',
      bootstrap_strategy: ' desktop_upload ',
      release_base_url: ' https://mirror.example.invalid/releases/ ',
    })).toEqual({
      kind: 'set_saved_ssh_environment_pinned',
      environment_id: 'ssh-1',
      label: 'SSH lab',
      pinned: true,
      ssh_destination: 'devbox',
      ssh_port: 2222,
      auth_mode: 'key_agent',
      runtime_root: '/opt/redeven',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: 'https://mirror.example.invalid/releases/',
      connect_timeout_seconds: 10,
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'upsert_saved_runtime_target',
      label: ' Local Container ',
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'podman',
        container_id: 'dev',
        runtime_root: '/root/.redeven',
      },
    })).toEqual({
      kind: 'upsert_saved_runtime_target',
      environment_id: undefined,
      label: 'Local Container',
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'podman',
        container_id: 'dev',
        container_ref: 'dev',
        container_label: 'dev',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
      ssh_password: '',
      ssh_password_mode: 'replace',
      auto_runtime_probe_enabled: false,
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'set_saved_runtime_target_pinned',
      environment_id: ' local:container:podman:dev:12345678 ',
      label: ' Local Container ',
      pinned: true,
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'podman',
        container_id: 'dev',
        runtime_root: '/root/.redeven',
      },
    })).toEqual({
      kind: 'set_saved_runtime_target_pinned',
      environment_id: 'local:container:podman:dev:12345678',
      label: 'Local Container',
      pinned: true,
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'podman',
        container_id: 'dev',
        container_ref: 'dev',
        container_label: 'dev',
        runtime_root: '/root/.redeven',
        bridge_strategy: 'exec_stream',
      },
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'delete_saved_runtime_target',
      environment_id: ' local:container:podman:dev:12345678 ',
    })).toEqual({
      kind: 'delete_saved_runtime_target',
      environment_id: 'local:container:podman:dev:12345678',
    });
  });

  it('normalizes only digest-bound runtime process takeover continuations', () => {
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'restart_environment_runtime',
      environment_id: 'local',
      host_access: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '/tmp/redeven' },
      runtime_process_reconciliation: {
        mode: 'confirmed_takeover',
        expected_inventory_digest: ` ${'a'.repeat(64)} `,
      },
    })).toMatchObject({
      runtime_process_reconciliation: {
        mode: 'confirmed_takeover',
        expected_inventory_digest: 'a'.repeat(64),
      },
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'restart_environment_runtime',
      environment_id: 'local',
      host_access: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '/tmp/redeven' },
      runtime_process_reconciliation: { mode: 'automatic', expected_inventory_digest: 'a'.repeat(64) },
    })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'restart_environment_runtime',
      environment_id: 'local',
      host_access: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '/tmp/redeven' },
      runtime_process_reconciliation: { mode: 'confirmed_takeover', expected_inventory_digest: 'not-a-digest' },
    })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'restart_environment_runtime',
      environment_id: 'local',
      host_access: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '/tmp/redeven' },
      runtime_process_reconciliation: {
        mode: 'confirmed_takeover',
        expected_inventory_digest: 'a'.repeat(64),
        allow_changed_inventory: true,
      },
    })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'start_environment_runtime',
      environment_id: 'local',
      host_access: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '/tmp/redeven' },
      runtime_process_reconciliation: {
        mode: 'confirmed_takeover',
        expected_inventory_digest: 'a'.repeat(64),
      },
    })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'open_local_environment',
      environment_id: 'local',
      host_access: { kind: 'local_host' },
      placement: { kind: 'host_process', runtime_root: '/tmp/redeven' },
      runtime_process_reconciliation: {
        mode: 'confirmed_takeover',
        expected_inventory_digest: 'a'.repeat(64),
      },
    })).toBeNull();
  });

  it('rejects unsupported or incomplete launcher actions', () => {
    expect(normalizeDesktopLauncherActionRequest({ kind: 'open_advanced_settings' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'open_local_environment' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'stop_environment_runtime', environment_id: '   ' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'manage_desktop_update', environment_id: '   ' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'connect_provider_runtime', provider_environment_id: '   ', runtime_target_id: 'local:local' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'connect_provider_runtime', provider_environment_id: 'provider-env', runtime_target_id: 'provider-env' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'connect_provider_runtime', provider_environment_id: 'provider-env' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'disconnect_provider_runtime', runtime_target_id: ' local:local ' })).toEqual({
      kind: 'disconnect_provider_runtime',
      runtime_target_id: 'local:local',
    });
    expect(normalizeDesktopLauncherActionRequest({ kind: 'disconnect_provider_runtime', provider_environment_id: 'provider-env', runtime_target_id: ' local:local ' })).toEqual({
      kind: 'disconnect_provider_runtime',
      provider_environment_id: 'provider-env',
      runtime_target_id: 'local:local',
    });
    expect(normalizeDesktopLauncherActionRequest({ kind: 'disconnect_provider_runtime', provider_environment_id: 'provider-env', runtime_target_id: '   ' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'disconnect_provider_runtime', provider_environment_id: 'provider-env', runtime_target_id: 'local:' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'start_environment_runtime',
      runtime_target_id: 'local:container:docker:container-stable-id:abc12345',
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'lxc',
        container_id: 'container-stable-id',
      },
    })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'focus_environment_window', session_key: '   ' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'cancel_launcher_operation', operation_key: '   ' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'set_provider_environment_pinned',
      environment_id: '   ',
    })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'upsert_gateway', gateway_url: '   ' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'pair_gateway', gateway_id: '   ', user_confirmed: true })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'open_gateway_environment',
      environment_id: 'gateway:gw-demo:env:env-demo',
      gateway_id: 'gw-demo',
      gateway_env_id: '',
      label: 'Demo',
    })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'open_gateway_environment',
      environment_id: 'gateway:gw-demo:env:env-demo',
      gateway_id: 'gw-demo',
      gateway_env_id: 'env-demo',
      label: 'Demo',
      start_policy: 'require_ready',
    })).toEqual({
      kind: 'open_gateway_environment',
      environment_id: 'gateway:gw-demo:env:env-demo',
      gateway_id: 'gw-demo',
      gateway_env_id: 'env-demo',
      label: 'Demo',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'open_gateway_environment',
      environment_id: 'gateway:gw-demo:env:env-demo',
      gateway_id: 'gw-demo',
      gateway_env_id: 'env-demo',
      label: 'Demo',
      start_policy: 'start_if_needed',
      user_confirmed: true,
      private_key: 'renderer must not pass this through',
    })).toEqual({
      kind: 'open_gateway_environment',
      environment_id: 'gateway:gw-demo:env:env-demo',
      gateway_id: 'gw-demo',
      gateway_env_id: 'env-demo',
      label: 'Demo',
      start_policy: 'start_if_needed',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'pair_gateway',
      gateway_id: ' gw-demo ',
      start_policy: 'prompt_if_needed',
      user_confirmed: true,
    })).toEqual({
      kind: 'pair_gateway',
      gateway_id: 'gw-demo',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'pair_gateway',
      gateway_id: ' gw-demo ',
      start_policy: 'start_if_needed',
      user_confirmed: true,
    })).toEqual({
      kind: 'pair_gateway',
      gateway_id: 'gw-demo',
      start_policy: 'start_if_needed',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'sync_gateway',
      gateway_id: ' gw-demo ',
      start_policy: 'require_ready',
    })).toEqual({
      kind: 'sync_gateway',
      gateway_id: 'gw-demo',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'sync_gateway',
      gateway_id: ' gw-demo ',
      start_policy: 'start_if_needed',
    })).toEqual({
      kind: 'sync_gateway',
      gateway_id: 'gw-demo',
      start_policy: 'start_if_needed',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'check_gateway',
      gateway_id: ' gw-demo ',
      start_policy: 'start_if_needed',
      retry_action: { kind: 'sync_gateway', gateway_id: 'unsafe' },
    })).toEqual({
      kind: 'check_gateway',
      gateway_id: 'gw-demo',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'set_gateway_enabled',
      gateway_id: ' gw-demo ',
      enabled: false,
    })).toEqual({
      kind: 'set_gateway_enabled',
      gateway_id: 'gw-demo',
      enabled: false,
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'set_gateway_enabled',
      gateway_id: ' gw-demo ',
    })).toEqual({
      kind: 'set_gateway_enabled',
      gateway_id: 'gw-demo',
      enabled: true,
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'refresh_gateway_catalog',
      gateway_id: ' gw-demo ',
      start_policy: 'prompt_if_needed',
    })).toEqual({
      kind: 'refresh_gateway_catalog',
      gateway_id: 'gw-demo',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'refresh_gateway_catalog',
      gateway_id: ' gw-demo ',
      start_policy: 'start_if_needed',
      connect_artifact: { leak: true },
    })).toEqual({
      kind: 'refresh_gateway_catalog',
      gateway_id: 'gw-demo',
      start_policy: 'start_if_needed',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'refresh_gateway_status',
      gateway_id: ' gw-demo ',
    })).toEqual({
      kind: 'refresh_gateway_status',
      gateway_id: 'gw-demo',
    });
    for (const kind of [
      'start_gateway',
      'stop_gateway',
      'restart_gateway',
      'update_gateway',
    ] as const) {
      expect(normalizeDesktopLauncherActionRequest({
        kind,
        gateway_id: ' gw-demo ',
        start_policy: 'start_if_needed',
      })).toEqual({
        kind,
        gateway_id: 'gw-demo',
      });
    }
    expect(normalizeDesktopLauncherActionRequest({ kind: 'refresh_gateway_runtime', gateway_id: 'gw-demo' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'check_gateway', gateway_id: '   ' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'start_gateway', gateway_id: '   ' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'delete_gateway', gateway_id: '   ' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'delete_saved_environment', environment_id: '   ' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest(null)).toBeNull();
  });

  it('distinguishes structured launcher success and failure payloads', () => {
    expect(DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL).toBe('redeven-desktop:launcher-action-progress');
    expect(isDesktopLauncherActionSuccess({
      ok: true,
      outcome: 'opened_environment_window',
      session_key: 'env:local%3Adefault:local_host',
    })).toBe(true);
    expect(isDesktopLauncherActionSuccess({
      ok: true,
      outcome: 'opened_desktop_update_handoff',
    })).toBe(true);
    expect(isDesktopLauncherActionFailure({
      ok: false,
      code: 'session_stale',
      scope: 'environment',
      message: 'That window was already closed. Desktop refreshed the environment list.',
      should_refresh_snapshot: true,
    })).toBe(true);
  });

  it('carries runtime lifecycle metadata in launcher operation and progress contracts', () => {
    const runtimeLifecycle = runtimeLifecycleProgress({
      location: 'local_container',
      operation: 'update',
      planState: 'executing',
      planRevision: 3,
      phase: 'installing_runtime_package',
      targetID: 'local:container:docker:dev:abcd1234',
      targetLabel: 'Dev Container',
      targetDetail: 'docker/dev',
      stepStates: [
        { id: 'checking_container', key: 'runtime-plan:0:checking_container', status: 'succeeded' },
        { id: 'checking_runtime_package', key: 'runtime-plan:1:checking_runtime_package', status: 'succeeded' },
        { id: 'installing_runtime_package', key: 'runtime-plan:2:installing_runtime_package', status: 'running' },
      ],
      omittedSteps: [
        { id: 'stopping_runtime_process', reason: 'runtime_process_absent' },
      ],
    });
    const operation: DesktopLauncherOperationSnapshot = {
      operation_key: 'local:container:docker:dev:abcd1234',
      action: 'start_environment_runtime',
      subject_kind: 'runtime_target',
      subject_id: 'local:container:docker:dev:abcd1234',
      subject_generation: 0,
      environment_id: 'local:container:docker:dev:abcd1234',
      environment_label: 'Dev Container',
      started_at_unix_ms: 1,
      updated_at_unix_ms: 2,
      status: 'running',
      phase: 'installing_runtime_package',
      title: 'Installing runtime in container',
      detail: 'Desktop is installing Redeven inside the running container.',
      lifecycle_progress: runtimeLifecycle,
      cancelable: true,
      deleted_subject: false,
      next_actions: [{
        kind: 'copy_diagnostics',
        operation_key: 'local:container:docker:dev:abcd1234',
        label: 'Copy log',
      }],
    };
    const progress: DesktopLauncherActionProgress = {
      action: operation.action,
      operation_key: operation.operation_key,
      subject_kind: operation.subject_kind,
      subject_id: operation.subject_id,
      environment_id: operation.environment_id,
      environment_label: operation.environment_label,
      started_at_unix_ms: operation.started_at_unix_ms,
      updated_at_unix_ms: operation.updated_at_unix_ms,
      status: operation.status,
      phase: operation.phase,
      title: operation.title,
      detail: operation.detail,
      lifecycle_progress: operation.lifecycle_progress,
      cancelable: operation.cancelable,
      deleted_subject: operation.deleted_subject,
      next_actions: operation.next_actions,
    };

    expect(operation.subject_kind).toBe('runtime_target');
    expect(progress.lifecycle_progress).toEqual(runtimeLifecycle);
    expect(progress.lifecycle_progress).toEqual(expect.objectContaining({
      plan_state: 'executing',
      plan_revision: 3,
      stage_index: 3,
      stage_count: 3,
      diagnostics: {
        omitted_steps: [
          { id: 'stopping_runtime_process', reason: 'runtime_process_absent' },
        ],
      },
    }));
    expect(progress.lifecycle_progress?.steps.map((step) => step.key)).toEqual([
      'runtime-plan:0:checking_container',
      'runtime-plan:1:checking_runtime_package',
      'runtime-plan:2:installing_runtime_package',
    ]);
  });

  it('carries Open connection metadata separately from runtime lifecycle metadata', () => {
    const openProgress = {
      kind: 'open_connection',
      location: 'ssh_host',
      phase: 'opening_bridge_proxy',
      stage_index: 3,
      stage_count: 8,
      environment_id: 'ssh-devbox',
      environment_label: 'Devbox',
      target_id: 'ssh:devbox',
      target_label: 'Devbox',
      target_detail: 'devbox',
    } as const;
    const progress: DesktopLauncherActionProgress = {
      action: 'open_ssh_environment',
      environment_id: 'ssh-devbox',
      operation_key: 'ssh:devbox:open',
      phase: 'opening_bridge_proxy',
      title: 'Opening bridge proxy',
      detail: 'Desktop is opening the loopback Desktop bridge.',
      open_progress: openProgress,
      cancelable: true,
      interrupt_label: 'Stop opening',
    };

    expect(progress.lifecycle_progress).toBeUndefined();
    expect(progress.open_progress).toEqual(openProgress);
  });
});
