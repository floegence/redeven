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
      kind: 'open_managed_environment',
      environment_id: ' local:default ',
    })).toEqual({
      kind: 'open_managed_environment',
      environment_id: 'local:default',
      route: 'auto',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'open_environment_settings',
      environment_id: ' local:default ',
    })).toEqual({
      kind: 'open_environment_settings',
      environment_id: 'local:default',
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
      kind: 'upsert_managed_environment',
      environment_id: ' local:default ',
      environment_name: ' dev-a ',
      label: ' Local Dev ',
      local_ui_bind: ' localhost:23998 ',
      local_ui_password: ' secret ',
      local_ui_password_mode: ' replace ',
    })).toEqual({
      kind: 'upsert_managed_environment',
      environment_id: 'local:default',
      environment_name: 'dev-a',
      label: 'Local Dev',
      local_ui_bind: 'localhost:23998',
      local_ui_password: ' secret ',
      local_ui_password_mode: 'replace',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'upsert_provider_environment_local_runtime',
      environment_id: ' cp:https%3A%2F%2Fcp.example.invalid:env:env_demo ',
      label: ' Demo ',
      local_ui_bind: ' localhost:23998 ',
      local_ui_password: ' secret ',
      local_ui_password_mode: ' replace ',
    })).toEqual({
      kind: 'upsert_provider_environment_local_runtime',
      environment_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
      label: 'Demo',
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
      kind: 'delete_managed_environment',
      environment_id: ' local:default ',
    })).toEqual({
      kind: 'delete_managed_environment',
      environment_id: 'local:default',
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
      kind: 'set_managed_environment_pinned',
      environment_id: ' local:default ',
      pinned: true,
    })).toEqual({
      kind: 'set_managed_environment_pinned',
      environment_id: 'local:default',
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
      environment_instance_id: ' envinst_demo001 ',
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
      environment_instance_id: 'envinst_demo001',
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
      environment_instance_id: ' envinst_demo002 ',
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
      environment_instance_id: 'envinst_demo002',
    });
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'delete_saved_ssh_environment',
      environment_id: ' ssh-1 ',
    })).toEqual({
      kind: 'delete_saved_ssh_environment',
      environment_id: 'ssh-1',
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
      environment_instance_id: ' envinst_demo001 ',
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
      environment_instance_id: 'envinst_demo001',
    });
  });

  it('rejects unsupported or incomplete launcher actions', () => {
    expect(normalizeDesktopLauncherActionRequest({ kind: 'open_advanced_settings' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'open_managed_environment' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'stop_environment_runtime', environment_id: '   ' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'focus_environment_window', session_key: '   ' })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'upsert_provider_environment_local_runtime',
    })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({
      kind: 'set_provider_environment_pinned',
      environment_id: '   ',
    })).toBeNull();
    expect(normalizeDesktopLauncherActionRequest({ kind: 'delete_managed_environment', environment_id: '   ' })).toBeNull();
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
