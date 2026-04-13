import { describe, expect, it } from 'vitest';

import { normalizeDesktopControlPlaneProvider } from '../shared/controlPlaneProvider';
import {
  testDesktopPreferences,
  testManagedAccess,
  testManagedLocalEnvironment,
  testManagedSession,
} from '../testSupport/desktopTestHelpers';
import {
  buildBlockedLaunchIssue,
  buildDesktopWelcomeSnapshot,
  buildRemoteConnectionIssue,
  buildSSHConnectionIssue,
} from './desktopWelcomeState';
import {
  buildExternalLocalUIDesktopTarget,
  buildSSHDesktopTarget,
} from './desktopTarget';

const testProvider = normalizeDesktopControlPlaneProvider({
  protocol_version: 'rcpp-v1',
  provider_id: 'redeven_portal',
  display_name: 'Redeven Portal',
  provider_origin: 'https://cp.example.invalid',
  documentation_url: 'https://cp.example.invalid/docs/provider-protocol',
});

describe('desktopWelcomeState', () => {
  it('builds launcher snapshots around open windows and saved environments', () => {
    const managedLocal = testManagedLocalEnvironment('default', {
      access: testManagedAccess({
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'secret',
        local_ui_password_configured: true,
      }),
    });

    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedLocal],
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
        control_plane_refresh_tokens: {
          'https://cp.example.invalid|redeven_portal': 'refresh-123',
        },
        control_planes: testProvider ? [{
          provider: testProvider,
          account: {
            provider_id: testProvider.provider_id,
            provider_origin: testProvider.provider_origin,
            display_name: testProvider.display_name,
            user_public_id: 'user_demo',
            user_display_name: 'Demo User',
            authorization_expires_at_unix_ms: 1000,
          },
          environments: [{
            provider_id: testProvider.provider_id,
            provider_origin: testProvider.provider_origin,
            env_public_id: 'env_demo',
            label: 'Demo Environment',
            description: 'team sandbox',
            namespace_public_id: 'ns_demo',
            namespace_name: 'Demo Team',
            status: 'online',
            lifecycle_status: 'active',
            last_seen_at_unix_ms: 123,
          }],
          last_synced_at_ms: 500,
        }] : [],
      }),
      openSessions: [
        testManagedSession(managedLocal, 'http://localhost:23998/'),
        {
          session_key: 'url:http://192.168.1.12:24000/',
          target: buildExternalLocalUIDesktopTarget('http://192.168.1.12:24000/', { label: 'Staging' }),
          startup: {
            local_ui_url: 'http://192.168.1.12:24000/',
            local_ui_urls: ['http://192.168.1.12:24000/'],
          },
        },
      ],
      entryReason: 'switch_environment',
      issue: buildRemoteConnectionIssue(
        'http://192.168.1.99:24000/',
        'external_target_unreachable',
        'Desktop could not reach that Environment.',
      ),
    });

    expect(snapshot.surface).toBe('connect_environment');
    expect(snapshot.entry_reason).toBe('switch_environment');
    expect(snapshot.close_action_label).toBe('Close Launcher');
    expect(snapshot.open_windows).toEqual([
      expect.objectContaining({
        session_key: 'env:local%3Adefault:local_host',
        target_kind: 'managed_environment',
        environment_id: 'local:default',
        label: 'Local Environment',
        local_ui_url: 'http://localhost:23998/',
      }),
      expect.objectContaining({
        session_key: 'url:http://192.168.1.12:24000/',
        target_kind: 'external_local_ui',
        label: 'Staging',
        local_ui_url: 'http://192.168.1.12:24000/',
      }),
    ]);
    expect(snapshot.environments).toEqual([
      expect.objectContaining({
        id: 'local:default',
        kind: 'managed_environment',
        label: 'Local Environment',
        tag: 'Open',
        category: 'managed',
        is_open: true,
        open_action_label: 'Focus',
        can_edit: true,
        can_delete: false,
        can_save: false,
        managed_environment_kind: 'local',
        managed_environment_name: 'default',
        managed_local_ui_bind: '0.0.0.0:24000',
      }),
      expect.objectContaining({
        id: 'http://192.168.1.12:24000/',
        kind: 'external_local_ui',
        label: 'Staging',
        local_ui_url: 'http://192.168.1.12:24000/',
        tag: 'Open',
        category: 'saved',
        is_open: true,
        open_action_label: 'Focus',
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
        is_open: false,
        open_action_label: 'Open',
        can_edit: true,
        can_delete: true,
        can_save: true,
      }),
    ]);
    expect(snapshot.control_planes).toEqual([
      expect.objectContaining({
        provider: expect.objectContaining({
          provider_id: 'redeven_portal',
          provider_origin: 'https://cp.example.invalid',
        }),
        account: expect.objectContaining({
          user_public_id: 'user_demo',
        }),
      }),
    ]);
    expect(snapshot.suggested_remote_url).toBe('http://192.168.1.99:24000/');
    expect(snapshot.issue?.title).toBe('Unable to open that Environment');
    expect(snapshot.settings_surface.window_title).toBe('Local Environment Settings');
  });

  it('adds transient open remote environments when they are not yet saved', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      openSessions: [
        {
          session_key: 'url:http://192.168.1.77:24000/',
          target: buildExternalLocalUIDesktopTarget('http://192.168.1.77:24000/'),
          startup: {
            local_ui_url: 'http://192.168.1.77:24000/',
            local_ui_urls: ['http://192.168.1.77:24000/'],
          },
        },
      ],
    });

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'local:default', kind: 'managed_environment' }),
      expect.objectContaining({
        id: 'http://192.168.1.77:24000/',
        kind: 'external_local_ui',
        tag: 'Open',
        category: 'open_unsaved',
        is_open: true,
        can_edit: true,
        can_delete: false,
        can_save: true,
      }),
    ]));
    expect(snapshot.suggested_remote_url).toBe('http://192.168.1.77:24000/');
  });

  it('builds saved and open SSH environments without replacing them with forwarded localhost urls', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        saved_ssh_environments: [{
          id: 'ssh:devbox:2222:remote_default',
          label: 'SSH Lab',
          ssh_destination: 'devbox',
          ssh_port: 2222,
          remote_install_dir: 'remote_default',
          bootstrap_strategy: 'desktop_upload',
          release_base_url: 'https://mirror.example.invalid/releases',
          source: 'saved',
          last_used_at_ms: 100,
        }],
      }),
      openSessions: [
        {
          session_key: 'ssh:devbox:2222:remote_default',
          target: buildSSHDesktopTarget({
            ssh_destination: 'devbox',
            ssh_port: 2222,
            remote_install_dir: 'remote_default',
            bootstrap_strategy: 'desktop_upload',
            release_base_url: 'https://mirror.example.invalid/releases',
          }, {
            label: 'SSH Lab',
            forwardedLocalUIURL: 'http://127.0.0.1:40111/',
          }),
          startup: {
            local_ui_url: 'http://127.0.0.1:40111/',
            local_ui_urls: ['http://127.0.0.1:40111/'],
          },
        },
      ],
      issue: buildSSHConnectionIssue({
        ssh_destination: 'devbox',
        ssh_port: 2222,
        remote_install_dir: 'remote_default',
        bootstrap_strategy: 'desktop_upload',
        release_base_url: 'https://mirror.example.invalid/releases',
      }, 'ssh_target_unreachable', 'Desktop could not reach that SSH target.'),
    });

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'ssh:devbox:2222:remote_default',
        kind: 'ssh_environment',
        label: 'SSH Lab',
        secondary_text: 'devbox:2222',
        local_ui_url: 'http://127.0.0.1:40111/',
        tag: 'Open',
        category: 'saved',
        is_open: true,
      }),
    ]));
    expect(snapshot.suggested_remote_url).toBe('');
    expect(snapshot.issue?.ssh_details).toEqual({
      ssh_destination: 'devbox',
      ssh_port: 2222,
      remote_install_dir: 'remote_default',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: 'https://mirror.example.invalid/releases',
    });
  });

  it('builds a dedicated settings snapshot when requested by the desktop shell', () => {
    const managedLocal = testManagedLocalEnvironment('default', {
      access: {
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        local_ui_password_configured: false,
      },
    });

    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedLocal],
      }),
      surface: 'managed_environment_settings',
      selectedManagedEnvironmentID: managedLocal.id,
    });

    expect(snapshot.surface).toBe('managed_environment_settings');
    expect(snapshot.close_action_label).toBe('Quit');
    expect(snapshot.settings_surface.window_title).toBe('Local Environment Settings');
    expect(snapshot.settings_surface.save_label).toBe('Save Local Environment Settings');
    expect(snapshot.settings_surface.access_mode).toBe('local_only');
    expect(snapshot.settings_surface.summary_items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'visibility',
        value: 'Local only',
      }),
      expect.objectContaining({
        id: 'next_start_address',
        value: 'Auto-select on localhost',
      }),
    ]));
    expect(snapshot.settings_surface.draft).toEqual({
      local_ui_bind: '127.0.0.1:0',
      local_ui_password: '',
      local_ui_password_mode: 'replace',
    });
  });

  it('threads the current managed runtime url into the settings surface when Local Environment is open', () => {
    const managedLocal = testManagedLocalEnvironment('default', {
      access: {
        local_ui_bind: 'localhost:23998',
        local_ui_password: '',
        local_ui_password_configured: false,
      },
    });

    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedLocal],
      }),
      openSessions: [
        testManagedSession(managedLocal, 'http://localhost:23998/'),
      ],
      surface: 'managed_environment_settings',
      selectedManagedEnvironmentID: managedLocal.id,
    });

    expect(snapshot.settings_surface.current_runtime_url).toBe('http://localhost:23998/');
    expect(snapshot.settings_surface.next_start_address_display).toBe('localhost:23998');
  });

  it('turns blocked local-runtime reports into managed-environment recovery copy', () => {
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

    expect(issue.scope).toBe('managed_environment');
    expect(issue.title).toBe('Redeven is already starting elsewhere');
    expect(issue.message).toContain('Desktop can attach to it');
    expect(issue.diagnostics_copy).toContain('lock owner pid: 1234');
  });
});
