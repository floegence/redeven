import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import {
  buildExternalLocalUIDesktopTarget,
  buildLocalEnvironmentDesktopTarget,
  buildSSHDesktopTarget,
} from '../main/desktopTarget';
import {
  desktopControlPlaneKey,
  type DesktopControlPlaneSummary,
  type DesktopProviderEnvironmentRuntimeHealth,
} from '../shared/controlPlaneProvider';
import type {
  RuntimeServiceOpenReadiness,
  RuntimeServiceProviderLinkBinding,
  RuntimeServiceSnapshot,
} from '../shared/runtimeService';
import {
  testDesktopPreferences,
  testProviderEnvironment,
  testProviderBoundLocalEnvironment,
  testLocalEnvironment,
  testLocalEnvironmentSession,
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
    provider_id: 'example_control_plane',
    display_name: 'Example Control Plane',
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
    display_label: options.displayLabel ?? 'Demo Control Plane',
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

function providerRuntimeState(envPublicID = 'env_demo') {
  return {
    controlplane_base_url: 'https://cp.example.invalid',
    controlplane_provider_id: 'example_control_plane',
    env_public_id: envPublicID,
  };
}

function providerRuntimeService(
  openReadiness: RuntimeServiceOpenReadiness = { state: 'openable' },
  providerLink?: Partial<RuntimeServiceProviderLinkBinding>,
): RuntimeServiceSnapshot {
  const providerLinkBinding: RuntimeServiceProviderLinkBinding = {
    state: providerLink?.state ?? 'unbound',
    provider_origin: providerLink?.provider_origin,
    provider_id: providerLink?.provider_id,
    env_public_id: providerLink?.env_public_id,
    local_environment_public_id: providerLink?.local_environment_public_id,
    binding_generation: providerLink?.binding_generation,
    remote_enabled: providerLink?.state === 'linked',
    last_connected_at_unix_ms: providerLink?.last_connected_at_unix_ms,
    last_disconnected_at_unix_ms: providerLink?.last_disconnected_at_unix_ms,
    last_error_code: providerLink?.last_error_code,
    last_error_message: providerLink?.last_error_message,
  };
  return {
    protocol_version: 'redeven-runtime-v1',
    service_owner: 'desktop',
    desktop_managed: true,
    effective_run_mode: 'desktop',
    remote_enabled: false,
    compatibility: 'compatible',
    open_readiness: openReadiness,
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
      provider_link: providerLinkBinding,
    },
  };
}

