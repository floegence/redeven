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
    connection_kind: 'url',
    management_capability: 'access_only',
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
});
