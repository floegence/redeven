import { describe, expect, it } from 'vitest';

import { normalizeGatewayCatalogResponse, normalizeGatewayOpenSessionResponse, redactGatewayDiagnosticValue } from './gatewayClient';

describe('Gateway access client contracts', () => {
  it('normalizes an access-only catalog environment', () => {
    const catalog = normalizeGatewayCatalogResponse({
      protocol_version: 'redeven-gateway-v2',
      gateway: {
        gateway_id: 'gw-1',
        display_name: 'Gateway',
        status: 'online',
        capabilities: ['env_catalog', 'env_open_session'],
      },
      environments: [{
        gateway_env_id: 'env-1',
        display_name: 'Remote',
        env_kind: 'managed_local_env',
        state: 'available',
        capabilities: ['open', 'start'],
        control_capabilities: ['start'],
        origin: { kind: 'gateway_host', label: 'host' },
      }],
    });
    expect(catalog.environments[0]).toMatchObject({
      env_kind: 'reachable_env',
      capabilities: [],
    });
  });

  it('validates open-session response shape', () => {
    const response = normalizeGatewayOpenSessionResponse({
      protocol_version: 'redeven-gateway-v2',
      gateway_session_id: 'session',
      gateway_env_id: 'env-1',
      connect_artifact: {
        kind: 'local_direct_artifact',
        url: 'http://127.0.0.1:24000/',
        expires_at_unix_ms: Date.now() + 60_000,
        artifact_nonce: 'nonce',
        proof: 'proof',
      },
    });
    expect(response.gateway_env_id).toBe('env-1');
  });

  it('redacts Gateway secrets from diagnostics', () => {
    expect(redactGatewayDiagnosticValue({ token: 'secret', nested: { proof: 'x' }, value: 'ok' })).toEqual({
      token: '[redacted]',
      nested: { proof: '[redacted]' },
      value: 'ok',
    });
  });
});
