import { describe, expect, it } from 'vitest';

import {
  buildBlockedLaunchIssue,
  buildDesktopWelcomeSnapshot,
  buildRemoteConnectionIssue,
} from './desktopWelcomeState';

describe('desktopWelcomeState', () => {
  it('builds Connect Environment snapshots around the active session and saved environments', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: {
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'secret',
        pending_bootstrap: null,
        saved_environments: [
          {
            id: 'http://192.168.1.12:24000/',
            label: 'Staging',
            local_ui_url: 'http://192.168.1.12:24000/',
            last_used_at_ms: 200,
          },
          {
            id: 'http://192.168.1.11:24000/',
            label: 'Laptop',
            local_ui_url: 'http://192.168.1.11:24000/',
            last_used_at_ms: 100,
          },
        ],
        recent_external_local_ui_urls: [
          'http://192.168.1.12:24000/',
          'http://192.168.1.11:24000/',
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
        'Desktop could not reach that Environment.',
      ),
    });

    expect(snapshot.surface).toBe('connect_environment');
    expect(snapshot.entry_reason).toBe('switch_device');
    expect(snapshot.current_session_target_kind).toBe('external_local_ui');
    expect(snapshot.current_session_local_ui_url).toBe('http://192.168.1.12:24000/');
    expect(snapshot.current_session_label).toBe('Another environment is open');
    expect(snapshot.close_action_label).toBe('Back to current environment');
    expect(snapshot.environments).toEqual([
      expect.objectContaining({
        id: 'this_device',
        kind: 'this_device',
        label: 'This Device',
        tag: 'This Device',
        can_edit: true,
        can_delete: false,
      }),
      expect.objectContaining({
        id: 'http://192.168.1.12:24000/',
        kind: 'external_local_ui',
        label: 'Staging',
        local_ui_url: 'http://192.168.1.12:24000/',
        tag: 'Current',
        is_current: true,
        can_edit: true,
        can_delete: true,
      }),
      expect.objectContaining({
        id: 'http://192.168.1.11:24000/',
        kind: 'external_local_ui',
        label: 'Laptop',
        local_ui_url: 'http://192.168.1.11:24000/',
        tag: 'Recent',
        is_current: false,
        can_edit: true,
        can_delete: true,
      }),
    ]);
    expect(snapshot.suggested_remote_url).toBe('http://192.168.1.99:24000/');
    expect(snapshot.issue?.title).toBe('Unable to open that Environment');
    expect(snapshot.settings_surface.window_title).toBe('This Device Options');
  });

  it('adds a transient current remote Environment when it is not yet saved', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: {
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        pending_bootstrap: null,
        saved_environments: [],
        recent_external_local_ui_urls: [],
      },
      externalStartup: {
        local_ui_url: 'http://192.168.1.77:24000/',
        local_ui_urls: ['http://192.168.1.77:24000/'],
      },
      activeSessionTarget: {
        kind: 'external_local_ui',
        external_local_ui_url: 'http://192.168.1.77:24000/',
      },
    });

    expect(snapshot.environments).toEqual([
      expect.objectContaining({ id: 'this_device', kind: 'this_device' }),
      expect.objectContaining({
        id: 'http://192.168.1.77:24000/',
        kind: 'external_local_ui',
        tag: 'Current',
        can_edit: true,
        can_delete: false,
      }),
    ]);
    expect(snapshot.suggested_remote_url).toBe('http://192.168.1.77:24000/');
  });

  it('builds a shared settings surface snapshot when requested by the desktop shell', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: {
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        pending_bootstrap: {
          controlplane_url: 'https://region.example.invalid',
          env_id: 'env_123',
          env_token: 'token-123',
        },
        saved_environments: [],
        recent_external_local_ui_urls: [],
      },
      surface: 'this_device_settings',
    });

    expect(snapshot.surface).toBe('this_device_settings');
    expect(snapshot.settings_surface.window_title).toBe('This Device Options');
    expect(snapshot.settings_surface.save_label).toBe('Save This Device Options');
    expect(snapshot.settings_surface.draft).toEqual({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: 'https://region.example.invalid',
      env_id: 'env_123',
      env_token: 'token-123',
    });
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
