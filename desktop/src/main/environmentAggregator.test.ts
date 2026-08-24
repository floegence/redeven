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
        capabilities: ['env_catalog', 'env_open_session'],
        status: 'online',
        created_at_ms: 1,
        updated_at_ms: 1,
        environments: [{
          gateway_env_id: 'env-1',
          display_name: 'Remote',
          env_kind: 'reachable_env',
          state: 'available',
          capabilities: ['open'],
          access_capabilities: ['open'],
          origin: { kind: 'gateway_host', label: 'host' },
        }],
      }],
    });
    expect(entry).toMatchObject({ kind: 'gateway_environment', can_delete: false });
    expect(entry?.runtime_operations.start.menu_visibility).toBe('hidden');
  });
});
