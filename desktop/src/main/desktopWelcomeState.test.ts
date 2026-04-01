import { describe, expect, it } from 'vitest';

import {
  buildBlockedLaunchIssue,
  buildDesktopWelcomeSnapshot,
  buildRemoteConnectionIssue,
  resolveDesktopLinkState,
  resolveDesktopSharePreset,
} from './desktopWelcomeState';

describe('desktopWelcomeState', () => {
  it('resolves high-level sharing presets for This Device', () => {
    expect(resolveDesktopSharePreset('127.0.0.1:0', '')).toBe('this_device');
    expect(resolveDesktopSharePreset('0.0.0.0:24000', 'secret')).toBe('local_network');
    expect(resolveDesktopSharePreset('127.0.0.1:24000', 'secret')).toBe('custom');
  });

  it('derives the remote control status from pending bootstrap and active runtime state', () => {
    expect(resolveDesktopLinkState({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      pending_bootstrap: {
        controlplane_url: 'https://region.example.invalid',
        env_id: 'env_123',
        env_token: 'token-123',
      },
      recent_external_local_ui_urls: [],
    }, false)).toBe('pending');

    expect(resolveDesktopLinkState({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      pending_bootstrap: null,
      recent_external_local_ui_urls: [],
    }, true)).toBe('connected');
  });

  it('builds launcher snapshots around the active session and recent devices', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: {
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'secret',
        pending_bootstrap: null,
        recent_external_local_ui_urls: [
          'http://192.168.1.11:24000/',
          'http://192.168.1.12:24000/',
        ],
      },
      externalStartup: {
        local_ui_url: 'http://192.168.1.12:24000/',
        local_ui_urls: ['http://192.168.1.12:24000/'],
      },
      activeSessionTarget: {
        kind: 'external_local_ui',
        external_local_ui_url: 'http://192.168.1.12:24000/',
      },
      entryReason: 'switch_device',
      issue: buildRemoteConnectionIssue(
        'http://192.168.1.99:24000/',
        'external_target_unreachable',
        'Desktop could not reach that device.',
      ),
    });

    expect(snapshot.entry_reason).toBe('switch_device');
    expect(snapshot.current_session_target_kind).toBe('external_local_ui');
    expect(snapshot.current_session_local_ui_url).toBe('http://192.168.1.12:24000/');
    expect(snapshot.current_session_label).toBe('Another device is open');
    expect(snapshot.close_action_label).toBe('Back to current device');
    expect(snapshot.this_device_share_preset).toBe('local_network');
    expect(snapshot.this_device_share_label).toBe('Shared on your local network');
    expect(snapshot.recent_devices).toEqual([
      {
        local_ui_url: 'http://192.168.1.12:24000/',
        is_active_session: true,
      },
      {
        local_ui_url: 'http://192.168.1.11:24000/',
        is_active_session: false,
      },
    ]);
    expect(snapshot.suggested_remote_url).toBe('http://192.168.1.99:24000/');
    expect(snapshot.issue?.title).toBe('Unable to open that device');
  });

  it('turns blocked local-runtime reports into This Device recovery copy', () => {
    const issue = buildBlockedLaunchIssue({
      status: 'blocked',
      code: 'state_dir_locked',
      message: 'runtime lock is already held',
      lock_owner: {
        pid: 1234,
        local_ui_enabled: true,
      },
      diagnostics: {
        state_dir: '/Users/test/.redeven',
      },
    });

    expect(issue.scope).toBe('this_device');
    expect(issue.title).toBe('Redeven is already starting elsewhere');
    expect(issue.message).toContain('Desktop can attach to it');
    expect(issue.diagnostics_copy).toContain('lock owner pid: 1234');
    expect(issue.diagnostics_copy).toContain('state dir: /Users/test/.redeven');
  });
});
