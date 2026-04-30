import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import {
  buildExternalLocalUIDesktopTarget,
  buildManagedEnvironmentDesktopTarget,
  buildSSHDesktopTarget,
} from '../main/desktopTarget';
import {
  desktopControlPlaneKey,
  type DesktopControlPlaneSummary,
  type DesktopProviderEnvironmentRuntimeHealth,
} from '../shared/controlPlaneProvider';
import {
  testDesktopPreferences,
  testManagedControlPlaneEnvironment,
  testManagedLocalEnvironment,
  testManagedSession,
} from '../testSupport/desktopTestHelpers';
import {
  buildEnvironmentLibraryLayoutModel,
  buildEnvironmentCardModel,
  buildEnvironmentCardEndpointsModel,
  buildEnvironmentCardFactsModel,
  buildProviderBackedEnvironmentActionModel,
  environmentLibraryCount,
  filterEnvironmentLibrary,
  LOCAL_ENVIRONMENT_LIBRARY_FILTER,
  PROVIDER_ENVIRONMENT_LIBRARY_FILTER,
  SSH_ENVIRONMENT_LIBRARY_FILTER,
  URL_ENVIRONMENT_LIBRARY_FILTER,
  splitPinnedEnvironmentEntries,
} from './viewModel';

function defaultFact(label: string, value: string) {
  return {
    label,
    value,
    value_tone: 'default' as const,
  };
}

function placeholderFact(label: string, value = 'None') {
  return {
    label,
    value,
    value_tone: 'placeholder' as const,
  };
}

function buildProvider(providerOrigin = 'https://cp.example.invalid') {
  return {
    protocol_version: 'rcpp-v1' as const,
    provider_id: 'redeven_portal',
    display_name: 'Redeven Portal',
    provider_origin: providerOrigin,
    documentation_url: `${providerOrigin}/docs/control-plane-providers`,
  };
}

function buildProviderRuntimeHealth(options: Readonly<{
  envPublicID: string;
  runtimeStatus: DesktopProviderEnvironmentRuntimeHealth['runtime_status'];
  observedAtUnixMS: number;
}>): DesktopProviderEnvironmentRuntimeHealth {
  return {
    env_public_id: options.envPublicID,
    runtime_status: options.runtimeStatus,
    observed_at_unix_ms: options.observedAtUnixMS,
    last_seen_at_unix_ms: options.observedAtUnixMS,
    offline_reason_code: options.runtimeStatus === 'offline' ? 'provider_reported_offline' : '',
    offline_reason: options.runtimeStatus === 'offline' ? 'Provider reported the runtime offline.' : '',
  };
}

function buildControlPlaneSummary(options: Readonly<{
  providerOrigin?: string;
  displayLabel?: string;
  status?: string;
  lifecycleStatus?: string;
  envPublicID?: string;
  environmentURL?: string;
  syncState?: 'idle' | 'syncing' | 'ready' | 'auth_required' | 'provider_unreachable' | 'provider_invalid' | 'sync_error';
  catalogFreshness?: 'unknown' | 'fresh' | 'stale';
}>): DesktopControlPlaneSummary {
  const provider = buildProvider(options.providerOrigin);
  const now = Date.now();
  const envPublicID = options.envPublicID ?? 'env_demo';
  const status = options.status ?? 'online';
  const lifecycleStatus = options.lifecycleStatus ?? 'active';
  const runtimeStatus: DesktopProviderEnvironmentRuntimeHealth['runtime_status'] = (
    status === 'offline' || lifecycleStatus === 'suspended'
  )
    ? 'offline'
    : 'online';
  return {
    provider,
    account: {
      provider_id: provider.provider_id,
      provider_origin: provider.provider_origin,
      display_name: provider.display_name,
      user_public_id: 'user_demo',
      user_display_name: 'Demo User',
      authorization_expires_at_unix_ms: now + 60_000,
    },
    display_label: options.displayLabel ?? 'Demo Portal',
    environments: [{
      provider_id: provider.provider_id,
      provider_origin: provider.provider_origin,
      env_public_id: envPublicID,
      label: 'Demo Environment',
      environment_url: options.environmentURL ?? `${provider.provider_origin}/env/${envPublicID}`,
      description: 'team sandbox',
      namespace_public_id: 'ns_demo',
      namespace_name: 'Demo Team',
      status,
      lifecycle_status: lifecycleStatus,
      last_seen_at_unix_ms: now,
      runtime_health: buildProviderRuntimeHealth({
        envPublicID,
        runtimeStatus,
        observedAtUnixMS: now,
      }),
    }],
    last_synced_at_ms: now,
    sync_state: options.syncState ?? 'ready',
    last_sync_attempt_at_ms: now,
    last_sync_error_code: '',
    last_sync_error_message: '',
    catalog_freshness: options.catalogFreshness ?? 'fresh',
  };
}

