import { memberFixture } from '../testSupport/gatewayMembershipFixture';
import { describe, expect, it } from 'vitest';

import { buildGatewayEnvironmentEntries } from './environmentAggregator';

describe('Gateway environment projection', () => {
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
