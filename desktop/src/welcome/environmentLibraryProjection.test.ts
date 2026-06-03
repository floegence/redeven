import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import {
  testDesktopPreferences,
  testLocalEnvironment,
  testProviderEnvironment,
} from '../testSupport/desktopTestHelpers';
import {
  environmentLibraryEntryRecord,
  gatewayLibraryRowRecord,
  gatewayLibraryRows,
  splitPinnedEnvironmentEntryIDs,
  splitGatewayRowIDsByAttention,
} from './environmentLibraryProjection';
import type { DesktopGatewaySource } from '../shared/desktopGateway';

function gatewaySource(overrides: Partial<DesktopGatewaySource> = {}): DesktopGatewaySource {
  return {
    gateway_id: 'bastion',
    display_name: 'Bastion',
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

describe('environmentLibraryProjection', () => {
  it('builds an entry record keyed by stable environment id', () => {
    const local = testLocalEnvironment({
      label: 'Local',
    });
    const providerEnvironment = testProviderEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Demo Local Serve',
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
        provider_environments: [providerEnvironment],
      }),
    });

    expect(environmentLibraryEntryRecord(snapshot.environments)).toEqual(Object.fromEntries(
      snapshot.environments.map((environment) => [environment.id, environment] as const),
    ));
  });

  it('splits visible entry ids into pinned and regular groups without losing order', () => {
    const local = testLocalEnvironment({
      label: 'Local',
      pinned: true,
    });
    const providerEnvironment = testProviderEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Demo Local Serve',
      pinned: false,
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
        provider_environments: [providerEnvironment],
      }),
    });
    const entryIDs = snapshot.environments.map((environment) => environment.id);
    const entriesByID = environmentLibraryEntryRecord(snapshot.environments);

    expect(splitPinnedEnvironmentEntryIDs(entryIDs, entriesByID)).toEqual({
      pinned_entry_ids: [local.id],
      regular_entry_ids: [providerEnvironment.id],
    });
  });

  it('ignores ids that are no longer present in the projected entry record', () => {
    const local = testLocalEnvironment({
      label: 'Local',
      pinned: true,
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
      }),
    });
    const entriesByID = environmentLibraryEntryRecord(snapshot.environments);

    expect(splitPinnedEnvironmentEntryIDs(
      ['missing_environment', local.id],
      entriesByID,
    )).toEqual({
      pinned_entry_ids: [local.id],
      regular_entry_ids: [],
    });
  });

  it('projects Gateway rows with stable row ids and source labels', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      gatewaySources: [gatewaySource()],
    });
    const rows = gatewayLibraryRows(snapshot.environments);

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'gateway:bastion:env:env_demo',
        gateway_id: 'bastion',
        gateway_label: 'Bastion',
        source_label: 'Gateway: Bastion',
        primary_action: expect.objectContaining({
          intent: 'open',
          enabled: true,
          runtime_operation: 'open',
          runtime_operation_method: 'runtime_gateway',
        }),
      }),
    ]);
    expect(gatewayLibraryRowRecord(rows)).toEqual({
      'gateway:bastion:env:env_demo': rows[0],
    });
  });

  it('splits Gateway row ids into ready and attention groups without stale ids', () => {
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences(),
      gatewaySources: [
        gatewaySource(),
        gatewaySource({
          gateway_id: 'office',
          display_name: 'Office',
          status: 'trust_changed',
          trust_state: 'trust_changed',
        }),
      ],
    });
    const rows = gatewayLibraryRows(snapshot.environments);
    const rowsByID = gatewayLibraryRowRecord(rows);

    expect(splitGatewayRowIDsByAttention(
      ['missing', ...rows.map((row) => row.id)],
      rowsByID,
    )).toEqual({
      ready_row_ids: ['gateway:bastion:env:env_demo'],
      attention_row_ids: ['gateway:office:env:env_demo'],
    });
  });
});
