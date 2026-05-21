import { describe, expect, it } from 'vitest';

import {
  DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL,
  isDesktopLauncherActionFailure,
  isDesktopLauncherActionSuccess,
  normalizeDesktopLauncherActionRequest,
} from './desktopLauncherIPC';
import type { DesktopLauncherActionProgress, DesktopLauncherOperationSnapshot } from './desktopLauncherIPC';

describe('desktopLauncherIPC', () => {
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
      kind: 'start_environment_runtime',
      environment_id: ' cp:https%3A%2F%2Fcp.example.invalid:env:env_demo ',
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
      allow_active_work_replacement: true,
    })).toEqual({
      kind: 'start_environment_runtime',
      environment_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
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
      allow_active_work_replacement: true,
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'restart_environment_runtime',
      environment_id: ' cp:https%3A%2F%2Fcp.example.invalid:env:env_demo ',
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
      environment_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
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
      provider_environment_id: ' cp:https%3A%2F%2Fcp.example.invalid:env:env_demo ',
      runtime_target_id: ' ssh:ssh%3Adevbox%3Adefault%3Akey_agent%3Aremote_default ',
    })).toEqual({
      kind: 'connect_provider_runtime',
      provider_environment_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
      runtime_target_id: 'ssh:ssh%3Adevbox%3Adefault%3Akey_agent%3Aremote_default',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'disconnect_provider_runtime',
      provider_environment_id: ' cp:https%3A%2F%2Fcp.example.invalid:env:env_demo ',
      runtime_target_id: ' local:local ',
    })).toEqual({
      kind: 'disconnect_provider_runtime',
      provider_environment_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
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
      kind: 'start_control_plane_connect',
      provider_origin: ' https://cp.example.invalid/root ',
      display_label: ' Example Control Plane ',
    })).toEqual({
      kind: 'start_control_plane_connect',
      provider_origin: 'https://cp.example.invalid',
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
      environment_id: ' cp:https%3A%2F%2Fcp.example.invalid:env:env_demo ',
      pinned: true,
    })).toEqual({
      kind: 'set_provider_environment_pinned',
      environment_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
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
      kind: 'continue_launcher_operation',
      operation_key: ' ssh:devbox:default:key_agent:remote_default ',
      confirmation_id: ' confirmation-1 ',
    })).toEqual({
      kind: 'continue_launcher_operation',
      operation_key: 'ssh:devbox:default:key_agent:remote_default',
      confirmation_id: 'confirmation-1',
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
    const runtimeLifecycle = {
      kind: 'runtime_lifecycle',
      location: 'local_container',
      phase: 'installing_runtime_package',
      stage_index: 5,
      stage_count: 6,
      target_id: 'local:container:docker:dev:abcd1234',
      target_label: 'Dev Container',
      target_detail: 'docker/dev',
    } as const;
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
      confirmation: {
        confirmation_id: 'confirm-1',
        title: 'Runtime update needs confirmation',
        summary: 'Updating will stop the current Runtime Service.',
        confirm_label: 'Update runtime',
        cancel_label: 'Cancel',
      },
      next_actions: [{
        kind: 'continue_after_confirmation',
        operation_key: 'local:container:docker:dev:abcd1234',
        confirmation_id: 'confirm-1',
        label: 'Update runtime',
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
      confirmation: operation.confirmation,
      next_actions: operation.next_actions,
    };

    expect(operation.subject_kind).toBe('runtime_target');
    expect(progress.lifecycle_progress).toEqual(runtimeLifecycle);
  });

  it('carries Open connection metadata separately from runtime lifecycle metadata', () => {
    const openProgress = {
      kind: 'open_connection',
      location: 'ssh_host',
      phase: 'opening_local_tunnel',
      stage_index: 4,
      stage_count: 9,
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
      phase: 'opening_local_tunnel',
      title: 'Opening local tunnel',
      detail: 'Desktop is opening the local SSH tunnel.',
      open_progress: openProgress,
      cancelable: true,
      interrupt_label: 'Stop opening',
    };

    expect(progress.lifecycle_progress).toBeUndefined();
    expect(progress.open_progress).toEqual(openProgress);
  });
});
