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
            source: 'saved',
            last_used_at_ms: 200,
          },
          {
            id: 'http://192.168.1.11:24000/',
            label: 'Laptop',
            local_ui_url: 'http://192.168.1.11:24000/',
            source: 'recent_auto',
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
      entryReason: 'switch_environment',
      issue: buildRemoteConnectionIssue(
        'http://192.168.1.99:24000/',
        'external_target_unreachable',
        'Desktop could not reach that Environment.',
      ),
    });

    expect(snapshot.surface).toBe('connect_environment');
    expect(snapshot.entry_reason).toBe('switch_environment');
    expect(snapshot.current_session_target_kind).toBe('external_local_ui');
    expect(snapshot.current_session_local_ui_url).toBe('http://192.168.1.12:24000/');
    expect(snapshot.current_session_label).toBe('Another environment is open');
    expect(snapshot.close_action_label).toBe('Back to current environment');
    expect(snapshot.environments).toEqual([
      expect.objectContaining({
        id: 'local_environment',
        kind: 'local_environment',
        label: 'Local Environment',
        tag: 'Local',
        category: 'local_environment',
        can_edit: true,
        can_delete: false,
        can_save: false,
      }),
      expect.objectContaining({
        id: 'http://192.168.1.12:24000/',
        kind: 'external_local_ui',
        label: 'Staging',
        local_ui_url: 'http://192.168.1.12:24000/',
        tag: 'Current',
        category: 'saved',
        is_current: true,
        can_edit: true,
        can_delete: true,
        can_save: false,
      }),
      expect.objectContaining({
        id: 'http://192.168.1.11:24000/',
        kind: 'external_local_ui',
        label: 'Laptop',
        local_ui_url: 'http://192.168.1.11:24000/',
        tag: 'Recent',
        category: 'recent_auto',
        is_current: false,
        can_edit: true,
        can_delete: true,
        can_save: true,
      }),
    ]);
    expect(snapshot.suggested_remote_url).toBe('http://192.168.1.99:24000/');
    expect(snapshot.issue?.title).toBe('Unable to open that Environment');
    expect(snapshot.settings_surface.window_title).toBe('Local Environment Settings');
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
      expect.objectContaining({ id: 'local_environment', kind: 'local_environment' }),
      expect.objectContaining({
        id: 'http://192.168.1.77:24000/',
        kind: 'external_local_ui',
        tag: 'Current',
        category: 'current_unsaved',
        can_edit: true,
        can_delete: false,
        can_save: true,
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
      surface: 'local_environment_settings',
    });

    expect(snapshot.surface).toBe('local_environment_settings');
    expect(snapshot.settings_surface.window_title).toBe('Local Environment Settings');
    expect(snapshot.settings_surface.save_label).toBe('Save Local Environment Settings');
    expect(snapshot.settings_surface.access_mode).toBe('local_only');
    expect(snapshot.settings_surface.bootstrap_pending).toBe(true);
    expect(snapshot.settings_surface.summary_items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'access_mode',
        value: 'Local only',
      }),
      expect.objectContaining({
        id: 'next_start',
        value: 'Registration queued for next start',
        tone: 'primary',
      }),
    ]));
    expect(snapshot.settings_surface.draft).toEqual({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      controlplane_url: 'https://region.example.invalid',
      env_id: 'env_123',
      env_token: 'token-123',
    });
  });

  it('turns blocked local-runtime reports into Local Environment recovery copy', () => {
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

    expect(issue.scope).toBe('local_environment');
    expect(issue.title).toBe('Redeven is already starting elsewhere');
    expect(issue.message).toContain('Desktop can attach to it');
    expect(issue.diagnostics_copy).toContain('lock owner pid: 1234');
    expect(issue.diagnostics_copy).toContain('state dir: /Users/test/.redeven');
  });
});
