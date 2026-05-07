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
      kind: 'open_environment_settings',
      environment_id: ' local ',
    })).toEqual({
      kind: 'open_environment_settings',
      environment_id: 'local',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'start_environment_runtime',
      environment_id: ' cp:https%3A%2F%2Fcp.example.invalid:env:env_demo ',
      force_runtime_update: true,
    })).toEqual({
      kind: 'start_environment_runtime',
      environment_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
      force_runtime_update: true,
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
      display_label: ' Redeven Portal ',
    })).toEqual({
      kind: 'start_control_plane_connect',
      provider_origin: 'https://cp.example.invalid',
      display_label: 'Redeven Portal',
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
    });
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
    });
  });

  it('rejects unsupported or incomplete launcher actions', () => {
    expect(normalizeDesktopLauncherActionRequest({ kind: 'open_advanced_settings' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'open_local_environment' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'stop_environment_runtime', environment_id: '   ' })).toBeNull();
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
