import { describe, expect, it } from 'vitest';

import type { DesktopGatewaySource } from '../shared/desktopGateway';
import {
  testDesktopPreferences,
  testLocalEnvironment,
  testProviderEnvironment,
} from '../testSupport/desktopTestHelpers';
import { buildDesktopWelcomeSnapshot } from './desktopWelcomeState';

function gatewaySource(overrides: Partial<DesktopGatewaySource> = {}): DesktopGatewaySource {
  return {
    gateway_id: 'bastion',
    display_name: 'Bastion',
    local_enabled: true,
    connection_kind: 'url',
    management_capability: 'access_only',
    capabilities: [],
    status: 'online',
    trust_state: 'paired',
    endpoint_label: 'https://gateway.example.invalid',
    created_at_ms: 10,
    updated_at_ms: 20,
    environments: [{
      gateway_env_id: 'env_demo',
      display_name: 'Demo',
      env_kind: 'reachable_env',
      state: 'available',
      capabilities: ['open'],
      origin: { kind: 'network_target', label: 'Bastion network' },
    }],
    ...overrides,
  };
}

describe('environmentAggregator', () => {
  it('keeps same-name Local, Provider, and Gateway environments as separate rows', () => {
    const local = testLocalEnvironment({
      label: 'Demo',
      createdAtMS: 1,
    });
    const providerEnvironment = testProviderEnvironment('https://provider.example.invalid', 'env_demo', {
      label: 'Demo',
      createdAtMS: 2,
    });
    const gateway = gatewaySource({
      created_at_ms: 3,
      environments: [{
        gateway_env_id: 'env_demo',
        display_name: 'Demo',
        env_kind: 'reachable_env',
        state: 'available',
        capabilities: ['open'],
        origin: { kind: 'network_target', label: 'Bastion network' },
      }],
    });

    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
        provider_environments: [providerEnvironment],
      }),
      gatewaySources: [gateway],
    });

    expect(snapshot.environments.filter((entry) => entry.label === 'Demo')).toHaveLength(3);
    expect(snapshot.environments.map((entry) => entry.kind)).toEqual([
      'local_environment',
      'provider_environment',
      'gateway_environment',
    ]);
  });

  it('attaches a visible Gateway source label to Gateway environment rows', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      gatewaySources: [gatewaySource({
        gateway_id: 'lab',
        display_name: 'Lab Docker',
        connection_kind: 'ssh_container',
      })],
    });
    const gatewayEntry = snapshot.environments.find((entry) => entry.kind === 'gateway_environment');

    expect(gatewayEntry).toMatchObject({
      environment_source: {
        kind: 'gateway',
        source_id: 'gateway:lab',
        label: 'Lab Docker',
      },
      gateway_label: 'Lab Docker',
      gateway_connection_kind: 'ssh_container',
    });
  });

  it('maps offline and trust-changed Gateway environments to Resolve without provider fallback', () => {
    const offline = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      gatewaySources: [gatewaySource({
        gateway_id: 'office',
        display_name: 'Office',
        status: 'offline',
        status_message: 'The Gateway is not reachable.',
      })],
    }).environments.find((entry) => entry.kind === 'gateway_environment');
    const trustChanged = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      gatewaySources: [gatewaySource({
        gateway_id: 'bastion',
        display_name: 'Bastion',
        status: 'trust_changed',
        trust_state: 'trust_changed',
      })],
    }).environments.find((entry) => entry.kind === 'gateway_environment');

    expect(offline).toMatchObject({
      tag: 'Resolve',
      gateway_status: 'offline',
      runtime_operations: {
        open: expect.objectContaining({
          availability: 'blocked',
          method: 'runtime_gateway',
          reason_code: 'gateway_requires_resolution',
        }),
      },
    });
    expect(offline?.provider_origin).toBeUndefined();
    expect(offline?.remote_environment_url).toBeUndefined();
    expect(offline?.local_ui_url).toBe('');
    expect(trustChanged).toMatchObject({
      tag: 'Resolve',
      gateway_status: 'trust_changed',
      gateway_trust_state: 'trust_changed',
      runtime_health: expect.objectContaining({
        offline_reason_code: 'auth_required',
      }),
    });
  });

  it('lets Gateway catalog rows inherit open session state without duplicating the row', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      openSessions: [{
        session_key: 'gateway:bastion:env:env_demo',
        target: {
          kind: 'gateway_environment',
          session_key: 'gateway:bastion:env:env_demo',
          environment_id: 'gateway:bastion:env:env_demo',
          label: 'Demo',
          gateway_id: 'bastion',
          gateway_label: 'Bastion',
          gateway_env_id: 'env_demo',
          gateway_session_id: 'gws_demo',
        },
        lifecycle: 'open',
        entry_url: 'https://gateway.example/session',
        startup: {
          local_ui_url: 'https://gateway.example/session',
          local_ui_urls: ['https://gateway.example/session'],
        },
      }],
      gatewaySources: [gatewaySource()],
    });
    const gatewayEntries = snapshot.environments.filter((entry) => entry.kind === 'gateway_environment');

    expect(gatewayEntries).toHaveLength(1);
    expect(gatewayEntries[0]).toMatchObject({
      id: 'gateway:bastion:env:env_demo',
      is_open: true,
      open_action: 'focus',
      open_session_key: 'gateway:bastion:env:env_demo',
    });
  });

  it('hides disabled Gateway catalog rows and does not backfill their open sessions', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      openSessions: [{
        session_key: 'gateway:bastion:env:env_demo',
        target: {
          kind: 'gateway_environment',
          session_key: 'gateway:bastion:env:env_demo',
          environment_id: 'gateway:bastion:env:env_demo',
          label: 'Demo',
          gateway_id: 'bastion',
          gateway_label: 'Bastion',
          gateway_env_id: 'env_demo',
          gateway_session_id: 'gws_demo',
        },
        lifecycle: 'open',
        entry_url: 'https://gateway.example/session',
        startup: {
          local_ui_url: 'https://gateway.example/session',
          local_ui_urls: ['https://gateway.example/session'],
        },
      }],
      gatewaySources: [gatewaySource({ local_enabled: false })],
    });

    expect(snapshot.environments.filter((entry) => entry.kind === 'gateway_environment')).toHaveLength(0);
  });

  it('keeps enabled Gateway open session fallback when its catalog row is temporarily absent', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      openSessions: [{
        session_key: 'gateway:bastion:env:env_demo',
        target: {
          kind: 'gateway_environment',
          session_key: 'gateway:bastion:env:env_demo',
          environment_id: 'gateway:bastion:env:env_demo',
          label: 'Demo',
          gateway_id: 'bastion',
          gateway_label: 'Bastion',
          gateway_env_id: 'env_demo',
          gateway_session_id: 'gws_demo',
        },
        lifecycle: 'open',
        entry_url: 'https://gateway.example/session',
        startup: {
          local_ui_url: 'https://gateway.example/session',
          local_ui_urls: ['https://gateway.example/session'],
        },
      }],
      gatewaySources: [gatewaySource({ environments: [] })],
    });

    expect(snapshot.environments.filter((entry) => entry.kind === 'gateway_environment')).toHaveLength(1);
    expect(snapshot.environments.find((entry) => entry.kind === 'gateway_environment')).toMatchObject({
      open_session_key: 'gateway:bastion:env:env_demo',
      gateway_id: 'bastion',
      gateway_env_id: 'env_demo',
      is_open: true,
    });
  });

  it('shows Gateway lifecycle actions only when both Gateway and environment grant control', () => {
    const environment = {
      gateway_env_id: 'env_managed',
      display_name: 'Managed',
      env_kind: 'managed_local_env' as const,
      state: 'stopped' as const,
      capabilities: ['open', 'start'] as const,
      access_capabilities: ['open'] as const,
      control_capabilities: ['start'] as const,
      origin: { kind: 'gateway_host' as const, label: 'Gateway host' },
    };
    const withoutGatewayLifecycle = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      gatewaySources: [gatewaySource({
        capabilities: ['env_profile_write'],
        environments: [environment],
      })],
    }).environments.find((entry) => entry.kind === 'gateway_environment');
    const withGatewayLifecycle = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      gatewaySources: [gatewaySource({
        capabilities: ['env_profile_write', 'env_lifecycle'],
        environments: [environment],
      })],
    }).environments.find((entry) => entry.kind === 'gateway_environment');

    expect(withoutGatewayLifecycle?.runtime_operations.start).toMatchObject({
      availability: 'hidden',
    });
    expect(withGatewayLifecycle?.runtime_operations.start).toMatchObject({
      availability: 'available',
      method: 'runtime_gateway',
    });
  });

  it('exposes edit and delete for writable Gateway-owned profiles by managed marker', () => {
    const editableSnapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      gatewaySources: [gatewaySource({
        capabilities: ['env_profile_write'],
        environments: [
          {
            gateway_env_id: 'env_url',
            display_name: 'URL Profile',
            env_kind: 'reachable_env',
            state: 'available',
            capabilities: ['open'],
            access_capabilities: ['open'],
            control_capabilities: [],
            profile: { managed: true, access_route_kind: 'url' },
            profile_access_route: {
              kind: 'url',
              url: 'https://target.example/',
              origin_label: 'Target',
            },
            origin: { kind: 'network_target', label: 'Target' },
          },
          {
            gateway_env_id: 'env_ssh',
            display_name: 'SSH Profile',
            env_kind: 'reachable_env',
            state: 'available',
            capabilities: [],
            access_capabilities: [],
            control_capabilities: [],
            profile: { managed: true, access_route_kind: 'ssh_host' },
            profile_access_route: {
              kind: 'ssh_host',
              ssh_destination: 'devbox',
              ssh_port: 2222,
            },
            origin: { kind: 'ssh_target', label: 'devbox' },
          },
          {
            gateway_env_id: 'env_container',
            display_name: 'Container Profile',
            env_kind: 'reachable_env',
            state: 'available',
            capabilities: [],
            access_capabilities: [],
            control_capabilities: [],
            profile: { managed: true, access_route_kind: 'ssh_container' },
            profile_access_route: {
              kind: 'ssh_container',
              ssh_destination: 'devbox',
              container_engine: 'docker',
              container_id: 'workspace',
            },
            origin: { kind: 'container', label: 'devbox / workspace' },
          },
        ],
      })],
    });
    const editable = editableSnapshot.environments.filter((entry) => entry.kind === 'gateway_environment');
    const readOnly = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      gatewaySources: [gatewaySource({
        capabilities: ['env_profile_write'],
        environments: [{
          gateway_env_id: 'env_catalog',
          display_name: 'Catalog Env',
          env_kind: 'reachable_env',
          state: 'available',
          capabilities: ['open'],
          access_capabilities: ['open'],
          control_capabilities: [],
          profile_access_route: {
            kind: 'url',
            url: 'https://target.example/',
          },
          origin: { kind: 'network_target', label: 'Target' },
        }],
      })],
    }).environments.find((entry) => entry.kind === 'gateway_environment');
    const notWritable = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      gatewaySources: [gatewaySource({
        capabilities: [],
        environments: [{
          gateway_env_id: 'env_url',
          display_name: 'URL Profile',
          env_kind: 'reachable_env',
          state: 'available',
          capabilities: ['open'],
          access_capabilities: ['open'],
          control_capabilities: [],
          profile: { managed: true, access_route_kind: 'url' },
          profile_access_route: {
            kind: 'url',
            url: 'https://target.example/',
          },
          origin: { kind: 'network_target', label: 'Target' },
        }],
      })],
    }).environments.find((entry) => entry.kind === 'gateway_environment');

    expect(editable).toHaveLength(3);
    expect(editable.map((entry) => [entry.gateway_env_id, entry.can_edit, entry.can_delete]).sort()).toEqual([
      ['env_url', true, true],
      ['env_ssh', true, true],
      ['env_container', true, true],
    ].sort());
    const editableURL = editable.find((entry) => entry.gateway_env_id === 'env_url');
    expect(editableURL).toMatchObject({
      can_edit: true,
      can_delete: true,
      gateway_environment_profile: {
        managed: true,
        access_route_kind: 'url',
      },
      gateway_environment_profile_access_route: {
        kind: 'url',
        url: 'https://target.example/',
      },
    });
    expect(readOnly).toMatchObject({
      can_edit: false,
      can_delete: false,
    });
    expect(notWritable).toMatchObject({
      can_edit: false,
      can_delete: false,
    });
  });
});
