import { catalogFixture, memberFixture } from '../testSupport/gatewayMembershipFixture';
import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import {
  testDesktopPreferences,
  testProviderBoundLocalEnvironment,
  testCloudEnvironment,
} from '../testSupport/desktopTestHelpers';
import {
  buildEnvironmentLibraryDisplayGroups,
} from './environmentLibraryProjection';
import { gatewayLibraryRowRecord, gatewayLibraryRows, splitGatewayRowIDsByAttention } from './gatewayLibraryProjection';
import type { DesktopGatewaySource } from '../shared/desktopGateway';

function gatewaySource(overrides: Partial<DesktopGatewaySource> = {}): DesktopGatewaySource {
  return {
    gateway_id: 'bastion',
    display_name: 'Bastion',
    local_enabled: true,
    connection_kind: 'url',
    management_capability: 'access_only',
    capabilities: [],
    permissions: catalogFixture.gateway.permissions,
    status: 'online',
    trust_state: 'paired',
    endpoint_label: 'https://gateway.example.invalid',
    created_at_ms: 10,
    updated_at_ms: 20,
    environments: [{ ...memberFixture, member_id: 'env_demo', display_name: 'Demo' }],
    ...overrides,
  };
}

describe('environmentLibraryProjection', () => {
  it('projects a linked Runtime and Cloud Environment as one visual group', () => {
    const local = testProviderBoundLocalEnvironment('https://provider.example.invalid', 'env_demo', {
      label: 'Local Environment',
    });
    const provider = testCloudEnvironment('https://provider.example.invalid', 'env_demo', {
      label: 'Dev Local',
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
        cloud_environments: [provider],
      }),
    });
    const localEntry = snapshot.environments.find((entry) => entry.kind === 'local_environment')!;
    const providerEntry = snapshot.environments.find((entry) => entry.kind === 'provider_environment')!;
    const runtimeTarget = {
      ...localEntry.provider_runtime_link_target!,
      id: 'local:local' as const,
      cloud_link_state: 'linked' as const,
      provider_connection_state: 'connected' as const,
      cloud_origin: provider.cloud_origin,
      cloud_id: provider.cloud_id,
      env_public_id: provider.env_public_id,
    };
    const linkedLocal = { ...localEntry, provider_runtime_link_target: runtimeTarget };
    const linkedProvider = {
      ...providerEntry,
      cloud_linked_runtime_summary: {
        runtime_target_id: runtimeTarget.id,
        runtime_kind: 'local_environment' as const,
        label: linkedLocal.label,
        provider_connection_state: 'connected' as const,
      },
    };
    const groups = buildEnvironmentLibraryDisplayGroups([linkedLocal, linkedProvider]);
    const relation = groups.find((group) => group.provider_entry?.id === linkedProvider.id);

    expect(relation).toBeTruthy();
    expect(relation?.primary_entry.kind).toBe('local_environment');
    expect(relation?.primary_entry.id).toBe(linkedLocal.id);
    expect(relation?.member_ids).toEqual([linkedLocal.id, linkedProvider.id]);
    expect(relation?.pinned).toBe(false);
    expect(groups.filter((group) => group.member_ids.includes(linkedLocal.id))).toHaveLength(1);
    expect(groups.filter((group) => group.member_ids.includes(linkedProvider.id))).toHaveLength(1);
  });

  it('keeps a provider entry independent when the runtime target identity does not match', () => {
    const local = testProviderBoundLocalEnvironment('https://provider.example.invalid', 'env_demo', {
      label: 'Local Environment',
    });
    const provider = testCloudEnvironment('https://provider.example.invalid', 'env_demo', {
      label: 'Dev Local',
      pinned: true,
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
        cloud_environments: [provider],
      }),
    });
    const localEntry = snapshot.environments.find((entry) => entry.kind === 'local_environment')!;
    const providerEntry = snapshot.environments.find((entry) => entry.kind === 'provider_environment')!;
    const unpairedLocal = {
      ...localEntry,
      provider_runtime_link_target: {
        ...localEntry.provider_runtime_link_target!,
        id: 'local:local' as const,
        cloud_link_state: 'linked' as const,
        provider_connection_state: 'connected' as const,
        cloud_origin: 'https://other.example.invalid',
        cloud_id: 'other_control_plane',
        env_public_id: 'env_other',
      },
    };
    const staleProvider = {
      ...providerEntry,
      cloud_linked_runtime_summary: {
        runtime_target_id: 'local:local' as const,
        runtime_kind: 'local_environment' as const,
        label: unpairedLocal.label,
        provider_connection_state: 'connected' as const,
      },
    };
    const groups = buildEnvironmentLibraryDisplayGroups([staleProvider, unpairedLocal]);

    expect(groups).toHaveLength(2);
    expect(groups[0].provider_entry).toBeUndefined();
    expect(groups[1].provider_entry).toBeUndefined();
    expect(groups.find((group) => group.primary_entry.id === staleProvider.id)?.pinned).toBe(true);
  });

  it('dissolves a relationship when the Cloud entry is absent from a refreshed snapshot', () => {
    const local = testProviderBoundLocalEnvironment('https://provider.example.invalid', 'env_demo', {
      label: 'Local Environment',
    });
    const provider = testCloudEnvironment('https://provider.example.invalid', 'env_demo', {
      label: 'Dev Local',
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
        cloud_environments: [provider],
      }),
    });
    const localEntry = snapshot.environments.find((entry) => entry.kind === 'local_environment')!;
    const providerEntry = snapshot.environments.find((entry) => entry.kind === 'provider_environment')!;
    const runtimeTarget = {
      ...localEntry.provider_runtime_link_target!,
      id: 'local:local' as const,
      cloud_link_state: 'linked' as const,
      provider_connection_state: 'connected' as const,
      cloud_origin: provider.cloud_origin,
      cloud_id: provider.cloud_id,
      env_public_id: provider.env_public_id,
    };
    const linkedLocal = { ...localEntry, provider_runtime_link_target: runtimeTarget };
    const linkedProvider = {
      ...providerEntry,
      cloud_linked_runtime_summary: {
        runtime_target_id: runtimeTarget.id,
        runtime_kind: 'local_environment' as const,
        label: linkedLocal.label,
        provider_connection_state: 'disconnecting' as const,
      },
    };

    expect(buildEnvironmentLibraryDisplayGroups([linkedLocal, linkedProvider])).toHaveLength(1);
    const dissolved = buildEnvironmentLibraryDisplayGroups([linkedLocal]);
    expect(dissolved).toHaveLength(1);
    expect(dissolved[0]).toMatchObject({
      id: linkedLocal.id,
      primary_entry: linkedLocal,
      member_ids: [linkedLocal.id],
    });
    expect(dissolved[0].provider_entry).toBeUndefined();
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
