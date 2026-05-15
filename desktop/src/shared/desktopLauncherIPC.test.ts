import { describe, expect, it } from 'vitest';

import {
  DESKTOP_LAUNCHER_ACTION_PROGRESS_CHANNEL,
  isDesktopLauncherActionFailure,
  isDesktopLauncherActionSuccess,
  normalizeDesktopLauncherActionRequest,
} from './desktopLauncherIPC';

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
        container_label: 'Dev Container',
        runtime_root: '/workspace/.redeven',
        bridge_strategy: 'exec_stream',
      },
      force_runtime_update: true,
      allow_active_work_replacement: true,
    });
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
    expect(normalizeDesktopLauncherActionRequest({ kind: 'close_launcher_or_quit' })).toEqual({ kind: 'close_launcher_or_quit' });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'save_local_environment_settings',
      local_ui_bind: ' localhost:23998 ',
      local_ui_password: ' secret ',
      local_ui_password_mode: ' replace ',
    })).toEqual({
      kind: 'save_local_environment_settings',
      local_ui_bind: 'localhost:23998',
      local_ui_password: ' secret ',
      local_ui_password_mode: 'replace',
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
    })).toEqual({
      kind: 'upsert_saved_environment',
      environment_id: 'env-1',
      label: 'Work laptop',
      external_local_ui_url: 'http://192.168.1.11:24000/',
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
      remote_install_dir: ' /opt/redeven ',
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
      remote_install_dir: '/opt/redeven',
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
          remote_install_dir: ' remote_default ',
          bootstrap_strategy: ' desktop_upload ',
          release_base_url: ' ',
        },
      },
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'container-stable-id',
        container_label: 'dev-container',
        runtime_root: '/workspace/.redeven',
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
        bridge_strategy: 'exec_stream',
      }),
    }));
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'upsert_saved_ssh_environment',
      environment_id: ' ssh-1 ',
      label: ' SSH lab ',
      ssh_destination: ' devbox ',
      ssh_port: '',
      auth_mode: ' ',
      remote_install_dir: ' ',
      bootstrap_strategy: ' ',
      release_base_url: ' ',
    })).toEqual({
      kind: 'upsert_saved_ssh_environment',
      environment_id: 'ssh-1',
      label: 'SSH lab',
      ssh_destination: 'devbox',
      ssh_port: null,
      auth_mode: '',
      remote_install_dir: '',
      bootstrap_strategy: '',
      release_base_url: '',
      connect_timeout_seconds: 10,
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
      kind: 'set_saved_ssh_environment_pinned',
      environment_id: ' ssh-1 ',
      label: ' SSH lab ',
      pinned: true,
      ssh_destination: ' devbox ',
      ssh_port: ' 2222 ',
      auth_mode: ' key_agent ',
      remote_install_dir: ' /opt/redeven ',
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
      remote_install_dir: '/opt/redeven',
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
        runtime_root: '/runtime',
      },
    })).toEqual({
      kind: 'upsert_saved_runtime_target',
      label: 'Local Container',
      host_access: { kind: 'local_host' },
      placement: {
        kind: 'container_process',
        container_engine: 'podman',
        container_id: 'dev',
        container_label: 'dev',
        runtime_root: '/runtime',
        bridge_strategy: 'exec_stream',
      },
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
        runtime_root: '/runtime',
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
        container_label: 'dev',
        runtime_root: '/runtime',
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
    expect(normalizeDesktopLauncherActionRequest({ kind: 'connect_provider_runtime', provider_environment_id: '   ', runtime_target_id: 'local:local' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'connect_provider_runtime', provider_environment_id: 'provider-env', runtime_target_id: 'provider-env' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'connect_provider_runtime', provider_environment_id: 'provider-env' })).toBeNull();
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
        runtime_root: '/workspace/.redeven',
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
    expect(isDesktopLauncherActionFailure({
      ok: false,
      code: 'session_stale',
      scope: 'environment',
      message: 'That window was already closed. Desktop refreshed the environment list.',
      should_refresh_snapshot: true,
    })).toBe(true);
  });
});