describe('buildEnvironmentCardModel', () => {
  it('builds local, provider, URL, and SSH cards from the aggregated launcher entries', () => {
    const local = testLocalEnvironment({
      currentRuntime: {
        local_ui_url: 'http://localhost:23998/',
        desktop_managed: true,
        effective_run_mode: 'desktop',
        remote_enabled: true,
        runtime_service: {
          runtime_version: 'v1.4.2',
          protocol_version: 'redeven-runtime-v1',
          service_owner: 'desktop',
          desktop_managed: true,
          effective_run_mode: 'desktop',
          remote_enabled: true,
          compatibility: 'compatible',
          open_readiness: { state: 'openable' },
          active_workload: {
            terminal_count: 2,
            session_count: 1,
            task_count: 0,
            port_forward_count: 1,
          },
        },
      },
    });
    const localServe = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Demo Local Serve',
    });
    const controlPlane = buildControlPlaneSummary({});
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
        saved_environments: [
          {
            id: 'http://192.168.1.12:24000/',
            label: 'Staging',
            local_ui_url: 'http://192.168.1.12:24000/',
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
            pinned: false,
            last_used_at_ms: 30,
          },
        ],
      }),
      controlPlanes: [controlPlane],
      openSessions: [
        testLocalEnvironmentSession(local, 'http://localhost:23998/', 'open', {
          runtime_service: {
            runtime_version: 'v1.4.2',
            protocol_version: 'redeven-runtime-v1',
            service_owner: 'desktop',
            desktop_managed: true,
            effective_run_mode: 'desktop',
            remote_enabled: true,
            compatibility: 'compatible',
            open_readiness: { state: 'openable' },
            active_workload: {
              terminal_count: 2,
              session_count: 1,
              task_count: 0,
              port_forward_count: 1,
            },
          },
        }),
        testLocalEnvironmentSession(localServe, 'http://127.0.0.1:24001/', 'open', {
          runtime_service: {
            runtime_version: 'v1.4.2',
            protocol_version: 'redeven-runtime-v1',
            service_owner: 'desktop',
            desktop_managed: true,
            effective_run_mode: 'hybrid',
            remote_enabled: true,
            compatibility: 'compatible',
            open_readiness: { state: 'openable' },
            active_workload: {
              terminal_count: 1,
              session_count: 1,
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
        }),
        {
          session_key: 'url:http://192.168.1.12:24000/',
          target: buildExternalLocalUIDesktopTarget('http://192.168.1.12:24000/', { label: 'Staging' }),
          lifecycle: 'open' as const,
          startup: {
            local_ui_url: 'http://192.168.1.12:24000/',
            local_ui_urls: ['http://192.168.1.12:24000/'],
            runtime_service: {
              runtime_version: 'v1.4.1',
              protocol_version: 'redeven-runtime-v1',
              service_owner: 'external',
              desktop_managed: false,
              effective_run_mode: 'standalone',
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
        {
          session_key: 'ssh:ops@example.internal:2222:key_agent:/opt/redeven-desktop/runtime',
          target: buildSSHDesktopTarget(
            {
              ssh_destination: 'ops@example.internal',
              ssh_port: 2222,
              auth_mode: 'key_agent',
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
            runtime_service: {
              runtime_version: 'v1.4.0',
              protocol_version: 'redeven-runtime-v1',
              service_owner: 'desktop',
              desktop_managed: true,
              effective_run_mode: 'desktop',
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
    });

    const localEntry = snapshot.environments.find((environment) => (
      environment.kind === 'local_environment' && environment.local_environment_kind === 'local'
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
      status_label: 'Open',
      target_primary: 'http://localhost:23998/',
    }));
    expect(buildEnvironmentCardModel(providerEntry!)).toEqual(expect.objectContaining({
      kind_label: 'Provider',
      status_label: 'Open',
      target_primary: 'https://cp.example.invalid/env/env_demo',
      target_secondary: '',
    }));
    expect(buildEnvironmentCardModel(urlEntry!)).toEqual(expect.objectContaining({
      kind_label: 'Redeven URL',
      status_label: 'Open',
    }));
    expect(buildEnvironmentCardModel(sshEntry!)).toEqual(expect.objectContaining({
      kind_label: 'SSH Host',
      status_label: 'Open',
      target_primary: 'ops@example.internal:2222',
      target_secondary: 'http://127.0.0.1:24111/',
    }));

    expect(buildEnvironmentCardFactsModel(localEntry!)).toEqual([
      defaultFact('RUNS ON', 'This device'),
      defaultFact('RUNTIME SERVICE', 'Running'),
      defaultFact('VERSION', 'v1.4.2'),
      defaultFact('ACTIVE WORK', '2 terminals, 1 session, 1 port forward'),
      placeholderFact('PROVIDER'),
    ]);
    expect(buildEnvironmentCardFactsModel(providerEntry!)).toEqual([
      defaultFact('RUNS ON', 'Provider remote'),
      defaultFact('PROVIDER', 'Demo Control Plane'),
      defaultFact('LOCAL LINK', 'No managed runtime linked'),
      defaultFact('SOURCE ENV', 'env_demo'),
    ]);
    expect(buildEnvironmentCardFactsModel(urlEntry!)).toEqual([
      defaultFact('RUNS ON', 'LAN host'),
      defaultFact('RUNTIME SERVICE', 'External service'),
      defaultFact('VERSION', 'v1.4.1'),
      defaultFact('ACTIVE WORK', '1 session'),
    ]);
    expect(buildEnvironmentCardFactsModel(sshEntry!)).toEqual([
      defaultFact('RUNS ON', 'ops@example.internal:2222'),
      defaultFact('RUNTIME SERVICE', 'Running'),
      defaultFact('VERSION', 'v1.4.0'),
      defaultFact('ACTIVE WORK', '1 terminal, 1 session'),
      defaultFact('BOOTSTRAP', 'Desktop upload'),
    ]);

    expect(buildEnvironmentCardEndpointsModel(providerEntry!)).toEqual([
      {
        label: 'PROVIDER',
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
    const local = testLocalEnvironment();
    const controlPlane = buildControlPlaneSummary({});
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
        saved_environments: [{
          id: 'http://192.168.1.12:24000/',
          label: 'Staging',
          local_ui_url: 'http://192.168.1.12:24000/',
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
      desktopControlPlaneKey('https://cp.example.invalid', 'example_control_plane'),
    ).map((environment) => environment.kind)).toEqual([
      'provider_environment',
    ]);
  });

  it('shows runtime maintenance state in the stable card fact slot', () => {
    const local = testLocalEnvironment({
      currentRuntime: {
        local_ui_url: 'http://localhost:23998/',
        desktop_managed: true,
        effective_run_mode: 'desktop',
        remote_enabled: true,
        runtime_service: {
          runtime_version: 'v1.4.3',
          protocol_version: 'redeven-runtime-v1',
          service_owner: 'desktop',
          desktop_managed: true,
          effective_run_mode: 'desktop',
          remote_enabled: true,
          compatibility: 'update_available',
          open_readiness: { state: 'openable' },
          active_workload: {
            terminal_count: 1,
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
      openSessions: [
        testLocalEnvironmentSession(local, 'http://localhost:23998/', 'open', {
          runtime_service: {
            runtime_version: 'v1.4.3',
            protocol_version: 'redeven-runtime-v1',
            service_owner: 'desktop',
            desktop_managed: true,
            effective_run_mode: 'desktop',
            remote_enabled: true,
            compatibility: 'update_available',
            open_readiness: { state: 'openable' },
            active_workload: {
              terminal_count: 1,
              session_count: 0,
              task_count: 0,
              port_forward_count: 0,
            },
          },
        }),
      ],
    });
    const localEntry = snapshot.environments.find((environment) => (
      environment.kind === 'local_environment' && environment.local_environment_kind === 'local'
    ));

    expect(localEntry).toBeTruthy();
    expect(buildEnvironmentCardFactsModel(localEntry!)).toEqual([
      defaultFact('RUNS ON', 'This device'),
      defaultFact('RUNTIME SERVICE', 'Update ready'),
      defaultFact('VERSION', 'v1.4.3'),
      defaultFact('ACTIVE WORK', '1 terminal'),
      placeholderFact('PROVIDER'),
    ]);
  });

  it('keeps an online SSH runtime visible but blocks Open when the running runtime needs an update', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        saved_ssh_environments: [{
          id: 'ssh_saved',
          label: 'Prod SSH',
          ssh_destination: 'ops@example.internal',
          ssh_port: 2222,
          auth_mode: 'key_agent',
          remote_install_dir: '/opt/redeven-desktop/runtime',
          bootstrap_strategy: 'desktop_upload',
          release_base_url: '',
          pinned: false,
          last_used_at_ms: 30,
        }],
      }),
      savedSSHRuntimeHealth: {
        ssh_saved: {
          status: 'online',
          checked_at_unix_ms: Date.now(),
          source: 'ssh_runtime_probe',
          local_ui_url: 'http://127.0.0.1:24111/',
          runtime_maintenance: {
            kind: 'ssh_runtime_update_required',
            required_for: 'open',
            can_desktop_restart: true,
            has_active_work: true,
            active_work_label: '1 terminal, 1 session, 1 port forward',
            current_runtime_version: 'v0.5.9',
            target_runtime_version: 'v0.6.7',
            message: 'Update and restart this SSH runtime before opening this environment.',
          },
          runtime_service: {
            runtime_version: 'v0.5.9',
            protocol_version: 'redeven-runtime-v1',
            service_owner: 'desktop',
            desktop_managed: true,
            effective_run_mode: 'desktop',
            remote_enabled: false,
            compatibility: 'compatible',
            open_readiness: {
              state: 'blocked',
              reason_code: 'runtime_open_readiness_unavailable',
              message: 'This running runtime is older than this Desktop. Install the update, then restart the runtime when it is safe to interrupt active work.',
            },
            active_workload: {
              terminal_count: 1,
              session_count: 1,
              task_count: 0,
              port_forward_count: 1,
            },
          },
        },
      },
    });
    const entry = snapshot.environments.find((environment) => environment.kind === 'ssh_environment');

    expect(entry).toBeTruthy();
    expect(buildEnvironmentCardModel(entry!)).toEqual(expect.objectContaining({
      kind_label: 'SSH Host',
      status_label: 'RUNTIME NEEDS UPDATE',
      status_tone: 'warning',
      target_secondary: 'http://127.0.0.1:24111/',
    }));
    expect(buildEnvironmentCardFactsModel(entry!)).toEqual([
      defaultFact('RUNS ON', 'ops@example.internal:2222'),
      defaultFact('RUNTIME SERVICE', 'Needs update'),
      defaultFact('VERSION', 'v0.5.9'),
      defaultFact('ACTIVE WORK', '1 terminal, 1 session, 1 port forward'),
      defaultFact('BOOTSTRAP', 'Desktop upload'),
    ]);
    expect(buildProviderBackedEnvironmentActionModel(entry!)).toEqual({
      status_label: 'RUNTIME NEEDS UPDATE',
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
          eyebrow: 'Runtime blocked',
          title: 'Runtime update required',
          detail: 'This SSH host is reachable, but the running runtime needs an update before it can open this environment. Update and restart the runtime first; Open stays separate and becomes available after the runtime is ready.',
          actions: [
            {
              label: 'Update and restart…',
              emphasis: 'primary',
              action: {
                intent: 'update_runtime',
                label: 'Update and restart…',
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
            id: 'connect_provider_runtime',
            label: 'Connect to provider...',
            action: {
              intent: 'connect_provider_runtime',
              label: 'Connect to provider...',
              enabled: false,
              variant: 'outline',
            },
          },
          {
            id: 'update_runtime',
            label: 'Update and restart…',
            action: {
              intent: 'update_runtime',
              label: 'Update and restart…',
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

  it('treats a missing Env App shell as an update-required SSH runtime block', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        saved_ssh_environments: [{
          id: 'ssh_saved',
          label: 'Dev SSH',
          ssh_destination: 'dev@example.internal',
          ssh_port: 22,
          auth_mode: 'key_agent',
          remote_install_dir: '/opt/redeven-desktop/runtime',
          bootstrap_strategy: 'desktop_upload',
          release_base_url: '',
          pinned: false,
          last_used_at_ms: 30,
        }],
      }),
      savedSSHRuntimeHealth: {
        ssh_saved: {
          status: 'online',
          checked_at_unix_ms: Date.now(),
          source: 'ssh_runtime_probe',
          local_ui_url: 'http://127.0.0.1:24111/',
          runtime_service: {
            runtime_version: 'v0.0.0-dev',
            protocol_version: 'redeven-runtime-v1',
            service_owner: 'desktop',
            desktop_managed: true,
            effective_run_mode: 'desktop',
            remote_enabled: false,
            compatibility: 'compatible',
            open_readiness: {
              state: 'blocked',
              reason_code: 'env_app_shell_unavailable',
              message: 'The Environment App shell is not available in this runtime build. Install the update, then restart the runtime when it is safe to interrupt active work.',
            },
            active_workload: {
              terminal_count: 0,
              session_count: 0,
              task_count: 0,
              port_forward_count: 0,
            },
          },
        },
      },
    });
    const entry = snapshot.environments.find((environment) => environment.kind === 'ssh_environment');

    expect(entry).toBeTruthy();
    expect(buildEnvironmentCardModel(entry!)).toMatchObject({
      status_label: 'RUNTIME NEEDS UPDATE',
      status_tone: 'warning',
    });
    expect(buildEnvironmentCardFactsModel(entry!)).toContainEqual(defaultFact('RUNTIME SERVICE', 'Needs update'));
    expect(buildProviderBackedEnvironmentActionModel(entry!).action_presentation.primary_action).toMatchObject({
      intent: 'open',
      enabled: false,
    });
    expect(buildProviderBackedEnvironmentActionModel(entry!).action_presentation.primary_action_overlay).toMatchObject({
      kind: 'popover',
      title: 'Runtime update required',
    });
  });

  it('keeps offline runtime controls separate from the primary Open action', () => {
    const localSnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment(),
      }),
    });
    const localEntry = localSnapshot.environments.find((environment) => environment.kind === 'local_environment');
    expect(localEntry).toBeTruthy();
    expect(buildProviderBackedEnvironmentActionModel(localEntry!)).toMatchObject({
      status_label: 'RUNTIME OFFLINE',
      status_tone: 'warning',
      action_presentation: {
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
      },
    });

    const externalSnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        saved_environments: [{
          id: 'http://192.168.1.77:24000/',
          label: 'Offline URL',
          local_ui_url: 'http://192.168.1.77:24000/',
          pinned: false,
          last_used_at_ms: 20,
        }],
      }),
    });
    const externalEntry = externalSnapshot.environments.find((environment) => environment.kind === 'external_local_ui');
    expect(externalEntry).toBeTruthy();
    expect(buildProviderBackedEnvironmentActionModel(externalEntry!)).toMatchObject({
      status_label: 'RUNTIME OFFLINE',
      status_tone: 'warning',
      action_presentation: {
        primary_action: {
          intent: 'open',
          label: 'Open',
          enabled: false,
          variant: 'default',
        },
        primary_action_overlay: {
          kind: 'tooltip',
          tone: 'warning',
          message: 'Runtime is offline or unavailable right now. Start it from its source, then refresh status.',
        },
      },
    });
  });

  it('builds provider-card actions around provider remote availability', () => {
    const controlPlane = buildControlPlaneSummary({
      status: 'offline',
      lifecycleStatus: 'suspended',
    });
    const providerOnlySnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment(),
        control_planes: [controlPlane],
      }),
      controlPlanes: [controlPlane],
    });
    const providerOnlyEntry = providerOnlySnapshot.environments.find((environment) => (
      environment.kind === 'provider_environment' && environment.env_public_id === 'env_demo'
    ));

    expect(providerOnlyEntry).toBeTruthy();
    expect(buildProviderBackedEnvironmentActionModel(providerOnlyEntry!)).toEqual({
      status_label: 'REMOTE OFFLINE',
      status_tone: 'warning',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'open',
          label: 'Open',
          enabled: false,
          variant: 'default',
          route: 'remote_desktop',
        },
        primary_action_overlay: {
          kind: 'popover',
          tone: 'warning',
          eyebrow: 'Remote route unavailable',
          title: 'Provider reports offline',
          detail: 'The provider currently reports this environment as offline.',
          actions: [{
            label: 'Refresh status',
            emphasis: 'secondary',
            action: {
              intent: 'refresh_runtime',
              label: 'Refresh provider status',
              enabled: true,
              variant: 'outline',
            },
          }],
        },
        menu_button_label: 'Runtime actions',
        menu_actions: [
          {
            id: 'refresh_runtime',
            label: 'Refresh provider status',
            action: {
              intent: 'refresh_runtime',
              label: 'Refresh provider status',
              enabled: true,
              variant: 'outline',
            },
          },
        ],
      },
    });

    const savedLocalServeSnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment(),
        control_planes: [controlPlane],
      }),
      controlPlanes: [controlPlane],
    });
    const savedLocalServeProviderEntry = savedLocalServeSnapshot.environments.find((environment) => environment.kind === 'provider_environment');
    expect(buildProviderBackedEnvironmentActionModel(savedLocalServeProviderEntry!)).toEqual(buildProviderBackedEnvironmentActionModel(providerOnlyEntry!));

    const staleControlPlane = {
      ...buildControlPlaneSummary({
        catalogFreshness: 'stale',
      }),
      last_synced_at_ms: 1,
      last_sync_attempt_at_ms: 1,
    };
    const staleProviderSnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment(),
        provider_environments: [
          testProviderEnvironment('https://cp.example.invalid', 'env_demo', {
            preferredOpenRoute: 'remote_desktop',
          }),
        ],
        control_planes: [staleControlPlane],
      }),
      controlPlanes: [staleControlPlane],
    });
    const staleProviderEntry = staleProviderSnapshot.environments.find((environment) => (
      environment.kind === 'provider_environment' && environment.env_public_id === 'env_demo'
    ));
    expect(staleProviderEntry).toBeTruthy();
    expect(buildProviderBackedEnvironmentActionModel(staleProviderEntry!)).toMatchObject({
      status_label: 'REFRESH NEEDED',
      status_tone: 'warning',
      action_presentation: {
        primary_action_overlay: {
          kind: 'popover',
          title: 'Provider status is stale',
          detail: 'Remote status is stale. Refresh the provider to confirm the current state.',
          actions: [{
            label: 'Refresh status',
            emphasis: 'secondary',
          }],
        },
      },
    });

    const unboundRuntimeSnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment({
          currentRuntime: {
            local_ui_url: 'http://127.0.0.1:24001/',
            desktop_managed: true,
            effective_run_mode: 'desktop',
            runtime_control: {
              protocol_version: 'redeven-runtime-control-v1',
              base_url: 'http://127.0.0.1:25000/',
              token: 'runtime-control-token',
              desktop_owner_id: 'desktop-owner-test',
            },
            runtime_service: providerRuntimeService(),
          },
        }),
        control_planes: [controlPlane],
      }),
      controlPlanes: [controlPlane],
    });
    const unboundRuntimeProviderEntry = unboundRuntimeSnapshot.environments.find((environment) => environment.kind === 'provider_environment');
    const unboundRuntimeLocalEntry = unboundRuntimeSnapshot.environments.find((environment) => environment.kind === 'local_environment');
    expect(unboundRuntimeProviderEntry?.provider_linked_runtime_summary).toBeUndefined();
    expect(buildProviderBackedEnvironmentActionModel(unboundRuntimeProviderEntry!)).toMatchObject({
      status_label: 'REMOTE OFFLINE',
      status_tone: 'warning',
      action_presentation: {
        primary_action: {
          intent: 'open',
          label: 'Open',
          enabled: false,
          route: 'remote_desktop',
        },
        menu_actions: [
          expect.objectContaining({ id: 'refresh_runtime' }),
        ],
        primary_action_overlay: {
          kind: 'popover',
          title: 'Provider reports offline',
        },
      },
    });
    expect(buildProviderBackedEnvironmentActionModel(unboundRuntimeLocalEntry!)).toMatchObject({
      action_presentation: {
        menu_actions: expect.arrayContaining([{
          id: 'connect_provider_runtime',
          label: 'Connect to provider...',
          action: {
            intent: 'connect_provider_runtime',
            label: 'Connect to provider...',
            enabled: true,
            variant: 'outline',
          },
        }]),
      },
    });

    const openLocalServeSnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment({
          currentRuntime: {
            local_ui_url: 'http://127.0.0.1:24001/',
            desktop_managed: true,
            effective_run_mode: 'desktop',
            ...providerRuntimeState('env_demo'),
            runtime_service: providerRuntimeService({ state: 'openable' }, {
              state: 'linked',
              provider_origin: 'https://cp.example.invalid',
              provider_id: 'example_control_plane',
              env_public_id: 'env_demo',
            }),
          },
        }),
        control_planes: [controlPlane],
      }),
      controlPlanes: [controlPlane],
    });
    const openLocalServeProviderEntry = openLocalServeSnapshot.environments.find((environment) => environment.kind === 'provider_environment');
    const openLocalServeLocalEntry = openLocalServeSnapshot.environments.find((environment) => environment.kind === 'local_environment');
    expect(openLocalServeProviderEntry).toMatchObject({
      provider_linked_runtime_summary: {
        runtime_target_id: 'local:local',
        runtime_kind: 'local_environment',
        label: 'Local Environment',
      },
    });
    expect(buildProviderBackedEnvironmentActionModel(openLocalServeProviderEntry!)).toMatchObject({
      status_label: 'REMOTE OFFLINE',
      status_tone: 'warning',
      action_presentation: {
        primary_action: {
          intent: 'open',
          route: 'remote_desktop',
          enabled: false,
        },
        menu_actions: [
          expect.objectContaining({ id: 'refresh_runtime' }),
        ],
      },
    });
    expect(buildProviderBackedEnvironmentActionModel(openLocalServeLocalEntry!)).toMatchObject({
      action_presentation: {
        menu_actions: expect.arrayContaining([{
          id: 'disconnect_provider_runtime',
          label: 'Disconnect from provider',
          action: {
            intent: 'disconnect_provider_runtime',
            label: 'Disconnect from provider',
            enabled: true,
            variant: 'outline',
          },
        }]),
      },
    });

    const readyControlPlane = buildControlPlaneSummary({
      status: 'online',
      lifecycleStatus: 'active',
    });
    const readySnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment(),
        control_planes: [readyControlPlane],
      }),
      controlPlanes: [readyControlPlane],
    });
    const readyEntry = readySnapshot.environments.find((environment) => environment.kind === 'provider_environment');
    expect(buildProviderBackedEnvironmentActionModel(readyEntry!)).toEqual({
      status_label: 'Open',
      status_tone: 'success',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'open',
          label: 'Open',
          enabled: true,
          variant: 'default',
          route: 'remote_desktop',
        },
        primary_action_overlay: undefined,
        menu_button_label: 'Runtime actions',
        menu_actions: [
          {
            id: 'refresh_runtime',
            label: 'Refresh provider status',
            action: {
              intent: 'refresh_runtime',
              label: 'Refresh provider status',
              enabled: true,
              variant: 'outline',
            },
          },
        ],
      },
    });
  });

  it('keeps provider Open isolated from busy runtime provider-link state', () => {
    const controlPlane = buildControlPlaneSummary({
      status: 'offline',
      lifecycleStatus: 'suspended',
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment({
          currentRuntime: {
            local_ui_url: 'http://127.0.0.1:24001/',
            desktop_managed: true,
            effective_run_mode: 'desktop',
            runtime_control: {
              protocol_version: 'redeven-runtime-control-v1',
              base_url: 'http://127.0.0.1:25000/',
              token: 'runtime-control-token',
              desktop_owner_id: 'desktop-owner-test',
            },
            runtime_service: providerRuntimeService({
              state: 'openable',
            }),
          },
        }),
        control_planes: [controlPlane],
      }),
      controlPlanes: [controlPlane],
    });
    const entry = snapshot.environments.find((environment) => environment.kind === 'provider_environment');
    const localEntry = snapshot.environments.find((environment) => environment.kind === 'local_environment');
    const busyRuntimeService = {
      ...providerRuntimeService({ state: 'openable' }, {
        state: 'linked',
        provider_origin: 'https://other.example.invalid',
        provider_id: 'other_control_plane',
        env_public_id: 'other_env',
      }),
      active_workload: {
        terminal_count: 1,
        session_count: 0,
        task_count: 0,
        port_forward_count: 0,
      },
    };
    const busySnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment({
          currentRuntime: {
            local_ui_url: 'http://127.0.0.1:24001/',
            desktop_managed: true,
            effective_run_mode: 'desktop',
            runtime_control: {
              protocol_version: 'redeven-runtime-control-v1',
              base_url: 'http://127.0.0.1:25000/',
              token: 'runtime-control-token',
              desktop_owner_id: 'desktop-owner-test',
            },
            runtime_service: busyRuntimeService,
          },
        }),
        control_planes: [controlPlane],
      }),
      controlPlanes: [controlPlane],
    });
    const busyEntry = busySnapshot.environments.find((environment) => environment.kind === 'provider_environment');
    const busyLocalEntry = busySnapshot.environments.find((environment) => environment.kind === 'local_environment');

    expect(entry?.provider_linked_runtime_summary).toBeUndefined();
    expect(localEntry?.provider_runtime_link_target).toMatchObject({
      can_connect_provider: true,
      runtime_running: true,
    });
    expect(busyEntry?.provider_linked_runtime_summary).toBeUndefined();
    expect(busyLocalEntry?.provider_runtime_link_target).toMatchObject({
      provider_link_state: 'linked',
      provider_origin: 'https://other.example.invalid',
      can_connect_provider: false,
      can_disconnect_provider: true,
    });
    expect(buildProviderBackedEnvironmentActionModel(busyEntry!)).toMatchObject({
      status_label: 'REMOTE OFFLINE',
      status_tone: 'warning',
      action_presentation: {
        primary_action: {
          intent: 'open',
          label: 'Open',
          enabled: false,
          route: 'remote_desktop',
        },
        primary_action_overlay: {
          kind: 'popover',
          title: 'Provider reports offline',
        },
      },
    });
  });

  it('shows provider remote readiness only when the effective provider route is remote', () => {
    const readyControlPlane = buildControlPlaneSummary({
      status: 'online',
      lifecycleStatus: 'active',
    });
    const remotePreferred = testProviderEnvironment('https://cp.example.invalid', 'env_demo', {
      preferredOpenRoute: 'remote_desktop',
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment(),
        control_planes: [readyControlPlane],
        provider_environments: [remotePreferred],
      }),
      controlPlanes: [readyControlPlane],
    });
    const entry = snapshot.environments.find((environment) => environment.kind === 'provider_environment');

    expect(entry).toMatchObject({
      runtime_health: expect.objectContaining({
        status: 'online',
        source: 'provider_batch_probe',
      }),
    });
    expect(buildProviderBackedEnvironmentActionModel(entry!)).toMatchObject({
      status_label: 'Open',
      action_presentation: {
        primary_action: {
          intent: 'open',
          label: 'Open',
          enabled: true,
        },
      },
    });
  });

  it('uses provider reconnect as the provider-card action when authorization expired', () => {
    const controlPlane = buildControlPlaneSummary({
      status: 'offline',
      lifecycleStatus: 'suspended',
      syncState: 'auth_required',
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment(),
        control_planes: [controlPlane],
      }),
      controlPlanes: [controlPlane],
    });
    const entry = snapshot.environments.find((environment) => environment.kind === 'provider_environment');

    expect(entry?.control_plane_sync_state).toBe('auth_required');
    expect(buildProviderBackedEnvironmentActionModel(entry!)).toEqual({
      status_label: 'RECONNECT REQUIRED',
      status_tone: 'warning',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'reconnect_provider',
          label: 'Reconnect Provider',
          enabled: true,
          variant: 'default',
          provider_origin: 'https://cp.example.invalid',
          provider_id: 'example_control_plane',
        },
        primary_action_overlay: {
          kind: 'tooltip',
          tone: 'warning',
          message: 'Desktop needs fresh provider authorization before it can open or connect this provider Environment.',
        },
        menu_button_label: 'Runtime actions',
        menu_actions: [{
          id: 'reconnect_provider',
          label: 'Reconnect Provider',
          action: {
            intent: 'reconnect_provider',
            label: 'Reconnect Provider',
            enabled: true,
            variant: 'default',
            provider_origin: 'https://cp.example.invalid',
            provider_id: 'example_control_plane',
          },
        }],
      },
    });
  });

  it('keeps provider cards on the provider tunnel when managed runtimes are linked', () => {
    const providerRuntime = {
      local_ui_url: 'http://127.0.0.1:24001/',
      desktop_managed: false,
      ...providerRuntimeState('env_demo'),
      runtime_service: providerRuntimeService({ state: 'openable' }, {
        state: 'linked',
        provider_origin: 'https://cp.example.invalid',
        provider_id: 'example_control_plane',
        env_public_id: 'env_demo',
      }),
    };
    const attachableLocalServe = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: testLocalEnvironment({
            currentRuntime: providerRuntime,
          }),
      }),
      controlPlanes: [buildControlPlaneSummary({
        status: 'offline',
        lifecycleStatus: 'suspended',
      })],
    }).environments.find((environment) => environment.kind === 'provider_environment');

    expect(attachableLocalServe).toBeTruthy();
    expect(buildProviderBackedEnvironmentActionModel(attachableLocalServe!)).toEqual({
      status_label: 'REMOTE OFFLINE',
      status_tone: 'warning',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'open',
          label: 'Open',
          enabled: false,
          variant: 'default',
          route: 'remote_desktop',
        },
        primary_action_overlay: {
          kind: 'popover',
          tone: 'warning',
          eyebrow: 'Remote route unavailable',
          title: 'Provider reports offline',
          detail: 'The provider currently reports this environment as offline.',
          actions: [{
            label: 'Refresh status',
            emphasis: 'secondary',
            action: {
              intent: 'refresh_runtime',
              label: 'Refresh provider status',
              enabled: true,
              variant: 'outline',
            },
          }],
        },
        menu_button_label: 'Runtime actions',
        menu_actions: [
          {
            id: 'refresh_runtime',
            label: 'Refresh provider status',
            action: {
              intent: 'refresh_runtime',
              label: 'Refresh provider status',
              enabled: true,
              variant: 'outline',
            },
          },
        ],
      },
    });

    const focusableLocalEnvironment = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo', {
      currentRuntime: {
        local_ui_url: 'http://127.0.0.1:24001/',
        desktop_managed: true,
        effective_run_mode: 'desktop',
        ...providerRuntimeState('env_demo'),
        runtime_service: providerRuntimeService({ state: 'openable' }, {
          state: 'linked',
          provider_origin: 'https://cp.example.invalid',
          provider_id: 'example_control_plane',
          env_public_id: 'env_demo',
        }),
      },
    });
    const focusableLocalServe = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: focusableLocalEnvironment,
      }),
      controlPlanes: [buildControlPlaneSummary({})],
      openSessions: [
        testLocalEnvironmentSession(
          focusableLocalEnvironment,
          'http://127.0.0.1:24001/',
        ),
      ],
    }).environments.find((environment) => environment.kind === 'provider_environment');

    expect(focusableLocalServe).toBeTruthy();
    expect(buildProviderBackedEnvironmentActionModel(focusableLocalServe!)).toEqual({
      status_label: 'Open',
      status_tone: 'success',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'open',
          label: 'Open',
          enabled: true,
          variant: 'default',
          route: 'remote_desktop',
        },
        primary_action_overlay: undefined,
        menu_button_label: 'Runtime actions',
        menu_actions: [
          {
            id: 'refresh_runtime',
            label: 'Refresh provider status',
            action: {
              intent: 'refresh_runtime',
              label: 'Refresh provider status',
              enabled: true,
              variant: 'outline',
            },
          },
        ],
      },
    });
  });

  it('treats opening managed sessions as a disabled Opening state instead of Focus', () => {
    const localServe = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_opening', {
      currentRuntime: {
        local_ui_url: 'http://localhost:23998/',
        desktop_managed: true,
        effective_run_mode: 'desktop',
        ...providerRuntimeState('env_opening'),
        runtime_service: providerRuntimeService(),
      },
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: localServe,
      }),
      openSessions: [
        testLocalEnvironmentSession(localServe, 'http://localhost:23998/', 'opening'),
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
      status_label: 'Open',
      status_tone: 'success',
      action_presentation: {
        kind: 'split_button',
        primary_action: {
          intent: 'opening',
          label: 'Open',
          enabled: false,
          variant: 'default',
        },
        primary_action_overlay: undefined,
        menu_button_label: 'Runtime actions',
        menu_actions: [
          {
            id: 'connect_provider_runtime',
            label: 'Connect to provider...',
            action: {
              intent: 'connect_provider_runtime',
              label: 'Connect to provider...',
              enabled: false,
              variant: 'outline',
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

  it('keeps Open disabled while an online runtime is still preparing Env App readiness', () => {
    const local = testLocalEnvironment({
      currentRuntime: {
        local_ui_url: 'http://127.0.0.1:24001/',
        desktop_managed: true,
        ...providerRuntimeState('env_preparing'),
        runtime_service: providerRuntimeService({
            state: 'starting',
            reason_code: 'env_app_gateway_starting',
            message: 'Env App gateway is starting.',
        }),
      },
    });
    const localServe = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_preparing');
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
      }),
    });
    const entry = snapshot.environments.find((environment) => environment.id === localServe.id);

    expect(entry).toBeTruthy();
    expect(buildProviderBackedEnvironmentActionModel(entry!)).toMatchObject({
      status_label: 'RUNTIME PREPARING',
      status_tone: 'warning',
      action_presentation: {
        primary_action: {
          intent: 'open',
          label: 'Open',
          enabled: false,
        },
        primary_action_overlay: {
          kind: 'tooltip',
          tone: 'warning',
          message: 'Env App gateway is starting.',
        },
      },
    });
  });

  it('projects provider remote sessions onto the separate provider card', () => {
    const localServe = testProviderBoundLocalEnvironment('https://cp.example.invalid', 'env_demo');
    const remoteTarget = buildLocalEnvironmentDesktopTarget(localServe, { route: 'remote_desktop' });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: localServe,
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
        local_environment: testLocalEnvironment({ pinned: true }),
        saved_environments: [{
          id: 'http://192.168.1.12:24000/',
          label: 'Staging',
          local_ui_url: 'http://192.168.1.12:24000/',
          pinned: true,
          last_used_at_ms: 20,
        }],
      }),
    });

    expect(splitPinnedEnvironmentEntries(snapshot.environments)).toEqual({
      pinned_entries: expect.arrayContaining([
        expect.objectContaining({ id: 'local' }),
        expect.objectContaining({ id: 'http://192.168.1.12:24000/' }),
      ]),
      regular_entries: [],
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
