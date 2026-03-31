import { describe, expect, it } from 'vitest';

import {
  buildDesktopConnectionCenterSnapshot,
  DEFAULT_LOCAL_NETWORK_BIND,
  resolveDesktopLinkState,
  resolveDesktopSharePreset,
} from './connectionCenterState';
import { validateDesktopSettingsDraft } from './desktopPreferences';

describe('connectionCenterState', () => {
  it('classifies the default private bind as this_device', () => {
    expect(resolveDesktopSharePreset('127.0.0.1:0', '')).toBe('this_device');
  });

  it('classifies the LAN preset as local_network', () => {
    expect(resolveDesktopSharePreset(DEFAULT_LOCAL_NETWORK_BIND, 'secret-123')).toBe('local_network');
    expect(resolveDesktopSharePreset('192.168.1.11:24000', 'secret-123')).toBe('local_network');
  });

  it('classifies unusual binds as custom', () => {
    expect(resolveDesktopSharePreset('127.0.0.1:24000', '')).toBe('custom');
    expect(resolveDesktopSharePreset('0.0.0.0:25000', 'secret-123')).toBe('custom');
  });

  it('derives link state from pending bootstrap first', () => {
    const preferences = validateDesktopSettingsDraft({
      target_kind: 'managed_local',
      external_local_ui_url: '',
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: 'https://region.example.invalid',
      env_id: 'env_123',
      env_token: 'token-123',
    });

    expect(resolveDesktopLinkState(preferences, true)).toBe('pending');
  });

  it('builds a connection-center snapshot from the active runtime and recent targets', () => {
    const preferences = {
      ...validateDesktopSettingsDraft({
        target_kind: 'managed_local',
        external_local_ui_url: 'http://192.168.1.11:24000/',
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        controlplane_url: '',
        env_id: '',
        env_token: '',
      }),
      recent_external_local_ui_urls: ['http://192.168.1.11:24000/'],
    };

    expect(buildDesktopConnectionCenterSnapshot({
      preferences,
      managedStartup: {
        local_ui_url: 'http://127.0.0.1:23998/',
        local_ui_urls: ['http://127.0.0.1:23998/'],
        remote_enabled: true,
      },
    })).toEqual({
      draft: {
        target_kind: 'managed_local',
        external_local_ui_url: 'http://192.168.1.11:24000/',
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        controlplane_url: '',
        env_id: '',
        env_token: '',
      },
      current_target_kind: 'managed_local',
      current_local_ui_url: 'http://127.0.0.1:23998/',
      active_runtime_remote_enabled: true,
      share_preset: 'this_device',
      link_state: 'connected',
      recent_external_local_ui_urls: ['http://192.168.1.11:24000/'],
    });
  });
});