describe('buildEnvironmentCardModel', () => {
  it('builds local, provider, URL, and SSH cards from the aggregated launcher entries', () => {
    const managedLocal = testManagedLocalEnvironment('default');
    const localServe = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Demo Local Serve',
    });
    const controlPlane = buildControlPlaneSummary({});
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedLocal, localServe],
        saved_environments: [
          {
            id: 'http://192.168.1.12:24000/',
            label: 'Staging',
            local_ui_url: 'http://192.168.1.12:24000/',
            source: 'saved',
            pinned: false,
            last_used_at_ms: 20,
          },
        ],
        saved_ssh_environments: [
          {
            id: 'ssh_saved',
            label: 'Prod SSH',
            ssh_destination: 'ops@example.internal',
            ssh_port: 2222,
            auth_mode: 'key_agent',
            remote_install_dir: '/opt/redeven-desktop/runtime',
            bootstrap_strategy: 'desktop_upload',
            release_base_url: '',
            environment_instance_id: 'envinst_demo001',
            source: 'saved',
            pinned: false,
            last_used_at_ms: 30,
          },
        ],
        recent_external_local_ui_urls: ['http://192.168.1.12:24000/'],
      }),
      controlPlanes: [controlPlane],
      openSessions: [
        testManagedSession(managedLocal, 'http://localhost:23998/'),
        testManagedSession(localServe, 'http://127.0.0.1:24001/'),
        {
          session_key: 'url:http://192.168.1.12:24000/',
          target: buildExternalLocalUIDesktopTarget('http://192.168.1.12:24000/', { label: 'Staging' }),
          lifecycle: 'open' as const,
          startup: {
            local_ui_url: 'http://192.168.1.12:24000/',
            local_ui_urls: ['http://192.168.1.12:24000/'],
          },
        },
        {
          session_key: 'ssh:ops@example.internal:2222:key_agent:/opt/redeven-desktop/runtime:envinst_demo001',
          target: buildSSHDesktopTarget(
            {
              ssh_destination: 'ops@example.internal',
              ssh_port: 2222,
              auth_mode: 'key_agent',
              remote_install_dir: '/opt/redeven-desktop/runtime',
              bootstrap_strategy: 'desktop_upload',
              release_base_url: '',
              environment_instance_id: 'envinst_demo001',
            },
            {
              environmentID: 'ssh_saved',
              label: 'Prod SSH',
              forwardedLocalUIURL: 'http://127.0.0.1:24111/',
            },
          ),
          lifecycle: 'open' as const,
          startup: {
            local_ui_url: 'http://127.0.0.1:24111/',
            local_ui_urls: ['http://127.0.0.1:24111/'],
          },
        },
      ],
    });

    const localEntry = snapshot.environments.find((environment) => (
      environment.kind === 'managed_environment' && environment.managed_environment_kind === 'local'
    ));
    const providerEntry = snapshot.environments.find((environment) => environment.kind === 'provider_environment');
    const urlEntry = snapshot.environments.find((environment) => environment.kind === 'external_local_ui');
    const sshEntry = snapshot.environments.find((environment) => environment.kind === 'ssh_environment');

    expect(localEntry).toBeTruthy();
    expect(providerEntry).toBeTruthy();
    expect(urlEntry).toBeTruthy();
    expect(sshEntry).toBeTruthy();

    expect(buildEnvironmentCardModel(localEntry!)).toEqual(expect.objectContaining({
      kind_label: 'Local',
      status_label: 'RUNTIME ONLINE',
      target_primary: 'http://localhost:23998/',
    }));
    expect(buildEnvironmentCardModel(providerEntry!)).toEqual(expect.objectContaining({
      kind_label: 'Provider',
      status_label: 'RUNTIME ONLINE',
      source_label: 'Provider',
      target_primary: 'http://127.0.0.1:24001/',
      target_secondary: 'https://cp.example.invalid/env/env_demo',
    }));
    expect(buildEnvironmentCardModel(urlEntry!)).toEqual(expect.objectContaining({
      kind_label: 'Redeven URL',
      status_label: 'RUNTIME ONLINE',
      source_label: 'Saved',
    }));
    expect(buildEnvironmentCardModel(sshEntry!)).toEqual(expect.objectContaining({
      kind_label: 'SSH Host',
      status_label: 'RUNTIME ONLINE',
      target_primary: 'ops@example.internal:2222',
      target_secondary: 'http://127.0.0.1:24111/',
    }));

    expect(buildEnvironmentCardFactsModel(localEntry!)).toEqual([
      defaultFact('RUNS ON', 'This device'),
      placeholderFact('PROVIDER'),
      defaultFact('SOURCE', 'Desktop-managed'),
      defaultFact('WINDOW', 'Open'),
    ]);
    expect(buildEnvironmentCardFactsModel(providerEntry!)).toEqual([
      defaultFact('RUNS ON', 'This device'),
      defaultFact('PROVIDER', 'Demo Portal'),
      defaultFact('SOURCE ENV', 'env_demo'),
      defaultFact('WINDOW', 'Open'),
    ]);
    expect(buildEnvironmentCardFactsModel(urlEntry!)).toEqual([
      defaultFact('RUNS ON', 'LAN host'),
      defaultFact('SOURCE', 'Saved'),
      defaultFact('WINDOW', 'Open'),
    ]);
    expect(buildEnvironmentCardFactsModel(sshEntry!)).toEqual([
      defaultFact('RUNS ON', 'ops@example.internal:2222'),
      defaultFact('BOOTSTRAP', 'Desktop upload'),
      defaultFact('WINDOW', 'Open'),
    ]);

    expect(buildEnvironmentCardEndpointsModel(providerEntry!)).toEqual([
      {
        label: 'LOCAL',
        value: 'http://127.0.0.1:24001/',
        monospace: true,
        copy_label: 'Copy local endpoint',
      },
      {
        label: 'REMOTE',
        value: 'https://cp.example.invalid/env/env_demo',
        monospace: true,
        copy_label: 'Copy environment URL',
      },
    ]);
    expect(buildEnvironmentCardEndpointsModel(sshEntry!)).toEqual([
      {
        label: 'SSH HOST',
        value: 'ops@example.internal:2222',
        monospace: true,
        copy_label: 'Copy SSH host',
      },
      {
        label: 'FORWARDED URL',
        value: 'http://127.0.0.1:24111/',
        monospace: true,
        copy_label: 'Copy forwarded URL',
      },
    ]);
  });

  it('filters the environment library by local, provider, URL, SSH, and provider-specific scopes', () => {
    const managedLocal = testManagedLocalEnvironment('default');
    const localServe = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Demo Local Serve',
    });
    const controlPlane = buildControlPlaneSummary({});
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedLocal, localServe],
        saved_environments: [{
          id: 'http://192.168.1.12:24000/',
          label: 'Staging',
          local_ui_url: 'http://192.168.1.12:24000/',
          source: 'saved',
          pinned: false,
          last_used_at_ms: 20,
        }],
        saved_ssh_environments: [{
          id: 'ssh_saved',
          label: 'Prod SSH',
          ssh_destination: 'ops@example.internal',
          ssh_port: 2222,
          auth_mode: 'key_agent',
          remote_install_dir: '/opt/redeven-desktop/runtime',
          bootstrap_strategy: 'desktop_upload',
          release_base_url: '',
          environment_instance_id: 'envinst_demo001',
          source: 'saved',
          pinned: false,
          last_used_at_ms: 30,
        }],
      }),
      controlPlanes: [controlPlane],
    });

    expect(environmentLibraryCount(snapshot)).toBe(4);
    expect(environmentLibraryCount(snapshot, '', LOCAL_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);
    expect(environmentLibraryCount(snapshot, '', PROVIDER_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);
    expect(environmentLibraryCount(snapshot, '', URL_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);
    expect(environmentLibraryCount(snapshot, '', SSH_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);

    expect(filterEnvironmentLibrary(
      snapshot,
      '',
      desktopControlPlaneKey('https://cp.example.invalid', 'redeven_portal'),
    ).map((environment) => environment.kind)).toEqual([
      'provider_environment',
    ]);
  });

  it('builds provider-card actions around runtime availability and external runtime control', () => {
    const controlPlane = buildControlPlaneSummary({
      status: 'offline',
      lifecycleStatus: 'suspended',
    });
    const providerOnlySnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [testManagedLocalEnvironment('default')],
        control_planes: [controlPlane],
      }),
      controlPlanes: [controlPlane],
    });
    const providerOnlyEntry = providerOnlySnapshot.environments.find((environment) => (
      environment.kind === 'provider_environment' && environment.env_public_id === 'env_demo'
    ));

    expect(providerOnlyEntry).toBeTruthy();
    expect(buildProviderBackedEnvironmentActionModel(providerOnlyEntry!)).toEqual({
      status_label: 'RUNTIME OFFLINE',
      status_tone: 'warning',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'open',
          label: 'Open',
          enabled: false,
          variant: 'default',
        },
        primary_action_overlay: {
          kind: 'popover',
          tone: 'warning',
          eyebrow: 'Runtime offline',
          title: 'Set up local runtime to continue',
          detail: 'Open becomes available after you finish local runtime setup for this environment.',
          actions: [
            {
              label: 'Set up local runtime…',
              emphasis: 'primary',
              action: {
                intent: 'serve_runtime_locally',
                label: 'Set up local runtime…',
                enabled: true,
                variant: 'outline',
              },
            },
            {
              label: 'Refresh status',
              emphasis: 'secondary',
              action: {
                intent: 'refresh_runtime',
                label: 'Refresh runtime status',
                enabled: true,
                variant: 'outline',
              },
            },
          ],
        },
        menu_button_label: 'Runtime actions',
        menu_actions: [
          {
            id: 'set_up_local_runtime',
            label: 'Set up local runtime…',
            action: {
              intent: 'serve_runtime_locally',
              label: 'Set up local runtime…',
              enabled: true,
              variant: 'outline',
            },
          },
          {
            id: 'refresh_runtime',
            label: 'Refresh runtime status',
            action: {
              intent: 'refresh_runtime',
              label: 'Refresh runtime status',
              enabled: true,
              variant: 'outline',
            },
          },
        ],
      },
    });

    const localServe = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Demo Local Serve',
    });
    const savedLocalServeSnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [testManagedLocalEnvironment('default'), localServe],
        control_planes: [controlPlane],
      }),
      controlPlanes: [controlPlane],
    });
    const savedLocalServeProviderEntry = savedLocalServeSnapshot.environments.find((environment) => environment.kind === 'provider_environment');
    expect(savedLocalServeProviderEntry?.provider_local_runtime_state).toBe('not_running');
    expect(buildProviderBackedEnvironmentActionModel(savedLocalServeProviderEntry!)).toEqual({
      status_label: 'RUNTIME OFFLINE',
      status_tone: 'warning',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'open',
          label: 'Open',
          enabled: false,
          variant: 'default',
        },
        primary_action_overlay: {
          kind: 'popover',
          tone: 'warning',
          eyebrow: 'Runtime offline',
          title: 'Start the local runtime to continue',
          detail: 'Open becomes available once the runtime is ready on this device.',
          actions: [
            {
              label: 'Start runtime locally',
              emphasis: 'primary',
              action: {
                intent: 'start_runtime',
                label: 'Start runtime',
                enabled: true,
                variant: 'outline',
              },
            },
            {
              label: 'Refresh status',
              emphasis: 'secondary',
              action: {
                intent: 'refresh_runtime',
                label: 'Refresh runtime status',
                enabled: true,
                variant: 'outline',
              },
            },
          ],
        },
        menu_button_label: 'Runtime actions',
        menu_actions: [
          {
            id: 'start_runtime',
            label: 'Start runtime',
            action: {
              intent: 'start_runtime',
              label: 'Start runtime',
              enabled: true,
              variant: 'outline',
            },
          },
          {
            id: 'refresh_runtime',
            label: 'Refresh runtime status',
            action: {
              intent: 'refresh_runtime',
              label: 'Refresh runtime status',
              enabled: true,
              variant: 'outline',
            },
          },
        ],
      },
    });

    const openLocalServeSnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [testManagedLocalEnvironment('default'), localServe],
        control_planes: [controlPlane],
      }),
      controlPlanes: [controlPlane],
      openSessions: [
        testManagedSession(localServe, 'http://127.0.0.1:24001/'),
      ],
    });
    const openLocalServeProviderEntry = openLocalServeSnapshot.environments.find((environment) => environment.kind === 'provider_environment');
    expect(openLocalServeProviderEntry?.provider_local_runtime_state).toBe('running_desktop');
    expect(buildProviderBackedEnvironmentActionModel(openLocalServeProviderEntry!)).toEqual({
      status_label: 'RUNTIME ONLINE',
      status_tone: 'success',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'focus',
          label: 'Focus',
          enabled: true,
          variant: 'default',
        },
        primary_action_overlay: undefined,
        menu_button_label: 'Runtime actions',
        menu_actions: [
          {
            id: 'stop_runtime',
            label: 'Stop runtime',
            action: {
              intent: 'stop_runtime',
              label: 'Stop runtime',
              enabled: true,
              variant: 'outline',
            },
          },
          {
            id: 'refresh_runtime',
            label: 'Refresh runtime status',
            action: {
              intent: 'refresh_runtime',
              label: 'Refresh runtime status',
              enabled: true,
              variant: 'outline',
            },
          },
        ],
      },
    });

    const readyControlPlane = buildControlPlaneSummary({
      status: 'online',
      lifecycleStatus: 'active',
    });
    const readySnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [testManagedLocalEnvironment('default')],
        control_planes: [readyControlPlane],
      }),
      controlPlanes: [readyControlPlane],
    });
    const readyEntry = readySnapshot.environments.find((environment) => environment.kind === 'provider_environment');
    expect(buildProviderBackedEnvironmentActionModel(readyEntry!)).toEqual({
      status_label: 'RUNTIME ONLINE',
      status_tone: 'success',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'open',
          label: 'Open',
          enabled: true,
          variant: 'default',
        },
        primary_action_overlay: undefined,
        menu_button_label: 'Runtime actions',
        menu_actions: [
          {
            id: 'set_up_local_runtime',
            label: 'Set up local runtime…',
            action: {
              intent: 'serve_runtime_locally',
              label: 'Set up local runtime…',
              enabled: true,
              variant: 'outline',
            },
          },
          {
            id: 'refresh_runtime',
            label: 'Refresh runtime status',
            action: {
              intent: 'refresh_runtime',
              label: 'Refresh runtime status',
              enabled: true,
              variant: 'outline',
            },
          },
        ],
      },
    });
  });

  it('builds provider cards around effective local-serve routes instead of separate local-serve cards', () => {
    const attachableLocalServe = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [
          testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
            currentRuntime: {
              local_ui_url: 'http://127.0.0.1:24001/',
              desktop_managed: false,
            },
          }),
        ],
      }),
      controlPlanes: [buildControlPlaneSummary({
        status: 'offline',
        lifecycleStatus: 'suspended',
      })],
    }).environments.find((environment) => environment.kind === 'provider_environment');

    expect(attachableLocalServe).toBeTruthy();
    expect(buildProviderBackedEnvironmentActionModel(attachableLocalServe!)).toEqual({
      status_label: 'RUNTIME ONLINE',
      status_tone: 'success',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'open',
          label: 'Open',
          enabled: true,
          variant: 'default',
        },
        primary_action_overlay: undefined,
        menu_button_label: 'Runtime actions',
        menu_actions: [
          {
            id: 'stop_runtime',
            label: 'Stop runtime',
            action: {
              intent: 'stop_runtime',
              label: 'Stop runtime',
              enabled: true,
              variant: 'outline',
            },
          },
          {
            id: 'refresh_runtime',
            label: 'Refresh runtime status',
            action: {
              intent: 'refresh_runtime',
              label: 'Refresh runtime status',
              enabled: true,
              variant: 'outline',
            },
          },
        ],
      },
    });

    const focusableLocalServe = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [
          testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo'),
        ],
      }),
      controlPlanes: [buildControlPlaneSummary({})],
      openSessions: [
        testManagedSession(
          testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo'),
          'http://127.0.0.1:24001/',
        ),
      ],
    }).environments.find((environment) => environment.kind === 'provider_environment');

    expect(focusableLocalServe).toBeTruthy();
    expect(buildProviderBackedEnvironmentActionModel(focusableLocalServe!)).toEqual({
      status_label: 'RUNTIME ONLINE',
      status_tone: 'success',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'focus',
          label: 'Focus',
          enabled: true,
          variant: 'default',
        },
        primary_action_overlay: undefined,
        menu_button_label: 'Runtime actions',
        menu_actions: [
          {
            id: 'open_via_control_plane',
            label: 'Open remotely',
            action: {
              intent: 'open',
              label: 'Open remotely',
              enabled: true,
              variant: 'outline',
              route: 'remote_desktop',
            },
          },
          {
            id: 'stop_runtime',
            label: 'Stop runtime',
            action: {
              intent: 'stop_runtime',
              label: 'Stop runtime',
              enabled: true,
              variant: 'outline',
            },
          },
          {
            id: 'refresh_runtime',
            label: 'Refresh runtime status',
            action: {
              intent: 'refresh_runtime',
              label: 'Refresh runtime status',
              enabled: true,
              variant: 'outline',
            },
          },
        ],
      },
    });
  });

  it('treats opening managed sessions as a disabled Opening state instead of Focus', () => {
    const localServe = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_opening');
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [localServe],
      }),
      openSessions: [
        testManagedSession(localServe, 'http://localhost:23998/', 'opening'),
      ],
    });

    const entry = snapshot.environments.find((environment) => environment.id === localServe.id);
    expect(entry).toBeTruthy();
    expect(entry).toEqual(expect.objectContaining({
      is_open: false,
      is_opening: true,
      open_action_label: 'Opening…',
    }));

    expect(buildProviderBackedEnvironmentActionModel(entry!)).toEqual({
      status_label: 'RUNTIME ONLINE',
      status_tone: 'success',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'opening',
          label: 'Opening…',
          enabled: false,
          variant: 'default',
        },
        primary_action_overlay: undefined,
        menu_button_label: 'Runtime actions',
        menu_actions: [
          {
            id: 'stop_runtime',
            label: 'Stop runtime',
            action: {
              intent: 'stop_runtime',
              label: 'Stop runtime',
              enabled: true,
              variant: 'outline',
            },
          },
          {
            id: 'refresh_runtime',
            label: 'Refresh runtime status',
            action: {
              intent: 'refresh_runtime',
              label: 'Refresh runtime status',
              enabled: true,
              variant: 'outline',
            },
          },
        ],
      },
    });
  });

  it('projects provider remote sessions onto the separate provider card', () => {
    const localServe = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo');
    const remoteTarget = buildManagedEnvironmentDesktopTarget(localServe, { route: 'remote_desktop' });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [localServe],
      }),
      controlPlanes: [buildControlPlaneSummary({})],
      openSessions: [
        {
          session_key: remoteTarget.session_key,
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
    });

    const providerEntry = snapshot.environments.find((environment) => environment.kind === 'provider_environment');

    expect(providerEntry).toEqual(expect.objectContaining({
      is_open: true,
      open_remote_session_key: remoteTarget.session_key,
      open_session_key: remoteTarget.session_key,
      local_ui_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
      open_action_label: 'Focus',
      open_local_session_key: undefined,
    }));
  });

  it('splits pinned entries ahead of the regular environment list', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [
          testManagedLocalEnvironment('default', { pinned: true }),
          testManagedLocalEnvironment('lab'),
        ],
        saved_environments: [{
          id: 'http://192.168.1.12:24000/',
          label: 'Staging',
          local_ui_url: 'http://192.168.1.12:24000/',
          source: 'saved',
          pinned: true,
          last_used_at_ms: 20,
        }],
      }),
    });

    expect(splitPinnedEnvironmentEntries(snapshot.environments)).toEqual({
      pinned_entries: expect.arrayContaining([
        expect.objectContaining({ id: 'local:default' }),
        expect.objectContaining({ id: 'http://192.168.1.12:24000/' }),
      ]),
      regular_entries: expect.arrayContaining([
        expect.objectContaining({ id: 'local:lab' }),
      ]),
    });
  });

  it('caps compact environment columns by the visible card count when the container is wide', () => {
    expect(buildEnvironmentLibraryLayoutModel({
      visible_card_count: 3,
      layout_reference_count: 3,
      container_width_px: 1200,
      root_font_size_px: 16,
    })).toEqual({
      visible_card_count: 3,
      layout_reference_count: 3,
      density: 'compact',
      column_count: 3,
    });
  });

  it('switches to spacious density at four visible cards and keeps the shared column count stable', () => {
    expect(buildEnvironmentLibraryLayoutModel({
      visible_card_count: 4,
      layout_reference_count: 4,
      container_width_px: 1600,
      root_font_size_px: 16,
    })).toEqual({
      visible_card_count: 4,
      layout_reference_count: 4,
      density: 'spacious',
      column_count: 4,
    });
  });

  it('reduces spacious environment columns when the measured width cannot fit every visible card', () => {
    expect(buildEnvironmentLibraryLayoutModel({
      visible_card_count: 6,
      layout_reference_count: 6,
      container_width_px: 1000,
      root_font_size_px: 16,
    })).toEqual({
      visible_card_count: 6,
      layout_reference_count: 6,
      density: 'spacious',
      column_count: 3,
    });
  });

  it('falls back to a single shared environment column before the library width is measured', () => {
    expect(buildEnvironmentLibraryLayoutModel({
      visible_card_count: 5,
      layout_reference_count: 5,
      container_width_px: 0,
      root_font_size_px: 16,
    })).toEqual({
      visible_card_count: 5,
      layout_reference_count: 5,
      density: 'spacious',
      column_count: 1,
    });
  });

  it('keeps the environment grid density and shared columns anchored to the unfiltered library scope', () => {
    expect(buildEnvironmentLibraryLayoutModel({
      visible_card_count: 1,
      layout_reference_count: 5,
      container_width_px: 1600,
      root_font_size_px: 16,
    })).toEqual({
      visible_card_count: 1,
      layout_reference_count: 5,
      density: 'spacious',
      column_count: 5,
    });
  });
});
