import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import {
  buildExternalLocalUIDesktopTarget,
  buildManagedEnvironmentDesktopTarget,
  buildSSHDesktopTarget,
} from '../main/desktopTarget';
import { desktopControlPlaneKey } from '../shared/controlPlaneProvider';
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

function buildControlPlaneSummary(options: Readonly<{
  providerOrigin?: string;
  displayLabel?: string;
  status?: string;
  lifecycleStatus?: string;
  envPublicID?: string;
  environmentURL?: string;
  syncState?: 'idle' | 'syncing' | 'ready' | 'auth_required' | 'provider_unreachable' | 'provider_invalid' | 'sync_error';
  catalogFreshness?: 'unknown' | 'fresh' | 'stale';
}>) {
  const provider = buildProvider(options.providerOrigin);
  const now = Date.now();
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
      env_public_id: options.envPublicID ?? 'env_demo',
      label: 'Demo Environment',
      environment_url: options.environmentURL ?? `${provider.provider_origin}/env/${options.envPublicID ?? 'env_demo'}`,
      description: 'team sandbox',
      namespace_public_id: 'ns_demo',
      namespace_name: 'Demo Team',
      status: options.status ?? 'online',
      lifecycle_status: options.lifecycleStatus ?? 'active',
      last_seen_at_unix_ms: now,
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
  it('builds local, local-serve, provider, URL, and SSH cards from separated launcher entries', () => {
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
            remote_install_dir: '/opt/redeven-desktop/runtime',
            bootstrap_strategy: 'desktop_upload',
            release_base_url: '',
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
          session_key: 'ssh:ops@example.internal:2222:/opt/redeven-desktop/runtime',
          target: buildSSHDesktopTarget(
            {
              ssh_destination: 'ops@example.internal',
              ssh_port: 2222,
              remote_install_dir: '/opt/redeven-desktop/runtime',
              bootstrap_strategy: 'desktop_upload',
              release_base_url: '',
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
    const localServeEntry = snapshot.environments.find((environment) => (
      environment.kind === 'managed_environment' && environment.managed_environment_kind === 'controlplane'
    ));
    const providerEntry = snapshot.environments.find((environment) => environment.kind === 'provider_environment');
    const urlEntry = snapshot.environments.find((environment) => environment.kind === 'external_local_ui');
    const sshEntry = snapshot.environments.find((environment) => environment.kind === 'ssh_environment');

    expect(localEntry).toBeTruthy();
    expect(localServeEntry).toBeTruthy();
    expect(providerEntry).toBeTruthy();
    expect(urlEntry).toBeTruthy();
    expect(sshEntry).toBeTruthy();

    expect(buildEnvironmentCardModel(localEntry!)).toEqual(expect.objectContaining({
      kind_label: 'Local',
      status_label: 'Open',
      target_primary: 'http://localhost:23998/',
    }));
    expect(buildEnvironmentCardModel(localServeEntry!)).toEqual(expect.objectContaining({
      kind_label: 'Local Serve',
      status_label: 'Open',
      target_primary: 'http://127.0.0.1:24001/',
      target_secondary: 'https://cp.example.invalid/env/env_demo',
    }));
    expect(buildEnvironmentCardModel(providerEntry!)).toEqual(expect.objectContaining({
      kind_label: 'Provider',
      status_label: 'Open',
      source_label: 'Control Plane',
      target_primary: 'http://127.0.0.1:24001/',
      target_secondary: 'https://cp.example.invalid/env/env_demo',
    }));
    expect(buildEnvironmentCardModel(urlEntry!)).toEqual(expect.objectContaining({
      kind_label: 'Redeven URL',
      status_label: 'Open',
      source_label: 'Saved',
    }));
    expect(buildEnvironmentCardModel(sshEntry!)).toEqual(expect.objectContaining({
      kind_label: 'SSH',
      status_label: 'Open',
      target_primary: 'ops@example.internal:2222',
      target_secondary: 'http://127.0.0.1:24111/',
    }));

    expect(buildEnvironmentCardFactsModel(localEntry!)).toEqual([
      defaultFact('RUNS ON', 'This device'),
      defaultFact('LOCAL RUNTIME', 'Running in Desktop'),
      defaultFact('WINDOW', 'Stops on close'),
      placeholderFact('CONTROL PLANE'),
    ]);
    expect(buildEnvironmentCardFactsModel(localServeEntry!)).toEqual([
      defaultFact('SOURCE ENV', 'env_demo'),
      defaultFact('CONTROL PLANE', 'Demo Portal'),
      defaultFact('LOCAL RUNTIME', 'Running in Desktop'),
      defaultFact('WINDOW', 'Stops on close'),
    ]);
    expect(buildEnvironmentCardFactsModel(providerEntry!)).toEqual([
      defaultFact('CONTROL PLANE', 'Demo Portal'),
      defaultFact('REMOTE', 'online · active'),
      defaultFact('LOCAL SERVE', 'Running in Desktop'),
    ]);
    expect(buildEnvironmentCardFactsModel(urlEntry!)).toEqual([
      defaultFact('SOURCE', 'Saved'),
      defaultFact('NETWORK', 'LAN host'),
    ]);
    expect(buildEnvironmentCardFactsModel(sshEntry!)).toEqual([
      defaultFact('SOURCE', 'Saved'),
      defaultFact('BOOTSTRAP', 'Desktop upload'),
      defaultFact('INSTALL ROOT', '/opt/redeven-desktop/runtime'),
    ]);

    expect(buildEnvironmentCardEndpointsModel(localServeEntry!)).toEqual([
      {
        label: 'URL',
        value: 'http://127.0.0.1:24001/',
        monospace: true,
        copy_label: 'Copy local endpoint',
      },
      {
        label: 'SOURCE',
        value: 'https://cp.example.invalid/env/env_demo',
        monospace: true,
        copy_label: 'Copy provider URL',
      },
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
        label: 'SSH',
        value: 'ops@example.internal:2222',
        monospace: true,
        copy_label: 'Copy SSH target',
      },
      {
        label: 'URL',
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
          remote_install_dir: '/opt/redeven-desktop/runtime',
          bootstrap_strategy: 'desktop_upload',
          release_base_url: '',
          source: 'saved',
          pinned: false,
          last_used_at_ms: 30,
        }],
      }),
      controlPlanes: [controlPlane],
    });

    expect(environmentLibraryCount(snapshot)).toBe(4);
    expect(environmentLibraryCount(snapshot, '', LOCAL_ENVIRONMENT_LIBRARY_FILTER)).toBe(2);
    expect(environmentLibraryCount(snapshot, '', PROVIDER_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);
    expect(environmentLibraryCount(snapshot, '', URL_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);
    expect(environmentLibraryCount(snapshot, '', SSH_ENVIRONMENT_LIBRARY_FILTER)).toBe(1);

    expect(filterEnvironmentLibrary(
      snapshot,
      '',
      desktopControlPlaneKey('https://cp.example.invalid', 'redeven_portal'),
    ).map((environment) => environment.id)).toEqual([
      'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
    ]);
  });

  it('builds provider-card actions around remote state and local-serve availability', () => {
    const controlPlane = buildControlPlaneSummary({
      status: 'offline',
      lifecycleStatus: 'suspended',
    });
    const providerOnlySnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [testManagedLocalEnvironment('default')],
      }),
      controlPlanes: [controlPlane],
    });
    const providerOnlyEntry = providerOnlySnapshot.environments.find((environment) => environment.kind === 'provider_environment');

    expect(providerOnlyEntry).toBeTruthy();
    expect(buildProviderBackedEnvironmentActionModel(providerOnlyEntry!)).toEqual({
      status_label: 'Offline',
      status_tone: 'warning',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'serve_runtime',
          label: 'Serve Local…',
          enabled: true,
          variant: 'default',
        },
        menu_button_label: 'Choose environment route',
        menu_actions: [{
          id: 'remote_route',
          label: 'Check Remote Status',
          action: {
            intent: 'check_status',
            label: 'Check Remote Status',
            enabled: true,
            variant: 'outline',
            route: 'remote_desktop',
          },
        }],
        secondary_action: undefined,
      },
    });

    const localServe = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Demo Local Serve',
    });
    const savedLocalServeSnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [testManagedLocalEnvironment('default'), localServe],
      }),
      controlPlanes: [controlPlane],
    });
    const savedLocalServeProviderEntry = savedLocalServeSnapshot.environments.find((environment) => environment.kind === 'provider_environment');
    expect(savedLocalServeProviderEntry?.provider_local_serve_state).toBe('saved');
    expect(buildProviderBackedEnvironmentActionModel(savedLocalServeProviderEntry!)).toEqual({
      status_label: 'Local Ready',
      status_tone: 'primary',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'serve_runtime',
          label: 'Open Local Serve',
          enabled: true,
          variant: 'default',
        },
        menu_button_label: 'Choose environment route',
        menu_actions: [{
          id: 'remote_route',
          label: 'Check Remote Status',
          action: {
            intent: 'check_status',
            label: 'Check Remote Status',
            enabled: true,
            variant: 'outline',
            route: 'remote_desktop',
          },
        }],
        secondary_action: undefined,
      },
    });

    const openLocalServeSnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [testManagedLocalEnvironment('default'), localServe],
      }),
      controlPlanes: [controlPlane],
      openSessions: [
        testManagedSession(localServe, 'http://127.0.0.1:24001/'),
      ],
    });
    const openLocalServeProviderEntry = openLocalServeSnapshot.environments.find((environment) => environment.kind === 'provider_environment');
    expect(openLocalServeProviderEntry?.provider_local_serve_state).toBe('open');
    expect(buildProviderBackedEnvironmentActionModel(openLocalServeProviderEntry!)).toEqual({
      status_label: 'Open',
      status_tone: 'success',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'serve_runtime',
          label: 'Focus Local Serve',
          enabled: true,
          variant: 'default',
        },
        menu_button_label: 'Choose environment route',
        menu_actions: [{
          id: 'remote_route',
          label: 'Check Remote Status',
          action: {
            intent: 'check_status',
            label: 'Check Remote Status',
            enabled: true,
            variant: 'outline',
            route: 'remote_desktop',
          },
        }],
        secondary_action: {
          intent: 'stop',
          label: 'Stop',
          enabled: true,
          variant: 'outline',
        },
      },
    });

    const readyControlPlane = buildControlPlaneSummary({
      status: 'online',
      lifecycleStatus: 'active',
    });
    const readySnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [testManagedLocalEnvironment('default')],
      }),
      controlPlanes: [readyControlPlane],
    });
    const readyEntry = readySnapshot.environments.find((environment) => environment.kind === 'provider_environment');
    expect(buildProviderBackedEnvironmentActionModel(readyEntry!)).toEqual({
      status_label: 'Ready',
      status_tone: 'primary',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'open',
          label: 'Open Remote',
          enabled: true,
          variant: 'outline',
          route: 'remote_desktop',
        },
        menu_button_label: 'Choose environment route',
        menu_actions: [{
          id: 'local_serve',
          label: 'Serve Local…',
          action: {
            intent: 'serve_runtime',
            label: 'Serve Local…',
            enabled: true,
            variant: 'default',
          },
        }],
        secondary_action: undefined,
      },
    });

    expect(buildProviderBackedEnvironmentActionModel({
      ...readyEntry!,
      remote_route_state: 'stale',
    }).action_presentation).toEqual({
      kind: 'split_button',
      primary_action: {
        intent: 'refresh_status',
        label: 'Refresh Status',
        enabled: true,
        variant: 'outline',
      },
      menu_button_label: 'Choose environment route',
      menu_actions: [{
        id: 'local_serve',
        label: 'Serve Local…',
        action: {
          intent: 'serve_runtime',
          label: 'Serve Local…',
          enabled: true,
          variant: 'default',
        },
      }],
      secondary_action: undefined,
    });
    expect(buildProviderBackedEnvironmentActionModel({
      ...readyEntry!,
      remote_route_state: 'auth_required',
    }).action_presentation).toEqual({
      kind: 'split_button',
      primary_action: {
        intent: 'reconnect_provider',
        label: 'Reconnect',
        enabled: true,
        variant: 'outline',
      },
      menu_button_label: 'Choose environment route',
      menu_actions: [{
        id: 'local_serve',
        label: 'Serve Local…',
        action: {
          intent: 'serve_runtime',
          label: 'Serve Local…',
          enabled: true,
          variant: 'default',
        },
      }],
      secondary_action: undefined,
    });
  });

  it('builds local and local-serve cards around local runtime actions rather than remote route menus', () => {
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
    }).environments.find((environment) => (
      environment.kind === 'managed_environment' && environment.managed_environment_kind === 'controlplane'
    ));

    expect(attachableLocalServe).toBeTruthy();
    expect(buildProviderBackedEnvironmentActionModel(attachableLocalServe!)).toEqual({
      status_label: 'Ready',
      status_tone: 'primary',
      action_presentation: {
        kind: 'single_button',
        action: {
          intent: 'attach',
          label: 'Attach Local',
          enabled: true,
          variant: 'default',
          route: 'local_host',
        },
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
    }).environments.find((environment) => (
      environment.kind === 'managed_environment' && environment.managed_environment_kind === 'controlplane'
    ));

    expect(focusableLocalServe).toBeTruthy();
    expect(buildProviderBackedEnvironmentActionModel(focusableLocalServe!)).toEqual({
      status_label: 'Open',
      status_tone: 'success',
      action_presentation: {
        kind: 'single_button',
        action: {
          intent: 'focus',
          label: 'Focus Local',
          enabled: true,
          variant: 'default',
          route: 'local_host',
        },
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
      status_label: 'Opening',
      status_tone: 'primary',
      action_presentation: {
        kind: 'single_button',
        action: {
          intent: 'opening',
          label: 'Opening…',
          enabled: false,
          variant: 'default',
          route: 'local_host',
        },
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
    const localServeEntry = snapshot.environments.find((environment) => (
      environment.kind === 'managed_environment' && environment.managed_environment_kind === 'controlplane'
    ));

    expect(providerEntry).toEqual(expect.objectContaining({
      is_open: true,
      open_remote_session_key: remoteTarget.session_key,
      open_session_key: remoteTarget.session_key,
      local_ui_url: 'https://env.example.invalid/_redeven_boot/#redeven=abc',
      open_action_label: 'Focus',
    }));
    expect(localServeEntry).toEqual(expect.objectContaining({
      is_open: false,
      open_local_session_key: undefined,
      open_action_label: 'Open',
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
