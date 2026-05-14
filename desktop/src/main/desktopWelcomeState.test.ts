import { describe, expect, it } from 'vitest';

import { normalizeDesktopControlPlaneProvider } from '../shared/controlPlaneProvider';
import {
  testDesktopPreferences,
  testLocalAccess,
  testProviderBoundLocalEnvironment,
  testLocalEnvironment,
  testProviderEnvironment,
  testLocalEnvironmentSession,
} from '../testSupport/desktopTestHelpers';
import {
  buildBlockedLaunchIssue,
  buildControlPlaneIssue,
  buildDesktopWelcomeSnapshot,
  buildRemoteConnectionIssue,
  buildSSHConnectionIssue,
} from './desktopWelcomeState';
import {
  buildProviderEnvironmentDesktopTarget,
  buildExternalLocalUIDesktopTarget,
  controlPlaneDesktopSessionKey,
  buildSSHDesktopTarget,
} from './desktopTarget';

const testProvider = normalizeDesktopControlPlaneProvider({
  protocol_version: 'rcpp-v1',
  provider_id: 'example_control_plane',
  display_name: 'Example Control Plane',
  provider_origin: 'https://cp.example.invalid',
  documentation_url: 'https://cp.example.invalid/docs/control-plane-providers',
});

function providerRuntimeState(envPublicID = 'env_demo') {
  return {
    controlplane_base_url: 'https://cp.example.invalid',
    controlplane_provider_id: 'example_control_plane',
    env_public_id: envPublicID,
  };
}

