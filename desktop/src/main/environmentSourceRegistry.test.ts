import { describe, expect, it } from 'vitest';

import {
  testDesktopPreferences,
  testProviderEnvironment,
} from '../testSupport/desktopTestHelpers';
import { normalizeDesktopControlPlaneProvider, type DesktopControlPlaneSummary } from '../shared/controlPlaneProvider';
import { buildDesktopWelcomeSnapshot } from './desktopWelcomeState';
import {
  buildEnvironmentSourceRegistry,
  gatewayEnvironmentSource,
  localEnvironmentSource,
  providerEnvironmentSource,
} from './environmentSourceRegistry';
import type { DesktopGatewaySource } from '../shared/desktopGateway';

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
    created_at_ms: 10,
    updated_at_ms: 20,
    environments: [],
    ...overrides,
  };
}

function controlPlaneSummary(): DesktopControlPlaneSummary {
  const provider = normalizeDesktopControlPlaneProvider({
    protocol_version: 'rcpp-v1',
    provider_id: 'example_provider',
    provider_origin: 'https://provider.example.invalid',
    display_name: 'Example Provider',
    documentation_url: 'https://provider.example.invalid/docs',
  });
  if (!provider) {
    throw new Error('test provider did not normalize');
  }
  return {
    provider,
    account: {
      provider_id: provider.provider_id,
      provider_origin: provider.provider_origin,
      display_name: provider.display_name,
      user_public_id: 'user_demo',
      user_display_name: 'Demo User',
      authorization_expires_at_unix_ms: Date.now() + 60_000,
    },
    display_label: 'Example Provider',
    environments: [],
    last_synced_at_ms: Date.now(),
    sync_state: 'ready' as const,
    last_sync_attempt_at_ms: Date.now(),
    last_sync_error_code: '',
    last_sync_error_message: '',
    catalog_freshness: 'fresh' as const,
  };
}

describe('environmentSourceRegistry', () => {
  it('registers Local, Provider, and Gateway sources with stable ids', () => {
    const provider = controlPlaneSummary();
    const gateway = gatewaySource();

    expect(localEnvironmentSource('Local').source_id).toBe('local');
    expect(providerEnvironmentSource(provider)).toMatchObject({
      kind: 'provider',
      source_id: 'https://provider.example.invalid|example_provider',
      label: 'Example Provider',
    });
    expect(gatewayEnvironmentSource(gateway)).toMatchObject({
      kind: 'gateway',
      source_id: 'gateway:bastion',
      label: 'Bastion',
    });
  });

  it('keeps source ordering stable without merging different source kinds', () => {
    const registry = buildEnvironmentSourceRegistry({
      localLabel: 'Local',
      controlPlanes: [controlPlaneSummary()],
      gatewaySources: [
        gatewaySource({ gateway_id: 'office', display_name: 'Office' }),
        gatewaySource({ gateway_id: 'bastion', display_name: 'Bastion' }),
      ],
    });

    expect(registry.map((source) => `${source.kind}:${source.source_id}`)).toEqual([
      'local:local',
      'provider:https://provider.example.invalid|example_provider',
      'gateway:gateway:bastion',
      'gateway:gateway:office',
    ]);
  });

  it('removing a Gateway removes its environment rows from the snapshot', () => {
    const providerEnvironment = testProviderEnvironment('https://provider.example.invalid', 'env_demo', {
      label: 'Provider Env',
    });
    const gateway = gatewaySource({
      environments: [{
        gateway_env_id: 'env_demo',
        display_name: 'Provider Env',
        env_kind: 'reachable_env',
        state: 'available',
        capabilities: ['open'],
        origin: { kind: 'network_target', label: 'Bastion network' },
      }],
    });
    const preferences = testDesktopPreferences({
      provider_environments: [providerEnvironment],
    });
    const withGateway = buildDesktopWelcomeSnapshot({
      preferences,
      gatewaySources: [gateway],
    });
    const withoutGateway = buildDesktopWelcomeSnapshot({
      preferences,
      gatewaySources: [],
    });

    expect(withGateway.environments.some((entry) => entry.kind === 'gateway_environment')).toBe(true);
    expect(withoutGateway.environments.some((entry) => entry.kind === 'gateway_environment')).toBe(false);
  });
});
