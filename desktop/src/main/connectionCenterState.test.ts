import { describe, expect, it } from 'vitest';

import {
  buildBlockedLaunchIssue,
  buildDesktopConnectionCenterSnapshot,
  buildRemoteConnectionIssue,
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

  it('builds a chooser snapshot with remembered and active session state', () => {
    const preferences = {
      ...validateDesktopSettingsDraft({
        target_kind: 'external_local_ui',
        external_local_ui_url: 'http://192.168.1.12:24000/',
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
      activeSessionTarget: {
        kind: 'managed_local',
        external_local_ui_url: '',
      },
      entryReason: 'switch_device',
      advancedSectionOpen: true,
    })).toEqual({
      draft: {
        target_kind: 'external_local_ui',
        external_local_ui_url: 'http://192.168.1.12:24000/',
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        controlplane_url: '',
        env_id: '',
        env_token: '',
      },
      entry_reason: 'switch_device',
      remembered_target_kind: 'external_local_ui',
      active_session_target_kind: 'managed_local',
      active_session_local_ui_url: 'http://127.0.0.1:23998/',
      cancel_label: 'Back to current device',
      this_device_local_ui_url: 'http://127.0.0.1:23998/',
      this_device_share_preset: 'this_device',
      this_device_link_state: 'connected',
      recent_devices: [
        {
          local_ui_url: 'http://192.168.1.12:24000/',
          is_remembered_target: true,
          is_active_session: false,
        },
        {
          local_ui_url: 'http://192.168.1.11:24000/',
          is_remembered_target: false,
          is_active_session: false,
        },
      ],
      issue: null,
      advanced_section_open: true,
    });
  });

  it('builds a remote connection issue with copyable diagnostics', () => {
    expect(buildRemoteConnectionIssue(
      'http://192.168.1.11:24000/',
      'external_target_unreachable',
      'Desktop could not reach that Redeven device.',
    )).toEqual({
      scope: 'remote_device',
      code: 'external_target_unreachable',
      title: 'Unable to open that device',
      message: 'Desktop could not reach that Redeven device.',
      diagnostics_copy: [
        'status: blocked',
        'code: external_target_unreachable',
        'message: Desktop could not reach that Redeven device.',
        'target url: http://192.168.1.11:24000/',
      ].join('\n'),
      target_url: 'http://192.168.1.11:24000/',
    });
  });

  it('maps blocked managed startup reports into chooser issues', () => {
    expect(buildBlockedLaunchIssue({
      status: 'blocked',
      code: 'state_dir_locked',
      message: 'state dir is locked',
      lock_owner: {
        local_ui_enabled: true,
      },
      diagnostics: {
        state_dir: '/tmp/redeven',
      },
    })).toEqual({
      scope: 'this_device',
      code: 'state_dir_locked',
      title: 'Redeven is already starting elsewhere',
      message: 'Another Redeven runtime instance is using the default state directory and appears to provide Local UI. Retry in a moment so Desktop can attach to it.',
      diagnostics_copy: [
        'status: blocked',
        'code: state_dir_locked',
        'message: state dir is locked',
        'lock owner local_ui_enabled: true',
        'state dir: /tmp/redeven',
      ].join('\n'),
      target_url: '',
    });
  });
});
