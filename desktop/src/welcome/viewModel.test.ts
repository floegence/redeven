import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import {
  buildExternalLocalUIDesktopTarget,
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
  buildEnvironmentCardModel,
  buildEnvironmentCardEndpointsModel,
  buildEnvironmentCardFactsModel,
  buildProviderBackedEnvironmentActionModel,
  filterEnvironmentLibrary,
  resolveDefaultDualRouteAction,
  splitPinnedEnvironmentEntries,
} from './viewModel';

describe('buildEnvironmentCardModel', () => {
  it('builds local, URL, and SSH card metadata from desktop snapshot entries', () => {
    const managedLocal = testManagedLocalEnvironment();
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
    const urlEntry = snapshot.environments.find((environment) => environment.kind === 'external_local_ui');
    const sshEntry = snapshot.environments.find((environment) => environment.kind === 'ssh_environment');

    expect(localEntry).toBeTruthy();
    expect(urlEntry).toBeTruthy();
    expect(sshEntry).toBeTruthy();

    const localCard = buildEnvironmentCardModel(localEntry!);
    expect(localCard.kind_label).toBe('Local');
    expect(localCard.status_label).toBe('Open');
    expect(localCard.target_primary).toBe('http://localhost:23998/');

    const urlCard = buildEnvironmentCardModel(urlEntry!);
    expect(urlCard.kind_label).toBe('Redeven URL');
    expect(urlCard.status_label).toBe('Open');
    expect(urlCard.source_label).toBe('Saved');
    expect(urlCard.target_primary).toBe('http://192.168.1.12:24000/');
    expect(urlCard.target_secondary).toBe('');

    const sshCard = buildEnvironmentCardModel(sshEntry!);
    expect(sshCard.kind_label).toBe('SSH');
    expect(sshCard.status_label).toBe('Open');
    expect(sshCard.target_primary).toBe('ops@example.internal:2222');
    expect(sshCard.target_secondary).toBe('http://127.0.0.1:24111/');
    expect(sshCard.meta).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Bootstrap',
        value: 'Desktop upload',
      }),
      expect.objectContaining({
        label: 'Install root',
        value: '/opt/redeven-desktop/runtime',
      }),
    ]));

    expect(buildEnvironmentCardFactsModel(localEntry!)).toEqual([
      { label: 'RUNS ON', value: 'This device' },
      { label: 'ACCESS', value: 'Local' },
    ]);
    expect(buildEnvironmentCardFactsModel(urlEntry!)).toEqual([
      { label: 'ACCESS', value: 'Redeven URL' },
      { label: 'CONNECTION', value: 'Open' },
    ]);
    expect(buildEnvironmentCardFactsModel(sshEntry!)).toEqual([
      { label: 'ACCESS', value: 'SSH' },
      { label: 'CONNECTION', value: 'Open' },
      { label: 'BOOTSTRAP', value: 'Desktop upload' },
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

  it('maps provider-backed environments to unified Ready and Offline badges', () => {
    const freshSyncAt = Date.now();
    const managedControlPlane = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      localHosting: false,
    });
    const provider = {
      protocol_version: 'rcpp-v1' as const,
      provider_id: 'redeven_portal',
      display_name: 'Redeven Portal',
      provider_origin: 'https://cp.example.invalid',
      documentation_url: 'https://cp.example.invalid/docs/provider-protocol',
    };
    const account = {
      provider_id: 'redeven_portal',
      provider_origin: 'https://cp.example.invalid',
      display_name: 'Redeven Portal',
      user_public_id: 'user_demo',
      user_display_name: 'Demo User',
      authorization_expires_at_unix_ms: 1_000,
    };
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedControlPlane],
        control_planes: [{
          provider,
          account,
          display_label: 'cp.example.invalid',
          environments: [{
            provider_id: 'redeven_portal',
            provider_origin: 'https://cp.example.invalid',
            env_public_id: 'env_demo',
            label: 'Demo Environment',
            description: 'team sandbox',
            namespace_public_id: 'ns_demo',
            namespace_name: 'Demo Team',
            status: 'offline',
            lifecycle_status: 'suspended',
            last_seen_at_unix_ms: 123,
          }],
          last_synced_at_ms: 500,
        }],
      }),
      controlPlanes: [{
        provider,
        account,
        display_label: 'cp.example.invalid',
        environments: [{
          provider_id: 'redeven_portal',
          provider_origin: 'https://cp.example.invalid',
          env_public_id: 'env_demo',
          label: 'Demo Environment',
          description: 'team sandbox',
          namespace_public_id: 'ns_demo',
          namespace_name: 'Demo Team',
          status: 'offline',
          lifecycle_status: 'suspended',
          last_seen_at_unix_ms: 123,
        }],
        last_synced_at_ms: freshSyncAt,
        sync_state: 'ready',
        last_sync_attempt_at_ms: freshSyncAt,
        last_sync_error_code: '',
        last_sync_error_message: '',
        catalog_freshness: 'fresh',
      }],
    });

    const offlineEntry = snapshot.environments.find((environment) => (
      environment.kind === 'managed_environment' && environment.env_public_id === 'env_demo'
    ));

    expect(offlineEntry).toBeTruthy();
    expect(buildEnvironmentCardModel(offlineEntry!)).toEqual(expect.objectContaining({
      kind_label: 'Remote Environment',
      status_label: 'Offline',
      status_tone: 'warning',
    }));

    const openSnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedControlPlane],
        control_planes: [{
          provider,
          account,
          display_label: 'cp.example.invalid',
          environments: [{
            provider_id: 'redeven_portal',
            provider_origin: 'https://cp.example.invalid',
            env_public_id: 'env_demo',
            label: 'Demo Environment',
            description: 'team sandbox',
            namespace_public_id: 'ns_demo',
            namespace_name: 'Demo Team',
            status: 'online',
            lifecycle_status: 'active',
            last_seen_at_unix_ms: 456,
          }],
          last_synced_at_ms: 600,
        }],
      }),
      controlPlanes: [{
        provider,
        account,
        display_label: 'cp.example.invalid',
        environments: [{
          provider_id: 'redeven_portal',
          provider_origin: 'https://cp.example.invalid',
          env_public_id: 'env_demo',
          label: 'Demo Environment',
          description: 'team sandbox',
          namespace_public_id: 'ns_demo',
          namespace_name: 'Demo Team',
          status: 'online',
          lifecycle_status: 'active',
          last_seen_at_unix_ms: 456,
        }],
        last_synced_at_ms: freshSyncAt,
        sync_state: 'ready',
        last_sync_attempt_at_ms: freshSyncAt,
        last_sync_error_code: '',
        last_sync_error_message: '',
        catalog_freshness: 'fresh',
      }],
    });

    const readyEntry = openSnapshot.environments.find((environment) => (
      environment.kind === 'managed_environment' && environment.env_public_id === 'env_demo'
    ));

    expect(readyEntry).toBeTruthy();
    expect(buildEnvironmentCardModel(readyEntry!)).toEqual(expect.objectContaining({
      status_label: 'Ready',
      status_tone: 'primary',
    }));
  });

  it('marks remote-only provider cards as stale when the provider catalog is outdated', () => {
    const managedControlPlane = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_demo', {
      localHosting: false,
    });
    const provider = {
      protocol_version: 'rcpp-v1' as const,
      provider_id: 'redeven_portal',
      display_name: 'Redeven Portal',
      provider_origin: 'https://cp.example.invalid',
      documentation_url: 'https://cp.example.invalid/docs/provider-protocol',
    };
    const account = {
      provider_id: 'redeven_portal',
      provider_origin: 'https://cp.example.invalid',
      display_name: 'Redeven Portal',
      user_public_id: 'user_demo',
      user_display_name: 'Demo User',
      authorization_expires_at_unix_ms: Date.now() + 60_000,
    };

    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [managedControlPlane],
        control_planes: [{
          provider,
          account,
          display_label: 'cp.example.invalid',
          environments: [{
            provider_id: 'redeven_portal',
            provider_origin: 'https://cp.example.invalid',
            env_public_id: 'env_demo',
            label: 'Demo Environment',
            description: 'team sandbox',
            namespace_public_id: 'ns_demo',
            namespace_name: 'Demo Team',
            status: 'online',
            lifecycle_status: 'active',
            last_seen_at_unix_ms: 456,
          }],
          last_synced_at_ms: 600,
        }],
      }),
    });

    const staleEntry = snapshot.environments.find((environment) => (
      environment.kind === 'managed_environment' && environment.env_public_id === 'env_demo'
    ));

    expect(staleEntry).toBeTruthy();
    expect(buildEnvironmentCardModel(staleEntry!)).toEqual(expect.objectContaining({
      status_label: 'Status stale',
      status_tone: 'warning',
    }));
  });

  it('derives offline remote-only and dual-route action models from the same provider state', () => {
    const freshSyncAt = Date.now();
    const remoteOnly = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_remote_only', {
      localHosting: false,
    });
    const dualRoute = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_dual_route');
    const provider = {
      protocol_version: 'rcpp-v1' as const,
      provider_id: 'redeven_portal',
      display_name: 'Redeven Portal',
      provider_origin: 'https://cp.example.invalid',
      documentation_url: 'https://cp.example.invalid/docs/provider-protocol',
    };
    const account = {
      provider_id: 'redeven_portal',
      provider_origin: 'https://cp.example.invalid',
      display_name: 'Redeven Portal',
      user_public_id: 'user_demo',
      user_display_name: 'Demo User',
      authorization_expires_at_unix_ms: Date.now() + 60_000,
    };
    const environments = [
      {
        provider_id: 'redeven_portal',
        provider_origin: 'https://cp.example.invalid',
        env_public_id: 'env_remote_only',
        label: 'Remote Only',
        description: 'remote only sandbox',
        namespace_public_id: 'ns_demo',
        namespace_name: 'Demo Team',
        status: 'offline',
        lifecycle_status: 'suspended',
        last_seen_at_unix_ms: 123,
      },
      {
        provider_id: 'redeven_portal',
        provider_origin: 'https://cp.example.invalid',
        env_public_id: 'env_dual_route',
        label: 'Dual Route',
        description: 'dual-route sandbox',
        namespace_public_id: 'ns_demo',
        namespace_name: 'Demo Team',
        status: 'offline',
        lifecycle_status: 'suspended',
        last_seen_at_unix_ms: 456,
      },
    ];

    const controlPlaneSummary = {
      provider,
      account,
      display_label: 'Demo Portal',
      environments,
      last_synced_at_ms: freshSyncAt,
      sync_state: 'ready' as const,
      last_sync_attempt_at_ms: freshSyncAt,
      last_sync_error_code: '',
      last_sync_error_message: '',
      catalog_freshness: 'fresh' as const,
    };

    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [
          remoteOnly,
          dualRoute,
          testManagedLocalEnvironment('default'),
          testManagedControlPlaneEnvironment('https://cp.other.invalid', 'env_other', { localHosting: false }),
        ],
        control_planes: [{
          provider,
          account,
          display_label: 'Demo Portal',
          environments,
          last_synced_at_ms: freshSyncAt,
        }, {
          provider: {
            ...provider,
            provider_origin: 'https://cp.other.invalid',
          },
          account: {
            ...account,
            provider_origin: 'https://cp.other.invalid',
          },
          display_label: 'Other Portal',
          environments: [],
          last_synced_at_ms: freshSyncAt,
        }],
      }),
      controlPlanes: [
        controlPlaneSummary,
        {
          ...controlPlaneSummary,
          provider: {
            ...controlPlaneSummary.provider,
            provider_origin: 'https://cp.other.invalid',
          },
          account: {
            ...controlPlaneSummary.account,
            provider_origin: 'https://cp.other.invalid',
          },
          display_label: 'Other Portal',
          environments: [],
        },
      ],
    });

    const remoteOnlyEntry = snapshot.environments.find((environment) => environment.id === remoteOnly.id);
    const dualRouteEntry = snapshot.environments.find((environment) => environment.id === dualRoute.id);

    expect(remoteOnlyEntry).toBeTruthy();
    expect(dualRouteEntry).toBeTruthy();

    expect(buildProviderBackedEnvironmentActionModel(remoteOnlyEntry!)).toEqual(expect.objectContaining({
      status_label: 'Offline',
      action_presentation: {
        kind: 'single_button',
        action: expect.objectContaining({
          intent: 'check_status',
          label: 'Check Remote Status',
          enabled: true,
          route: 'remote_desktop',
        }),
      },
    }));

    const dualRouteActionModel = buildProviderBackedEnvironmentActionModel(dualRouteEntry!);
    expect(dualRouteActionModel).toEqual(expect.objectContaining({
      status_label: 'Local Ready',
      action_presentation: expect.objectContaining({
        kind: 'split_button',
        default_action: expect.objectContaining({
          intent: 'open',
          label: 'Open',
          enabled: true,
          route: 'local_host',
        }),
      }),
    }));
    expect(dualRouteActionModel.action_presentation.kind).toBe('split_button');
    if (dualRouteActionModel.action_presentation.kind !== 'split_button') {
      throw new Error('Expected dual-route action presentation.');
    }
    expect(dualRouteActionModel.action_presentation.menu_actions).toEqual([
      expect.objectContaining({
        id: 'local_route',
        section: 'local',
        label: 'Open via Local Port',
        disabled: false,
        is_default: true,
        action: expect.objectContaining({
          intent: 'open',
          label: 'Open Local',
          route: 'local_host',
        }),
      }),
      expect.objectContaining({
        id: 'remote_check_status',
        section: 'remote',
        label: 'Check Remote Status',
        disabled: false,
        is_default: false,
        action: expect.objectContaining({
          intent: 'check_status',
          label: 'Check Remote Status',
          route: 'remote_desktop',
        }),
      }),
    ]);

    expect(buildEnvironmentCardFactsModel(remoteOnlyEntry!)).toEqual([
      { label: 'RUNS ON', value: 'Control Plane' },
      { label: 'ACCESS', value: 'Remote' },
      { label: 'CONTROL PLANE', value: 'Demo Portal' },
    ]);
    expect(buildEnvironmentCardFactsModel(dualRouteEntry!)).toEqual([
      { label: 'RUNS ON', value: 'This device' },
      { label: 'ACCESS', value: 'Local + Remote' },
      { label: 'CONTROL PLANE', value: 'Demo Portal' },
    ]);
    expect(filterEnvironmentLibrary(
      snapshot,
      'all',
      '',
      desktopControlPlaneKey('https://cp.example.invalid', 'redeven_portal'),
    ).map((environment) => environment.id)).toEqual([
      remoteOnly.id,
      dualRoute.id,
    ]);
  });

  it('prefers the already-open local route over a remote-ready route for the split-button default', () => {
    const dualRouteEntry = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [
          testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_dual_route', {
            preferredOpenRoute: 'remote_desktop',
          }),
        ],
      }),
      controlPlanes: [{
        provider: {
          protocol_version: 'rcpp-v1',
          provider_id: 'redeven_portal',
          display_name: 'Redeven Portal',
          provider_origin: 'https://cp.example.invalid',
          documentation_url: 'https://cp.example.invalid/docs/provider-protocol',
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
          env_public_id: 'env_dual_route',
          label: 'Dual Route',
          description: 'dual-route sandbox',
          namespace_public_id: 'ns_demo',
          namespace_name: 'Demo Team',
          status: 'online',
          lifecycle_status: 'active',
          last_seen_at_unix_ms: 456,
        }],
        last_synced_at_ms: Date.now(),
        sync_state: 'ready',
        last_sync_attempt_at_ms: Date.now(),
        last_sync_error_code: '',
        last_sync_error_message: '',
        catalog_freshness: 'fresh',
      }],
    }).environments.find((environment) => environment.env_public_id === 'env_dual_route');

    expect(dualRouteEntry).toBeTruthy();
    const actionModel = buildProviderBackedEnvironmentActionModel({
      ...dualRouteEntry!,
      open_local_session_key: 'managed:env_dual_route:local_host',
    });
    expect(actionModel.action_presentation.kind).toBe('split_button');
    if (actionModel.action_presentation.kind !== 'split_button') {
      throw new Error('Expected split-button presentation.');
    }
    expect(actionModel.action_presentation.default_action).toEqual(expect.objectContaining({
      intent: 'focus',
      label: 'Focus',
      route: 'local_host',
    }));
    expect(actionModel.action_presentation.menu_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        section: 'local',
        label: 'Focus Local Window',
        is_default: true,
      }),
      expect.objectContaining({
        section: 'remote',
        label: 'Open via Control Plane',
        is_default: false,
      }),
    ]));
  });

  it('keeps remote recovery actions in the split-button menu when the remote route is stale or needs reconnect', () => {
    const dualRoute = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_dual_route');
    const baseEntry = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [dualRoute],
      }),
    }).environments.find((environment) => environment.id === dualRoute.id);

    expect(baseEntry).toBeTruthy();

    const staleModel = buildProviderBackedEnvironmentActionModel({
      ...baseEntry!,
      control_plane_label: 'Demo Portal',
      remote_route_state: 'stale',
      remote_state_reason: 'Remote status is stale. Refresh the provider to confirm the current state.',
    });
    expect(staleModel.status_label).toBe('Local Ready');
    expect(staleModel.action_presentation.kind).toBe('split_button');
    if (staleModel.action_presentation.kind !== 'split_button') {
      throw new Error('Expected split-button presentation.');
    }
    expect(staleModel.action_presentation.default_action).toEqual(expect.objectContaining({
      route: 'local_host',
      label: 'Open',
    }));
    expect(staleModel.action_presentation.menu_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'remote_refresh',
        label: 'Refresh Remote Status',
        detail: 'Remote status is stale. Refresh the provider to confirm the current state.',
      }),
    ]));

    const reconnectModel = buildProviderBackedEnvironmentActionModel({
      ...baseEntry!,
      control_plane_label: 'Demo Portal',
      remote_route_state: 'auth_required',
      remote_state_reason: 'Reconnect this Control Plane in your browser to restore access.',
    });
    expect(reconnectModel.status_label).toBe('Local Ready');
    expect(reconnectModel.action_presentation.kind).toBe('split_button');
    if (reconnectModel.action_presentation.kind !== 'split_button') {
      throw new Error('Expected split-button presentation.');
    }
    expect(reconnectModel.action_presentation.menu_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'remote_reconnect',
        label: 'Reconnect Control Plane',
        detail: 'Reconnect this Control Plane in your browser to restore access.',
      }),
    ]));
  });

  it('shows a Focus default and both focus routes when both managed routes are already open', () => {
    const dualRoute = testManagedControlPlaneEnvironment('https://cp.example.invalid', 'env_dual_route', {
      preferredOpenRoute: 'remote_desktop',
    });
    const baseEntry = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [dualRoute],
      }),
    }).environments.find((environment) => environment.id === dualRoute.id);

    expect(baseEntry).toBeTruthy();
    const actionModel = buildProviderBackedEnvironmentActionModel({
      ...baseEntry!,
      control_plane_label: 'Demo Portal',
      default_open_route: 'remote_desktop',
      open_local_session_key: 'managed:env_dual_route:local_host',
      open_remote_session_key: 'managed:env_dual_route:remote_desktop',
    });
    expect(actionModel.action_presentation.kind).toBe('split_button');
    if (actionModel.action_presentation.kind !== 'split_button') {
      throw new Error('Expected split-button presentation.');
    }
    expect(actionModel.action_presentation.default_action).toEqual(expect.objectContaining({
      intent: 'focus',
      label: 'Focus',
      route: 'remote_desktop',
    }));
    expect(actionModel.action_presentation.menu_actions).toEqual([
      expect.objectContaining({
        section: 'local',
        label: 'Focus Local Window',
        is_default: false,
      }),
      expect.objectContaining({
        section: 'remote',
        label: 'Focus Remote Window',
        is_default: true,
      }),
    ]);
  });

  it('resolves the default dual-route action from open-session state before preferences', () => {
    expect(resolveDefaultDualRouteAction({
      local_action: {
        intent: 'focus',
        label: 'Focus Local',
        enabled: true,
        variant: 'default',
        route: 'local_host',
      },
      remote_action: {
        intent: 'open',
        label: 'Open Remote',
        enabled: true,
        variant: 'outline',
        route: 'remote_desktop',
      },
      local_session_open: true,
      remote_session_open: false,
      managed_preferred_open_route: 'remote_desktop',
      default_open_route: 'remote_desktop',
    })).toEqual(expect.objectContaining({
      intent: 'focus',
      route: 'local_host',
    }));
  });

  it('splits pinned entries ahead of the regular environment list', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        managed_environments: [
          testManagedLocalEnvironment('default', { pinned: true }),
          testManagedLocalEnvironment('lab', { pinned: false }),
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

    const grouped = splitPinnedEnvironmentEntries(snapshot.environments);

    expect(grouped.pinned_entries.map((environment) => environment.label)).toEqual([
      'Local Environment',
      'Staging',
    ]);
    expect(grouped.regular_entries.map((environment) => environment.id)).toContain('local:lab');
  });
});
