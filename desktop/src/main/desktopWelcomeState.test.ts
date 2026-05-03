import { describe, expect, it } from 'vitest';

import { normalizeDesktopControlPlaneProvider } from '../shared/controlPlaneProvider';
import {
  testDesktopPreferences,
  testManagedAccess,
  testManagedControlPlaneEnvironment,
  testManagedLocalEnvironment,
  testManagedSession,
} from '../testSupport/desktopTestHelpers';
import {
  buildBlockedLaunchIssue,
  buildControlPlaneIssue,
  buildDesktopWelcomeSnapshot,
  buildRemoteConnectionIssue,
  buildSSHConnectionIssue,
} from './desktopWelcomeState';
import { upsertSavedControlPlane } from './desktopPreferences';
import { controlPlaneProviderKeyForOrigin } from './statePaths';
import {
  buildManagedEnvironmentDesktopTarget,
  buildExternalLocalUIDesktopTarget,
  controlPlaneDesktopSessionKey,
  buildSSHDesktopTarget,
} from './desktopTarget';

const testProvider = normalizeDesktopControlPlaneProvider({
  protocol_version: 'rcpp-v1',
  provider_id: 'redeven_portal',
  display_name: 'Redeven Portal',
  provider_origin: 'https://cp.example.invalid',
  documentation_url: 'https://cp.example.invalid/docs/control-plane-providers',
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
            pinned: false,
            last_used_at_ms: 200,
          },
          {
            id: 'http://192.168.1.11:24000/',
            label: 'Laptop',
            local_ui_url: 'http://192.168.1.11:24000/',
            source: 'recent_auto',
            pinned: false,
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
          display_label: 'Demo Portal',
          last_synced_at_ms: 500,
        }] : [],
      }),
      openSessions: [
        testManagedSession(managedLocal, 'http://localhost:23998/'),
        {
          session_key: 'url:http://192.168.1.12:24000/',
          target: buildExternalLocalUIDesktopTarget('http://192.168.1.12:24000/', { label: 'Staging' }),
          lifecycle: 'open',
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
    expect(snapshot.action_progress).toEqual([]);
    expect(snapshot.open_windows).toEqual([
      expect.objectContaining({
        session_key: 'env:local%3Adefault:local_host',
        target_kind: 'managed_environment',
        environment_id: 'local:default',
        label: 'Local Default Environment',
        local_ui_url: 'http://localhost:23998/',
      }),
      expect.objectContaining({
        session_key: 'url:http://192.168.1.12:24000/',
        target_kind: 'external_local_ui',
        label: 'Staging',
        local_ui_url: 'http://192.168.1.12:24000/',
      }),
    ]);
    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'local:default',
        kind: 'managed_environment',
        label: 'Local Default Environment',
        pinned: false,
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
        managed_local_runtime_state: 'running_desktop',
        managed_local_runtime_url: 'http://localhost:23998/',
        managed_local_close_behavior: 'stops_runtime',
      }),
      expect.objectContaining({
        id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
        kind: 'provider_environment',
        label: 'Demo Environment',
        category: 'provider',
        is_open: false,
        provider_origin: 'https://cp.example.invalid',
        provider_id: 'redeven_portal',
        env_public_id: 'env_demo',
      }),
      expect.objectContaining({
        id: 'http://192.168.1.12:24000/',
        kind: 'external_local_ui',
        label: 'Staging',
        local_ui_url: 'http://192.168.1.12:24000/',
        pinned: false,
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
        pinned: false,
        tag: 'Recent',
        category: 'recent_auto',
        is_open: false,
        open_action_label: 'Open',
        can_edit: true,
        can_delete: true,
        can_save: true,
      }),
    ]));
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
    expect(snapshot.settings_surface.window_title).toBe('Local Default Environment Settings');
  });

  it('carries active launcher action progress in the welcome snapshot', () => {
    const managedLocal = testManagedLocalEnvironment('default');
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedLocal],
      }),
      actionProgress: [{
        action: 'start_environment_runtime',
        environment_id: 'ssh:devbox:default:key_agent:remote_default:envinst_demo',
        environment_label: 'devbox',
        operation_key: 'ssh:devbox:default:key_agent:remote_default:envinst_demo',
        started_at_unix_ms: 100,
        phase: 'ssh_remote_installing',
        title: 'Installing remote runtime',
        detail: 'Running the remote installer.',
      }],
    });

    expect(snapshot.action_progress).toEqual([{
      action: 'start_environment_runtime',
      environment_id: 'ssh:devbox:default:key_agent:remote_default:envinst_demo',
      environment_label: 'devbox',
      operation_key: 'ssh:devbox:default:key_agent:remote_default:envinst_demo',
      started_at_unix_ms: 100,
      phase: 'ssh_remote_installing',
      title: 'Installing remote runtime',
      detail: 'Running the remote installer.',
    }]);
  });

  it('keeps the default local environment protected while leaving other local environments deletable', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [
          testManagedLocalEnvironment('default'),
          testManagedLocalEnvironment('lab', { label: 'Lab' }),
        ],
      }),
    });

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'local:default',
        can_delete: false,
      }),
      expect.objectContaining({
        id: 'local:lab',
        can_delete: true,
      }),
    ]));
  });

  it('marks a discovered external local runtime as online before a Desktop session is open', () => {
    const managedLocal = testManagedLocalEnvironment('default', {
      currentRuntime: {
        local_ui_url: 'http://127.0.0.1:24001/',
        desktop_managed: false,
        effective_run_mode: 'local',
        runtime_service: {
          protocol_version: 'redeven-runtime-v1',
          service_owner: 'external',
          desktop_managed: false,
          effective_run_mode: 'local',
          remote_enabled: false,
          compatibility: 'compatible',
          open_readiness: { state: 'openable' },
          active_workload: {
            terminal_count: 0,
            session_count: 0,
            task_count: 0,
            port_forward_count: 0,
          },
        },
      },
    });

    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedLocal],
      }),
    });

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'local:default',
        local_ui_url: 'http://127.0.0.1:24001/',
        managed_local_runtime_state: 'running_external',
        managed_local_runtime_url: 'http://127.0.0.1:24001/',
        managed_local_close_behavior: 'detaches',
        window_state: 'closed',
        open_action_label: 'Open',
        runtime_control_capability: 'start_stop',
        runtime_health: expect.objectContaining({
          status: 'online',
          runtime_service: expect.objectContaining({
            open_readiness: { state: 'openable' },
          }),
        }),
        runtime_service: expect.objectContaining({
          open_readiness: { state: 'openable' },
        }),
      }),
    ]));
  });

  it('preserves probed saved URL runtime service metadata before a window is open', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        saved_environments: [{
          id: 'http://192.168.1.20:24000/',
          label: 'Team Host',
          local_ui_url: 'http://192.168.1.20:24000/',
          source: 'saved',
          pinned: false,
          last_used_at_ms: 200,
        }],
      }),
      savedExternalRuntimeHealth: {
        'http://192.168.1.20:24000/': {
          status: 'online',
          checked_at_unix_ms: 1000,
          source: 'external_local_ui_probe',
          local_ui_url: 'http://192.168.1.20:24000/',
          runtime_service: {
            runtime_version: 'v1.7.0',
            protocol_version: 'redeven-runtime-v1',
            service_owner: 'external',
            desktop_managed: false,
            remote_enabled: true,
            compatibility: 'compatible',
            open_readiness: { state: 'openable' },
            active_workload: {
              terminal_count: 0,
              session_count: 1,
              task_count: 0,
              port_forward_count: 0,
            },
          },
        },
      },
    });

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'http://192.168.1.20:24000/',
        kind: 'external_local_ui',
        is_open: false,
        runtime_service: expect.objectContaining({
          runtime_version: 'v1.7.0',
          service_owner: 'external',
          open_readiness: { state: 'openable' },
        }),
      }),
    ]));
  });

  it('adds transient open remote environments when they are not yet saved', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      openSessions: [
        {
          session_key: 'url:http://192.168.1.77:24000/',
          target: buildExternalLocalUIDesktopTarget('http://192.168.1.77:24000/'),
          lifecycle: 'open',
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

  it('keeps opening sessions out of Focus state until the first load completes', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      openSessions: [
        {
          session_key: 'url:http://192.168.1.88:24000/',
          target: buildExternalLocalUIDesktopTarget('http://192.168.1.88:24000/', { label: 'Preview' }),
          lifecycle: 'opening',
          startup: {
            local_ui_url: 'http://192.168.1.88:24000/',
            local_ui_urls: ['http://192.168.1.88:24000/'],
          },
        },
      ],
    });

    expect(snapshot.open_windows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        session_key: 'url:http://192.168.1.88:24000/',
      }),
    ]));
    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'http://192.168.1.88:24000/',
        is_open: false,
        is_opening: true,
        open_action_label: 'Opening…',
      }),
    ]));
  });

  it('builds saved and open SSH environments without replacing them with forwarded localhost urls', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        saved_ssh_environments: [{
          id: 'ssh:devbox:2222:key_agent:remote_default:envinst_demo001',
          label: 'SSH Lab',
          ssh_destination: 'devbox',
          ssh_port: 2222,
          auth_mode: 'key_agent',
          remote_install_dir: 'remote_default',
          bootstrap_strategy: 'desktop_upload',
          release_base_url: 'https://mirror.example.invalid/releases',
          environment_instance_id: 'envinst_demo001',
          source: 'saved',
          pinned: true,
          last_used_at_ms: 100,
        }],
      }),
      openSessions: [
        {
          session_key: 'ssh:devbox:2222:key_agent:remote_default:envinst_demo001',
          target: buildSSHDesktopTarget({
            ssh_destination: 'devbox',
            ssh_port: 2222,
            auth_mode: 'key_agent',
            remote_install_dir: 'remote_default',
            bootstrap_strategy: 'desktop_upload',
            release_base_url: 'https://mirror.example.invalid/releases',
            environment_instance_id: 'envinst_demo001',
          }, {
            label: 'SSH Lab',
            forwardedLocalUIURL: 'http://127.0.0.1:40111/',
          }),
          lifecycle: 'open',
          startup: {
            local_ui_url: 'http://127.0.0.1:40111/',
            local_ui_urls: ['http://127.0.0.1:40111/'],
          },
        },
      ],
      issue: buildSSHConnectionIssue({
        ssh_destination: 'devbox',
        ssh_port: 2222,
        auth_mode: 'key_agent',
        remote_install_dir: 'remote_default',
        bootstrap_strategy: 'desktop_upload',
        release_base_url: 'https://mirror.example.invalid/releases',
        environment_instance_id: 'envinst_demo001',
      }, 'ssh_target_unreachable', 'Desktop could not reach that SSH target.'),
    });

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'ssh:devbox:2222:key_agent:remote_default:envinst_demo001',
        kind: 'ssh_environment',
        label: 'SSH Lab',
        secondary_text: 'devbox:2222',
        local_ui_url: 'http://127.0.0.1:40111/',
        pinned: true,
        tag: 'Open',
        category: 'saved',
        is_open: true,
      }),
    ]));
    expect(snapshot.suggested_remote_url).toBe('');
    expect(snapshot.issue?.ssh_details).toEqual({
      ssh_destination: 'devbox',
      ssh_port: 2222,
      auth_mode: 'key_agent',
      remote_install_dir: 'remote_default',
      bootstrap_strategy: 'desktop_upload',
      release_base_url: 'https://mirror.example.invalid/releases',
      environment_instance_id: 'envinst_demo001',
    });
  });

  it('preserves probed SSH runtime service metadata before a window is open', () => {
    const sshID = 'ssh:devbox:2222:key_agent:remote_default:envinst_demo001';
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        saved_ssh_environments: [{
          id: sshID,
          label: 'SSH Lab',
          ssh_destination: 'devbox',
          ssh_port: 2222,
          auth_mode: 'key_agent',
          remote_install_dir: 'remote_default',
          bootstrap_strategy: 'desktop_upload',
          release_base_url: '',
          environment_instance_id: 'envinst_demo001',
          source: 'saved',
          pinned: false,
          last_used_at_ms: 100,
        }],
      }),
      savedSSHRuntimeHealth: {
        [sshID]: {
          status: 'online',
          checked_at_unix_ms: 1000,
          source: 'ssh_runtime_probe',
          local_ui_url: 'http://127.0.0.1:40111/',
          runtime_service: {
            runtime_version: 'v1.8.0',
            protocol_version: 'redeven-runtime-v1',
            service_owner: 'desktop',
            desktop_managed: true,
            remote_enabled: false,
            compatibility: 'compatible',
            open_readiness: { state: 'openable' },
            active_workload: {
              terminal_count: 1,
              session_count: 0,
              task_count: 0,
              port_forward_count: 0,
            },
          },
        },
      },
    });

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: sshID,
        kind: 'ssh_environment',
        is_open: false,
        runtime_service: expect.objectContaining({
          runtime_version: 'v1.8.0',
          service_owner: 'desktop',
          open_readiness: { state: 'openable' },
        }),
      }),
    ]));
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
      surface: 'environment_settings',
      selectedEnvironmentID: managedLocal.id,
    });

    expect(snapshot.surface).toBe('environment_settings');
    expect(snapshot.close_action_label).toBe('Quit');
    expect(snapshot.settings_surface.window_title).toBe('Local Default Environment Settings');
    expect(snapshot.settings_surface.save_label).toBe('Save Local Default Environment Settings');
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
      surface: 'environment_settings',
      selectedEnvironmentID: managedLocal.id,
    });

    expect(snapshot.settings_surface.current_runtime_url).toBe('http://localhost:23998/');
    expect(snapshot.settings_surface.next_start_address_display).toBe('localhost:23998');
  });

  it('projects provider local-serve state onto the aggregated provider card', () => {
    const managedControlPlane = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo');
    const localTarget = buildManagedEnvironmentDesktopTarget(managedControlPlane, { route: 'local_host' });
    const remoteTarget = buildManagedEnvironmentDesktopTarget(managedControlPlane, { route: 'remote_desktop' });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedControlPlane],
      }),
      openSessions: [
        {
          session_key: localTarget.session_key,
          target: localTarget,
          lifecycle: 'open',
          entry_url: 'http://localhost:23998/',
          startup: {
            local_ui_url: 'http://localhost:23998/',
            local_ui_urls: ['http://localhost:23998/'],
          },
        },
        {
          session_key: controlPlaneDesktopSessionKey('https://cp.example.invalid', 'env_demo'),
          target: remoteTarget,
          lifecycle: 'open',
          entry_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
          startup: {
            local_ui_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
            local_ui_urls: ['https://env.example.invalid/_redeven_boot/#redeven=abc'],
            effective_run_mode: 'remote_desktop',
          },
        },
      ],
      controlPlanes: [{
        provider: {
          protocol_version: 'rcpp-v1',
          provider_id: 'redeven_portal',
          display_name: 'Redeven Portal',
          provider_origin: 'https://cp.example.invalid',
          documentation_url: 'https://cp.example.invalid/docs/control-plane-providers',
        },
        account: {
          provider_id: 'redeven_portal',
          provider_origin: 'https://cp.example.invalid',
          display_name: 'Redeven Portal',
          user_public_id: 'user_demo',
          user_display_name: 'Demo User',
          authorization_expires_at_unix_ms: Date.now() + 60_000,
        },
        display_label: 'Demo Portal',
        environments: [{
          provider_id: 'redeven_portal',
          provider_origin: 'https://cp.example.invalid',
          env_public_id: 'env_demo',
          label: 'Demo Environment',
          environment_url: 'https://cp.example.invalid/env/env_demo',
          description: 'team sandbox',
          namespace_public_id: 'ns_demo',
          namespace_name: 'Demo Team',
          status: 'online',
          lifecycle_status: 'active',
          last_seen_at_unix_ms: 456,
          runtime_health: {
            env_public_id: 'env_demo',
            runtime_status: 'online',
            observed_at_unix_ms: 456,
            last_seen_at_unix_ms: 456,
            offline_reason_code: '',
            offline_reason: '',
          },
        }],
        last_synced_at_ms: Date.now(),
        sync_state: 'ready',
        last_sync_attempt_at_ms: Date.now(),
        last_sync_error_code: '',
        last_sync_error_message: '',
        catalog_freshness: 'fresh',
      }],
    });

    expect(snapshot.environments.find((entry) => (
      entry.kind === 'managed_environment'
      && entry.managed_environment_kind === 'controlplane'
      && entry.id === managedControlPlane.id
    ))).toBeUndefined();
    expect(snapshot.environments.find((entry) => (
      entry.kind === 'provider_environment'
      && entry.id === managedControlPlane.id
    ))).toEqual(expect.objectContaining({
      id: managedControlPlane.id,
      kind: 'provider_environment',
      open_local_session_key: localTarget.session_key,
      open_remote_session_key: remoteTarget.session_key,
      open_session_key: localTarget.session_key,
      local_ui_url: 'http://localhost:23998/',
      provider_effective_window_route: 'local_host',
      provider_local_runtime_configured: true,
      provider_local_runtime_state: 'running_desktop',
      provider_local_runtime_url: 'http://localhost:23998/',
      runtime_health: expect.objectContaining({
        status: 'online',
        source: 'local_runtime_probe',
      }),
    }));
  });

  it('threads Control Plane runtime state into managed environment library entries', () => {
    const managedControlPlane = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      localHosting: false,
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedControlPlane],
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
            status: 'offline',
            lifecycle_status: 'suspended',
            last_seen_at_unix_ms: 456,
          }],
          display_label: 'Demo Portal',
          last_synced_at_ms: 500,
        }] : [],
      }),
    });

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: managedControlPlane.id,
        provider_origin: 'https://cp.example.invalid',
        provider_id: 'redeven_portal',
        env_public_id: 'env_demo',
        control_plane_label: 'Demo Portal',
        provider_status: 'offline',
        provider_lifecycle_status: 'suspended',
        provider_last_seen_at_unix_ms: 456,
      }),
    ]));
  });

  it('keeps a repaired legacy dual-route environment on one provider card after control-plane connect', () => {
    expect(testProvider).toBeTruthy();
    if (!testProvider) {
      throw new Error('Expected normalized test provider.');
    }

    const legacyEnvironment = testManagedControlPlaneEnvironment(testProvider.provider_origin, 'env_demo', {
      providerID: controlPlaneProviderKeyForOrigin(testProvider.provider_origin),
      label: 'Desktop Label',
      preferredOpenRoute: 'local_host',
    });
    const preferences = upsertSavedControlPlane(testDesktopPreferences({
      managed_environments: [legacyEnvironment],
    }), {
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
        last_seen_at_unix_ms: 456,
      }],
      refresh_token: 'refresh-123',
      display_label: 'Demo Portal',
      last_synced_at_ms: 500,
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences,
    });

    const providerEntry = snapshot.environments.find((entry) => (
      entry.kind === 'provider_environment'
      && entry.provider_origin === testProvider.provider_origin
      && entry.env_public_id === 'env_demo'
    ));

    expect(snapshot.environments.find((entry) => (
      entry.kind === 'managed_environment'
      && entry.provider_origin === testProvider.provider_origin
      && entry.env_public_id === 'env_demo'
    ))).toBeUndefined();
    expect(providerEntry).toEqual(expect.objectContaining({
      id: legacyEnvironment.id,
      label: 'Demo Environment',
      provider_id: testProvider.provider_id,
      category: 'provider',
      provider_local_runtime_configured: true,
      provider_local_runtime_state: 'not_running',
      can_edit: true,
      can_delete: true,
    }));
  });

  it('projects normalized route state and sync freshness into control-plane-managed entries', () => {
    const freshSyncAt = Date.now();
    expect(testProvider).toBeTruthy();
    if (!testProvider) {
      throw new Error('Expected normalized test provider.');
    }
    const managedControlPlane = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo');
    const summaryAccount = {
      provider_id: testProvider.provider_id,
      provider_origin: testProvider.provider_origin,
      display_name: testProvider.display_name,
      user_public_id: 'user_demo',
      user_display_name: 'Demo User',
      authorization_expires_at_unix_ms: freshSyncAt + 60_000,
    };
    const summaryEnvironment = {
      provider_id: testProvider.provider_id,
      provider_origin: testProvider.provider_origin,
      env_public_id: 'env_demo',
      label: 'Demo Environment',
      description: 'team sandbox',
      namespace_public_id: 'ns_demo',
      namespace_name: 'Demo Team',
      status: 'offline',
      lifecycle_status: 'suspended',
      last_seen_at_unix_ms: 456,
    };

    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedControlPlane],
        control_planes: [{
          provider: testProvider,
          account: summaryAccount,
          environments: [summaryEnvironment],
          display_label: 'Demo Portal',
          last_synced_at_ms: freshSyncAt,
        }],
      }),
      controlPlanes: [{
        provider: testProvider,
        account: summaryAccount,
        environments: [summaryEnvironment],
        display_label: 'Demo Portal',
        last_synced_at_ms: freshSyncAt,
        sync_state: 'ready',
        last_sync_attempt_at_ms: freshSyncAt,
        last_sync_error_code: '',
        last_sync_error_message: '',
        catalog_freshness: 'fresh',
      }],
    });

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: managedControlPlane.id,
        kind: 'provider_environment',
        control_plane_sync_state: 'ready',
        provider_local_runtime_configured: true,
        provider_local_runtime_state: 'not_running',
        remote_route_state: 'offline',
        remote_catalog_freshness: 'fresh',
        remote_state_reason: 'The provider currently reports this environment as offline.',
      }),
    ]));
    expect(snapshot.control_planes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sync_state: 'ready',
        catalog_freshness: 'fresh',
      }),
    ]));
  });

  it('keeps dual-route entries visible when remote access is removed and marks their local scope as controlplane', () => {
    const freshSyncAt = Date.now();
    expect(testProvider).toBeTruthy();
    if (!testProvider) {
      throw new Error('Expected normalized test provider.');
    }
    const managedControlPlane = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo');
    const summaryAccount = {
      provider_id: testProvider.provider_id,
      provider_origin: testProvider.provider_origin,
      display_name: testProvider.display_name,
      user_public_id: 'user_demo',
      user_display_name: 'Demo User',
      authorization_expires_at_unix_ms: freshSyncAt + 60_000,
    };

    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedControlPlane],
        control_planes: [{
          provider: testProvider,
          account: summaryAccount,
          environments: [],
          display_label: 'Demo Portal',
          last_synced_at_ms: freshSyncAt,
        }],
      }),
      controlPlanes: [{
        provider: testProvider,
        account: summaryAccount,
        environments: [],
        display_label: 'Demo Portal',
        last_synced_at_ms: freshSyncAt,
        sync_state: 'ready',
        last_sync_attempt_at_ms: freshSyncAt,
        last_sync_error_code: '',
        last_sync_error_message: '',
        catalog_freshness: 'fresh',
      }],
    });

    expect(snapshot.environments.find((entry) => (
      entry.kind === 'provider_environment'
      && entry.id === managedControlPlane.id
    ))).toEqual(expect.objectContaining({
      id: managedControlPlane.id,
      provider_local_runtime_configured: true,
      provider_local_runtime_state: 'not_running',
      remote_route_state: 'removed',
      remote_state_reason: 'This environment is no longer published by the provider.',
    }));
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

  it('adds provider diagnostics to control plane issues and maps titles by failure class', () => {
    const issue = buildControlPlaneIssue(
      'provider_tls_untrusted',
      'Desktop could not verify the provider certificate. Trust that certificate on this machine, then try again.',
      {
        providerOrigin: 'https://dev.redeven.test',
        status: 502,
      },
    );

    expect(issue.title).toBe('Trust the provider certificate');
    expect(issue.diagnostics_copy).toContain('provider origin: https://dev.redeven.test');
    expect(issue.diagnostics_copy).toContain('http status: 502');
  });
});
