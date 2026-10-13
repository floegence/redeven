import { memberFixture } from '../testSupport/gatewayMembershipFixture';
import { describe, expect, it } from 'vitest';

import { buildGatewayEnvironmentEntries } from './environmentAggregator';

describe('Gateway environment projection', () => {
  it('consumes an opened member Runtime distribution without changing catalog identity or authority', () => {
    const input = { gatewaySources: [{ gateway_id: 'observed-gateway', display_name: 'Gateway', local_enabled: true,
      connection_kind: 'url' as const, management_capability: 'access_only' as const, capabilities: ['member_access' as const],
      status: 'online' as const, created_at_ms: 1, updated_at_ms: 1, environments: [memberFixture] }] };
    const catalog = buildGatewayEnvironmentEntries(input)[0];
    const session = { ...catalog, label: 'Untrusted session label', open_session_key: 'window', runtime_platform: 'linux' as const,
      runtime_linux_distribution: 'debian', can_edit: true, can_delete: true };
    const [entry] = buildGatewayEnvironmentEntries({ ...input, openSessions: [session] });
    expect(entry).toMatchObject({ runtime_platform: 'linux', runtime_linux_distribution: 'debian',
      label: catalog.label, can_edit: false, can_delete: false, gateway_member: memberFixture });
  });
  it('projects catalog entries as access-only environments', () => {
    const [entry] = buildGatewayEnvironmentEntries({
      gatewaySources: [{
        gateway_id: 'gw-1',
        display_name: 'Gateway',
        local_enabled: true,
        connection_kind: 'url',
        management_capability: 'access_only',
        capabilities: ['member_access'], permissions: { access: true, manage_members: true, configure_cloud: true },
        status: 'online',
        created_at_ms: 1,
        updated_at_ms: 1,
        environments: [memberFixture],
      }],
    });
    expect(entry).toMatchObject({ kind: 'gateway_environment', can_delete: false, can_edit: false });
    expect(entry?.runtime_operations.start.menu_visibility).toBe('hidden');
  });
});

it.each([['darwin', 'macos'], ['linux', 'linux'], ['win32', 'windows'], ['unknown', undefined], ['', undefined]])(
  'uses Gateway member OS %s without inferring from architecture or Gateway host', (os, expected) => {
    const [entry] = buildGatewayEnvironmentEntries({ gatewaySources: [{
      gateway_id: 'os-gateway', display_name: 'Windows gateway', local_enabled: true, connection_kind: 'url',
      management_capability: 'access_only', capabilities: ['member_access'], status: 'online', created_at_ms: 1, updated_at_ms: 1,
      environments: [{ ...memberFixture, metadata: { ...memberFixture.metadata, os, arch: 'darwin' } }],
    }] });
    expect(entry.runtime_platform).toBe(expected);
  },
);