describe('desktopWelcomeState', () => {
  it('builds launcher snapshots around open windows and saved environments', () => {
    const local = testLocalEnvironment({
      access: testLocalAccess({
        local_ui_bind: '0.0.0.0:24000',
        local_ui_password: 'secret',
        local_ui_password_configured: true,
      }),
      currentRuntime: {
        local_ui_url: 'http://localhost:23998/',
        desktop_managed: true,
        effective_run_mode: 'desktop',
        runtime_service: {
          protocol_version: 'redeven-runtime-v1',
          service_owner: 'desktop',
          desktop_managed: true,
          effective_run_mode: 'desktop',
          remote_enabled: true,
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
        local_environment: local,
        saved_environments: [
          {
            id: 'http://192.168.1.12:24000/',
            label: 'Staging',
            local_ui_url: 'http://192.168.1.12:24000/',
            pinned: false,
            last_used_at_ms: 200,
          },
          {
            id: 'http://192.168.1.11:24000/',
            label: 'Laptop',
            local_ui_url: 'http://192.168.1.11:24000/',
            pinned: false,
            last_used_at_ms: 100,
          },
        ],
        control_plane_refresh_tokens: {
          'https://cp.example.invalid|example_control_plane': 'refresh-123',
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
          display_label: 'Demo Control Plane',
          last_synced_at_ms: 500,
        }] : [],
      }),
      openSessions: [
        testLocalEnvironmentSession(local, 'http://localhost:23998/'),
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
        session_key: 'env:local:local_host',
        target_kind: 'local_environment',
        environment_id: 'local',
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
    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'local',
        kind: 'local_environment',
        label: 'Local Environment',
        pinned: false,
        tag: 'Open',
        category: 'local',
        is_open: true,
        open_action_label: 'Focus',
        can_edit: true,
        can_delete: false,
        local_environment_kind: 'local',
        local_environment_ui_bind: '0.0.0.0:24000',
        local_environment_runtime_state: 'running_desktop',
        local_environment_runtime_url: 'http://localhost:23998/',
        local_environment_close_behavior: 'stops_runtime',
      }),
      expect.objectContaining({
        id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
        kind: 'provider_environment',
        label: 'Demo Environment',
        category: 'provider',
        is_open: false,
        provider_origin: 'https://cp.example.invalid',
        provider_id: 'example_control_plane',
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
      }),
      expect.objectContaining({
        id: 'http://192.168.1.11:24000/',
        kind: 'external_local_ui',
        label: 'Laptop',
        local_ui_url: 'http://192.168.1.11:24000/',
        pinned: false,
        tag: 'Saved',
        category: 'saved',
        is_open: false,
        open_action_label: 'Open',
        can_edit: true,
        can_delete: true,
      }),
    ]));
    expect(snapshot.control_planes).toEqual([
      expect.objectContaining({
        provider: expect.objectContaining({
          provider_id: 'example_control_plane',
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

  it('carries active launcher action progress in the welcome snapshot', () => {
    const local = testLocalEnvironment();
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
      }),
      actionProgress: [{
        action: 'start_environment_runtime',
        environment_id: 'ssh:devbox:default:key_agent:remote_default',
        environment_label: 'devbox',
        operation_key: 'ssh:devbox:default:key_agent:remote_default',
        started_at_unix_ms: 100,
        phase: 'ssh_remote_installing',
        title: 'Installing remote runtime',
        detail: 'Running the remote installer.',
      }],
    });

    expect(snapshot.action_progress).toEqual([{
      action: 'start_environment_runtime',
      environment_id: 'ssh:devbox:default:key_agent:remote_default',
      environment_label: 'devbox',
      operation_key: 'ssh:devbox:default:key_agent:remote_default',
      started_at_unix_ms: 100,
      phase: 'ssh_remote_installing',
      title: 'Installing remote runtime',
      detail: 'Running the remote installer.',
    }]);
  });

  it('keeps the single Local Environment protected', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment(),
      }),
    });

    expect(snapshot.environments.filter((environment) => environment.id === 'local')).toEqual([
      expect.objectContaining({
        id: 'local',
        label: 'Local Environment',
        can_delete: false,
      }),
    ]);
  });

  it('marks a discovered external local runtime as online before a Desktop session is open', () => {
    const local = testLocalEnvironment({
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
        local_environment: local,
      }),
    });

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'local',
        local_ui_url: 'http://127.0.0.1:24001/',
        local_environment_runtime_state: 'running_external',
        local_environment_runtime_url: 'http://127.0.0.1:24001/',
        local_environment_close_behavior: 'detaches',
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

  it('prefers an open saved URL session over a stale saved URL probe', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        saved_environments: [{
          id: 'http://192.168.1.20:24000/',
          label: 'Team Host',
          local_ui_url: 'http://192.168.1.20:24000/',
          pinned: false,
          last_used_at_ms: 200,
        }],
      }),
      openSessions: [
        {
          session_key: 'url:http://192.168.1.20:24000/',
          target: buildExternalLocalUIDesktopTarget('http://192.168.1.20:24000/', { label: 'Team Host' }),
          lifecycle: 'open',
          startup: {
            local_ui_url: 'http://192.168.1.20:24000/',
            local_ui_urls: ['http://192.168.1.20:24000/'],
            runtime_service: {
              runtime_version: 'v1.9.0',
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
      ],
      savedExternalRuntimeHealth: {
        'http://192.168.1.20:24000/': {
          status: 'offline',
          checked_at_unix_ms: 1000,
          source: 'external_local_ui_probe',
          offline_reason_code: 'external_unreachable',
          offline_reason: 'The runtime offline / unavailable',
        },
      },
    });

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'http://192.168.1.20:24000/',
        kind: 'external_local_ui',
        is_open: true,
        runtime_health: expect.objectContaining({
          status: 'online',
          source: 'external_local_ui_probe',
        }),
        runtime_service: expect.objectContaining({
          runtime_version: 'v1.9.0',
          open_readiness: { state: 'openable' },
        }),
      }),
    ]));
  });

  it('keeps unsaved open remote sessions out of the saved environment list', () => {
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

    expect(snapshot.open_windows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        session_key: 'url:http://192.168.1.77:24000/',
        target_kind: 'external_local_ui',
        environment_id: 'http://192.168.1.77:24000/',
      }),
    ]));
    expect(snapshot.environments).toEqual([
      expect.objectContaining({ id: 'local', kind: 'local_environment' }),
    ]);
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
      expect.objectContaining({ id: 'local', kind: 'local_environment' }),
    ]));
    expect(snapshot.environments.some((environment) => environment.id === 'http://192.168.1.88:24000/')).toBe(false);
  });

  it('builds saved and open SSH environments without replacing them with forwarded localhost urls', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        saved_ssh_environments: [{
          id: 'ssh:devbox:2222:key_agent:remote_default',
          label: 'SSH Lab',
          ssh_destination: 'devbox',
          ssh_port: 2222,
          auth_mode: 'key_agent',
          remote_install_dir: 'remote_default',
          bootstrap_strategy: 'desktop_upload',
          release_base_url: 'https://mirror.example.invalid/releases',
          connect_timeout_seconds: 10,
          pinned: true,
          last_used_at_ms: 100,
        }],
      }),
      openSessions: [
        {
          session_key: 'ssh:devbox:2222:key_agent:remote_default',
          target: buildSSHDesktopTarget({
            ssh_destination: 'devbox',
            ssh_port: 2222,
            auth_mode: 'key_agent',
            remote_install_dir: 'remote_default',
            bootstrap_strategy: 'desktop_upload',
            release_base_url: 'https://mirror.example.invalid/releases',
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
      }, 'ssh_target_unreachable', 'Desktop could not reach that SSH target.'),
    });

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'ssh:devbox:2222:key_agent:remote_default',
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
    });
  });

  it('preserves probed SSH runtime service metadata before a window is open', () => {
    const sshID = 'ssh:devbox:2222:key_agent:remote_default';
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
          connect_timeout_seconds: 10,
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

  it('preserves SSH runtime maintenance requirements before a window is open', () => {
    const sshID = 'ssh:devbox:2222:key_agent:remote_default';
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
          connect_timeout_seconds: 10,
          pinned: false,
          last_used_at_ms: 100,
        }],
      }),
      savedSSHRuntimeHealth: {
        [sshID]: {
          status: 'online',
          checked_at_unix_ms: 1000,
          source: 'ssh_runtime_probe',
          runtime_maintenance: {
            kind: 'desktop_model_source_requires_runtime_update',
            required_for: 'desktop_model_source',
            can_desktop_restart: true,
            has_active_work: true,
            active_work_label: '2 sessions',
            current_runtime_version: 'v0.5.9',
            target_runtime_version: 'v0.6.7',
            message: 'Update and restart this SSH runtime before Desktop can make your local model settings available here.',
          },
        },
      },
    });

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: sshID,
        kind: 'ssh_environment',
        runtime_health: expect.objectContaining({
          status: 'online',
          runtime_maintenance: expect.objectContaining({
            kind: 'desktop_model_source_requires_runtime_update',
            active_work_label: '2 sessions',
          }),
        }),
        runtime_maintenance: expect.objectContaining({
          kind: 'desktop_model_source_requires_runtime_update',
          target_runtime_version: 'v0.6.7',
        }),
      }),
    ]));
  });

  it('prefers an open SSH session over a stale saved SSH probe', () => {
    const sshID = 'ssh:devbox:2222:key_agent:remote_default';
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
          connect_timeout_seconds: 10,
          pinned: false,
          last_used_at_ms: 100,
        }],
      }),
      openSessions: [
        {
          session_key: sshID,
          target: buildSSHDesktopTarget({
            ssh_destination: 'devbox',
            ssh_port: 2222,
            auth_mode: 'key_agent',
            remote_install_dir: 'remote_default',
            bootstrap_strategy: 'desktop_upload',
            release_base_url: '',
          }, {
            label: 'SSH Lab',
            forwardedLocalUIURL: 'http://127.0.0.1:40111/',
          }),
          lifecycle: 'open',
          startup: {
            local_ui_url: 'http://127.0.0.1:40111/',
            local_ui_urls: ['http://127.0.0.1:40111/'],
            runtime_service: {
              runtime_version: 'v1.9.0',
              protocol_version: 'redeven-runtime-v1',
              service_owner: 'desktop',
              desktop_managed: true,
              remote_enabled: false,
              compatibility: 'compatible',
              open_readiness: { state: 'openable' },
              active_workload: {
                terminal_count: 1,
                session_count: 1,
                task_count: 0,
                port_forward_count: 0,
              },
            },
          },
        },
      ],
      savedSSHRuntimeHealth: {
        [sshID]: {
          status: 'offline',
          checked_at_unix_ms: 1000,
          source: 'ssh_runtime_probe',
          offline_reason_code: 'not_started',
          offline_reason: 'Serve the runtime first',
        },
      },
    });

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: sshID,
        kind: 'ssh_environment',
        is_open: true,
        runtime_health: expect.objectContaining({
          status: 'online',
          source: 'ssh_runtime_probe',
        }),
        runtime_service: expect.objectContaining({
          runtime_version: 'v1.9.0',
          open_readiness: { state: 'openable' },
        }),
      }),
    ]));
  });

  it('builds a dedicated settings snapshot when requested by the desktop shell', () => {
    const local = testLocalEnvironment({
      access: {
        local_ui_bind: '127.0.0.1:0',
        local_ui_password: '',
        local_ui_password_configured: false,
      },
    });

    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
      }),
      surface: 'environment_settings',
      selectedEnvironmentID: local.id,
    });

    expect(snapshot.surface).toBe('environment_settings');
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

  it('threads the current Local Environment runtime url into the settings surface when Local Environment is open', () => {
    const local = testLocalEnvironment({
      access: {
        local_ui_bind: 'localhost:23998',
        local_ui_password: '',
        local_ui_password_configured: false,
      },
    });

    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
      }),
      openSessions: [
        testLocalEnvironmentSession(local, 'http://localhost:23998/'),
      ],
      surface: 'environment_settings',
      selectedEnvironmentID: local.id,
    });

    expect(snapshot.settings_surface.current_runtime_url).toBe('http://localhost:23998/');
    expect(snapshot.settings_surface.next_start_address_display).toBe('localhost:23998');
  });

  it('keeps provider cards remote-only while summarizing linked managed runtimes', () => {
    const providerEnvironment = testProviderEnvironment('https://cp.example.invalid', 'env_demo');
    const managedControlPlane = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo');
    const local = testLocalEnvironment({
      access: testLocalAccess({
        local_ui_bind: 'localhost:23998',
      }),
      currentRuntime: {
        local_ui_url: 'http://localhost:23998/',
        desktop_managed: true,
        effective_run_mode: 'desktop',
        ...providerRuntimeState('env_demo'),
        runtime_service: {
          protocol_version: 'redeven-runtime-v1',
          service_owner: 'desktop',
          desktop_managed: true,
          effective_run_mode: 'desktop',
          remote_enabled: true,
          compatibility: 'compatible',
          open_readiness: { state: 'openable' },
          active_workload: {
            terminal_count: 0,
            session_count: 0,
            task_count: 0,
            port_forward_count: 0,
          },
          capabilities: {
            desktop_ai_broker: { supported: false },
            provider_link: {
              supported: true,
              bind_method: 'runtime_control_v1',
            },
          },
          bindings: {
            desktop_ai_broker: { state: 'unsupported' },
            provider_link: {
              state: 'linked',
              provider_origin: 'https://cp.example.invalid',
              provider_id: 'example_control_plane',
              env_public_id: 'env_demo',
              remote_enabled: true,
            },
          },
        },
      },
    });
    const remoteTarget = buildProviderEnvironmentDesktopTarget(providerEnvironment, { route: 'remote_desktop' });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
      }),
      openSessions: [
        testLocalEnvironmentSession(managedControlPlane, 'http://localhost:23998/', 'open', providerRuntimeState('env_demo')),
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
          provider_id: 'example_control_plane',
          display_name: 'Example Control Plane',
          provider_origin: 'https://cp.example.invalid',
          documentation_url: 'https://cp.example.invalid/docs/control-plane-providers',
        },
        account: {
          provider_id: 'example_control_plane',
          provider_origin: 'https://cp.example.invalid',
          display_name: 'Example Control Plane',
          user_public_id: 'user_demo',
          user_display_name: 'Demo User',
          authorization_expires_at_unix_ms: Date.now() + 60_000,
        },
        display_label: 'Demo Control Plane',
        environments: [{
          provider_id: 'example_control_plane',
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
      entry.kind === 'local_environment'
      && entry.local_environment_kind === 'controlplane'
    ))).toBeUndefined();
    const providerEntry = snapshot.environments.find((entry) => (
      entry.kind === 'provider_environment'
      && entry.id === providerEnvironment.id
    ));
    expect(providerEntry).toEqual(expect.objectContaining({
      id: providerEnvironment.id,
      kind: 'provider_environment',
      open_local_session_key: undefined,
      open_remote_session_key: remoteTarget.session_key,
      open_session_key: remoteTarget.session_key,
      local_ui_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
      provider_linked_runtime_summary: {
        runtime_target_id: 'local:local',
        runtime_kind: 'local_environment',
        label: 'Local Environment',
        provider_link_remote_enabled: true,
        runtime_remote_enabled: true,
      },
      runtime_health: expect.objectContaining({
        status: 'online',
        source: 'provider_batch_probe',
      }),
    }));
    expect(providerEntry?.local_environment_runtime_plan).toBeUndefined();
    expect(providerEntry?.provider_runtime_link_target).toBeUndefined();
    expect(providerEntry?.provider_environment_candidates).toBeUndefined();
  });

  it('threads Control Plane runtime state into provider environment library entries', () => {
    const providerEnvironment = testProviderEnvironment('https://cp.example.invalid', 'env_demo');
    const managedControlPlane = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo', {
      localHosting: false,
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: managedControlPlane,
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
          display_label: 'Demo Control Plane',
          last_synced_at_ms: 500,
        }] : [],
      }),
    });

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: providerEnvironment.id,
        provider_origin: 'https://cp.example.invalid',
        provider_id: 'example_control_plane',
        env_public_id: 'env_demo',
        control_plane_label: 'Demo Control Plane',
        provider_status: 'offline',
        provider_lifecycle_status: 'suspended',
        provider_last_seen_at_unix_ms: 456,
      }),
    ]));
  });

  it('projects normalized route state and sync freshness into control-plane-managed entries', () => {
    const freshSyncAt = Date.now();
    expect(testProvider).toBeTruthy();
    if (!testProvider) {
      throw new Error('Expected normalized test provider.');
    }
    const providerEnvironment = testProviderEnvironment('https://cp.example.invalid', 'env_demo');
    const managedControlPlane = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo');
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
        local_environment: managedControlPlane,
        control_planes: [{
          provider: testProvider,
          account: summaryAccount,
          environments: [summaryEnvironment],
          display_label: 'Demo Control Plane',
          last_synced_at_ms: freshSyncAt,
        }],
      }),
      controlPlanes: [{
        provider: testProvider,
        account: summaryAccount,
        environments: [summaryEnvironment],
        display_label: 'Demo Control Plane',
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
        id: providerEnvironment.id,
        kind: 'provider_environment',
        control_plane_sync_state: 'ready',
        remote_route_state: 'offline',
        remote_catalog_freshness: 'fresh',
        remote_state_reason: 'The provider currently reports this environment as offline.',
        open_local_session_key: undefined,
      }),
    ]));
    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'local',
        kind: 'local_environment',
        provider_runtime_link_target: expect.objectContaining({
          id: 'local:local',
          kind: 'local_environment',
          runtime_key: 'local',
        }),
        provider_environment_candidates: expect.arrayContaining([
          expect.objectContaining({
            provider_environment_id: providerEnvironment.id,
            route_state: 'offline',
          }),
        ]),
      }),
    ]));
    expect(snapshot.control_planes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sync_state: 'ready',
        catalog_freshness: 'fresh',
      }),
    ]));
  });

  it('describes provider-link targets on Local cards without exposing unbound runtimes through provider cards', () => {
    const providerEnvironment = testProviderEnvironment('https://cp.example.invalid', 'env_demo');
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment({
          currentRuntime: {
            local_ui_url: 'http://localhost:23998/',
            desktop_managed: true,
            effective_run_mode: 'desktop',
            runtime_service: {
              protocol_version: 'redeven-runtime-v1',
              service_owner: 'desktop',
              desktop_managed: true,
              effective_run_mode: 'desktop',
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
        }),
        provider_environments: [providerEnvironment],
      }),
    });

    const providerEntry = snapshot.environments.find((entry) => (
      entry.id === providerEnvironment.id && entry.kind === 'provider_environment'
    ));
    expect(providerEntry).toEqual(expect.objectContaining({
      id: providerEnvironment.id,
      kind: 'provider_environment',
      open_local_session_key: undefined,
      provider_linked_runtime_summary: undefined,
      local_ui_url: '',
    }));
    expect(providerEntry?.local_environment_runtime_plan).toBeUndefined();
    expect(providerEntry?.provider_runtime_link_target).toBeUndefined();
    expect(providerEntry?.provider_environment_candidates).toBeUndefined();

    expect(snapshot.environments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'local',
        kind: 'local_environment',
        local_environment_runtime_url: 'http://localhost:23998/',
        provider_runtime_link_target: expect.objectContaining({
          id: 'local:local',
          runtime_url: 'http://localhost:23998/',
          runtime_running: true,
          runtime_control_available: false,
          blocked_reason_code: 'runtime_control_missing',
        }),
        provider_environment_candidates: expect.arrayContaining([
          expect.objectContaining({
            provider_environment_id: providerEnvironment.id,
            provider_origin: 'https://cp.example.invalid',
            provider_id: 'example_control_plane',
            env_public_id: 'env_demo',
          }),
        ]),
      }),
    ]));
  });

  it('keeps local-only linked runtimes connectable from Local cards while Provider cards stay remote-only', () => {
    const providerEnvironment = testProviderEnvironment('https://cp.example.invalid', 'env_demo');
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment({
          currentRuntime: {
            local_ui_url: 'http://localhost:23998/',
            desktop_managed: true,
            effective_run_mode: 'desktop',
            ...providerRuntimeState('env_demo'),
            runtime_control: {
              protocol_version: 'redeven-runtime-control-v1',
              base_url: 'http://127.0.0.1:25000/',
              token: 'runtime-control-token',
              desktop_owner_id: 'desktop-owner-test',
            },
            runtime_service: {
              protocol_version: 'redeven-runtime-v1',
              service_owner: 'desktop',
              desktop_managed: true,
              effective_run_mode: 'desktop',
              remote_enabled: false,
              compatibility: 'compatible',
              open_readiness: { state: 'openable' },
              active_workload: {
                terminal_count: 0,
                session_count: 0,
                task_count: 0,
                port_forward_count: 0,
              },
              capabilities: {
                desktop_ai_broker: { supported: false },
                provider_link: {
                  supported: true,
                  bind_method: 'runtime_control_v1',
                },
              },
              bindings: {
                desktop_ai_broker: { state: 'unsupported' },
                provider_link: {
                  state: 'linked',
                  provider_origin: 'https://cp.example.invalid',
                  provider_id: 'example_control_plane',
                  env_public_id: 'env_demo',
                  remote_enabled: false,
                },
              },
            },
          },
        }),
        provider_environments: [providerEnvironment],
      }),
    });

    const providerEntry = snapshot.environments.find((entry) => (
      entry.id === providerEnvironment.id && entry.kind === 'provider_environment'
    ));
    expect(providerEntry?.provider_runtime_link_target).toBeUndefined();
    expect(providerEntry?.provider_environment_candidates).toBeUndefined();
    expect(providerEntry).toMatchObject({
      provider_linked_runtime_summary: {
        runtime_target_id: 'local:local',
        runtime_kind: 'local_environment',
        label: 'Local Environment',
        provider_link_remote_enabled: false,
        runtime_remote_enabled: false,
      },
    });

    const localEntry = snapshot.environments.find((entry) => entry.kind === 'local_environment');
    expect(localEntry?.provider_runtime_link_target).toMatchObject({
      id: 'local:local',
      provider_link_state: 'linked',
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'example_control_plane',
      env_public_id: 'env_demo',
      can_connect_provider: true,
      can_disconnect_provider: true,
    });
  });

  it('keeps dual-route entries visible when remote access is removed and marks their Local Environment state as controlplane', () => {
    const freshSyncAt = Date.now();
    expect(testProvider).toBeTruthy();
    if (!testProvider) {
      throw new Error('Expected normalized test provider.');
    }
    const providerEnvironment = testProviderEnvironment('https://cp.example.invalid', 'env_demo');
    const managedControlPlane = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo');
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
        local_environment: managedControlPlane,
        control_planes: [{
          provider: testProvider,
          account: summaryAccount,
          environments: [],
          display_label: 'Demo Control Plane',
          last_synced_at_ms: freshSyncAt,
        }],
      }),
      controlPlanes: [{
        provider: testProvider,
        account: summaryAccount,
        environments: [],
        display_label: 'Demo Control Plane',
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
      && entry.id === providerEnvironment.id
    ))).toEqual(expect.objectContaining({
      id: providerEnvironment.id,
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

    expect(issue.scope).toBe('local_environment');
    expect(issue.title).toBe('Redeven is already starting elsewhere');
    expect(issue.message).toContain('Desktop can attach to it');
    expect(issue.diagnostics_copy).toContain('lock owner pid: 1234');
  });

  it('turns startup validation reports into startup recovery copy', () => {
    const issue = buildBlockedLaunchIssue({
      status: 'blocked',
      code: 'startup_invalid',
      message: 'incomplete bootstrap flags for `redeven run`: missing flag one bootstrap ticket (--bootstrap-ticket or --bootstrap-ticket-env)',
      diagnostics: {
        state_dir: '/Users/test/.redeven/local-environment',
        config_path: '/Users/test/.redeven/local-environment/config.json',
        command: 'redeven run',
      },
    });

    expect(issue.scope).toBe('startup');
    expect(issue.title).toBe('Local Environment startup needs a setting');
    expect(issue.message).toContain('missing flag one bootstrap ticket');
    expect(issue.diagnostics_copy).toContain('config path: /Users/test/.redeven/local-environment/config.json');
    expect(issue.diagnostics_copy).toContain('command: redeven run');
  });

  it('adds provider diagnostics to control plane issues and maps titles by failure class', () => {
    const issue = buildControlPlaneIssue(
      'provider_tls_untrusted',
      'Desktop could not verify the provider certificate. Trust that certificate on this device, then try again.',
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
